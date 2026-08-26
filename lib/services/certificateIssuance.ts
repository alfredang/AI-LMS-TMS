/**
 * Shared "may this certificate be issued yet?" gate.
 *
 * Real incident (2026-08): learners could open Certificate History on the MORNING of
 * their class and click Download. The learner-facing download button falls back to
 * POST /api/learner/generate-certificate when no certificate exists yet, and that
 * route had no timing or attendance check — so a Certificate of Achievement was
 * minted hours before the class had even finished.
 *
 * Policy (agreed with the business):
 *   A certificate may only be issued when BOTH hold:
 *     1. The class is over, evidenced by ANY of:
 *          a. the run's end date has passed, or it is the end date and the local
 *             time is at or after ISSUE_HOUR_SGT (18:00 Asia/Singapore); OR
 *          b. the trainer marked the learner Competent (assessment done = class done
 *             for that learner); OR
 *          c. an admin/trainer is issuing manually (callers pass `manual: true`).
 *     2. The learner meets the configured minimum attendance.
 *
 *   Plus the existing cancellation guard (cancelled class / cancelled enrolment).
 *
 * Attendance is FAIL-CLOSED here, unlike `checkAttendanceGate` in learnerAttendance.ts:
 * that gate protects an admin-initiated push and errs toward not blocking staff, while
 * this one protects self-service issuance, where "no attendance recorded yet" is exactly
 * the morning-of-class state we must refuse. A manual issue by staff bypasses the
 * attendance requirement, since staff are making an explicit, accountable decision.
 */

import pool from '../db';
import { checkCertificateEligibility } from './enrolmentEligibility';

/** Earliest hour (Asia/Singapore, 24h) a certificate may auto-issue on the class end date. */
export const ISSUE_HOUR_SGT = 18;

export interface IssuanceDecision {
  /** True = safe to generate/issue the certificate. */
  allowed: boolean;
  /** Human-readable reason when blocked (surfaced to the learner). */
  reason?: string;
  /** Machine-readable blocker, for the UI to branch on. */
  code?: 'not_found' | 'ineligible' | 'class_not_ended' | 'attendance_not_met';
  attendancePercent?: number;
  attendanceThreshold?: number;
}

/** Configured minimum attendance %, from the column with the legacy admin_settings fallback. */
export async function getCertificateAttendanceThreshold(): Promise<number> {
  const { rows } = await pool.query(
    `SELECT certificate_attendance_threshold AS t, admin_settings FROM training_provider LIMIT 1`
  );
  const row = rows[0];
  if (!row) return 60;
  const fromColumn = parseFloat(String(row.t ?? '').replace('%', ''));
  if (!Number.isNaN(fromColumn) && fromColumn > 0) return fromColumn;
  const fromSettings = parseFloat(String(row.admin_settings?.certificateAttendanceThreshold ?? ''));
  if (!Number.isNaN(fromSettings) && fromSettings > 0) return fromSettings;
  return 60;
}

/**
 * Decide whether a certificate may be issued for one enrolment.
 *
 * @param enrolmentUuid enrollment.id
 * @param opts.manual   true when an admin/trainer explicitly issues it (skips the
 *                      end-of-day wait and the attendance minimum, but NOT the
 *                      cancelled-class/enrolment guard).
 */
export async function checkCertificateIssuance(
  enrolmentUuid: string,
  opts: { manual?: boolean } = {}
): Promise<IssuanceDecision> {
  const id = String(enrolmentUuid || '').trim();
  if (!id) return { allowed: false, reason: 'Enrolment not found', code: 'not_found' };

  // Existing cancellation guard applies to every path, manual included.
  const eligibility = await checkCertificateEligibility(id);
  if (!eligibility.eligible) {
    return { allowed: false, reason: `Certificate unavailable because ${eligibility.reason}.`, code: 'ineligible' };
  }

  if (opts.manual) return { allowed: true };

  const { rows } = await pool.query(
    `SELECT
        e.assessment_status,
        cr.id AS run_uuid,
        cr.end_date,
        -- Has the class finished? True once the end date is past, or once it is the
        -- end date and the Singapore clock has reached ISSUE_HOUR_SGT.
        (
          cr.end_date < (NOW() AT TIME ZONE 'Asia/Singapore')::date
          OR (
            cr.end_date = (NOW() AT TIME ZONE 'Asia/Singapore')::date
            AND EXTRACT(HOUR FROM (NOW() AT TIME ZONE 'Asia/Singapore')) >= $2
          )
        ) AS class_ended,
        -- Denominator: sessions where attendance was actually taken for anyone.
        (SELECT COUNT(*) FROM course_session cs
          WHERE cs.course_run_id = cr.id AND cs.deleted IS NOT TRUE
            AND EXISTS (SELECT 1 FROM course_attendance ca WHERE ca.session_id = cs.id)
        ) AS sessions_with_attendance,
        (SELECT COUNT(DISTINCT ca.session_id) FROM course_attendance ca
          WHERE ca.is_present = true
            AND (ca.nric = e.nric OR (e.user_id IS NOT NULL AND ca.user_id = e.user_id))
            AND ca.session_id IN (
              SELECT cs.id FROM course_session cs
               WHERE cs.course_run_id = cr.id AND cs.deleted IS NOT TRUE
                 AND EXISTS (SELECT 1 FROM course_attendance ca2 WHERE ca2.session_id = cs.id)
            )
        ) AS attended_count
       FROM enrollment e
       JOIN course_run cr ON cr.id = e.course_run_id
      WHERE e.id = $1
      LIMIT 1`,
    [id, ISSUE_HOUR_SGT]
  );

  if (rows.length === 0) return { allowed: false, reason: 'Enrolment not found', code: 'not_found' };
  const row = rows[0];

  // Condition 1: class over, OR the trainer already marked the learner Competent.
  const markedCompetent = ['competent', 'passed'].includes(String(row.assessment_status || '').trim().toLowerCase());
  if (!row.class_ended && !markedCompetent) {
    return {
      allowed: false,
      reason: `Your certificate will be available after the class ends (from ${ISSUE_HOUR_SGT}:00 on the last day), or once your trainer has assessed you as Competent.`,
      code: 'class_not_ended',
    };
  }

  // Condition 2: minimum attendance. Fail closed — no attendance taken yet means
  // the requirement is not yet demonstrated.
  const threshold = await getCertificateAttendanceThreshold();
  const sessionsWithAttendance = parseInt(row.sessions_with_attendance, 10) || 0;
  const attendedCount = parseInt(row.attended_count, 10) || 0;
  const percent = sessionsWithAttendance > 0
    ? Math.round((attendedCount / sessionsWithAttendance) * 1000) / 10
    : 0;

  if (sessionsWithAttendance === 0 || percent < threshold) {
    return {
      allowed: false,
      reason: sessionsWithAttendance === 0
        ? 'Your certificate will be available once attendance has been recorded for this class.'
        : `Minimum attendance not met (${percent}% recorded, ${threshold}% required).`,
      code: 'attendance_not_met',
      attendancePercent: percent,
      attendanceThreshold: threshold,
    };
  }

  return { allowed: true, attendancePercent: percent, attendanceThreshold: threshold };
}
