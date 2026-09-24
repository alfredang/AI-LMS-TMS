-- Trainers are also Learners.
-- Trainers sometimes enrol in the provider's own courses. With this flag on, every
-- user holding the Trainer role also holds Learner, so the login role picker offers
-- both modes: Learner (their own enrolments/submissions) and Trainer (only classes
-- they are assigned to — enforced server-side in lib/auth/courseRunAccess.ts).
--
-- Gated per tenant by training_provider.trainer_learner_dual_role (default OFF).
-- Enable on a tenant with:
--   UPDATE training_provider SET trainer_learner_dual_role = true;
-- which backfills Learner onto every existing trainer (trigger below). New Trainer
-- grants from any code path (add-trainer, bulk upload, save-course-run, role edits)
-- pick up Learner via the user_role_map trigger.
-- Idempotent.

ALTER TABLE public.training_provider
    ADD COLUMN IF NOT EXISTS trainer_learner_dual_role boolean DEFAULT false NOT NULL;

COMMENT ON COLUMN public.training_provider.trainer_learner_dual_role IS
    'When true, every Trainer is automatically also a Learner (user_role_map trigger).';

CREATE OR REPLACE FUNCTION public.trainer_learner_dual_role_enabled() RETURNS boolean
    LANGUAGE sql STABLE AS $$
    SELECT COALESCE(
        (SELECT trainer_learner_dual_role FROM public.training_provider ORDER BY id LIMIT 1),
        false
    )
$$;

-- New Trainer grant -> also grant Learner.
CREATE OR REPLACE FUNCTION public.grant_learner_to_trainer() RETURNS trigger
    LANGUAGE plpgsql AS $$
BEGIN
    IF public.trainer_learner_dual_role_enabled() THEN
        INSERT INTO public.user_role_map (user_id, role)
        VALUES (NEW.user_id, 'Learner')
        ON CONFLICT (user_id, role) DO NOTHING;
    END IF;
    RETURN NULL;
END
$$;

DROP TRIGGER IF EXISTS trg_grant_learner_to_trainer ON public.user_role_map;
CREATE TRIGGER trg_grant_learner_to_trainer
    AFTER INSERT ON public.user_role_map
    FOR EACH ROW WHEN (NEW.role = 'Trainer')
    EXECUTE FUNCTION public.grant_learner_to_trainer();

-- Flag switched on -> backfill Learner onto every existing trainer.
CREATE OR REPLACE FUNCTION public.backfill_learner_for_trainers() RETURNS trigger
    LANGUAGE plpgsql AS $$
BEGIN
    IF public.trainer_learner_dual_role_enabled() THEN
        INSERT INTO public.user_role_map (user_id, role)
        SELECT user_id, 'Learner' FROM public.user_role_map WHERE role = 'Trainer'
        ON CONFLICT (user_id, role) DO NOTHING;
    END IF;
    RETURN NULL;
END
$$;

DROP TRIGGER IF EXISTS trg_backfill_learner_for_trainers ON public.training_provider;
CREATE TRIGGER trg_backfill_learner_for_trainers
    AFTER UPDATE OF trainer_learner_dual_role ON public.training_provider
    FOR EACH ROW WHEN (NEW.trainer_learner_dual_role AND NOT OLD.trainer_learner_dual_role)
    EXECUTE FUNCTION public.backfill_learner_for_trainers();

-- Re-runs on an already-enabled tenant: close any gap.
INSERT INTO public.user_role_map (user_id, role)
SELECT user_id, 'Learner' FROM public.user_role_map
WHERE role = 'Trainer' AND public.trainer_learner_dual_role_enabled()
ON CONFLICT (user_id, role) DO NOTHING;
