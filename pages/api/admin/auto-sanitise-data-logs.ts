import { withAuth } from '@lib/auth/withAuth';
import type { NextApiRequest, NextApiResponse } from 'next';
import pool from '../../../lib/db';

/**
 * GET /api/admin/auto-sanitise-data-logs?limit=500
 *
 * Reads per-row logs produced by the auto-sanitise-data sweep. Used by the
 * AutoSanitiseDataLogView in the Logging section.
 */
async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  const limit = Math.min(parseInt(String(req.query.limit || '500'), 10), 1000);

  try {
    // Create the table on demand so the UI never 500s on a fresh DB.
    await pool.query(`
      CREATE TABLE IF NOT EXISTS auto_sanitise_data_log (
        id           SERIAL PRIMARY KEY,
        run_id       TEXT NOT NULL,
        created_at   TIMESTAMPTZ DEFAULT NOW(),
        table_name   TEXT NOT NULL,
        rows_scanned INTEGER NOT NULL DEFAULT 0,
        rows_updated INTEGER NOT NULL DEFAULT 0,
        cutoff_date  DATE,
        status       TEXT NOT NULL,
        message      TEXT
      )
    `);
    await pool.query(
      `CREATE INDEX IF NOT EXISTS idx_auto_sanitise_data_log_run
       ON auto_sanitise_data_log(run_id, created_at DESC)`
    );

    const result = await pool.query(
      `SELECT id, run_id, created_at, table_name, rows_scanned, rows_updated,
              cutoff_date, status, message
       FROM auto_sanitise_data_log
       ORDER BY created_at DESC
       LIMIT $1`,
      [limit]
    );
    return res.status(200).json({ success: true, data: result.rows });
  } catch (error: any) {
    console.error('Error fetching auto-sanitise-data logs:', error);
    return res.status(500).json({ success: false, error: error.message });
  }
}

export default withAuth(handler, { roles: ['admin', 'trainingProvider', 'developer'] });
