-- Migration: Non-WSQ (manual) classes for the Payroll role
-- Adds:
--   payroll_manual_class table — trainer-payout rows for non-WSQ / non-funded
--   classes that do NOT live in course/course_run (so they never appear in
--   Admin > Class Management, SSG, the scheduler, or the WSQ Payout List).
--
-- One row = one class = one trainer payout. Unlike trainer_payout (which is
-- materialised from course_run/course/enrollment), these rows are entered by
-- hand in the Payroll dashboard's "Non-WSQ Classes" view, so the class detail
-- and the payout live together in a single self-contained table.
--
-- Payout math mirrors trainer_payout / lib/payroll/calculate.ts:
--   estimated_payout = round(course_fee * num_learners * tier_percent) / 100
--
-- Safe to run repeatedly.

BEGIN;

CREATE TABLE IF NOT EXISTS public.payroll_manual_class (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    class_title TEXT NOT NULL,
    course_code TEXT,
    -- Trainer is stored by name so external / ad-hoc trainers are supported.
    -- trainer_id optionally links to a real account (nullable, kept if the
    -- account is later removed) for future payout-history integration.
    trainer_id UUID REFERENCES public.app_user(id) ON DELETE SET NULL,
    trainer_name TEXT NOT NULL,
    start_date DATE,
    end_date DATE,
    num_learners INT NOT NULL DEFAULT 0,
    course_fee NUMERIC(12,2) NOT NULL DEFAULT 0,
    tier_percent NUMERIC(5,2) NOT NULL DEFAULT 0,
    estimated_payout NUMERIC(12,2) NOT NULL DEFAULT 0,
    actual_payout NUMERIC(12,2),
    status TEXT NOT NULL DEFAULT 'pending'
        CHECK (status IN ('pending','completed','cancelled')),
    payment_date DATE,
    remark TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    created_by UUID REFERENCES public.app_user(id),
    updated_by UUID REFERENCES public.app_user(id)
);

CREATE INDEX IF NOT EXISTS idx_payroll_manual_class_status ON public.payroll_manual_class(status);
CREATE INDEX IF NOT EXISTS idx_payroll_manual_class_trainer ON public.payroll_manual_class(trainer_id);
CREATE INDEX IF NOT EXISTS idx_payroll_manual_class_end_date ON public.payroll_manual_class(end_date);

DROP TRIGGER IF EXISTS payroll_manual_class_touch_updated_at ON public.payroll_manual_class;
CREATE TRIGGER payroll_manual_class_touch_updated_at
    BEFORE UPDATE ON public.payroll_manual_class
    FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

COMMENT ON TABLE public.payroll_manual_class IS
  'Non-WSQ / non-funded classes entered by hand in the Payroll role. One row = one class = one trainer payout. Never referenced by course/course_run/SSG/scheduler code.';

COMMIT;
