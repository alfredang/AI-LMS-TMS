-- Per-session trainer override columns on course_session.
--
-- Granular trainer assignment: by default every session in a course run
-- inherits the run-level trainer from the course_run_trainer junction
-- table. An admin can override a specific session to point at a different
-- trainer, which is stored inline on the session row.
--
-- Semantics:
--   trainer_id IS NULL  → session inherits run-level default
--   trainer_id NOT NULL → session has its own trainer (override)
--
-- The name and email columns are denormalised cache fields so the
-- Sessions list doesn't have to join app_user/trainer_profile on every
-- render. They are written in lock-step with trainer_id.
--
-- Safe to re-run — IF NOT EXISTS makes it idempotent.

ALTER TABLE public.course_session
  ADD COLUMN IF NOT EXISTS trainer_id    UUID,
  ADD COLUMN IF NOT EXISTS trainer_name  TEXT,
  ADD COLUMN IF NOT EXISTS trainer_email TEXT;

COMMENT ON COLUMN public.course_session.trainer_id IS
  'Per-session trainer override. NULL means inherit run-level trainer from course_run_trainer.';
COMMENT ON COLUMN public.course_session.trainer_name IS
  'Cached trainer name for override, written in lock-step with trainer_id.';
COMMENT ON COLUMN public.course_session.trainer_email IS
  'Cached trainer email for override, written in lock-step with trainer_id.';

CREATE INDEX IF NOT EXISTS idx_course_session_trainer_id
  ON public.course_session(trainer_id)
  WHERE trainer_id IS NOT NULL;
