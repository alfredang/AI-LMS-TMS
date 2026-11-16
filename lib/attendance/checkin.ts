import pool from '../db';
import { enrolLearner } from '../learner/selfEnrolment';
import { ensureEnrolmentDetailRequestTable } from '../learner/enrolmentDetailRequest';
import { labelSessions, sgtNow, toIsoDate } from './sessionLabel';

// Take Attendance QR (E-Attendance page → session tabs). One QR per session: it encodes
// /checkin/<token>, where <token> is a random value stored on that course_session row, so the
// link cannot be guessed and marks THAT session only. The public check-in form needs no login:
//  - a learner already on the class (SSG enrolment, local enrolment or enrolment request) is found
//    by email, by name, or — from their second session — by phone number alone;
//  - anyone else is registered on the class (account + Confirmed enrolment, same routine as
//    self-registration) on their first check-in and can then sign in with an email code.
// Check-in writes course_attendance — the same rows as Manual Attendance Taking — keyed by NRIC
// when we know it (so it lands on the learner's SSG row), else by _uid_<user id>.
// It never touches SSG e-attendance: learners still scan the SSG QR for that.

let ensured: Promise<void> | null = null;
export function ensureCheckinColumn(): Promise<void> {
  if (!ensured) {
    ensured = pool.query(`
      ALTER TABLE course_session ADD COLUMN IF NOT EXISTS checkin_token text;
      CREATE UNIQUE INDEX IF NOT EXISTS course_session_checkin_token_uidx
        ON course_session (checkin_token) WHERE checkin_token IS NOT NULL;
    `).then(() => undefined).catch((err) => { ensured = null; throw err; });
  }
  return ensured;
}

export const CHECKIN_TOKEN_RE = /^[0-9a-f]{32}$/;

/** The session's check-in token, created on first use. Null when the session does not exist. */
export async function getSessionCheckinToken(sessionId: string): Promise<{ token: string; courseRunId: string } | null> {
  await ensureCheckinColumn();
  const r = await pool.query<{ checkin_token: string; course_run_id: string }>(
    `UPDATE course_session
        SET checkin_token = COALESCE(checkin_token, replace(gen_random_uuid()::text, '-', ''))
      WHERE id = $1
      RETURNING checkin_token, course_run_id`,
    [sessionId]
  );
  const row = r.rows[0];
  return row ? { token: row.checkin_token, courseRunId: row.course_run_id } : null;
}

export type CheckinStatus = 'open' | 'not_yet' | 'closed';

export interface CheckinContext {
  sessionId: string;
  runUuid: string;
  runCode: string;
  courseId: string;
  title: string;
  courseCode: string | null;
  runStart: string | null;
  runEnd: string | null;
  sessionLabel: string;
  sessionDate: string; // YYYY-MM-DD or ''
  status: CheckinStatus;
}

const addDays = (iso: string, n: number) => {
  const [y, m, d] = iso.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d + n));
  return dt.toISOString().slice(0, 10);
};

/** The session behind a check-in token, or null for an unknown/removed session or class. */
export async function loadCheckinContext(token: string): Promise<CheckinContext | null> {
  if (!CHECKIN_TOKEN_RE.test(token)) return null;
  await ensureCheckinColumn();
  const row = (await pool.query(
    `SELECT s.id AS session_id, s.course_run_id, s.start_date, s.start_time, s.end_time,
            cr.course_run_id AS run_code, cr.course_id, cr.start_date::text AS run_start, cr.end_date::text AS run_end,
            c.title, COALESCE(NULLIF(c.new_course_code, ''), c.course_code) AS course_code
       FROM course_session s
       JOIN course_run cr ON cr.id = s.course_run_id
       JOIN course c ON c.id = cr.course_id
      WHERE s.checkin_token = $1
        AND COALESCE(s.deleted, false) = false
        AND COALESCE(cr.is_deleted, false) = false
        AND cr.class_status IS DISTINCT FROM 'Cancelled'`,
    [token]
  )).rows[0];
  if (!row) return null;

  const siblings = (await pool.query(
    `SELECT id, start_date, start_time, end_time FROM course_session
      WHERE course_run_id = $1 AND COALESCE(deleted, false) = false`,
    [row.course_run_id]
  )).rows;
  const me = labelSessions(siblings).find(s => s.id === row.session_id);

  const today = sgtNow().date;
  const sessionDate = toIsoDate(row.start_date);
  const lastDay = [toIsoDate(row.run_end), sessionDate].filter(Boolean).sort().pop() || '';
  let status: CheckinStatus = 'open';
  if (sessionDate && sessionDate > today) status = 'not_yet';
  else if (lastDay && today > addDays(lastDay, 1)) status = 'closed';

  return {
    sessionId: row.session_id,
    runUuid: row.course_run_id,
    runCode: String(row.run_code || '').trim(),
    courseId: row.course_id,
    title: row.title,
    courseCode: row.course_code || null,
    runStart: row.run_start,
    runEnd: row.run_end,
    sessionLabel: me?.label || '',
    sessionDate,
    status,
  };
}

