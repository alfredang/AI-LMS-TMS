/**
 * Shared reschedule logic — LMS readiness check + calendar readiness + full flow execution.
 *
 * Execution order (TPG first so external system is the commit point):
 *   1. TPG repoint  — move the SSG enrolment reference to the target run
 *   2. LMS move     — UPDATE enrollment.course_run_id to target
 *   3. GCal move    — remove learner from current run events, add to target run events
 *
 * executeRescheduleFlow accepts a previousResult so retries can skip already-completed steps.
 *
 * Used by:
 *   pages/api/admin/reschedule-request-readiness.ts     (UI preflight — LMS + calendar)
 *   pages/api/admin/action-reschedule-request.ts        (manual approve + retry)
 *   pages/api/external/reschedule-request.ts            (auto-approve at ingestion)
 *   pages/api/external/auto-approve-reschedule-requests (daily cron — pending + failed retry)
 */

import { patchRunAttendee } from './calendar/runAttendees';
import { repointEnrolmentPreMove } from './ssg/mutateEnrolmentForLearner';

type QueryFn = (sql: string, params?: any[]) => Promise<{ rows: any[] }>;

export interface LmsReadinessResult {
  canApprove: boolean;
  blockers: string[];
  lms: {
    current_enrolment_found: boolean;
    target_in_lms: boolean;
    same_course: boolean;
    target_not_cancelled: boolean;
    has_sessions: boolean;
    no_conflict: boolean;
  };
}

/**
 * Run all LMS-side readiness checks for a reschedule request.
 * Returns canApprove=true only when there are zero hard blockers.
 * Does NOT hit SSG/TPG — call-site handles that separately.
 */
export async function checkLmsReadiness(
  rr: { current_run_id: string | null; target_run_id: string | null; learner_email: string },
  query: QueryFn
): Promise<LmsReadinessResult> {
  const blockers: string[] = [];
  const lms = {
    current_enrolment_found: false,
    target_in_lms: false,
    same_course: false,
    target_not_cancelled: false,
    has_sessions: false,
    no_conflict: false,
  };

  if (!rr.current_run_id || !rr.target_run_id) {
    blockers.push('Request is missing a current or target run id — cannot auto-move (manual move required).');
    return { canApprove: false, blockers, lms };
  }

  const runs = (await query(
    `SELECT
       (SELECT id        FROM course_run WHERE course_run_id = $1 LIMIT 1) AS cur_uuid,
       (SELECT course_id FROM course_run WHERE course_run_id = $1 LIMIT 1) AS cur_course,
       (SELECT id        FROM course_run WHERE course_run_id = $2 LIMIT 1) AS tgt_uuid,
       (SELECT course_id FROM course_run WHERE course_run_id = $2 LIMIT 1) AS tgt_course,
       (SELECT class_status::text FROM course_run WHERE course_run_id = $2 LIMIT 1) AS tgt_status,
       (SELECT COUNT(*) FROM course_session s
          JOIN course_run cr ON cr.id = s.course_run_id
         WHERE cr.course_run_id = $2 AND s.deleted = false
           AND s.start_date ~ '^[0-9]{8}$') AS tgt_sessions`,
    [rr.current_run_id, rr.target_run_id]
  )).rows[0];

  const curUuid = runs.cur_uuid as string | null;
  const tgtUuid = runs.tgt_uuid as string | null;

  lms.target_in_lms = !!tgtUuid;
  if (!tgtUuid) blockers.push(`Target run ${rr.target_run_id} not found in the LMS.`);
  if (!curUuid) blockers.push(`Current run ${rr.current_run_id} not found in the LMS.`);

  lms.same_course = !!(runs.cur_course && runs.tgt_course && runs.cur_course === runs.tgt_course);
  if (curUuid && tgtUuid && !lms.same_course) {
    blockers.push('Target run belongs to a different course than the current run.');
  }

  lms.target_not_cancelled = !!tgtUuid && String(runs.tgt_status || '').toLowerCase() !== 'cancelled';
  if (tgtUuid && !lms.target_not_cancelled) blockers.push('Target run is cancelled in the LMS.');

  lms.has_sessions = Number(runs.tgt_sessions || 0) > 0;
  if (tgtUuid && !lms.has_sessions) blockers.push('Target run has no active sessions in the LMS.');

  if (curUuid) {
    const enrol = await query(
      `SELECT e.id FROM enrollment e
         LEFT JOIN app_user u ON u.id = e.user_id
        WHERE (LOWER(u.email) = LOWER($1) OR LOWER(e.email) = LOWER($1))
          AND e.course_run_id = $2
          AND LOWER(COALESCE(e.enrolment_status, '')) NOT IN ('admin removed', 'cancelled', 'withdrawn')
        LIMIT 1`,
      [rr.learner_email, curUuid]
    );
    lms.current_enrolment_found = enrol.rows.length > 0;
    if (!lms.current_enrolment_found) {
      blockers.push(`No active enrollment found for ${rr.learner_email} in the current run.`);
    }
  }

  if (tgtUuid) {
    const conflict = await query(
      `SELECT e.id FROM enrollment e
         LEFT JOIN app_user u ON u.id = e.user_id
        WHERE (LOWER(u.email) = LOWER($1) OR LOWER(e.email) = LOWER($1))
          AND e.course_run_id = $2
        LIMIT 1`,
      [rr.learner_email, tgtUuid]
    );
    lms.no_conflict = conflict.rows.length === 0;
    if (!lms.no_conflict) blockers.push('Learner is already enrolled in the target run.');
  }

  return { canApprove: blockers.length === 0, blockers, lms };
}

