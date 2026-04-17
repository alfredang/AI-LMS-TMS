import pool from '@/lib/db';

export async function ensureGrantImportSchema(): Promise<void> {
  // Runtime back-compat: allow feature to run even if SQL migrations weren't applied yet.
  // Keep it idempotent and safe for repeated calls.
  await pool.query(`
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'grant_import_batch_status') THEN
    CREATE TYPE public.grant_import_batch_status AS ENUM ('pending_review','applying','completed','cancelled');
  END IF;
END $$;`);

  await pool.query(`
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'grant_import_validation_status') THEN
    CREATE TYPE public.grant_import_validation_status AS ENUM ('valid','invalid');
  END IF;
END $$;`);

  await pool.query(`
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'grant_import_match_status') THEN
    CREATE TYPE public.grant_import_match_status AS ENUM ('ready','already_applied','ambiguous','unmatched','invalid');
  END IF;
END $$;`);

  await pool.query(`
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'grant_import_apply_status') THEN
    CREATE TYPE public.grant_import_apply_status AS ENUM ('pending','applied','skipped','failed');
  END IF;
END $$;`);

  await pool.query(`
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'grant_import_audit_event_type') THEN
    CREATE TYPE public.grant_import_audit_event_type AS ENUM (
      'upload','parse','validate','match','apply_start','apply_success','apply_fail','skip','enrolment_status_update','export'
    );
  END IF;
END $$;`);

  await pool.query(`
CREATE TABLE IF NOT EXISTS public.grant_import_batches (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  uploaded_by uuid,
  uploaded_at timestamptz NOT NULL DEFAULT now(),
  filename text,
  total_rows int NOT NULL DEFAULT 0,
  valid_rows int NOT NULL DEFAULT 0,
  ready_rows int NOT NULL DEFAULT 0,
  applied_rows int NOT NULL DEFAULT 0,
  failed_rows int NOT NULL DEFAULT 0,
  unmatched_rows int NOT NULL DEFAULT 0,
  ambiguous_rows int NOT NULL DEFAULT 0,
  already_applied_rows int NOT NULL DEFAULT 0,
  status public.grant_import_batch_status NOT NULL DEFAULT 'pending_review',
  applied_at timestamptz,
  applied_by uuid
);`);

  await pool.query(`CREATE INDEX IF NOT EXISTS idx_grant_import_batches_uploaded_at ON public.grant_import_batches(uploaded_at DESC);`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_grant_import_batches_status ON public.grant_import_batches(status);`);

  await pool.query(`
CREATE TABLE IF NOT EXISTS public.grant_import_rows (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  batch_id uuid NOT NULL REFERENCES public.grant_import_batches(id) ON DELETE CASCADE,
  row_number int NOT NULL,

  financial_transaction_id text,
  enrolment_id text,
  grant_id text,

  course_title text,
  scheme text,
  trainee_id text,
  trainee_name text,
  employer_name text,

  amount_raw text,
  amount_parsed numeric(10,2),
  payment_date_raw text,
  payment_date_parsed date,

  bank_reference_id text,
  funding_component text,

  raw_row_json jsonb NOT NULL DEFAULT '{}'::jsonb,

  validation_status public.grant_import_validation_status NOT NULL DEFAULT 'invalid',
  validation_errors jsonb,

  match_status public.grant_import_match_status NOT NULL DEFAULT 'invalid',
  matched_fms_record_id text,
  matched_qb_object_id text,
  existing_amount numeric(10,2),
  existing_payment_date date,

  selected_for_apply boolean NOT NULL DEFAULT true,

  apply_status public.grant_import_apply_status,
  apply_error text,
  applied_at timestamptz
);`);

  await pool.query(
    `CREATE UNIQUE INDEX IF NOT EXISTS grant_import_rows_batch_row_number_unique ON public.grant_import_rows(batch_id, row_number);`
  );
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_grant_import_rows_batch ON public.grant_import_rows(batch_id);`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_grant_import_rows_grant_id ON public.grant_import_rows(grant_id);`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_grant_import_rows_enrolment_id ON public.grant_import_rows(enrolment_id);`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_grant_import_rows_ftx ON public.grant_import_rows(financial_transaction_id);`);

  await pool.query(`
CREATE TABLE IF NOT EXISTS public.grant_import_audit_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  batch_id uuid NOT NULL REFERENCES public.grant_import_batches(id) ON DELETE CASCADE,
  row_id uuid REFERENCES public.grant_import_rows(id) ON DELETE SET NULL,
  event_type public.grant_import_audit_event_type NOT NULL,
  actor_user_id uuid,
  event_at timestamptz NOT NULL DEFAULT now(),
  details jsonb NOT NULL DEFAULT '{}'::jsonb
);`);

  await pool.query(
    `CREATE INDEX IF NOT EXISTS idx_grant_import_audit_logs_batch_event_at ON public.grant_import_audit_logs(batch_id, event_at DESC);`
  );
}

export async function requireGrantImportSchema(): Promise<void> {
  // Friendly runtime guard: ensure schema exists; if not possible, return a clear error.
  await ensureGrantImportSchema();
  const r = await pool.query(`SELECT to_regclass('public.grant_import_batches') AS t`);
  const ok = !!r.rows?.[0]?.t;
  if (!ok) {
    throw new Error(
      'Grant Import schema is missing. Apply SQL migration `database/migrations/add_bulk_grant_payment_sync.sql` to your database and retry.'
    );
  }
}

export type GrantImportBatchRow = {
  id: string;
  uploaded_at: string;
  uploaded_by: string | null;
  filename: string | null;
  status: 'pending_review' | 'applying' | 'completed' | 'cancelled';
};

export async function insertGrantImportBatch(input: {
  uploadedBy: string | null;
  filename: string | null;
  totals: {
    totalRows: number;
    validRows: number;
    readyRows: number;
    appliedRows?: number;
    failedRows?: number;
    unmatchedRows: number;
    ambiguousRows: number;
    alreadyAppliedRows: number;
  };
}): Promise<GrantImportBatchRow> {
  await requireGrantImportSchema();
  const r = await pool.query(
    `INSERT INTO public.grant_import_batches (
        uploaded_by, filename,
        total_rows, valid_rows, ready_rows,
        applied_rows, failed_rows,
        unmatched_rows, ambiguous_rows, already_applied_rows,
        status
     )
     VALUES ($1::uuid, $2::text, $3::int, $4::int, $5::int, $6::int, $7::int, $8::int, $9::int, $10::int, 'pending_review')
     RETURNING id, uploaded_at, uploaded_by, filename, status`,
    [
      input.uploadedBy,
      input.filename,
      input.totals.totalRows,
      input.totals.validRows,
      input.totals.readyRows,
      Number(input.totals.appliedRows ?? 0),
      Number(input.totals.failedRows ?? 0),
      input.totals.unmatchedRows,
      input.totals.ambiguousRows,
      input.totals.alreadyAppliedRows,
    ]
  );
  return r.rows[0] as GrantImportBatchRow;
}

export async function insertGrantImportRows(batchId: string, rows: Array<Record<string, any>>): Promise<void> {
  await requireGrantImportSchema();
  if (rows.length === 0) return;
  // Insert one-by-one for clarity and partial safety; stage 2 will need row-level updates anyway.
  for (const row of rows) {
    await pool.query(
      `INSERT INTO public.grant_import_rows (
        batch_id, row_number,
        financial_transaction_id, enrolment_id, grant_id,
        course_title, scheme, trainee_id, trainee_name, employer_name,
        amount_raw, amount_parsed, payment_date_raw, payment_date_parsed,
        bank_reference_id, funding_component, raw_row_json,
        validation_status, validation_errors,
        match_status,
        matched_fms_record_id, matched_qb_object_id, existing_amount, existing_payment_date,
        selected_for_apply,
        apply_status, apply_error, applied_at
      ) VALUES (
        $1::uuid, $2::int,
        $3::text, $4::text, $5::text,
        $6::text, $7::text, $8::text, $9::text, $10::text,
        $11::text, $12::numeric, $13::text, $14::date,
        $15::text, $16::text, $17::jsonb,
        $18::public.grant_import_validation_status, $19::jsonb,
        $20::public.grant_import_match_status,
        $21::text, $22::text, $23::numeric, $24::date,
        $25::boolean,
        $26::public.grant_import_apply_status, $27::text, $28::timestamptz
      )`,
      [
        batchId,
        row.row_number,
        row.financial_transaction_id,
        row.enrolment_id,
        row.grant_id,
        row.course_title,
        row.scheme,
        row.trainee_id,
        row.trainee_name,
        row.employer_name,
        row.amount_raw,
        row.amount_parsed,
        row.payment_date_raw,
        row.payment_date_parsed,
        row.bank_reference_id,
        row.funding_component,
        row.raw_row_json,
        row.validation_status,
        row.validation_errors,
        row.match_status,
        row.matched_fms_record_id,
        row.matched_qb_object_id,
        row.existing_amount,
        row.existing_payment_date,
        row.selected_for_apply ?? true,
        row.apply_status ?? null,
        row.apply_error ?? null,
        row.applied_at ?? null,
      ]
    );
  }
}

export async function listGrantImportBatches(limit = 50): Promise<
  Array<{
    id: string;
    uploaded_at: string;
    uploaded_by: string | null;
    filename: string | null;
    status: string;
    total_rows: number;
    ready_rows: number;
    valid_rows: number;
    already_applied_rows: number;
    unmatched_rows: number;
    ambiguous_rows: number;
    applied_rows: number;
    failed_rows: number;
  }>
> {
  await requireGrantImportSchema();
  const cap = Math.max(1, Math.min(200, Number(limit) || 50));
  const r = await pool.query(
    `SELECT id::text, uploaded_at::text, uploaded_by::text, filename, status::text,
            total_rows, valid_rows, ready_rows, already_applied_rows, unmatched_rows, ambiguous_rows, applied_rows, failed_rows
     FROM public.grant_import_batches
     ORDER BY uploaded_at DESC
     LIMIT $1`,
    [cap]
  );
  return r.rows as any;
}

export async function getGrantImportBatchPreview(batchId: string): Promise<{
  batch: any;
  rows: Array<any>;
}> {
  await requireGrantImportSchema();
  const b = await pool.query(
    `SELECT id::text, uploaded_at::text, uploaded_by::text, filename, status::text,
            total_rows, valid_rows, ready_rows, already_applied_rows, unmatched_rows, ambiguous_rows, applied_rows, failed_rows
     FROM public.grant_import_batches
     WHERE id = $1::uuid
     LIMIT 1`,
    [batchId]
  );
  if (b.rows.length === 0) throw new Error('Batch not found');

  const r = await pool.query(
    `SELECT
        id::text,
        row_number,
        financial_transaction_id,
        enrolment_id,
        grant_id,
        course_title,
        scheme,
        trainee_id,
        trainee_name,
        employer_name,
        amount_raw,
        amount_parsed::text AS amount_parsed,
        payment_date_raw,
        payment_date_parsed::text AS payment_date_parsed,
        bank_reference_id,
        funding_component,
        raw_row_json,
        validation_status::text AS validation_status,
        validation_errors,
        match_status::text AS match_status,
        matched_fms_record_id,
        matched_qb_object_id,
        existing_amount::text AS existing_amount,
        existing_payment_date::text AS existing_payment_date,
        selected_for_apply,
        apply_status::text AS apply_status,
        apply_error,
        applied_at::text AS applied_at
     FROM public.grant_import_rows
     WHERE batch_id = $1::uuid
     ORDER BY row_number ASC`,
    [batchId]
  );

  return { batch: b.rows[0], rows: r.rows };
}

export async function updateGrantImportRowSelection(batchId: string, updates: Array<{ id: string; selected: boolean }>) {
  await requireGrantImportSchema();
  for (const u of updates) {
    await pool.query(
      `UPDATE public.grant_import_rows
       SET selected_for_apply = $3::boolean
       WHERE batch_id = $1::uuid AND id = $2::uuid`,
      [batchId, u.id, u.selected]
    );
  }
}

export async function insertGrantImportAuditLog(input: {
  batchId: string;
  rowId?: string | null;
  eventType:
    | 'upload'
    | 'parse'
    | 'validate'
    | 'match'
    | 'apply_start'
    | 'apply_success'
    | 'apply_fail'
    | 'skip'
    | 'enrolment_status_update'
    | 'export';
  actorUserId: string | null;
  details: any;
}): Promise<void> {
  await requireGrantImportSchema();
  await pool.query(
    `INSERT INTO public.grant_import_audit_logs (batch_id, row_id, event_type, actor_user_id, details)
     VALUES ($1::uuid, $2::uuid, $3::public.grant_import_audit_event_type, $4::uuid, $5::jsonb)`,
    [input.batchId, input.rowId ?? null, input.eventType, input.actorUserId, input.details ?? {}]
  );
}

export async function markBatchStatus(batchId: string, status: 'pending_review' | 'applying' | 'completed' | 'cancelled', actorUserId: string | null) {
  await requireGrantImportSchema();
  await pool.query(
    `UPDATE public.grant_import_batches
     SET status = $2::public.grant_import_batch_status,
         applied_by = COALESCE($3::uuid, applied_by),
         applied_at = CASE WHEN $2::text IN ('completed', 'cancelled') THEN COALESCE(applied_at, now()) ELSE applied_at END
     WHERE id = $1::uuid`,
    [batchId, status, actorUserId]
  );
}

export async function listApplyCandidates(batchId: string): Promise<
  Array<{
    id: string;
    row_number: number;
    enrolment_id: string | null;
    grant_id: string | null;
    match_status: string;
    selected_for_apply: boolean;
    amount_parsed: string | null;
    payment_date_parsed: string | null;
    financial_transaction_id: string | null;
    bank_reference_id: string | null;
    matched_qb_object_id: string | null;
  }>
> {
  await requireGrantImportSchema();
  const r = await pool.query(
    `SELECT id::text, row_number, enrolment_id, grant_id, match_status::text AS match_status, selected_for_apply,
            amount_parsed::text AS amount_parsed, payment_date_parsed::text AS payment_date_parsed,
            financial_transaction_id, bank_reference_id, matched_qb_object_id
     FROM public.grant_import_rows
     WHERE batch_id = $1::uuid
     ORDER BY row_number ASC`,
    [batchId]
  );
  return r.rows as any;
}

export async function updateRowApplyResult(input: {
  rowId: string;
  applyStatus: 'pending' | 'applied' | 'skipped' | 'failed';
  applyError?: string | null;
  appliedAt?: string | null;
  matchedQbObjectId?: string | null;
}): Promise<void> {
  await requireGrantImportSchema();
  await pool.query(
    `UPDATE public.grant_import_rows
     SET apply_status = $2::public.grant_import_apply_status,
         apply_error = $3::text,
         applied_at = CASE WHEN $4::timestamptz IS NOT NULL THEN $4::timestamptz ELSE applied_at END,
         matched_qb_object_id = COALESCE($5::text, matched_qb_object_id)
     WHERE id = $1::uuid`,
    [input.rowId, input.applyStatus, input.applyError ?? null, input.appliedAt ?? null, input.matchedQbObjectId ?? null]
  );
}

export async function updateBatchCounts(batchId: string): Promise<void> {
  await requireGrantImportSchema();
  // Recompute from rows for correctness.
  await pool.query(
    `UPDATE public.grant_import_batches b
     SET
       applied_rows = x.applied_rows,
       failed_rows = x.failed_rows,
       ready_rows = x.ready_rows,
       unmatched_rows = x.unmatched_rows,
       ambiguous_rows = x.ambiguous_rows,
       already_applied_rows = x.already_applied_rows,
       valid_rows = x.valid_rows,
       total_rows = x.total_rows
     FROM (
       SELECT
         batch_id,
         COUNT(*)::int AS total_rows,
         COUNT(*) FILTER (WHERE validation_status = 'valid')::int AS valid_rows,
         COUNT(*) FILTER (WHERE match_status = 'ready')::int AS ready_rows,
         COUNT(*) FILTER (WHERE match_status = 'unmatched')::int AS unmatched_rows,
         COUNT(*) FILTER (WHERE match_status = 'ambiguous')::int AS ambiguous_rows,
         COUNT(*) FILTER (WHERE match_status = 'already_applied')::int AS already_applied_rows,
         COUNT(*) FILTER (WHERE apply_status = 'applied')::int AS applied_rows,
         COUNT(*) FILTER (WHERE apply_status = 'failed')::int AS failed_rows
       FROM public.grant_import_rows
       WHERE batch_id = $1::uuid
       GROUP BY batch_id
     ) x
     WHERE b.id = $1::uuid AND b.id = x.batch_id`,
    [batchId]
  );
}

export async function findDuplicateFtx(ftxList: string[]): Promise<Array<{ ftx: string; previousBatchId: string }>> {
  await requireGrantImportSchema();
  if (ftxList.length === 0) return [];
  const r = await pool.query(
    `SELECT financial_transaction_id AS ftx, batch_id::text AS previous_batch_id
     FROM public.grant_import_rows
     WHERE financial_transaction_id = ANY($1::text[])
     GROUP BY financial_transaction_id, batch_id
     ORDER BY financial_transaction_id`,
    [ftxList]
  );
  return r.rows.map((x: any) => ({ ftx: String(x.ftx), previousBatchId: String(x.previous_batch_id) }));
}

export async function wasGrantAlreadyApplied(grantId: string): Promise<boolean> {
  await requireGrantImportSchema();
  const r = await pool.query(
    `SELECT 1
     FROM public.grant_import_rows
     WHERE grant_id = $1
       AND apply_status = 'applied'
     LIMIT 1`,
    [grantId]
  );
  return r.rows.length > 0;
}

export async function listAlreadyAppliedGrantIds(grantIds: string[]): Promise<Set<string>> {
  await requireGrantImportSchema();
  const out = new Set<string>();
  const ids = Array.from(new Set(grantIds.map((x) => String(x || '').trim()).filter(Boolean)));
  if (ids.length === 0) return out;
  const r = await pool.query(
    `SELECT DISTINCT grant_id::text AS grant_id
     FROM public.grant_import_rows
     WHERE grant_id = ANY($1::text[])
       AND apply_status = 'applied'`,
    [ids]
  );
  for (const row of r.rows) out.add(String(row.grant_id));
  return out;
}

export async function sumAppliedReceivedByEnrolment(enrolmentIds: string[]): Promise<Map<string, number>> {
  await requireGrantImportSchema();
  const out = new Map<string, number>();
  if (enrolmentIds.length === 0) return out;
  const r = await pool.query(
    `SELECT enrolment_id, COALESCE(SUM(COALESCE(amount_parsed, 0)), 0)::float AS total
     FROM public.grant_import_rows
     WHERE enrolment_id = ANY($1::text[])
       AND apply_status = 'applied'
     GROUP BY enrolment_id`,
    [enrolmentIds]
  );
  for (const row of r.rows) out.set(String(row.enrolment_id), Number(row.total) || 0);
  return out;
}

export async function sumExpectedByEnrolmentFromSsgGrants(enrolmentIds: string[]): Promise<Map<string, number>> {
  const out = new Map<string, number>();
  if (enrolmentIds.length === 0) return out;
  const r = await pool.query(
    `SELECT enrollment_id AS enrolment_id,
            COALESCE(SUM(
              CASE
                WHEN COALESCE(approved_grant_amount, 0) > 0 THEN approved_grant_amount
                ELSE COALESCE(estimated_grant_amount, 0)
              END
            ), 0)::float AS total
     FROM public.ssg_grants
     WHERE enrollment_id = ANY($1::text[])
     GROUP BY enrollment_id`,
    [enrolmentIds]
  );
  for (const row of r.rows) out.set(String(row.enrolment_id), Number(row.total) || 0);
  return out;
}

export async function ssgGrantExists(grantId: string): Promise<{ ok: boolean; ssgGrantRowId?: string }> {
  const r = await pool.query(`SELECT id::text FROM public.ssg_grants WHERE grant_id = $1 LIMIT 2`, [grantId]);
  if (r.rows.length === 1) return { ok: true, ssgGrantRowId: String(r.rows[0].id) };
  if (r.rows.length > 1) return { ok: false };
  return { ok: false };
}

