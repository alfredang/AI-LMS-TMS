import type { NextApiRequest, NextApiResponse } from 'next';
import pool from '../../../lib/db';
import { getSSGCredentialsService } from '../../../lib/ssg/services/credentials-service';
import { createSSGCourseAPI } from '../../../lib/ssg/api/course-api';
import { OptionalSelector } from '../../../lib/ssg/models/course-runs';
import { EditRunInfo } from '../../../lib/ssg/models/edit-delete-course-run';
import {
  buildUpdateSessionsPayload,
  computeRunWindow,
  convertSsgDateToHtml,
} from '../../../lib/ssg/sessionEditHelpers';
import { fetchAndSyncRunSessions } from '../../../lib/ssg/syncRunSessions';
import { pushTrainerToTpgForRun, resolveRunTrainerEditPayloads } from '../../../lib/ssg/pushTrainerToTpgForRun';
import { reconcileRunCalendar } from '../../../lib/calendar/reconcileRunCalendar';
import { checkSiblingRunDateConflicts } from '../../../lib/rescheduleHelpers';

/**
 * POST /api/external/reschedule-session
 *
 * Move a single SSG session to a new date/time within the same course run.
 * Commit ordering: SSG edit first → LMS local sync → GCal reconcile (best-effort).
 * SSG wipes the run's trainer on any session edit; it is re-asserted afterwards.
 *
 * Body:
 * {
 *   run_id:          string,   // SSG run ID (e.g. "TGS-...-01") or internal UUID
 *   session_id:      string,   // SSG session ID — from /api/external/run-sessions
 *   new_date:        string,   // YYYY-MM-DD — the new session date
 *   new_start_time?: string,   // HH:mm — keeps existing time if omitted
 *   new_end_time?:   string,   // HH:mm — keeps existing time if omitted
 *   sync_calendar?:  boolean   // default true — reconcile GCal after SSG + LMS update
 * }
 *
 * Response (success):
 * {
 *   success: true,
 *   session_id: string,
 *   new_date: string,
 *   sibling_run_conflict?: [{ course_run_id: string, matched_dates: string[] }],
 *     // advisory only — another active run of the SAME course already has a session on
 *     // one of the new date(s). The move still executes; surface this to the user and
 *     // ask whether they meant to consolidate into that run instead.
 *   ssg: { status: 'ok', ... },
 *   lms_sync: { ok: boolean, upserted?: number },
 *   tpg_trainer: { status: string, message?: string },
 *   calendar: { status: 'ok'|'skipped', ... }
 * }
 *
 * Headers: x-api-key: <EXTERNAL_API_KEY_FOR_CLAWDBOT>
 */