// ── Calendar readiness ────────────────────────────────────────────────────────

export interface CalendarReadinessResult {
  canSync: boolean;
  blockers: string[];
  target_has_calendar: boolean;
  current_has_calendar: boolean;
}

/**
 * Check whether both runs have Google Calendar events in course_run_calendar_event.
 * A missing target calendar event is a hard blocker (we can't add the learner).
 * A missing current calendar event is not a hard blocker (learner just won't be
 * removed from an old event, which is acceptable).
 */
export async function checkCalendarReadiness(
  rr: { current_run_id: string | null; target_run_id: string | null },
  query: QueryFn
): Promise<CalendarReadinessResult> {
  let target_has_calendar = false;
  let current_has_calendar = false;
  const blockers: string[] = [];

  if (!rr.target_run_id) {
    blockers.push('Target run ID is missing — cannot check calendar readiness.');
    return { canSync: false, blockers, target_has_calendar, current_has_calendar };
  }

  try {
    const row = (await query(
      `SELECT
         (SELECT COUNT(*)::int FROM course_run_calendar_event cce
            JOIN course_run cr ON cr.id = cce.course_run_id
           WHERE cr.course_run_id = $1) AS cur_events,
         (SELECT COUNT(*)::int FROM course_run_calendar_event cce
            JOIN course_run cr ON cr.id = cce.course_run_id
           WHERE cr.course_run_id = $2) AS tgt_events`,
      [rr.current_run_id || '', rr.target_run_id]
    )).rows[0];

    current_has_calendar = Number(row?.cur_events || 0) > 0;
    target_has_calendar  = Number(row?.tgt_events || 0) > 0;

    if (!target_has_calendar) {
      blockers.push(
        `Target run ${rr.target_run_id} has no Google Calendar event yet — ` +
        `create the calendar event for this run before approving.`
      );
    }
  } catch (e: any) {
    blockers.push(`Calendar readiness check failed: ${e?.message || 'database error'}`);
  }

  return { canSync: blockers.length === 0, blockers, target_has_calendar, current_has_calendar };
}

// ── Full reschedule flow ──────────────────────────────────────────────────────

export interface RescheduleFlowResult {
  // Step 1 — TPG (external commit, happens first)
  tpg_synced: boolean;
  tpg_status: string | null;
  tpg_enrolment_ref: string | null;
  tpg_note: string;
  // Step 2 — LMS
  enrollment_moved: boolean;
  enrollment_id: string | null;
  // Step 3 — Google Calendar
  calendar_synced: boolean;
  calendar_remove_status: string | null;
  calendar_add_status: string | null;
  calendar_note: string;
  // Overall
  error: string | null;
}

/**
 * Execute the full reschedule flow: TPG repoint → LMS move → GCal move.
 *
 * TPG is done FIRST so the external system is the commit point. If TPG fails,
 * nothing local changes and the request can be safely retried.
 *
 * Pass previousResult from a failed prior attempt to skip already-completed steps
 * (idempotent retry). Each step is skipped when its "done" flag is true in previousResult.
 *
 * Does NOT update the mms_reschedule_request row — caller handles that.
 */
