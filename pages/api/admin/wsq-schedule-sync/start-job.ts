import { withAuth } from '@lib/auth/withAuth';
import type { NextApiRequest, NextApiResponse } from 'next';
import pool from '../../../../lib/db';

/**
 * POST /api/admin/wsq-schedule-sync/start-job
 * Body: { total_items: number, triggered_by?: 'user' | 'cron' }
 *
 * Creates a wsq_sync_job row and returns the job_id.
 * Blocks if a sync job started within the last 10 minutes is still running —
 * returns the existing job_id instead so the UI can poll it.
 */
async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', ['POST']);
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const totalItems = Number(req.body?.total_items);
  if (!totalItems || totalItems < 1) {
    return res.status(400).json({ error: 'total_items is required' });
  }

  const triggeredBy = req.body?.triggered_by === 'cron' ? 'cron' : 'user';

  // Ensure table exists (with triggered_by column)
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
  `).catch(() => {});

  // If a job is already running (started < 10 min ago), return it
  const existing = await pool.query(
    `SELECT id FROM wsq_sync_job
      WHERE status = 'running' AND started_at > NOW() - INTERVAL '10 minutes'
      ORDER BY started_at DESC LIMIT 1`,
  );
  if (existing.rows.length > 0) {
    return res.status(409).json({
      error: 'A sync is already in progress',
      job_id: existing.rows[0].id,
    });
  }

  const inserted = await pool.query<{ id: number }>(
    `INSERT INTO wsq_sync_job (total_items, triggered_by) VALUES ($1, $2) RETURNING id`,
    [totalItems, triggeredBy],
  );

  return res.status(200).json({ job_id: inserted.rows[0].id });
}

export default withAuth(handler, { roles: ['admin', 'trainingProvider', 'developer'] });
