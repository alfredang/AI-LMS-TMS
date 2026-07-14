import type { NextApiRequest, NextApiResponse } from 'next';
import pool from '../../../lib/db';
import { getSSGCredentialsService } from '../../../lib/ssg/services/credentials-service';
import { createSSGCourseAPI } from '../../../lib/ssg/api/course-api';
import { OptionalSelector } from '../../../lib/ssg/models/course-runs';
import { EditRunInfo } from '../../../lib/ssg/models/edit-delete-course-run';
import { buildDeleteSessionsPayload } from '../../../lib/ssg/sessionEditHelpers';
import { fetchAndSyncRunSessions } from '../../../lib/ssg/syncRunSessions';
import { pushTrainerToTpgForRun, resolveRunTrainerEditPayloads } from '../../../lib/ssg/pushTrainerToTpgForRun';
import { reconcileRunCalendar } from '../../../lib/calendar/reconcileRunCalendar';

/**
 * POST /api/external/cancel-day
 *
 * Cancel (delete from SSG) ALL sessions on a given date for a course run.
 * Use when an entire training day is cancelled. All SSG sessions with start_date = date
 * are deleted in a single SSG call, then the local DB and GCal are reconciled.
 *
 * Commit ordering: SSG delete first → LMS local sync → GCal reconcile (best-effort).
 * SSG wipes the run's trainer on session edits; it is re-asserted afterwards.
 *
 * Body:
 * {
 *   run_id:         string,   // SSG run ID (e.g. "TGS-...-01") or internal UUID
 *   date:           string,   // YYYY-MM-DD — the day to cancel
 *   sync_calendar?: boolean   // default true — reconcile GCal after deletion
 * }
 *
 * Response (success):
 * {
 *   success: true,
 *   date: string,
 *   sessions_cancelled: number,
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
    date,
    sync_calendar = true,
  } = (req.body || {}) as {
    run_id?: string;
    date?: string;
    sync_calendar?: boolean;
  };

  if (!run_id?.trim()) return res.status(400).json({ success: false, error: 'run_id is required' });
  if (!date?.trim() || !/^\d{4}-\d{2}-\d{2}$/.test(date.trim())) {
    return res.status(400).json({ success: false, error: 'date is required (YYYY-MM-DD)' });
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

    // 2. Find all sessions on the given date
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
      [runUuid, date.trim()]
    )).rows;

    if (sessRows.length === 0) {
      return res.status(404).json({
        success: false,
        error: `No active sessions found on ${date} for run ${run_id}`,
      });
    }

    // 3. Get SSG credentials and create API client
    const credentials = await getSSGCredentialsService().getSSGCredentials();
    if (!credentials) return res.status(500).json({ success: false, error: 'SSG credentials not configured' });
    if (!credentials.encryptionKey) return res.status(500).json({ success: false, error: 'SSG encryption key not configured' });

    const apiClient = createSSGCourseAPI(credentials.ssgApiBaseUrl, credentials);

    // 4. Fetch live run data from SSG (venue/registration fields required in delete payload)
    const runDataRes = await apiClient.viewCourseRun(ssgRunId, OptionalSelector.YES);
    if (runDataRes.error) {
      return res.status(502).json({ success: false, error: `Failed to fetch run data from SSG: ${runDataRes.error.message}` });
    }
    const runData = (runDataRes.data as any)?.course?.run || {};

    // 5. Build SSG delete-sessions payload for all sessions on the day
    const payload = buildDeleteSessionsPayload({
      courseReferenceNumber,
      runData,
      sessions: sessRows.map((s) => ({
        id: s.ssg_session_id,
        startDate: s.start_date ? String(s.start_date).slice(0, 10) : undefined,
        endDate: s.end_date ? String(s.end_date).slice(0, 10) : undefined,
        startTime: s.start_time || undefined,
        endTime: s.end_time || undefined,
        modeOfTraining: s.mode_of_training || '1',
        venue: s.venue || undefined,
      })),
      currentUserEmail: adminEmail,
    });
    const { sessions: sessionsArr, ...runInfo } = payload;

    const trainerPayloads = await resolveRunTrainerEditPayloads(runUuid).catch(() => undefined);

    console.log(`[external/cancel-day] ${ssgRunId}: cancel ${sessRows.length} sessions on ${date}`);

    // 6. Call SSG delete (all sessions for the day in one call)
    const ssgResult = await apiClient.deleteSessionsFromCourseRun(
      ssgRunId, runInfo as EditRunInfo, sessionsArr, OptionalSelector.YES, trainerPayloads
    );
    if (ssgResult.error) {
      return res.status(ssgResult.status || 502).json({
        success: false,
        error: `SSG session delete failed: ${ssgResult.error.message || JSON.stringify(ssgResult.error)}`,
        step: 'ssg',
      });
    }

    // 7. Sync local DB from SSG (soft-deletes the cancelled sessions locally)
    const lmsSync = await fetchAndSyncRunSessions(runUuid);

    // 8. Re-assert trainer
    let tpgTrainer: any = { status: 'skipped', message: 'no trainer assigned' };
    try {
      const tr = await pushTrainerToTpgForRun(runUuid);
      tpgTrainer = { status: tr.status, message: tr.message };
    } catch (e: any) {
      tpgTrainer = { status: 'error', message: e?.message };
    }

    // 9. GCal reconcile (best-effort last — removes stale session-day events)
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
      date: date.trim(),
      sessions_cancelled: sessRows.length,
      ssg: { status: 'ok', data: ssgResult.data },
      lms_sync: { ok: lmsSync.ok, upserted: lmsSync.upserted, error: lmsSync.error },
      tpg_trainer: tpgTrainer,
      calendar,
    });
  } catch (err: any) {
    console.error('[external/cancel-day] error:', err);
    return res.status(500).json({ success: false, error: err?.message || 'Unexpected error' });
  }
}
