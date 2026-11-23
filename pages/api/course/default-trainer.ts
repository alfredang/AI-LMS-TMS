import { withAuth, AuthedApiRequest } from '@lib/auth/withAuth';
import type { NextApiRequest, NextApiResponse } from 'next';
import pool from '../../../lib/db';
import { isStaff } from '../../../lib/auth/courseRunAccess';
import { ensureCourseDefaultTrainerSchema, listTrainerOptions, listUnassignedUpcomingRuns, putDefaultTrainerFirst } from '../../../lib/trainers/courseDefaultTrainer';
import { assignTrainerToRun } from '../../../lib/trainers/assignTrainerToRun';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Course editor → Approved Trainers → Default, and Assign Trainer → ★ (`course.default_trainer_id`).
 * New runs of the course created without a trainer get this trainer automatically
 * (course_run trigger, see database/migrations/add_course_default_trainer.sql). Staff only.
 *
 * GET  ?courseId=                                  → { trainer, trainers[], unassignedUpcoming }
 * POST { courseId, trainerId|trainerEmail|null, applyToUpcoming } → save; optionally assign the trainer
 *      (LMS + TPGateway + calendar) to every upcoming run that has no trainer yet and
 *      confirm those runs (a default trainer is pre-agreed: no invitation is sent).
 */
async function handler(req: NextApiRequest, res: NextApiResponse) {
  const user = (req as AuthedApiRequest).authUser!;
  if (!isStaff(user)) return res.status(403).json({ success: false, error: 'Forbidden' });

  try {
    await ensureCourseDefaultTrainerSchema();
    const courseId = String((req.method === 'GET' ? req.query.courseId : req.body?.courseId) || '').trim();
    if (!UUID_RE.test(courseId)) return res.status(400).json({ success: false, error: 'courseId is required' });

    const found = await pool.query(
      `SELECT c.default_trainer_id, u.full_name, u.email
         FROM course c LEFT JOIN app_user u ON u.id = c.default_trainer_id
        WHERE c.id = $1`, [courseId]
    );
    if (found.rowCount === 0) return res.status(404).json({ success: false, error: 'Course not found' });
    const row = found.rows[0];
    const current = row.default_trainer_id ? { id: row.default_trainer_id, name: row.full_name, email: row.email } : null;

    if (req.method === 'GET') {
      const [trainers, unassigned] = await Promise.all([listTrainerOptions(), listUnassignedUpcomingRuns(courseId)]);
      return res.status(200).json({ success: true, trainer: current, trainers, unassignedUpcoming: unassigned.length });
    }

    if (req.method !== 'POST') return res.status(405).json({ success: false, error: 'Method not allowed' });

    const rawId = req.body?.trainerId;
    let trainerId: string | null = rawId ? String(rawId).trim() : null;
    if (trainerId && !UUID_RE.test(trainerId)) return res.status(400).json({ success: false, error: 'trainerId must be a user id' });
    // The approved-trainers table knows trainers by email, not id.
    const rawEmail = typeof req.body?.trainerEmail === 'string' ? req.body.trainerEmail.trim().toLowerCase() : '';
    if (!trainerId && rawEmail) {
      const byEmail = await pool.query(`SELECT id FROM app_user WHERE LOWER(email) = $1 LIMIT 1`, [rawEmail]);
      if (byEmail.rowCount === 0) return res.status(400).json({ success: false, error: `No LMS account for ${rawEmail}` });
      trainerId = byEmail.rows[0].id;
    }

    let trainer: { id: string; name: string; email: string } | null = null;
    if (trainerId) {
      const t = await pool.query(
        `SELECT u.id, u.full_name AS name, u.email FROM app_user u
          WHERE u.id = $1 AND EXISTS (SELECT 1 FROM user_role_map m WHERE m.user_id = u.id AND m.role = 'Trainer')`,
        [trainerId]
      );
      if (t.rowCount === 0) return res.status(400).json({ success: false, error: 'That user is not a trainer' });
      trainer = t.rows[0];
    }

    await pool.query('UPDATE course SET default_trainer_id = $1, updated_at = NOW() WHERE id = $2', [trainerId, courseId]);
    // The default trainer is always first in the approved trainer list.
    if (trainerId) await putDefaultTrainerFirst(courseId);
    console.log(`[course default-trainer] ${user.id} set course ${courseId} default trainer → ${trainer?.email ?? 'none'}`);

    // Optionally bring the existing upcoming, trainer-less runs in line.
    const applied: { course_run_id: string; start_date: string; tpg: string; calendar: string; error?: string }[] = [];
    if (trainer && (req.body?.applyToUpcoming === true || req.body?.applyToUpcoming === 'true')) {
      const runs = await listUnassignedUpcomingRuns(courseId);
      for (const run of runs) {
        try {
          const r = await assignTrainerToRun({
            runUuid: run.id,
            emailNorm: trainer.email.toLowerCase(),
            notes: 'course default trainer',
          });
          // Pre-agreed trainer: no invitation needed, the class is confirmed.
          await pool.query(
            `UPDATE course_run SET class_status = 'Confirmed', updated_at = NOW()
              WHERE id = $1 AND class_status IN ('Pending', 'Unconfirmed')`, [run.id]
          );
          applied.push({ course_run_id: run.course_run_id, start_date: run.start_date, tpg: r.tpg?.status ?? 'unknown', calendar: r.calendar?.status ?? 'unknown' });
        } catch (e: any) {
          applied.push({ course_run_id: run.course_run_id, start_date: run.start_date, tpg: 'error', calendar: 'error', error: e?.message || 'failed' });
        }
      }
    }

    return res.status(200).json({ success: true, trainer, applied });
  } catch (err: any) {
    console.error('[course default-trainer] failed:', err?.message);
    return res.status(500).json({ success: false, error: err?.message || 'Internal server error' });
  }
}

export default withAuth(handler, { roles: ['admin', 'trainingProvider', 'developer'] });
