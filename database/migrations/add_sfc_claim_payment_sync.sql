-- Migration: add_sfc_claim_payment_sync
-- Adds SFC Claim Payment Sync feature tables and ssg_claims columns.

-- 1. Extend ssg_claims with payment tracking columns (idempotent)
ALTER TABLE public.ssg_claims
  ADD COLUMN IF NOT EXISTS claim_payment_status VARCHAR DEFAULT 'NOT_RECEIVED',
  ADD COLUMN IF NOT EXISTS qb_payment_id VARCHAR,
  ADD COLUMN IF NOT EXISTS last_sfc_import_at TIMESTAMPTZ;

-- 2. Batch tracking table
CREATE TABLE IF NOT EXISTS public.sfc_import_batches (
  id SERIAL PRIMARY KEY,
  filename VARCHAR NOT NULL,
  uploaded_by VARCHAR,
  status VARCHAR NOT NULL DEFAULT 'processing',
  -- status values: processing | completed | failed
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
);

CREATE INDEX IF NOT EXISTS idx_sfc_import_batches_created_at ON public.sfc_import_batches(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_sfc_import_batches_status ON public.sfc_import_batches(status);

-- 2b. needs_review_count — rows whose resolved invoice failed content verification
-- (wrong invoice type, or content that doesn't match this claim's learner/course).
ALTER TABLE public.sfc_import_batches
  ADD COLUMN IF NOT EXISTS needs_review_count INT DEFAULT 0;

-- 3. Per-row import detail table
CREATE TABLE IF NOT EXISTS public.sfc_import_rows (
  id SERIAL PRIMARY KEY,
  batch_id INT REFERENCES public.sfc_import_batches(id) ON DELETE CASCADE,
  row_index INT NOT NULL,
  -- Raw Excel fields
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
  -- Match results
  match_status VARCHAR NOT NULL DEFAULT 'pending',
  -- pending | ready | already_applied | unmatched | invalid | skipped_da
  matched_enrolment_id VARCHAR,
  matched_ssg_claim_id VARCHAR,
  sponsorship_type VARCHAR,
  matched_qbo_invoice_id VARCHAR,
  matched_qbo_doc_number VARCHAR,
  matched_qbo_invoice_balance NUMERIC(10,2),
  matched_qb_payment_id VARCHAR,
  validation_errors JSONB DEFAULT '[]',
  -- Apply results
  apply_status VARCHAR,
  -- applied | skipped | failed
  apply_error VARCHAR,
  applied_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_sfc_import_rows_batch_id ON public.sfc_import_rows(batch_id);
CREATE INDEX IF NOT EXISTS idx_sfc_import_rows_claim_id ON public.sfc_import_rows(claim_id);
CREATE INDEX IF NOT EXISTS idx_sfc_import_rows_apply_status ON public.sfc_import_rows(apply_status);
CREATE UNIQUE INDEX IF NOT EXISTS idx_sfc_import_rows_batch_row ON public.sfc_import_rows(batch_id, row_index);

-- 4. Audit log table
CREATE TABLE IF NOT EXISTS public.sfc_import_audit_logs (
  id SERIAL PRIMARY KEY,
  batch_id INT REFERENCES public.sfc_import_batches(id) ON DELETE CASCADE,
  row_id INT REFERENCES public.sfc_import_rows(id) ON DELETE SET NULL,
  event VARCHAR NOT NULL,
  details JSONB,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_sfc_import_audit_logs_batch ON public.sfc_import_audit_logs(batch_id, created_at DESC);

-- 5. invoice_jobs — QB status columns per invoice type (idempotent)
ALTER TABLE public.invoice_jobs
  ADD COLUMN IF NOT EXISTS qbo_sfc_status VARCHAR,
  ADD COLUMN IF NOT EXISTS qbo_tg_status VARCHAR,
  ADD COLUMN IF NOT EXISTS qbo_net_fee_status VARCHAR;

-- 6. ssg_enrolments — personal data masking flag (idempotent)
ALTER TABLE public.ssg_enrolments
  ADD COLUMN IF NOT EXISTS personal_data_masked BOOLEAN NOT NULL DEFAULT FALSE;

CREATE INDEX IF NOT EXISTS idx_ssg_enrolments_personal_data_masked
  ON public.ssg_enrolments(personal_data_masked)
  WHERE personal_data_masked = TRUE;
