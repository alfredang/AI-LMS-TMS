import { withAuth } from '@lib/auth/withAuth';
import type { NextApiRequest, NextApiResponse } from 'next';
import { runPendingInvoiceJobs } from '@/lib/services/invoiceJobsRunner';

function requireRunnerToken(req: NextApiRequest) {
  const expected = process.env.INVOICE_JOBS_RUNNER_TOKEN;
  if (!expected) return; // dev-friendly default
  const got = req.headers['x-job-token'];
  if (got !== expected) throw new Error('Unauthorized');
}

async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ success: false, error: 'Method not allowed' });
  }

  try {
    requireRunnerToken(req);
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : 'Unauthorized';
    return res.status(401).json({ success: false, error: msg });
  }

  const limit = Math.max(1, Math.min(10, Number(req.body?.limit ?? 3)));

  try {
    const { picked, processed, results } = await runPendingInvoiceJobs(limit);
    return res.status(200).json({
      success: true,
      picked,
      processed,
      results,
    });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : 'Internal server error';
    return res.status(500).json({ success: false, error: msg });
  }
}

export default withAuth(handler, { roles: ['admin', 'trainingProvider', 'finance'] });
