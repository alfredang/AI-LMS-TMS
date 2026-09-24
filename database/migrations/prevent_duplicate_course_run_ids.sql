-- Prevent future duplicate local rows for the same live SSG course run ID.
--
-- The existing unique constraint is scoped to (course_id, course_run_id). That
-- lets the same SSG run ID be inserted twice if a renewal code or bad lookup
-- resolves it to a different local course row. Existing duplicate data is left
-- untouched; this trigger blocks new active duplicates from this point forward.

CREATE INDEX IF NOT EXISTS idx_course_run_active_ssg_run_id
  ON public.course_run (btrim(course_run_id))
  WHERE COALESCE(is_deleted, false) = false
    AND course_run_id NOT LIKE 'STAGED-%'
    AND NULLIF(btrim(course_run_id), '') IS NOT NULL;

CREATE OR REPLACE FUNCTION public.prevent_duplicate_course_run_id()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  normalized_run_id text;
  duplicate_id uuid;
BEGIN
  normalized_run_id := NULLIF(btrim(NEW.course_run_id), '');

  IF normalized_run_id IS NULL
     OR normalized_run_id LIKE 'STAGED-%'
     OR COALESCE(NEW.is_deleted, false) = true THEN
    RETURN NEW;
  END IF;

  -- Serialize concurrent writers for the same SSG run ID so two racing inserts
  -- cannot both pass the existence check.
  PERFORM pg_advisory_xact_lock(hashtext('course_run_id:' || normalized_run_id));

  SELECT cr.id
    INTO duplicate_id
    FROM public.course_run cr
   WHERE btrim(cr.course_run_id) = normalized_run_id
     AND cr.id IS DISTINCT FROM NEW.id
     AND COALESCE(cr.is_deleted, false) = false
     AND cr.course_run_id NOT LIKE 'STAGED-%'
   LIMIT 1;

  IF duplicate_id IS NOT NULL THEN
    RAISE EXCEPTION
      'course_run_id % already exists on course_run %. SSG course run IDs must be unique locally.',
      normalized_run_id,
      duplicate_id
      USING ERRCODE = 'unique_violation';
  END IF;

  NEW.course_run_id := normalized_run_id;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_prevent_duplicate_course_run_id ON public.course_run;
CREATE TRIGGER trg_prevent_duplicate_course_run_id
BEFORE INSERT OR UPDATE OF course_run_id, is_deleted
ON public.course_run
FOR EACH ROW
EXECUTE FUNCTION public.prevent_duplicate_course_run_id();
