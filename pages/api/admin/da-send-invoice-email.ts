import type { NextApiRequest, NextApiResponse } from 'next';
import pool from '../../../lib/db';
import {
  qboGetDefaultInvoiceEmailFields,
  qboReadInvoice,
  qboSendInvoice,
  qboSparseUpdateInvoice,
} from '../../../lib/services/qboInvoiceService';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') return res.status(405).json({ success: false, error: 'Method not allowed' });

  const { applicationIds } = req.body || {};
  if (!Array.isArray(applicationIds) || applicationIds.length === 0) {
    return res.status(400).json({ success: false, error: 'applicationIds array is required' });
  }

  try {
    const rows = await pool.query(
      `SELECT id, invoice_id, trainee_email, trainee_name
       FROM da_application
       WHERE id = ANY($1::uuid[])`,
      [applicationIds]
    );

    let sent = 0, failed = 0, skipped = 0;

    for (const row of rows.rows) {
      if (!row.invoice_id || !row.trainee_email) { skipped++; continue; }

      try {
        const invoice = await qboReadInvoice(undefined, row.invoice_id);
        if (invoice.syncToken) {
          await qboSparseUpdateInvoice(undefined, row.invoice_id, invoice.syncToken, {
            BillEmail: { Address: row.trainee_email },
            ...(await qboGetDefaultInvoiceEmailFields(undefined)),
          });
        }

        await qboSendInvoice(undefined, row.invoice_id, row.trainee_email);
        sent++;
        console.log(`[DA email] Sent invoice ${row.invoice_id} to ${row.trainee_email}`);
      } catch (err) {
        failed++;
        console.warn(`[DA email] Failed for ${row.trainee_name} (${row.trainee_email}):`, err instanceof Error ? err.message : err);
      }
    }

    return res.status(200).json({ success: true, sent, failed, skipped });
  } catch (err) {
    console.error('❌ da-send-invoice-email error:', err);
    return res.status(500).json({ success: false, error: err instanceof Error ? err.message : 'Internal server error' });
  }
}
