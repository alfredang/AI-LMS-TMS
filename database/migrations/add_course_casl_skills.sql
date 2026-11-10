-- Add course.casl_skills and move CASL courses' skill area out of the TSC fields.
--
-- CASL courses (SSG-approved, TGS-coded non-WSQ courses) are not mapped to a
-- Skills Framework TSC, so they have no TSC Title / TSC Code. The value that was
-- typed into "TSC Title" for them is the skill area the course covers; it now
-- lives in its own "CASL Skills" field, and both TSC fields become 'NA'
-- (lib/courseCaslSkills.ts CASL_NO_TSC — the editor and APIs enforce the same).
--
-- Every value overwritten is first written to course_change_log, so the previous
-- TSC Title / TSC Code of each course stays on record and can be restored.
--
-- Idempotent: the column add is IF NOT EXISTS, and the data move only touches
-- CASL rows whose TSC fields are not already 'NA'.

BEGIN;

ALTER TABLE public.course ADD COLUMN IF NOT EXISTS casl_skills TEXT;

CREATE TEMP TABLE casl_tsc_move ON COMMIT DROP AS
SELECT id,
       NULLIF(btrim(tsc_title), '') AS old_tsc_title,
       NULLIF(btrim(tsc_code), '')  AS old_tsc_code
FROM public.course
WHERE course_type = 'CASL'
  AND (tsc_title IS DISTINCT FROM 'NA' OR tsc_code IS DISTINCT FROM 'NA');

-- 1. Log the change for each field that actually changes.
INSERT INTO course_change_log (course_id, field, field_label, old_value, new_value, changed_at, changed_by_name, note)
SELECT m.id, 'tscTitle', 'TSC Title', m.old_tsc_title, 'NA', NOW(), 'System (migration)',
       'CASL courses have no TSC Title; previous value moved to CASL Skills.'
FROM casl_tsc_move m
WHERE m.old_tsc_title IS DISTINCT FROM 'NA'
UNION ALL
SELECT m.id, 'tscCode', 'TSC Code', m.old_tsc_code, 'NA', NOW(), 'System (migration)',
       'CASL courses have no TSC Code.'
FROM casl_tsc_move m
WHERE m.old_tsc_code IS DISTINCT FROM 'NA';

-- 2. Move the TSC Title into CASL Skills (never overwrite a CASL Skills value
--    already entered) and set both TSC fields to 'NA'.
UPDATE public.course c
SET casl_skills = COALESCE(NULLIF(btrim(c.casl_skills), ''),
                           CASE WHEN m.old_tsc_title ~* '^(n/?a|-)$' THEN NULL ELSE m.old_tsc_title END),
    tsc_title   = 'NA',
    tsc_code    = 'NA',
    updated_at  = NOW()
FROM casl_tsc_move m
WHERE c.id = m.id;

COMMIT;
