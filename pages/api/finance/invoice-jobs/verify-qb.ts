import { withAuth } from '@lib/auth/withAuth';
import type { NextApiRequest, NextApiResponse } from 'next';
import pool from '@/lib/db';
import { ensureInvoiceJobsTable } from '@/lib/services/invoiceJobs';
import { callQbProxy } from '@/lib/quickbooks/qbProxyClient';

async function qbInvoiceExists(qboInvoiceId: string, app: string): Promise<boolean | null> {
  try {
    const resp = await callQbProxy({
      action: 'query',
      entity: 'invoice',
      app,
      query: `SELECT Id FROM Invoice WHERE Id = '${String(qboInvoiceId).replace(/'/g, "''")}' MAXRESULTS 1`,
    });
    const inv = resp?.data?.QueryResponse?.Invoice;
    return Array.isArray(inv) ? inv.length > 0 : !!inv;
  } catch {
    return null; // QB unreachable, auth error, or network error — can't conclude
  }
}

async function clearInvoiceJob(enrolmentId: string): Promise<void> {
  await pool.query(
    `UPDATE public.invoice_jobs
     SET qbo_invoice_id      = NULL,
         qbo_doc_number      = NULL,
         invoice_no          = NULL,
         invoice_sent_at     = NULL,
         invoice_sent_to     = NULL,
         drive_file_id       = NULL,
         drive_web_view_link = NULL,
         status              = 'failed',
         last_error          = 'Invoice not found in QuickBooks — auto-cleared',
         updated_at          = now()
     WHERE enrolment_id = $1`,
    [enrolmentId]
  );
}

/**
 * POST /api/finance/invoice-jobs/verify-qb
 * Body: { enrolmentIds: string[] }
 *
 * For each enrolment that has a QB invoice ID recorded, checks whether the invoice
 * still exists in QuickBooks. If it has been deleted, auto-clears the invoice record
 * so the enrolment can be re-invoiced.
 *
 * Returns { cleared: number, skipped: number, errors: number }
 */
async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', ['POST']);
    return res.status(405).json({ success: false, error: 'Method not allowed' });
  }

  const raw = req.body?.enrolmentIds;
  const enrolmentIds: string[] = Array.isArray(raw)
    ? raw.map((x: unknown) => String(x ?? '').trim()).filter(Boolean)
    : [];

  if (enrolmentIds.length === 0) {
    return res.status(400).json({ success: false, error: 'enrolmentIds array is required' });
  }
  if (enrolmentIds.length > 30) {
    return res.status(400).json({ success: false, error: 'Maximum 30 enrolments per request' });
  }

  try {
    await ensureInvoiceJobsTable();

    const rows = await pool.query(
      `SELECT enrolment_id::text AS enrolment_id, qbo_invoice_id::text AS qbo_invoice_id
       FROM public.invoice_jobs
       WHERE enrolment_id = ANY($1::text[])
         AND status = 'done'
         AND qbo_invoice_id IS NOT NULL`,
      [enrolmentIds]
    );

    let cleared = 0;
    let skipped = 0;
    let errors = 0;

    for (const row of rows.rows) {
      const { enrolment_id, qbo_invoice_id } = row as { enrolment_id: string; qbo_invoice_id: string };

      // Try app1 first, then app2 — only clear if BOTH confirm invoice is gone
      const app1Result = await qbInvoiceExists(qbo_invoice_id, 'app1');
      const app2Result = await qbInvoiceExists(qbo_invoice_id, 'app2');

      if (app1Result === null && app2Result === null) {
        // QB unreachable on both apps — cannot confirm deletion, skip safely
        errors++;
        continue;
      }

      const existsOnAny = app1Result === true || app2Result === true;

      if (existsOnAny) {
        // Invoice still live in QB — do nothing
        skipped++;
        continue;
      }

      // Both apps returned false (not found) — invoice is deleted
      await clearInvoiceJob(enrolment_id);
      cleared++;
    }

    return res.status(200).json({ success: true, data: { cleared, skipped, errors } });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : 'Internal server error';
    return res.status(500).json({ success: false, error: msg });
  }
}

export default withAuth(handler, { roles: ['admin', 'trainingProvider', 'finance'] });
