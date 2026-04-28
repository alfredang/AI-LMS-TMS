import pool from '../db';
import { isEnrolmentEligibleForAutoInvoice } from './invoiceEligibility';

export type InvoiceJobStatus = 'queued' | 'running' | 'done' | 'failed';

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
    if (!learnerEmail) learnerEmail = traineeEmailFromSsgRecord(se?.raw_data);

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

