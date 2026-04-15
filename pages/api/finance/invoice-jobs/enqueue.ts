import type { NextApiRequest, NextApiResponse } from 'next';
import { enqueueInvoiceJobsFromConsolidatedFinance } from '@/lib/services/invoiceJobs';

/**
 * POST /api/finance/invoice-jobs/enqueue
 * Body: { enrolmentIds: string[] } — SSG ENR references from Consolidated Finance.
 */
export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ success: false, error: 'Method not allowed' });
  }

  const raw = req.body?.enrolmentIds;
  const enrolmentIds = Array.isArray(raw) ? raw.map((x: unknown) => String(x ?? '').trim()).filter(Boolean) : [];

  if (enrolmentIds.length === 0) {
    return res.status(400).json({ success: false, error: 'enrolmentIds array is required' });
  }
  if (enrolmentIds.length > 50) {
    return res.status(400).json({ success: false, error: 'Maximum 50 enrolments per request' });
  }

  try {
    const results = await enqueueInvoiceJobsFromConsolidatedFinance(enrolmentIds);
    const okCount = results.filter((r) => r.ok).length;
    return res.status(200).json({
      success: true,
      results,
      summary: { total: results.length, queued: okCount, skippedOrFailed: results.length - okCount },
    });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : 'Internal server error';
    return res.status(500).json({ success: false, error: msg });
  }
}
