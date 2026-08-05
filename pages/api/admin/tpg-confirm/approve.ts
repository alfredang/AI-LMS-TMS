/**
 * POST /api/admin/tpg-confirm/approve
 *
 * Releases a TPGateway run that is parked at 'awaiting_approval'. An unlimited
 * live run stops after finding its applications and waits here, so the operator
 * sees how many are about to be confirmed before anything irreversible happens
 * on TPGateway.
 *
 * Body: { jobId: string }
 */
import type { NextApiRequest, NextApiResponse } from 'next';
import { requireRole } from '@lib/auth/requireRole';
import { approveTpgConfirmJob } from '@lib/tpg/confirmApplications';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ success: false, error: 'Method Not Allowed' });
  }

  const user = await requireRole(req, res, ['admin', 'developer', 'trainingProvider']);
  if (!user) return; // requireRole already sent 401/403

  const jobId = typeof req.body?.jobId === 'string' ? req.body.jobId : '';
  if (!jobId) {
    return res.status(400).json({ success: false, error: 'jobId is required' });
  }

  const approved = approveTpgConfirmJob(jobId);
  if (!approved) {
    return res.status(409).json({
      success: false,
      error: 'That run is not waiting for approval (it may have been cancelled or timed out).',
    });
  }

  return res.status(200).json({ success: true, message: 'Approved — confirming now.' });
}
