import { withAuth } from '@lib/auth/withAuth';
import { NextApiRequest, NextApiResponse } from 'next';
import pool from '../../../lib/db';
import { triggerClassCalendarSync } from '@lib/calendar/triggerClassCalendarSync';

/**
 * Keep class_status in step with reality, synchronously — mirrors the derive that classes-by-date
 * already persists lazily on calendar load: a run with no trainer (or no learners) can't be Confirmed.
 * Doing it here makes the revert IMMEDIATE (the modal/list no longer needs a reload to show Pending);
 * the eventual state is identical to before, only the timing changes. Only the auto-managed
 * Pending/Confirmed states are touched — Cancelled/Unconfirmed/Completed are left alone.
 */
async function syncClassStatus(courseRunUuid: string) {
  const r = await pool.query<{ has_trainer: boolean; has_learner: boolean; class_status: string }>(
    `SELECT
       (EXISTS(SELECT 1 FROM course_run_trainer t WHERE t.course_run_id = cr.id)
         OR cr.assigned_trainer_id IS NOT NULL
         OR nullif(btrim(cr.assigned_trainer_name), '') IS NOT NULL
         OR nullif(btrim(cr.tpg_assigned_trainer_email), '') IS NOT NULL) AS has_trainer,
       EXISTS(SELECT 1 FROM enrollment e WHERE e.course_run_id = cr.id
                AND LOWER(COALESCE(e.enrolment_status, '')) NOT IN ('admin removed', 'cancelled', 'withdrawn')) AS has_learner,
       cr.class_status
     FROM course_run cr WHERE cr.id = $1`,
    [courseRunUuid]
  );
  const row = r.rows[0];
  if (!row || !['Pending', 'Confirmed'].includes(row.class_status)) return;
  const next = row.has_trainer && row.has_learner ? 'Confirmed' : 'Pending';
  if (next !== row.class_status) {
    await pool.query(`UPDATE course_run SET class_status = $1, updated_at = NOW() WHERE id = $2`, [next, courseRunUuid]);
  }
}

/** Sync legacy single-trainer columns on course_run with the first trainer from the junction table */
async function syncLegacyColumns(courseRunUuid: string) {
  const first = await pool.query(
    `SELECT trainer_id, trainer_name, trainer_email
     FROM course_run_trainer
     WHERE course_run_id = $1
     ORDER BY assigned_at ASC
     LIMIT 1`,
    [courseRunUuid]
  );
  if (first.rows.length > 0) {
    const { trainer_id, trainer_name, trainer_email } = first.rows[0];
    await pool.query(
      `UPDATE course_run
       SET assigned_trainer_id = $1, assigned_trainer_name = $2, assigned_trainer_email = $3, updated_at = NOW()
       WHERE id = $4`,
      [trainer_id, trainer_name, trainer_email, courseRunUuid]
    );
  } else {
    await pool.query(
      `UPDATE course_run
       SET assigned_trainer_id = NULL, assigned_trainer_name = NULL, assigned_trainer_email = NULL, updated_at = NOW()
       WHERE id = $1`,
      [courseRunUuid]
    );
  }
}

async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ success: false, error: 'Method not allowed' });
  }

  const { courseRunUuid, trainerId, junctionId } = req.body;
  if (!courseRunUuid) {
    return res.status(400).json({ success: false, error: 'courseRunUuid is required' });
  }

  try {
    if (junctionId) {
      // Remove by junction table row PK — most reliable
      await pool.query(
        `DELETE FROM course_run_trainer WHERE id = $1 AND course_run_id = $2`,
        [junctionId, courseRunUuid]
      );
      console.log(`🗑️ Removed junction row ${junctionId} from course run ${courseRunUuid}`);
    } else if (trainerId) {
      // Remove a specific trainer from the junction table by trainer_id
      await pool.query(
        `DELETE FROM course_run_trainer WHERE course_run_id = $1 AND trainer_id = $2`,
        [courseRunUuid, trainerId]
      );
      console.log(`🗑️ Removed trainer ${trainerId} from course run ${courseRunUuid}`);
    } else {
      // Remove ALL trainers (legacy behavior)
      await pool.query(
        `DELETE FROM course_run_trainer WHERE course_run_id = $1`,
        [courseRunUuid]
      );
      console.log(`🗑️ Removed all trainers from course run ${courseRunUuid}`);
    }

    // Sync the legacy columns + recompute class_status immediately (so removing the last trainer
    // reverts Confirmed → Pending right away, not only on the next calendar grid recompute).
    await syncLegacyColumns(courseRunUuid);
    await syncClassStatus(courseRunUuid);

    // Calendar: trainer removed -> drop them from the event's attendees.
    // Skippable (syncCalendar:false) so callers that manage the calendar explicitly
    // (e.g. the attendee reconcile panel) aren't overridden by a full auto-resync.
    if (req.body?.syncCalendar !== false) triggerClassCalendarSync(courseRunUuid);

    return res.status(200).json({ success: true, message: 'Trainer removed successfully' });
  } catch (error) {
    console.error('❌ Error removing trainer:', error);
    return res.status(500).json({
      success: false,
      error: 'Internal server error: ' + (error instanceof Error ? error.message : 'Unknown error'),
    });
  }
}

export default withAuth(handler, { roles: ['admin', 'trainingProvider', 'developer'] });
