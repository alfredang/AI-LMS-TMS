import pool from '../db';
import { isEnrolmentEligibleForAutoInvoice } from './invoiceEligibility';
import { qboReadInvoice, qboDeleteInvoice, qboFindInvoiceByDocNumber } from './qboInvoiceService';

export type InvoiceJobStatus = 'queued' | 'running' | 'done' | 'failed' | 'cancelled';

export interface EnqueueInvoiceJobInput {
  enrolmentId: string; // SSG ENR-...
  userId: string;
  learnerEmail: string;
  courseCode: string; // SKU / TGS-...
  batchId?: string | null;
}

export interface InvoiceJobRow {
  id: string;
  batch_id: string | null;
  status: InvoiceJobStatus;
  enrolment_id: string;
  user_id: string;
  learner_email: string;
  course_code: string;
  attempts: number;
  last_error: string | null;
  qbo_invoice_id: string | null;
  qbo_doc_number: string | null;
  invoice_no: string | null;
  drive_file_id: string | null;
  drive_web_view_link: string | null;
  invoice_sent_at?: string | null;
  invoice_sent_to?: string | null;
  grn_doc_number?: string | null;
  grn_drive_file_id?: string | null;
  grn_drive_web_view_link?: string | null;
  created_at: string;
  updated_at: string;
  last_attempt_at: string | null;
}

export async function ensureInvoiceJobsTable(): Promise<void> {
  await pool.query(
    `CREATE TABLE IF NOT EXISTS public.invoice_jobs (
      id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
      batch_id text NULL,
      status text NOT NULL DEFAULT 'queued',
      enrolment_id varchar(100) NOT NULL,
      user_id uuid NOT NULL,
      learner_email text NOT NULL,
      course_code text NOT NULL,
      attempts int NOT NULL DEFAULT 0,
      last_error text NULL,
      qbo_invoice_id varchar(100) NULL,
      qbo_doc_number varchar(100) NULL,
      invoice_no varchar(64) NULL,
      drive_file_id text NULL,
      drive_web_view_link text NULL,
      last_attempt_at timestamptz NULL,
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now()
    );`
  );

  await pool.query(
    `CREATE UNIQUE INDEX IF NOT EXISTS invoice_jobs_unique_enrolment
     ON public.invoice_jobs(enrolment_id);`
  );

  await pool.query(
    `CREATE INDEX IF NOT EXISTS invoice_jobs_status_created
     ON public.invoice_jobs(status, created_at);`
  );

  await pool.query(
    `CREATE INDEX IF NOT EXISTS invoice_jobs_batch
     ON public.invoice_jobs(batch_id);`
  );

  await pool.query(
    `ALTER TABLE public.invoice_jobs ADD COLUMN IF NOT EXISTS invoice_no varchar(64) NULL`
  );
  await pool.query(
    `ALTER TABLE public.invoice_jobs ADD COLUMN IF NOT EXISTS invoice_sent_at timestamptz NULL`
  );
  await pool.query(
    `ALTER TABLE public.invoice_jobs ADD COLUMN IF NOT EXISTS invoice_sent_to text NULL`
  );
  await pool.query(
    `ALTER TABLE public.invoice_jobs ADD COLUMN IF NOT EXISTS grn_doc_number text NULL`
  );
  await pool.query(
    `ALTER TABLE public.invoice_jobs ADD COLUMN IF NOT EXISTS grn_drive_file_id text NULL`
  );
  await pool.query(
    `ALTER TABLE public.invoice_jobs ADD COLUMN IF NOT EXISTS grn_drive_web_view_link text NULL`
  );
  try {
    await pool.query(
      `CREATE UNIQUE INDEX IF NOT EXISTS invoice_jobs_invoice_no_unique
       ON public.invoice_jobs(invoice_no)
       WHERE invoice_no IS NOT NULL`
    );
  } catch (e) {
    console.warn('[invoice_jobs] invoice_no unique index (non-fatal):', e instanceof Error ? e.message : e);
  }
}

export interface EnqueueInvoiceJobOptions {
  /**
   * When true, only queue the row — no immediate `runPendingInvoiceJobs` (use for bulk SSG sync so QBO isn’t hit N times in parallel).
   */
  skipAutoProcess?: boolean;
  /**
   * Bypass {@link isQboAutoInvoiceAfterEnrolmentEnabled} (e.g. future admin-only enqueue). Omit for normal enrolment flows.
   */
  force?: boolean;
}

