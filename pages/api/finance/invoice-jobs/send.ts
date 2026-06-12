import type { NextApiRequest, NextApiResponse } from 'next';
import pool from '@/lib/db';
import { ensureInvoiceJobsTable } from '@/lib/services/invoiceJobs';
import { qboSendInvoice } from '@/lib/services/qboInvoiceService';

/**
 * POST /api/finance/invoice-jobs/send
 * Body: { enrolmentIds: string[] }
 *
 * Sends the already-generated QuickBooks invoice email to the learner (manual action).
 */
export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ success: false, error: 'Method not allowed' });
  }

  const raw = req.body?.enrolmentIds;
  const enrolmentIds = Array.isArray(raw) ? raw.map((x: unknown) => String(x ?? '').trim()).filter(Boolean) : [];

  if (enrolmentIds.length === 0) {
    return res.status(400).json({ success: false, error: 'enrolmentIds array is required' });
  }
  if (enrolmentIds.length > 50) {
    return res.status(400).json({ success: false, error: 'Maximum 50 enrolments per request' });
  }

  await ensureInvoiceJobsTable();

  const results: Array<{ enrolmentId: string; ok: boolean; invoiceId?: string; error?: string }> = [];

  for (const enrolmentId of [...new Set(enrolmentIds)]) {
    try {
      const r = await pool.query(
        `SELECT qbo_invoice_id, learner_email
         FROM public.invoice_jobs
         WHERE status = 'done'
           AND LOWER(TRIM(COALESCE(enrolment_id::text, ''))) = LOWER(TRIM($1::text))
         ORDER BY updated_at DESC
         LIMIT 1`,
        [enrolmentId]
      );
      const row = r.rows[0] as { qbo_invoice_id?: string | null; learner_email?: string | null } | undefined;
      const invoiceId = String(row?.qbo_invoice_id || '').trim();
      const email = String(row?.learner_email || '').trim();

      if (!invoiceId) {
        results.push({ enrolmentId, ok: false, error: 'No completed invoice found for this enrolment yet' });
        continue;
      }
      if (!email) {
        results.push({ enrolmentId, ok: false, invoiceId, error: 'Missing learner email on invoice job' });
        continue;
      }

      await qboSendInvoice(undefined, invoiceId, email);
      await pool.query(
        `UPDATE public.invoice_jobs
         SET invoice_sent_at = now(), invoice_sent_to = $2, updated_at = now()
         WHERE status = 'done'
           AND qbo_invoice_id = $1
           AND LOWER(TRIM(COALESCE(enrolment_id::text, ''))) = LOWER(TRIM($3::text))`,
        [invoiceId, email, enrolmentId]
      );
      results.push({ enrolmentId, ok: true, invoiceId });
    } catch (e: unknown) {
      results.push({ enrolmentId, ok: false, error: e instanceof Error ? e.message : String(e) });
    }
  }

  const sent = results.filter((r) => r.ok).length;
  return res.status(200).json({
    success: true,
    results,
    summary: { total: results.length, sent, failed: results.length - sent },
  });
}

