-- Migration: non-consecutive class dates for non-WSQ (manual) payroll classes.
--
-- A non-WSQ class may run on dates that are NOT a single contiguous range
-- (e.g. 1, 3, 5 Jul). start_date/end_date can only express one span, so we add
-- `class_dates`: a comma-separated list of ISO dates (YYYY-MM-DD) holding the
-- exact set the Payroll user picked. start_date/end_date are kept as the
-- min/max of that set for sorting + backward compatibility.
--
-- Safe to run repeatedly.

BEGIN;

ALTER TABLE public.payroll_manual_class
  ADD COLUMN IF NOT EXISTS class_dates TEXT;

COMMENT ON COLUMN public.payroll_manual_class.class_dates IS
  'Comma-separated ISO dates (YYYY-MM-DD) the class runs on — supports non-consecutive dates. start_date/end_date mirror the min/max.';

COMMIT;
