import pool from '../db';
import { enrolLearner } from './selfEnrolment';

// Enrolment-details requests: a learner with no SSG/TPGateway enrolment for a class scans the
// class's enrolment QR code (shown by the trainer on the E-Attendance page) and submits their
// details on the public /enrol/[runId] page. Admins and the class's trainers review the
// requests on the E-Attendance page and enrol the learner on TPGateway.
// A request is keyed by class + NRIC; it is linked to a local enrolment only when staff act on it.
// Twin of database/migrations/add_enrolment_detail_request.sql.

export type SponsorshipChoice = 'Individual' | 'Employer';
export type RequestStatus = 'submitted' | 'enrolled' | 'failed' | 'dismissed';

export interface EnrolmentDetailsInput {
  traineeName: string;
  nric: string;
  contactNumber: string;
  email: string;
  dateOfBirth: string; // YYYY-MM-DD
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
    sponsorshipType: clean(body?.sponsorshipType) === 'Employer' ? 'Employer' : 'Individual',
  };

  if (data.traineeName.length < 2) errors.traineeName = 'Enter your full name as in your NRIC/FIN.';
  if (!NRIC_RE.test(data.nric)) errors.nric = 'Enter a valid NRIC/FIN, e.g. S1234567A.';
  // Local numbers are 8 digits; allow a +65 prefix to be typed.
  if (data.contactNumber.length === 10 && data.contactNumber.startsWith('65')) data.contactNumber = data.contactNumber.slice(2);
  if (!/^[3689]\d{7}$/.test(data.contactNumber)) errors.contactNumber = 'Enter an 8-digit Singapore number.';
  if (!EMAIL_RE.test(data.email)) errors.email = 'Enter a valid email address.';

  const dob = /^\d{4}-\d{2}-\d{2}$/.test(data.dateOfBirth) ? new Date(`${data.dateOfBirth}T00:00:00Z`) : null;
  if (!dob || isNaN(dob.getTime())) {
    errors.dateOfBirth = 'Enter your date of birth.';
  } else {
    const age = (Date.now() - dob.getTime()) / (365.25 * 24 * 3600 * 1000);
    if (age < 13 || age > 100) errors.dateOfBirth = 'Check your date of birth.';
  }

  if (data.sponsorshipType === 'Employer') {
    data.employerName = clean(body?.employerName);
    data.employerUen = clean(body?.employerUen).toUpperCase();
    data.employerContactName = clean(body?.employerContactName);
    data.employerContactEmail = clean(body?.employerContactEmail).toLowerCase();
    data.employerContactNumber = digits(body?.employerContactNumber);
    if (data.employerContactNumber.length === 10 && data.employerContactNumber.startsWith('65')) {
      data.employerContactNumber = data.employerContactNumber.slice(2);
    }
    if (data.employerName.length < 2) errors.employerName = 'Enter the company name.';
    if (!UEN_RE.test(data.employerUen)) errors.employerUen = 'Enter the company UEN, e.g. 201200696W.';
    if (data.employerContactName.length < 2) errors.employerContactName = 'Enter the company contact person (e.g. HR).';
    if (!EMAIL_RE.test(data.employerContactEmail)) errors.employerContactEmail = 'Enter a valid email address.';
    if (!/^[3689]\d{7}$/.test(data.employerContactNumber)) errors.employerContactNumber = 'Enter an 8-digit Singapore number.';
  }

  return Object.keys(errors).length ? { ok: false, errors } : { ok: true, data };
}

export const NRIC_PATTERN = NRIC_RE;

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

/**
 * The local enrolment a request belongs to. Matches an active enrolment on the class by NRIC;
 * with `create`, otherwise finds or creates the learner's account by email and enrols them on
 * the class (same routine as self-registration). Links the request to it and fills blanks in
 * the learner's profile. Refuses when the email belongs to an account with a different NRIC
 * (e.g. a shared HR mailbox), so one learner's enrolment ref never lands on another's record.
 */
