-- Cleanup Script: Soft-delete enrollments whose SSG enrolment is Cancelled
-- 
-- This script finds all enrollment rows where the SSG enrolment status
-- is 'Cancelled' but the local enrollment row does NOT yet have
-- enrolment_status = 'Cancelled' (or is NULL).
-- It updates them to 'Cancelled' so they are filtered out of class lists
-- and courseware access.
--
-- Run this in your PostgreSQL client (e.g. pgAdmin, psql, DBeaver).

-- Step 1: DRY RUN — Preview which rows will be updated
SELECT 
    au.full_name AS learner_name,
    au.email,
    e.enrolment_id,
    e.enrolment_status AS current_local_status,
    cr.course_run_id,
    c.title AS course_title
FROM enrollment e
JOIN app_user au ON au.id = e.user_id
JOIN course_run cr ON cr.id = e.course_run_id
JOIN course c ON c.id = e.course_id
LEFT JOIN ssg_enrolments se ON se.enrolment_ref = e.enrolment_id
WHERE (
    -- Case A: SSG enrolments table has status = Cancelled
    LOWER(COALESCE(se.status, '')) = 'cancelled'
    -- Case B: Local enrolment_status is already Cancelled but not yet cleaned
    OR LOWER(COALESCE(e.enrolment_status, '')) = 'cancelled'
)
AND LOWER(COALESCE(e.enrolment_status, '')) NOT IN ('admin removed')
ORDER BY cr.course_run_id, au.full_name;

-- Step 2: ACTUAL UPDATE — Uncomment and run after verifying Step 1
-- UPDATE enrollment
-- SET enrolment_status = 'Cancelled', updated_at = NOW()
-- WHERE id IN (
--     SELECT e.id
--     FROM enrollment e
--     LEFT JOIN ssg_enrolments se ON se.enrolment_ref = e.enrolment_id
--     WHERE (
--         LOWER(COALESCE(se.status, '')) = 'cancelled'
--         OR LOWER(COALESCE(e.enrolment_status, '')) = 'cancelled'
--     )
--     AND LOWER(COALESCE(e.enrolment_status, '')) NOT IN ('admin removed', 'cancelled')
-- );

-- Step 3: Specific fix for ZHANG YANBAI on course run 1329352
-- This directly marks the enrollment as Cancelled
UPDATE enrollment
SET enrolment_status = 'Cancelled', updated_at = NOW()
WHERE enrolment_status IS DISTINCT FROM 'Cancelled'
  AND course_run_id = (
    SELECT id FROM course_run WHERE course_run_id = '1329352' LIMIT 1
  )
  AND user_id = (
    SELECT id FROM app_user WHERE LOWER(full_name) LIKE '%zhang yanbai%' LIMIT 1
  );

-- Signal the learner's client to refresh their course list
UPDATE app_user
SET courses_updated_at = NOW()
WHERE LOWER(full_name) LIKE '%zhang yanbai%';
