import type { NextApiRequest, NextApiResponse } from 'next';
import pool from '../../../lib/db';

// GET ?courseRunId=xxx
// Returns total session count + attended count per NRIC for a course run.
export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') {
    return res.status(405).json({ success: false, error: 'Method not allowed' });
  }

  const { courseRunId } = req.query;
  if (!courseRunId || typeof courseRunId !== 'string') {
    return res.status(400).json({ success: false, error: 'courseRunId is required' });
  }

  const client = await pool.connect();
  try {
    const [sessionsResult, attendanceResult] = await Promise.all([
      client.query(
        `SELECT COUNT(*)::int AS total FROM course_session WHERE course_run_id = $1`,
        [courseRunId]
      ),
      client.query(
        `SELECT ca.nric, ca.user_id,
                COUNT(*) FILTER (WHERE ca.is_present = true)::int AS attended_count
         FROM course_attendance ca
         WHERE ca.session_id IN (
           SELECT id FROM course_session WHERE course_run_id = $1
         )
         GROUP BY ca.nric, ca.user_id`,
        [courseRunId]
      ),
    ]);

    const totalSessions: number = sessionsResult.rows[0]?.total ?? 0;
    const data = attendanceResult.rows.map(row => ({
      nric: row.nric || '',
      userId: row.user_id || '',
      attendedCount: row.attended_count,
    }));

    return res.status(200).json({ success: true, totalSessions, data });
  } catch (err) {
    console.error('Error fetching attendance summary:', err);
    return res.status(500).json({ success: false, error: 'Internal server error' });
  } finally {
    client.release();
  }
}
