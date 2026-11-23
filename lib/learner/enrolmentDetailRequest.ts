import pool from '../db';
import { enrolLearner } from './selfEnrolment';
import { NATIONALITY_OPTIONS } from './nationality';

// Enrolment-details requests: a learner with no SSG/TPGateway enrolment for a class scans the
// class's enrolment QR code (shown by the trainer on the E-Attendance page) and submits their
// details on the public /enrol/[runId] page (QR on the class page → SWDA Enrolment, and on the
// E-Attendance page). Admins and the class's trainers review the requests on the E-Attendance page
// and enrol the learner on TPGateway.
// A request is keyed by class + NRIC. On submit the learner is also registered on the class
// (account + local enrolment, linked to the request) so they can sign in with an email code.
// Twin of database/migrations/add_enrolment_detail_request.sql.

export type SponsorshipChoice = 'Individual' | 'Employer';
export type RequestStatus = 'submitted' | 'enrolled' | 'failed' | 'dismissed';

export interface EnrolmentDetailsInput {
  traineeName: string;
  nric: string;
  contactNumber: string;
  email: string;
  dateOfBirth: string; // YYYY-MM-DD
  nationality: string;
  sponsorshipType: SponsorshipChoice;
  employerName?: string;
  employerUen?: string;
  employerContactName?: string;
  employerContactEmail?: string;
  employerContactNumber?: string;
}

let ensured: Promise<void> | null = null;
export function ensureEnrolmentDetailRequestTable(): Promise<void> {
  if (!ensured) {
    ensured = pool.query(`
      CREATE TABLE IF NOT EXISTS enrolment_detail_request (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        enrollment_uuid UUID,
        user_id UUID,
        course_run_uuid UUID NOT NULL,
        trainee_name TEXT NOT NULL,
        nric TEXT NOT NULL,
        contact_number TEXT NOT NULL,
        email TEXT NOT NULL,
        date_of_birth DATE NOT NULL,
        sponsorship_type TEXT NOT NULL CHECK (sponsorship_type IN ('Individual', 'Employer')),
        employer_name TEXT,
        employer_uen TEXT,
        employer_contact_name TEXT,
        employer_contact_email TEXT,
        employer_contact_number TEXT,
        status TEXT NOT NULL DEFAULT 'submitted' CHECK (status IN ('submitted', 'enrolled', 'failed', 'dismissed')),
        enrolment_ref TEXT,
        last_error TEXT,
        submitted_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        processed_at TIMESTAMPTZ,
        processed_by UUID,
        UNIQUE (course_run_uuid, nric)
      );
      CREATE INDEX IF NOT EXISTS enrolment_detail_request_run_idx ON enrolment_detail_request (course_run_uuid, status);
      ALTER TABLE enrolment_detail_request ADD COLUMN IF NOT EXISTS nationality TEXT;
    `).then(() => undefined).catch((err) => { ensured = null; throw err; });
  }
  return ensured;
}

const NRIC_RE = /^[STFGM]\d{7}[A-Z]$/;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const UEN_RE = /^[0-9A-Z]{9,10}$/;

const clean = (v: unknown) => String(v ?? '').trim();
const digits = (v: unknown) => String(v ?? '').replace(/\D/g, '');

