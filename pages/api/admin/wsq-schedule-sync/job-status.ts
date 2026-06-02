import type { NextApiRequest, NextApiResponse } from 'next';
import pool from '../../../../lib/db';

/**
 * GET /api/admin/wsq-schedule-sync/job-status
 *
 * Returns the most recent wsq_sync_job row (running or completed within 24 h).
 * Returns null if no recent job exists.
 * Polled every 2 s by WsqScheduleSyncView so all users see shared progress.
 */
export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', ['GET']);
    return res.status(405).json({ error: 'Method not allowed' });
  }

  // Ensure table exists (idempotent — migration may not have run yet on local dev)
  await pool.query(`
    CREATE TABLE IF NOT EXISTS wsq_sync_job (
      id             SERIAL PRIMARY KEY,
      status         TEXT        NOT NULL DEFAULT 'running'
                                 CHECK (status IN ('running', 'completed', 'failed')),
      started_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      completed_at   TIMESTAMPTZ,
      total_items    INT         NOT NULL DEFAULT 0,
      items_done     INT         NOT NULL DEFAULT 0,
      submitted      INT         NOT NULL DEFAULT 0,
      already_exists INT         NOT NULL DEFAULT 0,
      ssg_errors     INT         NOT NULL DEFAULT 0,
      skipped        INT         NOT NULL DEFAULT 0,
      failures       JSONB       NOT NULL DEFAULT '[]',
      summary        TEXT
    )
  `).catch(() => { /* ignore if already exists */ });

  try {
    const result = await pool.query(
      `SELECT * FROM wsq_sync_job
        WHERE started_at > NOW() - INTERVAL '24 hours'
        ORDER BY started_at DESC
        LIMIT 1`,
    );

    return res.status(200).json(result.rows[0] ?? null);
  } catch (e: any) {
    return res.status(500).json({ error: e?.message || 'Failed to fetch job status' });
  }
}
