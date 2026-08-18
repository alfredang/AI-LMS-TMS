-- Migration: payroll-local end-date override on trainer_payout
--
-- The class end date drives two things in Payroll: which month a payout falls
-- into, and the bill number / bill date of the QuickBooks bill raised when the
-- payout is confirmed (TX + YYMMDD of the end date — see trainer_bill).
--
-- When that date is wrong for billing purposes, Payroll needs to correct it
-- WITHOUT rewriting course_run.end_date, which SSG publishing, the scheduler,
-- attendance and Class Management all read. So the correction lives here, next
-- to the other payout-local snapshots (num_learners, course_fee, tier_percent),
-- and every payroll read resolves the effective date as:
--
--     COALESCE(tp.end_date_override, cr.end_date)
--
-- NULL (the default) means "just use the class's own end date".
--
-- Safe to run repeatedly.

BEGIN;

ALTER TABLE public.trainer_payout
    ADD COLUMN IF NOT EXISTS end_date_override DATE;

COMMENT ON COLUMN public.trainer_payout.end_date_override IS
  'Payroll-only correction to the class end date. NULL = use course_run.end_date. Drives the payout month and the trainer bill number/date; never written back to course_run.';

COMMIT;
