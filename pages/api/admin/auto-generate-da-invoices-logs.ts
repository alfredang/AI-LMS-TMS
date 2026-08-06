import { withAuth } from '@lib/auth/withAuth';
import type { NextApiRequest, NextApiResponse } from 'next';
import pool from '../../../lib/db';

/**
 * GET /api/admin/auto-generate-da-invoices-logs?limit=500
 *
 * Reads per-application logs produced by the scheduled DA invoice sweep.
 */
async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  const limit = Math.min(parseInt(String(req.query.limit || '500'), 10), 1000);

  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS auto_generate_da_invoices_log (
        id              SERIAL PRIMARY KEY,
        run_id          TEXT NOT NULL,
        created_at      TIMESTAMPTZ DEFAULT NOW(),
        application_id  TEXT,
        enrolment_id    TEXT,
        stage           TEXT NOT NULL,
        status          TEXT NOT NULL,
        failed_step     TEXT,
        message         TEXT,
        error_message   TEXT
      )
    `);
    await pool.query(
      `CREATE INDEX IF NOT EXISTS idx_auto_generate_da_invoices_log_run
       ON auto_generate_da_invoices_log(run_id, created_at DESC)`
    );

    const result = await pool.query(
      `SELECT id, run_id, created_at, application_id, enrolment_id, stage, status,
              failed_step, message, error_message
       FROM auto_generate_da_invoices_log
       ORDER BY created_at DESC
       LIMIT $1`,
      [limit]
    );

    return res.status(200).json({ success: true, data: result.rows });
  } catch (error: any) {
    console.error('Error fetching auto generate DA invoice logs:', error);
    return res.status(500).json({ success: false, error: error.message });
  }
}

export default withAuth(handler, { roles: ['admin', 'trainingProvider', 'developer'] });