/** Normalise + validate a submission. Returns the cleaned input or a list of field errors. */
export function validateEnrolmentDetails(body: any): { ok: true; data: EnrolmentDetailsInput } | { ok: false; errors: Record<string, string> } {
  const errors: Record<string, string> = {};
  const data: EnrolmentDetailsInput = {
    traineeName: clean(body?.traineeName).replace(/\s+/g, ' '),
    nric: clean(body?.nric).toUpperCase(),
    contactNumber: digits(body?.contactNumber),
    email: clean(body?.email).toLowerCase(),
    dateOfBirth: clean(body?.dateOfBirth),
    nationality: clean(body?.nationality).replace(/\s+/g, ' ').slice(0, 60),
    sponsorshipType: clean(body?.sponsorshipType) === 'Employer' ? 'Employer' : 'Individual',
  };

  if (data.traineeName.length < 2) errors.traineeName = 'Enter your full name as in your NRIC/FIN.';
  if (!NRIC_RE.test(data.nric)) errors.nric = 'Enter a valid NRIC/FIN, e.g. S1234567A.';
  // Local numbers are 8 digits; allow a +65 prefix to be typed.
  if (data.contactNumber.length === 10 && data.contactNumber.startsWith('65')) data.contactNumber = data.contactNumber.slice(2);
  if (!/^[3689]\d{7}$/.test(data.contactNumber)) errors.contactNumber = 'Enter an 8-digit Singapore number.';
  if (!EMAIL_RE.test(data.email)) errors.email = 'Enter a valid email address.';
  if (!(NATIONALITY_OPTIONS as readonly string[]).includes(data.nationality)) {
    errors.nationality = 'Select Singapore Citizen, Singapore PR or Foreigner.';
  }

  const dob = /^\d{4}-\d{2}-\d{2}$/.test(data.dateOfBirth) ? new Date(`${data.dateOfBirth}T00:00:00Z`) : null;
  if (!dob || isNaN(dob.getTime())) {
    errors.dateOfBirth = 'Enter your date of birth.';
  } else {
    const age = (Date.now() - dob.getTime()) / (365.25 * 24 * 3600 * 1000);
    if (age < 13 || age > 100) errors.dateOfBirth = 'Check your date of birth.';
  }

  if (data.sponsorshipType === 'Employer') {
    Object.assign(data, cleanEmployerDetails(body));
    // Only the company name is required: learners often do not know the UEN or the HR contact.
    // Staff add what is missing (Enrolment Requests → Edit company) before enrolling on TPGateway.
    Object.assign(errors, employerDetailErrors(data, { requireAll: false }));
  }

  return Object.keys(errors).length ? { ok: false, errors } : { ok: true, data };
}

export const NRIC_PATTERN = NRIC_RE;

export interface EmployerDetails {
  employerName?: string | null;
  employerUen?: string | null;
  employerContactName?: string | null;
  employerContactEmail?: string | null;
  employerContactNumber?: string | null;
}

/**
 * Field errors for the company details of a company-sponsored request. A value that is filled in
 * must be valid; with `requireAll` (what TPGateway needs) a blank UEN or contact detail is an error too.
 */
export function employerDetailErrors(d: EmployerDetails, { requireAll }: { requireAll: boolean }): Record<string, string> {
  const errors: Record<string, string> = {};
  const name = clean(d.employerName), uen = clean(d.employerUen), contact = clean(d.employerContactName);
  const email = clean(d.employerContactEmail), phone = clean(d.employerContactNumber);
  if (name.length < 2) errors.employerName = 'Enter the company name.';
  if (uen ? !UEN_RE.test(uen) : requireAll) errors.employerUen = 'Enter the company UEN, e.g. 201200696W.';
  if (contact ? contact.length < 2 : requireAll) errors.employerContactName = 'Enter the company contact person (e.g. HR).';
  if (email ? !EMAIL_RE.test(email) : requireAll) errors.employerContactEmail = 'Enter a valid email address.';
  if (phone ? !/^[3689]\d{7}$/.test(phone) : requireAll) errors.employerContactNumber = 'Enter an 8-digit Singapore number.';
  return errors;
}

/** Normalise company details typed by a learner or by staff (blank stays blank). */
export function cleanEmployerDetails(body: any): Required<{ [K in keyof EmployerDetails]: string }> {
  let phone = digits(body?.employerContactNumber);
  if (phone.length === 10 && phone.startsWith('65')) phone = phone.slice(2);
  return {
    employerName: clean(body?.employerName).replace(/\s+/g, ' ').slice(0, 200),
    employerUen: clean(body?.employerUen).toUpperCase(),
    employerContactName: clean(body?.employerContactName).replace(/\s+/g, ' ').slice(0, 200),
    employerContactEmail: clean(body?.employerContactEmail).toLowerCase(),
    employerContactNumber: phone,
  };
}

/** The company details TPGateway needs that a company-sponsored request does not have yet. */
export function missingEmployerDetails(row: any): string[] {
  if (row?.sponsorship_type !== 'Employer') return [];
  const missing: string[] = [];
  if (!clean(row.employer_uen)) missing.push('company UEN');
  if (!clean(row.employer_contact_name)) missing.push('contact person');
  if (!clean(row.employer_contact_email)) missing.push('contact email');
  if (!clean(row.employer_contact_number)) missing.push('contact number');
  return missing;
}

