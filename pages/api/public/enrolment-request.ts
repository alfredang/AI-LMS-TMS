import type { NextApiRequest, NextApiResponse } from 'next';
import pool from '../../../lib/db';
import { limited } from '../../../lib/android/auth';
import {
  ensureEnrolmentDetailRequestTable, getEnrolmentRunContext, findEnrolmentRefByNric, validateEnrolmentDetails, NRIC_PATTERN,
  isEnrolledByName, resolveLocalEnrolment, REQUEST_COLUMNS,
} from '../../../lib/learner/enrolmentDetailRequest';
import { maskEmail } from '../../../lib/attendance/checkin';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * PUBLIC: the /enrol/[runId] page a learner reaches by scanning the class's SWDA Enrolment QR code
 * (class page → SWDA Enrolment, or the E-Attendance page). The link carries the class's
 * unguessable UUID.
 *
 * GET  ?run=                                     → the class shown on the form
 * POST { run, action: 'check', nric, traineeName } → { enrolled, enrolmentRef?, pending? } — enrolled
 *                                                   when the NRIC or the exact name is on the class's
 *                                                   SWDA enrolments
 * POST { run, action: 'submit', ...details }     → store the learner's details for staff to enrol on
 *                                                   TPGateway, and register the learner on the class
 *                                                   (account + local enrolment) so they can sign in
 *                                                   with an email code. A learner already on SWDA is
 *                                                   registered on the class too (nothing goes to staff).
 *                                                   Submitting again with another email moves an unused
 *                                                   registration to that email.
 *
 * Never returns anyone's stored personal details: a check answers only "enrolled" (with the ref
 * only for a matching NRIC) or "not yet". Nothing is sent to SSG — staff review the requests and
 * enrol the learner from the E-Attendance page. Rate limited per IP (generous: a class shares the
 * venue Wi-Fi) and per NRIC.
 */
