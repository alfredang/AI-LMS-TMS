import { withAuth } from '@lib/auth/withAuth';
import type { NextApiRequest, NextApiResponse } from 'next';
import pool from '../../../../lib/db';
import { getSSGCredentialsService, SSGCredentials } from '../../../../lib/ssg/services/credentials-service';
import { HTTPRequestBuilder, HttpMethod, handleRequest, HttpClient } from '../../../../lib/ssg/utils/http-utils';
import { Cryptography } from '../../../../lib/ssg/utils/cryptography';
import { COURSE_ID_BY_ANY_CODE_SQL } from '../../../../lib/courseCode';

/**
 * POST /api/admin/wsq-schedule-sync/run-sync
 * Body: { items: { course_code, start_date, end_date }[], triggered_by?: 'user'|'cron' }
 *
 * Creates a wsq_sync_job row, responds immediately with { job_id }, then
 * processes all items in the background. Survives browser close / page refresh.
 *
 * Recovery: stale "running" jobs older than 15 minutes are auto-expired on the
 * next call so a crashed/redeployed sync doesn't block future syncs forever.
 * Because the comparison (wsq-schedule-sync) only flags truly unsynced runs as
 * missing, re-running after a partial failure naturally skips already-done items.
 */

type SubmitItem = { course_code: string; start_date: string; end_date: string };
type ItemResult = {
  course_code: string; start_date: string; end_date: string;
  status: 'submitted' | 'exists' | 'no_course' | 'no_session_timing' | 'ssg_error' | 'error';
  ssg_run_id?: string; local_run_id?: string; message?: string;
};

// ── Session helpers (mirrors submit-to-ssg.ts) ────────────────────────────────

const normalizeModeOfTraining = (raw: any): string => {
  if (!raw) return '1';
  const s = String(raw).trim();
  if (['1', '2', '4', '8', '9', '10'].includes(s)) return s;
  const l = s.toLowerCase();
  if (l.includes('assess'))                               return '8';
  if (l.includes('sync') || l.includes('synchronous'))   return '9';
  if (l.includes('async') || l.includes('asynchronous')) return '2';
  if (l.includes('classroom'))                            return '1';
  if (l.includes('job') || l.includes('ojt'))             return '4';
  if (l.includes('work'))                                 return '10';
  return '1';
};

