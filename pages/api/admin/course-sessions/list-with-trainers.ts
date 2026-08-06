import { withAuth } from '@lib/auth/withAuth';
import type { NextApiRequest, NextApiResponse } from 'next';
import pool from '../../../../lib/db';

/**
 * GET /api/admin/course-sessions/list-with-trainers?courseRunUuid=<uuid>
 *
 * Returns every session for a course run with its resolved trainer:
 *   - If the session has a per-session override (course_session.trainer_id),
 *     return that trainer.
 *   - Otherwise return the run-level default trainer (first row in
 *     course_run_trainer by assigned_at ASC).
 *
 * The response also includes a `defaultTrainer` field describing the
 * run-level default, so the UI can show "Using default: Dr. X" next to
 * sessions that haven't been overridden.
 *
 * This endpoint only reads from local tables — SSG is not involved.
 * Per-session trainer override is a local grooming feature; SSG's
 * trainer assignment is still at the run level.
 */
async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') {
    return res.status(405).json({ success: false, error: 'Method not allowed' });
  }

  const courseRunUuid = typeof req.query.courseRunUuid === 'string' ? req.query.courseRunUuid : '';
  if (!courseRunUuid) {
    return res.status(400).json({ success: false, error: 'courseRunUuid is required' });
  }

  try {
    // Run-level default trainer (first row in the junction table by assigned_at)
    const defaultRes = await pool.query(
      `SELECT trainer_id, trainer_name, trainer_email
       FROM course_run_trainer
       WHERE course_run_id = $1
       ORDER BY assigned_at ASC
       LIMIT 1`,
      [courseRunUuid]
    );
    const defaultTrainer = defaultRes.rows[0] || null;

    // All trainers assigned to this run (used by the UI's per-session dropdown)
    const allTrainersRes = await pool.query(
      `SELECT trainer_id, trainer_name, trainer_email
       FROM course_run_trainer
       WHERE course_run_id = $1
       ORDER BY assigned_at ASC`,
      [courseRunUuid]
    );

    // Sessions with per-session trainer columns. Left-resolve the effective
    // trainer server-side so the client doesn't have to reimplement the rule.
    const sessRes = await pool.query(
      `SELECT id, course_run_id, session_number, ssg_session_id, title,
              start_date, end_date, start_time, end_time, mode_of_training,
              trainer_id, trainer_name, trainer_email
       FROM course_session
       WHERE course_run_id = $1 AND deleted = false
       ORDER BY start_date ASC, start_time ASC, session_number ASC`,
      [courseRunUuid]
    );

    const sessions = sessRes.rows.map(r => {
      const hasOverride = !!r.trainer_id;
      return {
        id: r.id,
        sessionNumber: r.session_number,
        ssgSessionId: r.ssg_session_id,
        title: r.title,
        startDate: r.start_date,
        endDate: r.end_date,
        startTime: r.start_time,
        endTime: r.end_time,
        modeOfTraining: r.mode_of_training,
        hasOverride,
        // `trainer` is the EFFECTIVE trainer for this session — either the
        // override or the run-level default. Null only if the run has no
        // default AND the session has no override.
        trainer: hasOverride
          ? { trainerId: r.trainer_id, trainerName: r.trainer_name, trainerEmail: r.trainer_email }
          : defaultTrainer
            ? { trainerId: defaultTrainer.trainer_id, trainerName: defaultTrainer.trainer_name, trainerEmail: defaultTrainer.trainer_email }
            : null,
      };
    });

    return res.status(200).json({
      success: true,
      data: {
        defaultTrainer: defaultTrainer
          ? { trainerId: defaultTrainer.trainer_id, trainerName: defaultTrainer.trainer_name, trainerEmail: defaultTrainer.trainer_email }
          : null,
        availableTrainers: allTrainersRes.rows.map(r => ({
          trainerId: r.trainer_id,
          trainerName: r.trainer_name,
          trainerEmail: r.trainer_email,
        })),
        sessions,
      },
    });
  } catch (err) {
    console.error('❌ list-with-trainers error:', err);
    return res.status(500).json({
      success: false,
      error: err instanceof Error ? err.message : 'Internal server error',
    });
  }
}

export default withAuth(handler, { roles: ['admin', 'trainingProvider', 'developer'] });
