-- Allow the TMS feedback form to retain the exact MMS handover identity for
-- Calendar/Master List classes that do not have a course_run UUID.
ALTER TABLE public.feedback_form_response
  ADD COLUMN IF NOT EXISTS source_run_key text;

CREATE INDEX IF NOT EXISTS idx_feedback_response_source_run_key
  ON public.feedback_form_response(source_run_key);