const addDays = (dateStr: string, n: number): string => {
  const d = new Date(dateStr + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().split('T')[0];
};

const buildSessions = (timing: Record<string, any>, startDate: string, endDate: string) => {
  const isOneDay = startDate === endDate;
  const sessions: { startDate: string; endDate: string; startTime: string; endTime: string; modeOfTraining: string }[] = [];
  let currentDate = startDate;
  let prevEndTime = '';
  for (let i = 1; i <= 11; i++) {
    const startTime = (timing[`session_${i}_start_time`] || '').trim();
    const endTime   = (timing[`session_${i}_end_time`]   || '').trim();
    if (!startTime && !endTime) break;
    const mode = normalizeModeOfTraining(timing[`session_${i}_mode_of_training`]);
    let date = startDate;
    if (!isOneDay) {
      if (prevEndTime && startTime && startTime < prevEndTime) {
        const next = addDays(currentDate, 1);
        currentDate = endDate && next > endDate ? endDate : next;
      }
      date = currentDate;
    }
    prevEndTime = endTime;
    sessions.push({ startDate: date, endDate: date, startTime, endTime, modeOfTraining: mode });
  }
  return sessions;
};

const VENUE = { floor: '07', unit: '85-87', postalCode: '737715', room: 'Training room' };

// ── Per-item processor ────────────────────────────────────────────────────────

async function processItem(
  item: SubmitItem,
  credentials: SSGCredentials,
  ssgBaseUrl: string,
  companyEmail: string,
  todaySg: string,
): Promise<ItemResult> {
  const { start_date, end_date } = item;
  // MMS can send course codes with stray whitespace (e.g. a trailing tab) that
  // breaks the exact-match lookup and pollutes the SSG courseReferenceNumber.
  const course_code = (item.course_code ?? '').trim();

  const courseRow = await pool.query<{ id: string }>(
    COURSE_ID_BY_ANY_CODE_SQL, [course_code],
  ).catch(() => ({ rows: [] as { id: string }[] }));
  if (!courseRow.rows[0]) {
    return { course_code, start_date, end_date, status: 'no_course', message: 'Course not found in LMS' };
  }
  const courseId = courseRow.rows[0].id;

  const existingRow = await pool.query<{ id: string; course_run_id: string }>(
    `SELECT id, course_run_id FROM course_run
      WHERE course_id = $1 AND start_date = $2::date AND end_date = $3::date
        AND is_deleted = false AND course_run_id NOT LIKE 'STAGED-%'
      LIMIT 1`,
    [courseId, start_date, end_date],
  ).catch(() => ({ rows: [] as { id: string; course_run_id: string }[] }));
  if (existingRow.rows[0]) {
    return { course_code, start_date, end_date, status: 'exists',
      ssg_run_id: existingRow.rows[0].course_run_id, local_run_id: existingRow.rows[0].id };
  }

  // Resolve the timing template through the COURSE, not the literal code we were
  // handed. Funding renewal issues a new course reference number and the
  // storefront switches to it at once, but the timing template stays filed under
  // whichever code it was created with — measured 26 Aug 2026, all 36 renewed
  // courses had their template under the OLD code and none under the new one, so
  // a literal match found nothing and every one of them failed here as
  // "No session timing template found" without ever reaching SSG.
  // Prefer an exact match on the supplied code, then fall back to any other code
  // the same course carries.
  const timingRow = await pool.query<Record<string, any>>(
    `SELECT t.*
       FROM course_session_timing t
      WHERE t.course_code = $1
         OR t.course_code = (SELECT c.course_code FROM course c WHERE c.id = $2)
         OR t.course_code IN (SELECT h.code FROM course_code_history h WHERE h.course_id = $2)
      ORDER BY (t.course_code = $1) DESC
      LIMIT 1`,
    [course_code, courseId],
  ).catch(() => ({ rows: [] as Record<string, any>[] }));
  if (!timingRow.rows[0]) {
    return { course_code, start_date, end_date, status: 'no_session_timing', message: 'No session timing template found' };
  }
  const sessions = buildSessions(timingRow.rows[0], start_date, end_date);
  if (!sessions.length) {
    return { course_code, start_date, end_date, status: 'no_session_timing', message: 'Session timing template has no sessions' };
  }

  const regClosing = addDays(start_date, -1);
  const regOpening = todaySg > regClosing ? regClosing : todaySg;
  const toInt = (d: string) => parseInt(d.replace(/-/g, ''), 10);

  const payload = {
    course: {
      courseReferenceNumber: course_code,
      trainingProvider: { uen: credentials.uen },
      runs: [{
        sequenceNumber: 1,
        registrationDates: { opening: toInt(regOpening), closing: toInt(regClosing) },
        courseDates: { start: toInt(start_date), end: toInt(end_date) },
        scheduleInfoType: { code: '01', description: 'Description' },
        scheduleInfo: 'Refer to our website for course schedule details.',
        venue: VENUE,
        modeOfTraining: sessions[0].modeOfTraining,
        courseAdminEmail: companyEmail,
        courseVacancy: { code: 'A', description: 'Available' },
        sessions: sessions.map(s => ({
          modeOfTraining: s.modeOfTraining, startDate: s.startDate, endDate: s.endDate,
          startTime: s.startTime, endTime: s.endTime, venue: VENUE,
        })),
      }],
    },
  };

  let ssgRunId: string | null = null;
  try {
    const builder = new HTTPRequestBuilder()
      .withEndpoint(ssgBaseUrl, '/courses/courseRuns/publish')
      .withMethod(HttpMethod.POST)
      .withHeader('Content-Type', 'application/json')
      .withParam('includeExpiredCourses', 'false');
    if (credentials.certificateContent && credentials.privateKeyContent) {
      builder.withCertificate(credentials.certificateContent, credentials.privateKeyContent);
    }
    builder.withBody(Cryptography.encryptJSON(credentials.encryptionKey, payload));
    const config = builder.build();
    const httpClient = new HttpClient(ssgBaseUrl, { 'Content-Type': 'application/json', Accept: 'application/json' });
    const result = await handleRequest(httpClient, config);

    const hasError = result.error && (
      result.error.code || result.error.message ||
      (result.error.details && result.error.details.length > 0)
    );
    if (hasError) {
      const errMsg = result.error?.details?.[0]?.message || result.error?.message || 'SSG returned error';
      const alreadyMatch = errMsg.match(/Course Run ID is (\d+)/i);
      if (alreadyMatch) {
        ssgRunId = alreadyMatch[1];
      } else {
        return { course_code, start_date, end_date, status: 'ssg_error', message: errMsg };
      }
    }
    if (!ssgRunId) {
      const data = result.data as any;
      ssgRunId = data?.course?.runs?.[0]?.runId ?? data?.data?.course?.runs?.[0]?.runId
        ?? data?.runs?.[0]?.runId ?? data?.runs?.[0]?.id ?? data?.runId ?? null;
      if (ssgRunId != null) ssgRunId = String(ssgRunId);
      if (!ssgRunId) {
        return { course_code, start_date, end_date, status: 'ssg_error',
          message: `SSG did not return a run ID. Response: ${JSON.stringify(result.data ?? result).slice(0, 300)}` };
      }
    }
  } catch (e: any) {
    return { course_code, start_date, end_date, status: 'ssg_error', message: e?.message || 'SSG request failed' };
  }

  let localRunId: string | null = null;
  try {
    const stagedRow = await pool.query<{ id: string }>(
      `SELECT id FROM course_run
        WHERE course_id = $1 AND start_date = $2::date AND end_date = $3::date
          AND is_deleted = false AND course_run_id LIKE 'STAGED-%' LIMIT 1`,
      [courseId, start_date, end_date],
    );
    if (stagedRow.rows[0]) {
      await pool.query(
        `UPDATE course_run SET course_run_id = $1, class_status = 'Confirmed',
           registration_opening_date = $2::date, registration_closing_date = $3::date,
           venue_floor = $4, venue_unit = $5, venue_postal_code = $6, venue_room = $7,
           course_admin_email = $8, updated_at = NOW() WHERE id = $9`,
        [ssgRunId, regOpening, regClosing, VENUE.floor, VENUE.unit, VENUE.postalCode, VENUE.room, companyEmail, stagedRow.rows[0].id],
      );
      localRunId = stagedRow.rows[0].id;
    } else {
      const byRunId = await pool.query<{ id: string }>(
        `SELECT id FROM course_run WHERE course_id = $1 AND course_run_id = $2 AND is_deleted = false LIMIT 1`,
        [courseId, ssgRunId],
      );
      if (byRunId.rows[0]) {
        await pool.query(
          `UPDATE course_run SET start_date = $1::date, end_date = $2::date, class_status = 'Confirmed',
             registration_opening_date = $3::date, registration_closing_date = $4::date,
             venue_floor = $5, venue_unit = $6, venue_postal_code = $7, venue_room = $8,
             course_admin_email = $9, updated_at = NOW() WHERE id = $10`,
          [start_date, end_date, regOpening, regClosing, VENUE.floor, VENUE.unit, VENUE.postalCode, VENUE.room, companyEmail, byRunId.rows[0].id],
        );
        localRunId = byRunId.rows[0].id;
      } else {
        const inserted = await pool.query<{ id: string }>(
          `INSERT INTO course_run (
             course_id, course_run_id, start_date, end_date, class_status,
             registration_opening_date, registration_closing_date,
             venue_floor, venue_unit, venue_postal_code, venue_room,
             course_admin_email, created_at, updated_at
           ) VALUES ($1,$2,$3::date,$4::date,'Confirmed',$5::date,$6::date,$7,$8,$9,$10,$11,NOW(),NOW())
           RETURNING id`,
          [courseId, ssgRunId, start_date, end_date, regOpening, regClosing,
           VENUE.floor, VENUE.unit, VENUE.postalCode, VENUE.room, companyEmail],
        );
        localRunId = inserted.rows[0].id;
      }
    }
  } catch (e: any) {
    return { course_code, start_date, end_date, status: 'submitted', ssg_run_id: ssgRunId,
      message: `SSG OK but local DB save failed: ${e?.message}` };
  }

  return { course_code, start_date, end_date, status: 'submitted',
    ssg_run_id: ssgRunId, local_run_id: localRunId ?? undefined };
}

// ── Background orchestrator ───────────────────────────────────────────────────

const BATCH_SIZE = 100;

async function runInBackground(
  jobId: number,
  items: SubmitItem[],
  credentials: SSGCredentials,
  ssgBaseUrl: string,
  companyEmail: string,
) {
  const todaySg = new Date(
    new Date().toLocaleString('en-US', { timeZone: 'Asia/Singapore' }),
  ).toISOString().split('T')[0];

  let totalSubmitted = 0, totalExists = 0, totalSsgErrors = 0, totalSkipped = 0;

  for (let i = 0; i < items.length; i += BATCH_SIZE) {
    const batch = items.slice(i, i + BATCH_SIZE);
    const results: ItemResult[] = [];
    for (const item of batch) {
      results.push(await processItem(item, credentials, ssgBaseUrl, companyEmail, todaySg));
    }

    const batchSubmitted = results.filter(r => r.status === 'submitted').length;
    const batchExists    = results.filter(r => r.status === 'exists').length;
    const batchSsgErrors = results.filter(r => r.status === 'ssg_error').length;
    const batchSkipped   = results.filter(r => ['error', 'no_course', 'no_session_timing'].includes(r.status)).length;
    const batchFailures  = results.filter(r => !['submitted', 'exists'].includes(r.status));

    totalSubmitted += batchSubmitted;
    totalExists    += batchExists;
    totalSsgErrors += batchSsgErrors;
    totalSkipped   += batchSkipped;

    await pool.query(
      `UPDATE wsq_sync_job SET
         items_done     = items_done     + $1,
         submitted      = submitted      + $2,
         already_exists = already_exists + $3,
         ssg_errors     = ssg_errors     + $4,
         skipped        = skipped        + $5,
         failures       = failures       || $6::jsonb
       WHERE id = $7`,
      [batch.length, batchSubmitted, batchExists, batchSsgErrors, batchSkipped,
       JSON.stringify(batchFailures), jobId],
    );
  }

  const parts: string[] = [];
  if (totalSubmitted) parts.push(`${totalSubmitted} submitted`);
  if (totalExists)    parts.push(`${totalExists} already existed`);
  if (totalSsgErrors) parts.push(`${totalSsgErrors} SSG errors`);
  if (totalSkipped)   parts.push(`${totalSkipped} skipped`);

  await pool.query(
    `UPDATE wsq_sync_job SET status = 'completed', completed_at = NOW(), summary = $1 WHERE id = $2`,
    [parts.join(' · ') || 'Done', jobId],
  );
}

// ── Start a sync job (shared by the manual endpoint and the daily cron) ────────

export type StartWsqSyncResult =
  | { started: true; jobId: number; totalItems: number }
  | { started: false; reason: 'already_running'; jobId: number }
  | { started: false; reason: 'not_configured'; message: string };

/**
 * Create a wsq_sync_job and process `items` in the background (fire-and-forget).
 * Shared by the manual POST handler and the daily cron (auto-sync-wsq-schedule).
 * Idempotent per-item (processItem skips runs that already exist), and blocks if
 * another job is already running.
 */
export async function startWsqSyncJob(
  items: SubmitItem[],
  triggeredBy: 'user' | 'cron',
  ssgApp?: string,
): Promise<StartWsqSyncResult> {
  // Auto-expire jobs stuck in "running" for more than 15 minutes — from a
  // previous process killed mid-sync (redeploy, crash, etc.).
  await pool.query(
    `UPDATE wsq_sync_job
       SET status = 'failed', completed_at = NOW(),
           summary = 'Interrupted — server restarted or redeployed'
     WHERE status = 'running' AND started_at < NOW() - INTERVAL '15 minutes'`,
  ).catch(() => {});

  // Block if a fresh job is already running.
  const existing = await pool.query(
    `SELECT id FROM wsq_sync_job WHERE status = 'running' ORDER BY started_at DESC LIMIT 1`,
  );
  if (existing.rows.length > 0) {
    return { started: false, reason: 'already_running', jobId: existing.rows[0].id };
  }

  // Load SSG credentials.
  let ssgBaseUrl = 'https://api.ssg-wsg.sg';
  let companyEmail = 'enquiry@tertiaryinfotech.com';
  const creds = await getSSGCredentialsService().getSSGCredentials(undefined, ssgApp);
  if (!creds)                return { started: false, reason: 'not_configured', message: 'SSG credentials not configured' };
  if (!creds.encryptionKey)  return { started: false, reason: 'not_configured', message: 'SSG encryption key missing' };
  if (!creds.certificateContent || !creds.privateKeyContent) {
    return { started: false, reason: 'not_configured', message: 'SSG certificate/key missing' };
  }
  const credentials: SSGCredentials = creds;
  ssgBaseUrl = creds.ssgApiBaseUrl || ssgBaseUrl;
  try {
    const tpRow = await pool.query<{ company_email: string }>(`SELECT company_email FROM training_provider LIMIT 1`);
    if (tpRow.rows[0]?.company_email) companyEmail = tpRow.rows[0].company_email;
  } catch { /* keep default */ }

  // Create job row + process in the background (survives the caller returning).
  const jobResult = await pool.query<{ id: number }>(
    `INSERT INTO wsq_sync_job (total_items, triggered_by) VALUES ($1, $2) RETURNING id`,
    [items.length, triggeredBy],
  );
  const jobId = jobResult.rows[0].id;

  void runInBackground(jobId, items, credentials, ssgBaseUrl, companyEmail).catch(async (e) => {
    await pool.query(
      `UPDATE wsq_sync_job SET status = 'failed', completed_at = NOW(), summary = $1 WHERE id = $2`,
      [`Fatal error: ${e?.message || e}`, jobId],
    ).catch(() => {});
  });

  return { started: true, jobId, totalItems: items.length };
}

// ── Handler ───────────────────────────────────────────────────────────────────

async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', ['POST']);
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const items: SubmitItem[] = Array.isArray(req.body?.items) ? req.body.items : [];
  const triggeredBy = req.body?.triggered_by === 'cron' ? 'cron' : 'user';

  if (items.length === 0) {
    return res.status(400).json({ error: 'items array is required' });
  }

  const result = await startWsqSyncJob(items, triggeredBy, (req.headers['x-ssg-app'] as string) || undefined);
  if (result.started) {
    return res.status(200).json({ job_id: result.jobId, total_items: result.totalItems });
  }
  if (result.reason === 'already_running') {
    return res.status(409).json({ error: 'A sync is already running', job_id: result.jobId });
  }
  return res.status(503).json({ error: result.message });
}

export default withAuth(handler, { roles: ['admin', 'trainingProvider', 'developer'] });
