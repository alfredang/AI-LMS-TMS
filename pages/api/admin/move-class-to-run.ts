import { withAuth } from '@lib/auth/withAuth';
import type { NextApiRequest, NextApiResponse } from 'next';
import pool from '../../../lib/db';
import { ensureClassCalendarEvent, syncClassAttendees, removeClassCalendarEvents } from '../../../lib/calendar/ensureClassCalendarEvent';
import { pushTrainerToTpgForRun, clearTrainerOnTpgForRun } from '../../../lib/ssg/pushTrainerToTpgForRun';
import { repointEnrolmentToRunForLearner, cancelEnrolmentForLearnerOnRun } from '../../../lib/ssg/mutateEnrolmentForLearner';

/**
 * POST /api/admin/move-class-to-run
 *
 * Reschedules a class by MOVING it onto a different existing run of the SAME
 * course (the "Rescheduling" tab in Edit Class). In one transaction:
 *   - Flagged learners (removedLearnerEmails) are soft-removed on the SOURCE run
 *     (enrolment_status='Admin Removed') and NOT moved. Guarded against learners
 *     with submitted assessments unless { force: true }.
 *   - The remaining ACTIVE enrolments are re-pointed source -> target. Learners
 *     already enrolled in the target (UNIQUE user_id+course_run_id) can't be moved,
 *     so they are soft-removed from the SOURCE (Admin Removed) and continue on the
 *     target — the run is being vacated, so nobody is left behind. Reported as
 *     skippedConflicts.
 *   - The trainer (trainerName, defaults to the current trainer) is set on the
 *     TARGET run (replace) and CLEARED from the SOURCE run.
 *   - The SOURCE run's class_status is left UNCHANGED.
 *
 * Google Calendar (opt-in via syncCalendar): after the move, reconciles BOTH runs'
 * calendars to their new rosters — TARGET gains the moved learners + trainer (events
 * ensured/adopted live, never duplicated), SOURCE drops them. Ticking the calendar
 * box is the admin's EXPLICIT approval to delete now-stale events: if the SOURCE run
 * is left with no active learners after the move, its old events are REMOVED (the
 * migration exception to the "delete only on Cancel" rule — same spirit as the edit-
 * session reschedule cleanup). If learners remain on the source (e.g. conflicts that
 * couldn't move), its events are KEPT and only the moved-out attendees are dropped.
 * Best-effort; never fails the move.
 *
 * Body: { sourceRunId, targetRunId, trainerName?, removedLearnerEmails?: string[], force?: boolean, syncCalendar?: boolean }
 */
