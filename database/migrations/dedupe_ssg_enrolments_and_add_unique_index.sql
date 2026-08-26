-- Dedupe enrollment rows that share one SSG enrolment_id within a course run,
-- then enforce uniqueness so the duplicates cannot recur.
--
-- Root cause: the SSG syncs upsert on (user_id, course_run_id), and user_id is
-- resolved by email. When SSG corrects a trainee's email, a new app_user is
-- created and a second enrollment row is inserted for the same SSG enrolment
-- (seen live 2026-08-22: duplicate learners in Assessment Grading).
--
-- Keeps, per (course_run_id, enrolment_id) group, the row whose user has the
-- most activity (submissions > sessions > non-Pending status/certificate),
-- after first copying a certificate / competent status the keeper lacks from
-- the dropped row. Idempotent: re-running on a clean DB changes nothing.
-- user_session is referenced dynamically because older schemas predate it.

BEGIN;

DO $$
DECLARE
    session_score text := '0';
BEGIN
    IF to_regclass('public.user_session') IS NOT NULL THEN
        session_score := '(SELECT count(*) FROM user_session us WHERE us.user_id = e.user_id) * 10';
    END IF;

    EXECUTE format($sql$
        WITH dup_groups AS (
            SELECT course_run_id, enrolment_id
            FROM enrollment
            WHERE enrolment_id IS NOT NULL
            GROUP BY course_run_id, enrolment_id
            HAVING count(*) > 1
        ),
        scored AS (
            SELECT e.id, e.course_run_id, e.enrolment_id,
                   (SELECT count(*) FROM link_assessment_submission s
                     WHERE s.user_id = e.user_id AND s.course_run_id = e.course_run_id) * 100
                 + %s
                 + CASE WHEN e.assessment_status IS NOT NULL AND e.assessment_status::text <> 'Pending' THEN 50 ELSE 0 END
                 + CASE WHEN e.certificate IS NOT NULL THEN 50 ELSE 0 END AS score,
                   e.created_at
            FROM enrollment e
            JOIN dup_groups g USING (course_run_id, enrolment_id)
        ),
        keepers AS (
            SELECT DISTINCT ON (course_run_id, enrolment_id) id, course_run_id, enrolment_id
            FROM scored
            ORDER BY course_run_id, enrolment_id, score DESC, created_at ASC
        ),
        losers AS (
            SELECT s.id, k.id AS keeper_id
            FROM scored s
            JOIN keepers k ON k.course_run_id = s.course_run_id AND k.enrolment_id = s.enrolment_id
            WHERE s.id <> k.id
        ),
        merged AS (
            UPDATE enrollment k SET
                certificate = COALESCE(k.certificate, d.certificate),
                assessment_status = CASE
                    WHEN (k.assessment_status IS NULL OR k.assessment_status::text = 'Pending')
                         AND d.assessment_status IS NOT NULL AND d.assessment_status::text <> 'Pending'
                    THEN d.assessment_status ELSE k.assessment_status END,
                updated_at = NOW()
            FROM enrollment d
            JOIN losers l ON l.id = d.id
            WHERE k.id = l.keeper_id
            RETURNING k.id
        )
        DELETE FROM enrollment WHERE id IN (SELECT id FROM losers)
    $sql$, session_score);
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS enrollment_course_run_enrolment_id_key
    ON enrollment (course_run_id, enrolment_id)
    WHERE enrolment_id IS NOT NULL;

COMMIT;
