import { withAuth } from '@lib/auth/withAuth';
import type { NextApiRequest, NextApiResponse } from 'next';
import type { calendar_v3 } from 'googleapis';
import pool from '../../../lib/db';
import { getCalendarReadClient } from '../../../lib/calendar/calendarClient';
import { findEventOnDate } from '../../../lib/calendar/eventMatch';

/**
 * GET /api/admin/calendar-match?start=YYYY-MM-DD&end=YYYY-MM-DD
 *
 * Bulk Google-Calendar match for the in-app calendar grid: for every WSQ/IBF/CASL
 * run-day (course_session) in the visible range, report whether a matching Google
 * Calendar event exists (same 3-strategy match as class-sessions / findEventOnDate).
 *
 * ONE events.list sweep over the range (paginated), then in-memory matching — no
 * per-session Google calls, so it's cheap enough to run on every month navigation.
 * Read-only; never writes. Cancelled runs are skipped (they are SUPPOSED to be
 * absent from the calendar).
 *
 * Response: { success, calendarChecked, matches: { "<courseRunUuid>|<YYYY-MM-DD>": boolean } }
 * A key is present only for run-days that were actually checked; the client treats
 * a missing key as "unknown" (no highlight), so calendar outages fail soft.
 */
async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') return res.status(405).json({ success: false, error: 'Method not allowed' });

  const start = String(req.query.start || '').trim();
  const end = String(req.query.end || '').trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(start) || !/^\d{4}-\d{2}-\d{2}$/.test(end)) {
    return res.status(400).json({ success: false, error: 'start and end (YYYY-MM-DD) are required' });
  }

  try {
    const client = await getCalendarReadClient();
    if (!client) {
      return res.status(200).json({ success: true, calendarChecked: false, matches: {} });
    }

    // 1) Local run-days in range. course_session.start_date is compact YYYYMMDD text.
    const compact = (iso: string) => iso.replace(/-/g, '');
    const runsRes = await pool.query<{
      uuid: string; ssg_run_id: string; course_title: string; dates: string[];
    }>(
      `SELECT cr.id AS uuid, cr.course_run_id AS ssg_run_id, c.title AS course_title,
              ARRAY_AGG(DISTINCT cs.start_date ORDER BY cs.start_date) AS dates
         FROM course_run cr
         JOIN course c ON c.id = cr.course_id
         JOIN course_session cs ON cs.course_run_id = cr.id AND COALESCE(cs.deleted, false) = false
        WHERE cs.start_date >= $1 AND cs.start_date <= $2
          AND cr.class_status <> 'Cancelled'
          AND (c.course_type IN ('WSQ', 'IBF', 'CASL') OR c.course_code ILIKE 'TGS-%')
        GROUP BY cr.id, cr.course_run_id, c.title`,
      [compact(start), compact(end)]
    );

    if (runsRes.rows.length === 0) {
      return res.status(200).json({ success: true, calendarChecked: true, matches: {} });
    }

    // 2) One paginated sweep of Google Calendar events over the range.
    const timeMin = new Date(start + 'T00:00:00+08:00').toISOString();
    const timeMax = new Date(end + 'T23:59:59+08:00').toISOString();
    const events: calendar_v3.Schema$Event[] = [];
    let pageToken: string | undefined;
    do {
      const resp = await client.calendar.events.list({
        calendarId: client.calendarId,
        timeMin, timeMax,
        singleEvents: true,
        maxResults: 2500,
        pageToken,
      });
      events.push(...(resp.data.items || []));
      pageToken = resp.data.nextPageToken || undefined;
    } while (pageToken && events.length < 10000);

    // 3) Match every (run, day) against the sweep — same canonical matcher as class-sessions.
    const matches: Record<string, boolean> = {};
    for (const run of runsRes.rows) {
      for (const compactDate of run.dates || []) {
        const d = String(compactDate).replace(/-/g, '');
        if (!/^\d{8}/.test(d)) continue;
        const dateIso = `${d.slice(0, 4)}-${d.slice(4, 6)}-${d.slice(6, 8)}`;
        const ev = findEventOnDate(events, {
          courseRunId: run.ssg_run_id || '',
          courseTitle: run.course_title || '',
          dateIso,
        });
        matches[`${run.uuid}|${dateIso}`] = !!ev;
      }
    }

    return res.status(200).json({ success: true, calendarChecked: true, matches });
  } catch (err) {
    console.error('❌ calendar-match error:', err);
    return res.status(500).json({ success: false, error: err instanceof Error ? err.message : 'Failed to match calendar' });
  }
}

export default withAuth(handler, { roles: ['admin', 'trainingProvider', 'developer'] });
