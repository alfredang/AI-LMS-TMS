import type { NextApiRequest, NextApiResponse } from 'next';
import pool from '../../../lib/db';

/**
 * GET /api/admin/auto-send-course-completion-logs?limit=500
 *
 * Reads per-learner logs produced by the auto-send-course-completion cron.
 */
export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  const limit = Math.min(parseInt(String(req.query.limit || '500'), 10), 1000);

  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS auto_send_course_completion_log (
        id SERIAL PRIMARY KEY,
        run_id TEXT NOT NULL,
        course_run_id TEXT,
        course_title TEXT,
        course_code TEXT,
        learner_name TEXT,
        learner_email TEXT,
        status TEXT NOT NULL,
        error_message TEXT,
        created_at TIMESTAMPTZ DEFAULT NOW()
      )
    `);
    await pool.query(
      `CREATE INDEX IF NOT EXISTS idx_auto_send_course_completion_log_run_id
       ON auto_send_course_completion_log(run_id, created_at DESC)`
    );

    const result = await pool.query(
      `SELECT id, run_id, created_at, course_run_id, course_code, course_title,
              learner_name, learner_email, status, error_message
       FROM auto_send_course_completion_log
       ORDER BY created_at DESC
       LIMIT $1`,
      [limit]
    );
    return res.status(200).json({ success: true, data: result.rows });
  } catch (error: any) {
    console.error('Error fetching auto send course completion logs:', error);
    return res.status(500).json({ success: false, error: error.message });
  }
}
