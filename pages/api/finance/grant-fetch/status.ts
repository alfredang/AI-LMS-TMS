/**
 * GET /api/finance/grant-fetch/status?jobId=...
 *
 * Returns the live progress of a "Fetch from TPGateway" job for the UI to
 * poll. When the job finishes (phase 'done'), `data.result` is the same
 * GrantImportBatchPreview shape a manual .xlsx upload's job.result already is
 * — the frontend feeds it into the same preview/batchId state either way.
 */
import { withAuth } from '@lib/auth/withAuth';
import type { NextApiRequest, NextApiResponse } from 'next';
import { requireFinanceOrAdmin } from '@/lib/services/grantImport/requireFinanceOrAdmin';
import { getGrantFetchJob } from '@/lib/tpg/grantFetchJobStore';

async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', ['GET']);
    return res.status(405).json({ success: false, error: 'Method not allowed' });
  }

  try {
    await requireFinanceOrAdmin(req);

    const jobId = typeof req.query.jobId === 'string' ? req.query.jobId : '';
    if (!jobId) {
      return res.status(400).json({ success: false, error: 'jobId is required' });
    }

    const job = getGrantFetchJob(jobId);
    if (!job) {
      return res.status(404).json({ success: false, error: 'Job not found' });
    }

    return res.status(200).json({ success: true, data: job });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : 'Internal server error';
    return res.status(500).json({ success: false, error: msg });
  }
}

export default withAuth(handler, { roles: ['admin', 'trainingProvider', 'finance'] });