export interface EnrolmentRunContext {
  id: string;
  course_id: string;
  course_run_id: string;
  start_date: string | null;
  end_date: string | null;
  title: string;
  course_code: string | null;
  /** False for Non-WSQ courses: they have no SSG enrolment, so no form. */
  ssgEnrolable: boolean;
  /** Class is live: not deleted or cancelled, from 14 days before it starts to 30 days after it ends. */
  open: boolean;
}

/** The class behind an enrolment QR link (course_run.id). */
export async function getEnrolmentRunContext(courseRunUuid: string): Promise<EnrolmentRunContext | null> {
  const row = (await pool.query(
    `SELECT cr.id, cr.course_id, cr.course_run_id, cr.start_date::text AS start_date, cr.end_date::text AS end_date,
            c.title, c.course_code, c.course_type::text AS course_type,
            (COALESCE(cr.is_deleted, false) = false
              AND cr.class_status IS DISTINCT FROM 'Cancelled'
              AND (cr.start_date IS NULL OR (NOW() AT TIME ZONE 'Asia/Singapore')::date >= cr.start_date - 14)
              AND (cr.end_date IS NULL OR (NOW() AT TIME ZONE 'Asia/Singapore')::date <= cr.end_date + 30)) AS open
       FROM course_run cr JOIN course c ON c.id = cr.course_id
      WHERE cr.id = $1`,
    [courseRunUuid]
  )).rows[0];
  if (!row) return null;
  return {
    id: row.id, course_id: row.course_id, course_run_id: row.course_run_id,
    start_date: row.start_date, end_date: row.end_date, title: row.title, course_code: row.course_code,
    ssgEnrolable: String(row.course_type || '').toLowerCase() !== 'non-wsq',
    open: !!row.open,
  };
}

/**
 * The SSG enrolment ref this NRIC already has for the class, if any: from the SSG enrolments
 * imported for the run, from a local enrolment that carries a ref, or from a request staff
 * already completed.
 */
export async function findEnrolmentRefByNric(courseRunUuid: string, nric: string): Promise<string | null> {
  const r = await pool.query<{ ref: string | null }>(
    `SELECT COALESCE(
       (SELECT se.enrolment_id
          FROM ssg_enrolments se JOIN course_run cr ON cr.course_run_id = se.course_run_id
         WHERE cr.id = $1 AND UPPER(se.trainee_nric) = $2 AND NULLIF(TRIM(se.enrolment_id), '') IS NOT NULL
           AND LOWER(COALESCE(se.enrolment_status, '')) NOT IN ('cancelled', 'withdrawn', 'rejected')
         ORDER BY se.enrolment_date DESC NULLS LAST LIMIT 1),
       (SELECT TRIM(e.enrolment_id)
          FROM enrollment e LEFT JOIN learner_profile lp ON lp.user_id = e.user_id
         WHERE e.course_run_id = $1 AND NULLIF(TRIM(e.enrolment_id), '') IS NOT NULL
           AND UPPER(COALESCE(NULLIF(e.nric, ''), lp.nric, '')) = $2
           AND LOWER(COALESCE(e.enrolment_status, '')) NOT IN ('admin removed', 'cancelled', 'withdrawn')
         LIMIT 1),
       (SELECT r.enrolment_ref FROM enrolment_detail_request r
         WHERE r.course_run_uuid = $1 AND r.nric = $2 AND r.status = 'enrolled' LIMIT 1)
     ) AS ref`,
    [courseRunUuid, nric.toUpperCase()]
  );
  return r.rows[0]?.ref || null;
}

