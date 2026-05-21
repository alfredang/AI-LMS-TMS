import type { NextApiRequest, NextApiResponse } from 'next';
import pool from '../../../lib/db';
import { ensureCompanyApplicationsTable } from '../../../lib/companyApplicationsTable';

type Verdict = 'verified' | 'mismatch';

/**
 * POST /api/admin/ca-verify-and-send
 *
 * Body: { companyApplicationId: uuid, verdict: 'verified' | 'mismatch', verifiedBy?: string }
 *
 * Marks the supporting-doc verification verdict on the row. When all rows in
 * the same (employer_uen, course_run_id) group are verified AND have an
 * invoice_id, triggers the invoice email send for the group via
 * sendCompanyApplicationInvoiceEmails (idempotent — already-sent invoices
 * are skipped).
 *
 * mismatch verdict: clears the Drive file reference so the admin is forced
 * to re-upload the correct document before re-attempting verification.
 */
export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ success: false, error: 'Method not allowed' });
  }

  try {
    await ensureCompanyApplicationsTable();

    const companyApplicationId = String(req.body?.companyApplicationId || '').trim();
    const verdict = String(req.body?.verdict || '').trim().toLowerCase() as Verdict;
    const verifiedBy = String(req.body?.verifiedBy || '').trim() || null;

    if (!companyApplicationId) {
      return res.status(400).json({ success: false, error: 'companyApplicationId is required' });
    }
    if (verdict !== 'verified' && verdict !== 'mismatch') {
      return res.status(400).json({ success: false, error: 'verdict must be "verified" or "mismatch"' });
    }

    const rowRes = await pool.query(
      `SELECT id, employer_uen, course_run_id
         FROM public.company_application
        WHERE id = $1`,
      [companyApplicationId]
    );
    const row = rowRes.rows[0];
    if (!row) {
      return res.status(404).json({ success: false, error: 'Company application row not found' });
    }

    if (verdict === 'mismatch') {
      await pool.query(
        `UPDATE public.company_application
            SET supporting_doc_verification_status = 'mismatch',
                supporting_doc_verified_at         = now(),
                supporting_doc_verified_by         = $2,
                supporting_doc_drive_file_id       = NULL,
                supporting_doc_drive_web_view_link = NULL,
                updated_at                         = now()
          WHERE id = $1`,
        [companyApplicationId, verifiedBy]
      );
      return res.status(200).json({ success: true, status: 'mismatch', groupSent: false });
    }

    await pool.query(
      `UPDATE public.company_application
          SET supporting_doc_verification_status = 'verified',
              supporting_doc_verified_at         = now(),
              supporting_doc_verified_by         = $2,
              updated_at                         = now()
        WHERE id = $1`,
      [companyApplicationId, verifiedBy]
    );

    // Check whether every row in the (employer_uen, course_run_id) group with
    // an invoice is now verified. Group is the unit the invoice email is
    // sent for, so partial verification of a group keeps the email gated.
    const groupRes = await pool.query(
      `SELECT id, supporting_doc_verification_status, invoice_id
         FROM public.company_application
        WHERE LOWER(TRIM(COALESCE(employer_uen, ''))) = LOWER(TRIM(COALESCE($1, '')))
          AND LOWER(TRIM(COALESCE(course_run_id, ''))) = LOWER(TRIM(COALESCE($2, '')))`,
      [row.employer_uen, row.course_run_id]
    );
    const groupRows = groupRes.rows;
    const allVerified = groupRows.length > 0 && groupRows.every(
      (r: any) => String(r.supporting_doc_verification_status || '').toLowerCase() === 'verified'
    );
    const anyHasInvoice = groupRows.some((r: any) => !!r.invoice_id);

    if (!allVerified || !anyHasInvoice) {
      return res.status(200).json({
        success: true,
        status: 'verified',
        groupSent: false,
        groupTotal: groupRows.length,
        groupVerified: groupRows.filter(
          (r: any) => String(r.supporting_doc_verification_status || '').toLowerCase() === 'verified'
        ).length,
      });
    }

    // All rows in the group are verified — trigger the invoice email. The
    // sender is idempotent: skippedAlreadySent rows are no-ops, so calling
    // this when only some invoices have been previously sent is safe.
    const groupIds = groupRows.map((r: any) => String(r.id));
    let emailSummary: any = null;
    try {
      const { sendCompanyApplicationInvoiceEmails } = await import('../../../lib/quickbooks/sendCompanyApplicationInvoiceEmails');
      emailSummary = await sendCompanyApplicationInvoiceEmails(groupIds);
    } catch (err) {
      console.warn('[ca-verify-and-send] invoice email send failed:', err instanceof Error ? err.message : err);
      return res.status(200).json({
        success: true,
        status: 'verified',
        groupSent: false,
        emailError: err instanceof Error ? err.message : String(err),
      });
    }

    // groupSent is true only when the email actually fired. If the master
    // toggle is OFF, the helper returns toggleDisabled and skips the send —
    // surface that state so the UI can show "held in test mode" instead of
    // a misleading "email released" success message.
    const heldInTestMode = !!emailSummary?.toggleDisabled;
    return res.status(200).json({
      success: true,
      status: 'verified',
      groupSent: !heldInTestMode,
      heldInTestMode,
      emailSummary,
    });
  } catch (err: any) {
    console.error('ca-verify-and-send error:', err);
    return res.status(500).json({
      success: false,
      error: err instanceof Error ? err.message : 'Failed to verify and send',
    });
  }
}
