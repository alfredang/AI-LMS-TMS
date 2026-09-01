import pool from '@/lib/db';

export async function ensureSfcImportSchema(): Promise<void> {
  await pool.query(`
    ALTER TABLE public.ssg_claims
      ADD COLUMN IF NOT EXISTS claim_payment_status VARCHAR DEFAULT 'NOT_RECEIVED',
      ADD COLUMN IF NOT EXISTS qb_payment_id VARCHAR,
      ADD COLUMN IF NOT EXISTS last_sfc_import_at TIMESTAMPTZ
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS public.sfc_import_batches (
      id SERIAL PRIMARY KEY,
      filename VARCHAR NOT NULL,
      uploaded_by VARCHAR,
      status VARCHAR NOT NULL DEFAULT 'processing',
      total_rows INT DEFAULT 0,
      ready_count INT DEFAULT 0,
      already_applied_count INT DEFAULT 0,
      unmatched_count INT DEFAULT 0,
      skipped_da_count INT DEFAULT 0,
      invalid_count INT DEFAULT 0,
      applied_count INT DEFAULT 0,
      skipped_count INT DEFAULT 0,
      failed_count INT DEFAULT 0,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      completed_at TIMESTAMPTZ
    )
  `);

  await pool.query(`CREATE INDEX IF NOT EXISTS idx_sfc_import_batches_created_at ON public.sfc_import_batches(created_at DESC)`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_sfc_import_batches_status ON public.sfc_import_batches(status)`);
  await pool.query(`ALTER TABLE public.sfc_import_batches ADD COLUMN IF NOT EXISTS needs_review_count INT DEFAULT 0`);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS public.sfc_import_rows (
      id SERIAL PRIMARY KEY,
      batch_id INT REFERENCES public.sfc_import_batches(id) ON DELETE CASCADE,
      row_index INT NOT NULL,
      claim_id VARCHAR,
      individual_nric VARCHAR,
      individual_name VARCHAR,
      course_reference_number VARCHAR,
      course_name VARCHAR,
      course_start_date VARCHAR,
      disbursement_date VARCHAR,
      disbursement_date_iso VARCHAR,
      claim_amount NUMERIC(10,2),
      payout_request_id VARCHAR,
      claim_status VARCHAR,
      match_status VARCHAR NOT NULL DEFAULT 'pending',
      matched_enrolment_id VARCHAR,
      matched_ssg_claim_id VARCHAR,
      sponsorship_type VARCHAR,
      da_application_id VARCHAR,
      da_sfc_invoice_id VARCHAR,
      main_qbo_invoice_id VARCHAR,
      main_qbo_doc_number VARCHAR,
      matched_qbo_invoice_id VARCHAR,
      matched_qbo_doc_number VARCHAR,
      matched_qbo_invoice_balance NUMERIC(10,2),
      matched_qb_payment_id VARCHAR,
      validation_errors JSONB DEFAULT '[]',
      apply_status VARCHAR,
      apply_error VARCHAR,
      applied_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ DEFAULT NOW()
    )
  `);

  // Backfill columns for existing DBs (idempotent)
  await pool.query(`ALTER TABLE public.sfc_import_rows ADD COLUMN IF NOT EXISTS da_application_id VARCHAR`);
  await pool.query(`ALTER TABLE public.sfc_import_rows ADD COLUMN IF NOT EXISTS da_sfc_invoice_id VARCHAR`);
  await pool.query(`ALTER TABLE public.sfc_import_rows ADD COLUMN IF NOT EXISTS main_qbo_invoice_id VARCHAR`);
  await pool.query(`ALTER TABLE public.sfc_import_rows ADD COLUMN IF NOT EXISTS main_qbo_doc_number VARCHAR`);

  await pool.query(`CREATE INDEX IF NOT EXISTS idx_sfc_import_rows_batch_id ON public.sfc_import_rows(batch_id)`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_sfc_import_rows_claim_id ON public.sfc_import_rows(claim_id)`);
  await pool.query(`CREATE UNIQUE INDEX IF NOT EXISTS idx_sfc_import_rows_batch_row ON public.sfc_import_rows(batch_id, row_index)`);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS public.sfc_import_audit_logs (
      id SERIAL PRIMARY KEY,
      batch_id INT REFERENCES public.sfc_import_batches(id) ON DELETE CASCADE,
      row_id INT REFERENCES public.sfc_import_rows(id) ON DELETE SET NULL,
      event VARCHAR NOT NULL,
      details JSONB,
      created_at TIMESTAMPTZ DEFAULT NOW()
    )
  `);

  await pool.query(`CREATE INDEX IF NOT EXISTS idx_sfc_import_audit_logs_batch ON public.sfc_import_audit_logs(batch_id, created_at DESC)`);

  await pool.query(`
    ALTER TABLE public.invoice_jobs
      ADD COLUMN IF NOT EXISTS qbo_sfc_status VARCHAR,
      ADD COLUMN IF NOT EXISTS qbo_tg_status VARCHAR,
      ADD COLUMN IF NOT EXISTS qbo_net_fee_status VARCHAR
  `);

  await pool.query(`
    ALTER TABLE public.ssg_enrolments
      ADD COLUMN IF NOT EXISTS personal_data_masked BOOLEAN NOT NULL DEFAULT FALSE
  `);
}

