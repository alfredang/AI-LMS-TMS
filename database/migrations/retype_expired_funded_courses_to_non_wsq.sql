-- Re-type funded courses whose funding validity has EXPIRED to Non-WSQ, so they
-- count as unfunded (the Course Management "Unfunded Courses" KPI and the
-- Funding Validity page both derive funded/unfunded purely from course_type).
--
-- Business decision (2026-09-02): a WSQ/CASL course whose funding validity end
-- date has passed is no longer fundable and must be listed as unfunded. The
-- expired courses are re-typed to 'Non-WSQ' and every funding-eligibility flag
-- is cleared (incl. UTAP -- decided explicitly for the two rows that carried it).
--
-- funding_validity is free TEXT, stored either as 'Mon DD, YYYY' (e.g.
-- 'Sep 27, 2026') or ISO 'YYYY-MM-DD...'. Anything else (or blank/NULL) does
-- not parse and is treated as NOT expired -- the UI renders those as "N/A",
-- never "Expired", so they are deliberately untouched here.
--
-- IBF is out of scope (different funding regime); Non-WSQ rows already carry
-- the target type. As of 2026-09-02 this matches 11 WSQ rows and 0 CASL rows.
--
-- Idempotent: matched rows leave the WSQ/CASL filter on the first run, so a
-- re-run is a no-op.

BEGIN;

-- Parse the free-text funding_validity into a date; NULL when unparseable.
CREATE OR REPLACE FUNCTION pg_temp.parse_funding_validity(v text)
RETURNS date
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT CASE
    WHEN v ~ '^\d{4}-\d{2}-\d{2}'            THEN substring(v from 1 for 10)::date
    WHEN v ~ '^[A-Za-z]{3} \d{1,2}, \d{4}$'  THEN to_date(v, 'Mon DD, YYYY')
    ELSE NULL
  END
$$;

-- 1. Log the re-type for each affected course (mirrors the editor's own logging;
--    same shape as revert_casl_to_wsq.sql). Only courseType is a tracked field,
--    so the flag clears below are not logged.
INSERT INTO course_change_log (course_id, field, field_label, old_value, new_value, changed_at, changed_by_name, note)
SELECT c.id,
       'courseType',
       'Course Type',
       c.course_type::text,
       'Non-WSQ',
       NOW(),
       'System (funding expiry)',
       'Funding validity ' || c.funding_validity || ' has expired: re-typed to Non-WSQ and listed as unfunded.'
FROM course c
WHERE c.course_type IN ('WSQ', 'CASL')
  AND pg_temp.parse_funding_validity(c.funding_validity) < CURRENT_DATE;

-- 2. Re-type and clear every funding-eligibility flag.
UPDATE course c
SET course_type                = 'Non-WSQ',
    is_wsq_funded              = false,
    is_skills_future_eligible  = false,
    is_psea_eligible           = false,
    is_mces_eligible           = false,
    is_ibf_funded              = false,
    is_utap_eligible           = false,
    updated_at                 = NOW()
WHERE c.course_type IN ('WSQ', 'CASL')
  AND pg_temp.parse_funding_validity(c.funding_validity) < CURRENT_DATE;

COMMIT;
