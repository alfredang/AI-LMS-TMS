import { withAuth } from '@lib/auth/withAuth';
import type { NextApiRequest, NextApiResponse } from 'next';
import pool from '../../../../lib/db';

/**
 * POST /api/admin/wsq-schedule-sync/cancel-job
 * Body: { job_id: number }
 *
 * Marks a running job as failed so it no longer blocks new syncs.
 */
async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', ['POST']);
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const jobId = Number(req.body?.job_id);
  if (!jobId) return res.status(400).json({ error: 'job_id is required' });

  const result = await pool.query(
    `UPDATE wsq_sync_job
        SET status = 'failed', completed_at = NOW(),
            summary = 'Cancelled manually'
      WHERE id = $1 AND status = 'running'
      RETURNING id`,
    [jobId],
  );

  if (result.rows.length === 0) {
    return res.status(404).json({ error: 'No running job found with that ID' });
  }

  return res.status(200).json({ cancelled: result.rows[0].id });
}

export default withAuth(handler, { roles: ['admin', 'trainingProvider', 'developer'] });
