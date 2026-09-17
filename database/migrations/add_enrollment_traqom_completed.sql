-- Track TRAQOM survey completion per learner.
-- SSG's attendance API only tells us the survey was *sent* (sentToTraqom); there is
-- no per-learner completion feed, so the trainer ticks this manually on the
-- Student Grading Roster (Trainer > Assessment Grading).
-- Idempotent.

ALTER TABLE public.enrollment
    ADD COLUMN IF NOT EXISTS traqom_completed boolean DEFAULT false NOT NULL;

ALTER TABLE public.enrollment
    ADD COLUMN IF NOT EXISTS traqom_completed_at timestamp with time zone;

COMMENT ON COLUMN public.enrollment.traqom_completed IS
    'Trainer-confirmed TRAQOM survey completion (manual tick on the grading roster).';
COMMENT ON COLUMN public.enrollment.traqom_completed_at IS
    'When traqom_completed was last set to true.';
