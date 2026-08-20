import { withAuth } from '@lib/auth/withAuth';
import type { NextApiRequest, NextApiResponse } from 'next';
import pool from '../../../../lib/db';
import { getSSGCredentialsService, SSGCredentials } from '../../../../lib/ssg/services/credentials-service';
import { HTTPRequestBuilder, HttpMethod, handleRequest, HttpClient } from '../../../../lib/ssg/utils/http-utils';
import { Cryptography } from '../../../../lib/ssg/utils/cryptography';
import { COURSE_ID_BY_ANY_CODE_SQL } from '../../../../lib/courseCode';

type SubmitItem = {
  course_code: string;
  start_date: string; // YYYY-MM-DD
  end_date: string;   // YYYY-MM-DD
};

type ItemResult = {
  course_code: string;
  start_date: string;
  end_date: string;
  status: 'submitted' | 'exists' | 'no_course' | 'no_session_timing' | 'ssg_error' | 'error';
  ssg_run_id?: string;
  local_run_id?: string;
  message?: string;
};

// ── Session builder (mirrors buildAutoSessions in AddSessionsView.tsx) ────────

const normalizeModeOfTraining = (raw: any): string => {
  if (!raw) return '1';
  const s = String(raw).trim();
  if (['1', '2', '4', '8', '9', '10'].includes(s)) return s;
  const l = s.toLowerCase();
  if (l.includes('assess'))                             return '8';
  if (l.includes('sync') || l.includes('synchronous')) return '9';
  if (l.includes('async') || l.includes('asynchronous')) return '2';
  if (l.includes('classroom'))                          return '1';
  if (l.includes('job') || l.includes('ojt'))           return '4';
  if (l.includes('work'))                               return '10';
  return '1';
};

