import { withAuth } from '@lib/auth/withAuth';
import type { NextApiRequest, NextApiResponse } from 'next';
import pool from '../../../lib/db';
import { ensureInvoiceJobsTable } from '../../../lib/services/invoiceJobs';
import { qboSendInvoice } from '../../../lib/services/qboInvoiceService';

async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') return res.status(405).json({ success: false, error: 'Method not allowed' });

  const { applicationIds } = req.body || {};
  if (!Array.isArray(applicationIds) || applicationIds.length === 0) {
    return res.status(400).json({ success: false, error: 'applicationIds array is required' });
  }

  try {
    await ensureInvoiceJobsTable();

    const rows = await pool.query(
      `SELECT id, invoice_id, invoice_doc_number, enrolment_id, trainee_email, trainee_name
       FROM da_application
       WHERE id = ANY($1::uuid[])`,
      [applicationIds]
    );

    let sent = 0, failed = 0, skipped = 0;
    const failures: Array<{ id: string; applicationName?: string; error: string }> = [];
    const skippedRows: Array<{ id: string; applicationName?: string; reason: string }> = [];

    for (const row of rows.rows) {
      if (!row.invoice_id || !row.trainee_email) {
        skipped++;
        skippedRows.push({
          id: row.id,
          applicationName: row.trainee_name || undefined,
          reason: !row.invoice_id ? 'Missing invoice ID' : 'Missing learner email',
        });
        continue;
      }

      try {
        await qboSendInvoice(undefined, row.invoice_id, row.trainee_email);
        await pool.query(
          `UPDATE public.invoice_jobs
              SET invoice_sent_at = COALESCE(invoice_sent_at, now()),
                  invoice_sent_to = COALESCE(invoice_sent_to, $2),
                  invoice_no = COALESCE($3, invoice_no),
                  updated_at = now()
            WHERE (
                    NULLIF(TRIM($4::text), '') IS NOT NULL
                AND TRIM(COALESCE(qbo_invoice_id::text, '')) = TRIM($4::text)
                )
               OR (
                    NULLIF(TRIM($1::text), '') IS NOT NULL
                AND LOWER(TRIM(COALESCE(enrolment_id::text, ''))) = LOWER(TRIM($1::text))
                AND TRIM(COALESCE(qbo_invoice_id::text, '')) = ''
                )`,
          [
            row.enrolment_id || '',
            String(row.trainee_email).trim(),
            row.invoice_doc_number || null,
            String(row.invoice_id).trim(),
          ]
        );
        sent++;
        console.log(`[DA email] Sent invoice ${row.invoice_id} to ${row.trainee_email}`);
      } catch (err) {
        failed++;
        const message = err instanceof Error ? err.message : String(err);
        failures.push({ id: row.id, applicationName: row.trainee_name || undefined, error: message });
        console.warn(`[DA email] Failed for ${row.trainee_name} (${row.trainee_email}):`, message);
      }
    }

    return res.status(200).json({ success: true, sent, failed, skipped, failures, skippedRows });
  } catch (err) {
    console.error('❌ da-send-invoice-email error:', err);
    return res.status(500).json({ success: false, error: err instanceof Error ? err.message : 'Internal server error' });
  }
}

export default withAuth(handler, { roles: ['admin', 'trainingProvider', 'developer'] });
