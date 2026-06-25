/**
 * Shared eligibility guard for outbound learner-facing artifacts.
 *
 * Prevents the system from issuing things that imply a learner completed a
 * class when they did not — specifically:
 *   - pushing an assessment result to SSG/TPGateway (which makes SSG issue a
 *     WSQ Statement of Attainment), and
 *   - generating / emailing a Certificate of Achievement.
 *
 * Real incident this addresses: a learner cancelled on TPG before the class
 * started and the class itself was Cancelled, yet a manual assessment push
 * still created a TPG assessment record (and thus an SOA). The local enrolment
 * status was stale (`Confirmed`) because TPG cancellations are not synced back,
 * so the reliable signal in that case was `course_run.class_status = 'Cancelled'`.
 *
 * Policy:
 *   - Block when the class is Cancelled OR the enrolment is cancelled/withdrawn/
 *     admin-removed.
 *   - When we cannot find the run/enrolment locally we CANNOT prove it is
 *     ineligible, so we allow it (least-disruptive — the bulk assessment tool is
 *     also used for learners not present in the local DB). The guard only blocks
 *     confirmed-bad cases.
 */

import pool from '../db';

/** Enrolment statuses that mean "not a valid, active enrolment". Compared case-insensitively. */
export const CANCELLED_ENROLMENT_STATUSES = ['cancelled', 'withdrawn', 'admin removed'];

export function isCancelledEnrolmentStatus(status: string | null | undefined): boolean {
  if (!status) return false;
  return CANCELLED_ENROLMENT_STATUSES.includes(status.trim().toLowerCase());
}

export function isCancelledClassStatus(status: string | null | undefined): boolean {
  if (!status) return false;
  return status.trim().toLowerCase() === 'cancelled';
}

export interface EligibilityResult {
  /** True = safe to issue assessment/cert. False = blocked. */
  eligible: boolean;
  /** Human-readable reason when blocked (suitable for surfacing to an admin). */
  reason?: string;
  classStatus?: string | null;
  enrolmentStatus?: string | null;
  /** False when no local run/enrolment row was found (we allowed it by default). */
  found: boolean;
}

function evaluate(classStatus: string | null, enrolmentStatus: string | null, found: boolean): EligibilityResult {
  if (!found) {
    return { eligible: true, found: false, classStatus, enrolmentStatus };
  }
  const reasons: string[] = [];
  if (isCancelledClassStatus(classStatus)) reasons.push('the class is Cancelled');
  if (isCancelledEnrolmentStatus(enrolmentStatus)) reasons.push(`the enrolment is ${enrolmentStatus}`);
  if (reasons.length > 0) {
    return { eligible: false, reason: reasons.join(' and '), classStatus, enrolmentStatus, found: true };
  }
  return { eligible: true, classStatus, enrolmentStatus, found: true };
}

/**
 * Eligibility lookup keyed on SSG-side identifiers (used by the assessment-push
 * endpoints, which receive an SSG course run id and an enrolment reference / NRIC).
 *
 * @param ssgCourseRunId           course_run.course_run_id (the SSG run id, e.g. "1077462")
 * @param enrolmentReferenceNumber enrollment.enrolment_id (e.g. "ENR-2603-044188"), optional
 * @param traineeId                learner NRIC/FIN, used as a fallback to locate the enrolment
 */
export async function checkAssessmentEligibility(opts: {
  ssgCourseRunId: string;
  enrolmentReferenceNumber?: string | null;
  traineeId?: string | null;
}): Promise<EligibilityResult> {
  const ssgCourseRunId = String(opts.ssgCourseRunId || '').trim();
  if (!ssgCourseRunId) return { eligible: true, found: false };

  const ref = String(opts.enrolmentReferenceNumber || '').trim();
  const nric = String(opts.traineeId || '').trim();

  const { rows } = await pool.query(
    `SELECT cr.class_status,
            (SELECT e.enrolment_status
               FROM enrollment e
              WHERE e.course_run_id = cr.id
                AND ( ($2 <> '' AND e.enrolment_id = $2)
                   OR ($3 <> '' AND e.nric = $3) )
              LIMIT 1) AS enrolment_status
       FROM course_run cr
      WHERE cr.course_run_id = $1
      LIMIT 1`,
    [ssgCourseRunId, ref, nric]
  );

  if (rows.length === 0) return { eligible: true, found: false };
  return evaluate(rows[0].class_status, rows[0].enrolment_status, true);
}

/**
 * Eligibility lookup keyed on the local enrollment UUID (used by the certificate
 * generation paths, which operate on enrollment.id).
 */
export async function checkCertificateEligibility(enrolmentUuid: string): Promise<EligibilityResult> {
  const id = String(enrolmentUuid || '').trim();
  if (!id) return { eligible: true, found: false };

  const { rows } = await pool.query(
    `SELECT cr.class_status, e.enrolment_status
       FROM enrollment e
       JOIN course_run cr ON cr.id = e.course_run_id
      WHERE e.id = $1
      LIMIT 1`,
    [id]
  );

  if (rows.length === 0) return { eligible: true, found: false };
  return evaluate(rows[0].class_status, rows[0].enrolment_status, true);
}
