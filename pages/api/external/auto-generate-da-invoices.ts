import type { NextApiRequest, NextApiResponse } from 'next';
import crypto from 'crypto';
import pool from '../../../lib/db';
import { processDirectApplication } from '../../../lib/autoEnrolDirectApplications';
import { ensureInvoiceJobsTable } from '../../../lib/services/invoiceJobs';
import { qboSendInvoice } from '../../../lib/services/qboInvoiceService';

export const config = {
  maxDuration: 300,
  api: { responseLimit: false },
};

const SCHEDULER_SECRET = process.env.NEXT_PUBLIC_SCHEDULER_SECRET || 'local-dev-fallback';

/**
 * Scheduled sweep — finds every confirmed, SSG-enrolled Direct Application that
 * is still missing its main tax invoice, Grant invoice, or SFC invoice, and
 * runs `processDirectApplication` on each with `forceInvoice: true` to bring
 * the row up to date.
 *
 * Safety net for:
 *   - DAs whose grant wasn't yet issued by SSG when the admin clicked Generate
 *     Invoice (the grant invoice step now throws with a clear error; this
 *     sweep retries once SSG has populated the data).
 *   - DAs whose pipeline failed mid-way (e.g. transient QBO error) and were
 *     left in 'failed' status.
 *   - DAs enrolled via upload/event that have `auto_generate_qb_invoice` off
 *     — we force invoicing on this scheduled path.
 *
 * Main tax invoice emails are sent once by this cron after the invoice is
 * created and synced into invoice_jobs. invoice_sent_at prevents duplicates.
 *
 * Idempotent — DAs whose invoices are all already in place are not selected.
 */

interface RunStats {
  totalCandidates: number;
  totalSucceeded: number;
  totalFailed: number;
  totalSkipped: number;
  emailsSent: number;
  emailsFailed: number;
  failures: Array<{ applicationId: string; failedStep?: string; error?: string }>;
}

async function ensureDaInvoiceLogTable(): Promise<void> {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS auto_generate_da_invoices_log (
      id              SERIAL PRIMARY KEY,
      run_id          TEXT NOT NULL,
      created_at      TIMESTAMPTZ DEFAULT NOW(),
      application_id  TEXT,
      enrolment_id    TEXT,
      stage           TEXT NOT NULL,
      status          TEXT NOT NULL,
      failed_step     TEXT,
      message         TEXT,
      error_message   TEXT
    )
  `);
  await pool.query(
    `CREATE INDEX IF NOT EXISTS idx_auto_generate_da_invoices_log_run
     ON auto_generate_da_invoices_log(run_id, created_at DESC)`
  );
}

async function logDaInvoiceResult(
  runId: string,
  stage: 'invoice' | 'email',
  status: 'success' | 'skipped' | 'error',
  fields: {
    applicationId?: string | null;
    enrolmentId?: string | null;
    failedStep?: string | null;
    message?: string | null;
    errorMessage?: string | null;
  }
): Promise<void> {
  try {
    await ensureDaInvoiceLogTable();

    await pool.query(
      `INSERT INTO auto_generate_da_invoices_log
         (run_id, application_id, enrolment_id, stage, status, failed_step, message, error_message)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [
        runId,
        fields.applicationId || null,
        fields.enrolmentId || null,
        stage,
        status,
        fields.failedStep || null,
        fields.message || null,
        fields.errorMessage || null,
      ]
    );
  } catch (err) {
    console.error('[auto-generate-da-invoices] Failed to log result:', err);
  }
}

