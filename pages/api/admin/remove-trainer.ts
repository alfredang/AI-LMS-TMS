import { NextApiRequest, NextApiResponse } from 'next';
import pool from '../../../lib/db';

/** Sync legacy single-trainer columns on course_run with the first trainer from the junction table */
async function syncLegacyColumns(courseRunUuid: string) {
  const first = await pool.query(
    `SELECT trainer_id, trainer_name, trainer_email
     FROM course_run_trainer
     WHERE course_run_id = $1
     ORDER BY assigned_at ASC
     LIMIT 1`,
    [courseRunUuid]
  );
  if (first.rows.length > 0) {
    const { trainer_id, trainer_name, trainer_email } = first.rows[0];
    await pool.query(
      `UPDATE course_run
       SET assigned_trainer_id = $1, assigned_trainer_name = $2, assigned_trainer_email = $3, updated_at = NOW()
       WHERE id = $4`,
      [trainer_id, trainer_name, trainer_email, courseRunUuid]
    );
  } else {
    await pool.query(
      `UPDATE course_run
       SET assigned_trainer_id = NULL, assigned_trainer_name = NULL, assigned_trainer_email = NULL, updated_at = NOW()
       WHERE id = $1`,
      [courseRunUuid]
    );
  }
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ success: false, error: 'Method not allowed' });
  }

  const { courseRunUuid, trainerId, junctionId } = req.body;
  if (!courseRunUuid) {
    return res.status(400).json({ success: false, error: 'courseRunUuid is required' });
  }

  try {
    if (junctionId) {
      // Remove by junction table row PK — most reliable
      await pool.query(
        `DELETE FROM course_run_trainer WHERE id = $1 AND course_run_id = $2`,
        [junctionId, courseRunUuid]
      );
      console.log(`🗑️ Removed junction row ${junctionId} from course run ${courseRunUuid}`);
    } else if (trainerId) {
      // Remove a specific trainer from the junction table by trainer_id
      await pool.query(
        `DELETE FROM course_run_trainer WHERE course_run_id = $1 AND trainer_id = $2`,
        [courseRunUuid, trainerId]
      );
      console.log(`🗑️ Removed trainer ${trainerId} from course run ${courseRunUuid}`);
    } else {
      // Remove ALL trainers (legacy behavior)
      await pool.query(
        `DELETE FROM course_run_trainer WHERE course_run_id = $1`,
        [courseRunUuid]
      );
      console.log(`🗑️ Removed all trainers from course run ${courseRunUuid}`);
    }

    // Sync the legacy columns
    await syncLegacyColumns(courseRunUuid);

    return res.status(200).json({ success: true, message: 'Trainer removed successfully' });
  } catch (error) {
    console.error('❌ Error removing trainer:', error);
    return res.status(500).json({
      success: false,
      error: 'Internal server error: ' + (error instanceof Error ? error.message : 'Unknown error'),
    });
  }
}