const normName = (v: unknown) => String(v ?? '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

/**
 * Is a learner with exactly this name (as in NRIC, case and punctuation ignored) already enrolled on
 * SWDA/TPGateway for the class? Only enrolments that carry an SSG enrolment ref count — a local
 * self-registration is not an SWDA enrolment.
 */
export async function isEnrolledByName(courseRunUuid: string, traineeName: string): Promise<boolean> {
  const n = normName(traineeName);
  if (n.length < 3) return false;
  const rows = (await pool.query<{ name: string | null }>(
    `SELECT se.trainee_name AS name
       FROM ssg_enrolments se JOIN course_run cr ON cr.course_run_id = se.course_run_id
      WHERE cr.id = $1 AND NULLIF(TRIM(se.enrolment_id), '') IS NOT NULL
        AND LOWER(COALESCE(se.enrolment_status, '')) NOT IN ('cancelled', 'withdrawn', 'rejected')
     UNION ALL
     SELECT COALESCE(NULLIF(e.raw_data->'trainee'->>'fullName', ''), au.full_name)
       FROM enrollment e JOIN app_user au ON au.id = e.user_id
      WHERE e.course_run_id = $1 AND NULLIF(TRIM(e.enrolment_id), '') IS NOT NULL
        AND LOWER(COALESCE(e.enrolment_status, '')) NOT IN ('admin removed', 'cancelled', 'withdrawn')`,
    [courseRunUuid]
  )).rows;
  return rows.some(r => normName(r.name) === n);
}

const INACTIVE_ENROLMENT_SQL = `('admin removed', 'cancelled', 'withdrawn')`;

type LocalHit = { id: string; user_id: string };

const answersTo = (acct: { email: string | null; secondary_email: string | null } | undefined, email: string) =>
  !!acct && [acct.email, acct.secondary_email].some(e => String(e || '').toLowerCase() === email);

/**
 * A learner whose class registration sits on an account that does not answer to the email they
 * now give (they submitted the form again with another email): move the registration so that
 * email signs in to the class. Only for a registration this form created and nobody has used —
 * no SWDA enrolment ref on it, a learner-only account with no other class and no live session.
 * Anything else stays where it is (an account with history is never handed to an email typed
 * into a public form) and the learner is told which email to sign in with.
 */
async function moveRegistrationToEmail(hit: LocalHit, courseRunUuid: string, email: string): Promise<LocalHit> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const cur = (await client.query(
      `SELECT (e.raw_data->>'source' = 'enrolment-request' AND NULLIF(TRIM(e.enrolment_id), '') IS NULL
               AND NOT EXISTS (SELECT 1 FROM enrollment o WHERE o.user_id = e.user_id AND o.id <> e.id)
               AND NOT EXISTS (SELECT 1 FROM user_role_map m WHERE m.user_id = e.user_id AND m.role::text <> 'Learner')
               AND NOT EXISTS (SELECT 1 FROM user_session s WHERE s.user_id = e.user_id)) AS movable
         FROM enrollment e WHERE e.id = $1 FOR UPDATE`,
      [hit.id]
    )).rows[0];
    if (!cur?.movable) { await client.query('ROLLBACK'); return hit; }

    const owner = (await client.query<{ id: string; active: boolean }>(
      `SELECT id, COALESCE(LOWER(account_status), 'active') = 'active' AS active
         FROM app_user WHERE LOWER(email) = $1 OR LOWER(secondary_email) = $1 LIMIT 1`,
      [email]
    )).rows[0];

    if (!owner) {
      // Nobody has this email: the unused account simply takes it (a corrected typo).
      await client.query(`UPDATE app_user SET email = $2, updated_at = NOW() WHERE id = $1`, [hit.user_id, email]);
      await client.query(`UPDATE enrollment SET email = $2, updated_at = NOW() WHERE id = $1`, [hit.id, email]);
      await client.query('COMMIT');
      return hit;
    }
    if (!owner.active) { await client.query('ROLLBACK'); return hit; }

    // The email already has an account (e.g. made when the learner signed in with it and saw no class).
    const theirs = (await client.query<{ id: string; active: boolean }>(
      `SELECT id, LOWER(COALESCE(enrolment_status, '')) NOT IN ${INACTIVE_ENROLMENT_SQL} AS active
         FROM enrollment WHERE user_id = $1 AND course_run_id = $2 LIMIT 1`,
      [owner.id, courseRunUuid]
    )).rows[0];
    if (theirs && !theirs.active) { await client.query('ROLLBACK'); return hit; }

    let moved: LocalHit;
    if (theirs) {
      // Already on the class with that account: keep it and retire the unused duplicate.
      await client.query(`UPDATE enrollment SET enrolment_status = 'Withdrawn', updated_at = NOW() WHERE id = $1`, [hit.id]);
      moved = { id: theirs.id, user_id: owner.id };
    } else {
      await client.query(`UPDATE enrollment SET user_id = $2, email = $3, updated_at = NOW() WHERE id = $1`, [hit.id, owner.id, email]);
      // Attendance rows follow the learner (keeps anything the trainer already marked).
      await client.query(
        `UPDATE course_attendance SET user_id = $2, nric = CASE WHEN nric = $4 THEN $5 ELSE nric END, updated_at = NOW()
          WHERE user_id = $1 AND session_id IN (SELECT id FROM course_session WHERE course_run_id = $3)`,
        [hit.user_id, owner.id, courseRunUuid, `_uid_${hit.user_id}`, `_uid_${owner.id}`]
      );
      await client.query(`INSERT INTO user_role_map (user_id, role) VALUES ($1, 'Learner') ON CONFLICT DO NOTHING`, [owner.id]);
      moved = { id: hit.id, user_id: owner.id };
    }
    await client.query(`UPDATE app_user SET courses_updated_at = NOW() WHERE id = ANY($1::uuid[])`, [[hit.user_id, owner.id]]);
    await client.query('COMMIT');
    return moved;
  } catch (e: any) {
    await client.query('ROLLBACK').catch(() => {});
    console.warn('[enrolment-request] could not move the class registration:', e?.message);
    return hit;
  } finally {
    client.release();
  }
}

