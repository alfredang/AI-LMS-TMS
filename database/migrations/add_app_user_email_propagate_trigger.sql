-- Migration: Auto-propagate app_user.email changes to denormalized trainer_email columns
--
-- Why: trainer_email is denormalized in 4 active tables. When a trainer changes
-- their primary email (or two accounts are merged into one), those denorm columns
-- drifted and listing endpoints that filter by email returned a partial list —
-- a real symptom seen on 2026-05-08 with Patrick Oh and 4 other trainers.
--
-- This trigger propagates app_user.email changes to:
--   - course_run_trainer.trainer_email (junction; primary source of truth)
--   - course_run.assigned_trainer_email (legacy scalar)
--   - course_run.tpg_assigned_trainer_email (TPG sync mirror)
--   - course_session.trainer_email (per-session override)
--
-- Log/history tables (trainer_invitation, auto_send_trainer_invitation_log,
-- sync_trainer_tpg_log, masterlist_table) are intentionally NOT touched —
-- they represent what was sent/recorded at the time, not current state.
--
-- Safe to run repeatedly.

BEGIN;

-- 1. Backfill any existing mismatches (one-off cleanup; idempotent).
UPDATE public.course_run_trainer crt
SET trainer_email = au.email
FROM public.app_user au
WHERE au.id = crt.trainer_id
  AND crt.trainer_email IS NOT NULL
  AND LOWER(crt.trainer_email) <> LOWER(au.email);

UPDATE public.course_run cr
SET assigned_trainer_email = au.email, updated_at = now()
FROM public.app_user au
WHERE au.id = cr.assigned_trainer_id
  AND cr.assigned_trainer_email IS NOT NULL
  AND LOWER(cr.assigned_trainer_email) <> LOWER(au.email);

UPDATE public.course_run cr
SET tpg_assigned_trainer_email = au.email, updated_at = now()
FROM public.app_user au
WHERE au.id = cr.tpg_assigned_trainer_id
  AND cr.tpg_assigned_trainer_email IS NOT NULL
  AND LOWER(cr.tpg_assigned_trainer_email) <> LOWER(au.email);

UPDATE public.course_session cs
SET trainer_email = au.email, updated_at = now()
FROM public.app_user au
WHERE au.id = cs.trainer_id
  AND cs.trainer_email IS NOT NULL
  AND LOWER(cs.trainer_email) <> LOWER(au.email);

-- 2. Trigger function: keep the 4 active denorm columns in lock-step with app_user.email.
CREATE OR REPLACE FUNCTION public.app_user_email_propagate()
RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.email IS DISTINCT FROM OLD.email THEN
    UPDATE public.course_run_trainer
       SET trainer_email = NEW.email
     WHERE trainer_id = NEW.id;

    UPDATE public.course_run
       SET assigned_trainer_email = NEW.email, updated_at = now()
     WHERE assigned_trainer_id = NEW.id;

    UPDATE public.course_run
       SET tpg_assigned_trainer_email = NEW.email, updated_at = now()
     WHERE tpg_assigned_trainer_id = NEW.id;

    UPDATE public.course_session
       SET trainer_email = NEW.email, updated_at = now()
     WHERE trainer_id = NEW.id;
  END IF;
  RETURN NEW;
END;
$$;

-- 3. Bind trigger.
DROP TRIGGER IF EXISTS app_user_email_propagate_trg ON public.app_user;
CREATE TRIGGER app_user_email_propagate_trg
  AFTER UPDATE OF email
  ON public.app_user
  FOR EACH ROW
  EXECUTE FUNCTION public.app_user_email_propagate();

COMMIT;
