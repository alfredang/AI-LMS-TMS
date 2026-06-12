import type { NextApiRequest, NextApiResponse } from 'next';
import { ensureCompanyApplicationsTable } from '../../../lib/companyApplicationsTable';
import { generateInvoicesForApplications } from '../../../lib/quickbooks/createCompanyApplicationInvoice';

/**
 * POST /api/admin/ca-generate-invoice
 *
 * Body: { applicationIds: string[] }
 *
 * Groups the given Company Application rows by (employer_uen, course_run_id)
 * and creates one QuickBooks invoice per group. Idempotent — groups whose
 * rows already have an invoice_id are skipped.
 *
 * Pure invoice generation — never sends the employer email. Sending is gated
 * behind the manual "Send Invoice Email" button on View Company Application
 * (which requires verified supporting docs + the master toggle ON).
 */
export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ success: false, error: 'Method not allowed' });
  }

  const { applicationIds } = req.body || {};
  if (!Array.isArray(applicationIds) || applicationIds.length === 0) {
    return res.status(400).json({ success: false, error: 'applicationIds array is required' });
  }

  try {
    await ensureCompanyApplicationsTable();
    const result = await generateInvoicesForApplications(applicationIds);
    return res.status(200).json({ success: true, ...result });
  } catch (err) {
    console.error('[ca-generate-invoice] error:', err);
    return res.status(500).json({
      success: false,
      error: err instanceof Error ? err.message : 'Internal server error',
    });
  }
}
