-- Revert the CASL course_type reassignment back to WSQ.
--
-- On 2026-08-11, 24 courses were individually re-typed WSQ -> CASL through the
-- course editor (each one has a course_change_log row recording old_value='WSQ').
-- A 25th course (TGS-2026064860) was CREATED as CASL and never had a WSQ state.
--
-- The business decision (2026-08-13) is that CASL is not to be used. The enum
-- value is deliberately KEPT so historical log rows and any code paths that
-- reference it stay valid -- we only stop assigning it.
--
-- No other course fields were touched by the original change, so nothing else
-- needs restoring; description / course_outline / learning_outcomes /
-- funding_validity / course_fee are all still intact on every affected row.
--
-- Idempotent: re-running is a no-op once no CASL rows remain.

BEGIN;

-- 1. Log the reversal for each course we are about to change, so the change
--    history stays truthful and complete (mirrors the editor's own logging).
INSERT INTO course_change_log (course_id, field, field_label, old_value, new_value, changed_at, changed_by_name, note)
SELECT c.id,
       'courseType',
       'Course Type',
       'CASL',
       'WSQ',
       NOW(),
       'System (revert)',
       'Reverted to WSQ: CASL is no longer used.'
FROM course c
WHERE c.course_type = 'CASL';

-- 2. Move every CASL course back to WSQ.
UPDATE course
SET course_type = 'WSQ',
    updated_at  = NOW()
WHERE course_type = 'CASL';

COMMIT;
