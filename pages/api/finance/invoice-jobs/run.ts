import type { NextApiRequest, NextApiResponse } from 'next';
import pool from '@/lib/db';
import { ensureInvoiceJobsTable } from '@/lib/services/invoiceJobs';
import { processInvoiceJob } from '@/lib/services/invoiceJobProcessor';

function requireRunnerToken(req: NextApiRequest) {
  const expected = process.env.INVOICE_JOBS_RUNNER_TOKEN;
  if (!expected) return; // dev-friendly default
  const got = req.headers['x-job-token'];
  if (got !== expected) throw new Error('Unauthorized');
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ success: false, error: 'Method not allowed' });
  }

  try {
    requireRunnerToken(req);
  } catch (e: any) {
    return res.status(401).json({ success: false, error: e.message || 'Unauthorized' });
  }

  const limit = Math.max(1, Math.min(10, Number(req.body?.limit ?? 3)));

  await ensureInvoiceJobsTable();
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const pick = await client.query(
      `SELECT id
       FROM public.invoice_jobs
       WHERE status IN ('queued', 'failed')
         AND attempts < 5
       ORDER BY created_at ASC
       FOR UPDATE SKIP LOCKED
       LIMIT $1`,
      [limit]
    );

    const ids: string[] = pick.rows.map((r: any) => r.id);
    if (ids.length === 0) {
      await client.query('COMMIT');
      return res.status(200).json({ success: true, picked: 0, processed: 0, results: [] });
    }

    await client.query(
      `UPDATE public.invoice_jobs
       SET status = 'running',
           attempts = attempts + 1,
           last_attempt_at = now(),
           last_error = null,
           updated_at = now()
       WHERE id = ANY($1)`,
      [ids]
    );

    await client.query('COMMIT');

    const results: Array<{ id: string; ok: boolean; error?: string }> = [];
    for (const id of ids) {
      try {
        await processInvoiceJob(id);
        results.push({ id, ok: true });
      } catch (e: any) {
        const msg = e?.message ? String(e.message) : 'Job failed';
        await pool.query(
          `UPDATE public.invoice_jobs
           SET status = 'failed', last_error = $2, updated_at = now()
           WHERE id = $1`,
          [id, msg]
        );
        results.push({ id, ok: false, error: msg });
      }
    }

    return res.status(200).json({
      success: true,
      picked: ids.length,
      processed: results.filter(r => r.ok).length,
      results,
    });
  } catch (e: any) {
    await client.query('ROLLBACK').catch(() => {});
    return res.status(500).json({ success: false, error: e.message || 'Internal server error' });
  } finally {
    client.release();
  }
}