const addDays = (dateStr: string, n: number): string => {
  const d = new Date(dateStr + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().split('T')[0];
};

const buildSessions = (
  timing: Record<string, any>,
  startDate: string,
  endDate: string,
) => {
  const isOneDay = startDate === endDate;
  const sessions: {
    startDate: string; endDate: string;
    startTime: string; endTime: string;
    modeOfTraining: string;
  }[] = [];
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

// ── Main handler ──────────────────────────────────────────────────────────────

async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', ['POST']);
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const items = Array.isArray(req.body?.items) ? (req.body.items as SubmitItem[]) : null;
  if (!items || items.length === 0) {
    return res.status(400).json({ error: 'items array is required' });
  }
  if (items.length > 100) {
    return res.status(400).json({ error: 'Maximum 100 items per request' });
  }
  const jobId: number | null = req.body?.job_id ?? null;
  const isLastBatch: boolean = req.body?.is_last_batch === true;

  // ── Load SSG credentials + training provider defaults ─────────────────────
  let credentials: SSGCredentials;
  let companyEmail = 'enquiry@tertiaryinfotech.com';
  let ssgBaseUrl = 'https://api.ssg-wsg.sg';

  try {
    const credsSvc = getSSGCredentialsService();
    const creds = await credsSvc.getSSGCredentials(
      undefined,
      (req.headers['x-ssg-app'] as string) || undefined,
    );
    if (!creds) return res.status(503).json({ error: 'SSG credentials not configured' });
    if (!creds.encryptionKey) return res.status(503).json({ error: 'SSG encryption key missing' });
    if (!creds.certificateContent || !creds.privateKeyContent)
      return res.status(503).json({ error: 'SSG certificate/key missing' });
    credentials = creds;
    ssgBaseUrl = creds.ssgApiBaseUrl || ssgBaseUrl;
  } catch (e: any) {
    return res.status(500).json({ error: 'Failed to load SSG credentials', message: e?.message });
  }

  try {
    const tpRow = await pool.query<{ company_email: string }>(
      `SELECT company_email FROM training_provider LIMIT 1`,
    );
    if (tpRow.rows[0]?.company_email) companyEmail = tpRow.rows[0].company_email;
  } catch { /* keep default */ }


  // ── Default venue (used on run-level and per-session) ─────────────────────
  const VENUE = {
    block: '',
    street: '',
    floor: '07',
    unit: '85-87',
    building: '',
    postalCode: '737715',
    room: 'Training room',
    wheelChairAccess: false,
  };

  // ── Today in SG time (YYYY-MM-DD) ─────────────────────────────────────────
  const todaySg = new Date(
    new Date().toLocaleString('en-US', { timeZone: 'Asia/Singapore' }),
  ).toISOString().split('T')[0];

  // ── Process items ─────────────────────────────────────────────────────────
  const results: ItemResult[] = [];

  for (const item of items) {
    const { course_code, start_date, end_date } = item || ({} as SubmitItem);

    if (!course_code || !start_date || !end_date) {
      results.push({ course_code, start_date, end_date, status: 'error', message: 'Missing fields' });
      continue;
    }

    // 1. Look up course
    const courseRow = await pool.query<{ id: string }>(
      COURSE_ID_BY_ANY_CODE_SQL,
      [course_code],
    ).catch(() => ({ rows: [] as { id: string }[] }));

    if (courseRow.rows.length === 0) {
      results.push({ course_code, start_date, end_date, status: 'no_course', message: 'Course not found in LMS' });
      continue;
    }
    const courseId = courseRow.rows[0].id;

    // 2. Check if a real (non-staged) course_run already exists for these dates
    const existingRow = await pool.query<{ id: string; course_run_id: string }>(
      `SELECT id, course_run_id FROM course_run
        WHERE course_id = $1 AND start_date = $2::date AND end_date = $3::date
          AND is_deleted = false AND course_run_id NOT LIKE 'STAGED-%'
        LIMIT 1`,
      [courseId, start_date, end_date],
    ).catch(() => ({ rows: [] as { id: string; course_run_id: string }[] }));

    if (existingRow.rows.length > 0) {
      results.push({
        course_code, start_date, end_date,
        status: 'exists',
        ssg_run_id: existingRow.rows[0].course_run_id,
        local_run_id: existingRow.rows[0].id,
        message: 'Already submitted to SSG',
      });
      continue;
    }

    // 3. Look up session timing template
    const timingRow = await pool.query<Record<string, any>>(
      `SELECT * FROM course_session_timing WHERE course_code = $1 LIMIT 1`,
      [course_code],
    ).catch(() => ({ rows: [] as Record<string, any>[] }));

    if (timingRow.rows.length === 0) {
      results.push({ course_code, start_date, end_date, status: 'no_session_timing', message: 'No session timing template found' });
      continue;
    }
    const timing = timingRow.rows[0];

    // 4. Build sessions
    const sessions = buildSessions(timing, start_date, end_date);
    if (sessions.length === 0) {
      results.push({ course_code, start_date, end_date, status: 'no_session_timing', message: 'Session timing template has no sessions' });
      continue;
    }

    // Mode of training = first session's mode
    const modeOfTraining = sessions[0].modeOfTraining;

    // Registration dates
    const regClosing = addDays(start_date, -1);
    const regOpening = todaySg > regClosing ? regClosing : todaySg;

    const toInt = (d: string) => parseInt(d.replace(/-/g, ''), 10);
    const sessionVenue = { floor: VENUE.floor, unit: VENUE.unit, postalCode: VENUE.postalCode, room: VENUE.room };

    // 5. Build SSG payload — SSG publish expects nested objects with YYYYMMDD integers
    const payload = {
      course: {
        courseReferenceNumber: course_code,
        trainingProvider: { uen: credentials.uen },
        runs: [
          {
            sequenceNumber: 1,
            registrationDates: {
              opening: toInt(regOpening),
              closing: toInt(regClosing),
            },
            courseDates: {
              start: toInt(start_date),
              end: toInt(end_date),
            },
            scheduleInfoType: { code: '01', description: 'Description' },
            scheduleInfo: 'Refer to our website for course schedule details.',
            venue: sessionVenue,
            modeOfTraining,
            courseAdminEmail: companyEmail,
            courseVacancy: { code: 'A', description: 'Available' },
            sessions: sessions.map((s) => ({
              modeOfTraining: s.modeOfTraining,
              startDate: s.startDate,
              endDate: s.endDate,
              startTime: s.startTime,
              endTime: s.endTime,
              venue: sessionVenue,
            })),
          },
        ],
      },
    };

    // 6. Submit to SSG
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

      const encryptedPayload = Cryptography.encryptJSON(credentials.encryptionKey, payload);
      builder.withBody(encryptedPayload);

      const config = builder.build();
      const httpClient = new HttpClient(ssgBaseUrl, { 'Content-Type': 'application/json', Accept: 'application/json' });
      const result = await handleRequest(httpClient, config);

      const hasError = result.error && (
        result.error.code || result.error.message ||
        (result.error.details && result.error.details.length > 0)
      );
      if (hasError) {
        const errMsg = result.error?.details?.[0]?.message || result.error?.message || 'SSG returned error';

        // SSG returns "Course Run already exist. The Course Run ID is XXXXXXX." when a run was
        // already created (e.g. a previous attempt succeeded on SSG but our local DB write failed).
        // Extract the run ID and fall through to the local upsert so the staged row gets fixed.
        const alreadyExistsMatch = errMsg.match(/Course Run ID is (\d+)/i);
        if (alreadyExistsMatch) {
          ssgRunId = alreadyExistsMatch[1];
        } else {
          results.push({ course_code, start_date, end_date, status: 'ssg_error', message: errMsg });
          continue;
        }
      }

      // Extract SSG run ID — check all known response shapes SSG may return
      if (!ssgRunId) {
        const data = result.data as any;
        ssgRunId = data?.course?.runs?.[0]?.runId
          ?? data?.data?.course?.runs?.[0]?.runId
          ?? data?.runs?.[0]?.runId
          ?? data?.runs?.[0]?.id      // SSG publish response uses "id" not "runId"
          ?? data?.runId
          ?? null;

        if (ssgRunId != null) ssgRunId = String(ssgRunId);

        if (!ssgRunId) {
          const snippet = JSON.stringify(data ?? result).slice(0, 300);
          results.push({ course_code, start_date, end_date, status: 'ssg_error', message: `SSG did not return a run ID. Response: ${snippet}` });
          continue;
        }
      }
    } catch (e: any) {
      results.push({ course_code, start_date, end_date, status: 'ssg_error', message: e?.message || 'SSG request failed' });
      continue;
    }

    // 7. Upsert course_run — priority order:
    //   a) STAGED- row with matching dates  → update in-place
    //   b) Any existing row with this SSG run ID (old staged rows submitted with
    //      wrong dates end up here) → fix its dates + promote to Confirmed
    //   c) No match → INSERT fresh
    let localRunId: string | null = null;
    try {
      const stagedRow = await pool.query<{ id: string }>(
        `SELECT id FROM course_run
          WHERE course_id = $1 AND start_date = $2::date AND end_date = $3::date
            AND is_deleted = false AND course_run_id LIKE 'STAGED-%'
          LIMIT 1`,
        [courseId, start_date, end_date],
      );

      if (stagedRow.rows.length > 0) {
        // (a) Update the staged row with the real SSG run ID and venue/status
        await pool.query(
          `UPDATE course_run SET
            course_run_id             = $1,
            class_status              = 'Confirmed',
            registration_opening_date = $2::date,
            registration_closing_date = $3::date,
            venue_floor               = $4,
            venue_unit                = $5,
            venue_postal_code         = $6,
            venue_room                = $7,
            course_admin_email        = $8,
            updated_at                = NOW()
          WHERE id = $9`,
          [ssgRunId, regOpening, regClosing, VENUE.floor, VENUE.unit,
           VENUE.postalCode, VENUE.room, companyEmail, stagedRow.rows[0].id],
        );
        localRunId = stagedRow.rows[0].id;
      } else {
        // (b) Look for an existing row with this SSG run ID regardless of dates.
        // Old staged rows submitted with a 1-day-off date end up here — they own
        // the run ID but have the wrong start/end. Fix the dates to match Magento.
        const existingById = await pool.query<{ id: string }>(
          `SELECT id FROM course_run
            WHERE course_id = $1 AND course_run_id = $2 AND is_deleted = false
            LIMIT 1`,
          [courseId, ssgRunId],
        );

        if (existingById.rows.length > 0) {
          await pool.query(
            `UPDATE course_run SET
              start_date                = $1::date,
              end_date                  = $2::date,
              class_status              = 'Confirmed',
              registration_opening_date = $3::date,
              registration_closing_date = $4::date,
              venue_floor               = $5,
              venue_unit                = $6,
              venue_postal_code         = $7,
              venue_room                = $8,
              course_admin_email        = $9,
              updated_at                = NOW()
            WHERE id = $10`,
            [start_date, end_date, regOpening, regClosing,
             VENUE.floor, VENUE.unit, VENUE.postalCode, VENUE.room,
             companyEmail, existingById.rows[0].id],
          );
          localRunId = existingById.rows[0].id;
        } else {
          // (c) Insert fresh course_run row
          const inserted = await pool.query<{ id: string }>(
            `INSERT INTO course_run (
              course_id, course_run_id, start_date, end_date, class_status,
              registration_opening_date, registration_closing_date,
              venue_floor, venue_unit, venue_postal_code, venue_room,
              course_admin_email, created_at, updated_at
            ) VALUES ($1,$2,$3::date,$4::date,'Confirmed',$5::date,$6::date,$7,$8,$9,$10,$11,NOW(),NOW())
            RETURNING id`,
            [courseId, ssgRunId, start_date, end_date,
             regOpening, regClosing, VENUE.floor, VENUE.unit,
             VENUE.postalCode, VENUE.room, companyEmail],
          );
          localRunId = inserted.rows[0].id;
        }
      }
    } catch (e: any) {
      // SSG submission succeeded but local DB write failed — still report success with a warning
      results.push({
        course_code, start_date, end_date,
        status: 'submitted',
        ssg_run_id: ssgRunId,
        message: `SSG OK (run ID: ${ssgRunId}) but local DB save failed: ${e?.message}`,
      });
      continue;
    }

    results.push({
      course_code, start_date, end_date,
      status: 'submitted',
      ssg_run_id: ssgRunId,
      local_run_id: localRunId ?? undefined,
    });
  }

  const summary = {
    submitted:  results.filter((r) => r.status === 'submitted').length,
    exists:     results.filter((r) => r.status === 'exists').length,
    ssg_error:  results.filter((r) => r.status === 'ssg_error').length,
    error:      results.filter((r) => ['error', 'no_course', 'no_session_timing'].includes(r.status)).length,
  };

  // ── Write progress to shared job row so all users see live state ──────────
  if (jobId) {
    const failures = results.filter((r) =>
      r.status !== 'submitted' && r.status !== 'exists',
    );
    try {
      await pool.query(
        `UPDATE wsq_sync_job SET
           items_done     = items_done     + $1,
           submitted      = submitted      + $2,
           already_exists = already_exists + $3,
           ssg_errors     = ssg_errors     + $4,
           skipped        = skipped        + $5,
           failures       = failures       || $6::jsonb
         WHERE id = $7`,
        [
          results.length,
          summary.submitted,
          summary.exists,
          summary.ssg_error,
          summary.error,
          JSON.stringify(failures),
          jobId,
        ],
      );
      if (isLastBatch) {
        const parts: string[] = [];
        if (summary.submitted) parts.push(`${summary.submitted} submitted`);
        if (summary.exists)    parts.push(`${summary.exists} already existed`);
        if (summary.ssg_error) parts.push(`${summary.ssg_error} SSG errors`);
        if (summary.error)     parts.push(`${summary.error} skipped`);
        await pool.query(
          `UPDATE wsq_sync_job SET status='completed', completed_at=NOW(), summary=$1 WHERE id=$2`,
          [parts.join(' · '), jobId],
        );
      }
    } catch { /* job update failure should not block the response */ }
  }

  return res.status(200).json({ summary, results });
}

export default withAuth(handler, { roles: ['admin', 'trainingProvider', 'developer'] });
