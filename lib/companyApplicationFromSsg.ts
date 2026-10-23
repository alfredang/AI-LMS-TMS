import pool from './db';
import { ensureCompanyApplicationsTable } from './companyApplicationsTable';

/**
 * Keep View Company Application complete for employer-sponsored learners who
 * were enrolled outside the Company Application upload — TPG Management's
 * manual form, its Excel bulk enrolment, or the TPGateway portal itself. Those
 * paths enrol in SSG but never wrote a company_application row, so admins saw
 * nothing on the tab (Chew Jia Long, run 1414902, Oct 2026).
 *
 * SAFETY — this only records learners SSG has already confirmed:
 *   - rows are created as auto_enrol_status = 'enroled', which no scheduler
 *     sweep picks up; grants, calendar, invoices and emails stay deliberate
 *     admin actions on the tab (same contract as synced-to-company-application);
 *   - an existing upload row for the same learner + run gets the SSG reference
 *     attached instead of a duplicate being added;
 *   - a row an admin archived (ca_cancelled_at) is never resurrected.
 */

type Candidate = {
  enrolment_id: string;
  course_title: string;
  course_start_date: string; // DD-MM-YYYY, as the upload stores it
  course_reference_number: string;
  course_run_id: string;
  trainee_full_name: string;
  trainee_id_type: string;
  trainee_nric: string;
  date_of_birth: string;
  trainee_email: string;
  trainee_phone: string;
  employer_org_name: string;
  employer_uen: string;
  employer_contact_name: string;
  employer_contact_email: string;
  employer_contact_phone: string;
};

const text = (v: unknown): string =>
  typeof v === 'string' || typeof v === 'number' ? String(v).trim() : '';

// SSG returns { email: { full } }; the payload we submit uses emailAddress.
const emailOf = (v: any): string => text(v?.email?.full) || text(v?.email) || text(v?.emailAddress);
const phoneOf = (v: any): string => text(v?.contactNumber?.phoneNumber);

// YYYY-MM-DD → DD-MM-YYYY; anything else is left as-is.
const toDdMmYyyy = (iso: string): string => {
  const m = iso.match(/^(\d{4})-(\d{2})-(\d{2})/);
  return m ? `${m[3]}-${m[2]}-${m[1]}` : iso;
};

/** Map an SSG enrolment (as returned by SSG, or as submitted to it) to a CA row. */
export function candidateFromSsgEnrolment(en: any, referenceNumber?: string): Candidate | null {
  const trainee = en?.trainee;
  const course = en?.course;
  const employer = trainee?.employer;
  const ref = (text(referenceNumber) || text(en?.referenceNumber)).toUpperCase();
  if (!/^ENR-\d{4}-\d{6}$/.test(ref)) return null;
  if (text(trainee?.sponsorshipType).toLowerCase() !== 'employer') return null;
  if (!text(employer?.uen) || !text(trainee?.id) || !text(course?.run?.id)) return null;

  return {
    enrolment_id: ref,
    course_title: text(course?.title),
    course_start_date: toDdMmYyyy(text(course?.run?.startDate)),
    course_reference_number: text(course?.referenceNumber),
    course_run_id: text(course.run.id),
    trainee_full_name: text(trainee?.fullName),
    trainee_id_type: text(trainee?.idType?.type),
    trainee_nric: text(trainee.id),
    date_of_birth: toDdMmYyyy(text(trainee?.dateOfBirth)),
    trainee_email: emailOf(trainee),
    trainee_phone: phoneOf(trainee),
    employer_org_name: text(employer?.name),
    employer_uen: text(employer.uen),
    employer_contact_name: text(employer?.contact?.fullName),
    employer_contact_email: emailOf(employer?.contact),
    employer_contact_phone: phoneOf(employer?.contact),
  };
}

const COLUMNS: Array<keyof Candidate> = [
  'enrolment_id', 'course_title', 'course_start_date', 'course_reference_number', 'course_run_id',
  'trainee_full_name', 'trainee_id_type', 'trainee_nric', 'date_of_birth', 'trainee_email', 'trainee_phone',
  'employer_org_name', 'employer_uen', 'employer_contact_name', 'employer_contact_email', 'employer_contact_phone',
];

// Fields worth back-filling on an existing row when it was left blank.
const FILLABLE: Array<keyof Candidate> = [
  'course_title', 'course_start_date', 'course_reference_number', 'employer_org_name',
  'employer_contact_name', 'employer_contact_email', 'employer_contact_phone',
];

