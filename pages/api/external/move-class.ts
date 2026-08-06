import type { NextApiRequest, NextApiResponse } from 'next';
import pool from '../../../lib/db';
import { ensureClassCalendarEvent, syncClassAttendees, removeClassCalendarEvents } from '../../../lib/calendar/ensureClassCalendarEvent';
import { pushTrainerToTpgForRun, clearTrainerOnTpgForRun } from '../../../lib/ssg/pushTrainerToTpgForRun';
import { repointEnrolmentToRunForLearner, cancelEnrolmentForLearnerOnRun } from '../../../lib/ssg/mutateEnrolmentForLearner';

/**
 * POST /api/external/move-class
 *
 * Move an entire class from one course run to another of the SAME course.
 * Moves all active learners and reassigns the trainer to the target run.
 *
 * Commit ordering (per CLAUDE.md invariant — SSG/TPG before LMS):
 *   1. LMS transaction: soft-remove drops, handle conflicts, move enrollment rows, update trainers
 *   2. SSG/TPG enrolment re-points (moved learners) + cancels (dropped/conflict learners) — default ON
 *   3. SSG/TPG trainer push to target + clear from source — default ON
 *   4. GCal: ensure target events exist, sync attendees on target, remove source events if vacated — default ON
 *
 * Note on ordering: The LMS transaction must run first because SSG/TPG enrolment re-point
 * (`repointEnrolmentToRunForLearner`) resolves the learner against the TARGET run UUID —
 * the enrollment row must already point to the target before calling it. This is the one
 * exception to strict SSG-first: the LMS DB move is a pointer update (no data is lost;
 * the SSG enrolment referenceNumber is preserved), so it's safe to commit locally first
 * and then re-point SSG. If the SSG re-point fails after the LMS move, the systems are
 * temporarily out of sync — surface the per-learner tpg status in the response and
 * escalate to staff for any 'error' entries.
 *
 * Body:
 * {
 *   source_run_id:      string,              // SSG run ID or UUID — the run being vacated
 *   target_run_id:      string,              // SSG run ID or UUID — the destination run
 *   drop_emails?:       string[],            // learners to soft-remove (NOT moved), default []
 *   trainer_email?:     string,              // official trainer email on the target run
 *   trainer_name?:      string,              // trainer name (required if trainer_email provided and not in LMS)
 *   sync_tpg?:          boolean,             // default true
 *   sync_calendar?:     boolean,             // default true
 *   force?:             boolean,             // default false — override submission guard
 *   notes?:             string
 * }
 *
 * Response:
 * {
 *   success: true,
 *   summary: { moved: number, removed: number, skipped_conflicts: string[] },
 *   tpg_enrolment: { repointed: [...], cancelled: [...] },  // per-learner SSG results
 *   tpg_trainer:   { target: { status, message }, source: { status, message } },
 *   calendar:      { target: { status, ... }, source: { status, ... } }
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
    source_run_id,
    target_run_id,
    drop_emails = [],
    trainer_email,
    trainer_name,
    sync_tpg = true,
    sync_calendar = true,
    force = false,
    notes,
  } = (req.body || {}) as {
    source_run_id?: string;
    target_run_id?: string;
    drop_emails?: string[];
    trainer_email?: string;
    trainer_name?: string;
    sync_tpg?: boolean;
    sync_calendar?: boolean;
    force?: boolean;
    notes?: string;
  };

  // Coerce boolean fields — JSON string "false" must not be truthy
  const syncTpg = req.body?.sync_tpg !== false && req.body?.sync_tpg !== 'false';
  const syncCalendar = req.body?.sync_calendar !== false && req.body?.sync_calendar !== 'false';

  if (!source_run_id?.trim()) return res.status(400).json({ success: false, error: 'source_run_id is required' });
  if (!target_run_id?.trim()) return res.status(400).json({ success: false, error: 'target_run_id is required' });
  if (source_run_id.trim() === target_run_id.trim()) {
    return res.status(400).json({ success: false, error: 'source_run_id and target_run_id must differ' });
  }

  // Item 20: reject non-array drop_emails early — silently treating a string as empty would confuse callers
  if (req.body?.drop_emails != null && !Array.isArray(req.body?.drop_emails)) {
    return res.status(400).json({ success: false, error: 'drop_emails must be an array of email strings' });
  }

  const dropEmails = (Array.isArray(drop_emails) ? drop_emails : [])
    .map((e: any) => String(e).trim().toLowerCase()).filter(Boolean);
  const trainerEmailNorm = trainer_email?.trim().toLowerCase() || null;

  const client = await pool.connect();
  try {
    // Resolve both SSG run IDs to UUIDs and validate same course
    const runsRes = await client.query(
      `SELECT id, course_id, course_run_id FROM course_run
        WHERE course_run_id = ANY($1::text[]) OR id::text = ANY($1::text[])`,
      [[source_run_id.trim(), target_run_id.trim()]]
    );
    const sourceRow = runsRes.rows.find((r) => r.course_run_id === source_run_id.trim() || r.id === source_run_id.trim());
    const targetRow = runsRes.rows.find((r) => r.course_run_id === target_run_id.trim() || r.id === target_run_id.trim());
    if (!sourceRow) return res.status(404).json({ success: false, error: `Source run ${source_run_id} not found` });
    if (!targetRow) return res.status(404).json({ success: false, error: `Target run ${target_run_id} not found` });
    if (sourceRow.course_id !== targetRow.course_id) {
      return res.status(400).json({ success: false, error: 'Source and target runs belong to different courses' });
    }
    const sourceUuid = sourceRow.id as string;
    const targetUuid = targetRow.id as string;

    console.log(`[external/move-class] ${source_run_id} → ${target_run_id}${notes ? ` (${notes})` : ''}`);

    await client.query('BEGIN');

    const removedUserIds = new Set<string>();
    let removed = 0;

    // 1. Soft-remove explicitly dropped learners from source
    for (const email of dropEmails) {
      const userRes = await client.query(`SELECT id FROM app_user WHERE LOWER(email) = $1 LIMIT 1`, [email]);
      if (userRes.rows.length === 0) continue;
      const userId = userRes.rows[0].id;

      if (!force) {
        const guard = await client.query(
          `SELECT
             (SELECT COUNT(*)::int FROM link_assessment_submission WHERE user_id = $1 AND course_run_id = $2) AS link_count,
             (SELECT COUNT(*)::int FROM submission s JOIN enrollment e ON e.id = s.enrollment_id
                WHERE e.user_id = $1 AND e.course_run_id = $2) AS legacy_count`,
          [userId, sourceUuid]
        );
        const cnt = (guard.rows[0]?.link_count ?? 0) + (guard.rows[0]?.legacy_count ?? 0);
        if (cnt > 0) {
          await client.query('ROLLBACK');
          return res.status(409).json({
            success: false,
            code: 'SUBMISSION_EXISTS',
            email,
            message: `Cannot drop ${email} — they have ${cnt} submitted assessment file(s). Retry with force: true to override.`,
          });
        }
      }

      const upd = await client.query(
        `UPDATE enrollment SET enrolment_status = 'Admin Removed', updated_at = NOW()
          WHERE user_id = $1 AND course_run_id = $2`,
        [userId, sourceUuid]
      );
      if ((upd.rowCount ?? 0) > 0) { removed++; removedUserIds.add(userId); }
    }

    // 2. Handle conflicts (learners already on target — soft-remove from source, keep on target)
    const conflictsRes = await client.query(
      `SELECT es.user_id, au.email
         FROM enrollment es JOIN app_user au ON au.id = es.user_id
        WHERE es.course_run_id = $1
          AND LOWER(COALESCE(es.enrolment_status, '')) NOT IN ('admin removed', 'cancelled', 'withdrawn')
          AND EXISTS (SELECT 1 FROM enrollment et WHERE et.user_id = es.user_id AND et.course_run_id = $2)`,
      [sourceUuid, targetUuid]
    );
    const skippedConflicts = conflictsRes.rows.map((r: any) => r.email as string);
    if (conflictsRes.rows.length > 0) {
      const conflictIds = conflictsRes.rows.map((r: any) => r.user_id);
      await client.query(
        `UPDATE enrollment SET enrolment_status = 'Admin Removed', updated_at = NOW()
          WHERE course_run_id = $1 AND user_id = ANY($2::uuid[])`,
        [sourceUuid, conflictIds]
      );
      for (const id of conflictIds) removedUserIds.add(id);
    }

    // 3. Move remaining active learners from source to target
    const movedRes = await client.query(
      `UPDATE enrollment SET course_run_id = $2, updated_at = NOW()
        WHERE course_run_id = $1
          AND LOWER(COALESCE(enrolment_status, '')) NOT IN ('admin removed', 'cancelled', 'withdrawn')
          AND NOT EXISTS (SELECT 1 FROM enrollment et WHERE et.user_id = enrollment.user_id AND et.course_run_id = $2)
        RETURNING user_id`,
      [sourceUuid, targetUuid]
    );
    const moved = movedRes.rowCount ?? 0;
    const movedUserIds: string[] = movedRes.rows.map((r: any) => r.user_id as string);

    // 4. Trainer: look up the official trainer, clear source, set target
    let resolvedTrainerName: string | null = null;
    let resolvedTrainerEmail: string | null = trainerEmailNorm;
    let resolvedTrainerId: string | null = null;

    if (trainerEmailNorm) {
      const trRow = (await client.query(
        `SELECT id, full_name, email FROM app_user WHERE LOWER(email) = $1 LIMIT 1`,
        [trainerEmailNorm]
      )).rows[0];
      // Item 15: trainer email provided but not in LMS and no name given — cannot assign anonymously
      if (!trRow && !trainer_name) {
        await client.query('ROLLBACK');
        return res.status(400).json({
          success: false,
          error: `Trainer ${trainerEmailNorm} not found in LMS. Provide trainer_name to assign them by name, or create their account first.`,
        });
      }
      resolvedTrainerId = trRow?.id ?? null;
      resolvedTrainerName = trRow?.full_name ?? trainer_name ?? null;
      resolvedTrainerEmail = trRow?.email ?? trainerEmailNorm;
    } else {
      // Default: carry the current source trainer to target
      const curTrainer = (await client.query(
        `SELECT trainer_id, trainer_name, trainer_email FROM course_run_trainer WHERE course_run_id = $1 LIMIT 1`,
        [sourceUuid]
      )).rows[0];
      resolvedTrainerId = curTrainer?.trainer_id ?? null;
      resolvedTrainerName = curTrainer?.trainer_name ?? null;
      resolvedTrainerEmail = curTrainer?.trainer_email ?? null;
    }

    // Clear source trainers
    await client.query(`DELETE FROM course_run_trainer WHERE course_run_id = $1`, [sourceUuid]);
    await client.query(
      `UPDATE course_run SET assigned_trainer_id = NULL, assigned_trainer_name = NULL, assigned_trainer_email = NULL, updated_at = NOW() WHERE id = $1`,
      [sourceUuid]
    );

    // Set target trainer
    if (resolvedTrainerName || resolvedTrainerEmail) {
      await client.query(`DELETE FROM course_run_trainer WHERE course_run_id = $1`, [targetUuid]);
      await client.query(
        `INSERT INTO course_run_trainer (course_run_id, trainer_id, trainer_name, trainer_email) VALUES ($1, $2, $3, $4)`,
        [targetUuid, resolvedTrainerId, resolvedTrainerName, resolvedTrainerEmail]
      );
      await client.query(
        `UPDATE course_run SET assigned_trainer_id = $1, assigned_trainer_name = $2, assigned_trainer_email = $3, updated_at = NOW() WHERE id = $4`,
        [resolvedTrainerId, resolvedTrainerName, resolvedTrainerEmail, targetUuid]
      );
    }

    // Signal learner course list refresh
    const allAffected = [...new Set([...movedUserIds, ...Array.from(removedUserIds)])];
    if (allAffected.length > 0) {
      await client.query(`UPDATE app_user SET courses_updated_at = NOW() WHERE id = ANY($1::uuid[])`, [allAffected]);
    }

    await client.query('COMMIT');

    // Check whether source is now vacated
    const sourceVacated = !((await pool.query(
      `SELECT EXISTS(SELECT 1 FROM enrollment WHERE course_run_id = $1
         AND LOWER(COALESCE(enrolment_status, '')) NOT IN ('admin removed', 'cancelled', 'withdrawn')) AS has_learner`,
      [sourceUuid]
    )).rows[0]?.has_learner ?? false);

    // 5. SSG/TPG enrolment re-point (post-transaction; LMS enrollment now points to target)
    let tpgEnrolment: any = { skipped: true };
    if (syncTpg) {
      tpgEnrolment = { repointed: [] as any[], cancelled: [] as any[] };
      for (const uid of movedUserIds) {
        try {
          const r = await repointEnrolmentToRunForLearner(targetUuid, { userId: uid }, { sourceRunUuid: sourceUuid });
          tpgEnrolment.repointed.push({ userId: uid, status: r.status, message: r.message });
        } catch (e: any) {
          tpgEnrolment.repointed.push({ userId: uid, status: 'error', message: e?.message });
        }
      }
      for (const uid of Array.from(removedUserIds)) {
        try {
          const r = await cancelEnrolmentForLearnerOnRun(sourceUuid, { userId: uid });
          tpgEnrolment.cancelled.push({ userId: uid, status: r.status, message: r.message });
        } catch (e: any) {
          tpgEnrolment.cancelled.push({ userId: uid, status: 'error', message: e?.message });
        }
      }
    }

    // 6. SSG/TPG trainer push to target + clear from source
    let tpgTrainer: any = { skipped: true };
    if (syncTpg && resolvedTrainerEmail) {
      tpgTrainer = {} as any;
      try {
        tpgTrainer.target = await pushTrainerToTpgForRun(targetUuid, { onlyEmail: resolvedTrainerEmail });
      } catch (e: any) {
        tpgTrainer.target = { status: 'error', message: e?.message };
      }
      if (tpgTrainer.target?.status === 'synced') {
        try {
          tpgTrainer.source = await clearTrainerOnTpgForRun(sourceUuid);
        } catch (e: any) {
          tpgTrainer.source = { status: 'error', message: e?.message };
        }
      } else {
        tpgTrainer.source = { status: 'skipped_target_failed', message: 'Source trainer kept on TPGateway — fix target assignment first' };
      }
    }

    // 7. GCal sync (best-effort last)
    let calendar: any = { skipped: true };
    if (syncCalendar) {
      calendar = {} as any;
      try {
        await ensureClassCalendarEvent(targetUuid);
        calendar.target = await syncClassAttendees(targetUuid);
        if (sourceVacated) {
          calendar.source = await removeClassCalendarEvents(sourceUuid, { reason: 'class migrated to another run' });
          calendar.source_events_removed = true;
        } else {
          calendar.source = await syncClassAttendees(sourceUuid);
          calendar.source_events_removed = false;
        }
      } catch (e: any) {
        calendar.error = e?.message || String(e);
      }
    }

    return res.status(200).json({
      success: true,
      summary: { moved, removed, skipped_conflicts: skippedConflicts, source_vacated: sourceVacated },
      tpg_enrolment: tpgEnrolment,
      tpg_trainer: tpgTrainer,
      calendar,
    });
  } catch (err: any) {
    try { await client.query('ROLLBACK'); } catch { /* ignore */ }
    console.error('[external/move-class] error:', err);
    return res.status(500).json({ success: false, error: err?.message || 'Failed to move class' });
  } finally {
    client.release();
  }
}
