import type { NextApiRequest, NextApiResponse } from 'next';
import pool from '../../../lib/db';
import { getSSGCredentialsService } from '../../../lib/ssg/services/credentials-service';
import { HttpClient, HTTPRequestBuilder, HttpMethod } from '../../../lib/ssg/utils/http-utils';
import { getTrainingPartnerIdentifiers } from '../../../lib/trainingPartnerIdentifiers';
import { getCalendarReadClient } from '../../../lib/calendar/calendarClient';
import { findEventOnDate, eventDateIso } from '../../../lib/calendar/eventMatch';

/**
 * GET /api/admin/class-sessions?courseRunId=<uuid or SSG run id>
 *
 * Source of truth for the session schedule is **SSG (live)**; local
 * `course_session` is only a fallback when SSG is unreachable. On top of the
 * sessions, each one is **live-matched** to a Google Calendar event at query
 * time (no reliance on the stale `course_run_calendar_event` map) via
 * `findEventOnDate()`. Read-only — no writes anywhere.
 *
 * Response: { success, source: 'ssg'|'local', ssgError, calendarChecked,
 *             courseRunUuid, count, sessions: [...] } where each session carries
 *             { calendarMatched, calendarLink, calendarEventDate }.
 */
const norm = (v: any): string | null => {
  if (v === null || v === undefined || v === '') return null;
  const s = String(v).replace(/-/g, '').trim();
  if (s.length >= 8 && /^\d{8}/.test(s)) return `${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)}`;
  return typeof v === 'string' ? v : null;
};

const modeCode = (m: any): string => {
  if (m === null || m === undefined) return '';
  if (typeof m === 'object') return String(m.code ?? '');
  return String(m);
};

interface OutSession {
  id?: string | null;
  sessionNumber?: string | null;
  ssgSessionId?: string | null;
  title?: string | null;
  startDate: string | null;
  endDate: string | null;
  startTime: string | null;
  endTime: string | null;
  modeOfTraining: string | null;
  venue?: string | null;
  trainerName?: string | null;
  attendanceTaken?: boolean;
  classType?: string | null;
  calendarMatched?: boolean;
  calendarLink?: string | null;
  calendarEventDate?: string | null;
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') return res.status(405).json({ success: false, error: 'Method not allowed' });
  const courseRunId = String(req.query.courseRunId || '').trim();
  if (!courseRunId) return res.status(400).json({ success: false, error: 'courseRunId is required' });

  try {
    const run = (await pool.query<{ id: string; course_run_id: string; course_title: string; course_code: string }>(
      `SELECT cr.id, cr.course_run_id, c.title AS course_title, c.course_code
         FROM course_run cr JOIN course c ON c.id = cr.course_id
        WHERE cr.id::text = $1 OR cr.course_run_id = $1 LIMIT 1`,
      [courseRunId]
    )).rows[0];
    if (!run) return res.status(404).json({ success: false, error: 'Course run not found' });

    const ssgRunId = run.course_run_id;
    let sessions: OutSession[] = [];
    let ssgError: string | null = null;

    // 1) Sessions from SSG (live) — the source of truth. Use the SAME dedicated
    //    sessions endpoint the Edit Class → Sessions tab uses
    //    (`/courses/runs/{runId}/sessions`, not viewCourseRun's run-detail), so the
    //    card and the Edit tab show identical sessions.
    if (ssgRunId) {
      try {
        const creds = await getSSGCredentialsService().getSSGCredentials(undefined, (req.headers['x-ssg-app'] as string) || undefined);
        if (!creds) throw new Error('SSG credentials not found');
        const baseUrl = process.env.SSG_API_URL || 'https://api.ssg-wsg.sg';
        const tpIds = await getTrainingPartnerIdentifiers();
        const uen = creds.uen || tpIds.uen;

        const builder = new HTTPRequestBuilder()
          .withEndpoint(baseUrl, `/courses/runs/${ssgRunId}/sessions`)
          .withMethod(HttpMethod.GET)
          .withParam('uen', uen)
          .withParam('courseReferenceNumber', run.course_code)
          .withParam('includeExpiredCourses', 'true');
        if (creds.certificateContent && creds.privateKeyContent) {
          builder.withCertificate(creds.certificateContent, creds.privateKeyContent);
        }
        const httpClient = new HttpClient(baseUrl, { 'Content-Type': 'application/json', 'Accept': 'application/json' });
        const httpResponse = await httpClient.request(builder.build());

        if (httpResponse.status === 404) {
          // SSG: no sessions for this run — genuinely empty, not an error.
        } else if (httpResponse.status !== 200) {
          throw new Error(`SSG error ${httpResponse.status}`);
        } else {
          const body: any = typeof httpResponse.data === 'string' ? JSON.parse(httpResponse.data) : httpResponse.data;
          const result = body?.data ?? body;
          const ssgSessions: any[] = result?.sessions || result?.result?.sessions || [];
          sessions = ssgSessions.map((s: any, i: number): OutSession => ({
            ssgSessionId: s.id || s.sessionId || null,
            sessionNumber: String(i + 1),
            title: s.title || null,
            startDate: norm(s.startDate),
            endDate: norm(s.endDate ?? s.startDate),
            startTime: s.startTime || null,
            endTime: s.endTime || null,
            modeOfTraining: modeCode(s.modeOfTraining),
            venue: null,
            trainerName: null,
            attendanceTaken: false,
          }));
        }
      } catch (e) {
        ssgError = e instanceof Error ? e.message : String(e);
      }
    } else {
      ssgError = 'Course run has no SSG course_run_id';
    }

    // No local fallback: SSG is the source of truth. If it can't be loaded the
    // list stays empty (with ssgError surfaced) — same as the Edit page, which
    // is also SSG-only. We never substitute the (possibly stale) local cache.

    // Live calendar match (read-only). Never hard-fails.
    let calendarChecked = false;
    try {
      const client = await getCalendarReadClient();
      const dates = sessions.map(s => s.startDate).filter(Boolean) as string[];
      if (client && dates.length > 0) {
        const sorted = [...dates].sort();
        const lo = new Date(sorted[0] + 'T00:00:00Z'); lo.setUTCDate(lo.getUTCDate() - 1);
        const hi = new Date(sorted[sorted.length - 1] + 'T00:00:00Z'); hi.setUTCDate(hi.getUTCDate() + 2);
        const evResp = await client.calendar.events.list({
          calendarId: client.calendarId,
          timeMin: lo.toISOString(),
          timeMax: hi.toISOString(),
          singleEvents: true,
          maxResults: 250,
        });
        const events = evResp.data.items || [];
        calendarChecked = true;
        for (const s of sessions) {
          if (!s.startDate) { s.calendarMatched = false; continue; }
          const ev = findEventOnDate(events, { courseRunId: ssgRunId, courseTitle: run.course_title, dateIso: s.startDate });
          s.calendarMatched = !!ev;
          s.calendarLink = ev?.htmlLink || null;
          s.calendarEventDate = ev ? (eventDateIso(ev) || null) : null;
        }
      }
    } catch {
      // Calendar unavailable — leave matches unchecked; not a hard failure.
    }
    if (!calendarChecked) for (const s of sessions) s.calendarMatched = false;

    return res.status(200).json({
      success: true,
      courseRunUuid: run.id,
      ssgError,
      calendarChecked,
      count: sessions.length,
      sessions,
    });
  } catch (err) {
    return res.status(500).json({ success: false, error: err instanceof Error ? err.message : 'Failed to load sessions' });
  }
}
