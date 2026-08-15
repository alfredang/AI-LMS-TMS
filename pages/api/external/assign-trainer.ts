import type { NextApiRequest, NextApiResponse } from 'next';
import pool from '../../../lib/db';
import { pushTrainerToTpgForRun, clearTrainerOnTpgForRun } from '../../../lib/ssg/pushTrainerToTpgForRun';
import { patchRunAttendee } from '../../../lib/calendar/runAttendees';
import { autoShareCourseResourcesWithTrainerByRun } from '../../../lib/google-drive/drive-helpers';

/**
 * POST /api/external/assign-trainer
 *
 * Assign or unassign a trainer on a course run, affecting LMS + SSG/TPGateway + Google Calendar.
 *
 * Commit ordering:
 *   ASSIGN:   LMS INSERT first (SSG push reads trainer data from course_run_trainer)
 *             → SSG/TPG trainer push (if sync_tpg and is_official)
 *             → GCal add (best-effort last)
 *   UNASSIGN: SSG/TPG clear FIRST (reads current DB state before LMS row is removed)
 *             → LMS DELETE
 *             → GCal remove (best-effort last)
 *
 * Body:
 * {
 *   run_id:         string,      // SSG run ID (e.g. "TGS-123456-01") or internal UUID
 *   trainer_email:  string,
 *   trainer_name?:  string,      // required for assign if trainer not in LMS
 *   action:         'assign' | 'unassign',
 *   is_official?:   boolean,     // default true — the official TPGateway trainer (only one per run)
 *   sync_tpg?:      boolean,     // default true — push/clear on SSG/TPGateway
 *   sync_calendar?: boolean,     // default true — add/remove from GCal events
 *   notes?:         string
 * }
 *
 * Response (assign):
 * {
 *   success: true,
 *   lms:      { assigned: true, junction_id: '<uuid>', is_official: boolean },
 *   tpg:      { status: 'synced'|'skipped'|..., message: string },
 *   calendar: { status: 'ok'|'skipped', changed?: number }
 * }
 *
 * Response (unassign):
 * {
 *   success: true,
 *   tpg:      { status: 'synced'|'skipped'|..., message: string },
 *   lms:      { removed: true },
 *   calendar: { status: 'ok'|'skipped', changed?: number }
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
    trainer_email,
    trainer_name,
    action,
    is_official = true,
    sync_tpg = true,
    sync_calendar = true,
    notes,
  } = (req.body || {}) as {
    run_id?: string;
    trainer_email?: string;
    trainer_name?: string;
    action?: string;
    is_official?: boolean;
    sync_tpg?: boolean;
    sync_calendar?: boolean;
    notes?: string;
  };

  // Coerce boolean fields — JSON string "false" must not be truthy
  const syncTpg = req.body?.sync_tpg !== false && req.body?.sync_tpg !== 'false';
  const syncCalendar = req.body?.sync_calendar !== false && req.body?.sync_calendar !== 'false';

  if (!run_id?.trim()) return res.status(400).json({ success: false, error: 'run_id is required' });
  if (!trainer_email?.trim()) return res.status(400).json({ success: false, error: 'trainer_email is required' });
  if (action !== 'assign' && action !== 'unassign') {
    return res.status(400).json({ success: false, error: "action must be 'assign' or 'unassign'" });
  }

  const emailNorm = trainer_email.trim().toLowerCase();

  try {
    const runRow = (await pool.query(
      `SELECT id FROM course_run WHERE course_run_id = $1 OR id::text = $1 LIMIT 1`,
      [run_id.trim()]
    )).rows[0];
    if (!runRow) return res.status(404).json({ success: false, error: `Run ${run_id} not found in LMS` });
    const runUuid = runRow.id as string;

    if (action === 'assign') {
      if (!trainer_name?.trim()) {
        // Try to resolve name from DB before requiring it
        const userRow = (await pool.query(
          `SELECT full_name FROM app_user WHERE LOWER(email) = $1 LIMIT 1`, [emailNorm]
        )).rows[0];
        if (!userRow?.full_name) {
          return res.status(400).json({ success: false, error: 'trainer_name is required when trainer is not in the LMS' });
        }
      }
      return await handleAssign({ runUuid, emailNorm, trainer_name, is_official, syncTpg, syncCalendar, notes, res });
    } else {
      return await handleUnassign({ runUuid, emailNorm, syncTpg, syncCalendar, notes, res });
    }
  } catch (err: any) {
    console.error('[external/assign-trainer] error:', err);
    return res.status(500).json({ success: false, error: err?.message || 'Unexpected error' });
  }
}

async function handleAssign({
  runUuid, emailNorm, trainer_name, is_official, syncTpg, syncCalendar, notes, res,
}: { runUuid: string; emailNorm: string; trainer_name?: string; is_official: boolean; syncTpg: boolean; syncCalendar: boolean; notes?: string; res: NextApiResponse }) {
  const userRow = (await pool.query(
    `SELECT u.id, u.full_name, u.email,
            EXISTS(SELECT 1 FROM user_role_map WHERE user_id = u.id AND role = 'Learner') AS is_learner
     FROM app_user u WHERE LOWER(u.email) = $1 LIMIT 1`, [emailNorm]
  )).rows[0];
  const trainerId = userRow?.id ?? null;
  const resolvedName = userRow?.full_name ?? trainer_name ?? emailNorm;
  const resolvedEmail = userRow?.email ?? emailNorm;

  // Item 17: warn if assigning a Learner-role account as trainer
  const learnerRoleWarning = userRow?.is_learner
    ? `${emailNorm} has the 'Learner' role in the LMS. Verify this is the correct account before proceeding.`
    : undefined;

  console.log(`[external/assign-trainer] ASSIGN ${emailNorm} to run ${runUuid}${notes ? ` (${notes})` : ''}`);

  // Step 1: LMS — upsert into course_run_trainer (SSG push reads from this table)
  await pool.query(
    `DELETE FROM course_run_trainer WHERE course_run_id = $1 AND LOWER(COALESCE(trainer_email, '')) = $2`,
    [runUuid, emailNorm]
  );
  const junctionRes = (await pool.query(
    `INSERT INTO course_run_trainer (course_run_id, trainer_id, trainer_name, trainer_email)
     VALUES ($1, $2, $3, $4) RETURNING id`,
    [runUuid, trainerId, resolvedName, resolvedEmail]
  )).rows[0];

  if (is_official) {
    await pool.query(
      `UPDATE course_run SET assigned_trainer_id = $1, assigned_trainer_name = $2,
              assigned_trainer_email = $3, updated_at = NOW() WHERE id = $4`,
      [trainerId, resolvedName, resolvedEmail, runUuid]
    );
  }
  const lms = { assigned: true, junction_id: junctionRes.id as string, is_official };

  // Auto-share courseware + assessment folders with the trainer (non-blocking)
  autoShareCourseResourcesWithTrainerByRun(runUuid, resolvedEmail).catch(err => {
    console.warn(`⚠️ [external/assign-trainer] auto-share failed (non-blocking): ${err?.message}`);
  });

  // Step 2: SSG/TPG push (only the official trainer goes to TPGateway)
  let tpg: any = { status: 'skipped', message: !syncTpg ? 'sync_tpg disabled' : 'is_official is false — only the official trainer is pushed to TPGateway' };
  if (syncTpg && is_official) {
    tpg = await pushTrainerToTpgForRun(runUuid, { onlyEmail: resolvedEmail });
  }

  // Step 3: GCal add (best-effort last)
  let calendar: any = { status: 'skipped', message: 'sync_calendar disabled' };
  if (syncCalendar) {
    calendar = await patchRunAttendee(runUuid, resolvedEmail, 'add');
  }

  return res.status(200).json({
    success: true,
    lms,
    tpg,
    calendar,
    ...(learnerRoleWarning ? { warning: learnerRoleWarning } : {}),
  });
}

async function handleUnassign({
  runUuid, emailNorm, syncTpg, syncCalendar, notes, res,
}: { runUuid: string; emailNorm: string; syncTpg: boolean; syncCalendar: boolean; notes?: string; res: NextApiResponse }) {
  const junctionRow = (await pool.query(
    `SELECT id, trainer_email FROM course_run_trainer WHERE course_run_id = $1 AND LOWER(COALESCE(trainer_email, '')) = $2 LIMIT 1`,
    [runUuid, emailNorm]
  )).rows[0];
  if (!junctionRow) {
    return res.status(404).json({ success: false, error: `${emailNorm} is not assigned as a trainer on this run` });
  }

  console.log(`[external/assign-trainer] UNASSIGN ${emailNorm} from run ${runUuid}${notes ? ` (${notes})` : ''}`);

  // Step 1: SSG/TPG clear FIRST (course_run_trainer row still exists — readable by clearTrainerOnTpgForRun)
  let tpg: any = { status: 'skipped', message: 'sync_tpg disabled' };
  if (syncTpg) {
    tpg = await clearTrainerOnTpgForRun(runUuid);
  }

  // Step 2: LMS DELETE after TPG
  await pool.query(`DELETE FROM course_run_trainer WHERE id = $1`, [junctionRow.id]);
  await pool.query(
    `UPDATE course_run SET assigned_trainer_id = NULL, assigned_trainer_name = NULL,
            assigned_trainer_email = NULL, updated_at = NOW()
      WHERE id = $1 AND LOWER(COALESCE(assigned_trainer_email, '')) = $2`,
    [runUuid, emailNorm]
  );
  const lms = { removed: true };

  // Step 3: GCal remove (best-effort last)
  let calendar: any = { status: 'skipped', message: 'sync_calendar disabled' };
  if (syncCalendar) {
    calendar = await patchRunAttendee(runUuid, emailNorm, 'remove');
  }

  return res.status(200).json({ success: true, tpg, lms, calendar });
}
