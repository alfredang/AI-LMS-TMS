import type { NextApiRequest, NextApiResponse } from 'next';
import pool from '../../../lib/db';
import { reconcileRunCalendar } from '../../../lib/calendar/reconcileRunCalendar';
import { getCalendarClient } from '../../../lib/calendar/calendarClient';

/**
 * POST /api/admin/reconcile-run-calendar  — Phase 2 opt-in calendar update.
 *
 * Reconciles the run's Google Calendar to its CURRENT (local) session dates
 * (one event per DAY): creates the moved-to day's event, keeps a day that still
 * has sessions, removes a day that no longer has any. Write-guarded +
 * sendUpdates:'none'. Call AFTER reflecting SSG→local so it acts on fresh data.
 *
 * Optional `resolution` (decided UP FRONT by the admin in the reschedule dialog)
 * handles an event that was manually moved onto a NON-session date, BEFORE the
 * reconcile runs so nothing is silently destroyed:
 *   - reuse   : move that event to the new session date (then reconcile re-adopts it)
 *   - replace : delete that event (then reconcile creates a fresh one)
 *   - keepNew : un-map that event so reconcile leaves it, and creates a fresh one
 *
 * Body: { courseRunId, resolution?: { eventId, action:'reuse'|'replace'|'keepNew', newDate } }
 */
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const SGT = 'Asia/Singapore';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') return res.status(405).json({ success: false, error: 'Method not allowed' });
  const { courseRunId, resolution } = (req.body || {}) as {
    courseRunId?: string;
    resolution?: { eventId?: string; action?: 'reuse' | 'replace' | 'keepNew'; newDate?: string };
  };
  if (!courseRunId) return res.status(400).json({ success: false, error: 'courseRunId is required' });

  try {
    let resolutionApplied: string | null = null;

    if (resolution?.eventId && resolution.action) {
      const run = (await pool.query<{ id: string }>(
        `SELECT id FROM course_run WHERE id::text = $1 OR course_run_id = $1 LIMIT 1`, [courseRunId]
      )).rows[0];
      const client = await getCalendarClient();
      if (run && client) {
        const { eventId, action, newDate } = resolution;
        try {
          if (action === 'reuse' && DATE_RE.test(newDate || '')) {
            // Move the hand-placed event onto the new session date; reconcile's
            // guard then re-adopts it (keeps the event + its attendees).
            await client.calendar.events.patch({
              calendarId: client.calendarId, eventId, sendUpdates: 'none',
              requestBody: {
                start: { dateTime: `${newDate}T09:30:00`, timeZone: SGT },
                end: { dateTime: `${newDate}T18:30:00`, timeZone: SGT },
              },
            });
            resolutionApplied = 'reuse';
          } else if (action === 'replace') {
            await client.calendar.events.delete({ calendarId: client.calendarId, eventId, sendUpdates: 'none' }).catch(() => {});
            await pool.query(`DELETE FROM course_run_calendar_event WHERE course_run_id = $1 AND google_event_id = $2`, [run.id, eventId]);
            resolutionApplied = 'replace';
          } else if (action === 'keepNew') {
            // Un-map the stray event so reconcile leaves it untouched.
            await pool.query(`DELETE FROM course_run_calendar_event WHERE course_run_id = $1 AND google_event_id = $2`, [run.id, eventId]);
            resolutionApplied = 'keepNew';
          }
        } catch { /* best-effort — reconcile still runs below */ }
      }
    }

    const result = await reconcileRunCalendar(courseRunId);
    return res.status(200).json({ success: true, resolutionApplied, ...result });
  } catch (err) {
    return res.status(500).json({ success: false, error: err instanceof Error ? err.message : 'Failed to reconcile calendar' });
  }
}