export async function requireSfcImportSchema(): Promise<void> {
  await ensureSfcImportSchema();
  const r = await pool.query(`SELECT to_regclass('public.sfc_import_batches') AS t`);
  if (!r.rows?.[0]?.t) {
    throw new Error('SFC Import schema is missing. Apply database/migrations/add_sfc_claim_payment_sync.sql and retry.');
  }
}

export async function insertSfcImportBatch(input: {
  filename: string;
  uploadedBy: string | null;
}): Promise<{ id: number }> {
  await requireSfcImportSchema();
  const r = await pool.query(
    `INSERT INTO public.sfc_import_batches (filename, uploaded_by, status)
     VALUES ($1::varchar, $2::varchar, 'processing')
     RETURNING id`,
    [input.filename, input.uploadedBy]
  );
  return { id: Number(r.rows[0].id) };
}

export async function updateSfcImportBatchCounts(
  batchId: number,
  counts: {
    total_rows: number;
    ready_count: number;
    already_applied_count: number;
    unmatched_count: number;
    skipped_da_count: number;
    invalid_count: number;
    needs_review_count?: number;
  },
  status: 'processing' | 'completed' | 'failed'
): Promise<void> {
  const isTerminal = status === 'completed' || status === 'failed';
  await pool.query(
    `UPDATE public.sfc_import_batches SET
       total_rows = $2::int,
       ready_count = $3::int,
       already_applied_count = $4::int,
       unmatched_count = $5::int,
       skipped_da_count = $6::int,
       invalid_count = $7::int,
       status = $8::varchar,
       completed_at = CASE WHEN $9::boolean THEN NOW() ELSE NULL END,
       needs_review_count = $10::int
     WHERE id = $1::int`,
    [
      batchId,
      counts.total_rows,
      counts.ready_count,
      counts.already_applied_count,
      counts.unmatched_count,
      counts.skipped_da_count,
      counts.invalid_count,
      status,
      isTerminal,
      counts.needs_review_count ?? 0,
    ]
  );
}

