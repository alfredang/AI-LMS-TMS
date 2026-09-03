import { withAuth } from '@lib/auth/withAuth';
import type { NextApiRequest, NextApiResponse } from 'next';
import pool from '@lib/db';
import { sendNextTrainerInvitationForCourseRun } from '@/lib/trainerInvitationSender';

/**
 * POST /api/admin/reset-trainer-invitations
 * Body: { courseRunUuid: string }
 *
 * "Start over" for a class stuck without a trainer (Unconfirmed / Pending):
 *   1. Marks EVERY previous invitation for the run as status 'reset' — the
 *      cascade's skip-sets and its "resume after the last invitee" anchor both
 *      ignore 'reset' rows, so the walk restarts at the FIRST approved trainer.
 *      Old accept/decline links become no-ops (status is no longer 'pending').
 *   2. Re-arms the exhausted-list alert.
 *   3. Immediately sends a fresh invitation, which lands on the first trainer
 *      in the course's approved list.
 *
 * Refused when a trainer is already locally assigned — reset is only for runs
 * still hunting for one (use Unconfirm to drop an assigned trainer first).
 */
async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ success: false, error: 'Method not allowed' });
  }

  try {
    const { courseRunUuid } = req.body || {};
    if (!courseRunUuid || typeof courseRunUuid !== 'string') {
      return res.status(400).json({ success: false, error: 'courseRunUuid is required' });
    }

    const runRes = await pool.query(
      `SELECT cr.id, cr.course_run_id, c.title
         FROM course_run cr JOIN course c ON c.id = cr.course_id
        WHERE cr.id::text = $1 LIMIT 1`,
      [courseRunUuid]
    );
    if (runRes.rows.length === 0) {
      return res.status(404).json({ success: false, error: 'Course run not found' });
    }

    // Guard: never reset a run that already has a locally-assigned trainer.
    const assigned = await pool.query(
      `SELECT trainer_name FROM course_run_trainer WHERE course_run_id = $1 LIMIT 1`,
      [courseRunUuid]
    );
    if (assigned.rows.length > 0) {
      return res.status(409).json({
        success: false,
        error: `A trainer (${assigned.rows[0].trainer_name}) is already assigned to this class. Unconfirm the class first to remove them.`,
      });
    }

    // 1. Wipe the cascade history: pending/declined/blocked/resent → 'reset'.
    //    ('accepted' is untouched — with no course_run_trainer row it shouldn't
    //    exist here, but if it does it's evidence worth keeping visible.)
    const resetRes = await pool.query(
      `UPDATE trainer_invitation
          SET status = 'reset', updated_at = NOW()
        WHERE course_run_id = $1
          AND status IN ('pending', 'declined', 'blocked', 'resent')
        RETURNING id`,
      [courseRunUuid]
    );

    // 2. Re-arm the exhausted-list alert for the fresh cycle.
    await pool.query(
      `UPDATE course_run SET exhausted_alert_sent_at = NULL, updated_at = NOW() WHERE id = $1`,
      [courseRunUuid]
    ).catch(() => { /* column ensured lazily elsewhere */ });

    console.log(
      `🔄 [reset-trainer-invitations] course_run=${courseRunUuid} — ${resetRes.rowCount} invitation(s) reset; restarting cascade from the first approved trainer`
    );

    // 3. Restart the cascade — with all prior rows 'reset', this picks the
    //    FIRST eligible trainer in the approved list.
    const result = await sendNextTrainerInvitationForCourseRun({ courseRunUuid });

    if (result.status === 'sent') {
      return res.status(200).json({
        success: true,
        invitationsReset: resetRes.rowCount,
        message: `Cascade reset — invitation sent to ${result.trainerName}`,
        result,
      });
    }
    // Reset happened but no invitation could go out (paused / no learners /
    // no approved trainers / OAuth missing…): report it honestly.
    return res.status(200).json({
      success: false,
      invitationsReset: resetRes.rowCount,
      error: `Invitations were reset, but no new invitation was sent: ${result.message || result.status}`,
      result,
    });
  } catch (err) {
    console.error('❌ [reset-trainer-invitations] failed:', err);
    return res.status(500).json({
      success: false,
      error: err instanceof Error ? err.message : 'Internal server error',
    });
  }
}

export default withAuth(handler);