export type LocalEnrolmentResult =
  | { ok: true; enrollmentUuid: string; userId: string; /** The email that signs in to this class registration. */ signInEmail: string }
  | { ok: false; error: string };

/**
 * The local enrolment a request belongs to. Matches an active enrolment on the class by NRIC
 * (or, with `matchName`, by exact name); with `create`, otherwise finds or creates the learner's
 * account by email and enrols them on the class (same routine as self-registration). Links the
 * request to it (when the row is a stored request) and fills blanks in the learner's profile.
 * Refuses when the email belongs to an account with a different NRIC (e.g. a shared HR mailbox),
 * so one learner's enrolment ref never lands on another's record.
 *
 * `signInEmail` is the email the learner must use to see the class: the one on the request when
 * the account answers to it, otherwise the account's own email.
 */
export async function resolveLocalEnrolment(
  reqRow: any, { create, matchName = false }: { create: boolean; matchName?: boolean }
): Promise<LocalEnrolmentResult> {
  const email = String(reqRow.email || '').toLowerCase();
  const find = async () => (await pool.query<LocalHit>(
    `SELECT e.id, e.user_id
       FROM enrollment e LEFT JOIN learner_profile lp ON lp.user_id = e.user_id
      WHERE e.course_run_id = $1
        AND (e.id = $3 OR UPPER(COALESCE(NULLIF(e.nric, ''), lp.nric, '')) = $2)
        AND LOWER(COALESCE(e.enrolment_status, '')) NOT IN ${INACTIVE_ENROLMENT_SQL}
      ORDER BY (e.id = $3) DESC LIMIT 1`,
    [reqRow.course_run_uuid, reqRow.nric, reqRow.enrollment_uuid || null]
  )).rows[0];
  const findByName = async () => {
    const n = normName(reqRow.trainee_name);
    if (n.length < 3) return undefined;
    const rows = (await pool.query<LocalHit & { name: string | null }>(
      `SELECT e.id, e.user_id, COALESCE(NULLIF(e.raw_data->'trainee'->>'fullName', ''), au.full_name) AS name
         FROM enrollment e JOIN app_user au ON au.id = e.user_id
        WHERE e.course_run_id = $1 AND LOWER(COALESCE(e.enrolment_status, '')) NOT IN ${INACTIVE_ENROLMENT_SQL}`,
      [reqRow.course_run_uuid]
    )).rows.filter(r => normName(r.name) === n);
    return rows.length === 1 ? { id: rows[0].id, user_id: rows[0].user_id } : undefined;
  };
  const account = async (userId: string) => (await pool.query<{ email: string | null; secondary_email: string | null }>(
    `SELECT email, secondary_email FROM app_user WHERE id = $1`, [userId]
  )).rows[0];

  let hit = (await find()) || (matchName ? await findByName() : undefined);
  if (hit && create && email && !answersTo(await account(hit.user_id), email)) {
    hit = await moveRegistrationToEmail(hit, reqRow.course_run_uuid, email);
  }
  if (!hit) {
    if (!create) return { ok: false, error: 'No local enrolment for this learner on the class' };
    const clash = (await pool.query<{ nric: string | null }>(
      `SELECT NULLIF(lp.nric, '') AS nric
         FROM app_user au LEFT JOIN learner_profile lp ON lp.user_id = au.id
        WHERE LOWER(au.email) = $1 OR LOWER(au.secondary_email) = $1 LIMIT 1`,
      [email]
    )).rows[0];
    if (clash?.nric && clash.nric.toUpperCase() !== reqRow.nric) {
      return { ok: false, error: `The email ${reqRow.email} already belongs to another learner (different NRIC). Ask the learner for their own email, or enrol on the TPGateway portal and use Enter Ref.` };
    }
    const run = await getEnrolmentRunContext(reqRow.course_run_uuid);
    if (!run) return { ok: false, error: 'Class not found' };
    const result = await enrolLearner({ fullName: reqRow.trainee_name, email, run, source: 'enrolment-request' });
    if (result.outcome === 'account_inactive') return { ok: false, error: "The learner's account is inactive. Reactivate it first." };
    if (result.outcome === 'enrolment_withdrawn') return { ok: false, error: "The learner's enrolment on this class was withdrawn or removed. Restore it first." };
    const e = (await pool.query<LocalHit>(
      `SELECT id, user_id FROM enrollment WHERE user_id = $1 AND course_run_id = $2 LIMIT 1`,
      [result.userId, reqRow.course_run_uuid]
    )).rows[0];
    if (!e) return { ok: false, error: 'Could not create the local enrolment' };
    hit = e;
  }

  if (reqRow.id) {
    await pool.query(`UPDATE enrolment_detail_request SET enrollment_uuid = $2, user_id = $3 WHERE id = $1`, [reqRow.id, hit.id, hit.user_id]);
  }
  // Fill blanks in the learner's profile (never overwrite what is already there).
  await pool.query(
    `INSERT INTO learner_profile (user_id, tel, nric, dob) VALUES ($1, $2, $3, $4::date)
     ON CONFLICT (user_id) DO UPDATE SET
       tel  = COALESCE(NULLIF(learner_profile.tel, ''), EXCLUDED.tel),
       nric = COALESCE(NULLIF(learner_profile.nric, ''), EXCLUDED.nric),
       dob  = COALESCE(learner_profile.dob, EXCLUDED.dob)`,
    [hit.user_id, reqRow.contact_number, reqRow.nric, reqRow.date_of_birth]
  ).catch((e) => console.warn('[enrolment-request] profile backfill failed:', e?.message));
  const acct = await account(hit.user_id);
  return { ok: true, enrollmentUuid: hit.id, userId: hit.user_id, signInEmail: answersTo(acct, email) ? email : String(acct?.email || '') };
}

