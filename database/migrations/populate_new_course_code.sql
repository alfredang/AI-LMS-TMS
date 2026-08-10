-- Populate new_course_code (the "current" code) for every course that has never
-- been renewed, setting it equal to the original course_code.
--
-- The Course Editor shows both codes; a NULL new_course_code rendered the
-- "Course Code (Current)" field empty for the 279 never-renewed courses, which
-- read as missing data. The code in force for an unrenewed course IS its
-- original code, so store exactly that. Display logic already collapses the
-- pair when equal ("TGS-x" rather than "TGS-x (orig TGS-x)"), and every reader
-- uses COALESCE(NULLIF(new_course_code,''), course_code), for which this
-- change is a no-op.
--
-- Renewal detection is NOT affected: "has this course changed" is answered by
-- course_code_history row counts, never by new_course_code being set.
--
-- Idempotent: only touches rows where new_course_code is still unset.

UPDATE public.course
   SET new_course_code = course_code,
       updated_at      = now()
 WHERE NULLIF(new_course_code, '') IS NULL
   AND NULLIF(course_code, '') IS NOT NULL;
