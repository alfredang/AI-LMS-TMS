import type { NextApiRequest, NextApiResponse } from 'next';
import pool from '@lib/db';
import { getCalendarClient } from '@lib/calendar/calendarClient';
import { findEventOnDate } from '@lib/calendar/eventMatch';

/**
 * Phase 0 backfill: adopt EXISTING Google Calendar events into the durable
 * `course_run_calendar_event` mapping. WRITE-ONLY on that table — never creates,
 * deletes, or modifies any calendar event. Idempotent (skips runs already mapped).
 *
 * For each non-cancelled course_run ending within the last 30 days or later, with
 * no mapping rows yet: list events in its date window and, per session date,
 * fuzzy-match an event and store its id. Logs linked / no-match / ambiguous.
 *
 * GET  ?limit=N        — dry-run preview (no writes), what WOULD be linked
 * POST { apply: true } — write the mappings
 * Auth: x-api-key
 */

const sessionIso = (v: string | null): string | null => {
  if (!v) return null;
  const s = String(v).replace(/-/g, '');
  return s.length >= 8 ? `${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)}` : null;
};

export interface BackfillResult {
  runsScanned: number;
  linked: number;
  noMatch: number;
  ambiguous: number;
  errors: number;
  details: Array<{ courseRunId: string; date: string; status: 'linked' | 'no_match' | 'ambiguous' | 'error'; eventId?: string; message?: string }>;
}

export async function runBackfill(opts: { apply: boolean; limit?: number } = { apply: false }): Promise<BackfillResult> {
  const res: BackfillResult = { runsScanned: 0, linked: 0, noMatch: 0, ambiguous: 0, errors: 0, details: [] };

  const client = await getCalendarClient();
  if (!client) { res.details.push({ courseRunId: '-', date: '-', status: 'error', message: 'Google Calendar sync disabled' }); return res; }
  const { calendar, calendarId } = client;

  const runs = (await pool.query(
    `SELECT cr.id, cr.course_run_id, c.title AS course_title,
            cr.start_date::text AS start_date, cr.end_date::text AS end_date
       FROM course_run cr JOIN course c ON c.id = cr.course_id
      WHERE cr.is_deleted = false
        AND cr.class_status <> 'Cancelled'
        AND cr.end_date >= CURRENT_DATE - 30
        AND NOT EXISTS (SELECT 1 FROM course_run_calendar_event m WHERE m.course_run_id = cr.id)
      ORDER BY cr.start_date
      ${opts.limit ? `LIMIT ${Math.max(1, Math.min(opts.limit, 2000))}` : ''}`
  )).rows;

  for (const run of runs) {
    res.runsScanned++;
    try {
      // Session dates (fall back to the run's start date if no sessions exist).
      const sess = (await pool.query(
        `SELECT DISTINCT start_date FROM course_session WHERE course_run_id = $1 AND (deleted IS NOT TRUE)`,
        [run.id]
      )).rows;
      let dates = sess.map(r => sessionIso(r.start_date)).filter(Boolean) as string[];
      if (dates.length === 0 && run.start_date) dates = [String(run.start_date).slice(0, 10)];
      dates = Array.from(new Set(dates)).sort();
      if (dates.length === 0) continue;

      const timeMin = new Date(dates[0] + 'T00:00:00Z'); timeMin.setUTCDate(timeMin.getUTCDate() - 1);
      const timeMax = new Date(dates[dates.length - 1] + 'T00:00:00Z'); timeMax.setUTCDate(timeMax.getUTCDate() + 2);
      const evs = (await calendar.events.list({
        calendarId, timeMin: timeMin.toISOString(), timeMax: timeMax.toISOString(),
        singleEvents: true, maxResults: 250,
      })).data.items || [];

      for (const dateIso of dates) {
        const match = findEventOnDate(evs, { courseRunId: run.course_run_id, courseTitle: run.course_title, dateIso });
        if (!match?.id) { res.noMatch++; res.details.push({ courseRunId: run.course_run_id, date: dateIso, status: 'no_match' }); continue; }
        const baseId = match.id.includes('_') ? match.id.split('_')[0] : null;
        if (!opts.apply) { res.linked++; res.details.push({ courseRunId: run.course_run_id, date: dateIso, status: 'linked', eventId: match.id }); continue; }
        const ins = await pool.query(
          `INSERT INTO course_run_calendar_event (course_run_id, event_date, google_event_id, base_event_id)
           VALUES ($1, $2::date, $3, $4)
           ON CONFLICT (google_event_id) DO NOTHING
           RETURNING id`,
          [run.id, dateIso, match.id, baseId]
        );
        if (ins.rowCount && ins.rowCount > 0) { res.linked++; res.details.push({ courseRunId: run.course_run_id, date: dateIso, status: 'linked', eventId: match.id }); }
        else { res.ambiguous++; res.details.push({ courseRunId: run.course_run_id, date: dateIso, status: 'ambiguous', eventId: match.id, message: 'event already claimed by another run' }); }
      }
    } catch (e: any) {
      res.errors++;
      res.details.push({ courseRunId: run.course_run_id, date: '-', status: 'error', message: e?.message || String(e) });
    }
  }
  return res;
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const key = req.headers['x-api-key'];
  if (!process.env.EXTERNAL_API_KEY_FOR_CLAWDBOT || key !== process.env.EXTERNAL_API_KEY_FOR_CLAWDBOT) {
    return res.status(401).json({ success: false, error: 'unauthorized' });
  }
  if (req.method === 'GET') {
    const limit = parseInt(String(req.query.limit || '0'), 10) || undefined;
    const out = await runBackfill({ apply: false, limit });
    return res.status(200).json({ success: true, dryRun: true, ...out, details: out.details.slice(0, 200) });
  }
  if (req.method === 'POST') {
    const out = await runBackfill({ apply: req.body?.apply === true });
    return res.status(200).json({ success: true, dryRun: out && req.body?.apply !== true, ...out, details: out.details.slice(0, 200) });
  }
  return res.status(405).json({ success: false, error: 'Method not allowed' });
}
