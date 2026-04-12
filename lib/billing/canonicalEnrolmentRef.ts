/**
 * SQL fragments for resolving the authoritative SSG enrolment reference (ENR-…).
 * Prefer `ssg_enrolments` matched by learner email + course run (matches admin / SSG),
 * then `enrollment.enrolment_id`, then `raw_data`.
 *
 * Requires query aliases: `e` (enrollment), `u` (app_user), `cr` (course_run).
 */
export const BILLING_CANON_ENR_SQL = `COALESCE(
  NULLIF(TRIM((SELECT se.enrolment_id::text FROM public.ssg_enrolments se
    WHERE LOWER(TRIM(COALESCE(se.raw_data->'trainee'->'email'->>'full', ''))) = LOWER(TRIM(COALESCE(u.email::text, '')))
      AND COALESCE(NULLIF(TRIM(se.course_run_id::text), ''), '') = COALESCE(NULLIF(TRIM(cr.course_run_id::text), ''), '')
    ORDER BY se.imported_at DESC NULLS LAST, se.created_date DESC NULLS LAST
    LIMIT 1)), ''),
  NULLIF(TRIM(e.enrolment_id::text), ''),
  NULLIF(TRIM(e.raw_data->>'referenceNumber'), ''),
  NULLIF(TRIM(e.raw_data->'enrolment'->>'referenceNumber'), '')
)`;

export const BILLING_ENR_NORM_SQL = `LOWER(TRIM(${BILLING_CANON_ENR_SQL}))`;