async function sendPendingDaMainInvoiceEmails(runId: string): Promise<{
  sent: number;
  failed: number;
  failures: Array<{ applicationId: string; failedStep: string; error: string }>;
}> {
  await ensureInvoiceJobsTable();

  // Respect the master toggle from the DA admin view. If the admin has
  // turned off "Send invoice email to learner", the scheduled sweep must
  // also stay silent — otherwise testing in production isn't safe.
  const toggleRes = await pool.query(
    `SELECT COALESCE(auto_send_invoice_email, false) AS enabled FROM training_provider LIMIT 1`
  );
  const emailEnabled = !!toggleRes.rows[0]?.enabled;
  if (!emailEnabled) {
    console.log(
      `[auto-generate-da-invoices] auto_send_invoice_email is OFF — skipping pending-email batch (run ${runId})`
    );
    return { sent: 0, failed: 0, failures: [] };
  }

  const pending = await pool.query(
    `SELECT
        da.application_id,
        ij.enrolment_id,
        ij.qbo_invoice_id,
        ij.learner_email
     FROM public.invoice_jobs ij
     INNER JOIN public.da_application da
       ON LOWER(TRIM(COALESCE(da.enrolment_id::text, ''))) = LOWER(TRIM(COALESCE(ij.enrolment_id::text, '')))
      AND TRIM(COALESCE(da.invoice_id::text, '')) = TRIM(COALESCE(ij.qbo_invoice_id::text, ''))
     WHERE ij.status = 'done'
       AND ij.qbo_invoice_id IS NOT NULL
       AND TRIM(ij.qbo_invoice_id) <> ''
       AND ij.invoice_sent_at IS NULL
       AND ij.learner_email IS NOT NULL
       AND TRIM(ij.learner_email) <> ''
       AND LOWER(COALESCE(da.application_status, '')) IN ('confirm application', 'confirmed')
     ORDER BY ij.updated_at ASC
     LIMIT 50`
  );

  let sent = 0;
  let failed = 0;
  const failures: Array<{ applicationId: string; failedStep: string; error: string }> = [];

  for (const row of pending.rows) {
    const invoiceId = String(row.qbo_invoice_id || '').trim();
    const learnerEmail = String(row.learner_email || '').trim();
    const enrolmentId = String(row.enrolment_id || '').trim();
    const applicationId = String(row.application_id || enrolmentId || invoiceId);

    try {
      await qboSendInvoice(undefined, invoiceId, learnerEmail);
      await pool.query(
        `UPDATE public.invoice_jobs
         SET invoice_sent_at = now(),
             invoice_sent_to = $2,
             updated_at = now()
         WHERE qbo_invoice_id = $1
           AND LOWER(TRIM(COALESCE(enrolment_id::text, ''))) = LOWER(TRIM($3::text))`,
        [invoiceId, learnerEmail, enrolmentId]
      );
      sent++;
      await logDaInvoiceResult(runId, 'email', 'success', {
        applicationId,
        enrolmentId,
        message: `Invoice email sent to ${learnerEmail}`,
      });
    } catch (err) {
      failed++;
      const errMsg = err instanceof Error ? err.message : String(err);
      failures.push({
        applicationId,
        failedStep: 'invoice_email',
        error: errMsg,
      });
      await logDaInvoiceResult(runId, 'email', 'error', {
        applicationId,
        enrolmentId,
        failedStep: 'invoice_email',
        errorMessage: errMsg,
      });
      console.error(`[auto-generate-da-invoices] Failed to send invoice ${invoiceId} to ${learnerEmail}:`, err);
    }
  }

  return { sent, failed, failures };
}

// ── Global in-flight lock ─────────────────────────────────────────────────────
const g = globalThis as unknown as { __daInvoicesRunning?: boolean };
if (g.__daInvoicesRunning === undefined) g.__daInvoicesRunning = false;

export async function runAutomation(): Promise<
  | { success: true; runId: string; stats: RunStats }
  | { success: false; runId: string; error: string }
> {
  if (g.__daInvoicesRunning) {
    console.warn('[auto-generate-da-invoices] Another run is already in progress — skipping');
    return { success: false, runId: '', error: 'Skipped — another run is already in progress' };
  }
  g.__daInvoicesRunning = true;
  try {
    return await _runAutomationInner();
  } finally {
    g.__daInvoicesRunning = false;
  }
}

async function _runAutomationInner(): Promise<
  | { success: true; runId: string; stats: RunStats }
  | { success: false; runId: string; error: string }
