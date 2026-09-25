-- Remember the learner's "Assessment Records" Drive folder per submission so the
-- grading roster can link straight to it. Filled at upload time; older rows are
-- back-filled lazily from the file's Drive parent when the roster is loaded.
-- Idempotent.

ALTER TABLE public.link_assessment_submission
    ADD COLUMN IF NOT EXISTS drive_folder_id text;

COMMENT ON COLUMN public.link_assessment_submission.drive_folder_id IS
    'Google Drive folder id the file was uploaded into (Course > Assessment Records > Session > Learner).';
