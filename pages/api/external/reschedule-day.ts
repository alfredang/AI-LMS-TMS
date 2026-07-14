import type { NextApiRequest, NextApiResponse } from 'next';
import pool from '../../../lib/db';
import { getSSGCredentialsService } from '../../../lib/ssg/services/credentials-service';
import { createSSGCourseAPI } from '../../../lib/ssg/api/course-api';
import { OptionalSelector } from '../../../lib/ssg/models/course-runs';
import { EditRunInfo } from '../../../lib/ssg/models/edit-delete-course-run';
import {
  buildUpdateSessionsPayload,
  computeRunWindow,
} from '../../../lib/ssg/sessionEditHelpers';
import { fetchAndSyncRunSessions } from '../../../lib/ssg/syncRunSessions';
import { pushTrainerToTpgForRun, resolveRunTrainerEditPayloads } from '../../../lib/ssg/pushTrainerToTpgForRun';
import { reconcileRunCalendar } from '../../../lib/calendar/reconcileRunCalendar';

/**
 * POST /api/external/reschedule-day
 *
 * Move ALL sessions on a given date to a new date within the same course run.
 * Use when a training day is rescheduled: finds every SSG session with start_date = from_date
 * and updates them to to_date in a single SSG call.
 *
 * Commit ordering: SSG edit first → LMS local sync → GCal reconcile (best-effort).
 * SSG wipes the run's trainer on any session edit; it is re-asserted afterwards.
 *
 * Body:
 * {
 *   run_id:          string,   // SSG run ID (e.g. "TGS-...-01") or internal UUID
 *   from_date:       string,   // YYYY-MM-DD — the day being rescheduled
 *   to_date:         string,   // YYYY-MM-DD — the new date
 *   new_start_time?: string,   // HH:mm — apply to all sessions on the day (keeps existing if omitted)
 *   new_end_time?:   string,   // HH:mm — apply to all sessions on the day (keeps existing if omitted)
 *   sync_calendar?:  boolean   // default true
 * }
 *
 * Response (success):
 * {
 *   success: true,
 *   from_date: string,
 *   to_date: string,
 *   sessions_moved: number,
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
    from_date,
    to_date,
    new_start_time,
    new_end_time,
    sync_calendar = true,
  } = (req.body || {}) as {
    run_id?: string;
    from_date?: string;
    to_date?: string;
    new_start_time?: string;
    new_end_time?: string;
    sync_calendar?: boolean;
  };

  if (!run_id?.trim()) return res.status(400).json({ success: false, error: 'run_id is required' });
  if (!from_date?.trim() || !/^\d{4}-\d{2}-\d{2}$/.test(from_date.trim())) {
    return res.status(400).json({ success: false, error: 'from_date is required (YYYY-MM-DD)' });
  }
  if (!to_date?.trim() || !/^\d{4}-\d{2}-\d{2}$/.test(to_date.trim())) {
    return res.status(400).json({ success: false, error: 'to_date is required (YYYY-MM-DD)' });
  }
  if (from_date.trim() === to_date.trim()) {
    return res.status(400).json({ success: false, error: 'from_date and to_date must differ' });
  }

  try {
    // 1. Resolve run from DB
    const runRow = (await pool.query<{
      id: string; course_run_id: string; course_code: string; admin_email: string | null;
    }>(
      `SELECT cr.id, cr.course_run_id, c.course_code,
              COALESCE(cr.course_admin_email, tp.contact_email) AS admin_email
         FROM course_run cr
         JOIN course c ON c.id = cr.course_id
         LEFT JOIN training_provider tp ON tp.id = c.training_provider_id
        WHERE cr.course_run_id = $1 OR cr.id::text = $1 LIMIT 1`,
      [run_id.trim()]
    )).rows[0];
    if (!runRow) return res.status(404).json({ success: false, error: `Run ${run_id} not found in LMS` });

    const runUuid = runRow.id;
    const ssgRunId = runRow.course_run_id;
    const courseReferenceNumber = runRow.course_code;
    const adminEmail = runRow.admin_email || 'admin@tia.sg';

    // 2. Find all sessions on from_date
    const sessRows = (await pool.query<{
      ssg_session_id: string; start_date: string; end_date: string | null;
      start_time: string | null; end_time: string | null; mode_of_training: string | null; venue: any;
    }>(
      `SELECT ssg_session_id, start_date::text, end_date::text, start_time, end_time, mode_of_training, venue
         FROM course_session
        WHERE course_run_id = $1
          AND start_date::date = $2::date
          AND COALESCE(deleted, false) = false
        ORDER BY start_time ASC`,
      [runUuid, from_date.trim()]
    )).rows;

    if (sessRows.length === 0) {
      return res.status(404).json({
        success: false,
        error: `No active sessions found on ${from_date} for run ${run_id}`,
      });
    }

    // 3. Get SSG credentials and create API client
    const credentials = await getSSGCredentialsService().getSSGCredentials();
    if (!credentials) return res.status(500).json({ success: false, error: 'SSG credentials not configured' });
    if (!credentials.encryptionKey) return res.status(500).json({ success: false, error: 'SSG encryption key not configured' });

    const apiClient = createSSGCourseAPI(credentials.ssgApiBaseUrl, credentials);

    // 4. Fetch live run data from SSG
    const runDataRes = await apiClient.viewCourseRun(ssgRunId, OptionalSelector.YES);
    if (runDataRes.error) {
      return res.status(502).json({ success: false, error: `Failed to fetch run data from SSG: ${runDataRes.error.message}` });
    }
    const runData = (runDataRes.data as any)?.course?.run || {};

    // 5. Compute date offset for multi-day sessions (from_date → to_date)
    const fromMs = new Date(from_date.trim() + 'T00:00:00Z').getTime();
    const toMs = new Date(to_date.trim() + 'T00:00:00Z').getTime();
    const daysDiffMs = toMs - fromMs;

    // 6. Build session objects (preserve existing time/mode/venue unless overridden)
    const sessionObjects = sessRows.map((s) => {
      const origStart = s.start_date ? String(s.start_date).slice(0, 10) : from_date.trim();
      const origEnd = s.end_date ? String(s.end_date).slice(0, 10) : origStart;
      const newEndDate = origEnd === origStart
        ? to_date.trim()
        : new Date(new Date(origEnd + 'T00:00:00Z').getTime() + daysDiffMs).toISOString().slice(0, 10);
      return {
        id: s.ssg_session_id,
        startDate: to_date.trim(),
        endDate: newEndDate,
        startTime: new_start_time?.trim() || s.start_time || '',
        endTime: new_end_time?.trim() || s.end_time || '',
        modeOfTraining: s.mode_of_training || '1',
        venue: s.venue || undefined,
      };
    });

    // 7. Compute widened run window across all new session dates
    const allNewDates = sessionObjects.map((s) => s.startDate).concat(sessionObjects.map((s) => s.endDate));
    const minDate = allNewDates.reduce((a, b) => (a < b ? a : b));
    const maxDate = allNewDates.reduce((a, b) => (a > b ? a : b));
    const { newRunStart, newRunEnd } = computeRunWindow(runData, {}, minDate, maxDate);

    // 8. Build SSG update-sessions payload and split sessions from run metadata
    const payload = buildUpdateSessionsPayload({
      courseReferenceNumber,
      runData,
      sessions: sessionObjects,
      currentUserEmail: adminEmail,
      newRunStart,
      newRunEnd,
    });
    const { sessions: sessionsArr, ...runInfo } = payload;

    const trainerPayloads = await resolveRunTrainerEditPayloads(runUuid).catch(() => undefined);

    console.log(`[external/reschedule-day] ${ssgRunId}: ${from_date} → ${to_date} (${sessRows.length} sessions)`);

    // 9. Call SSG
    const ssgResult = await apiClient.updateSessionsFromCourseRun(
      ssgRunId, runInfo as EditRunInfo, sessionsArr, OptionalSelector.YES, trainerPayloads
    );
    if (ssgResult.error) {
      return res.status(ssgResult.status || 502).json({
        success: false,
        error: `SSG session update failed: ${ssgResult.error.message || JSON.stringify(ssgResult.error)}`,
        step: 'ssg',
      });
    }

    // 10. Sync local DB from SSG
    const lmsSync = await fetchAndSyncRunSessions(runUuid);

    // 11. Re-assert trainer
    let tpgTrainer: any = { status: 'skipped', message: 'no trainer assigned' };
    try {
      const tr = await pushTrainerToTpgForRun(runUuid);
      tpgTrainer = { status: tr.status, message: tr.message };
    } catch (e: any) {
      tpgTrainer = { status: 'error', message: e?.message };
    }

    // 12. GCal reconcile (best-effort last)
    let calendar: any = { status: 'skipped', message: 'sync_calendar disabled' };
    if (sync_calendar) {
      try {
        calendar = await reconcileRunCalendar(runUuid);
      } catch (e: any) {
        calendar = { status: 'error', message: e?.message };
      }
    }

    return res.status(200).json({
      success: true,
      from_date: from_date.trim(),
      to_date: to_date.trim(),
      sessions_moved: sessRows.length,
      ssg: { status: 'ok', data: ssgResult.data },
      lms_sync: { ok: lmsSync.ok, upserted: lmsSync.upserted, error: lmsSync.error },
      tpg_trainer: tpgTrainer,
      calendar,
    });
  } catch (err: any) {
    console.error('[external/reschedule-day] error:', err);
    return res.status(500).json({ success: false, error: err?.message || 'Unexpected error' });
  }
}
