-- Merge a duplicate course row created by a code renewal.
--
-- "Financial Analysis for Small and Medium Enterprises" exists twice:
--
--   TGS-2022014981 (39c9ddc2-...)  the REAL course -- 25 course_runs, 66 enrolments,
--                                  full description / outline / learning outcomes /
--                                  courseware URLs, fee, funding validity, TSC code.
--                                  Already carries new_course_code = TGS-2026064860
--                                  and already has a course_code_history row marking
--                                  TGS-2026064860 as the current code.
--
--   TGS-2026064860 (23224e41-...)  an EMPTY STUB created 2026-08-11 under the renewed
--                                  code instead of updating the row above. 0 runs,
--                                  0 enrolments, every content field NULL.
--
-- The renewal was therefore already modelled correctly on the real row; the stub adds
-- nothing and is what makes the course look "blank" in the editor -- the UI resolves
-- the new code to the stub rather than to the real course.
--
-- This deletes the stub. It does NOT touch the real course: the renewed code stays on
-- it via new_course_code + course_code_history, so the storefront URL carrying
-- TGS-2026064860 continues to resolve, and the course stays WSQ.
--
-- Safety: the stub is referenced by nothing except its own append-only change-log rows
-- (verified across all 9 FK tables: assessment, calendar_event, course_code_history,
-- course_run, course_title_history, enrollment, learning_unit, quiz_attempt). Those log
-- rows are re-pointed to the surviving course so the audit trail is not lost -- the log
-- is append-only and nothing reads it to decide behaviour, so re-pointing is safe.
--
-- Only rows with ZERO runs and ZERO enrolments are ever deleted; the guard below makes
-- that structural, so this cannot remove a course that carries learner data.
--
-- Idempotent: re-running is a no-op once the stub is gone.

BEGIN;

-- 1. Preserve the stub's audit-log rows by moving them onto the surviving course.
UPDATE course_change_log
SET course_id = (SELECT id FROM course WHERE course_code = 'TGS-2022014981')
WHERE course_id = (SELECT id FROM course WHERE course_code = 'TGS-2026064860')
  AND EXISTS (SELECT 1 FROM course WHERE course_code = 'TGS-2022014981');

-- 2. Record the merge itself.
INSERT INTO course_change_log (course_id, field, field_label, old_value, new_value, changed_at, changed_by_name, note)
SELECT c.id, 'courseCode', 'Course Code', 'TGS-2026064860 (duplicate row)', 'TGS-2022014981',
       NOW(), 'System (merge)',
       'Merged the empty duplicate row created under renewed code TGS-2026064860 into this course. Renewed code retained via new_course_code / course_code_history.'
FROM course c
WHERE c.course_code = 'TGS-2022014981'
  AND EXISTS (SELECT 1 FROM course WHERE course_code = 'TGS-2026064860');

-- 3. Delete the empty duplicate -- but ONLY if it genuinely carries no learner data.
DELETE FROM course c
WHERE c.course_code = 'TGS-2026064860'
  AND NOT EXISTS (SELECT 1 FROM course_run  r WHERE r.course_id = c.id)
  AND NOT EXISTS (SELECT 1 FROM enrollment  e WHERE e.course_id = c.id)
  AND NOT EXISTS (SELECT 1 FROM assessment  a WHERE a.course_id = c.id)
  AND NOT EXISTS (SELECT 1 FROM quiz_attempt q WHERE q.course_id = c.id);

-- 4. Make sure the surviving course still carries the renewed code.
UPDATE course
SET new_course_code = 'TGS-2026064860'
WHERE course_code = 'TGS-2022014981'
  AND (new_course_code IS DISTINCT FROM 'TGS-2026064860');

COMMIT;