export async function insertSfcImportRow(row: {
  batch_id: number;
  row_index: number;
  claim_id: string | null;
  individual_nric: string | null;
  individual_name: string | null;
  course_reference_number: string | null;
  course_name: string | null;
  course_start_date: string | null;
  disbursement_date: string | null;
  disbursement_date_iso: string | null;
  claim_amount: number | null;
  payout_request_id: string | null;
  claim_status: string | null;
  match_status: string;
  matched_enrolment_id: string | null;
  matched_ssg_claim_id: string | null;
  sponsorship_type: string | null;
  da_application_id?: string | null;
  da_sfc_invoice_id?: string | null;
  main_qbo_invoice_id?: string | null;
  main_qbo_doc_number?: string | null;
  matched_qbo_invoice_id: string | null;
  matched_qbo_doc_number: string | null;
  matched_qbo_invoice_balance: number | null;
  matched_qb_payment_id: string | null;
  validation_errors: any[];
  apply_status: string | null;
  apply_error: string | null;
}): Promise<number> {
  const r = await pool.query(
    `INSERT INTO public.sfc_import_rows (
       batch_id, row_index,
       claim_id, individual_nric, individual_name,
       course_reference_number, course_name, course_start_date,
       disbursement_date, disbursement_date_iso,
       claim_amount, payout_request_id, claim_status,
       match_status, matched_enrolment_id, matched_ssg_claim_id,
       sponsorship_type, da_application_id, da_sfc_invoice_id, main_qbo_invoice_id, main_qbo_doc_number,
       matched_qbo_invoice_id, matched_qbo_doc_number,
       matched_qbo_invoice_balance, matched_qb_payment_id,
       validation_errors, apply_status, apply_error
     ) VALUES (
       $1::int, $2::int,
       $3::varchar, $4::varchar, $5::varchar,
       $6::varchar, $7::varchar, $8::varchar,
       $9::varchar, $10::varchar,
       $11::numeric, $12::varchar, $13::varchar,
       $14::varchar, $15::varchar, $16::varchar,
       $17::varchar, $18::varchar, $19::varchar, $20::varchar, $21::varchar,
       $22::varchar, $23::varchar,
       $24::numeric, $25::varchar,
       $26::jsonb, $27::varchar, $28::varchar
     ) RETURNING id`,
    [
      row.batch_id, row.row_index,
      row.claim_id, row.individual_nric, row.individual_name,
      row.course_reference_number, row.course_name, row.course_start_date,
      row.disbursement_date, row.disbursement_date_iso,
      row.claim_amount, row.payout_request_id, row.claim_status,
      row.match_status, row.matched_enrolment_id, row.matched_ssg_claim_id,
      row.sponsorship_type,
      row.da_application_id ?? null,
      row.da_sfc_invoice_id ?? null,
      row.main_qbo_invoice_id ?? null,
      row.main_qbo_doc_number ?? null,
      row.matched_qbo_invoice_id,
      row.matched_qbo_doc_number,
      row.matched_qbo_invoice_balance,
      row.matched_qb_payment_id,
      JSON.stringify(row.validation_errors),
      row.apply_status,
      row.apply_error,
    ]
  );
  return Number(r.rows[0].id);
}

export async function getSfcImportBatch(batchId: number): Promise<any | null> {
  await requireSfcImportSchema();
  const r = await pool.query(
    `SELECT id, filename, uploaded_by, status, total_rows, ready_count, already_applied_count,
            unmatched_count, skipped_da_count, invalid_count, applied_count, skipped_count, failed_count,
            COALESCE(needs_review_count, 0) AS needs_review_count,
            created_at::text AS created_at, completed_at::text AS completed_at
     FROM public.sfc_import_batches WHERE id = $1 LIMIT 1`,
    [batchId]
  );
  return r.rows[0] ?? null;
}

export async function getSfcImportRows(batchId: number): Promise<any[]> {
  await requireSfcImportSchema();
  const r = await pool.query(
    `SELECT id, batch_id, row_index,
            claim_id, individual_nric, individual_name,
            course_reference_number, course_name, course_start_date,
            disbursement_date, disbursement_date_iso,
            claim_amount::text AS claim_amount,
            payout_request_id, claim_status,
            match_status, matched_enrolment_id, matched_ssg_claim_id,
            sponsorship_type,
            da_application_id, da_sfc_invoice_id,
            main_qbo_invoice_id, main_qbo_doc_number,
            matched_qbo_invoice_id, matched_qbo_doc_number,
            matched_qbo_invoice_balance::text AS matched_qbo_invoice_balance,
            matched_qb_payment_id, validation_errors,
            apply_status, apply_error, applied_at::text AS applied_at,
            created_at::text AS created_at
     FROM public.sfc_import_rows
     WHERE batch_id = $1
     ORDER BY row_index ASC`,
    [batchId]
  );
  return r.rows;
}

export async function updateSfcImportRowApplyResult(input: {
  rowId: number;
  applyStatus: 'applied' | 'skipped' | 'failed';
  applyError: string | null;
  matchedQbPaymentId?: string | null;
}): Promise<void> {
  // A successful apply must also move match_status to 'already_applied' — otherwise the row
  // stays 'ready' forever (until the next re-upload happens to re-derive it from QB balance),
  // which left just-applied rows sitting in the Ready tab, still selectable for a second apply.
  await pool.query(
    `UPDATE public.sfc_import_rows SET
       apply_status = $2::varchar,
       apply_error = $3::varchar,
       matched_qb_payment_id = COALESCE($4::varchar, matched_qb_payment_id),
       applied_at = CASE WHEN $2::varchar = 'applied' THEN NOW() ELSE applied_at END,
       match_status = CASE WHEN $2::varchar = 'applied' THEN 'already_applied' ELSE match_status END
     WHERE id = $1::int`,
    [input.rowId, input.applyStatus, input.applyError, input.matchedQbPaymentId ?? null]
  );
}

