-- Add a second, editable course reference code ("new" ref code) alongside the
-- existing course_code (now surfaced in the UI as "Course Ref Code (Old)").
-- Lets admins record a replacement/renewed ref code without overwriting the
-- original. Nullable, no uniqueness constraint (the two codes may coexist and
-- a new code may be blank until assigned).
--
-- Safe to run repeatedly.

BEGIN;

ALTER TABLE public.course
    ADD COLUMN IF NOT EXISTS new_course_code text;

COMMIT;
