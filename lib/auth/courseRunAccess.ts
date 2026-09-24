import type { NextApiResponse } from 'next';
import pool from '../db';
import type { AuthedUser } from './requireRole';

/**
 * Trainer-mode authorization for class (course_run) data.
 *
 * A user can hold Trainer and Learner at once (trainers who enrol in our
 * courses). Holding the Trainer role must not open up every class: a trainer
 * may only view/publish/grade a class they are assigned to. Anyone with a
 * back-office role (admin, trainingProvider, developer, finance, payroll) or a
 * machine key is unrestricted, as before.
 */

const NON_STAFF_ROLES = new Set(['trainer', 'learner']);

export function isStaff(user: AuthedUser): boolean {
  if (user.isService) return true;
  for (const r of user.roles) if (!NON_STAFF_ROLES.has(r)) return true;
  return false;
}

/** Lower-cased login + secondary + additional emails of a user. */
export async function getUserEmails(userId: string): Promise<string[]> {
  const r = await pool.query(
    `SELECT LOWER(TRIM(e)) AS email
       FROM app_user au,
            unnest(ARRAY[au.email, au.secondary_email] || COALESCE(au.additional_emails, '{}')) AS e
      WHERE au.id = $1 AND e IS NOT NULL AND TRIM(e) <> ''`,
    [userId]
  );
  return r.rows.map((row: { email: string }) => row.email);
}

/**
 * Is `userId` an assigned trainer of the course run? Checks the canonical
 * course_run_trainer junction and the legacy scalar columns, by id or email
 * (some runs synced from TPG carry only the trainer's email).
 */
export async function isAssignedTrainer(userId: string, courseRunId: string): Promise<boolean> {
  const r = await pool.query(
    `WITH me AS (
       SELECT LOWER(TRIM(e)) AS email
         FROM app_user au,
              unnest(ARRAY[au.email, au.secondary_email] || COALESCE(au.additional_emails, '{}')) AS e
        WHERE au.id = $1 AND e IS NOT NULL AND TRIM(e) <> ''
     )
     SELECT 1
       FROM course_run cr
      WHERE cr.id::text = $2
        AND (
          cr.assigned_trainer_id = $1
          OR cr.tpg_assigned_trainer_id = $1
          OR LOWER(TRIM(cr.assigned_trainer_email)) IN (SELECT email FROM me)
          OR LOWER(TRIM(cr.tpg_assigned_trainer_email)) IN (SELECT email FROM me)
          OR EXISTS (
            SELECT 1 FROM course_run_trainer crt
             WHERE crt.course_run_id = cr.id
               AND (crt.trainer_id = $1 OR LOWER(TRIM(crt.trainer_email)) IN (SELECT email FROM me))
          )
        )
      LIMIT 1`,
    [userId, courseRunId]
  );
  return (r.rowCount ?? 0) > 0;
}

/**
 * Guard for trainer-mode actions on one class. Returns true when allowed;
 * otherwise writes 403 and returns false.
 */
export async function requireCourseRunTrainer(
  user: AuthedUser,
  res: NextApiResponse,
  courseRunId: string
): Promise<boolean> {
  if (isStaff(user)) return true;
  if (user.roles.has('trainer') && (await isAssignedTrainer(user.id, courseRunId))) return true;
  res.status(403).json({ success: false, error: 'You are not an assigned trainer of this class' });
  return false;
}

/**
 * Trainer-scoped list endpoints take the trainer's id/email from the query
 * string. Staff may look up any trainer; a trainer may only look up themself.
 */
export async function requireSelfTrainer(
  user: AuthedUser,
  res: NextApiResponse,
  requested: { id?: string; email?: string }
): Promise<boolean> {
  if (isStaff(user)) return true;
  let ok = true;
  if (requested.id !== undefined && requested.id !== user.id) ok = false;
  if (ok && requested.email !== undefined) {
    const emails = await getUserEmails(user.id);
    ok = emails.includes(requested.email.trim().toLowerCase());
  }
  if (!ok) res.status(403).json({ success: false, error: 'Forbidden' });
  return ok;
}
