/**
 * "Who is in this class" — the one rule every roster, class list, certificate and
 * assessment query must use (2026-11-19: 18 of 32 learners vanished from Assessment
 * Grading and lost their class mid-session because each screen filtered `Cancelled`
 * on its own).
 *
 * A learner joins a class through any of three sources, and each one is enough:
 *   1. self-registration — the sign-in help form, the SWDA Enrolment QR form, or a
 *      manual LMS enrolment;
 *   2. digital attendance — marked present in a session of the run;
 *   3. SWDA (TPGateway) enrolment.
 *
 * An `enrollment` row therefore counts unless staff or the trainer took the learner
 * off the class (`Admin Removed` / `Withdrawn`). `Cancelled` only describes the
 * TPGateway enrolment — staff cancel and re-create enrolments while a class is
 * running — so a Cancelled row still counts when source 1 or 2 holds. A Cancelled
 * row with neither (the learner cancelled and never came) stays off.
 *
 * Pure module (no DB import) so it can be unit-tested; the lazily created tables the
 * predicate reads are ensured by ./classMembershipTables.
 */
/** Statuses that mean the learner was taken off the class on purpose. */
export const REMOVED_FROM_CLASS_STATUSES = ['admin removed', 'withdrawn'];

/**
 * SQL predicate, true when the `enrollment` row aliased `alias` is a current member
 * of its class. `alias` is a server-defined identifier, never user input.
 */
export function classMemberSql(alias = 'e'): string {
  if (!/^[a-z_][a-z0-9_]*$/i.test(alias)) throw new Error(`Invalid SQL alias: ${alias}`);
  const e = alias;
  return `(
    LOWER(COALESCE(${e}.enrolment_status, '')) NOT IN ('admin removed', 'withdrawn', 'cancelled')
    OR (LOWER(${e}.enrolment_status) = 'cancelled' AND (
          -- digital attendance: marked present in this run
          EXISTS (
            SELECT 1
            FROM course_attendance cm_a
            JOIN course_session cm_s ON cm_s.id = cm_a.session_id
            WHERE cm_s.course_run_id = ${e}.course_run_id
              AND cm_a.is_present
              AND (cm_a.user_id = ${e}.user_id
                   OR (${e}.nric IS NOT NULL AND upper(cm_a.nric) = upper(${e}.nric)))
          )
          -- self-registration: SWDA Enrolment QR form
          OR EXISTS (
            SELECT 1
            FROM enrolment_detail_request cm_r
            WHERE cm_r.course_run_uuid = ${e}.course_run_id
              AND cm_r.status <> 'dismissed'
              AND (cm_r.enrollment_uuid = ${e}.id
                   OR cm_r.user_id = ${e}.user_id
                   OR (${e}.nric IS NOT NULL AND upper(cm_r.nric) = upper(${e}.nric)))
          )
          -- self-registration: sign-in help form (Register with your Course Run ID)
          OR EXISTS (
            SELECT 1
            FROM signin_help_request cm_h
            JOIN app_user cm_u ON lower(cm_u.email) = lower(cm_h.email)
            WHERE cm_h.course_run_uuid = ${e}.course_run_id
              AND cm_u.id = ${e}.user_id
          )
    ))
  )`;
}
