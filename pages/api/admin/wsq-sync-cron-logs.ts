import { withAuth } from '@lib/auth/withAuth';
import type { NextApiRequest, NextApiResponse } from 'next';
import pool from '../../../lib/db';
import { ensureWsqSyncCronLogTable } from '../../../lib/wsqScheduleSync';

/**
 * GET /api/admin/wsq-sync-cron-logs?limit=50
 *
 * Recent WSQ sync cron runs (daily-fresh + weekly-blocked) for debugging — when
 * each cron ran and what it decided, including runs that started no job (nothing
 * to do / already running / MMS fetch error). The per-item sync results live in
 * wsq_sync_job (shown in the Sync History panel with a Cron badge).
 */
async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') {
    return res.status(405).json({ success: false, error: 'Method not allowed' });
  }
  const limit = Math.min(Number(req.query.limit) || 50, 200);
  try {
    await ensureWsqSyncCronLogTable();
    const r = await pool.query(
      `SELECT id, created_at, cron, status, considered, skipped_previously_failed, mms_courses, job_id, message
         FROM wsq_sync_cron_log
        ORDER BY created_at DESC
        LIMIT $1`,
      [limit],
    );
    return res.status(200).json({ success: true, data: r.rows });
  } catch (err: any) {
    console.error('[admin/wsq-sync-cron-logs]', err?.message || err);
    return res.status(500).json({ success: false, error: 'Internal server error' });
  }
}

export default withAuth(handler, { roles: ['admin', 'trainingProvider', 'developer'] });
