import { withAuth } from '@lib/auth/withAuth';
import type { NextApiRequest, NextApiResponse } from 'next';
import pool from '../../../lib/db';
import { getCalendarReadClient } from '../../../lib/calendar/calendarClient';
import { eventDateIso, findEventOnDate } from '../../../lib/calendar/eventMatch';

/**
 * GET /api/admin/preview-session-reschedule-calendar?courseRunId=...&oldDate=YYYY-MM-DD
 *
 * READ-ONLY pre-flight for the reschedule flow. Finds the Google Calendar event
 * currently associated with the session's OLD date — first via the durable
 * `course_run_calendar_event` mapping (this is how we locate an event an admin
 * may have dragged OFF its date), then via a live match on the old date — and
 * reports where it lives NOW (`liveDate`).
 *
 * The frontend uses this BEFORE running the reschedule to decide whether the
 * event was manually moved onto a non-session date (→ ask the admin how to
 * resolve, up front). No writes; never throws hard.
 *
 * Response: { success, calendarChecked, found, eventId?, htmlLink?, liveDate? }
 */
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') return res.status(405).json({ success: false, error: 'Method not allowed' });
  const courseRunId = String(req.query.courseRunId || '').trim();
  const oldDate = String(req.query.oldDate || '').trim();
  if (!courseRunId || !DATE_RE.test(oldDate)) {
    return res.status(400).json({ success: false, error: 'courseRunId and oldDate (YYYY-MM-DD) are required' });
  }

  try {
    const run = (await pool.query<{ id: string; course_run_id: string; course_title: string }>(
      `SELECT cr.id, cr.course_run_id, c.title AS course_title
         FROM course_run cr JOIN course c ON c.id = cr.course_id
        WHERE cr.id::text = $1 OR cr.course_run_id = $1 LIMIT 1`,
      [courseRunId]
    )).rows[0];
    if (!run) return res.status(404).json({ success: false, error: 'Course run not found' });

    const client = await getCalendarReadClient();
    if (!client) return res.status(200).json({ success: true, calendarChecked: false, found: false });

    // 1) Locate via the durable mapping for (run, oldDate) — catches a dragged event.
    let ev: any = null;
    const mapped = (await pool.query<{ google_event_id: string }>(
      `SELECT google_event_id FROM course_run_calendar_event WHERE course_run_id = $1 AND event_date = $2::date LIMIT 1`,
      [run.id, oldDate]
    )).rows[0];
    if (mapped?.google_event_id) {
      ev = await client.calendar.events.get({ calendarId: client.calendarId, eventId: mapped.google_event_id }).then(r => r.data).catch(() => null);
      if (ev && ev.status === 'cancelled') ev = null;
    }

    // 2) Fallback: live-match on the old date (event still sitting there, unmapped).
    if (!ev) {
      const lo = new Date(oldDate + 'T00:00:00Z'); lo.setUTCDate(lo.getUTCDate() - 1);
      const hi = new Date(oldDate + 'T00:00:00Z'); hi.setUTCDate(hi.getUTCDate() + 2);
      const events = (await client.calendar.events.list({
        calendarId: client.calendarId, timeMin: lo.toISOString(), timeMax: hi.toISOString(), singleEvents: true, maxResults: 250,
      })).data.items || [];
      ev = findEventOnDate(events, { courseRunId: run.course_run_id, courseTitle: run.course_title, dateIso: oldDate }) || null;
    }

    if (!ev || !ev.id) return res.status(200).json({ success: true, calendarChecked: true, found: false });
    return res.status(200).json({
      success: true,
      calendarChecked: true,
      found: true,
      eventId: ev.id,
      htmlLink: ev.htmlLink || null,
      liveDate: eventDateIso(ev) || null,
    });
  } catch (err) {
    return res.status(500).json({ success: false, error: err instanceof Error ? err.message : 'Failed to preview calendar' });
  }
}

export default withAuth(handler, { roles: ['admin', 'trainingProvider', 'developer', 'trainer'] });
