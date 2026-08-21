/**
 * Session sync helpers — pull a course run's sessions from SSG into the local
 * `course_session` table (the table the in-app calendar renders from).
 *
 *  - upsertRunSessions(uuid, ssgSessions)  — upsert an already-fetched raw SSG session array
 *                                            (used by class-sessions as a zero-extra-call
 *                                            "sync on view" side-effect).
 *  - fetchAndSyncRunSessions(uuid)         — fetch from SSG + upsert (used by the daily
 *                                            gap-fill cron). Never throws.
 *
 * Mirrors the upsert/soft-delete the reschedule flow's `course-sessions/sync-from-ssg` does.
 */
import pool from '../db';
import { getSSGCredentialsService } from './services/credentials-service';
import { HttpClient, HTTPRequestBuilder, HttpMethod } from './utils/http-utils';
import { getTrainingPartnerIdentifiers } from '../trainingPartnerIdentifiers';

const parseSessionNumber = (id: string): string => {
  const m = id.match(/-S(\d+)\b/i) || id.match(/(\d+)\s*$/);
  return m ? m[1] : '';
};
const toIso = (compact: string) => /^\d{8}$/.test(compact) ? `${compact.slice(0, 4)}-${compact.slice(4, 6)}-${compact.slice(6, 8)}` : '';

/** Upsert a raw SSG session array into local course_session; soft-delete locals no longer in SSG. */
export async function upsertRunSessions(courseRunUuid: string, ssgSessions: any[]): Promise<{ upserted: number; softDeleted: number }> {
  const seen: string[] = [];
  const dates: string[] = [];
  let upserted = 0;
  for (let i = 0; i < (ssgSessions || []).length; i++) {
    const s = ssgSessions[i];
    const ssgSessionId = String(s?.id || s?.sessionId || '').trim();
    if (!ssgSessionId) continue;
    seen.push(ssgSessionId);
    const startDate = String(s.startDate || '').trim();
    if (startDate) dates.push(startDate);
    await pool.query(
      `INSERT INTO course_session (course_run_id, ssg_session_id, session_number, start_date, end_date, start_time, end_time, mode_of_training, venue, deleted)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb,$10)
       ON CONFLICT (course_run_id, ssg_session_id) DO UPDATE SET
         session_number=EXCLUDED.session_number, start_date=EXCLUDED.start_date, end_date=EXCLUDED.end_date,
         start_time=EXCLUDED.start_time, end_time=EXCLUDED.end_time, mode_of_training=EXCLUDED.mode_of_training,
         venue=EXCLUDED.venue, deleted=EXCLUDED.deleted, updated_at=NOW()`,
      [courseRunUuid, ssgSessionId, parseSessionNumber(ssgSessionId) || String(i + 1),
       startDate, String(s.endDate || s.startDate || '').trim(), (s.startTime || '').trim(), (s.endTime || '').trim(),
       String(s.modeOfTraining || '').trim(), s.venue ? JSON.stringify(s.venue) : '{}', s.deleted === true]
    );
    upserted++;
  }
  // Soft-delete local sessions no longer present in SSG.
  let softDeleted = 0;
  if (seen.length) {
    const ph = seen.map((_, i) => `$${i + 2}`).join(',');
    const r = await pool.query(
      `UPDATE course_session SET deleted=true, updated_at=NOW()
        WHERE course_run_id=$1 AND COALESCE(deleted,false)=false AND ssg_session_id NOT IN (${ph})`,
      [courseRunUuid, ...seen]);
    softDeleted = r.rowCount ?? 0;
  }
  // Reflect the run window from the live session dates (only when it actually changes).
  if (dates.length) {
    const sorted = dates.slice().sort();
    const min = toIso(sorted[0]); const max = toIso(sorted[sorted.length - 1]);
    if (min && max) {
      await pool.query(
        `UPDATE course_run SET start_date=$2, end_date=$3, updated_at=NOW()
          WHERE id=$1 AND (start_date IS DISTINCT FROM $2::date OR end_date IS DISTINCT FROM $3::date)`,
        [courseRunUuid, min, max]);
    }
  }
  return { upserted, softDeleted };
}

/** Fetch a run's sessions live from SSG (same endpoint the rescheduler uses). */
async function fetchSsgSessions(ssgRunId: string, courseCode: string): Promise<{ ok: boolean; sessions: any[]; error?: string }> {
  const credentials = await getSSGCredentialsService().getSSGCredentials();
  if (!credentials) return { ok: false, sessions: [], error: 'SSG credentials not configured' };
  const ssgBaseUrl = process.env.SSG_API_URL || 'https://api.ssg-wsg.sg';
  const tp = await getTrainingPartnerIdentifiers();
  const uen = credentials.uen || tp.uen;
  const builder = new HTTPRequestBuilder()
    .withEndpoint(ssgBaseUrl, `/courses/runs/${ssgRunId}/sessions`)
    .withMethod(HttpMethod.GET)
    .withParam('uen', uen)
    .withParam('courseReferenceNumber', courseCode)
    .withParam('includeExpiredCourses', 'true');
  if (credentials.certificateContent && credentials.privateKeyContent) builder.withCertificate(credentials.certificateContent, credentials.privateKeyContent);
  const client = new HttpClient(ssgBaseUrl, { 'Content-Type': 'application/json', 'Accept': 'application/json' });
  const resp = await client.request(builder.build());
  if (resp.status === 404) return { ok: true, sessions: [] }; // genuinely no sessions
  if (resp.status !== 200) return { ok: false, sessions: [], error: `SSG ${resp.status}` };
  const parsed = typeof resp.data === 'string' ? JSON.parse(resp.data) : resp.data;
  const result = parsed?.data ?? parsed;
  return { ok: true, sessions: result?.sessions || result?.result?.sessions || [] };
}

/** Fetch from SSG + upsert local. For the daily cron. Never throws. */
export async function fetchAndSyncRunSessions(courseRunUuid: string): Promise<{ ok: boolean; upserted: number; error?: string }> {
  try {
    const run = (await pool.query<{ course_run_id: string; course_code: string }>(
      `SELECT cr.course_run_id,
              COALESCE(
                (SELECT h.code FROM public.course_code_history h WHERE h.course_id = c.id AND h.is_current LIMIT 1),
                NULLIF(c.new_course_code, ''),
                c.course_code
              ) AS course_code
         FROM course_run cr JOIN course c ON c.id = cr.course_id WHERE cr.id = $1`, [courseRunUuid]
    )).rows[0];
    if (!run?.course_run_id || !run.course_code) return { ok: false, upserted: 0, error: 'run/course not found' };
    const f = await fetchSsgSessions(run.course_run_id, run.course_code);
    if (!f.ok) return { ok: false, upserted: 0, error: f.error };
    const r = await upsertRunSessions(courseRunUuid, f.sessions);
    return { ok: true, upserted: r.upserted };
  } catch (err) {
    return { ok: false, upserted: 0, error: err instanceof Error ? err.message : String(err) };
  }
}
