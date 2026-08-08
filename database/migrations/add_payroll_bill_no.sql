-- Migration: Bill No (QuickBooks reference) for trainer payouts
-- Adds:
--   bill_no TEXT on trainer_payout (WSQ) and payroll_manual_class (non-WSQ)
--
-- Mirrors the legacy Excel "QB REF Nos" column: TX + YYMMDD + a 2-digit
-- per-day sequence, e.g. the 5th bill raised for classes dated 6 Mar 2026 is
-- TX26030605. The date part comes from the class start date (first class date
-- for multi-date non-WSQ classes), NOT the payment date, so the ref sorts and
-- reconciles the same way the spreadsheet did.
--
-- The number is issued when the payout row is created (see lib/payroll/billNo.ts
-- and backfill_payroll_bill_no.sql for history) and stays editable — Payroll can
-- paste a legacy QuickBooks ref or correct a wrong one.
--
-- Uniqueness is enforced across BOTH tables by a shared sequence allocator that
-- reads the max suffix already used for that day; a partial unique index per
-- table keeps a duplicate from being written directly. NULL (not yet billed)
-- is exempt, and multiple NULLs are allowed.
--
-- Safe to run repeatedly.

BEGIN;

ALTER TABLE public.trainer_payout
    ADD COLUMN IF NOT EXISTS bill_no TEXT;

ALTER TABLE public.payroll_manual_class
    ADD COLUMN IF NOT EXISTS bill_no TEXT;

COMMENT ON COLUMN public.trainer_payout.bill_no IS
  'QuickBooks bill reference, format TX<YYMMDD><NN> derived from the class start date + per-day sequence. Issued at row creation; editable. NULL = awaiting a class date.';

COMMENT ON COLUMN public.payroll_manual_class.bill_no IS
  'QuickBooks bill reference, format TX<YYMMDD><NN> derived from the first class date + per-day sequence. Issued at row creation; editable. NULL = awaiting a class date.';

-- Partial unique indexes: a bill number is unique within its table when set.
-- Cross-table collisions are prevented by the allocator in lib/payroll/billNo.ts,
-- which scans both tables before issuing the next suffix.
CREATE UNIQUE INDEX IF NOT EXISTS idx_trainer_payout_bill_no
    ON public.trainer_payout(bill_no) WHERE bill_no IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_payroll_manual_class_bill_no
    ON public.payroll_manual_class(bill_no) WHERE bill_no IS NOT NULL;

COMMIT;
