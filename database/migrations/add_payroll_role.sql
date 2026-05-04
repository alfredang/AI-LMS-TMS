-- Migration: Payroll role + trainer payout tracking
-- Adds:
--   1. 'Payroll' value to user_role enum
--   2. payroll_tiers JSONB column on training_provider (tiered % of course fee paid to trainer)
--   3. trainer_payout table (per-(course_run, trainer) row)
--   4. Role assignment to tansc@tertiaryinfotech.com and angch@tertiaryinfotech.com
--
-- Safe to run repeatedly.

-- 1. Append 'Payroll' to user_role enum (Postgres 12+)
ALTER TYPE public.user_role ADD VALUE IF NOT EXISTS 'Payroll' AFTER 'Finance';

-- 2. Tier configuration column (default = 1 pax 70%, 2 pax 60%, 3-4 pax 50%, 5+ pax 40%)
ALTER TABLE public.training_provider
    ADD COLUMN IF NOT EXISTS payroll_tiers JSONB
    DEFAULT '[
        {"minPax": 1, "maxPax": 1, "percent": 70},
        {"minPax": 2, "maxPax": 2, "percent": 60},
        {"minPax": 3, "maxPax": 4, "percent": 50},
        {"minPax": 5, "maxPax": null, "percent": 40}
    ]'::jsonb;

COMMENT ON COLUMN public.training_provider.payroll_tiers IS
  'Trainer payout tier ladder. Array of {minPax, maxPax (null = open ended), percent}. Each row payout = course_fee * num_learners * percent / 100.';

-- 3. trainer_payout table
CREATE TABLE IF NOT EXISTS public.trainer_payout (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    course_run_id UUID NOT NULL REFERENCES public.course_run(id) ON DELETE CASCADE,
    trainer_id UUID NOT NULL,
    num_learners INT NOT NULL,
    course_fee NUMERIC(12,2) NOT NULL,
    tier_percent NUMERIC(5,2) NOT NULL,
    estimated_payout NUMERIC(12,2) NOT NULL,
    actual_payout NUMERIC(12,2),
    status TEXT NOT NULL DEFAULT 'pending'
        CHECK (status IN ('pending','completed','cancelled')),
    payment_date DATE,
    remark TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_by UUID REFERENCES public.app_user(id),
    UNIQUE (course_run_id, trainer_id)
);

CREATE INDEX IF NOT EXISTS idx_trainer_payout_status ON public.trainer_payout(status);
CREATE INDEX IF NOT EXISTS idx_trainer_payout_trainer ON public.trainer_payout(trainer_id);
CREATE INDEX IF NOT EXISTS idx_trainer_payout_course_run ON public.trainer_payout(course_run_id);

DROP TRIGGER IF EXISTS trainer_payout_touch_updated_at ON public.trainer_payout;
CREATE TRIGGER trainer_payout_touch_updated_at
    BEFORE UPDATE ON public.trainer_payout
    FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

-- 4. Assign Payroll role to the two staff (no-op if user doesn't exist yet)
INSERT INTO public.user_role_map (user_id, role)
SELECT id, 'Payroll'::public.user_role
  FROM public.app_user
 WHERE email IN ('tansc@tertiaryinfotech.com', 'angch@tertiaryinfotech.com')
ON CONFLICT (user_id, role) DO NOTHING;
