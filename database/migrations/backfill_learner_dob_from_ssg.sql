-- Backfill learner_profile.dob from SSG enrolment data stored in
-- enrollment.raw_data->trainee->dateOfBirth.
--
-- SSG returns trainee DOB in every enrolment record. The sync was
-- not storing it on learner_profile until this fix. This one-shot
-- migration extracts DOB from the most recent enrolment raw_data
-- for each learner and writes it to learner_profile.dob.
--
-- Safe to re-run — only updates rows where dob IS NULL.

UPDATE learner_profile lp
SET dob = (
    SELECT (e.raw_data->'trainee'->>'dateOfBirth')::date
    FROM enrollment e
    WHERE e.user_id = lp.user_id
      AND e.raw_data IS NOT NULL
      AND e.raw_data->'trainee'->>'dateOfBirth' IS NOT NULL
      AND e.raw_data->'trainee'->>'dateOfBirth' <> ''
    ORDER BY e.created_at DESC
    LIMIT 1
)
WHERE lp.dob IS NULL
  AND EXISTS (
    SELECT 1 FROM enrollment e
    WHERE e.user_id = lp.user_id
      AND e.raw_data IS NOT NULL
      AND e.raw_data->'trainee'->>'dateOfBirth' IS NOT NULL
      AND e.raw_data->'trainee'->>'dateOfBirth' <> ''
  );