interface RosterPerson {
  nric: string | null;
  name: string;
  email: string | null;
  phones: string[];
  userId: string | null;
}

const digitsOf = (v: unknown) => String(v ?? '').replace(/\D+/g, '');
const normName = (v: unknown) => String(v ?? '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

/** Everyone on the class: SSG enrolments, local enrolments and enrolment requests, merged per person. */
async function loadRoster(runUuid: string, runCode: string): Promise<RosterPerson[]> {
  await ensureEnrolmentDetailRequestTable();
  const rows = (await pool.query(
    `SELECT UPPER(NULLIF(TRIM(se.trainee_nric), '')) AS nric, se.trainee_name AS name,
            LOWER(NULLIF(TRIM(COALESCE(se.raw_data->'trainee'->'email'->>'full', se.raw_data->'trainee'->>'email')), '')) AS email,
            COALESCE(se.raw_data->'trainee'->'contactNumber'->>'phoneNumber',
                     se.raw_data->'trainee'->'contactNumber'->>'mobile',
                     CASE WHEN jsonb_typeof(se.raw_data->'trainee'->'contactNumber') = 'string'
                          THEN se.raw_data->'trainee'->>'contactNumber' END) AS phone,
            NULL::uuid AS user_id, 1 AS src
       FROM ssg_enrolments se
      WHERE se.course_run_id = $2 AND $2 <> ''
        AND LOWER(COALESCE(se.enrolment_status, '')) NOT IN ('cancelled', 'withdrawn', 'rejected')
     UNION ALL
     SELECT UPPER(COALESCE(NULLIF(TRIM(e.nric), ''), NULLIF(TRIM(lp.nric), ''))), au.full_name,
            LOWER(COALESCE(NULLIF(TRIM(e.email), ''), au.email)), lp.tel, e.user_id, 2
       FROM enrollment e
       JOIN app_user au ON au.id = e.user_id
       LEFT JOIN learner_profile lp ON lp.user_id = e.user_id
      WHERE e.course_run_id = $1
        AND LOWER(COALESCE(e.enrolment_status, '')) NOT IN ('admin removed', 'cancelled', 'withdrawn')
     UNION ALL
     SELECT UPPER(r.nric), r.trainee_name, LOWER(r.email), r.contact_number, r.user_id, 3
       FROM enrolment_detail_request r
      WHERE r.course_run_uuid = $1 AND r.status <> 'dismissed'
      ORDER BY 6`,
    [runUuid, runCode]
  )).rows as Array<{ nric: string | null; name: string | null; email: string | null; phone: string | null; user_id: string | null }>;

  // Merge rows that share an NRIC or an email into one person.
  const people: RosterPerson[] = [];
  for (const r of rows) {
    const p = people.find(x => (r.nric && x.nric === r.nric) || (r.email && x.email === r.email));
    const phone = digitsOf(r.phone);
    if (p) {
      p.nric = p.nric || r.nric;
      p.email = p.email || r.email;
      p.userId = p.userId || r.user_id;
      p.name = p.name || String(r.name || '');
      if (phone.length >= 8 && !p.phones.includes(phone)) p.phones.push(phone);
    } else {
      people.push({
        nric: r.nric, name: String(r.name || '').trim(), email: r.email, userId: r.user_id,
        phones: phone.length >= 8 ? [phone] : [],
      });
    }
  }
  return people;
}

const phoneMatches = (a: string, b: string) =>
  a === b || (a.length >= 8 && b.length >= 8 && (a.endsWith(b) || b.endsWith(a)));

/** The one person on the class with this phone number (null when nobody, or more than one, matches). */
function findByPhone(roster: RosterPerson[], phone: string): RosterPerson | null {
  const d = digitsOf(phone);
  if (d.length < 8) return null;
  const hits = roster.filter(p => p.phones.some(x => phoneMatches(x, d)));
  return hits.length === 1 ? hits[0] : null;
}

export function maskEmail(email: string | null): string {
  if (!email) return '';
  const [local, domain = ''] = email.split('@');
  return `${local.slice(0, 2)}${'*'.repeat(Math.min(6, Math.max(3, local.length - 2)))}@${domain}`;
}

/** Phone lookup for the form: the learner's name and masked email, never the full email. */
export async function lookupByPhone(ctx: CheckinContext, phone: string): Promise<{ found: false } | { found: true; name: string; email: string }> {
  const p = findByPhone(await loadRoster(ctx.runUuid, ctx.runCode), phone);
  return p ? { found: true, name: p.name, email: maskEmail(p.email) } : { found: false };
}

export interface CheckinResult {
  ok: boolean;
  message: string;
  name?: string;
  registered?: boolean;
  already?: boolean;
  /** Masked: shown on the success page so the learner knows which email signs them in. */
  email?: string;
  byPhone?: boolean;
}

export async function publicCheckIn(
  ctx: CheckinContext,
  input: { name: string; email: string; phone: string }
): Promise<CheckinResult> {
  if (ctx.status === 'not_yet') return { ok: false, message: 'Check-in for this session is not open yet.' };
  if (ctx.status === 'closed') return { ok: false, message: 'Check-in for this class has closed. Please speak to your trainer.' };

  const roster = await loadRoster(ctx.runUuid, ctx.runCode);
  const email = input.email.trim().toLowerCase();
  const phone = digitsOf(input.phone);
  let byPhone = false;

  let person: RosterPerson | null = null;
  if (email) {
    person = roster.find(p => p.email === email) || null;
  } else if (phone) {
    person = findByPhone(roster, phone);
    byPhone = !!person;
    if (!person) return { ok: false, message: 'We could not find you by phone number. Please enter your name and email.' };
  }
  if (!person && input.name) {
    // Same person, different email than on the enrolment: match a unique exact name on the class.
    const n = normName(input.name);
    const hits = n.length >= 3 ? roster.filter(p => normName(p.name) === n) : [];
    if (hits.length === 1) person = hits[0];
  }

  let registered = false;
  let userId: string | null = person?.userId || null;
  let nric: string | null = person?.nric || null;
  let name = person?.name || input.name.trim();

  if (!person) {
    const result = await enrolLearner({
      fullName: name,
      email,
      run: { id: ctx.runUuid, course_id: ctx.courseId, course_run_id: ctx.runCode, start_date: ctx.runStart, end_date: ctx.runEnd, title: ctx.title },
      source: 'attendance-checkin',
    });
    if (result.outcome === 'account_inactive') return { ok: false, message: 'Your account is inactive. Please speak to your trainer.' };
    if (result.outcome === 'enrolment_withdrawn') return { ok: false, message: 'You are no longer on this class. Please speak to your trainer.' };
    registered = result.outcome === 'enrolled';
    userId = result.userId;
    const lp = (await pool.query(
      `SELECT NULLIF(TRIM(lp.nric), '') AS nric, au.full_name
         FROM app_user au LEFT JOIN learner_profile lp ON lp.user_id = au.id WHERE au.id = $1`,
      [userId]
    )).rows[0];
    nric = lp?.nric ? String(lp.nric).toUpperCase() : null;
    name = lp?.full_name || name;
  } else if (!userId && nric) {
    userId = (await pool.query(`SELECT user_id FROM learner_profile WHERE UPPER(nric) = $1 LIMIT 1`, [nric])).rows[0]?.user_id || null;
  }

  const key = nric || (userId ? `_uid_${userId}` : null);
  if (!key) return { ok: false, message: 'Check-in failed. Please ask your trainer.' };

  const prev = (await pool.query(
    `SELECT is_present FROM course_attendance WHERE session_id = $1 AND nric = $2`,
    [ctx.sessionId, key]
  )).rows[0];
  await pool.query(
    `INSERT INTO course_attendance (session_id, nric, user_id, is_present, reason_of_absence, updated_at)
     VALUES ($1, $2, $3, true, NULL, NOW())
     ON CONFLICT (session_id, nric) DO UPDATE SET
       is_present = true, reason_of_absence = NULL,
       user_id = COALESCE(EXCLUDED.user_id, course_attendance.user_id), updated_at = NOW()`,
    [ctx.sessionId, key, userId]
  );

  // Remember the phone number so the next session needs it alone (never overwrite a saved one).
  if (userId && phone.length >= 8) {
    await pool.query(
      `INSERT INTO learner_profile (user_id, tel) VALUES ($1, $2)
       ON CONFLICT (user_id) DO UPDATE SET tel = COALESCE(NULLIF(learner_profile.tel, ''), EXCLUDED.tel)`,
      [userId, phone]
    ).catch((e) => console.warn('[checkin] phone save failed:', e?.message));
  }

  const already = prev?.is_present === true;
  return {
    ok: true,
    message: already ? 'You are already checked in for this session.' : 'You are checked in.',
    name,
    registered,
    already,
    email: maskEmail(person?.email || email || null),
    byPhone,
  };
}
