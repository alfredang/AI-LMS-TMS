import { NextApiRequest, NextApiResponse } from 'next';
import pool from '../../../lib/db';

/**
 * GET /api/admin/mailerlite-sync-logs
 *
 * Returns mailerlite_sync_log rows (one per sync run), newest first.
 * Query params:
 *   limit  – max rows to return (default 100, cap 500)
 *   offset – for pagination (default 0)
 */
export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') {
    return res.status(405).json({ success: false, message: 'Method not allowed' });
  }

  const limit = Math.min(Number(req.query.limit) || 100, 500);
  const offset = Number(req.query.offset) || 0;

  try {
    // Ensure table exists (first-run safety)
    await pool.query(`
      CREATE TABLE IF NOT EXISTS mailerlite_sync_log (
        id               SERIAL PRIMARY KEY,
        run_id           TEXT NOT NULL,
        created_at       TIMESTAMPTZ DEFAULT NOW(),
        total_candidates INTEGER NOT NULL DEFAULT 0,
        submitted_count  INTEGER NOT NULL DEFAULT 0,
        error_count      INTEGER NOT NULL DEFAULT 0,
        status           TEXT NOT NULL,
        message          TEXT
      )
    `);

    const result = await pool.query(
      `SELECT id, run_id, created_at, total_candidates, submitted_count,
              error_count, status, message
       FROM mailerlite_sync_log
       ORDER BY created_at DESC
       LIMIT $1 OFFSET $2`,
      [limit, offset],
    );

    const countResult = await pool.query(
      `SELECT COUNT(*) AS total FROM mailerlite_sync_log`,
    );

    return res.status(200).json({
      success: true,
      data: result.rows,
      total: Number(countResult.rows[0]?.total ?? 0),
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    console.error('❌ mailerlite-sync-logs error:', err);
    return res.status(500).json({ success: false, message });
  }
}
