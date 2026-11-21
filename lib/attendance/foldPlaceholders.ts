/**
 * One attendance row per learner per session.
 *
 * A learner with no NRIC on file (self-enrolled at the start of class, or added by
 * hand with name + email) gets an attendance row keyed `_uid_<userId>`. Once the
 * NRIC is known, SSG e-attendance arrives on a second row keyed by that NRIC, so
 * Manual Attendance showed the learner twice: present on the SSG row and still
 * absent on the placeholder.
 *
 * This folds each placeholder into the learner's NRIC row:
 *   1. an NRIC row exists for the same learner (same account, or the NRIC on their
 *      profile or on their enrolment in this run) → it takes "present" if either row
 *      has it, and the placeholder is deleted;
 *   2. no NRIC row yet but the profile now has an NRIC → the placeholder is re-keyed
 *      to the NRIC (keeps what the trainer marked), so SSG e-attendance lands on it.
 *
 * Idempotent. Pass userId to limit it to one learner.
 */
interface Queryable {
  query: (text: string, params?: any[]) => Promise<{ rowCount: number | null }>;
}

export async function foldUidPlaceholders(db: Queryable, sessionId: string, userId?: string | null): Promise<number> {
  const params: any[] = [sessionId];
  let onlyUser = '';
  if (userId) {
    params.push(userId);
    onlyUser = 'AND p.user_id = $2';
  }

  const merged = await db.query(
    `WITH dup AS (
       SELECT DISTINCT ON (p.id)
              p.id AS placeholder_id, r.id AS row_id, p.user_id, p.is_present, p.reason_of_absence
         FROM course_attendance p
         LEFT JOIN learner_profile lp ON lp.user_id = p.user_id
         JOIN course_attendance r
           ON r.session_id = p.session_id
          AND r.id <> p.id
          AND LEFT(r.nric, 5) <> '_uid_'
          AND (r.user_id = p.user_id
               OR (COALESCE(TRIM(lp.nric), '') <> '' AND UPPER(r.nric) = UPPER(TRIM(lp.nric)))
               -- the NRIC may be on the learner's enrolment in this run only (no profile NRIC)
               OR EXISTS (SELECT 1 FROM course_session cs
                            JOIN enrollment e ON e.course_run_id = cs.course_run_id
                           WHERE cs.id = p.session_id AND e.user_id = p.user_id
                             AND COALESCE(TRIM(e.nric), '') <> '' AND UPPER(r.nric) = UPPER(TRIM(e.nric))))
        WHERE p.session_id = $1
          AND p.user_id IS NOT NULL
          AND p.nric = '_uid_' || p.user_id::text
          ${onlyUser}
        ORDER BY p.id, r.is_present DESC
     ), upd AS (
       UPDATE course_attendance r
          SET is_present = r.is_present OR dup.is_present,
              reason_of_absence = CASE WHEN r.is_present OR dup.is_present THEN NULL
                                       ELSE COALESCE(r.reason_of_absence, dup.reason_of_absence) END,
              user_id = COALESCE(r.user_id, dup.user_id),
              updated_at = NOW()
         FROM dup
        WHERE r.id = dup.row_id
     )
     DELETE FROM course_attendance p USING dup WHERE p.id = dup.placeholder_id`,
    params
  );

  const rekeyed = await db.query(
    `UPDATE course_attendance p
        SET nric = TRIM(lp.nric), updated_at = NOW()
       FROM learner_profile lp
      WHERE p.session_id = $1
        AND lp.user_id = p.user_id
        AND p.nric = '_uid_' || p.user_id::text
        AND COALESCE(TRIM(lp.nric), '') <> ''
        ${onlyUser}
        AND NOT EXISTS (
          SELECT 1 FROM course_attendance x
           WHERE x.session_id = p.session_id AND UPPER(x.nric) = UPPER(TRIM(lp.nric))
        )`,
    params
  );

  return (merged.rowCount || 0) + (rekeyed.rowCount || 0);
}