async function upsertCandidates(candidates: Candidate[]): Promise<{ created: number; attached: number }> {
  if (candidates.length === 0) return { created: 0, attached: 0 };
  await ensureCompanyApplicationsTable();

  // One transaction under one advisory lock: the 3-hourly sweep and an
  // enrolment-time call can otherwise both decide "missing" for the same
  // learner and insert twice (the dedupe index skips rows with a blank date).
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(`SELECT pg_advisory_xact_lock(hashtext('company-application-from-ssg'))`);
    const result = await upsertCandidatesLocked(client, candidates);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

async function upsertCandidatesLocked(
  client: { query: (sql: string, params?: any[]) => Promise<any> },
  candidates: Candidate[]
): Promise<{ created: number; attached: number }> {
  const recordset = `jsonb_to_recordset($1::jsonb) AS c(${COLUMNS.map(col => `${col} text`).join(', ')})`;
  const params = [JSON.stringify(candidates)];

  // 1. An upload row for this learner that has no SSG reference yet: attach
  //    the reference (its pipeline will then skip the SSG enrol step). Match on
  //    the run, or — when the upload never got a run, e.g. it stopped as
  //    "Ambiguous course run" and staff enrolled the learner in TPG Management
  //    instead — on employer + start date. SSG's run is authoritative, and a
  //    row that failed only for want of an enrolment is now enroled.
  const attached = await client.query(
    `UPDATE public.company_application ca
        SET enrolment_id = c.enrolment_id,
            enrolment_status = 'Confirmed',
            course_run_id = c.course_run_id,
            course_reference_number = COALESCE(NULLIF(c.course_reference_number, ''), ca.course_reference_number),
            auto_enrol_status = CASE WHEN ca.auto_enrol_status = 'failed' THEN 'enroled' ELSE ca.auto_enrol_status END,
            auto_enrol_error = CASE WHEN ca.auto_enrol_status = 'failed' THEN NULL ELSE ca.auto_enrol_error END,
            updated_at = now()
       FROM ${recordset}
      WHERE ca.ca_cancelled_at IS NULL
        AND NULLIF(TRIM(ca.enrolment_id), '') IS NULL
        AND LOWER(TRIM(ca.trainee_nric)) = LOWER(c.trainee_nric)
        AND (TRIM(ca.course_run_id) = c.course_run_id
             OR (NULLIF(TRIM(ca.course_run_id), '') IS NULL
                 AND LOWER(TRIM(ca.employer_uen)) = LOWER(c.employer_uen)
                 AND TRIM(ca.course_start_date) = c.course_start_date
                 -- and the same course, so a learner on two courses that start
                 -- the same day is never linked to the other one's enrolment
                 AND (LOWER(TRIM(ca.course_title)) = LOWER(c.course_title)
                      OR UPPER(TRIM(ca.course_reference_number)) = UPPER(c.course_reference_number))))
        AND NOT EXISTS (SELECT 1 FROM public.company_application x
                         WHERE UPPER(TRIM(x.enrolment_id)) = c.enrolment_id)`,
    params
  );

  // 2. Fill blanks on rows that carry the reference (e.g. a row created from a
  //    TPG Management submission before SSG's full record had been synced).
  await client.query(
    `UPDATE public.company_application ca
        SET ${FILLABLE.map(col => `${col} = COALESCE(NULLIF(TRIM(ca.${col}), ''), NULLIF(c.${col}, ''))`).join(',\n            ')},
            updated_at = now()
       FROM ${recordset}
      WHERE UPPER(TRIM(ca.enrolment_id)) = c.enrolment_id
        AND ca.ca_cancelled_at IS NULL
        AND (${FILLABLE.map(col => `(NULLIF(TRIM(ca.${col}), '') IS NULL AND NULLIF(c.${col}, '') IS NOT NULL)`).join(' OR ')})`,
    params
  );

  // 3. Everyone else gets a new row. Skip anyone already on the tab — or
  //    archived from it — by reference or by learner + run.
  const inserted = await client.query(
    `INSERT INTO public.company_application
            (${COLUMNS.join(', ')}, enrolment_status, auto_enrol_status)
     SELECT ${COLUMNS.map(col => `NULLIF(c.${col}, '')`).join(', ')}, 'Confirmed', 'enroled'
       FROM ${recordset}
      WHERE NOT EXISTS (
              SELECT 1 FROM public.company_application ca
               WHERE UPPER(TRIM(ca.enrolment_id)) = c.enrolment_id
                  OR (LOWER(TRIM(ca.trainee_nric)) = LOWER(c.trainee_nric)
                      AND TRIM(ca.course_run_id) = c.course_run_id))
     ON CONFLICT DO NOTHING
     RETURNING id`,
    params
  );

  return { created: inserted.rowCount ?? 0, attached: attached.rowCount ?? 0 };
}

/**
 * Called right after /api/enrolment/create succeeds for an EMPLOYER learner, so
 * the learner shows on the tab immediately. The submitted payload has no
 * employer name, course title or start date; fill them from what the LMS
 * knows. Anything still blank is back-filled by the 3-hourly sweep below.
 */
export async function registerCompanyApplicationFromSubmission(
  submittedEnrolment: any,
  referenceNumber: string
): Promise<{ created: number; attached: number }> {
  const candidate = candidateFromSsgEnrolment(submittedEnrolment, referenceNumber);
  if (!candidate) return { created: 0, attached: 0 };

  const lookup = await pool.query(
    `SELECT
       (SELECT c.title FROM public.course_run cr JOIN public.course c ON c.id = cr.course_id
         WHERE cr.course_run_id = $1 AND COALESCE(cr.is_deleted, false) = false LIMIT 1) AS run_title,
       (SELECT to_char(cr.start_date, 'YYYY-MM-DD') FROM public.course_run cr
         WHERE cr.course_run_id = $1 AND COALESCE(cr.is_deleted, false) = false LIMIT 1) AS run_start,
       (SELECT c.title FROM public.course c WHERE UPPER(TRIM(c.course_code)) = UPPER(TRIM($2)) LIMIT 1) AS code_title,
       (SELECT ca.employer_org_name FROM public.company_application ca
         WHERE LOWER(TRIM(ca.employer_uen)) = LOWER(TRIM($3)) AND NULLIF(TRIM(ca.employer_org_name), '') IS NOT NULL
         ORDER BY ca.created_at DESC LIMIT 1) AS ca_employer,
       (SELECT r.raw_data #>> '{enrolment,trainee,employer,name}' FROM public.ssg_enrolment_record r
         WHERE LOWER(TRIM(r.raw_data #>> '{enrolment,trainee,employer,uen}')) = LOWER(TRIM($3))
           AND NULLIF(r.raw_data #>> '{enrolment,trainee,employer,name}', '') IS NOT NULL
         ORDER BY r.created_at DESC LIMIT 1) AS ssg_employer`,
    [candidate.course_run_id, candidate.course_reference_number, candidate.employer_uen]
  );
  const known = lookup.rows[0] || {};
  candidate.course_title ||= text(known.run_title) || text(known.code_title);
  candidate.course_start_date ||= toDdMmYyyy(text(known.run_start));
  candidate.employer_org_name ||= text(known.ca_employer) || text(known.ssg_employer);

  return upsertCandidates([candidate]);
}

/**
 * Sweep SSG's synced enrolment records for upcoming or ongoing, confirmed,
 * employer-sponsored learners who are missing from the tab. Covers every enrolment
 * path, including learners enrolled directly on the TPGateway portal.
 * Past classes are left alone — this is about the live workflow, not history.
 */
export async function syncCompanyApplicationsFromSsgRecords(): Promise<{ created: number; attached: number }> {
  const res = await pool.query(
    `SELECT r.enrolment_reference AS ref, r.raw_data -> 'enrolment' AS en
       FROM public.ssg_enrolment_record r
      WHERE r.status ILIKE 'confirmed%'
        AND LOWER(r.raw_data #>> '{enrolment,trainee,sponsorshipType}') = 'employer'
        -- Upcoming or still running (a class that started but has not ended).
        AND COALESCE(NULLIF(r.raw_data #>> '{enrolment,course,run,endDate}', '')::date,
                     r.start_date::date,
                     NULLIF(r.raw_data #>> '{enrolment,course,run,startDate}', '')::date)
            >= (now() AT TIME ZONE 'Asia/Singapore')::date
        -- ssg_enrolment_record is insert-only, so its status can be stale.
        -- Trust a later cancellation recorded anywhere else.
        AND NOT EXISTS (SELECT 1 FROM public.ssg_enrolments s
                         WHERE UPPER(TRIM(s.enrolment_id)) = UPPER(TRIM(r.enrolment_reference))
                           AND s.enrolment_status::text !~* '^confirmed')
        AND NOT EXISTS (SELECT 1 FROM public.enrollment e
                         WHERE UPPER(TRIM(e.enrolment_id)) = UPPER(TRIM(r.enrolment_reference))
                           AND e.enrolment_status::text ~* '(cancel|withdraw|reject)')
        AND NOT EXISTS (SELECT 1 FROM public.company_application ca
                         WHERE UPPER(TRIM(ca.enrolment_id)) = UPPER(TRIM(r.enrolment_reference))
                           AND ca.ca_cancelled_at IS NULL
                           AND NULLIF(TRIM(ca.employer_org_name), '') IS NOT NULL
                           AND NULLIF(TRIM(ca.course_start_date), '') IS NOT NULL)`
  );
  const candidates = res.rows
    .map(row => candidateFromSsgEnrolment(row.en, row.ref))
    .filter((c): c is Candidate => c !== null);
  return upsertCandidates(candidates);
}