function clientIp(req: NextApiRequest): string {
  const fwd = req.headers['x-forwarded-for'];
  const first = (Array.isArray(fwd) ? fwd[0] : fwd || '').split(',')[0].trim();
  return first || req.socket?.remoteAddress || 'unknown';
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const runUuid = String((req.method === 'GET' ? req.query.run : req.body?.run) || '').trim();
  if (!UUID_RE.test(runUuid)) return res.status(400).json({ success: false, error: 'This enrolment link is not valid.' });

  try {
    const run = await getEnrolmentRunContext(runUuid);
    if (!run) return res.status(404).json({ success: false, error: 'This enrolment link is not valid.' });

    if (req.method === 'GET') {
      return res.status(200).json({
        success: true,
        available: run.open && run.ssgEnrolable,
        course: { title: run.title, code: run.course_code, courseRunId: run.course_run_id, startDate: run.start_date, endDate: run.end_date },
      });
    }
    if (req.method !== 'POST') return res.status(405).json({ success: false, error: 'Method not allowed' });
    if (!run.open || !run.ssgEnrolable) {
      return res.status(409).json({ success: false, error: 'This class is not open for enrolment requests.' });
    }

    const action = String(req.body?.action || '');
    if (await limited(`enrol-request:ip:${clientIp(req)}`, 200, 60)) {
      res.setHeader('Retry-After', '3600');
      return res.status(429).json({ success: false, error: 'Too many attempts. Please try again later or ask your trainer.' });
    }
    await ensureEnrolmentDetailRequestTable();

    if (action === 'check') {
      const nric = String(req.body?.nric || '').trim().toUpperCase();
      if (!NRIC_PATTERN.test(nric)) {
        return res.status(400).json({ success: false, error: 'Enter a valid NRIC/FIN, e.g. S1234567A.' });
      }
      const ref = await findEnrolmentRefByNric(run.id, nric);
      if (ref) return res.status(200).json({ success: true, enrolled: true, enrolmentRef: ref });
      const traineeName = String(req.body?.traineeName || '').trim();
      if (traineeName && (await isEnrolledByName(run.id, traineeName))) {
        return res.status(200).json({ success: true, enrolled: true, enrolmentRef: null });
      }
      const pending = (await pool.query(
        `SELECT 1 FROM enrolment_detail_request WHERE course_run_uuid = $1 AND nric = $2 AND status IN ('submitted', 'failed')`,
        [run.id, nric]
      )).rows.length > 0;
      return res.status(200).json({ success: true, enrolled: false, pending });
    }

    if (action !== 'submit') return res.status(400).json({ success: false, error: 'Unknown action' });

    const v = validateEnrolmentDetails(req.body);
    if (!v.ok) return res.status(400).json({ success: false, error: 'Please correct the highlighted fields.', fieldErrors: v.errors });
    const d = v.data;
    if (await limited(`enrol-request:nric:${run.id}:${d.nric}`, 10, 60)) {
      res.setHeader('Retry-After', '3600');
      return res.status(429).json({ success: false, error: 'Too many attempts. Please ask your trainer.' });
    }

    // Class registration (account + local enrolment) so the learner can sign in with an email code
    // and see the class. `signIn` tells the page which email does that: the one just typed, or
    // (masked) the email of the account that already holds this learner's place on the class.
    const register = async (row: any, opts: { matchName?: boolean } = {}) => {
      try {
        const local = await resolveLocalEnrolment(row, { create: true, ...opts });
        if (!local.ok) {
          console.warn('[public enrolment-request] class registration skipped:', local.error);
          // Only the generic reason reaches the page: the detailed one names another account.
          return { registered: false, local: null, signIn: { registrationIssue: 'We could not set up your sign-in with this email. Your trainer will help you.' } };
        }
        const typed = local.signInEmail === d.email;
        return { registered: true, local, signIn: { signInWithThisEmail: typed, email: typed ? d.email : maskEmail(local.signInEmail) } };
      } catch (e: any) {
        console.error('[public enrolment-request] class registration failed:', e?.message);
        return { registered: false, local: null, signIn: {} };
      }
    };

    // Already enrolled on SWDA: nothing goes to staff, but the learner is still registered on the
    // class here, so the email they use opens it.
    const ref = await findEnrolmentRefByNric(run.id, d.nric);
    const enrolledByName = !ref && (await isEnrolledByName(run.id, d.traineeName));
    if (ref || enrolledByName) {
      const r = await register(
        { course_run_uuid: run.id, nric: d.nric, email: d.email, trainee_name: d.traineeName, contact_number: d.contactNumber, date_of_birth: d.dateOfBirth },
        { matchName: true }
      );
      if (r.local && ref) {
        // Keep the SWDA ref with the class registration (never replaces one already there).
        await pool.query(
          `UPDATE enrollment SET enrolment_id = $1, nric = COALESCE(NULLIF(nric, ''), $3), updated_at = NOW()
            WHERE id = $2 AND NULLIF(TRIM(enrolment_id), '') IS NULL`,
          [ref, r.local.enrollmentUuid, d.nric]
        ).catch((e) => console.warn('[public enrolment-request] could not store the ref:', e?.message));
      }
      return res.status(200).json({ success: true, enrolled: true, enrolmentRef: ref || null, registered: r.registered, ...r.signIn });
    }

    const employer = d.sponsorshipType === 'Employer';
    const saved = await pool.query(
      `INSERT INTO enrolment_detail_request
         (course_run_uuid, trainee_name, nric, contact_number, email, date_of_birth,
          sponsorship_type, employer_name, employer_uen, employer_contact_name, employer_contact_email, employer_contact_number,
          nationality)
       VALUES ($1, $2, $3, $4, $5, $6::date, $7, $8, $9, $10, $11, $12, $13)
       ON CONFLICT (course_run_uuid, nric) DO UPDATE SET
         trainee_name = EXCLUDED.trainee_name, contact_number = EXCLUDED.contact_number,
         email = EXCLUDED.email, date_of_birth = EXCLUDED.date_of_birth, sponsorship_type = EXCLUDED.sponsorship_type,
         nationality = EXCLUDED.nationality,
         employer_name = EXCLUDED.employer_name, employer_uen = EXCLUDED.employer_uen,
         employer_contact_name = EXCLUDED.employer_contact_name, employer_contact_email = EXCLUDED.employer_contact_email,
         employer_contact_number = EXCLUDED.employer_contact_number,
         status = 'submitted', last_error = NULL, updated_at = NOW()
       WHERE enrolment_detail_request.status <> 'enrolled'
       RETURNING ${REQUEST_COLUMNS}`,
      [
        run.id, d.traineeName, d.nric, d.contactNumber, d.email, d.dateOfBirth, d.sponsorshipType,
        // Company UEN and contact details are optional on the form: blank is stored as NULL.
        employer ? d.employerName : null, (employer && d.employerUen) || null, (employer && d.employerContactName) || null,
        (employer && d.employerContactEmail) || null, (employer && d.employerContactNumber) || null,
        d.nationality,
      ]
    );

    // Register the learner on this class straight away. The SWDA enrolment itself is still done
    // by staff on TPGateway.
    const row = saved.rows[0];
    const r = row ? await register(row) : { registered: false, signIn: {} };
    return res.status(200).json({ success: true, enrolled: false, submitted: true, registered: r.registered, ...r.signIn });
  } catch (err: any) {
    console.error('[public enrolment-request] failed:', err?.message);
    return res.status(500).json({ success: false, error: 'Something went wrong. Please try again.' });
  }
}