export async function resolveLocalEnrolment(
  reqRow: any, { create }: { create: boolean }
): Promise<{ ok: true; enrollmentUuid: string; userId: string } | { ok: false; error: string }> {
  const find = async () => (await pool.query<{ id: string; user_id: string }>(
    `SELECT e.id, e.user_id
       FROM enrollment e LEFT JOIN learner_profile lp ON lp.user_id = e.user_id
      WHERE e.course_run_id = $1
        AND (e.id = $3 OR UPPER(COALESCE(NULLIF(e.nric, ''), lp.nric, '')) = $2)
        AND LOWER(COALESCE(e.enrolment_status, '')) NOT IN ('admin removed', 'cancelled', 'withdrawn')
      ORDER BY (e.id = $3) DESC LIMIT 1`,
    [reqRow.course_run_uuid, reqRow.nric, reqRow.enrollment_uuid || null]
  )).rows[0];

  let hit = await find();
  if (!hit) {
    if (!create) return { ok: false, error: 'No local enrolment for this learner on the class' };
    const clash = (await pool.query<{ nric: string | null }>(
      `SELECT NULLIF(lp.nric, '') AS nric
         FROM app_user au LEFT JOIN learner_profile lp ON lp.user_id = au.id
        WHERE LOWER(au.email) = $1 OR LOWER(au.secondary_email) = $1 LIMIT 1`,
      [reqRow.email]
    )).rows[0];
    if (clash?.nric && clash.nric.toUpperCase() !== reqRow.nric) {
      return { ok: false, error: `The email ${reqRow.email} already belongs to another learner (different NRIC). Ask the learner for their own email, or enrol on the TPGateway portal and use Enter Ref.` };
    }
    const run = await getEnrolmentRunContext(reqRow.course_run_uuid);
    if (!run) return { ok: false, error: 'Class not found' };
    const result = await enrolLearner({ fullName: reqRow.trainee_name, email: reqRow.email, run, source: 'enrolment-request' });
    if (result.outcome === 'account_inactive') return { ok: false, error: "The learner's account is inactive. Reactivate it first." };
    if (result.outcome === 'enrolment_withdrawn') return { ok: false, error: "The learner's enrolment on this class was withdrawn or removed. Restore it first." };
    const e = (await pool.query<{ id: string; user_id: string }>(
      `SELECT id, user_id FROM enrollment WHERE user_id = $1 AND course_run_id = $2 LIMIT 1`,
      [result.userId, reqRow.course_run_uuid]
    )).rows[0];
    if (!e) return { ok: false, error: 'Could not create the local enrolment' };
    hit = e;
  }

  await pool.query(`UPDATE enrolment_detail_request SET enrollment_uuid = $2, user_id = $3 WHERE id = $1`, [reqRow.id, hit.id, hit.user_id]);
  // Fill blanks in the learner's profile (never overwrite what is already there).
  await pool.query(
    `INSERT INTO learner_profile (user_id, tel, nric, dob) VALUES ($1, $2, $3, $4::date)
     ON CONFLICT (user_id) DO UPDATE SET
       tel  = COALESCE(NULLIF(learner_profile.tel, ''), EXCLUDED.tel),
       nric = COALESCE(NULLIF(learner_profile.nric, ''), EXCLUDED.nric),
       dob  = COALESCE(learner_profile.dob, EXCLUDED.dob)`,
    [hit.user_id, reqRow.contact_number, reqRow.nric, reqRow.date_of_birth]
  ).catch((e) => console.warn('[enrolment-request] profile backfill failed:', e?.message));
  return { ok: true, enrollmentUuid: hit.id, userId: hit.user_id };
}

/** Column list for request reads — DOB as text so it never shifts through a JS Date. */
export const REQUEST_COLUMNS = `id, enrollment_uuid, user_id, course_run_uuid, trainee_name, nric, contact_number, email,
  date_of_birth::text AS date_of_birth, sponsorship_type, employer_name, employer_uen, employer_contact_name,
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
