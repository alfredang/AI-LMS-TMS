import pool from '../db';
import { ensureInvoiceJobsTable } from './invoiceJobs';
import { processInvoiceJob } from './invoiceJobProcessor';

/**
 * Picks queued/failed invoice jobs (Confirmed enrolments only), marks running, processes each.
 * Oldest jobs first (FIFO). Used by POST /api/finance/invoice-jobs/run and auto-trigger after enqueue.
 */
export async function runPendingInvoiceJobs(limit: number): Promise<{
  picked: number;
  processed: number;
  results: Array<{ id: string; ok: boolean; error?: string }>;
}> {
  const cap = Math.max(1, Math.min(10, limit));

  await ensureInvoiceJobsTable();
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    await client.query(
      `UPDATE public.invoice_jobs ij
       SET status = 'failed',
           last_error = 'Skipped: enrolment is not Confirmed — invoice not sent for cancelled or removed enrolments.',
           updated_at = now()
       FROM enrollment e
       WHERE ij.user_id = e.user_id
         AND LOWER(TRIM(COALESCE(ij.enrolment_id, ''))) = LOWER(TRIM(COALESCE(e.enrolment_id, '')))
         AND ij.status IN ('queued', 'failed')
         AND COALESCE(LOWER(TRIM(e.enrolment_status)), '') <> 'confirmed'`
    );

    const pick = await client.query(
      `SELECT ij.id
       FROM public.invoice_jobs ij
       INNER JOIN enrollment e
         ON ij.user_id = e.user_id
         AND LOWER(TRIM(COALESCE(ij.enrolment_id, ''))) = LOWER(TRIM(COALESCE(e.enrolment_id, '')))
       WHERE ij.status IN ('queued', 'failed')
         AND ij.attempts < 15
         AND COALESCE(LOWER(TRIM(e.enrolment_status)), '') = 'confirmed'
       ORDER BY ij.created_at ASC
       FOR UPDATE OF ij SKIP LOCKED
       LIMIT $1`,
      [cap]
    );

    const ids: string[] = pick.rows.map((r: { id: string }) => r.id);
    if (ids.length === 0) {
      await client.query('COMMIT');
      return { picked: 0, processed: 0, results: [] };
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
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : 'Job failed';
        await pool.query(
          `UPDATE public.invoice_jobs
           SET status = 'failed', last_error = $2, updated_at = now()
           WHERE id = $1`,
          [id, msg]
        );
        results.push({ id, ok: false, error: msg });
      }
    }

    return {
      picked: ids.length,
      processed: results.filter(r => r.ok).length,
      results,
    };
  } catch (e) {
    await client.query('ROLLBACK').catch(() => {});
    throw e;
  } finally {
    client.release();
  }
}
