import type { NextApiRequest, NextApiResponse } from 'next';
import pool from '../../../lib/db';
import { ensureClassCalendarEvent, syncClassAttendees, removeClassCalendarEvents } from '../../../lib/calendar/ensureClassCalendarEvent';

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
export default async function handler(req: NextApiRequest, res: NextApiResponse) {
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
      if ((upd.rowCount ?? 0) > 0) { removed++; affectedUserIds.add(userId); }
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
      for (const id of conflictUserIds) affectedUserIds.add(id);
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
    for (const r of movedRes.rows) affectedUserIds.add(r.user_id);

    // 4. Trainer: set on TARGET (replace), clear on SOURCE.
    let trainerTarget: string | null = null;
    const tName = (trainerName ? String(trainerName).trim() : '');
    // Always clear the source run's trainer.
    await client.query(`DELETE FROM course_run_trainer WHERE course_run_id = $1`, [sourceRunId]);
    await client.query(
      `UPDATE course_run SET assigned_trainer_id = NULL, assigned_trainer_name = NULL,
              assigned_trainer_email = NULL, updated_at = NOW() WHERE id = $1`,
      [sourceRunId]
    );
    // Replace the target run's trainer.
    await client.query(`DELETE FROM course_run_trainer WHERE course_run_id = $1`, [targetRunId]);
    if (tName) {
      const tRes = await client.query(
        `SELECT au.id, au.email, au.full_name
           FROM app_user au JOIN trainer_profile tp ON tp.user_id = au.id
          WHERE au.full_name = $1 LIMIT 1`,
        [tName]
      );
      const tId = tRes.rows[0]?.id ?? null;
      const tEmail = tRes.rows[0]?.email ?? null;
      const tFull = tRes.rows[0]?.full_name ?? tName;
      await client.query(
        `INSERT INTO course_run_trainer (course_run_id, trainer_id, trainer_name, trainer_email)
         VALUES ($1, $2, $3, $4)`,
        [targetRunId, tId, tFull, tEmail]
      );
      await client.query(
        `UPDATE course_run SET assigned_trainer_id = $1, assigned_trainer_name = $2,
                assigned_trainer_email = $3, updated_at = NOW() WHERE id = $4`,
        [tId, tFull, tEmail, targetRunId]
      );
      trainerTarget = tFull;
    } else {
      await client.query(
        `UPDATE course_run SET assigned_trainer_id = NULL, assigned_trainer_name = NULL,
                assigned_trainer_email = NULL, updated_at = NOW() WHERE id = $1`,
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

    return res.status(200).json({
      success: true,
      summary: { moved, removed, skippedConflicts, trainerTarget, sourceTrainerCleared: true, sourceVacated },
      calendar,
    });
  } catch (err: any) {
    try { await client.query('ROLLBACK'); } catch { /* ignore */ }
    console.error('❌ [move-class-to-run]', err?.message || err);
    return res.status(500).json({ success: false, error: err?.message || 'Failed to move class' });
  } finally {
    client.release();
  }
}
