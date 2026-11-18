-- Default trainer per course.
-- A course may name a default trainer (course.default_trainer_id). Whenever a new
-- course_run is created for that course WITHOUT a trainer — from any code path:
-- SSG/TPG sync, admin "add class", calendar import, enrolment-driven stubs — the
-- AFTER INSERT trigger assigns the default trainer locally (course_run_trainer
-- junction + legacy assigned_trainer_* columns). TPGateway then receives the trainer
-- through the nightly sync_trainer_to_tpg job (runs with a local trainer but no TPG
-- trainer), and the calendar through the LMS→calendar trainer sync.
-- The default trainer is pre-agreed, so no trainer invitation goes out (the invitation
-- job skips runs that already have a course_run_trainer row) and a Pending/Unconfirmed
-- run is set to Confirmed. Runs that already carry a trainer, or that are inserted as
-- Cancelled, are untouched; an admin can still change the trainer on any class by hand.
-- Set from the course editor → Course Settings → Default Trainer
-- (POST /api/course/default-trainer). Idempotent.

ALTER TABLE public.course
    ADD COLUMN IF NOT EXISTS default_trainer_id uuid REFERENCES public.app_user(id) ON DELETE SET NULL;

COMMENT ON COLUMN public.course.default_trainer_id IS
    'Trainer auto-assigned to every new run of this course that is created without a trainer (course_run trigger).';

CREATE OR REPLACE FUNCTION public.apply_course_default_trainer() RETURNS trigger
    LANGUAGE plpgsql AS $$
DECLARE
    v_trainer_id uuid;
    v_name text;
    v_email text;
BEGIN
    -- Only runs created with no trainer signal at all.
    IF NEW.assigned_trainer_id IS NOT NULL
       OR NEW.tpg_assigned_trainer_id IS NOT NULL
       OR NULLIF(BTRIM(COALESCE(NEW.assigned_trainer_name, '')), '') IS NOT NULL
       OR NULLIF(BTRIM(COALESCE(NEW.tpg_assigned_trainer_name, '')), '') IS NOT NULL
       OR NEW.class_status = 'Cancelled'
    THEN
        RETURN NULL;
    END IF;

    SELECT u.id, u.full_name, u.email
      INTO v_trainer_id, v_name, v_email
      FROM public.course c
      JOIN public.app_user u ON u.id = c.default_trainer_id
     WHERE c.id = NEW.course_id;

    IF v_trainer_id IS NULL THEN
        RETURN NULL;
    END IF;

    IF NOT EXISTS (SELECT 1 FROM public.course_run_trainer WHERE course_run_id = NEW.id) THEN
        INSERT INTO public.course_run_trainer (course_run_id, trainer_id, trainer_name, trainer_email)
        VALUES (NEW.id, v_trainer_id, v_name, v_email);
    END IF;

    -- The default trainer is pre-agreed: no invitation is needed and the class is
    -- confirmed as soon as it is created (Pending/Unconfirmed → Confirmed).
    UPDATE public.course_run
       SET assigned_trainer_id = v_trainer_id,
           assigned_trainer_name = v_name,
           assigned_trainer_email = v_email,
           class_status = CASE WHEN class_status IN ('Pending', 'Unconfirmed') THEN 'Confirmed'::public.class_status ELSE class_status END,
           updated_at = NOW()
     WHERE id = NEW.id AND assigned_trainer_id IS NULL;

    RETURN NULL;
END
$$;

DROP TRIGGER IF EXISTS trg_apply_course_default_trainer ON public.course_run;
CREATE TRIGGER trg_apply_course_default_trainer
    AFTER INSERT ON public.course_run
    FOR EACH ROW
    EXECUTE FUNCTION public.apply_course_default_trainer();