/** When false, `enqueueInvoiceJob` no-ops — no row inserted, no runner (stops QBO after enrolment / SSG sync). */
export function isQboAutoInvoiceAfterEnrolmentEnabled(): boolean {
  const v = process.env.QBO_AUTO_INVOICE_AFTER_ENROLMENT?.trim().toLowerCase();
  return v === 'true' || v === '1' || v === 'yes';
}

export async function enqueueInvoiceJob(
  input: EnqueueInvoiceJobInput,
  options?: EnqueueInvoiceJobOptions
): Promise<{ id: string; status: InvoiceJobStatus }> {
  await ensureInvoiceJobsTable();
  if (!options?.force && !isQboAutoInvoiceAfterEnrolmentEnabled()) {
    console.log(
      '[invoice_jobs] enqueue skipped — set QBO_AUTO_INVOICE_AFTER_ENROLMENT=true to auto-create QBO invoices after enrolment'
    );
    const existing = await getInvoiceJobByEnrolmentId(input.enrolmentId);
    return {
      id: existing?.id ?? '',
      status: (existing?.status as InvoiceJobStatus) ?? 'queued',
    };
  }
  const r = await pool.query(
    `INSERT INTO public.invoice_jobs (batch_id, status, enrolment_id, user_id, learner_email, course_code)
     VALUES ($1, 'queued', $2, $3, $4, $5)
     ON CONFLICT (enrolment_id) DO UPDATE SET
       batch_id = COALESCE(EXCLUDED.batch_id, public.invoice_jobs.batch_id),
       user_id = EXCLUDED.user_id,
       learner_email = EXCLUDED.learner_email,
       course_code = EXCLUDED.course_code,
       status = CASE WHEN public.invoice_jobs.status = 'done' THEN public.invoice_jobs.status ELSE 'queued' END,
       last_error = CASE WHEN public.invoice_jobs.status = 'done' THEN public.invoice_jobs.last_error ELSE NULL END,
       updated_at = now()
     RETURNING id, status`,
    [input.batchId ?? null, input.enrolmentId, input.userId, input.learnerEmail, input.courseCode]
  );
  const out = { id: r.rows[0].id, status: r.rows[0].status as InvoiceJobStatus };
  if (!options?.skipAutoProcess) {
    void import('./invoiceJobsRunner')
      .then(({ runPendingInvoiceJobs }) => runPendingInvoiceJobs(5))
      .catch((e: unknown) =>
        console.warn('[invoice_jobs] auto-run after enqueue failed:', e instanceof Error ? e.message : e)
      );
  }
  return out;
}

export async function getInvoiceJobByEnrolmentId(enrolmentId: string): Promise<InvoiceJobRow | null> {
  await ensureInvoiceJobsTable();
  const r = await pool.query(
    `SELECT * FROM public.invoice_jobs WHERE enrolment_id = $1 LIMIT 1`,
    [enrolmentId]
  );
  return r.rows[0] ?? null;
}

function traineeEmailFromSsgRecord(record: any): string | null {
  const t = record?.trainee;
  if (!t) return null;
  const e = t.email;
  if (typeof e === 'string') return e.trim() || null;
  if (e && typeof e === 'object' && typeof e.full === 'string') return e.full.trim() || null;
  return null;
}

function traineeFullNameFromSsgRecord(record: any): string | null {
  const t = record?.trainee;
  if (!t) return null;
  if (typeof t.fullName === 'string' && t.fullName.trim()) return t.fullName.trim();
  return null;
}

function traineeNricFromSsgRecord(record: any): string | null {
  const t = record?.trainee;
  if (!t) return null;
  if (typeof t.id === 'string' && t.id.trim()) return t.id.trim();
  if (typeof t.idNumber === 'string' && t.idNumber.trim()) return t.idNumber.trim();
  return null;
}

