import type { NextApiRequest, NextApiResponse } from 'next';
import pool from '../../../lib/db';
import { requireRole } from '@lib/auth/requireRole';
import { getCalendarReadClient } from '../../../lib/calendar/calendarClient';
import { resolveEventsToRuns, CandidateRun } from '../../../lib/calendar/resolveEventToRun';
import { eventDateIso } from '../../../lib/calendar/eventMatch';

/**
 * GET /api/admin/gcal-sync-audit
 *
 * Read-only feasibility check for a one-time GCal -> TMS sync (2026-07-27, requested by
 * project lead via Noah). Compares EVERY future calendar event against EVERY future
 * course_run using the same tiered resolver trainer-reminders already runs live
 * (lib/calendar/resolveEventToRun.ts), but with dryRun:true — no writes to
 * course_run_calendar_event, so an unconfirmed fuzzy_title guess can't harden into the
 * durable-mapping tier before a human has looked at it (same principle as the tier-4
 * cross-contamination bug fixed 2026-07-24).
 *
 * Purpose: give real counts (not a guess) for how much of a 1x sync could be auto-applied
 * (durable_mapping/run_id_in_description/course_code — strong signal) vs needs human
 * review (fuzzy_title) vs has no LMS counterpart at all (unresolved — could be MMS/non-WSQ
 * classes, personal events, or genuinely orphaned calendar entries).
 */
export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') return res.status(405).json({ success: false, error: 'Method not allowed' });

  const authed = await requireRole(req, res, ['admin', 'developer']);
  if (!authed) return;

  try {
    const candidateResult = await pool.query(
      `SELECT cr.id AS run_uuid, cr.course_run_id, cr.start_date::text AS start_date,
              cr.end_date::text AS end_date, cr.class_status,
              c.course_code, c.title AS course_title
         FROM course_run cr
         JOIN course c ON c.id = cr.course_id
        WHERE cr.end_date >= CURRENT_DATE
        ORDER BY cr.start_date ASC`
    );
    const candidateRuns: CandidateRun[] = candidateResult.rows.map((r) => ({
      runUuid: r.run_uuid,
      courseRunId: r.course_run_id,
      courseCode: r.course_code,
      courseTitle: r.course_title,
      startDate: r.start_date,
      endDate: r.end_date,
    }));

    const calendarClient = await getCalendarReadClient();
    if (!calendarClient) {
      return res.status(503).json({
        error: { code: 'calendar_unavailable', message: 'Google Calendar sync is required for this endpoint and is not currently available.' },
      });
    }

    const todayIso = new Date().toISOString().slice(0, 10);
    const maxEndDate = candidateRuns.reduce((max, c) => (c.endDate && c.endDate > max ? c.endDate : max), todayIso);
    const timeMin = new Date(`${todayIso}T00:00:00Z`);
    const timeMax = new Date(`${maxEndDate}T00:00:00Z`);
    timeMax.setUTCDate(timeMax.getUTCDate() + 30);

    const events: any[] = [];
    let pageToken: string | undefined;
    let pages = 0;
    do {
      const resp = await calendarClient.calendar.events.list({
        calendarId: calendarClient.calendarId,
        timeMin: timeMin.toISOString(),
        timeMax: timeMax.toISOString(),
        singleEvents: true,
        maxResults: 2500,
        pageToken,
      });
      events.push(...(resp.data.items || []));
      pageToken = resp.data.nextPageToken || undefined;
      pages++;
    } while (pageToken && pages < 20);

    const activeEvents = events.filter((e) => e.status !== 'cancelled');

    const { resolved, unresolvedEventIds } = await resolveEventsToRuns(
      activeEvents,
      candidateRuns,
      todayIso,
      maxEndDate,
      { dryRun: true }
    );

    const byTier: Record<string, number> = { durable_mapping: 0, run_id_in_description: 0, course_code: 0, fuzzy_title: 0 };
    const fuzzySamples: any[] = [];
    const byRunUuid = new Map(candidateRuns.map((c) => [c.runUuid, c]));
    const matchedRunDates = new Set<string>();

    for (const r of resolved) {
      byTier[r.tier] = (byTier[r.tier] || 0) + 1;
      matchedRunDates.add(`${r.runUuid}|${r.matchedDate}`);
      if (r.tier === 'fuzzy_title' && fuzzySamples.length < 40) {
        const c = byRunUuid.get(r.runUuid);
        fuzzySamples.push({
          event_title: r.event.summary || null,
          event_date: r.matchedDate,
          event_description: (r.event.description || '').slice(0, 120),
          matched_course_code: c?.courseCode ?? null,
          matched_course_title: c?.courseTitle ?? null,
          calendar_event_url: r.event.htmlLink || null,
        });
      }
    }

    const unresolvedSamples = unresolvedEventIds.slice(0, 40).map((id) => {
      const e = activeEvents.find((ev) => ev.id === id);
      return e
        ? {
            title: e.summary || null,
            date: eventDateIso(e),
            description: (e.description || '').slice(0, 120),
            calendar_event_url: e.htmlLink || null,
          }
        : { id };
    });

    // Reverse gap: Confirmed future runs with zero matched calendar event at all.
    const confirmedNoEvent = candidateRuns.filter((c) => {
      if (!c.startDate || !c.endDate) return false;
      for (let d = c.startDate; d <= c.endDate; ) {
        if (matchedRunDates.has(`${c.runUuid}|${d}`)) return false;
        const dt = new Date(d + 'T00:00:00Z');
        dt.setUTCDate(dt.getUTCDate() + 1);
        d = dt.toISOString().slice(0, 10);
      }
      return true;
    });

    return res.status(200).json({
      success: true,
      window: { from: todayIso, to: maxEndDate },
      totals: {
        future_course_runs: candidateRuns.length,
        calendar_events_fetched: events.length,
        calendar_events_active: activeEvents.length,
        resolved_total: resolved.length,
        unresolved_total: unresolvedEventIds.length,
      },
      resolved_by_tier: byTier,
      fuzzy_title_samples: fuzzySamples,
      unresolved_event_samples: unresolvedSamples,
      confirmed_runs_with_no_calendar_event: confirmedNoEvent.length,
      confirmed_runs_with_no_calendar_event_samples: confirmedNoEvent
        .filter((c) => c.startDate) // status not in candidateRuns type, just show all here
        .slice(0, 20)
        .map((c) => ({ course_code: c.courseCode, course_title: c.courseTitle, start_date: c.startDate, end_date: c.endDate })),
    });
  } catch (err) {
    console.error('[gcal-sync-audit] error:', err);
    return res.status(500).json({ success: false, error: err instanceof Error ? err.message : 'Internal server error' });
  }
}
