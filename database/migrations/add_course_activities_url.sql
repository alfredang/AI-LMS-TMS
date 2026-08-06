-- Add the Activities / Lab URL to the course courseware links.
--
-- Sits alongside the existing courseware URLs (lesson_plan_url, learner_guide_url,
-- slides_url, trainer_slides_url, courseware_link). It points at the course's
-- hands-on lab / activities folder on Google Drive, and is surfaced to BOTH the
-- Learner and Trainer "my class" views so learners can reach the lab worksheets.
--
-- Safe to run repeatedly.

BEGIN;

ALTER TABLE public.course
    ADD COLUMN IF NOT EXISTS activities_url text;

COMMENT ON COLUMN public.course.activities_url IS
    'Activities / Lab URL — link to the course''s hands-on lab worksheets or activities folder. Visible to Learner and Trainer roles.';

COMMIT;
