import type { NextApiRequest, NextApiResponse } from 'next';
import pool from '@/lib/db';
import { ensureInvoiceJobsTable } from '@/lib/services/invoiceJobs';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') {
    return res.status(405).json({ success: false, error: 'Method not allowed' });
  }

  const enrolmentId = typeof req.query.enrolmentId === 'string' ? req.query.enrolmentId : null;
  const batchId = typeof req.query.batchId === 'string' ? req.query.batchId : null;

  await ensureInvoiceJobsTable();

  if (enrolmentId) {
    const r = await pool.query(
      `SELECT * FROM public.invoice_jobs
       WHERE LOWER(TRIM(COALESCE(enrolment_id, ''))) = LOWER(TRIM($1::text))
       ORDER BY updated_at DESC
       LIMIT 1`,
      [enrolmentId]
    );
    return res.status(200).json({ success: true, data: r.rows[0] ?? null });
  }

  if (batchId) {
    const r = await pool.query(
      `SELECT status, count(*)::int AS count
       FROM public.invoice_jobs
       WHERE batch_id = $1
       GROUP BY status`,
      [batchId]
    );
    return res.status(200).json({ success: true, data: r.rows });
  }

  const r = await pool.query(
    `SELECT status, count(*)::int AS count
     FROM public.invoice_jobs
     GROUP BY status`
  );
  return res.status(200).json({ success: true, data: r.rows });
}

