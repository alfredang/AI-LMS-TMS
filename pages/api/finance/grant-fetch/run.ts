/**
 * POST /api/finance/grant-fetch/run
 *
 * Starts a "Fetch from TPGateway" job for Bulk Grant Payment Sync. Where the
 * browser actually runs depends on where the request can reach TPGateway from:
 * this server drives Chromium fine, but TPGateway sits behind CloudFront, which
 * blocks datacentre IP ranges — the request is refused before TPGateway ever
 * sees it. So the deployed site QUEUES the run and an office-agent script
 * (scripts/tpg-grant-fetch-agent.mjs) drives it from an address the portal
 * accepts, reporting progress back into this same job. Locally it just runs
 * here directly. Either way, returns a jobId immediately; poll
 * /api/finance/grant-fetch/status for progress.
 *
 * Body: { startDate: string }  (DD-MM-YYYY — TPGateway's own Payment From
 * field). Only a start date is asked for: TPGateway's Financial Transactions
 * page defaults "Payment To" to today and caps the range at 180 days, so a
 * start date alone is enough to widen past its 30-day default. Narrow further
 * by Payment Date in Step 2 afterward via its own From/To controls if needed.
 */
import { withAuth } from '@lib/auth/withAuth';
import type { NextApiRequest, NextApiResponse } from 'next';
import { requireFinanceOrAdmin } from '@/lib/services/grantImport/requireFinanceOrAdmin';
import { startGrantFetchJob, queueGrantFetchJob } from '@/lib/tpg/fetchGrantDisbursements';
import { getActiveGrantFetchJob } from '@/lib/tpg/grantFetchJobStore';

export const config = { maxDuration: 300 };

const DATE_RE = /^\d{2}-\d{2}-\d{4}$/;

async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', ['POST']);
    return res.status(405).json({ success: false, error: 'Method not allowed' });
  }

  try {
    const { actorUserId } = await requireFinanceOrAdmin(req);

    // One run at a time — a second would fight the first for the Chromium profile.
    const active = getActiveGrantFetchJob();
    if (active) {
      return res.status(409).json({
        success: false,
        jobId: active.id,
        error: 'A TPGateway fetch is already in progress. Wait for it to finish, or cancel it first.',
      });
    }

    const startDate = String(req.body?.startDate || '').trim();
    if (!DATE_RE.test(startDate)) {
      return res.status(400).json({ success: false, error: 'startDate is required, in DD-MM-YYYY format.' });
    }

    const runsHere = process.env.NODE_ENV !== 'production' || process.env.TPG_SERVER_BROWSER === 'true';

    if (!runsHere) {
      const jobId = queueGrantFetchJob(startDate, actorUserId);
      return res.status(200).json({
        success: true,
        jobId,
        queued: true,
        message: 'Queued — waiting for the office machine to pick it up. Progress appears here.',
      });
    }

    const jobId = startGrantFetchJob({ startDate, actorUserId });
    return res.status(200).json({ success: true, jobId });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : 'Internal server error';
    return res.status(500).json({ success: false, error: msg });
  }
}

export default withAuth(handler, { roles: ['admin', 'trainingProvider', 'finance'] });
