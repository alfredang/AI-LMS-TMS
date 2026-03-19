import type { NextApiRequest, NextApiResponse } from 'next';
import pool from '../../../lib/db';

// DELETE { nric, courseRunId }
// Removes a manually-added learner from all sessions of a course run and deletes their account.
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

    // 1. Resolve userId: extract from _uid_ prefix or look up via learner_profile
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

    // 2. Explicitly delete attendance records for this nric across all sessions of the course run
    await client.query(
      `DELETE FROM course_attendance
       WHERE nric = $1
         AND session_id IN (
           SELECT id FROM course_session WHERE course_run_id = $2
         )`,
      [nric, courseRunId]
    );

    // 3. Delete the app_user account (cascades to learner_profile, user_role_map, enrollment, etc.)
    if (userId) {
      await client.query(`DELETE FROM app_user WHERE id = $1`, [userId]);
    }

    await client.query('COMMIT');
    return res.status(200).json({ success: true, message: 'Learner removed successfully.' });
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    console.error('Error removing manual learner:', err);
    return res.status(500).json({ success: false, error: 'Internal server error' });
  } finally {
    client.release();
  }
}
