import type { NextApiRequest, NextApiResponse } from 'next';
import pool from '../../../lib/db';
import { requireRole } from '@lib/auth/requireRole';
import { getCalendarReadClient } from '../../../lib/calendar/calendarClient';
import { resolveEventsToRuns, CandidateRun } from '../../../lib/calendar/resolveEventToRun';
import { eventDateIso, extractEventCourseCode } from '../../../lib/calendar/eventMatch';
import { getSSGCredentialsService } from '../../../lib/ssg/services/credentials-service';
import { createSSGCourseAPI } from '../../../lib/ssg/api/course-api';
import { getTrainingPartnerIdentifiers } from '../../../lib/trainingPartnerIdentifiers';

/**
 * GET /api/admin/gcal-sync-ssg-check
 *
 * TEMPORARY investigation tool (2026-07-27) for the GCal->TMS 1x sync feasibility
 * question — to be deleted once that investigation is done, see gcal-sync-audit.ts
 * (same lifecycle). Strictly read-only: no DB writes, no SSG mutations.
 *
 * Extends gcal-sync-audit.ts with two things that endpoint couldn't answer:
 *   1. Full classification of EVERY unresolved event (not just a 40-item sample) into
 *      non_wsq / no_code_admin / wsq_ambiguous / wsq_genuine_gap.
 *   2. For every wsq_genuine_gap course code, a LIVE SSG search (searchCourseRunsByCode)
 *      to determine whether the session is actually published in SSG/TPG already (just
 *      not yet pulled into the local course_run table — the existing
 *      /api/external/upcoming-course-runs cron only pulls runs within a 21-day window
 *      AND only if they already have enrolments, so anything outside that is exactly
 *      this "genuine gap" bucket) versus never published to SSG at all.
 */

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function parseSsgDate(d: unknown): string | null {
  if (!d) return null;
  const s = String(d).trim();
  if (/^\d{8}$/.test(s)) return `${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)}`;
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  return null;
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') return res.status(405).json({ success: false, error: 'Method not allowed' });

  const authed = await requireRole(req, res, ['admin', 'developer']);
  if (!authed) return;

  try {
    const candidateResult = await pool.query(
      `SELECT cr.id AS run_uuid, cr.course_run_id, cr.start_date::text AS start_date,
              cr.end_date::text AS end_date, c.course_code, c.title AS course_title
         FROM course_run cr
         JOIN course c ON c.id = cr.course_id
        WHERE cr.end_date >= CURRENT_DATE AND cr.class_status = 'Confirmed'
        ORDER BY cr.start_date ASC`
    );
    const candidateRuns: CandidateRun[] = candidateResult.rows.map((r) => ({
      runUuid: r.run_uuid, courseRunId: r.course_run_id, courseCode: r.course_code,
      courseTitle: r.course_title, startDate: r.start_date, endDate: r.end_date,
    }));

    const allRunsByCode = new Map<string, { status: string; start: string; end: string }[]>();
    const allRunsResult = await pool.query(
      `SELECT c.course_code, cr.class_status, cr.start_date::text AS start_date, cr.end_date::text AS end_date
         FROM course_run cr JOIN course c ON c.id = cr.course_id`
    );
    for (const r of allRunsResult.rows) {
      const key = (r.course_code || '').toUpperCase();
      if (!allRunsByCode.has(key)) allRunsByCode.set(key, []);
      allRunsByCode.get(key)!.push({ status: r.class_status, start: r.start_date, end: r.end_date });
    }

    const calendarClient = await getCalendarReadClient();
    if (!calendarClient) {
      return res.status(503).json({ error: { code: 'calendar_unavailable', message: 'Google Calendar sync unavailable.' } });
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
        calendarId: calendarClient.calendarId, timeMin: timeMin.toISOString(), timeMax: timeMax.toISOString(),
        singleEvents: true, maxResults: 2500, pageToken,
      });
      events.push(...(resp.data.items || []));
      pageToken = resp.data.nextPageToken || undefined;
      pages++;
    } while (pageToken && pages < 20);
    const activeEvents = events.filter((e) => e.status !== 'cancelled');

    const { unresolvedEventIds } = await resolveEventsToRuns(activeEvents, candidateRuns, todayIso, maxEndDate, { dryRun: true });

    type Classified = {
      title: string | null; date: string; code: string | null; category: string;
      calendar_event_url: string | null; ssg_status?: string; ssg_run_id?: string | null;
    };
    const classified: Classified[] = [];
    const wsqGapCodes = new Set<string>();

    for (const id of unresolvedEventIds) {
      const evt = activeEvents.find((e) => e.id === id);
      if (!evt) continue;
      const code = extractEventCourseCode(evt);
      const dateIso = eventDateIso(evt);
      let category: string;

      if (!code) category = 'no_code_admin';
      else if (!/^TGS-/i.test(code)) category = 'non_wsq';
      else {
        const runsForCode = allRunsByCode.get(code.toUpperCase()) || [];
        const confirmedPlausible = runsForCode.filter(
          (r) => r.status === 'Confirmed' && r.start && r.end && r.start <= dateIso && r.end >= dateIso
        );
        if (confirmedPlausible.length >= 2) category = 'wsq_ambiguous';
        else { category = 'wsq_genuine_gap'; wsqGapCodes.add(code.toUpperCase()); }
      }

      classified.push({ title: evt.summary || null, date: dateIso, code, category, calendar_event_url: evt.htmlLink || null });
    }

    // Live SSG check for every unique wsq_genuine_gap code — read-only search, no writes.
    let ssgConfigured = false;
    const ssgRunsByCode = new Map<string, { start: string | null; end: string | null; id: string }[]>();
    try {
      const credentials = await getSSGCredentialsService().getSSGCredentials();
      if (credentials) {
        ssgConfigured = true;
        const ssgBaseUrl = process.env.SSG_API_URL || 'https://api.ssg-wsg.sg';
        const tp = await getTrainingPartnerIdentifiers();
        const courseApi = createSSGCourseAPI(ssgBaseUrl, credentials);
        const codes = Array.from(wsqGapCodes);
        console.log(`[gcal-sync-ssg-check] checking ${codes.length} unique gap course code(s) against SSG`);
        for (let i = 0; i < codes.length; i++) {
          const code = codes[i];
          try {
            const searchResult = await courseApi.searchCourseRunsByCode(code, {
              pageSize: 40, includeExpired: false, uen: credentials.uen || tp.uen,
            });
            const ssgData = (searchResult.data as any)?.data ?? searchResult.data ?? {};
            const runs: any[] = ssgData?.course?.runs ?? ssgData?.runs ?? [];
            ssgRunsByCode.set(
              code,
              runs.map((r: any) => ({
                start: parseSsgDate(r.courseStartDate ?? r.courseDates?.start),
                end: parseSsgDate(r.courseEndDate ?? r.courseDates?.end),
                id: String(r.id ?? r.courseRunId ?? ''),
              }))
            );
          } catch (e) {
            console.warn(`[gcal-sync-ssg-check] SSG lookup failed for ${code}:`, e instanceof Error ? e.message : e);
            ssgRunsByCode.set(code, []);
          }
          if (i < codes.length - 1) await sleep(1500);
        }
      }
    } catch (e) {
      console.warn('[gcal-sync-ssg-check] SSG credentials unavailable:', e instanceof Error ? e.message : e);
    }

    for (const item of classified) {
      if (item.category !== 'wsq_genuine_gap' || !item.code) continue;
      if (!ssgConfigured) { item.ssg_status = 'ssg_not_configured'; continue; }
      const runs = ssgRunsByCode.get(item.code.toUpperCase()) || [];
      const match = runs.find((r) => r.start && r.end && r.start <= item.date && r.end >= item.date);
      if (match) { item.ssg_status = 'published_in_ssg'; item.ssg_run_id = match.id; }
      else item.ssg_status = runs.length > 0 ? 'ssg_has_run_but_not_this_date' : 'not_in_ssg_at_all';
    }

    const tally = {
      non_wsq: 0, no_code_admin: 0, wsq_ambiguous: 0,
      wsq_genuine_gap_published_in_ssg: 0, wsq_genuine_gap_ssg_other_dates: 0,
      wsq_genuine_gap_not_in_ssg: 0, wsq_genuine_gap_ssg_unconfigured: 0,
    };
    for (const item of classified) {
      if (item.category === 'non_wsq') tally.non_wsq++;
      else if (item.category === 'no_code_admin') tally.no_code_admin++;
      else if (item.category === 'wsq_ambiguous') tally.wsq_ambiguous++;
      else if (item.category === 'wsq_genuine_gap') {
        if (item.ssg_status === 'published_in_ssg') tally.wsq_genuine_gap_published_in_ssg++;
        else if (item.ssg_status === 'ssg_has_run_but_not_this_date') tally.wsq_genuine_gap_ssg_other_dates++;
        else if (item.ssg_status === 'ssg_not_configured') tally.wsq_genuine_gap_ssg_unconfigured++;
        else tally.wsq_genuine_gap_not_in_ssg++;
      }
    }

    return res.status(200).json({
      success: true,
      totals: { unresolved_events: unresolvedEventIds.length, unique_gap_codes_checked_against_ssg: wsqGapCodes.size, ssg_configured: ssgConfigured },
      tally,
      classified,
    });
  } catch (err) {
    console.error('[gcal-sync-ssg-check] error:', err);
    return res.status(500).json({ success: false, error: err instanceof Error ? err.message : 'Internal server error' });
  }
}
