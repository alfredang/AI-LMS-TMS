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
      const shouldHaveEvent = row.has_learner && row.class_status !== 'Cancelled';
      if (shouldHaveEvent) {
        await ensureClassCalendarEvent(row.id);
        await syncClassAttendees(row.id);
      } else {
        await removeClassCalendarEvents(row.id, { reason: 'gated out (no learners or cancelled)' });
      }
    } catch { /* best-effort — never surface to the caller */ }
  })();
}
