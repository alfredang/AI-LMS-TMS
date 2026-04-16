-- Bulk Grant Payment Sync (TPGateway disbursement import)
-- Safe, idempotent migration: adds tables + enrolment rollup columns.

-- 1) Enums (as Postgres types) — create if missing
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'grant_import_batch_status') THEN
    CREATE TYPE public.grant_import_batch_status AS ENUM (
      'pending_review',
      'applying',
      'completed',
      'cancelled'
    );
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'grant_import_validation_status') THEN
    CREATE TYPE public.grant_import_validation_status AS ENUM ('valid', 'invalid');
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'grant_import_match_status') THEN
    CREATE TYPE public.grant_import_match_status AS ENUM (
      'ready',
      'already_applied',
      'ambiguous',
      'unmatched',
      'invalid'
    );
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'grant_import_apply_status') THEN
    CREATE TYPE public.grant_import_apply_status AS ENUM (
      'pending',
      'applied',
      'skipped',
      'failed'
    );
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'grant_import_audit_event_type') THEN
    CREATE TYPE public.grant_import_audit_event_type AS ENUM (
      'upload',
      'parse',
      'validate',
      'match',
      'apply_start',
      'apply_success',
      'apply_fail',
      'skip',
      'enrolment_status_update',
      'export'
    );
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'grant_payment_status') THEN
    CREATE TYPE public.grant_payment_status AS ENUM (
      'NOT_RECEIVED',
      'PARTIAL',
      'FULLY_PAID'
    );
  END IF;
END $$;

-- 2) Enrolment rollup columns (store on ssg_enrolments because Consolidated Finance reads from it)
ALTER TABLE public.ssg_enrolments
  ADD COLUMN IF NOT EXISTS total_grant_expected numeric(10,2),
  ADD COLUMN IF NOT EXISTS total_grant_received numeric(10,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS total_grant_pending numeric(10,2),
  ADD COLUMN IF NOT EXISTS grant_payment_status public.grant_payment_status,
  ADD COLUMN IF NOT EXISTS last_grant_import_at timestamptz;

CREATE INDEX IF NOT EXISTS idx_ssg_enrolments_grant_payment_status
  ON public.ssg_enrolments(grant_payment_status);

CREATE INDEX IF NOT EXISTS idx_ssg_enrolments_last_grant_import_at
  ON public.ssg_enrolments(last_grant_import_at DESC);

-- 3) Batch header table
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
);

CREATE INDEX IF NOT EXISTS idx_grant_import_batches_uploaded_at
  ON public.grant_import_batches(uploaded_at DESC);

CREATE INDEX IF NOT EXISTS idx_grant_import_batches_status
  ON public.grant_import_batches(status);

-- 4) Batch rows (one per Excel line)
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
);

CREATE UNIQUE INDEX IF NOT EXISTS grant_import_rows_batch_row_number_unique
  ON public.grant_import_rows(batch_id, row_number);

CREATE INDEX IF NOT EXISTS idx_grant_import_rows_batch
  ON public.grant_import_rows(batch_id);

CREATE INDEX IF NOT EXISTS idx_grant_import_rows_grant_id
  ON public.grant_import_rows(grant_id);

CREATE INDEX IF NOT EXISTS idx_grant_import_rows_enrolment_id
  ON public.grant_import_rows(enrolment_id);

CREATE INDEX IF NOT EXISTS idx_grant_import_rows_ftx
  ON public.grant_import_rows(financial_transaction_id);

-- 5) Audit log table
CREATE TABLE IF NOT EXISTS public.grant_import_audit_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  batch_id uuid NOT NULL REFERENCES public.grant_import_batches(id) ON DELETE CASCADE,
  row_id uuid REFERENCES public.grant_import_rows(id) ON DELETE SET NULL,
  event_type public.grant_import_audit_event_type NOT NULL,
  actor_user_id uuid,
  event_at timestamptz NOT NULL DEFAULT now(),
  details jsonb NOT NULL DEFAULT '{}'::jsonb
);

CREATE INDEX IF NOT EXISTS idx_grant_import_audit_logs_batch_event_at
  ON public.grant_import_audit_logs(batch_id, event_at DESC);

