import type { NextApiRequest, NextApiResponse } from 'next';
import pool from '../../../lib/db';
import { ensureCompanyApplicationsTable } from '../../../lib/companyApplicationsTable';
import { generateInvoicesForApplications } from '../../../lib/quickbooks/createCompanyApplicationInvoice';
import {
  sendCompanyApplicationInvoiceEmails,
  type CaInvoiceEmailSummary,
} from '../../../lib/quickbooks/sendCompanyApplicationInvoiceEmails';

/**
 * POST /api/admin/ca-generate-invoice
 *
 * Body: { applicationIds: string[] }
 *
 * Groups the given Company Application rows by (employer_uen, course_run_id)
 * and creates one QuickBooks invoice per group. Idempotent — groups whose
 * rows already have an invoice_id are skipped.
 *
 * If training_provider.ca_auto_send_invoice_email is true, the consolidated
 * tax invoice is also emailed to the employer contact after generation —
 * mirrors DA's processDirectApplication({ sendInvoiceEmail: true }) flow.
 * Email failures are best-effort and never void a successful invoice.
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

    // Always attempt auto-send when the toggle is ON — sendCompanyApplicationInvoiceEmails
    // is idempotent (skips rows with invoice_sent_at) and reports rows with no
    // invoice yet as skippedNoInvoice. Gating on result.generated > 0 would
    // mean a user who flips the toggle ON after invoices already exist never
    // gets emails until they click the manual Send button.
    let emailSummary: CaInvoiceEmailSummary | null = null;
    let emailError: string | null = null;
    try {
      const toggleRes = await pool.query(
        `SELECT COALESCE(ca_auto_send_invoice_email, false) AS enabled
           FROM training_provider
           LIMIT 1`
      );
      if (toggleRes.rows[0]?.enabled) {
        emailSummary = await sendCompanyApplicationInvoiceEmails(applicationIds);
        console.log(
          `[ca-generate-invoice] auto-send: ${emailSummary.sent} sent, ${emailSummary.failed} failed, ${emailSummary.skippedAlreadySent} already sent, ${emailSummary.skippedNoInvoice} no invoice yet`
        );
      }
    } catch (err) {
      emailError = err instanceof Error ? err.message : String(err);
      console.warn('[ca-generate-invoice] auto-send email failed:', emailError);
    }

    return res.status(200).json({ success: true, ...result, emailSummary, emailError });
  } catch (err) {
    console.error('[ca-generate-invoice] error:', err);
    return res.status(500).json({
      success: false,
      error: err instanceof Error ? err.message : 'Internal server error',
    });
  }
}
