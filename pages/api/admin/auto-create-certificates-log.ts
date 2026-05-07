import type { NextApiRequest, NextApiResponse } from 'next';
import pool from '../../../lib/db';

/**
 * GET /api/admin/auto-create-certificates-log?limit=500
 *
 * Reads per-learner logs produced by the auto-create-certificates cron.
 * Returns data grouped-ready by run_id, matching the shared
 * AutoSendEmailLogView format used by course completion, courseware, etc.
 */
export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') {
    return res.status(405).json({ success: false, error: 'Method not allowed' });
  }

  const limit = Math.min(parseInt(String(req.query.limit || '500'), 10), 1000);

  try {
    // Ensure the table and columns exist (idempotent)
    await pool.query(`
      CREATE TABLE IF NOT EXISTS auto_create_certificates_log (
        id SERIAL PRIMARY KEY,
        run_id TEXT NOT NULL,
        course_run_id TEXT,
        course_title TEXT,
        course_code TEXT,
        learner_name TEXT,
        learner_email TEXT,
        nric TEXT,
        certificate_url TEXT,
        status TEXT NOT NULL,
        error_message TEXT,
        created_at TIMESTAMPTZ DEFAULT NOW(),
        updated_at TIMESTAMPTZ DEFAULT NOW()
      )
    `);
    // Add learner_email column if missing (existing tables won't have it)
    await pool.query(`ALTER TABLE auto_create_certificates_log ADD COLUMN IF NOT EXISTS learner_email TEXT`);
    await pool.query(
      `CREATE INDEX IF NOT EXISTS idx_auto_create_certificates_log_run_id
       ON auto_create_certificates_log(run_id, created_at DESC)`
    );

    const result = await pool.query(
      `SELECT id, run_id, created_at, course_run_id, course_code, course_title,
              learner_name, learner_email, nric, certificate_url, status, error_message
       FROM auto_create_certificates_log
       ORDER BY created_at DESC
       LIMIT $1`,
      [limit]
    );

    return res.status(200).json({ success: true, data: result.rows });
  } catch (error: any) {
    console.error('Error fetching auto-create certificates logs:', error);
    return res.status(500).json({ success: false, error: error.message });
  }
}
