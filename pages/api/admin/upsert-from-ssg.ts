/**
 * POST /api/admin/upsert-from-ssg
 *
 * Orchestrator endpoint for backlog #65: "Upsert from SSG" button on
 * View Class By Date. Accepts 1-10 Course Run IDs and chains 3 upsert
 * steps per CR — course run, course sessions, enrolments — with a
 * preview (dry-run) or apply (write) mode.
 *
 * Trainer columns are explicitly excluded from all writes to sidestep
 * the #60 ghost-write bug and the #39 JSONB rework dependency.
 *
 * On mid-batch failure during apply, skips the failed CR and continues
 * to the next. Each CR uses its own DB connection + transaction.
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import crypto from 'crypto';
import pool from '../../../lib/db';
import type { PoolClient } from 'pg';
import { getSSGCredentialsService } from '../../../lib/ssg/services/credentials-service';
import { createSSGCourseAPI } from '../../../lib/ssg/api/course-api';
import { OptionalSelector } from '../../../lib/ssg/models/course-runs';
import { HttpClient, HTTPRequestBuilder, HttpMethod } from '../../../lib/ssg/utils/http-utils';
import { getTrainingPartnerIdentifiers } from '../../../lib/trainingPartnerIdentifiers';
import { syncEnrolmentToDB } from '../../../lib/ssg/utils/sync-enrolment-to-db';
import { syncAllDaApplicantsToCalendar } from '../../../lib/google-calendar/da-calendar-sync';
import { triggerClassCalendarSync } from '@lib/calendar/triggerClassCalendarSync';
import type {
  UpsertFromSsgRequest,
  UpsertFromSsgResponse,
  UpsertFromSsgCrResult,
  UpsertFromSsgCourseRunResult,
  UpsertFromSsgSessionsResult,
  UpsertFromSsgSessionDetail,
  UpsertFromSsgEnrolmentsResult,
  UpsertFromSsgEnrolmentDetail,
  UpsertFromSsgDupWarning,
  UpsertFromSsgFieldDiff,
  UpsertFromSsgOrphan,
  UpsertFromSsgMode,
} from '../../../types/upsert-from-ssg';
import { UPSERT_FROM_SSG_MAX_BATCH } from '../../../types/upsert-from-ssg';

// ── Helpers ───────────────────────────────────────────────────────────────────

// Convert SSG date number (e.g. 20261212) → 'YYYY-MM-DD' string, or null
function fmtDate(v: number | string | undefined | null): string | null {
  if (v === undefined || v === null || v === '') return null;
  const s = String(v);
  if (s.length !== 8) return null;
  return `${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)}`;
}

// Normalize for field diff comparison — treats null/undefined/'' as equal.
function eq(a: unknown, b: unknown): boolean {
  const norm = (v: unknown) => (v === null || v === undefined || v === '') ? null : String(v);
  return norm(a) === norm(b);
}

function emptyCourseRunResult(): UpsertFromSsgCourseRunResult {
  return { inserted: 0, updated: 0, fieldsChanged: [] };
}

function emptySessionsResult(): UpsertFromSsgSessionsResult {
  return {
    inserted: 0,
    updated: 0,
    softDeleted: 0,
    insertedDetails: [],
    updatedDetails: [],
    softDeletedDetails: [],
  };
}

function emptyEnrolmentsResult(): UpsertFromSsgEnrolmentsResult {
  return {
    inserted: 0,
    updated: 0,
    orphans: [],
    insertedDetails: [],
    updatedDetails: [],
    dupWarnings: [],
  };
}

function parseSessionNumber(ssgSessionId: string): string {
  const m = ssgSessionId.match(/-S(\d+)$/i);
  return m ? `S${m[1]}` : '';
}

// ── Step A: Course Run fetch + diff + (optionally) upsert ─────────────────────

interface CourseRunStepOutput {
  courseRunUuid: string | null;   // resolved local UUID after apply, or looked-up existing UUID
  courseCode: string | null;      // needed for Step B (sessions endpoint requires courseCode)
  courseTitle: string;
  result: UpsertFromSsgCourseRunResult;
}

async function fetchAndDiffCourseRun(
  ssgApi: ReturnType<typeof createSSGCourseAPI>,
  client: PoolClient,
  courseRunId: string,
  mode: UpsertFromSsgMode,
): Promise<CourseRunStepOutput> {
  const result = emptyCourseRunResult();

  const viewRes = await ssgApi.viewCourseRun(courseRunId, OptionalSelector.YES);

  // SSG returns HTTP 200 with error body on silent failures — parse uniformly.
  // See .project/more-context/ssg-response-parsing.md
  const hasError = viewRes.error && (viewRes.error.code || viewRes.error.message);
  if (hasError) {
    throw new Error(`SSG rejected: ${viewRes.error!.message || viewRes.error!.code}`);
  }

  const ssgCourse = (viewRes.data as any)?.course;
  const ssgRun = ssgCourse?.run;
  if (!ssgCourse || !ssgRun) {
    throw new Error('SSG response missing course/run data');
  }

  const courseCode = String(ssgCourse.referenceNumber ?? ssgCourse.externalReferenceNumber ?? '').trim();
  const courseTitle = String(ssgCourse.title ?? courseCode ?? '').trim();
  const startDate = fmtDate(ssgRun.courseStartDate);
  const endDate = fmtDate(ssgRun.courseEndDate);
  // NOTE: mode_of_learning intentionally excluded from sync — SSG's modeOfTraining
  // code doesn't map cleanly to local Physical/Virtual/Hybrid enum. Admin manages
  // this manually in Edit Class. See user decision 2026-04-10.
  const qrRaw: string = String(ssgRun.qrCodeLink || ssgRun.digitalClassroomLink || '');
  const digitalAttendId = qrRaw ? (qrRaw.split('/').pop() || null) : null;

  // Extract TPG-assigned trainer from SSG response (#76).
  // linkCourseRunTrainer is an array — take the first trainer's name + email.
  const ssgTrainers: Array<{ name?: string; email?: string }> = ssgRun.linkCourseRunTrainer || [];
  const tpgTrainerName = ssgTrainers[0]?.name?.trim() || null;
  const tpgTrainerEmail = ssgTrainers[0]?.email?.trim() || null;

  // Look up local course_run + course by course_run_id
  const local = await client.query(
    `SELECT cr.id AS course_run_uuid,
            cr.course_id,
            cr.start_date::text  AS start_date,
            cr.end_date::text    AS end_date,
            cr.digital_attendance_id,
            cr.tpg_assigned_trainer_name,
            cr.tpg_assigned_trainer_email,
            c.title AS course_title,
            c.course_code
       FROM course_run cr
       LEFT JOIN course c ON c.id = cr.course_id
      WHERE cr.course_run_id = $1
      LIMIT 1`,
    [courseRunId]
  );

  const hasLocal = local.rows.length > 0;
  const localRow: any = hasLocal ? local.rows[0] : null;

  // Compute field-level diff (SSG → local)
  const diffs: UpsertFromSsgFieldDiff[] = [];
  const pushDiff = (field: string, oldVal: unknown, newVal: unknown) => {
    if (!eq(oldVal, newVal)) {
      diffs.push({
        field,
        old: oldVal === null || oldVal === undefined ? null : String(oldVal),
        new: newVal === null || newVal === undefined ? null : String(newVal),
      });
    }
  };

  if (hasLocal) {
    pushDiff('course.title',          localRow.course_title,         courseTitle || null);
    pushDiff('course.course_code',    localRow.course_code,          courseCode || null);
    pushDiff('course_run.start_date', localRow.start_date,           startDate);
    pushDiff('course_run.end_date',   localRow.end_date,             endDate);
    pushDiff('course_run.digital_attendance_id', localRow.digital_attendance_id, digitalAttendId);
    pushDiff('course_run.tpg_assigned_trainer_name',  localRow.tpg_assigned_trainer_name,  tpgTrainerName);
    pushDiff('course_run.tpg_assigned_trainer_email', localRow.tpg_assigned_trainer_email, tpgTrainerEmail);
  } else {
    // New course run will be inserted (if apply)
    pushDiff('course_run.course_run_id', null, courseRunId);
    if (courseCode)       pushDiff('course.course_code',    null, courseCode);
    if (courseTitle)      pushDiff('course.title',          null, courseTitle);
    if (startDate)        pushDiff('course_run.start_date', null, startDate);
    if (endDate)          pushDiff('course_run.end_date',   null, endDate);
    if (digitalAttendId)  pushDiff('course_run.digital_attendance_id', null, digitalAttendId);
    if (tpgTrainerName)   pushDiff('course_run.tpg_assigned_trainer_name',  null, tpgTrainerName);
    if (tpgTrainerEmail)  pushDiff('course_run.tpg_assigned_trainer_email', null, tpgTrainerEmail);
  }

  result.fieldsChanged = diffs;

  // In preview mode, never write.
  if (mode === 'preview') {
    // Count would-be insert/update based on hasLocal
    if (!hasLocal && diffs.length > 0) {
      result.inserted = 1;
    } else if (hasLocal && diffs.length > 0) {
      result.updated = 1;
    }
    return {
      courseRunUuid: hasLocal ? localRow.course_run_uuid : null,
      courseCode: courseCode || null,
      courseTitle,
      result,
    };
  }

  // ── Apply mode ──
  // If nothing to change, skip write entirely.
  if (diffs.length === 0) {
    return {
      courseRunUuid: hasLocal ? localRow.course_run_uuid : null,
      courseCode: courseCode || null,
      courseTitle,
      result,
    };
  }

  // Ensure course row exists (resolve courseId)
  let courseId: string | null = hasLocal ? localRow.course_id : null;

  if (!courseId && courseCode) {
    const existingCourse = await client.query(
      `SELECT id FROM course WHERE course_code = $1 LIMIT 1`,
      [courseCode]
    );
    if (existingCourse.rows.length > 0) {
      courseId = existingCourse.rows[0].id;
    } else {
      // Race-safe insert: another concurrent request could insert the same
      // course_code between our SELECT and INSERT. ON CONFLICT DO NOTHING
      // makes the INSERT safe; the RETURNING id path yields null on conflict,
      // so we re-SELECT to pick up the row the race winner inserted.
      const newCourseId = crypto.randomUUID();
      const ins = await client.query(
        `INSERT INTO course (id, course_code, title, status, enrollment_status, created_at, updated_at)
         VALUES ($1, $2, $3, 'Published', 'enrolled', NOW(), NOW())
         ON CONFLICT (course_code) DO NOTHING
         RETURNING id`,
        [newCourseId, courseCode, courseTitle || courseCode]
      );
      courseId = ins.rows[0]?.id ?? null;
      if (!courseId) {
        const race = await client.query(
          `SELECT id FROM course WHERE course_code = $1 LIMIT 1`,
          [courseCode]
        );
        courseId = race.rows[0]?.id ?? null;
      }
    }
  }

  if (!courseId) {
    throw new Error(`Could not resolve course_id for course_code=${courseCode}`);
  }

  // Update course.title if it changed (whitelisted — only title + course_code live on course)
  const titleChanged = diffs.some(d => d.field === 'course.title');
  if (titleChanged && courseTitle) {
    await client.query(
      `UPDATE course SET title = $1, updated_at = NOW() WHERE id = $2`,
      [courseTitle, courseId]
    );
  }

  // Upsert course_run — WHITELIST: start_date, end_date, digital_attendance_id,
  // tpg_assigned_trainer_name, tpg_assigned_trainer_email.
  // TPG trainer columns added for #76 (read from SSG linkCourseRunTrainer).
  // Local trainer columns (assigned_trainer_*) AND mode_of_learning still excluded:
  //   - Local trainer columns: sidesteps #60 ghost-write + #39 JSONB dependency
  //   - mode_of_learning: SSG's code doesn't map cleanly to local enum
  //     (admin manages manually in Edit Class)
  const newRunUuid = hasLocal ? localRow.course_run_uuid : crypto.randomUUID();
  const upsertResult = await client.query(
    `INSERT INTO course_run (
       id, course_id, course_run_id, class_status,
       start_date, end_date,
       digital_attendance_id,
       tpg_assigned_trainer_name, tpg_assigned_trainer_email,
       created_at, updated_at
     ) VALUES ($1, $2, $3, 'Pending', $4, $5, $6, $7, $8, NOW(), NOW())
     ON CONFLICT (course_id, course_run_id) DO UPDATE SET
       start_date                 = COALESCE(EXCLUDED.start_date,            course_run.start_date),
       end_date                   = COALESCE(EXCLUDED.end_date,              course_run.end_date),
       digital_attendance_id      = COALESCE(EXCLUDED.digital_attendance_id, course_run.digital_attendance_id),
       tpg_assigned_trainer_name  = COALESCE(EXCLUDED.tpg_assigned_trainer_name,  course_run.tpg_assigned_trainer_name),
       tpg_assigned_trainer_email = COALESCE(EXCLUDED.tpg_assigned_trainer_email, course_run.tpg_assigned_trainer_email),
       updated_at                 = NOW()
     RETURNING id, (xmax = 0) AS was_insert`,
    [newRunUuid, courseId, courseRunId, startDate, endDate, digitalAttendId, tpgTrainerName, tpgTrainerEmail]
  );

  const row = upsertResult.rows[0];
  if (row?.was_insert) {
    result.inserted = 1;
  } else {
    result.updated = 1;
  }

  return {
    courseRunUuid: row?.id ?? newRunUuid,
    courseCode: courseCode || null,
    courseTitle,
    result,
  };
}

// ── Step B: Course Sessions fetch + diff + (optionally) upsert ────────────────

async function fetchAndDiffSessions(
  credentials: { certificateContent?: string; privateKeyContent?: string; uen: string },
  client: PoolClient,
  courseRunUuid: string,
  courseRunId: string,
  courseCode: string,
  mode: UpsertFromSsgMode,
): Promise<UpsertFromSsgSessionsResult> {
  const result = emptySessionsResult();

  if (!courseCode) {
    throw new Error('Missing courseCode — cannot fetch sessions');
  }

  // Call SSG sessions endpoint directly (pattern from pages/api/ssg/courses/runs/[runId]/sessions.ts)
  const ssgBaseUrl = process.env.SSG_API_URL || 'https://api.ssg-wsg.sg';
  const builder = new HTTPRequestBuilder()
    .withEndpoint(ssgBaseUrl, `/courses/runs/${courseRunId}/sessions`)
    .withMethod(HttpMethod.GET)
    .withParam('uen', credentials.uen)
    .withParam('courseReferenceNumber', courseCode)
    .withParam('includeExpiredCourses', 'true');

  if (credentials.certificateContent && credentials.privateKeyContent) {
    builder.withCertificate(credentials.certificateContent, credentials.privateKeyContent);
  }

  const httpClient = new HttpClient(ssgBaseUrl, {
    'Content-Type': 'application/json',
    'Accept': 'application/json',
  });

  let ssgSessions: any[] = [];
  try {
    const httpResponse = await httpClient.request(builder.build());

    if (httpResponse.status === 404) {
      // No sessions registered — empty list is a valid response
      ssgSessions = [];
    } else if (httpResponse.status !== 200) {
      throw new Error(`SSG sessions fetch error ${httpResponse.status}`);
    } else {
      const parsed = typeof httpResponse.data === 'string'
        ? JSON.parse(httpResponse.data)
        : httpResponse.data;
      // Shape per pages/api/ssg/courses/runs/[runId]/sessions.ts:74 and
      // components/admin/GrantManagementViews.tsx:4793 (sessData.data.result.sessions)
      const wrapper = parsed?.data ?? parsed;
      ssgSessions = wrapper?.sessions ?? wrapper?.result?.sessions ?? [];
    }
  } catch (err) {
    throw new Error(`Failed to fetch SSG sessions: ${err instanceof Error ? err.message : 'unknown'}`);
  }

  // Query local sessions (not deleted) for diff
  const localSessions = await client.query(
    `SELECT ssg_session_id, session_number,
            start_date, end_date, start_time, end_time,
            mode_of_training, venue
       FROM course_session
      WHERE course_run_id = $1
        AND deleted = false`,
    [courseRunUuid]
  );

  const localById = new Map<string, any>();
  for (const row of localSessions.rows) {
    if (row.ssg_session_id) localById.set(row.ssg_session_id, row);
  }

  const seenSsgIds: string[] = [];
  const seenSsgIdsSet = new Set<string>();

  for (const s of ssgSessions) {
    const ssgSessionId = String(s?.id || '').trim();
    if (!ssgSessionId) continue;
    if (!seenSsgIdsSet.has(ssgSessionId)) {
      seenSsgIdsSet.add(ssgSessionId);
      seenSsgIds.push(ssgSessionId);
    }

    const sessionNumber = parseSessionNumber(ssgSessionId);
    const startDate = String(s.startDate || '').trim();
    const endDate = String(s.endDate || '').trim();
    const startTime = String(s.startTime || '').trim();
    const endTime = String(s.endTime || '').trim();
    const modeOfTraining = String(s.modeOfTraining || '').trim();

    const existing = localById.get(ssgSessionId);
    const detail: UpsertFromSsgSessionDetail = {
      ssgSessionId,
      sessionNumber,
      startDate,
      endDate,
      startTime,
      endTime,
    };

    if (!existing) {
      result.inserted++;
      result.insertedDetails.push(detail);
    } else {
      // Compare key fields and record per-field diff for update details
      const changed: UpsertFromSsgFieldDiff[] = [];
      if (!eq(existing.start_date, startDate))            changed.push({ field: 'start_date',       old: String(existing.start_date ?? ''),       new: startDate });
      if (!eq(existing.end_date, endDate))                changed.push({ field: 'end_date',         old: String(existing.end_date ?? ''),         new: endDate });
      if (!eq(existing.start_time, startTime))            changed.push({ field: 'start_time',       old: String(existing.start_time ?? ''),       new: startTime });
      if (!eq(existing.end_time, endTime))                changed.push({ field: 'end_time',         old: String(existing.end_time ?? ''),         new: endTime });
      if (!eq(existing.mode_of_training, modeOfTraining)) changed.push({ field: 'mode_of_training', old: String(existing.mode_of_training ?? ''), new: modeOfTraining });
      if (changed.length > 0) {
        result.updated++;
        result.updatedDetails.push({ ...detail, fieldsChanged: changed });
      }
    }
  }

  // Orphans — local sessions not in SSG response
  const localSessionIds = Array.from(localById.keys());
  for (const ssgId of localSessionIds) {
    if (!seenSsgIdsSet.has(ssgId)) {
      result.softDeleted++;
      const row = localById.get(ssgId)!;
      result.softDeletedDetails.push({
        ssgSessionId: ssgId,
        sessionNumber: String(row.session_number || ''),
        startDate: String(row.start_date || ''),
        endDate: String(row.end_date || ''),
        startTime: String(row.start_time || ''),
        endTime: String(row.end_time || ''),
      });
    }
  }

  if (mode === 'preview') {
    return result;
  }

  // ── Apply mode: upsert + soft-delete (reuses SQL from sync-from-ssg.ts) ──
  for (const s of ssgSessions) {
    const ssgSessionId = String(s?.id || '').trim();
    if (!ssgSessionId) continue;

    const sessionNumber = parseSessionNumber(ssgSessionId);
    const startDate = String(s.startDate || '').trim();
    const endDate = String(s.endDate || '').trim();
    const startTime = String(s.startTime || '').trim();
    const endTime = String(s.endTime || '').trim();
    const modeOfTraining = String(s.modeOfTraining || '').trim();
    const venueJson = s.venue ? JSON.stringify(s.venue) : '{}';
    const deleted = s.deleted === true;

    await client.query(
      `
      INSERT INTO course_session (
        course_run_id, ssg_session_id, session_number,
        start_date, end_date, start_time, end_time,
        mode_of_training, venue, deleted
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb, $10)
      ON CONFLICT (course_run_id, ssg_session_id)
      DO UPDATE SET
        session_number   = EXCLUDED.session_number,
        start_date       = EXCLUDED.start_date,
        end_date         = EXCLUDED.end_date,
        start_time       = EXCLUDED.start_time,
        end_time         = EXCLUDED.end_time,
        mode_of_training = EXCLUDED.mode_of_training,
        venue            = EXCLUDED.venue,
        deleted          = EXCLUDED.deleted,
        updated_at       = NOW()
      `,
      [
        courseRunUuid, ssgSessionId, sessionNumber,
        startDate, endDate, startTime, endTime,
        modeOfTraining, venueJson, deleted,
      ]
    );
  }

  // Soft-delete orphans
  if (seenSsgIds.length > 0) {
    const placeholders = seenSsgIds.map((_, i) => `$${i + 2}`).join(',');
    await client.query(
      `UPDATE course_session
          SET deleted = true, updated_at = NOW()
        WHERE course_run_id = $1
          AND deleted = false
          AND ssg_session_id NOT IN (${placeholders})`,
      [courseRunUuid, ...seenSsgIds]
    );
  } else {
    await client.query(
      `UPDATE course_session
          SET deleted = true, updated_at = NOW()
        WHERE course_run_id = $1 AND deleted = false`,
      [courseRunUuid]
    );
  }

  return result;
}

// ── Step C: Enrolments fetch + diff + (optionally) upsert ─────────────────────

async function fetchSsgEnrolments(
  credentials: {
    certificateContent?: string;
    privateKeyContent?: string;
    uen: string;
    encryptionKey: string;
  },
  courseRunId: string,
): Promise<any[]> {
  const ssgBaseUrl = process.env.SSG_API_URL || 'https://api.ssg-wsg.sg';
  const tp = await getTrainingPartnerIdentifiers();
  const tpUen = tp.uen || credentials.uen;
  const tpCode = tp.code;

  const payload = {
    parameters: { page: 0, pageSize: 100 },
    enrolment: {
      course: { run: { id: courseRunId } },
      trainingPartner: { uen: tpUen, code: tpCode },
    },
  };

  const encKey = Buffer.from(credentials.encryptionKey, 'base64');
  const iv = Buffer.from('SSGAPIInitVector', 'utf8');
  const cipher = crypto.createCipheriv('aes-256-cbc', encKey, iv);
  let encryptedPayload = cipher.update(JSON.stringify(payload), 'utf8', 'base64');
  encryptedPayload += cipher.final('base64');

  const builder = new HTTPRequestBuilder()
    .withEndpoint(ssgBaseUrl, '/tpg/enrolments/search')
    .withMethod(HttpMethod.POST)
    .withBody(encryptedPayload);

  if (credentials.certificateContent && credentials.privateKeyContent) {
    builder.withCertificate(credentials.certificateContent, credentials.privateKeyContent);
  }

  const httpClient = new HttpClient(ssgBaseUrl, {
    'Content-Type': 'application/json',
    'Accept': 'application/json',
  });
  const httpResponse = await httpClient.request(builder.build());

  if (httpResponse.status !== 200) {
    throw new Error(`SSG enrolment search error ${httpResponse.status}`);
  }

  const rawBody = typeof httpResponse.data === 'string'
    ? httpResponse.data
    : JSON.stringify(httpResponse.data);
  const decipher = crypto.createDecipheriv('aes-256-cbc', encKey, iv);
  let decrypted = decipher.update(rawBody, 'base64', 'utf8');
  decrypted += decipher.final('utf8');

  const parsed = JSON.parse(decrypted);

  if (parsed?.status && String(parsed.status) === '404') {
    return []; // no enrolments
  }
  if (parsed?.status && String(parsed.status) !== '200') {
    throw new Error(parsed?.error?.message || `SSG enrolment status ${parsed.status}`);
  }

  return parsed?.data ?? [];
}

async function fetchAndDiffEnrolments(
  credentials: {
    certificateContent?: string;
    privateKeyContent?: string;
    uen: string;
    encryptionKey: string;
  },
  client: PoolClient,
  courseRunUuid: string | null,
  courseRunId: string,
  mode: UpsertFromSsgMode,
): Promise<UpsertFromSsgEnrolmentsResult> {
  const result = emptyEnrolmentsResult();

  const ssgRecordsRaw = await fetchSsgEnrolments(credentials, courseRunId);

  // Unwrap either { enrolment: {...} } or the record directly
  const ssgRecordsUnwrapped = ssgRecordsRaw.map((r: any) => r?.enrolment ?? r);

  // ── Dedupe by trainee email: SSG can return multiple enrolment records for
  // the same user+CR (e.g. learner was cancelled then re-enrolled → two rows).
  // Local `enrollment` has UNIQUE (user_id, course_run_id) so only one can
  // survive. Policy: Confirmed wins over Cancelled, else first encountered.
  // Skipped dupes are surfaced as warnings in the result. ──
  const CONFIRMED_PRIORITY = (status: string | undefined | null): number => {
    const s = String(status || '').toLowerCase();
    if (s === 'confirmed') return 3;
    if (s === 'pending' || s === 'pending payment') return 2;
    if (s === 'cancelled' || s === 'rejected') return 0;
    return 1;
  };

  const groupsByEmail = new Map<string, any[]>();
  const noEmailRecords: any[] = [];
  for (const rec of ssgRecordsUnwrapped) {
    if (!rec?.referenceNumber) continue;
    const email = String(rec?.trainee?.email?.full ?? '').toLowerCase().trim();
    if (!email) {
      noEmailRecords.push(rec);
      continue;
    }
    const existing = groupsByEmail.get(email);
    if (existing) existing.push(rec);
    else groupsByEmail.set(email, [rec]);
  }

  const dupWarnings: UpsertFromSsgDupWarning[] = [];
  const filteredSsg: any[] = [...noEmailRecords];
  const emailKeys = Array.from(groupsByEmail.keys());
  for (const email of emailKeys) {
    const group = groupsByEmail.get(email)!;
    if (group.length === 1) {
      filteredSsg.push(group[0]);
      continue;
    }
    // Confirmed wins
    const sorted = [...group].sort((a, b) => CONFIRMED_PRIORITY(b?.status) - CONFIRMED_PRIORITY(a?.status));
    const picked = sorted[0];
    const skipped = sorted.slice(1);
    filteredSsg.push(picked);
    dupWarnings.push({
      traineeEmail: email,
      traineeName: String(picked?.trainee?.fullName ?? ''),
      picked: {
        enrolmentId: String(picked?.referenceNumber ?? ''),
        status: String(picked?.status ?? ''),
      },
      skipped: skipped.map((s: any) => ({
        enrolmentId: String(s?.referenceNumber ?? ''),
        status: String(s?.status ?? ''),
      })),
    });
  }
  result.dupWarnings = dupWarnings;

  const ssgByEnrolmentId = new Map<string, any>();
  for (const rec of filteredSsg) {
    const id = rec?.referenceNumber;
    if (id) ssgByEnrolmentId.set(String(id), rec);
  }

  const ssgEnrolmentIds = Array.from(ssgByEnrolmentId.keys());

  // ── Existence check #1: by enrolment_id globally ──
  let globalMatches: Array<{
    enrolment_id: string;
    course_run_id: string;
    enrolment_status: string | null;
    course_sponsorship: string | null;
    email: string | null;
  }> = [];
  if (ssgEnrolmentIds.length > 0) {
    const res = await client.query(
      `SELECT enrolment_id,
              course_run_id::text AS course_run_id,
              enrolment_status,
              course_sponsorship::text AS course_sponsorship,
              email
         FROM enrollment
        WHERE enrolment_id = ANY($1::text[])`,
      [ssgEnrolmentIds]
    );
    globalMatches = res.rows;
  }

  const globalByEnrolmentId = new Map<string, typeof globalMatches[number]>();
  for (const row of globalMatches) {
    if (row.enrolment_id) globalByEnrolmentId.set(row.enrolment_id, row);
  }

  // ── Existence check #2: fallback by (user_id, course_run_id). Handles the
  // case where SSG assigned a NEW enrolment_id to a user who's already
  // enrolled in this CR locally (under an OLD enrolment_id). Without this
  // fallback the diff would count as insert, the apply would hit the UNIQUE
  // (user_id, course_run_id) constraint, ON CONFLICT DO NOTHING would swallow
  // it, and the loop would repeat forever. ──
  type UserCrMatch = {
    enrollment_id_pk: string; // enrollment.id (UUID)
    enrolment_id: string | null;
    enrolment_status: string | null;
    course_sponsorship: string | null;
    email: string | null;
  };
  const userCrMatchesByEmail = new Map<string, UserCrMatch>();
  if (courseRunUuid && ssgEnrolmentIds.length > 0) {
    // Collect emails from SSG records that didn't match by enrolment_id
    const emailsToCheck: string[] = [];
    for (const enrolmentId of ssgEnrolmentIds) {
      if (globalByEnrolmentId.has(enrolmentId)) continue;
      const rec = ssgByEnrolmentId.get(enrolmentId);
      const email = String(rec?.trainee?.email?.full ?? '').toLowerCase().trim();
      if (email) emailsToCheck.push(email);
    }
    if (emailsToCheck.length > 0) {
      const res = await client.query(
        `SELECT e.id AS enrollment_id_pk,
                e.enrolment_id,
                e.enrolment_status,
                e.course_sponsorship::text AS course_sponsorship,
                LOWER(TRIM(u.email)) AS email
           FROM enrollment e
           JOIN app_user u ON u.id = e.user_id
          WHERE e.course_run_id = $1
            AND LOWER(TRIM(u.email)) = ANY($2::text[])`,
        [courseRunUuid, emailsToCheck]
      );
      for (const row of res.rows) {
        if (row.email) userCrMatchesByEmail.set(row.email, row);
      }
    }
  }

  // Query CR-scoped local enrolments (for orphans detection only)
  let crScopedLocal: Array<{ enrolment_id: string; email: string | null }> = [];
  if (courseRunUuid) {
    const local = await client.query(
      `SELECT enrolment_id, email
         FROM enrollment
        WHERE course_run_id = $1
          AND enrolment_id IS NOT NULL`,
      [courseRunUuid]
    );
    crScopedLocal = local.rows;
  }

  // Inserts & updates.
  // Match priority: (1) by enrolment_id globally, (2) fallback by (user email + CR).
  // Fallback match means "same learner is already enrolled but under a different
  // enrolment_id" — treat as UPDATE to keep the single (user,CR) row in sync.
  // Note: SSG's sponsorshipType when missing/NULL is coerced to 'Individual'
  // to match syncEnrolmentToDB's mapSponsorship semantics.
  for (const enrolmentId of ssgEnrolmentIds) {
    const rec = ssgByEnrolmentId.get(enrolmentId);
    const traineeName = String(rec?.trainee?.fullName ?? '').trim();
    const email = String(rec?.trainee?.email?.full ?? '').trim();
    const emailKey = email.toLowerCase();
    const ssgStatus = rec?.status ?? null;
    const ssgSponsorshipRaw = (rec?.trainee?.sponsorshipType || '').toString().toUpperCase();
    const ssgSponsorship = ssgSponsorshipRaw.includes('EMPLOYER') ? 'Employer' : 'Individual';

    // Match #1: exact enrolment_id
    const existingByEnrolmentId = globalByEnrolmentId.get(enrolmentId);
    if (existingByEnrolmentId) {
      const fieldsChanged: UpsertFromSsgFieldDiff[] = [];
      if (!eq(existingByEnrolmentId.enrolment_status, ssgStatus)) {
        fieldsChanged.push({ field: 'enrolment_status', old: existingByEnrolmentId.enrolment_status ?? null, new: ssgStatus ?? null });
      }
      if (!eq(existingByEnrolmentId.course_sponsorship, ssgSponsorship)) {
        fieldsChanged.push({ field: 'course_sponsorship', old: existingByEnrolmentId.course_sponsorship ?? null, new: ssgSponsorship });
      }
      if (fieldsChanged.length > 0) {
        result.updated++;
        result.updatedDetails.push({
          enrolmentId,
          email: existingByEnrolmentId.email || email,
          traineeName,
          fieldsChanged,
        });
      }
      continue;
    }

    // Match #2: fallback by (email → user → same CR). Different enrolment_id
    // but same learner in same CR — update the existing row's enrolment_id +
    // status + sponsorship.
    const existingByUserCr = userCrMatchesByEmail.get(emailKey);
    if (existingByUserCr) {
      const fieldsChanged: UpsertFromSsgFieldDiff[] = [];
      if (!eq(existingByUserCr.enrolment_id, enrolmentId)) {
        fieldsChanged.push({ field: 'enrolment_id', old: existingByUserCr.enrolment_id ?? null, new: enrolmentId });
      }
      if (!eq(existingByUserCr.enrolment_status, ssgStatus)) {
        fieldsChanged.push({ field: 'enrolment_status', old: existingByUserCr.enrolment_status ?? null, new: ssgStatus ?? null });
      }
      if (!eq(existingByUserCr.course_sponsorship, ssgSponsorship)) {
        fieldsChanged.push({ field: 'course_sponsorship', old: existingByUserCr.course_sponsorship ?? null, new: ssgSponsorship });
      }
      if (fieldsChanged.length > 0) {
        result.updated++;
        result.updatedDetails.push({
          enrolmentId,
          email: existingByUserCr.email || email,
          traineeName,
          fieldsChanged,
        });
      }
      continue;
    }

    // No match — new insert
    result.inserted++;
    result.insertedDetails.push({
      enrolmentId,
      email,
      traineeName,
    });
  }

  // Orphans — local enrolments for THIS CR not in SSG response.
  // Report only, never written (see database/01-schema.sql:835-857 — no
  // deleted column on enrollment; locked decision 2026-04-10).
  const orphans: UpsertFromSsgOrphan[] = [];
  for (const row of crScopedLocal) {
    if (!ssgByEnrolmentId.has(row.enrolment_id)) {
      orphans.push({ enrolmentId: row.enrolment_id, email: row.email || '' });
    }
  }
  result.orphans = orphans;

  if (mode === 'preview') return result;

  // ── Apply mode: three paths per SSG enrolment ──
  //   1. Matches by enrolment_id globally → UPDATE by enrolment_id
  //   2. Matches by (user email + CR) with different enrolment_id → UPDATE by PK
  //   3. No match → INSERT via syncEnrolmentToDB
  for (const enrolmentId of ssgEnrolmentIds) {
    const rec = ssgByEnrolmentId.get(enrolmentId);
    const email = String(rec?.trainee?.email?.full ?? '').toLowerCase().trim();
    const ssgStatus = rec?.status ?? null;
    const ssgSponsorshipRaw = (rec?.trainee?.sponsorshipType || '').toString().toUpperCase();
    const ssgSponsorship = ssgSponsorshipRaw.includes('EMPLOYER') ? 'Employer' : 'Individual';

    const existingByEnrolmentId = globalByEnrolmentId.get(enrolmentId);
    const existingByUserCr = !existingByEnrolmentId ? userCrMatchesByEmail.get(email) : null;

    if (existingByUserCr) {
      // Path 2: update the existing row in place, rewriting its enrolment_id
      // + status + sponsorship. This handles SSG re-assigning a new reference
      // number to a learner who's already locally enrolled under an older one.
      try {
        await client.query(
          `UPDATE enrollment
              SET enrolment_id        = $1,
                  enrolment_status    = COALESCE($2, enrolment_status),
                  course_sponsorship  = COALESCE($3::course_sponsorship, course_sponsorship),
                  updated_at          = NOW()
            WHERE id = $4`,
          [enrolmentId, ssgStatus, ssgSponsorship, existingByUserCr.enrollment_id_pk]
        );
        console.log(`[upsert-from-ssg] Updated enrollment PK=${existingByUserCr.enrollment_id_pk} — enrolment_id ${existingByUserCr.enrolment_id} → ${enrolmentId}`);
      } catch (err) {
        console.error(`[upsert-from-ssg] Failed to update enrolment PK=${existingByUserCr.enrollment_id_pk}:`, err);
      }
      continue;
    }

    if (!existingByEnrolmentId) {
      // Path 3: insert via shared helper. NON-FATAL: a single failure is
      // logged but does not roll back the CR transaction.
      try {
        const syncResult = await syncEnrolmentToDB(client, rec);
        console.log(`[upsert-from-ssg] syncEnrolmentToDB(${enrolmentId}) → ${syncResult}`);
      } catch (err) {
        console.error(`[upsert-from-ssg] Failed to insert enrolment ${enrolmentId}:`, err);
      }
      continue;
    }

    // Path 1: matched by enrolment_id — update status/sponsorship in place.
    {
      const existing = existingByEnrolmentId;
      const statusChanged = !eq(existing.enrolment_status, ssgStatus);
      const sponsorshipChanged = !eq(existing.course_sponsorship, ssgSponsorship);
      if (statusChanged || sponsorshipChanged) {
        await client.query(
          `UPDATE enrollment
              SET enrolment_status    = COALESCE($1, enrolment_status),
                  course_sponsorship  = COALESCE($2::course_sponsorship, course_sponsorship),
                  updated_at          = NOW()
            WHERE enrolment_id = $3`,
          [ssgStatus, ssgSponsorship, enrolmentId]
        );
      }
    }
  }

  // Orphans are NEVER written — report only per locked decision 2026-04-10.
  // See database/01-schema.sql:835-857 — enrollment has no deleted column.

  return result;
}

// ── Main handler ──────────────────────────────────────────────────────────────

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method === 'OPTIONS') {
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    return res.status(200).end();
  }
  if (req.method !== 'POST') {
    return res.status(405).json({ success: false, error: 'Method not allowed' });
  }

  // ── Request validation ──
  const body = (req.body || {}) as Partial<UpsertFromSsgRequest>;
  const rawIds = Array.isArray(body.courseRunIds) ? body.courseRunIds : null;
  const mode = body.mode;

  if (!rawIds || rawIds.length === 0) {
    return res.status(400).json({
      success: false,
      error: 'courseRunIds must be a non-empty array',
    });
  }
  if (mode !== 'preview' && mode !== 'apply') {
    return res.status(400).json({
      success: false,
      error: "mode must be 'preview' or 'apply'",
    });
  }

  // Trim, drop empty, dedupe
  const seen = new Set<string>();
  const courseRunIds: string[] = [];
  for (const raw of rawIds) {
    if (typeof raw !== 'string') continue;
    const trimmed = raw.trim();
    if (!trimmed) continue;
    if (seen.has(trimmed)) continue;
    seen.add(trimmed);
    courseRunIds.push(trimmed);
  }

  if (courseRunIds.length === 0) {
    return res.status(400).json({
      success: false,
      error: 'courseRunIds contained no valid non-empty strings',
    });
  }

  // Dedup BEFORE cap check so ["x","x"] counts as 1
  if (courseRunIds.length > UPSERT_FROM_SSG_MAX_BATCH) {
    return res.status(400).json({
      success: false,
      error: `Maximum ${UPSERT_FROM_SSG_MAX_BATCH} course run IDs per batch`,
    });
  }

  try {
    // Resolve credentials once (x-ssg-app honored)
    const credentials = await getSSGCredentialsService().getSSGCredentials(
      undefined,
      (req.headers['x-ssg-app'] as string) || undefined,
    );
    if (!credentials) {
      return res.status(500).json({ success: false, error: 'SSG credentials not found' });
    }

    const ssgBaseUrl = process.env.SSG_API_URL || 'https://api.ssg-wsg.sg';
    const ssgApi = createSSGCourseAPI(ssgBaseUrl, credentials);

    const results: UpsertFromSsgCrResult[] = [];

    // Process each CR sequentially. One connection + transaction per CR.
    for (const courseRunId of courseRunIds) {
      console.log(`[upsert-from-ssg] Processing CR ${courseRunId} in mode=${mode}`);

      const crResult: UpsertFromSsgCrResult = {
        courseRunId,
        status: 'success',
        courseRun: emptyCourseRunResult(),
        sessions: emptySessionsResult(),
        enrolments: emptyEnrolmentsResult(),
      };

      const client = await pool.connect();
      try {
        await client.query('BEGIN');

        // ── Step A: course run ──
        let courseRunStep: CourseRunStepOutput;
        try {
          courseRunStep = await fetchAndDiffCourseRun(ssgApi, client, courseRunId, mode);
          crResult.courseRun = courseRunStep.result;
          crResult.courseTitle = courseRunStep.courseTitle;
        } catch (err) {
          await client.query('ROLLBACK');
          crResult.status = 'failed';
          crResult.failedStep = 'courseRun';
          crResult.error = err instanceof Error ? err.message : 'Unknown error';
          console.error(`[upsert-from-ssg] CR ${courseRunId} failed at step A:`, err);
          results.push(crResult);
          continue;
        }

        // ── Step B: sessions ──
        try {
          if (!courseRunStep.courseRunUuid) {
            // Preview mode with no local row — skip sessions step (nothing to diff against locally)
            crResult.sessions = emptySessionsResult();
          } else {
            crResult.sessions = await fetchAndDiffSessions(
              credentials,
              client,
              courseRunStep.courseRunUuid,
              courseRunId,
              courseRunStep.courseCode || '',
              mode,
            );
          }
        } catch (err) {
          await client.query('ROLLBACK');
          // Step A succeeded but Step B failed — during apply this is 'partial'.
          // Preview is still 'failed' since we can't show a full diff.
          crResult.status = mode === 'apply' ? 'partial' : 'failed';
          crResult.failedStep = 'sessions';
          crResult.error = err instanceof Error ? err.message : 'Unknown error';
          console.error(`[upsert-from-ssg] CR ${courseRunId} failed at step B:`, err);
          results.push(crResult);
          continue;
        }

        // ── Step C: enrolments ──
        try {
          crResult.enrolments = await fetchAndDiffEnrolments(
            credentials,
            client,
            courseRunStep.courseRunUuid,
            courseRunId,
            mode,
          );
        } catch (err) {
          await client.query('ROLLBACK');
          crResult.status = mode === 'apply' ? 'partial' : 'failed';
          crResult.failedStep = 'enrolments';
          crResult.error = err instanceof Error ? err.message : 'Unknown error';
          console.error(`[upsert-from-ssg] CR ${courseRunId} failed at step C:`, err);
          results.push(crResult);
          continue;
        }

        // All 3 steps succeeded.
        if (mode === 'apply') {
          await client.query('COMMIT');

          // Trigger DA applicant calendar sync (non-blocking background task)
          // Ensures any confirmed DA applicants are added to these new sessions.
          if (courseRunStep.courseRunUuid) {
            setImmediate(() => {
              syncAllDaApplicantsToCalendar(courseRunStep.courseRunUuid!).catch(err => {
                console.error('❌ [upsert-from-ssg] background DA calendar sync failed:', err);
              });
              // Also reconcile the durable class event + attendees for this run.
              triggerClassCalendarSync(courseRunStep.courseRunUuid!);
            });
          }
        } else {
          // Preview should never have any writes, but roll back defensively.
          await client.query('ROLLBACK');
        }

        results.push(crResult);
      } catch (outerErr) {
        try { await client.query('ROLLBACK'); } catch { /* ignore */ }
        crResult.status = 'failed';
        crResult.error = outerErr instanceof Error ? outerErr.message : 'Unknown orchestration error';
        console.error(`[upsert-from-ssg] CR ${courseRunId} outer error:`, outerErr);
        results.push(crResult);
      } finally {
        client.release();
      }
    }

    const summary = {
      total: results.length,
      succeeded: results.filter(r => r.status === 'success').length,
      failed: results.filter(r => r.status === 'failed').length,
      partial: results.filter(r => r.status === 'partial').length,
    };

    const response: UpsertFromSsgResponse = {
      success: true,
      mode,
      results,
      summary,
    };

    return res.status(200).json(response);
  } catch (error) {
    console.error('[upsert-from-ssg] Fatal:', error);
    return res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Internal server error',
    });
  }
}
