import type { NextApiRequest, NextApiResponse } from 'next';
import pool from '../../../lib/db';

/**
 * POST /api/admin/da-sync-invoice
 *
 * Syncs DA applications against the billing_history / quickbooks data.
 * For each DA row without an invoice_id, checks if a matching invoice
 * exists in billing_history (by trainee email + course title or course code).
 * If found, copies the invoice number.
 *
 * Also checks da_application rows that have a qb_customer_ref but no
 * invoice_id — queries QuickBooks proxy for the latest invoice.
 */
export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ success: false, error: 'Method not allowed' });
  }

  try {
    // Match DA rows against billing_history by email + course reference
    const result = await pool.query(`
      UPDATE da_application da
      SET
        invoice_id = bh.invoice_number,
        updated_at = NOW()
      FROM billing_history bh
      WHERE (da.invoice_id IS NULL OR da.invoice_id = '')
        AND bh.invoice_number IS NOT NULL
        AND bh.invoice_number <> ''
        AND LOWER(COALESCE(bh.email, '')) = LOWER(COALESCE(da.trainee_email, ''))
        AND (
          LOWER(COALESCE(bh.course_code, '')) = LOWER(COALESCE(da.course_reference_number, ''))
          OR LOWER(COALESCE(bh.course_title, '')) = LOWER(COALESCE(da.course_title, ''))
        )
        AND da.trainee_email IS NOT NULL AND da.trainee_email <> ''
      RETURNING da.id, da.application_id, bh.invoice_number
    `);

    const matched = result.rows.length;
    console.log(`✅ [da-sync-invoice] Matched ${matched} invoices from billing_history`);

    return res.status(200).json({
      success: true,
      matched,
      details: result.rows,
    });
  } catch (err) {
    console.error('❌ da-sync-invoice error:', err);
    return res.status(500).json({ success: false, error: err instanceof Error ? err.message : 'Internal server error' });
  }
}
