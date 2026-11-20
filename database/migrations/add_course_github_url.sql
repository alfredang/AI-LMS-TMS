-- Add the GitHub Link to the course record.
--
-- An optional link to the course's GitHub repository, edited in the Developer
-- course editor (placed after the SkillsFuture Link).
--
-- Developer-only: the course editor APIs return and accept it only for a
-- Developer (or a machine caller). It is NOT selected by the Learner or
-- Trainer class APIs and must not be added to them.
--
-- Safe to run repeatedly.

BEGIN;

ALTER TABLE public.course
    ADD COLUMN IF NOT EXISTS github_url text;

COMMENT ON COLUMN public.course.github_url IS
    'GitHub Link — the course''s GitHub repository. Developer-only; never returned to Learner or Trainer roles.';

COMMIT;
