import pool from '../db';
import { getCalendarClient } from './calendarClient';
import { ensureClassCalendarEvent, syncClassAttendees } from './ensureClassCalendarEvent';
import { eventDateIso } from './eventMatch';

/**
 * Reconcile a run's Google Calendar events to its CURRENT course_session dates.
 * Handles any reschedule granularity (whole run, specific days, single sessions):
 *
 *   1. remove the event for any mapped date that is no longer a session date  (moved-from / dropped dates)
 *   2. ensure an event for each current session date that lacks one           (moved-to / new dates)
 *   3. sync attendees on the (re)created events
 *
 * This is invoked by the LMS-initiated reschedule (a MANUAL admin action — allowed
 * to write the calendar under the post-rollback model). All writes use
 * sendUpdates:'none'. Best-effort; never throws.
 */
const toIso = (v: string | null): string | null => {
  const s = String(v || '').replace(/-/g, '');
  return s.length >= 8 ? `${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)}` : null;
};

export interface ReconcileResult {
  status: 'ok' | 'skipped';
  reason?: string;
  removedStale: number;
  created: number;
  adopted: number;
  kept: number;
  attendeesAdded: number;
  attendeesRemoved: number;
  errors: number;
}

export async function reconcileRunCalendar(courseRunId: string): Promise<ReconcileResult> {
  const out: ReconcileResult = { status: 'ok', removedStale: 0, created: 0, adopted: 0, kept: 0, attendeesAdded: 0, attendeesRemoved: 0, errors: 0 };
  const client = await getCalendarClient();
  if (!client) return { ...out, status: 'skipped', reason: 'calendar sync disabled' };
  const run = (await pool.query<{ id: string; sd: string | null }>(
    `SELECT id, start_date::text AS sd FROM course_run WHERE id::text = $1 OR course_run_id = $1 LIMIT 1`,
    [courseRunId]
  )).rows[0];
  if (!run) return { ...out, status: 'skipped', reason: 'course run not found' };
  const { calendar, calendarId } = client;

  // Current session dates (ISO), with a fallback to the run start when there are no sessions.
  const sess = (await pool.query<{ start_date: string }>(
    `SELECT DISTINCT start_date FROM course_session WHERE course_run_id = $1 AND (deleted IS NOT TRUE)`,
    [run.id]
  )).rows;
  let currentDates = new Set(sess.map(r => toIso(r.start_date)).filter(Boolean) as string[]);
  if (currentDates.size === 0 && run.sd) currentDates = new Set([String(run.sd).slice(0, 10)]);

  // 1) Remove events for mapped dates that are NO LONGER session dates.
  const mapped = (await pool.query<{ ed: string; google_event_id: string }>(
    `SELECT event_date::text AS ed, google_event_id FROM course_run_calendar_event WHERE course_run_id = $1`,
    [run.id]
  )).rows;
  for (const m of mapped) {
    if (currentDates.has(m.ed)) continue; // still a session date — leave it for ensure/sync
    try {
      const evt = await calendar.events.get({ calendarId, eventId: m.google_event_id }).then(r => r.data).catch(() => null);
      if (evt) {
        // Guard: if an admin manually MOVED this event onto a date that is still a
        // current session date, don't cancel it — just drop the stale mapping row so
        // the ensure step below re-adopts the same event for its new date. This keeps
        // a hand-moved event (and its edits) instead of deleting + recreating a
        // default one.
        const liveDate = eventDateIso(evt);
        if (liveDate && currentDates.has(liveDate)) {
          await pool.query(`DELETE FROM course_run_calendar_event WHERE course_run_id = $1 AND google_event_id = $2`, [run.id, m.google_event_id]);
          out.kept++;
          continue;
        }
        if ((evt.attendees || []).length > 0) {
          await calendar.events.patch({ calendarId, eventId: m.google_event_id, requestBody: { status: 'cancelled' }, sendUpdates: 'none' });
        } else {
          await calendar.events.delete({ calendarId, eventId: m.google_event_id, sendUpdates: 'none' });
        }
      }
      await pool.query(`DELETE FROM course_run_calendar_event WHERE course_run_id = $1 AND google_event_id = $2`, [run.id, m.google_event_id]);
      out.removedStale++;
    } catch (e) { out.errors++; }
  }

  // 2) Ensure events for the current session dates, then 3) sync attendees.
  const ens = await ensureClassCalendarEvent(run.id);
  const att = await syncClassAttendees(run.id);
  out.created = ens.created; out.adopted = ens.adopted; out.kept = ens.kept;
  out.attendeesAdded = att.added; out.attendeesRemoved = att.removed;
  out.errors += (ens.errors || 0) + (att.errors || 0);
  return out;
}
