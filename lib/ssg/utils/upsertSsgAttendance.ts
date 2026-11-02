import pool from '../../db';
import { normalizeAttendanceRecord } from './attendance-decrypt';

/**
 * Upsert one SSG attendance record into course_attendance for a local session.
 *
 * The learner is resolved by NRIC (learner_profile), falling back to the learner
 * enrolled in this run whose email matches the SSG trainee email. Learners who
 * self-enrol at the start of class have no NRIC yet, so their attendance
 * placeholders are keyed `_uid_<userId>` (lib/learner/selfEnrolment.ts) and an
 * NRIC-only row would never link to them — the certificate job then scores them
 * 0% and skips them. On an email match the NRIC is backfilled onto the profile
 * and enrolment, and the placeholder row is replaced by the SSG row.
 *
 * Returns false when the record carries no NRIC.
 */
export async function upsertSsgAttendanceRecord(
  courseRunUuid: string,
  sessionUuid: string,
  att: any
): Promise<boolean> {
  const normalized = normalizeAttendanceRecord(att);
  if (!normalized) return false;
  const { nric, isPresent } = normalized;

  const userByNric = await pool.query(
    `SELECT au.id FROM app_user au
     JOIN learner_profile lp ON lp.user_id = au.id
     WHERE lp.nric = $1
     LIMIT 1`,
    [nric]
  );
  let userId: string | null = userByNric.rows[0]?.id || null;

  const email = (att?.trainee?.email || att?.email || '').toString().trim().toLowerCase();
  if (!userId && email) {
    const userByEmail = await pool.query(
      `SELECT e.user_id FROM enrollment e
       LEFT JOIN app_user au ON au.id = e.user_id
       WHERE e.course_run_id = $1
         AND e.user_id IS NOT NULL
         AND (LOWER(au.email) = $2 OR LOWER(e.email) = $2)
       LIMIT 1`,
      [courseRunUuid, email]
    );
    userId = userByEmail.rows[0]?.user_id || null;

    if (userId) {
      await pool.query(
        `UPDATE learner_profile SET nric = $2 WHERE user_id = $1 AND COALESCE(nric, '') = ''`,
        [userId, nric]
      );
      await pool.query(
        `UPDATE enrollment SET nric = $3, updated_at = NOW()
         WHERE course_run_id = $1 AND user_id = $2 AND COALESCE(nric, '') = ''`,
        [courseRunUuid, userId, nric]
      );
      await pool.query(
        `DELETE FROM course_attendance WHERE session_id = $1 AND nric = $2`,
        [sessionUuid, `_uid_${userId}`]
      );
    }
  }

  await pool.query(
    `INSERT INTO course_attendance (session_id, user_id, nric, is_present)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (session_id, nric) DO UPDATE SET
       is_present = EXCLUDED.is_present,
       user_id = COALESCE(EXCLUDED.user_id, course_attendance.user_id),
       updated_at = NOW()`,
    [sessionUuid, userId, nric, isPresent]
  );
  return true;
}
