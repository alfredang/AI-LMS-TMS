import { withAuth } from '@lib/auth/withAuth';
import type { NextApiRequest, NextApiResponse } from 'next';
import pool from '../../../lib/db';
import { ensureCompanyApplicationsTable } from '../../../lib/companyApplicationsTable';

/**
 * POST /api/admin/ca-toggle-manual-billing
 *
 * Body: { applicationId: string, billedManually: boolean, invoiceRef?: string }
 *
 * Marks a learner as billed by hand — Finance is adding them to an invoice that
 * already exists, in QuickBooks, so the LMS must never invoice them itself.
 *
 * The flag is the whole point of the "Enrol only" choice. Without it the row is
 * just a learner with no invoice_id, which is indistinguishable from one that
 * has not been billed yet: the View page keeps flagging them and the next
 * Generate Invoice click cuts exactly the duplicate the admin was avoiding.
 *
 * `invoiceRef` is the DocNumber they are being added to. It is not required —
 * an admin may not have decided yet — but when given it is what the learner's
 * grant invoice cites as its PO#, keeping that cross-reference correct.
 *
 * Refuses on a row we have already invoiced: that learner is on an LMS-issued
 * invoice, and quietly flagging it as hand-billed would hide a real document.
 */
async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ success: false, error: 'Method not allowed' });
  }

  const { applicationId, billedManually, invoiceRef } = req.body || {};
  const id = String(applicationId || '').trim();
  if (!id) {
    return res.status(400).json({ success: false, error: 'applicationId is required' });
  }
  if (typeof billedManually !== 'boolean') {
    return res.status(400).json({ success: false, error: 'billedManually must be a boolean' });
  }
  const ref = String(invoiceRef || '').trim();

  try {
    await ensureCompanyApplicationsTable();

    const existing = await pool.query(
      `SELECT id, COALESCE(invoice_id, '') AS invoice_id, COALESCE(invoice_doc_number, '') AS doc_number
         FROM public.company_application
        WHERE id = $1`,
      [id]
    );
    if (existing.rows.length === 0) {
      return res.status(404).json({ success: false, error: 'Row not found' });
    }
    if (billedManually && existing.rows[0].invoice_id) {
      return res.status(409).json({
        success: false,
        error: `This learner is already on invoice ${existing.rows[0].doc_number || existing.rows[0].invoice_id}. Delete or void that invoice in QuickBooks first if they should be billed by hand instead.`,
      });
    }

    const result = await pool.query(
      `UPDATE public.company_application
          SET billed_manually            = $1,
              billed_manually_invoice_ref = CASE WHEN $1 THEN NULLIF($2, '') ELSE NULL END,
              -- Choosing one late joiner path clears the other; they are
              -- alternatives, never both.
              replace_group_invoice      = CASE WHEN $1 THEN false ELSE replace_group_invoice END,
              updated_at                 = now()
        WHERE id = $3
        RETURNING id, billed_manually, billed_manually_invoice_ref`,
      [billedManually, ref, id]
    );

    return res.status(200).json({
      success: true,
      applicationId: result.rows[0].id,
      billedManually: !!result.rows[0].billed_manually,
      invoiceRef: result.rows[0].billed_manually_invoice_ref || null,
    });
  } catch (err) {
    console.error('[ca-toggle-manual-billing] error:', err);
    return res.status(500).json({
      success: false,
      error: err instanceof Error ? err.message : 'Internal server error',
    });
  }
}

export default withAuth(handler, { roles: ['admin', 'trainingProvider', 'developer'] });
