/**
 * Link an SSG e-attendance record to the learner's LMS account.
 *
 * SSG e-attendance is keyed by NRIC. A learner who self-registered at the start of
 * class has no NRIC on file, so their attendance row is the placeholder
 * `_uid_<userId>` and the SSG row (no account) is a second row for the same person:
 * Manual Attendance then shows them absent on one row and present on the other, and
 * the totals stop matching SSG.
 *
 * resolveSsgAttendee finds the account for an SSG record with no profile NRIC match:
 *   0. by the NRIC on the learner's enrolment in this run;
 *   1. by email, among the run's enrolments and this session's placeholder rows
 *      (then the NRIC is saved on the profile, so every later session links by NRIC);
 *   2. by name, among this session's placeholder rows, only when exactly one fits.
 * The caller saves the SSG row with that user_id; foldUidPlaceholders then merges
 * the placeholder into it.
 */
interface Queryable {
  query: (text: string, params?: any[]) => Promise<{ rows: any[]; rowCount: number | null }>;
}

const nameTokens = (name: unknown): string[] =>
  String(name ?? '')
    .toUpperCase()
    .replace(/\b(S\/O|D\/O|BIN|BINTE|BTE|BT)\b/g, ' ')
    .replace(/[^A-Z\s]/g, ' ')
    .split(/\s+/)
    .filter(t => t.length > 1);

/**
 * Same person by name: every word of the shorter name is in the longer one, and at
 * least two words match ("Peter Loh Hoe Kwong" = "LOH HOE KWONG";
 * "Achim Ludwig Dietzenbach" = "DIETZENBACH ACHIM LUDWIG"; "Stanley Teo" ≠ "TEO YEU MIN").
 */
export function namesMatch(a: unknown, b: unknown): boolean {
  const ta = new Set(nameTokens(a));
  const tb = new Set(nameTokens(b));
  if (ta.size < 2 || tb.size < 2) return false;
  const [small, big] = ta.size <= tb.size ? [ta, tb] : [tb, ta];
  for (const t of small) if (!big.has(t)) return false;
  return true;
}

export async function resolveSsgAttendee(
  db: Queryable,
  sessionId: string,
  nric: string,
  email?: string | null,
  fullName?: string | null,
): Promise<string | null> {
  // The learner's enrolment in this run carries the NRIC (their profile may not)
  const byEnrolment = await db.query(
    `SELECT DISTINCT e.user_id
       FROM course_session cs
       JOIN enrollment e ON e.course_run_id = cs.course_run_id
      WHERE cs.id = $1 AND e.user_id IS NOT NULL
        AND UPPER(TRIM(e.nric)) = UPPER($2)
      LIMIT 2`,
    [sessionId, nric]
  );
  if (byEnrolment.rows.length === 1) return byEnrolment.rows[0].user_id;

  const mail = String(email ?? '').trim().toLowerCase();

  if (mail) {
    const byEmail = await db.query(
      `SELECT u.user_id FROM (
         SELECT e.user_id
           FROM course_session cs
           JOIN enrollment e ON e.course_run_id = cs.course_run_id
           LEFT JOIN app_user au ON au.id = e.user_id
          WHERE cs.id = $1 AND e.user_id IS NOT NULL
            AND (LOWER(au.email) = $2 OR LOWER(e.email) = $2)
         UNION
         SELECT ca.user_id
           FROM course_attendance ca
           JOIN app_user au ON au.id = ca.user_id
          WHERE ca.session_id = $1 AND ca.nric = '_uid_' || ca.user_id::text
            AND LOWER(au.email) = $2
       ) u LIMIT 2`,
      [sessionId, mail]
    );
    if (byEmail.rows.length === 1) {
      const userId: string = byEmail.rows[0].user_id;
      // Save the NRIC on the profile (when empty and not someone else's) so later sessions link by NRIC
      await db.query(
        `UPDATE learner_profile lp SET nric = $2
          WHERE lp.user_id = $1 AND COALESCE(TRIM(lp.nric), '') = ''
            AND NOT EXISTS (SELECT 1 FROM learner_profile x WHERE UPPER(x.nric) = UPPER($2))`,
        [userId, nric]
      );
      return userId;
    }
  }

  if (fullName) {
    const placeholders = await db.query(
      `SELECT ca.user_id, au.full_name
         FROM course_attendance ca
         JOIN app_user au ON au.id = ca.user_id
        WHERE ca.session_id = $1 AND ca.nric = '_uid_' || ca.user_id::text`,
      [sessionId]
    );
    const fits = placeholders.rows.filter(p => namesMatch(p.full_name, fullName));
    if (fits.length === 1) return fits[0].user_id;
  }

  return null;
}
