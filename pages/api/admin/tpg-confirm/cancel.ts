/**
 * POST /api/admin/tpg-confirm/cancel
 *
 * Asks a running TPGateway "confirm & fetch" job to stop. Cancellation is
 * cooperative — the driver checks between applications, so an application
 * already being confirmed finishes rather than being left half-actioned on
 * TPGateway. Anything confirmed before the stop is still handed back for
 * ingest, so a cancelled run never strands a confirmed application.
 *
 * Body: { jobId: string }
 */
import type { NextApiRequest, NextApiResponse } from 'next';
import { requireRole } from '@lib/auth/requireRole';
import { cancelTpgConfirmJob } from '@lib/tpg/confirmApplications';

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

  const cancelled = cancelTpgConfirmJob(jobId);
  return res.status(200).json({
    success: true,
    cancelled,
    message: cancelled ? 'Stopping…' : 'That run has already finished.',
  });
}