export async function executeRescheduleFlow(
  rr: { current_run_id: string; target_run_id: string; learner_email: string },
  query: QueryFn,
  previousResult?: Partial<RescheduleFlowResult>
): Promise<RescheduleFlowResult> {
  const result: RescheduleFlowResult = {
    tpg_synced: previousResult?.tpg_synced ?? false,
    tpg_status: previousResult?.tpg_status ?? null,
    tpg_enrolment_ref: previousResult?.tpg_enrolment_ref ?? null,
    tpg_note: previousResult?.tpg_note ?? '',
    enrollment_moved: previousResult?.enrollment_moved ?? false,
    enrollment_id: previousResult?.enrollment_id ?? null,
    calendar_synced: previousResult?.calendar_synced ?? false,
    calendar_remove_status: previousResult?.calendar_remove_status ?? null,
    calendar_add_status: previousResult?.calendar_add_status ?? null,
    calendar_note: previousResult?.calendar_note ?? '',
    error: null,
  };

  // Resolve internal UUIDs once (needed by all three steps)
  const [curRun, tgtRun] = await Promise.all([
    query(`SELECT id FROM course_run WHERE course_run_id = $1 LIMIT 1`, [rr.current_run_id]),
    query(`SELECT id FROM course_run WHERE course_run_id = $1 LIMIT 1`, [rr.target_run_id]),
  ]);
  if (curRun.rows.length === 0) { result.error = `Current run ${rr.current_run_id} not found in LMS`; return result; }
  if (tgtRun.rows.length === 0) { result.error = `Target run ${rr.target_run_id} not found in LMS`; return result; }
  const currentRunUuid = curRun.rows[0].id as string;
  const targetRunUuid  = tgtRun.rows[0].id as string;

  // ── Step 1: TPG repoint ────────────────────────────────────────────────────
  // TPG is the external commit point. If it fails, nothing local changes.
  if (!result.tpg_synced) {
    const tpgResult = await repointEnrolmentPreMove(
      currentRunUuid, targetRunUuid, { email: rr.learner_email }
    );
    result.tpg_status = tpgResult.status;
    result.tpg_enrolment_ref = tpgResult.enrolmentRef ?? null;
    result.tpg_note = tpgResult.message;

    if (tpgResult.status !== 'synced') {
      result.error = `TPG repoint failed (${tpgResult.status}): ${tpgResult.message}`;
      return result; // Hard stop — nothing local has changed, safe to retry
    }
    result.tpg_synced = true;
  }

  // ── Step 2: LMS enrollment move ────────────────────────────────────────────
  if (!result.enrollment_moved) {
    const enrolRow = await query(
      `SELECT e.id FROM enrollment e
         LEFT JOIN app_user u ON u.id = e.user_id
        WHERE (LOWER(u.email) = LOWER($1) OR LOWER(e.email) = LOWER($1))
          AND e.course_run_id = $2
          AND LOWER(COALESCE(e.enrolment_status, '')) NOT IN ('admin removed', 'cancelled', 'withdrawn')
        LIMIT 1`,
      [rr.learner_email, currentRunUuid]
    );
    if (enrolRow.rows.length === 0) {
      result.error = `No active enrollment found for ${rr.learner_email} in run ${rr.current_run_id} — TPG was already updated, so LMS needs a manual fix.`;
      return result;
    }
    const enrolId = enrolRow.rows[0].id as string;
    await query(
      `UPDATE enrollment SET course_run_id = $1, updated_at = NOW() WHERE id = $2`,
      [targetRunUuid, enrolId]
    );
    result.enrollment_moved = true;
    result.enrollment_id = enrolId;
  }

  // ── Step 3: Google Calendar move ───────────────────────────────────────────
  if (!result.calendar_synced) {
    try {
      const [removeResult, addResult] = await Promise.all([
        patchRunAttendee(currentRunUuid, rr.learner_email, 'remove'),
        patchRunAttendee(targetRunUuid,  rr.learner_email, 'add'),
      ]);
      result.calendar_remove_status = removeResult.status;
      result.calendar_add_status    = addResult.status;
      result.calendar_synced = addResult.status === 'ok';
      result.calendar_note = result.calendar_synced
        ? `Learner moved on calendar: removed from ${rr.current_run_id} (${removeResult.changed} event(s)), added to ${rr.target_run_id} (${addResult.changed} event(s)).`
        : `Calendar sync incomplete — remove: ${removeResult.status}${removeResult.reason ? ' ('+removeResult.reason+')' : ''}, add: ${addResult.status}${addResult.reason ? ' ('+addResult.reason+')' : ''}`;
    } catch (calErr: any) {
      result.calendar_synced = false;
      result.calendar_note = `Calendar sync threw: ${calErr?.message || 'unexpected error'}`;
    }
  }

  return result;
}

/** @deprecated Use executeRescheduleFlow — kept to avoid import errors during transition */
export type EnrollmentMoveResult = RescheduleFlowResult;
/** @deprecated Use executeRescheduleFlow */
export const executeEnrollmentMove = (
  rr: { current_run_id: string; target_run_id: string; learner_email: string },
  query: QueryFn
) => executeRescheduleFlow(rr, query);
