-- Migration: per-class disable of the auto courseware & attendance email
-- Adds a boolean flag on course_run so admins can opt a specific class out
-- of the scheduled auto_send_courseware_attendance task without affecting
-- any other class. Manual sends are not gated by this flag.
--
-- Safe to run repeatedly.

ALTER TABLE public.course_run
    ADD COLUMN IF NOT EXISTS courseware_email_disabled boolean DEFAULT false NOT NULL;

COMMENT ON COLUMN public.course_run.courseware_email_disabled IS
  'When true, the scheduled auto courseware & attendance email skips this course run.';