export async function insertSfcImportAuditLog(input: {
  batchId: number;
  rowId: number | null;
  event: string;
  details: any;
}): Promise<void> {
  await pool.query(
    `INSERT INTO public.sfc_import_audit_logs (batch_id, row_id, event, details)
     VALUES ($1::int, $2::int, $3::varchar, $4::jsonb)`,
    [input.batchId, input.rowId, input.event, JSON.stringify(input.details ?? {})]
  );
}

export async function recomputeSfcBatchApplyCounts(batchId: number): Promise<void> {
  await pool.query(
    `UPDATE public.sfc_import_batches b SET
       applied_count = x.applied_count,
       skipped_count = x.skipped_count,
       failed_count = x.failed_count,
       ready_count = x.ready_count,
       already_applied_count = x.already_applied_count
     FROM (
       SELECT batch_id,
         COUNT(*) FILTER (WHERE apply_status = 'applied')::int AS applied_count,
         COUNT(*) FILTER (WHERE apply_status = 'skipped')::int AS skipped_count,
         COUNT(*) FILTER (WHERE apply_status = 'failed')::int AS failed_count,
         COUNT(*) FILTER (WHERE match_status = 'ready')::int AS ready_count,
         COUNT(*) FILTER (WHERE match_status = 'already_applied')::int AS already_applied_count
       FROM public.sfc_import_rows
       WHERE batch_id = $1
       GROUP BY batch_id
     ) x
     WHERE b.id = $1 AND b.id = x.batch_id`,
    [batchId]
  );
}

export async function listAlreadyAppliedSfcClaimIds(claimIds: string[]): Promise<Set<string>> {
  await requireSfcImportSchema();
  const ids = Array.from(new Set(claimIds.map((x) => String(x || '').trim()).filter(Boolean)));
  if (ids.length === 0) return new Set();
  const r = await pool.query(
    `SELECT DISTINCT claim_id FROM public.sfc_import_rows
     WHERE claim_id = ANY($1::text[])
       AND (apply_status = 'applied' OR match_status = 'already_applied')`,
    [ids]
  );
  return new Set(r.rows.map((x: any) => String(x.claim_id)));
}

export async function getAppliedQbPaymentIdsByClaimId(claimIds: string[]): Promise<Map<string, string>> {
  await requireSfcImportSchema();
  const out = new Map<string, string>();
  const ids = Array.from(new Set(claimIds.map((x) => String(x || '').trim()).filter(Boolean)));
  if (ids.length === 0) return out;
  const r = await pool.query(
    `SELECT DISTINCT ON (claim_id) claim_id, matched_qb_payment_id
     FROM public.sfc_import_rows
     WHERE claim_id = ANY($1::text[])
       AND matched_qb_payment_id IS NOT NULL
     ORDER BY claim_id, applied_at DESC NULLS LAST`,
    [ids]
  );
  for (const row of r.rows) out.set(String(row.claim_id), String(row.matched_qb_payment_id));
  return out;
}

export async function getSfcImportRowsForApply(batchId: number, rowIds: number[]): Promise<any[]> {
  await requireSfcImportSchema();
  const r = await pool.query(
    `SELECT id, batch_id, row_index,
            claim_id, individual_nric, individual_name,
            course_reference_number,
            disbursement_date_iso, claim_amount::float AS claim_amount,
            payout_request_id, match_status, apply_status,
            matched_enrolment_id, matched_ssg_claim_id,
            da_application_id, da_sfc_invoice_id,
            main_qbo_invoice_id, main_qbo_doc_number,
            matched_qbo_invoice_id, matched_qbo_doc_number,
            matched_qbo_invoice_balance::float AS matched_qbo_invoice_balance,
            matched_qb_payment_id
     FROM public.sfc_import_rows
     WHERE batch_id = $1 AND id = ANY($2::int[])
     ORDER BY row_index ASC`,
    [batchId, rowIds]
  );
  return r.rows;
}
