import { withAuth } from '@lib/auth/withAuth';
import type { NextApiRequest, NextApiResponse } from 'next';
import pool from '../../../lib/db';

async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  const limit = Math.min(parseInt(String(req.query.limit || '500'), 10), 1000);

  try {
    const result = await pool.query(
      `SELECT id, run_id, created_at, course_run_id, course_title, course_code,
              db_start_date, db_end_date, ssg_start_date, ssg_end_date,
              mode_of_learning, vacancy_code, status, error_message
       FROM upcoming_course_runs_log
       ORDER BY created_at DESC
       LIMIT $1`,
      [limit]
    );
    return res.status(200).json({ success: true, data: result.rows });
  } catch (error: any) {
    console.error('Error fetching upcoming course runs logs:', error);
    return res.status(500).json({ success: false, error: error.message });
  }
}

export default withAuth(handler, { roles: ['admin', 'trainingProvider', 'developer'] });
