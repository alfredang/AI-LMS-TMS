/**
 * POST /api/finance/grant-fetch/cancel
 *
 * Asks a running "Fetch from TPGateway" job to stop. Cancellation is
 * cooperative — the driver checks between safe points (between pages / before
 * persisting), so nothing is left half-scraped.
 *
 * Body: { jobId: string }
 */
import { withAuth } from '@lib/auth/withAuth';
import type { NextApiRequest, NextApiResponse } from 'next';
import { requireFinanceOrAdmin } from '@/lib/services/grantImport/requireFinanceOrAdmin';
import { cancelGrantFetchJob } from '@/lib/tpg/fetchGrantDisbursements';

async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', ['POST']);
    return res.status(405).json({ success: false, error: 'Method not allowed' });
  }

  try {
    await requireFinanceOrAdmin(req);

    const jobId = typeof req.body?.jobId === 'string' ? req.body.jobId : '';
    if (!jobId) {
      return res.status(400).json({ success: false, error: 'jobId is required' });
    }

    const cancelled = cancelGrantFetchJob(jobId);
    return res.status(200).json({
      success: true,
      cancelled,
      message: cancelled ? 'Stopping…' : 'That run has already finished.',
    });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : 'Internal server error';
    return res.status(500).json({ success: false, error: msg });
  }
}

export default withAuth(handler, { roles: ['admin', 'trainingProvider', 'finance'] });