> {
  const runId = crypto.randomUUID();
  const startedAt = new Date();
  console.log(`[auto-generate-da-invoices] Starting run ${runId} at ${startedAt.toISOString()}`);

  try {
    await ensureDaInvoiceLogTable();

    // Eligibility: confirmed DA, already enrolled to SSG (otherwise invoice
    // generation would be blocked anyway), and at least one invoice missing.
    const result = await pool.query(
      `SELECT id, application_id
         FROM da_application
        WHERE LOWER(COALESCE(application_status, '')) IN ('confirm application', 'confirmed')
          AND enrolment_id IS NOT NULL
          AND TRIM(enrolment_id) <> ''
          AND (
                invoice_id IS NULL
             OR (grant_id IS NOT NULL AND TRIM(grant_id) <> '' AND grant_invoice_id IS NULL)
             OR (
                  skillsfuture_credit_claim_id IS NOT NULL
              AND TRIM(skillsfuture_credit_claim_id) <> ''
              AND sfc_invoice_id IS NULL
                )
              )
        ORDER BY created_at ASC`
    );

    const targets = result.rows;
    console.log(`[auto-generate-da-invoices] Found ${targets.length} DA row(s) needing invoice work.`);

    const stats: RunStats = {
      totalCandidates: targets.length,
      totalSucceeded: 0,
      totalFailed: 0,
      totalSkipped: 0,
      emailsSent: 0,
      emailsFailed: 0,
      failures: [],
    };

    for (const row of targets) {
      try {
        const res = await processDirectApplication(row.id, undefined, {
          forceInvoice: true,
          suppressInvoiceEmail: true,
        });
        if (res.success) {
          stats.totalSucceeded++;
          await logDaInvoiceResult(runId, 'invoice', 'success', {
            applicationId: row.application_id || row.id,
            enrolmentId: res.enrolmentId || null,
            message: res.invoiceId
              ? `Invoice generated or already present: ${res.invoiceId}`
              : 'Invoice work completed',
          });
        } else if (res.failedStep === 'load') {
          // Row wasn't in a processable state — count as skipped rather than failed.
          stats.totalSkipped++;
          await logDaInvoiceResult(runId, 'invoice', 'skipped', {
            applicationId: row.application_id || row.id,
            enrolmentId: res.enrolmentId || null,
            failedStep: res.failedStep,
            message: res.error || 'Skipped by pipeline',
          });
        } else {
          stats.totalFailed++;
          stats.failures.push({
            applicationId: row.application_id || row.id,
            failedStep: res.failedStep,
            error: res.error,
          });
          await logDaInvoiceResult(runId, 'invoice', 'error', {
            applicationId: row.application_id || row.id,
            enrolmentId: res.enrolmentId || null,
            failedStep: res.failedStep,
            errorMessage: res.error || 'Invoice generation failed',
          });
        }
      } catch (err) {
        const errMsg = err instanceof Error ? err.message : String(err);
        stats.totalFailed++;
        stats.failures.push({
          applicationId: row.application_id || row.id,
          failedStep: 'unknown',
          error: errMsg,
        });
        await logDaInvoiceResult(runId, 'invoice', 'error', {
          applicationId: row.application_id || row.id,
          failedStep: 'unknown',
          errorMessage: errMsg,
        });
        console.error(`[auto-generate-da-invoices] ${row.id} threw unexpectedly:`, err);
      }
    }

    const emailResult = await sendPendingDaMainInvoiceEmails(runId);
    stats.emailsSent = emailResult.sent;
    stats.emailsFailed = emailResult.failed;
    stats.totalFailed += emailResult.failed;
    stats.failures.push(...emailResult.failures);

    const elapsedMs = Date.now() - startedAt.getTime();
    console.log(
      `[auto-generate-da-invoices] Run ${runId} completed in ${elapsedMs}ms. ` +
        `${stats.totalSucceeded} succeeded, ${stats.totalSkipped} skipped, ${stats.totalFailed} failed, ` +
        `${stats.emailsSent} invoice email(s) sent.`
    );

    return { success: true, runId, stats };
  } catch (error: any) {
    console.error('[auto-generate-da-invoices] Fatal error:', error);
    return { success: false, runId, error: error?.message || 'Internal processing error' };
  }
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ success: false, message: 'Method not allowed' });
  }

  const { authKey } = req.body || {};
  const headerKey = req.headers['x-api-key'];
  const externalKey = process.env.EXTERNAL_API_KEY_FOR_CLAWDBOT;

  const authorised =
    authKey === SCHEDULER_SECRET || (externalKey && headerKey === externalKey);

  if (!authorised) {
    return res.status(401).json({ success: false, message: 'Unauthorized' });
  }

  const result = await runAutomation();
  return res.status(result.success ? 200 : 500).json(result);
}
