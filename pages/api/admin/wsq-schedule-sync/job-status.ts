import { withAuth } from '@lib/auth/withAuth';
import type { NextApiRequest, NextApiResponse } from 'next';
import pool from '../../../../lib/db';

/**
 * GET /api/admin/wsq-schedule-sync/job-status
 *
 * Returns the 50 most recent wsq_sync_job rows as an array (newest first).
 * The first element is the current/most-recent job; the rest are history.
 * Returns [] if no jobs exist.
 * Polled every 2 s by WsqScheduleSyncView while a job is running.
 */
async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', ['GET']);
    return res.status(405).json({ error: 'Method not allowed' });
  }

  // Ensure table exists (idempotent)
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
      summary        TEXT,
      triggered_by   TEXT        NOT NULL DEFAULT 'user'
                                 CHECK (triggered_by IN ('user', 'cron'))
    )
  `).catch(() => { /* ignore if already exists */ });

  try {
    const result = await pool.query(
      `SELECT * FROM wsq_sync_job
        ORDER BY started_at DESC
        LIMIT 50`,
    );

    return res.status(200).json(result.rows);
  } catch (e: any) {
    return res.status(500).json({ error: e?.message || 'Failed to fetch job status' });
  }
}

export default withAuth(handler, { roles: ['admin', 'trainingProvider', 'developer'] });
