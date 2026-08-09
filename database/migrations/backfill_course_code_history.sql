-- Backfill course_code_history from the legacy course.course_code /
-- course.new_course_code columns.
--
-- Rules:
--   * course_code      -> a history row. Current UNLESS new_course_code holds a
--                         different code, in which case course_code is the
--                         superseded one.
--   * new_course_code  -> a history row marked current, when it is present and
--                         differs from course_code.
--   * Codes already present are left untouched (ON CONFLICT DO NOTHING), so
--     this is safe to re-run and safe to run after manual corrections.
--
-- Collisions where one course's new_course_code is another course row's primary
-- course_code are NOT resolved here -- those are duplicate course records that
-- need a deliberate merge first. The unique index on (code) will simply skip the
-- second claimant, leaving the code attached to whichever course already owns it.
--
-- Idempotent: safe to re-run.

-- 1. The superseded / original code.
INSERT INTO public.course_code_history (course_id, code, is_current, note)
SELECT c.id,
       c.course_code,
       -- current only when there is no distinct newer code
       (NULLIF(c.new_course_code, '') IS NULL OR c.new_course_code = c.course_code),
       'backfill: course.course_code'
FROM public.course c
WHERE NULLIF(c.course_code, '') IS NOT NULL
ON CONFLICT (code) DO NOTHING;

-- 2. The renewed code, when distinct.
INSERT INTO public.course_code_history (course_id, code, is_current, note)
SELECT c.id,
       c.new_course_code,
       true,
       'backfill: course.new_course_code'
FROM public.course c
WHERE NULLIF(c.new_course_code, '') IS NOT NULL
  AND c.new_course_code IS DISTINCT FROM c.course_code
ON CONFLICT (code) DO NOTHING;
