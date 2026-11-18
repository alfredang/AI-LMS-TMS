import pool from '../db';
import { pushTrainerToTpgForRun } from '../ssg/pushTrainerToTpgForRun';
import { patchRunAttendee } from '../calendar/runAttendees';
import { autoShareCourseResourcesWithTrainerByRun } from '../google-drive/drive-helpers';

export interface AssignTrainerOptions {
  runUuid: string;
  /** Lower-cased trainer email. */
  emailNorm: string;
  /** Fallback display name when the trainer has no LMS account. */
  trainerName?: string;
  /** The official TPGateway trainer (only one per run). Default true. */
  isOfficial?: boolean;
  /** Push the official trainer to SSG/TPGateway. Default true. */
  syncTpg?: boolean;
  /** Add the trainer to the run's calendar events. Default true. */
  syncCalendar?: boolean;
  /** Free-text reason, logged only. */
  notes?: string;
}

export interface AssignTrainerResult {
  lms: { assigned: true; junction_id: string; is_official: boolean };
  tpg: any;
  calendar: any;
  warning?: string;
}

/**
 * Assign a trainer to a course run the way every LMS code path must:
 *   1. course_run_trainer junction row (SSG push reads from it) + legacy
 *      assigned_trainer_* columns when official;
 *   2. SSG/TPGateway push (official trainer only, when syncTpg);
 *   3. calendar attendee add (best effort, when syncCalendar).
 * Shared by POST /api/external/assign-trainer and the course Default Trainer setting.
 * Throws when the trainer has no LMS account and no trainerName was given.
 */
export async function assignTrainerToRun(opts: AssignTrainerOptions): Promise<AssignTrainerResult> {
  const { runUuid, emailNorm, trainerName, notes } = opts;
  const isOfficial = opts.isOfficial !== false;
  const syncTpg = opts.syncTpg !== false;
  const syncCalendar = opts.syncCalendar !== false;

  const userRow = (await pool.query(
    `SELECT u.id, u.full_name, u.email,
            EXISTS(SELECT 1 FROM user_role_map WHERE user_id = u.id AND role = 'Learner') AS is_learner
     FROM app_user u WHERE LOWER(u.email) = $1 LIMIT 1`, [emailNorm]
  )).rows[0];
  if (!userRow?.full_name && !trainerName?.trim()) {
    throw new Error('trainer_name is required when trainer is not in the LMS');
  }
  const trainerId = userRow?.id ?? null;
  const resolvedName = userRow?.full_name ?? trainerName ?? emailNorm;
  const resolvedEmail = userRow?.email ?? emailNorm;

  const warning = userRow?.is_learner
    ? `${emailNorm} has the 'Learner' role in the LMS. Verify this is the correct account before proceeding.`
    : undefined;

  console.log(`[assignTrainerToRun] ASSIGN ${emailNorm} to run ${runUuid}${notes ? ` (${notes})` : ''}`);

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

  if (isOfficial) {
    await pool.query(
      `UPDATE course_run SET assigned_trainer_id = $1, assigned_trainer_name = $2,
              assigned_trainer_email = $3, updated_at = NOW() WHERE id = $4`,
      [trainerId, resolvedName, resolvedEmail, runUuid]
    );
  }
  const lms = { assigned: true as const, junction_id: junctionRes.id as string, is_official: isOfficial };

  // Auto-share courseware + assessment folders with the trainer (non-blocking)
  autoShareCourseResourcesWithTrainerByRun(runUuid, resolvedEmail).catch(err => {
    console.warn(`⚠️ [assignTrainerToRun] auto-share failed (non-blocking): ${err?.message}`);
  });

  // Step 2: SSG/TPG push (only the official trainer goes to TPGateway)
  let tpg: any = { status: 'skipped', message: !syncTpg ? 'sync_tpg disabled' : 'is_official is false — only the official trainer is pushed to TPGateway' };
  if (syncTpg && isOfficial) {
    tpg = await pushTrainerToTpgForRun(runUuid, { onlyEmail: resolvedEmail });
  }

  // Step 3: GCal add (best-effort last)
  let calendar: any = { status: 'skipped', message: 'sync_calendar disabled' };
  if (syncCalendar) {
    calendar = await patchRunAttendee(runUuid, resolvedEmail, 'add');
  }

  return { lms, tpg, calendar, ...(warning ? { warning } : {}) };
}