export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, x-api-key');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ success: false, error: 'Method not allowed' });

  const apiKey = req.headers['x-api-key'];
  const validKey = process.env.EXTERNAL_API_KEY_FOR_CLAWDBOT;
  if (!validKey) return res.status(500).json({ success: false, error: 'API key not configured on server' });
  if (!apiKey || apiKey !== validKey) return res.status(401).json({ success: false, error: 'Invalid or missing API key' });

  const {
    run_id,
    session_id,
    new_date,
    new_start_time,
    new_end_time,
    sync_calendar = true,
  } = (req.body || {}) as {
    run_id?: string;
    session_id?: string;
    new_date?: string;
    new_start_time?: string;
    new_end_time?: string;
    sync_calendar?: boolean;
  };

  // Coerce boolean fields — JSON string "false" must not be truthy
  const syncCalendar = req.body?.sync_calendar !== false && req.body?.sync_calendar !== 'false';

  if (!run_id?.trim()) return res.status(400).json({ success: false, error: 'run_id is required' });
  if (!session_id?.trim()) return res.status(400).json({ success: false, error: 'session_id is required' });
  const dateTrimmed = new_date?.trim() ?? '';
  if (!dateTrimmed || !/^\d{4}-\d{2}-\d{2}$/.test(dateTrimmed)) {
    return res.status(400).json({ success: false, error: 'new_date is required (YYYY-MM-DD)' });
  }
  // Logical date validation — catches impossible dates like 2026-02-30
  const parsedDate = new Date(dateTrimmed + 'T00:00:00Z');
  if (isNaN(parsedDate.getTime()) || parsedDate.toISOString().slice(0, 10) !== dateTrimmed) {
    return res.status(400).json({ success: false, error: `new_date "${dateTrimmed}" is not a valid calendar date` });
  }

  try {
    // 1. Resolve run from DB
    const runRow = (await pool.query<{
      id: string; course_id: string; course_run_id: string; course_code: string; admin_email: string | null;
    }>(
      `SELECT cr.id, cr.course_id, cr.course_run_id, c.course_code,
              cr.course_admin_email AS admin_email
         FROM course_run cr
         JOIN course c ON c.id = cr.course_id
        WHERE cr.course_run_id = $1 OR cr.id::text = $1 LIMIT 1`,
      [run_id.trim()]
    )).rows[0];
    if (!runRow) return res.status(404).json({ success: false, error: `Run ${run_id} not found in LMS` });

    const runUuid = runRow.id;
    const courseId = runRow.course_id;
    const ssgRunId = runRow.course_run_id;
    const courseReferenceNumber = runRow.course_code;
    const adminEmail = runRow.admin_email || 'admin@tia.sg';

    // 2. Resolve session from local DB
    const sessRow = (await pool.query<{
      ssg_session_id: string; start_date: string; end_date: string | null;
      start_time: string | null; end_time: string | null; mode_of_training: string | null; venue: any;
    }>(
      `SELECT ssg_session_id, start_date::text, end_date::text, start_time, end_time, mode_of_training, venue
         FROM course_session WHERE course_run_id = $1 AND ssg_session_id = $2 AND COALESCE(deleted, false) = false
        LIMIT 1`,
      [runUuid, session_id.trim()]
    )).rows[0];
    if (!sessRow) return res.status(404).json({ success: false, error: `Session ${session_id} not found on run ${run_id}` });

    // 3. Get SSG credentials and create API client
    const credentials = await getSSGCredentialsService().getSSGCredentials();
    if (!credentials) return res.status(500).json({ success: false, error: 'SSG credentials not configured' });
    if (!credentials.encryptionKey) return res.status(500).json({ success: false, error: 'SSG encryption key not configured' });

    const apiClient = createSSGCourseAPI(credentials.ssgApiBaseUrl, credentials);

    // 4. Fetch live run data from SSG (needed for venue, registration dates in the payload)
    const runDataRes = await apiClient.viewCourseRun(ssgRunId, OptionalSelector.YES);
    const ssgErr = runDataRes.error;
    if (ssgErr && (ssgErr.code || ssgErr.message || ssgErr.details?.length)) {
      const errMsg = ssgErr.message || ssgErr.details?.[0]?.message || ssgErr.code || JSON.stringify(ssgErr);
      return res.status(502).json({ success: false, error: `Failed to fetch run data from SSG: ${errMsg}` });
    }
    if (!runDataRes.data) {
      return res.status(502).json({ success: false, error: 'SSG returned no run data — the run may not exist in SSG' });
    }
    const runData = (runDataRes.data as any)?.course?.run || {};

    // 5. Derive original dates and check for no-op / past date
    const origStart = sessRow.start_date ? String(sessRow.start_date).slice(0, 10) : '';
    const origEnd   = sessRow.end_date   ? String(sessRow.end_date).slice(0, 10)   : origStart;
    const newStartTime = new_start_time?.trim() || sessRow.start_time || '';
    const newEndTime   = new_end_time?.trim()   || sessRow.end_time   || '';

    // No-op guard: same date and same times as current session
    if (
      dateTrimmed === origStart &&
      (!new_start_time || newStartTime === (sessRow.start_time || '')) &&
      (!new_end_time   || newEndTime   === (sessRow.end_time   || ''))
    ) {
      return res.status(400).json({
        success: false,
        error: `Session is already scheduled for ${dateTrimmed} with the same times — no change would be made`,
      });
    }

    // Past date: warn in response (not a hard block — SSG decides)
    const pastDateWarning = parsedDate < new Date(new Date().toISOString().slice(0, 10) + 'T00:00:00Z')
      ? `new_date ${dateTrimmed} is in the past — TPGateway may reject this`
      : null;

    // Fix multi-day session: preserve the span (endDate offset = origEnd - origStart days)
    const spanMs = origEnd && origStart && origEnd !== origStart
      ? new Date(origEnd + 'T00:00:00Z').getTime() - new Date(origStart + 'T00:00:00Z').getTime()
      : 0;
    const newEndDate = spanMs > 0
      ? new Date(parsedDate.getTime() + spanMs).toISOString().slice(0, 10)
      : dateTrimmed;

    // Compute widened run window (SSG rejects sessions outside the run window)
    const { newRunStart, newRunEnd } = computeRunWindow(runData, {}, dateTrimmed, newEndDate);

    // Advisory: does another active run of the SAME course already have a session on the
    // new date(s)? Soft warning only — does not block the move.
    const siblingRunConflicts = await checkSiblingRunDateConflicts(
      courseId, runUuid, [dateTrimmed, newEndDate], (sql, params) => pool.query(sql, params)
    );

    // 6. Build session object (preserve existing time/mode/venue if not overridden)
    const sessionObj = {
      id: sessRow.ssg_session_id,
      startDate: dateTrimmed,
      endDate: newEndDate,
      startTime: newStartTime,
      endTime: newEndTime,
      modeOfTraining: sessRow.mode_of_training || '1',
      venue: sessRow.venue || undefined,
    };

    // 7. Build SSG update-sessions payload and split sessions from run metadata
    const payload = buildUpdateSessionsPayload({
      courseReferenceNumber,
      runData,
      sessions: [sessionObj],
      currentUserEmail: adminEmail,
      newRunStart,
      newRunEnd,
    });
    const { sessions: sessionsArr, ...runInfo } = payload;

    // 8. Include trainer payloads so SSG doesn't wipe on session edit
    const trainerPayloads = await resolveRunTrainerEditPayloads(runUuid).catch(() => undefined);

    console.log(`[external/reschedule-session] ${session_id} on ${ssgRunId}: ${origStart} → ${dateTrimmed}${spanMs > 0 ? ` (multi-day, end: ${newEndDate})` : ''}`);

    // 9. Call SSG
    const ssgResult = await apiClient.updateSessionsFromCourseRun(
      ssgRunId, runInfo as EditRunInfo, sessionsArr, OptionalSelector.YES, trainerPayloads
    );
    const ssgUpdateErr = ssgResult.error;
    if (ssgUpdateErr && (ssgUpdateErr.code || ssgUpdateErr.message || ssgUpdateErr.details?.length)) {
      return res.status(ssgResult.status || 502).json({
        success: false,
        error: `SSG session update failed: ${ssgUpdateErr.message || ssgUpdateErr.details?.[0]?.message || ssgUpdateErr.code}`,
        step: 'ssg',
      });
    }

    // 10. Sync local DB from SSG (sessions, run window)
    const lmsSync = await fetchAndSyncRunSessions(runUuid);

    // 11. Re-assert trainer (SSG wipes trainer on any session edit)
    let tpgTrainer: any = { status: 'skipped', message: 'no trainer assigned' };
    try {
      const tr = await pushTrainerToTpgForRun(runUuid);
      tpgTrainer = { status: tr.status, message: tr.message };
    } catch (e: any) {
      tpgTrainer = { status: 'error', message: e?.message };
    }

    // 12. GCal reconcile (best-effort last)
    let calendar: any = { status: 'skipped', message: 'sync_calendar disabled' };
    if (syncCalendar) {
      try {
        calendar = await reconcileRunCalendar(runUuid);
      } catch (e: any) {
        calendar = { status: 'error', message: e?.message };
      }
    }

    return res.status(200).json({
      success: true,
      session_id: session_id.trim(),
      new_date: dateTrimmed,
      new_end_date: newEndDate !== dateTrimmed ? newEndDate : undefined,
      ...(pastDateWarning ? { past_date_warning: pastDateWarning } : {}),
      ...(siblingRunConflicts.length ? { sibling_run_conflict: siblingRunConflicts } : {}),
      ssg: { status: 'ok', data: ssgResult.data },
      lms_sync: { ok: lmsSync.ok, upserted: lmsSync.upserted, error: lmsSync.error },
      tpg_trainer: tpgTrainer,
      calendar,
    });
  } catch (err: any) {
    console.error('[external/reschedule-session] error:', err);
    return res.status(500).json({ success: false, error: err?.message || 'Unexpected error' });
  }
}
