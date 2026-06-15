import pool from '../db';
import { ensureClassCalendarEvent, removeClassCalendarEvents, syncClassAttendees } from './ensureClassCalendarEvent';

/**
 * Fire-and-forget calendar reconciliation for one class after a learner/trainer
 * add/remove (or a status change). NON-BLOCKING and never throws — calendar
 * issues must never break enrollment/assignment flows.
 *
 * Enforces the gating per change:
 *   has >=1 confirmed learner AND not Cancelled  -> ensure event + sync attendees
 *   otherwise (no learners, or Cancelled)        -> remove the class's events
 *
 * `courseRunId` may be the course_run UUID or the SSG run id.
 */
export function triggerClassCalendarSync(courseRunId: string): void {
  if (!courseRunId) return;
  void (async () => {
    try {
      const row = (await pool.query<{ id: string; class_status: string | null; has_learner: boolean }>(
        `SELECT cr.id, cr.class_status,
                EXISTS(SELECT 1 FROM enrollment e WHERE e.course_run_id = cr.id AND e.enrolment_status='Confirmed') AS has_learner
           FROM course_run cr WHERE cr.id::text = $1 OR cr.course_run_id = $1 LIMIT 1`,
        [courseRunId]
      )).rows[0];
      if (!row) return;
      // Deletion happens ONLY on a manual Cancel (class_status = 'Cancelled').
      // A class that merely has no confirmed learners (but isn't cancelled) is
      // left ALONE — we never delete its calendar events as a side effect of
      // losing learners or a trainer. Reschedules remove empty days separately
      // via reconcileRunCalendar (also UI-triggered).
      if (row.class_status === 'Cancelled') {
        await removeClassCalendarEvents(row.id, { reason: 'class cancelled' });
      } else if (row.has_learner) {
        await ensureClassCalendarEvent(row.id);
        await syncClassAttendees(row.id);
      }
      // else: not cancelled + no confirmed learners → leave the calendar untouched.
    } catch { /* best-effort — never surface to the caller */ }
  })();
}