async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ success: false, error: 'Method not allowed' });
  }

  const {
    sourceRunId,
    targetRunId,
    trainerName,
    removedLearnerEmails = [],
    force = false,
    syncCalendar = false,
    syncTrainerToTpg = false,
    syncEnrolmentToTpg = false,  // opt-in: re-point moved learners + cancel removed on TPGateway
    targetTrainers,        // Array<{name,email}> — LMS trainers to add to the target run
    tpgTargetEmail,        // the ONE official trainer (TPG push / re-invite target)
  } = req.body || {};

  if (!sourceRunId || !targetRunId) {
    return res.status(400).json({ success: false, error: 'sourceRunId and targetRunId are required' });
  }
  if (sourceRunId === targetRunId) {
    return res.status(400).json({ success: false, error: 'Target run must differ from the source run' });
  }
  const removedEmails: string[] = Array.isArray(removedLearnerEmails)
    ? removedLearnerEmails.map((e: any) => String(e).trim().toLowerCase()).filter(Boolean)
    : [];

  const client = await pool.connect();
  try {
    // 1. Validate both runs exist and belong to the same course.
    const runsRes = await client.query(
      `SELECT id, course_id, class_status FROM course_run WHERE id = ANY($1::uuid[])`,
      [[sourceRunId, targetRunId]]
    );
    const source = runsRes.rows.find((r) => r.id === sourceRunId);
    const target = runsRes.rows.find((r) => r.id === targetRunId);
    if (!source || !target) {
      return res.status(404).json({ success: false, error: 'Source or target course run not found' });
    }
    if (source.course_id !== target.course_id) {
      return res.status(400).json({ success: false, error: 'Target run belongs to a different course' });
    }

    await client.query('BEGIN');

    const affectedUserIds = new Set<string>();
    const removedUserIds = new Set<string>();   // soft-removed on SOURCE → cancel on TPG (opt-in)

    // 2. Soft-remove flagged learners on the SOURCE run (drop-outs). Not moved.
    let removed = 0;
    for (const email of removedEmails) {
      const userRes = await client.query(`SELECT id FROM app_user WHERE LOWER(email) = $1 LIMIT 1`, [email]);
      if (userRes.rows.length === 0) continue;
      const userId = userRes.rows[0].id;

      if (!force) {
        const guard = await client.query(
          `SELECT
             (SELECT COUNT(*)::int FROM link_assessment_submission WHERE user_id = $1 AND course_run_id = $2) AS link_count,
             (SELECT COUNT(*)::int FROM submission s JOIN enrollment e ON e.id = s.enrollment_id
                WHERE e.user_id = $1 AND e.course_run_id = $2) AS legacy_count`,
          [userId, sourceRunId]
        );
        const cnt = (guard.rows[0]?.link_count ?? 0) + (guard.rows[0]?.legacy_count ?? 0);
        if (cnt > 0) {
          await client.query('ROLLBACK');
          return res.status(409).json({
            success: false,
            code: 'SUBMISSION_EXISTS',
            email,
            message: `Cannot remove ${email} — they have ${cnt} submitted assessment file(s) for this run. Retry with force to override.`,
          });
        }
      }

      const upd = await client.query(
        `UPDATE enrollment SET enrolment_status = 'Admin Removed', updated_at = NOW()
          WHERE user_id = $1 AND course_run_id = $2`,
        [userId, sourceRunId]
      );
      if ((upd.rowCount ?? 0) > 0) { removed++; affectedUserIds.add(userId); removedUserIds.add(userId); }
    }

    // 3. Conflicts: learners already enrolled in the TARGET run. The source run is
    //    being VACATED, so they simply continue on the target and are soft-removed
    //    from the SOURCE (Admin Removed). They can't be "moved" (the UNIQUE
    //    user_id+course_run_id constraint forbids a second target row), but they
    //    must NOT be left behind — otherwise the source never empties. No
    //    submission guard here: they keep full access via the target enrolment.
    const conflictsRes = await client.query(
      `SELECT es.user_id, au.email
         FROM enrollment es JOIN app_user au ON au.id = es.user_id
        WHERE es.course_run_id = $1
          AND LOWER(COALESCE(es.enrolment_status, '')) NOT IN ('admin removed', 'cancelled', 'withdrawn')
          AND EXISTS (SELECT 1 FROM enrollment et WHERE et.user_id = es.user_id AND et.course_run_id = $2)`,
      [sourceRunId, targetRunId]
    );
    const conflictUserIds = conflictsRes.rows.map((r) => r.user_id);
    const skippedConflicts = conflictsRes.rows.map((r) => ({ email: r.email }));
    if (conflictUserIds.length > 0) {
      await client.query(
        `UPDATE enrollment SET enrolment_status = 'Admin Removed', updated_at = NOW()
          WHERE course_run_id = $1 AND user_id = ANY($2::uuid[])`,
        [sourceRunId, conflictUserIds]
      );
      for (const id of conflictUserIds) { affectedUserIds.add(id); removedUserIds.add(id); }
    }

    // Move the rest (active, not already in target).

    const movedRes = await client.query(
      `UPDATE enrollment SET course_run_id = $2, updated_at = NOW()
        WHERE course_run_id = $1
          AND LOWER(COALESCE(enrolment_status, '')) NOT IN ('admin removed', 'cancelled', 'withdrawn')
          AND NOT EXISTS (SELECT 1 FROM enrollment et WHERE et.user_id = enrollment.user_id AND et.course_run_id = $2)
        RETURNING user_id`,
      [sourceRunId, targetRunId]
    );
    const moved = movedRes.rowCount ?? 0;
    const movedUserIds: string[] = [];
    for (const r of movedRes.rows) { affectedUserIds.add(r.user_id); movedUserIds.push(r.user_id); }

    // 4. Trainers: add the composed LMS list to TARGET, fully clear SOURCE.
    //    targetTrainers = LMS list (many); tpgTargetEmail = the ONE official trainer.
    const targetList: Array<{ name: string; email: string }> = Array.isArray(targetTrainers) && targetTrainers.length
      ? targetTrainers.map((t: any) => ({ name: String(t?.name || '').trim(), email: String(t?.email || '').trim() })).filter((t: any) => t.name || t.email)
      : (trainerName ? [{ name: String(trainerName).trim(), email: '' }] : []); // backward-compat (single)
    const officialEmail = (tpgTargetEmail ? String(tpgTargetEmail) : (targetList[0]?.email || '')).toLowerCase().trim();

    // Always clear the source run's LMS trainers (the class is leaving it).
    await client.query(`DELETE FROM course_run_trainer WHERE course_run_id = $1`, [sourceRunId]);
    await client.query(
      `UPDATE course_run SET assigned_trainer_id = NULL, assigned_trainer_name = NULL,
              assigned_trainer_email = NULL, updated_at = NOW() WHERE id = $1`,
      [sourceRunId]
    );

    // Replace the target run's LMS trainers with the composed list.
    await client.query(`DELETE FROM course_run_trainer WHERE course_run_id = $1`, [targetRunId]);
    const inserted: Array<{ id: string | null; name: string; email: string | null }> = [];
    for (const t of targetList) {
      const r = await client.query(
        `SELECT au.id, au.email, au.full_name FROM app_user au
          WHERE ($1 <> '' AND lower(au.email) = $1) OR ($2 <> '' AND lower(au.full_name) = lower($2)) LIMIT 1`,
        [t.email.toLowerCase(), t.name]
      );
      const e = { id: r.rows[0]?.id ?? null, name: r.rows[0]?.full_name ?? t.name, email: (r.rows[0]?.email ?? t.email) || null };
      await client.query(
        `INSERT INTO course_run_trainer (course_run_id, trainer_id, trainer_name, trainer_email) VALUES ($1, $2, $3, $4)`,
        [targetRunId, e.id, e.name, e.email]
      );
      inserted.push(e);
    }
    // Legacy scalar mirror = the official trainer (or the first added one).
    const officialEntry = (officialEmail ? inserted.find((e) => (e.email || '').toLowerCase() === officialEmail) : null) || inserted[0] || null;
    const trainerTarget: string | null = officialEntry?.name ?? null;
    if (officialEntry) {
      await client.query(
        `UPDATE course_run SET assigned_trainer_id = $1, assigned_trainer_name = $2, assigned_trainer_email = $3, updated_at = NOW() WHERE id = $4`,
        [officialEntry.id, officialEntry.name, officialEntry.email, targetRunId]
      );
    } else {
      await client.query(
        `UPDATE course_run SET assigned_trainer_id = NULL, assigned_trainer_name = NULL, assigned_trainer_email = NULL, updated_at = NOW() WHERE id = $1`,
        [targetRunId]
      );
    }

    // 5. Signal affected learners to refresh their course list.
    if (affectedUserIds.size > 0) {
      await client.query(`UPDATE app_user SET courses_updated_at = NOW() WHERE id = ANY($1::uuid[])`, [
        Array.from(affectedUserIds),
      ]);
    }

    await client.query('COMMIT');

    // Did the source run end up vacated (no active learners left)? Reported always
    // so the UI can offer to clean up the source's now-orphaned calendar events even
    // when calendar sync was OFF for this move.
    const sourceVacated = !((await pool.query<{ has_learner: boolean }>(
      `SELECT EXISTS(
         SELECT 1 FROM enrollment e
          WHERE e.course_run_id = $1
            AND LOWER(COALESCE(e.enrolment_status, '')) NOT IN ('admin removed', 'cancelled', 'withdrawn')
       ) AS has_learner`,
      [sourceRunId]
    )).rows[0]?.has_learner ?? false);

    // 6. Opt-in calendar migration (best-effort; never fails the move). The DB move
    //    changed both runs' rosters, so reconcile BOTH calendars to their new state:
    //    - TARGET: ensure its events exist (live-match/adopt), then sync attendees to
    //      its NEW roster (existing learners + moved-in learners + the trainer).
    //    - SOURCE: a vacated run is now EMPTY (everyone moved out or, for conflicts,
    //      soft-removed), so its events are stale — REMOVE them. Ticking the calendar
    //      box is the admin's approval for this deletion (the migration exception).
    //      The empty-check is still honored defensively: if any active learner somehow
    //      remains, the events are KEPT and only departed attendees are dropped.
    //    sendUpdates:'none' throughout.
    let calendar: any = { skipped: true };
    if (syncCalendar) {
      calendar = {};
      try {
        await ensureClassCalendarEvent(targetRunId);
        calendar.target = await syncClassAttendees(targetRunId);

        if (!sourceVacated) {
          calendar.source = await syncClassAttendees(sourceRunId);
          calendar.sourceEventsRemoved = false;
        } else {
          calendar.source = await removeClassCalendarEvents(sourceRunId, { reason: 'class migrated to another run' });
          calendar.sourceEventsRemoved = true;
        }
      } catch (e: any) {
        calendar = { error: e?.message || String(e) };
      }
    }

    // 7. Opt-in TPG trainer sync (best-effort; never fails the move). Push ONLY the official
    //    (chosen) trainer to the TARGET on TPGateway, and clear the vacated SOURCE — but only
    //    after the target assignment succeeds (no orphaning).
    let tpgTrainer: any = { skipped: true };
    if (syncTrainerToTpg) {
      tpgTrainer = {};
      if (!officialEntry?.email) {
        tpgTrainer.target = { status: 'skipped_no_trainer', message: 'No eligible official trainer selected, so TPGateway was left unchanged.' };
        tpgTrainer.source = { status: 'skipped_no_target', message: 'Source trainer kept on TPGateway (no official trainer assigned to the target).' };
      } else {
        try {
          tpgTrainer.target = await pushTrainerToTpgForRun(targetRunId, { onlyEmail: officialEntry.email });
        } catch (e: any) { tpgTrainer.target = { status: 'error', message: e?.message || String(e) }; }
        if (tpgTrainer.target?.status === 'synced') {
          try {
            tpgTrainer.source = await clearTrainerOnTpgForRun(sourceRunId);
          } catch (e: any) { tpgTrainer.source = { status: 'error', message: e?.message || String(e) }; }
        } else {
          tpgTrainer.source = { status: 'skipped_target_failed', message: 'Source trainer kept on TPGateway because the target assignment did not go through — fix the target on TPGateway, then remove the source trainer manually.' };
        }
      }
    }

    // 7b. Opt-in TPG enrolment sync (best-effort; never fails the move). Re-point each
    //     moved learner to the TARGET run (action Update — SSG ref preserved) and Cancel
    //     each removed/conflict learner on the SOURCE. Only learners with a stored
    //     enrolment_id are touched (others were never on TPG → skipped). On a successful
    //     cancel we clear the local enrolment_id so a future re-add can re-create on TPG.
    //     Mirrors the trainer opt-in; default OFF.
    let tpgEnrolment: any = { skipped: true };
    if (syncEnrolmentToTpg) {
      tpgEnrolment = { repointed: [], cancelled: [] };
      for (const uid of movedUserIds) {
        try {
          const r = await repointEnrolmentToRunForLearner(targetRunId, { userId: uid }, { sourceRunUuid: sourceRunId });
          tpgEnrolment.repointed.push({ userId: uid, status: r.status, message: r.message });
        } catch (e: any) {
          tpgEnrolment.repointed.push({ userId: uid, status: 'error', message: e?.message || String(e) });
        }
      }
      for (const uid of Array.from(removedUserIds)) {
        try {
          const r = await cancelEnrolmentForLearnerOnRun(sourceRunId, { userId: uid });
          if (r.status === 'synced' && r.enrolmentRef) {
            await pool.query(
              `UPDATE enrollment SET enrolment_id = NULL, updated_at = NOW()
                WHERE user_id = $1 AND course_run_id = $2 AND enrolment_id = $3`,
              [uid, sourceRunId, r.enrolmentRef]
            );
          }
          tpgEnrolment.cancelled.push({ userId: uid, status: r.status, message: r.message });
        } catch (e: any) {
          tpgEnrolment.cancelled.push({ userId: uid, status: 'error', message: e?.message || String(e) });
        }
      }
    }

    // 8. Invitation lifecycle (best-effort). The source is vacated, so its invitations are
    //    void. The target either got a TPG admin-override (no invite needed) or the official
    //    trainer must be re-invited to accept the new run.
    let invitation: any = { skipped: true };
    try {
      await pool.query(
        `UPDATE trainer_invitation SET status = 'superseded', responded_at = NOW(), updated_at = NOW()
          WHERE course_run_id = $1 AND status IN ('accepted', 'pending')`,
        [sourceRunId]
      );
      const tpgOverrode = syncTrainerToTpg && tpgTrainer?.target?.status === 'synced';
      if (tpgOverrode) {
        invitation = { status: 'tpg_override', message: 'Trainer finalized via TPGateway — no email invitation needed.' };
      } else if (officialEntry) {
        // The official trainer is LMS-assigned on the target, which the invite-sender treats as
        // "covered" (it skips when a trainer is assigned). A true re-invite needs the move UI to
        // mark the trainer as pending-not-assigned — KIV (trainer-unification-plan). For now we
        // don't auto-invite; report the assigned state honestly.
        invitation = { status: 'lms_assigned', message: 'Official trainer is assigned in the LMS on the new run. Tick "Assign on TPGateway" to finalize on TPG, or invite them from the trainer tools.' };
      } else {
        invitation = { status: 'none', message: 'No official trainer.' };
      }
    } catch (e: any) {
      invitation = { status: 'error', message: e?.message || String(e) };
    }

    return res.status(200).json({
      success: true,
      summary: { moved, removed, skippedConflicts, trainerTarget, sourceTrainerCleared: true, sourceVacated },
      calendar,
      tpgTrainer,
      tpgEnrolment,
      invitation,
    });
  } catch (err: any) {
    try { await client.query('ROLLBACK'); } catch { /* ignore */ }
    console.error('❌ [move-class-to-run]', err?.message || err);
    return res.status(500).json({ success: false, error: err?.message || 'Failed to move class' });
  } finally {
    client.release();
  }
}

export default withAuth(handler, { roles: ['admin', 'trainingProvider', 'developer'] });