function nameFromEmail(email: string): string {
  const local = email.split('@')[0] ?? email;
  return local.replace(/[._-]+/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

/**
 * Look up an existing learner by email (case-insensitive), or create a fresh
 * `app_user` + `learner_profile` + `user_role_map` for an SSG-only enrolment.
 *
 * Returns the `app_user.id` or `null` if email is missing or provisioning fails.
 *
 * Why this exists: enrolments that arrive via SSG sync (TPGateway, Magento direct, etc.)
 * never went through `runPostSsgEnrolSync`, so no LMS user exists for them — and the
 * QBO invoice queue can't proceed without `user_id`. This mirrors the user-creation
 * portion of `runPostSsgEnrolSync` (see lib/services/postSsgEnrolSync.ts).
 */
async function ensureLearnerUserFromSsgRecord(input: {
  email: string;
  fullName?: string | null;
  nric?: string | null;
}): Promise<string | null> {
  const email = (input.email || '').trim();
  if (!email) return null;

  const existing = await pool.query(
    `SELECT id FROM app_user WHERE LOWER(TRIM(email)) = LOWER(TRIM($1)) LIMIT 1`,
    [email]
  );
  if (existing.rows[0]?.id) return existing.rows[0].id as string;

  const fullName = (input.fullName || '').trim() || nameFromEmail(email);
  const nric = (input.nric || '').trim() || null;

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const recheck = await client.query(
      `SELECT id FROM app_user WHERE LOWER(TRIM(email)) = LOWER(TRIM($1)) LIMIT 1`,
      [email]
    );
    let userId: string;
    if (recheck.rows[0]?.id) {
      userId = recheck.rows[0].id;
    } else {
      const placeholderPwd = `ssg_import_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
      const ins = await client.query(
        `INSERT INTO app_user (email, password, password_hash, full_name)
         VALUES ($1, $2, $2, $3)
         RETURNING id`,
        [email, placeholderPwd, fullName]
      );
      userId = ins.rows[0].id;

      await client.query(
        `INSERT INTO learner_profile (user_id, tel, nric)
         VALUES ($1, '', $2)
         ON CONFLICT (user_id) DO NOTHING`,
        [userId, nric]
      );

      await client.query(
        `INSERT INTO user_role_map (user_id, role)
         VALUES ($1, 'Learner')
         ON CONFLICT (user_id, role) DO NOTHING`,
        [userId]
      );
    }

    await client.query('COMMIT');
    console.log(`[invoice_jobs] provisioned app_user for SSG-only learner: ${email} (${userId})`);
    return userId;
  } catch (err) {
    await client.query('ROLLBACK');
    console.warn(
      '[invoice_jobs] ensureLearnerUserFromSsgRecord failed:',
      err instanceof Error ? err.message : err
    );
    return null;
  } finally {
    client.release();
  }
}

/**
 * After SSG sync upserts `ssg_enrolments`, enqueue QBO invoice if Confirmed and a learner exists.
 * Covers rows that never went through `runPostSsgEnrolSync` (local enrollment + enqueue).
 */
export interface EnqueueFromConsolidatedRowResult {
  enrolmentId: string;
  ok: boolean;
  jobId?: string;
  reason?: string;
}

/**
 * Queue QBO invoice jobs from Consolidated Finance (selected ENRs).
 * Resolves learner/course via local enrollment; the worker reads fee snapshot the same way as other QBO invoice jobs.
 */
export async function enqueueInvoiceJobsFromConsolidatedFinance(
  enrolmentIds: string[],
  options?: { skipAutoProcess?: boolean }
): Promise<EnqueueFromConsolidatedRowResult[]> {
  await ensureInvoiceJobsTable();
  const unique = [...new Set(enrolmentIds.map((id) => id.trim()).filter(Boolean))];
  const results: EnqueueFromConsolidatedRowResult[] = [];

  for (const enrolmentId of unique) {
    // Prefer `ssg_enrolments` (source for Consolidated Finance list)
    const ssg = await pool.query(
      `SELECT enrolment_id::text AS enrolment_id,
              enrolment_status::text AS enrolment_status,
              course_reference::text AS course_reference,
              raw_data
       FROM ssg_enrolments
       WHERE LOWER(TRIM(COALESCE(enrolment_id::text, ''))) = LOWER(TRIM($1::text))
       LIMIT 1`,
      [enrolmentId]
    );
    const se = ssg.rows[0] as
      | { enrolment_id?: string; enrolment_status?: string | null; course_reference?: string | null; raw_data?: any }
      | undefined;

    const ssgStatus = (se?.enrolment_status || '').trim();
    if (se && !isEnrolmentEligibleForAutoInvoice(ssgStatus)) {
      results.push({ enrolmentId, ok: false, reason: `Enrolment is not Confirmed (SSG status: ${ssgStatus || '—'})` });
      continue;
    }

    let courseCode = String(se?.course_reference || '').trim();
    if (!courseCode) courseCode = String(se?.raw_data?.course?.referenceNumber ?? '').trim();
    if (!courseCode) courseCode = String(se?.raw_data?.course?.reference_number ?? '').trim();

    let learnerEmail = String(se?.raw_data?.trainee?.email?.full ?? '').trim();
    if (!learnerEmail) learnerEmail = String(se?.raw_data?.trainee?.email ?? '').trim();
    if (!learnerEmail) learnerEmail = traineeEmailFromSsgRecord(se?.raw_data) || '';

    // Fallback to local enrollment row when available
    const fromEnr = await pool.query(
      `SELECT e.user_id, u.email::text AS learner_email, e.course_reference::text AS course_ref
       FROM enrollment e
       INNER JOIN app_user u ON u.id = e.user_id
       WHERE LOWER(TRIM(COALESCE(e.enrolment_id::text, ''))) = LOWER(TRIM($1::text))
       LIMIT 1`,
      [enrolmentId]
    );
    const en = fromEnr.rows[0] as { user_id: string; learner_email: string; course_ref: string | null } | undefined;

    let userId: string | undefined = en?.user_id;
    if (en?.learner_email?.trim()) learnerEmail = learnerEmail || en.learner_email.trim();
    if (!courseCode && en?.course_ref?.trim()) courseCode = en.course_ref.trim();

    if (!userId && learnerEmail) {
      const ur = await pool.query(`SELECT id FROM app_user WHERE LOWER(TRIM(email)) = LOWER(TRIM($1)) LIMIT 1`, [
        learnerEmail,
      ]);
      userId = ur.rows[0]?.id as string | undefined;
    }

    if (!userId && learnerEmail) {
      const provisioned = await ensureLearnerUserFromSsgRecord({
        email: learnerEmail,
        fullName: traineeFullNameFromSsgRecord(se?.raw_data),
        nric: traineeNricFromSsgRecord(se?.raw_data),
      });
      if (provisioned) userId = provisioned;
    }

    if (!courseCode) {
      results.push({ enrolmentId, ok: false, reason: 'Missing course code (TGS) for this enrolment' });
      continue;
    }
    if (!learnerEmail) {
      results.push({ enrolmentId, ok: false, reason: 'Missing learner email for this enrolment' });
      continue;
    }
    if (!userId) {
      results.push({ enrolmentId, ok: false, reason: 'Learner user not found (email not in app_user)' });
      continue;
    }

    const existing = await getInvoiceJobByEnrolmentId(enrolmentId);
    if (existing?.status === 'done') {
      results.push({ enrolmentId, ok: false, reason: 'Invoice job already completed for this enrolment' });
      continue;
    }

    try {
      const out = await enqueueInvoiceJob(
        {
          enrolmentId: (se?.enrolment_id || enrolmentId).trim(),
          userId,
          learnerEmail: learnerEmail.trim(),
          courseCode,
          batchId: 'consolidated_finance',
        },
        { force: true, skipAutoProcess: true }
      );
      results.push({ enrolmentId, ok: true, jobId: out.id });
    } catch (e) {
      results.push({
        enrolmentId,
        ok: false,
        reason: e instanceof Error ? e.message : String(e),
      });
    }
  }

  const anyQueued = results.some((r) => r.ok);
  if (anyQueued && !options?.skipAutoProcess) {
    const n = Math.min(10, Math.max(3, results.filter((r) => r.ok).length));
    void import('./invoiceJobsRunner')
      .then(({ runPendingInvoiceJobs }) => runPendingInvoiceJobs(n))
      .catch((e: unknown) =>
        console.warn('[invoice_jobs] run after consolidated enqueue failed:', e instanceof Error ? e.message : e)
      );
  }

  return results;
}

export async function tryEnqueueInvoiceFromSsgRecord(record: any): Promise<void> {
  const enrolmentId = String(record?.referenceNumber ?? '').trim();
  if (!enrolmentId) return;
  const status = record?.status as string | undefined;
  if (!isEnrolmentEligibleForAutoInvoice(status)) return;

  let courseCode = String(record?.course?.referenceNumber ?? '').trim();
  let learnerEmail = traineeEmailFromSsgRecord(record);

  // Prefer local `enrollment` row (created at enrolment time) — SSG view payload email can differ from app_user.
  const fromEnr = await pool.query(
    `SELECT e.user_id, u.email::text AS learner_email, e.course_reference::text AS course_ref
     FROM enrollment e
     INNER JOIN app_user u ON u.id = e.user_id
     WHERE LOWER(TRIM(COALESCE(e.enrolment_id, ''))) = LOWER(TRIM($1))
     LIMIT 1`,
    [enrolmentId]
  );
  const en = fromEnr.rows[0] as { user_id: string; learner_email: string; course_ref: string | null } | undefined;

  let userId: string | undefined = en?.user_id;
  if (en?.learner_email?.trim()) {
    learnerEmail = learnerEmail || en.learner_email.trim();
  }
  if (!courseCode && en?.course_ref?.trim()) {
    courseCode = en.course_ref.trim();
  }

  if (!userId && learnerEmail) {
    const ur = await pool.query(
      `SELECT id FROM app_user WHERE LOWER(TRIM(email)) = LOWER(TRIM($1)) LIMIT 1`,
      [learnerEmail]
    );
    userId = ur.rows[0]?.id as string | undefined;
  }

  if (!userId && learnerEmail) {
    const provisioned = await ensureLearnerUserFromSsgRecord({
      email: learnerEmail,
      fullName: traineeFullNameFromSsgRecord(record),
      nric: traineeNricFromSsgRecord(record),
    });
    if (provisioned) userId = provisioned;
  }

  if (!courseCode || !learnerEmail || !userId) {
    console.warn('[invoice_jobs] skip enqueue after SSG upsert — need course code, learner email, and user', {
      enrolmentId,
      hasCourse: !!courseCode,
      hasEmail: !!learnerEmail,
      hasUser: !!userId,
    });
    return;
  }

  const existing = await getInvoiceJobByEnrolmentId(enrolmentId);
  if (existing?.status === 'done') return;

  try {
    await enqueueInvoiceJob(
      {
        enrolmentId,
        userId,
        learnerEmail,
        courseCode,
        batchId: null,
      },
      { skipAutoProcess: true }
    );
  } catch (e) {
    console.warn('[invoice_jobs] tryEnqueueInvoiceFromSsgRecord failed:', e);
  }
}

/**
 * Called when a non-DA enrolment is cancelled.
 * Deletes the main QB invoice and the GRN invoice (if any), then marks the job cancelled.
 * Non-fatal — errors are logged but never propagate so the cancellation itself isn't blocked.
 */
function isQbNotFound(msg: string): boolean {
  return msg.includes('610') || msg.toLowerCase().includes('not found') || msg.toLowerCase().includes('object not found');
}

/** Try to delete a QB invoice by ID, attempting app2 then app1 (app2 is the primary invoice app). */
async function qboDeleteInvoiceAnyApp(invoiceId: string): Promise<void> {
  const apps: Array<'app2' | 'app1'> = ['app2', 'app1'];
  let lastErr: string | null = null;
  for (const app of apps) {
    try {
      const inv = await qboReadInvoice(app, invoiceId);
      if (!inv?.syncToken) continue; // not found in this app — try the other
      await qboDeleteInvoice(app, invoiceId, inv.syncToken);
      return; // deleted successfully
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      if (isQbNotFound(msg)) continue; // not in this app — try the other
      lastErr = `[${app}] ${msg}`;
    }
  }
  // If neither app found the invoice, it was already deleted — that's fine
  if (lastErr) throw new Error(lastErr);
}

/** Try to delete a QB invoice by DocNumber, attempting app2 then app1. */
async function qboDeleteInvoiceByDocNumberAnyApp(docNumber: string): Promise<void> {
  const apps: Array<'app2' | 'app1'> = ['app2', 'app1'];
  let lastErr: string | null = null;
  for (const app of apps) {
    try {
      const inv = await qboFindInvoiceByDocNumber(app, docNumber);
      if (!inv?.id) continue; // not found in this app — try the other
      // Re-read to ensure we have a fresh SyncToken
      const full = await qboReadInvoice(app, inv.id);
      if (!full?.syncToken) continue;
      await qboDeleteInvoice(app, inv.id, full.syncToken);
      return; // deleted successfully
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      if (isQbNotFound(msg)) continue; // not in this app — try the other
      lastErr = `[${app}] ${msg}`;
    }
  }
  if (lastErr) throw new Error(lastErr);
}

export async function cancelInvoiceJobOnEnrolmentCancelled(enrolmentId: string): Promise<{ qbDeleted: boolean; warnings: string[] }> {
  let job: InvoiceJobRow | null = null;
  try {
    job = await getInvoiceJobByEnrolmentId(enrolmentId);
  } catch (e) {
    console.warn('[invoice_jobs] cancelInvoiceJobOnEnrolmentCancelled — lookup failed:', e instanceof Error ? e.message : e);
    return { qbDeleted: false, warnings: ['DB lookup failed'] };
  }

  // No job at all — nothing to clean up
  if (!job) return { qbDeleted: false, warnings: [] };

  // If the job has no QB references and isn't done, nothing to delete in QB
  if (!job.qbo_invoice_id && !job.grn_doc_number && job.status !== 'done') {
    return { qbDeleted: false, warnings: [] };
  }

  const warnings: string[] = [];

  // Delete main customer invoice (try both apps)
  if (job.qbo_invoice_id) {
    try {
      await qboDeleteInvoiceAnyApp(job.qbo_invoice_id);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      console.warn('[invoice_jobs] cancel — main invoice delete failed:', msg);
      warnings.push(`customer invoice: ${msg}`);
    }
  }

  // Collect GRN doc numbers to delete: use invoice_jobs if set, otherwise
  // fall back to ssg_grants so invoices created before grn_doc_number was
  // tracked are still cleaned up.
  const grnDocNumbers: string[] = [];
  if (job.grn_doc_number) {
    grnDocNumbers.push(String(job.grn_doc_number));
  } else {
    try {
      const grantRows = await pool.query(
        `SELECT grant_id::text AS grant_id
         FROM public.ssg_grants
         WHERE LOWER(TRIM(COALESCE(enrollment_id::text, ''))) = LOWER(TRIM($1::text))
           AND grant_id IS NOT NULL AND TRIM(COALESCE(grant_id::text, '')) <> ''`,
        [enrolmentId]
      );
      for (const gr of grantRows.rows) {
        if (gr.grant_id) grnDocNumbers.push(String(gr.grant_id));
      }
    } catch (e) {
      console.warn('[invoice_jobs] cancel — ssg_grants lookup failed:', e instanceof Error ? e.message : e);
    }
  }

  for (const docNum of grnDocNumbers) {
    try {
      await qboDeleteInvoiceByDocNumberAnyApp(docNum);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      console.warn('[invoice_jobs] cancel — GRN invoice delete failed:', docNum, msg);
      warnings.push(`GRN ${docNum}: ${msg}`);
    }
  }

  const qbDeleted = warnings.length === 0;
  const note = qbDeleted
    ? 'Invoice deleted — enrolment cancelled'
    : `Enrolment cancelled; QB delete warning: ${warnings.join('; ')}`;

  try {
    await pool.query(
      `UPDATE public.invoice_jobs
       SET status              = 'cancelled',
           qbo_invoice_id      = NULL,
           qbo_doc_number      = NULL,
           invoice_no          = NULL,
           drive_file_id       = NULL,
           drive_web_view_link = NULL,
           grn_doc_number      = NULL,
           grn_drive_file_id   = NULL,
           grn_drive_web_view_link = NULL,
           invoice_sent_at     = NULL,
           invoice_sent_to     = NULL,
           last_error          = $2,
           updated_at          = now()
       WHERE id = $1`,
      [job.id, note]
    );
  } catch (e) {
    console.warn('[invoice_jobs] cancelInvoiceJobOnEnrolmentCancelled — DB update failed:', e instanceof Error ? e.message : e);
    warnings.push('DB clear failed');
  }

  return { qbDeleted, warnings };
}

