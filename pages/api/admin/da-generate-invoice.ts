import type { NextApiRequest, NextApiResponse } from 'next';
import pool from '../../../lib/db';
import { createDirectApplicationInvoice, type DaApplicationForInvoice } from '../../../lib/quickbooks/createDirectApplicationInvoice';

/**
 * POST /api/admin/da-generate-invoice
 *
 * Body: { applicationIds: string[] }
 *
 * For each selected DA application that doesn't already have an invoice,
 * creates a QuickBooks invoice and saves the invoice_id on the row.
 *
 * Returns per-row results so the UI can update checkboxes + invoice #.
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
    const rows = await pool.query(
      `SELECT id, trainee_name, trainee_email, course_title, course_reference_number,
              COALESCE(course_start_date::text, '') as course_start_date,
              full_course_fee, skillsfuture_subsidy, skillsfuture_credit,
              qb_customer_ref, invoice_id
       FROM da_application
       WHERE id = ANY($1::uuid[])`,
      [applicationIds]
    );

    const results: { id: string; success: boolean; invoiceId?: string; error?: string }[] = [];

    for (const row of rows.rows) {
      if (row.invoice_id && String(row.invoice_id).trim() !== '') {
        results.push({ id: row.id, success: true, invoiceId: row.invoice_id }); // already has invoice
        continue;
      }

      try {
        const forInvoice: DaApplicationForInvoice = {
          id: row.id,
          trainee_name: row.trainee_name,
          trainee_email: row.trainee_email,
          course_title: row.course_title,
          course_reference_number: row.course_reference_number,
          course_start_date: row.course_start_date ? new Date(row.course_start_date).toISOString().slice(0, 10) : null,
          full_course_fee: row.full_course_fee,
          skillsfuture_subsidy: row.skillsfuture_subsidy,
          skillsfuture_credit: row.skillsfuture_credit,
          qb_customer_ref: row.qb_customer_ref,
        };

        const created = await createDirectApplicationInvoice(forInvoice);

        await pool.query(
          `UPDATE da_application SET invoice_id = $1, qb_customer_ref = $2, updated_at = NOW() WHERE id = $3`,
          [created.invoiceId, created.customerRef, row.id]
        );

        results.push({ id: row.id, success: true, invoiceId: created.invoiceId });
      } catch (err: any) {
        results.push({ id: row.id, success: false, error: err.message || 'Invoice creation failed' });
      }
    }

    return res.status(200).json({ success: true, results });
  } catch (err) {
    console.error('❌ da-generate-invoice error:', err);
    return res.status(500).json({ success: false, error: err instanceof Error ? err.message : 'Internal server error' });
  }
}
