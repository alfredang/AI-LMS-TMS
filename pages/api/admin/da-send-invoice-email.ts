import type { NextApiRequest, NextApiResponse } from 'next';
import pool from '../../../lib/db';

const BASE_URL = process.env.QBO_PROXY_BASE_URL || process.env.NEXT_PUBLIC_BASE_URL || 'http://localhost:3000';

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
        // Read the current invoice so we have SyncToken (required for update)
        const readResp = await fetch(`${BASE_URL}/api/quickbooks/proxy`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action: 'read', entity: 'invoice', id: row.invoice_id }),
        });
        const readData = await readResp.json().catch(() => null);
        const invoice = readData?.data?.Invoice;
        if (invoice?.SyncToken) {
          // Patch BillEmail to learner's email before sending
          await fetch(`${BASE_URL}/api/quickbooks/proxy`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              action: 'create',
              entity: 'invoice',
              body: { Id: row.invoice_id, SyncToken: invoice.SyncToken, BillEmail: { Address: row.trainee_email }, sparse: true },
            }),
          });
        }

        const resp = await fetch(`${BASE_URL}/api/quickbooks/proxy`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action: 'send', entity: 'invoice', id: row.invoice_id, sendTo: row.trainee_email }),
        });
        const data = await resp.json().catch(() => null);
        if (!resp.ok || !data?.success) throw new Error(data?.error || `QB send returned ${resp.status}`);
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
