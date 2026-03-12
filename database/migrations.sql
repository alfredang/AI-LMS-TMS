-- ============================================================
-- Migration: Add secondary_email to app_user
-- ============================================================
ALTER TABLE public.app_user
  ADD COLUMN IF NOT EXISTS secondary_email text;

-- ============================================================
-- Migration: Add new columns to course
-- ============================================================
ALTER TABLE public.course
  ADD COLUMN IF NOT EXISTS course_fees_include_gst text,
  ADD COLUMN IF NOT EXISTS renewed_status text;

-- ============================================================
-- Migration: Add file_url to submission
-- ============================================================
ALTER TABLE public.submission
  ADD COLUMN IF NOT EXISTS file_url text;

-- ============================================================
-- Migration: Add unique constraint to submission
-- (safe — skips if already exists)
-- ============================================================
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'submission_enrollment_assessment_unique'
  ) THEN
    ALTER TABLE public.submission
      ADD CONSTRAINT submission_enrollment_assessment_unique
      UNIQUE (enrollment_id, assessment_id);
  END IF;
END$$;

-- ============================================================
-- Migration: Create index on submission for performance
-- ============================================================
CREATE INDEX IF NOT EXISTS idx_submission_user_course
  ON public.submission (enrollment_id, assessment_id);

-- ============================================================
-- Migration: Drop ra_code column from course_run
-- ra_code is the same as digital_attendance_id — use that instead
-- ============================================================
ALTER TABLE public.course_run DROP COLUMN IF EXISTS ra_code;
