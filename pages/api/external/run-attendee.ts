import type { NextApiRequest, NextApiResponse } from 'next';
import pool from '../../../lib/db';
import { pushEnrolmentToSsgForLearner } from '../../../lib/ssg/pushEnrolmentToSsgForLearner';
import { cancelEnrolmentForLearnerOnRun } from '../../../lib/ssg/mutateEnrolmentForLearner';
import { patchRunAttendee } from '../../../lib/calendar/runAttendees';

/**
 * POST /api/external/run-attendee
 *
 * Add or drop a learner on a course run, affecting LMS + SSG/TPGateway + Google Calendar.
 *
 * Commit ordering:
 *   ADD:  LMS enrollment INSERT first (SSG lookup requires the row to exist)
 *         → SSG/TPG enrolment push (if sync_tpg)
 *         → GCal add (best-effort last)
 *   DROP: SSG/TPG cancel FIRST (reads the enrolment_id before LMS row is touched)
 *         → LMS enrollment soft-remove ('Admin Removed')
 *         → GCal remove (best-effort last)
 *
 * Body:
 * {
 *   run_id:         string,           // SSG run ID (e.g. "TGS-123456-01") or internal UUID
 *   email:          string,           // learner email
 *   action:         'add' | 'drop',
 *   sync_tpg?:      boolean,          // default true — push/cancel on SSG/TPGateway
 *   sync_calendar?: boolean,          // default true — add/remove from GCal events
 *   notes?:         string            // audit note
 * }
 *
 * Response (add — success):
 * {
 *   success: true,
 *   lms:      { enrolled: true, enrollment_id: '<uuid>' },
 *   tpg:      { status: 'synced'|'skipped'|'already_enrolled'|..., message: string, enrolmentRef?: string },
 *   calendar: { status: 'ok'|'skipped', changed?: number }
 * }
 *
 * Response (drop — success):
 * {
 *   success: true,
 *   tpg:      { status: 'synced'|'skipped'|'skipped_no_enrolment_id'|..., message: string },
 *   lms:      { removed: true },
 *   calendar: { status: 'ok'|'skipped', changed?: number }
 * }
 *
 * Response (failure — 422):
 *   { success: false, error: string, step: 'tpg'|'lms'|'calendar', ... }
 *   On DROP: if tpg.status === 'error', the SSG cancel failed — lms and calendar steps were skipped.
 *   On ADD:  if lms fails (duplicate, run not found), no TPG or GCal action was taken.
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
    email,
    action,
    sync_tpg = true,
    sync_calendar = true,
    notes,
  } = (req.body || {}) as {
    run_id?: string;
    email?: string;
    action?: string;
    sync_tpg?: boolean;
    sync_calendar?: boolean;
    notes?: string;
  };

  if (!run_id?.trim()) return res.status(400).json({ success: false, error: 'run_id is required' });
  if (!email?.trim()) return res.status(400).json({ success: false, error: 'email is required' });
  if (action !== 'add' && action !== 'drop') return res.status(400).json({ success: false, error: "action must be 'add' or 'drop'" });

  const emailNorm = email.trim().toLowerCase();

  // Coerce boolean fields — JSON string "false" must not be truthy
  const syncTpg = req.body?.sync_tpg !== false && req.body?.sync_tpg !== 'false';
  const syncCalendar = req.body?.sync_calendar !== false && req.body?.sync_calendar !== 'false';

  try {
    const runRow = (await pool.query(
      `SELECT id, course_id, course_run_id, class_status, end_date FROM course_run WHERE course_run_id = $1 OR id::text = $1 LIMIT 1`,
      [run_id.trim()]
    )).rows[0];
    if (!runRow) return res.status(404).json({ success: false, error: `Run ${run_id} not found in LMS` });
    const runUuid = runRow.id as string;
    const courseId = runRow.course_id as string;

    // Guard (ADD only): refuse enrolment into cancelled or past runs
    if (action === 'add') {
      if (String(runRow.class_status || '').toLowerCase() === 'cancelled') {
        return res.status(409).json({ success: false, error: `Run ${run_id} has been cancelled and cannot accept new enrolments` });
      }
      if (runRow.end_date && new Date(runRow.end_date) < new Date(new Date().toISOString().slice(0, 10))) {
        return res.status(409).json({ success: false, error: `Run ${run_id} ended on ${String(runRow.end_date).slice(0,10)} — adding learners to a past run is not allowed` });
      }
    }

    if (action === 'add') {
      return await handleAdd({ runUuid, courseId, emailNorm, syncTpg, syncCalendar, notes, res });
    } else {
      return await handleDrop({ runUuid, emailNorm, syncTpg, syncCalendar, notes, res });
    }
  } catch (err: any) {
    console.error('[external/run-attendee] error:', err);
    return res.status(500).json({ success: false, error: err?.message || 'Unexpected error' });
  }
}

async function handleAdd({
  runUuid, courseId, emailNorm, syncTpg, syncCalendar, notes, res,
}: { runUuid: string; courseId: string; emailNorm: string; syncTpg: boolean; syncCalendar: boolean; notes?: string; res: NextApiResponse }) {
  // Look up app_user (learner may not have an LMS account — external learners are enrolled by email)
  const userRow = (await pool.query(
    `SELECT id FROM app_user WHERE LOWER(email) = $1 LIMIT 1`,
    [emailNorm]
  )).rows[0];
  const userId = userRow?.id ?? null;

  // Guard: already actively enrolled
  const activeRow = (await pool.query(
    `SELECT id FROM enrollment
      WHERE course_run_id = $1
        AND (user_id = $2 OR LOWER(COALESCE(email, '')) = $3)
        AND LOWER(COALESCE(enrolment_status, '')) NOT IN ('admin removed', 'cancelled', 'withdrawn')
      LIMIT 1`,
    [runUuid, userId, emailNorm]
  )).rows[0];
  if (activeRow) {
    return res.status(409).json({ success: false, error: `${emailNorm} is already actively enrolled in this run` });
  }

  // Step 1: LMS enrollment INSERT or REACTIVATE (re-adding a previously-removed learner)
  // Check for an existing removed/cancelled row to avoid duplicate-row issues.
  const removedRow = (await pool.query(
    `SELECT id FROM enrollment
      WHERE course_run_id = $1
        AND (user_id = $2 OR LOWER(COALESCE(email, '')) = $3)
      ORDER BY updated_at DESC LIMIT 1`,
    [runUuid, userId, emailNorm]
  )).rows[0];

  let enrollmentId: string;
  if (removedRow) {
    // Reactivate — clear the removed status
    await pool.query(
      `UPDATE enrollment SET enrolment_status = NULL, updated_at = NOW() WHERE id = $1`,
      [removedRow.id]
    );
    enrollmentId = removedRow.id as string;
  } else {
    const insertRes = (await pool.query(
      `INSERT INTO enrollment (id, course_id, course_run_id, user_id, email, created_at, updated_at)
       VALUES (gen_random_uuid(), $1, $2, $3, $4, NOW(), NOW())
       RETURNING id`,
      [courseId, runUuid, userId, emailNorm]
    )).rows[0];
    enrollmentId = insertRes.id as string;
  }
  const lms = { enrolled: true, enrollment_id: enrollmentId, reactivated: !!removedRow };

  console.log(`[external/run-attendee] ADD ${emailNorm} to run ${runUuid}${removedRow ? ' (reactivated)' : ''}${notes ? ` (${notes})` : ''}`);

  // Step 2: SSG/TPG enrolment push (best-effort — LMS is already updated)
  let tpg: any = { status: 'skipped', message: 'sync_tpg disabled' };
  if (syncTpg) {
    tpg = await pushEnrolmentToSsgForLearner(runUuid, { userId, email: emailNorm });
  }

  // Step 3: GCal add (best-effort last)
  let calendar: any = { status: 'skipped', message: 'sync_calendar disabled' };
  if (syncCalendar) {
    calendar = await patchRunAttendee(runUuid, emailNorm, 'add');
  }

  return res.status(200).json({ success: true, lms, tpg, calendar });
}

async function handleDrop({
  runUuid, emailNorm, syncTpg, syncCalendar, notes, res,
}: { runUuid: string; emailNorm: string; syncTpg: boolean; syncCalendar: boolean; notes?: string; res: NextApiResponse }) {
  // Find the active enrollment (need enrolment_id for TPG cancel)
  const enrolRow = (await pool.query(
    `SELECT e.id, e.enrolment_id, e.user_id
       FROM enrollment e
       LEFT JOIN app_user u ON u.id = e.user_id
      WHERE e.course_run_id = $1
        AND (LOWER(COALESCE(u.email, '')) = $2 OR LOWER(COALESCE(e.email, '')) = $2)
        AND LOWER(COALESCE(e.enrolment_status, '')) NOT IN ('admin removed', 'cancelled', 'withdrawn')
      LIMIT 1`,
    [runUuid, emailNorm]
  )).rows[0];
  if (!enrolRow) {
    return res.status(404).json({ success: false, error: `No active enrollment found for ${emailNorm} on this run` });
  }

  // Advisory: assessment submissions guard (mirrors move-class behaviour)
  const userId = enrolRow.user_id as string | null;
  if (userId) {
    const guard = (await pool.query(
      `SELECT
         (SELECT COUNT(*)::int FROM link_assessment_submission WHERE user_id = $1 AND course_run_id = $2) AS link_count,
         (SELECT COUNT(*)::int FROM submission s JOIN enrollment e ON e.id = s.enrollment_id
            WHERE e.user_id = $1 AND e.course_run_id = $2) AS legacy_count`,
      [userId, runUuid]
    )).rows[0];
    const subCount = (guard?.link_count ?? 0) + (guard?.legacy_count ?? 0);
    if (subCount > 0) {
      return res.status(409).json({
        success: false,
        code: 'SUBMISSION_EXISTS',
        email: emailNorm,
        message: `Cannot drop ${emailNorm} — they have ${subCount} submitted assessment file(s) on this run. These submissions cannot be moved. Confirm this is acceptable before proceeding with force: true.`,
        submission_count: subCount,
      });
    }
  }

  console.log(`[external/run-attendee] DROP ${emailNorm} from run ${runUuid}${notes ? ` (${notes})` : ''}`);

  // Step 1: SSG/TPG cancel FIRST (enrollment row still exists — enrolment_id readable)
  let tpg: any = { status: 'skipped', message: 'sync_tpg disabled' };
  if (syncTpg) {
    tpg = await cancelEnrolmentForLearnerOnRun(runUuid, { email: emailNorm });
    if (tpg.status === 'error') {
      return res.status(422).json({
        success: false,
        error: `SSG/TPG cancel failed: ${tpg.message} — LMS and calendar not updated`,
        step: 'tpg',
        tpg,
      });
    }
  }

  // Step 2: LMS soft-remove AFTER TPG
  await pool.query(
    `UPDATE enrollment SET enrolment_status = 'Admin Removed', updated_at = NOW() WHERE id = $1`,
    [enrolRow.id]
  );
  const lms = { removed: true };

  // Step 3: GCal remove (best-effort last)
  let calendar: any = { status: 'skipped', message: 'sync_calendar disabled' };
  if (syncCalendar) {
    calendar = await patchRunAttendee(runUuid, emailNorm, 'remove');
  }

  return res.status(200).json({ success: true, tpg, lms, calendar });
}
