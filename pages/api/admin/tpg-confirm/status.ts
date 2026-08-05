/**
 * GET /api/admin/tpg-confirm/status?jobId=...
 *
 * Returns the live progress of a TPGateway confirm & fetch job for the UI to
 * poll. When the job finishes (phase 'done') in live mode, `rows` holds the
 * parsed export rows for the UI to feed into the existing DA upload flow.
 */
import type { NextApiRequest, NextApiResponse } from 'next';
import { requireRole } from '@lib/auth/requireRole';
import { getJob } from '@lib/tpg/jobStore';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') {
    return res.status(405).json({ success: false, error: 'Method Not Allowed' });
  }

  const user = await requireRole(req, res, ['admin', 'developer', 'trainingProvider']);
  if (!user) return;

  const jobId = typeof req.query.jobId === 'string' ? req.query.jobId : '';
  if (!jobId) {
    return res.status(400).json({ success: false, error: 'jobId is required' });
  }

  const job = getJob(jobId);
  if (!job) {
    return res.status(404).json({ success: false, error: 'Job not found' });
  }

  return res.status(200).json({ success: true, job });
}
