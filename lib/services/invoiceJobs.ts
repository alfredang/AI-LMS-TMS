import pool from '../db';

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
  drive_file_id: string | null;
  drive_web_view_link: string | null;
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
}

export async function enqueueInvoiceJob(input: EnqueueInvoiceJobInput): Promise<{ id: string; status: InvoiceJobStatus }> {
  await ensureInvoiceJobsTable();
  const r = await pool.query(
    `INSERT INTO public.invoice_jobs (batch_id, status, enrolment_id, user_id, learner_email, course_code)
     VALUES ($1, 'queued', $2, $3, $4, $5)
     ON CONFLICT (enrolment_id) DO UPDATE SET
       batch_id = COALESCE(EXCLUDED.batch_id, public.invoice_jobs.batch_id),
       user_id = EXCLUDED.user_id,
       learner_email = EXCLUDED.learner_email,
       course_code = EXCLUDED.course_code,
       updated_at = now()
     RETURNING id, status`,
    [input.batchId ?? null, input.enrolmentId, input.userId, input.learnerEmail, input.courseCode]
  );
  return { id: r.rows[0].id, status: r.rows[0].status as InvoiceJobStatus };
}

export async function getInvoiceJobByEnrolmentId(enrolmentId: string): Promise<InvoiceJobRow | null> {
  await ensureInvoiceJobsTable();
  const r = await pool.query(
    `SELECT * FROM public.invoice_jobs WHERE enrolment_id = $1 LIMIT 1`,
    [enrolmentId]
  );
  return r.rows[0] ?? null;
}

