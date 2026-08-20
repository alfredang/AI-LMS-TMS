import { withAuth } from '@lib/auth/withAuth';
import type { NextApiRequest, NextApiResponse } from 'next';
import { ensureCompanyApplicationsTable } from '../../../lib/companyApplicationsTable';
import { generateInvoicesForApplications } from '../../../lib/quickbooks/createCompanyApplicationInvoice';
import type { InvoiceGenerationMode } from '../../../lib/quickbooks/createCompanyApplicationInvoice';

/**
 * POST /api/admin/ca-generate-invoice
 *
 * Body: { applicationIds: string[], mode?: 'consolidated' | 'per-learner' }
 *
 * Groups the given Company Application rows and creates one QuickBooks invoice
 * per group — by (employer_uen, course_run_id) in the default `consolidated`
 * mode, or one invoice per learner in `per-learner` mode (admin picks this in
 * the Generate Invoice popup when a single person must be billed alone).
 * Idempotent — rows that already have an invoice_id are never re-billed.
 *
 * Pure invoice generation — never sends the employer email. Sending is gated
 * behind the manual "Send Invoice Email" button on View Company Application
 * (which requires verified supporting docs + the master toggle ON).
 */
async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ success: false, error: 'Method not allowed' });
  }

  const { applicationIds, mode } = req.body || {};
  if (!Array.isArray(applicationIds) || applicationIds.length === 0) {
    return res.status(400).json({ success: false, error: 'applicationIds array is required' });
  }
  // Default to consolidated so existing callers (and the automated pipeline)
  // keep their current behaviour. Reject anything else rather than silently
  // falling back — billing granularity is not a thing to guess at.
  const requestedMode: InvoiceGenerationMode = mode === undefined ? 'consolidated' : mode;
  if (requestedMode !== 'consolidated' && requestedMode !== 'per-learner') {
    return res.status(400).json({
      success: false,
      error: "mode must be 'consolidated' or 'per-learner'",
    });
  }

  try {
    await ensureCompanyApplicationsTable();
    const result = await generateInvoicesForApplications(applicationIds, requestedMode);
    return res.status(200).json({ success: true, ...result });
  } catch (err) {
    console.error('[ca-generate-invoice] error:', err);
    return res.status(500).json({
      success: false,
      error: err instanceof Error ? err.message : 'Internal server error',
    });
  }
}

export default withAuth(handler, { roles: ['admin', 'trainingProvider', 'developer'] });
