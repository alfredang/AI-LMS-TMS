import type { NextApiRequest, NextApiResponse } from 'next';
import { ensureCompanyApplicationsTable } from '../../../lib/companyApplicationsTable';
import { sendCompanyApplicationInvoiceEmails } from '../../../lib/quickbooks/sendCompanyApplicationInvoiceEmails';

/**
 * POST /api/admin/ca-send-invoice-email
 *
 * Body: { applicationIds: string[] }
 *
 * Sends ONE QuickBooks email per unique main tax invoice covering the given
 * application rows. Recipient is the EMPLOYER contact email (NOT the trainee
 * email) — CA invoices are billed to the sponsoring company.
 *
 * Grant invoices are NOT emailed — those are staff/internal records billed to
 * WSG, not the customer.
 *
 * Sole entrypoint for CA invoice emails: the "Send Invoice Email" button on
 * View Company Application. There is no auto-send anywhere else in the CA
 * flow — verification and invoice generation are decoupled from sending.
 *
 * Server-side gates (enforced inside the helper):
 *   - training_provider.ca_auto_send_invoice_email = true
 *   - row has invoice_id
 *   - supporting_doc_verification_status = 'verified'
 *
 * Idempotent: rows are grouped by invoice_id, so a selection of 3 learners
 * sharing one consolidated invoice fires exactly one QBO email. All 3 rows
 * get the same `invoice_sent_at` / `invoice_sent_to` timestamps so the View
 * page renders the envelope state consistently for the whole group.
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
    const summary = await sendCompanyApplicationInvoiceEmails(applicationIds);
    return res.status(200).json({ success: true, ...summary });
  } catch (err) {
    console.error('[ca-send-invoice-email] error:', err);
    return res.status(500).json({
      success: false,
      error: err instanceof Error ? err.message : 'Internal server error',
    });
  }
}
