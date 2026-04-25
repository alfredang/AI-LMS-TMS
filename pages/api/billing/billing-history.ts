import type { NextApiRequest, NextApiResponse } from 'next';
import pool from '../../../lib/db';
import { BILLING_ENR_NORM_SQL } from '../../../lib/billing/canonicalEnrolmentRef';
import { ensureInvoiceJobsTable } from '../../../lib/services/invoiceJobs';

/**
 * GET /api/billing/billing-history?userId=xxx
 * Returns all billing documents for a learner from their enrollments.
 * Each enrollment can have: pro_forma_url, company_invoice_url, personal_invoice_url, receipt_url
 * Each document type has its own invoice number column.
 */
export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') {
    return res.status(405).json({ success: false, error: 'Method not allowed' });
  }

  const { userId } = req.query;
  if (!userId || typeof userId !== 'string') {
    return res.status(400).json({ success: false, error: 'userId is required' });
  }

  try {
    // Ensure proforma_invoice_number column exists
    await pool.query('ALTER TABLE enrollment ADD COLUMN IF NOT EXISTS proforma_invoice_number TEXT');
    await ensureInvoiceJobsTable();

    const result = await pool.query(
      `SELECT
        e.id                        AS enrollment_id,
        e.enrolment_id,
        e.enrolment_date,
        e.pro_forma_url,
        e.proforma_invoice_number,
        c.title                     AS course_title,
        c.course_code,
        cr.course_run_id,
        ij.qbo_invoice_id,
        ij.invoice_no,
        ij.qbo_doc_number,
        ij.drive_web_view_link,
        ij.drive_file_id
      FROM enrollment e
      JOIN app_user u   ON u.id = e.user_id
      JOIN course_run cr ON cr.id = e.course_run_id
      JOIN course c     ON c.id = e.course_id
      LEFT JOIN LATERAL (
        SELECT inv.qbo_invoice_id, inv.invoice_no, inv.qbo_doc_number, inv.drive_web_view_link, inv.drive_file_id
        FROM public.invoice_jobs inv
        WHERE inv.status = 'done'
          AND (
            inv.user_id = e.user_id
            OR LOWER(TRIM(COALESCE(inv.learner_email, ''))) = LOWER(TRIM(COALESCE(u.email::text, '')))
          )
          AND (
            LOWER(TRIM(COALESCE(inv.enrolment_id::text, ''))) = LOWER(TRIM(COALESCE(e.enrolment_id::text, '')))
            OR LOWER(TRIM(COALESCE(inv.enrolment_id::text, ''))) = (${BILLING_ENR_NORM_SQL})
          )
        ORDER BY inv.updated_at DESC
        LIMIT 1
      ) ij ON true
      WHERE u.id = $1
        AND (e.enrolment_status IS NULL OR e.enrolment_status NOT IN ('Admin Removed', 'Cancelled'))
      ORDER BY e.enrolment_date DESC NULLS LAST`,
      [userId]
    );

    // Expand each enrollment into individual document rows
    const rows: any[] = [];
    for (const enr of result.rows) {
      const base = {
        enrollment_id: enr.enrollment_id,
        enrolment_id: enr.enrolment_id,
        course_title: enr.course_title,
        course_code: enr.course_code,
        course_run_id: enr.course_run_id,
        enrolment_date: enr.enrolment_date,
      };

      if (enr.pro_forma_url) {
        rows.push({
          ...base,
          type: 'Proforma Invoice',
          document_url: enr.pro_forma_url,
          invoice_number: enr.proforma_invoice_number || null,
          status: 'Issued',
        });
      }

      const invoiceNumber = (enr.invoice_no || enr.qbo_doc_number || enr.qbo_invoice_id || null) as string | null;
      const hasQbInvoice =
        !!enr.qbo_invoice_id || !!enr.drive_web_view_link || !!enr.drive_file_id;
      if (hasQbInvoice) {
        rows.push({
          ...base,
          type: 'Personal Invoice',
          document_url: enr.drive_web_view_link || null,
          invoice_number: invoiceNumber,
          status: 'Issued',
          invoice_pdf_ready: true,
        });
      }

      // No documents yet — show pending row
      if (!enr.pro_forma_url && !hasQbInvoice) {
        rows.push({
          ...base,
          type: '—',
          document_url: null,
          invoice_number: null,
          status: 'Pending',
        });
      }
    }

    const proformaCount = rows.filter(r => r.type === 'Proforma Invoice').length;
    const invoiceCount = rows.filter(r => r.type === 'Personal Invoice' || r.type === 'Company Invoice').length;
    const receiptCount = 0; // Receipts not yet implemented

    return res.status(200).json({
      success: true,
      data: rows,
      summary: { proformaCount, invoiceCount, receiptCount },
    });
  } catch (error: any) {
    console.error('[billing-history] Error:', error);
    return res.status(500).json({ success: false, error: 'Internal server error' });
  }
}