/** Column list for request reads — DOB as text so it never shifts through a JS Date. */
export const REQUEST_COLUMNS = `id, enrollment_uuid, user_id, course_run_uuid, trainee_name, nric, contact_number, email,
  date_of_birth::text AS date_of_birth, nationality, sponsorship_type, employer_name, employer_uen, employer_contact_name,
  employer_contact_email, employer_contact_number, status, enrolment_ref, last_error, submitted_at, updated_at, processed_at`;

/** API shape of one request row (camelCase). */
export function mapRequestRow(row: any) {
  return {
    id: row.id,
    enrollmentUuid: row.enrollment_uuid,
    userId: row.user_id,
    courseRunUuid: row.course_run_uuid,
    traineeName: row.trainee_name,
    nric: row.nric,
    contactNumber: row.contact_number,
    email: row.email,
    dateOfBirth: row.date_of_birth || '',
    nationality: row.nationality || '',
    sponsorshipType: row.sponsorship_type,
    employerName: row.employer_name,
    employerUen: row.employer_uen,
    employerContactName: row.employer_contact_name,
    employerContactEmail: row.employer_contact_email,
    employerContactNumber: row.employer_contact_number,
    status: row.status as RequestStatus,
    enrolmentRef: row.enrolment_ref,
    lastError: row.last_error,
    submittedAt: row.submitted_at,
    updatedAt: row.updated_at,
    processedAt: row.processed_at,
  };
}
