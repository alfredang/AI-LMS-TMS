import { withAuth } from '@lib/auth/withAuth';
import type { NextApiRequest, NextApiResponse } from 'next';
import pool from '../../../lib/db';

/**
 * GET /api/admin/course-run-date-sync-logs?limit=500
 * Returns recent rows from course_run_date_sync_log, newest first.
 */
async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') {
    return res.status(405).json({ success: false, error: 'Method not allowed' });
  }

  const limit = Math.min(Number(req.query.limit) || 500, 1000);

  try {
    const result = await pool.query(
      `SELECT id, run_id, created_at, course_run_id, course_title, course_code,
              db_start_date, db_end_date, ssg_start_date, ssg_end_date,
              status, updated, error_message
       FROM course_run_date_sync_log
       ORDER BY created_at DESC
       LIMIT $1`,
      [limit]
    );
    return res.status(200).json({ success: true, data: result.rows });
  } catch (err) {
    console.error('[course-run-date-sync-logs] Error:', err);
    return res.status(500).json({ success: false, error: 'Internal server error' });
  }
}

export default withAuth(handler, { roles: ['admin', 'trainingProvider', 'developer'] });
