import type { NextApiRequest, NextApiResponse } from 'next';
import pool from '../../../lib/db';

// DELETE { nric, courseRunId }
// Removes a learner from an entire class:
//   - Deletes all course_attendance records across every session of the course run
//   - Deletes the local enrollment record for this course run
//   - Keeps app_user, learner_profile, user_role_map intact
export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'DELETE') {
    return res.status(405).json({ success: false, error: 'Method not allowed' });
  }

  const { nric, courseRunId } = req.body as { nric: string; courseRunId: string };
  if (!nric || !courseRunId) {
    return res.status(400).json({ success: false, error: 'nric and courseRunId are required' });
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // Resolve userId from _uid_ prefix or learner_profile lookup
    let userId: string | null = null;
    if (nric.startsWith('_uid_')) {
      userId = nric.slice(5);
    } else {
      const lookup = await client.query(
        `SELECT user_id FROM learner_profile WHERE nric = $1 LIMIT 1`,
        [nric]
      );
      userId = lookup.rows[0]?.user_id ?? null;
    }

    // 1. Delete all attendance records for this learner across every session of the course run
    await client.query(
      `DELETE FROM course_attendance
       WHERE nric = $1
         AND session_id IN (
           SELECT id FROM course_session WHERE course_run_id = $2
         )`,
      [nric, courseRunId]
    );

    // 2. Soft-delete enrollment: mark as Admin Removed so SSG sync does not re-add the learner
    if (userId) {
      await client.query(
        `UPDATE enrollment
         SET enrolment_status = 'Admin Removed', updated_at = NOW()
         WHERE course_run_id = $1 AND user_id = $2`,
        [courseRunId, userId]
      );
    } else if (!nric.startsWith('_uid_')) {
      await client.query(
        `UPDATE enrollment
         SET enrolment_status = 'Admin Removed', updated_at = NOW()
         WHERE course_run_id = $1 AND nric = $2`,
        [courseRunId, nric]
      );
    }

    await client.query('COMMIT');
    return res.status(200).json({ success: true, message: 'Learner removed from class successfully.' });
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    console.error('Error removing learner from class:', err);
    return res.status(500).json({ success: false, error: 'Internal server error' });
  } finally {
    client.release();
  }
}
