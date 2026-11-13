import type { NextApiRequest, NextApiResponse } from 'next';
import pool from '../../../lib/db';
import { limited } from '../../../lib/android/auth';
import {
  ensureEnrolmentDetailRequestTable, getEnrolmentRunContext, findEnrolmentRefByNric, validateEnrolmentDetails, NRIC_PATTERN,
} from '../../../lib/learner/enrolmentDetailRequest';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * PUBLIC: the /enrol/[runId] page a learner reaches by scanning the class's enrolment QR code
 * (shown by the trainer on the E-Attendance page). The link carries the class's unguessable UUID.
 *
 * GET  ?run=                        → the class shown on the form
 * POST { run, action: 'check', nric } → { enrolled, enrolmentRef? , pending? }
 * POST { run, action: 'submit', ...details } → store the learner's details for staff to enrol
 *
 * Never returns anyone's stored personal details: a check answers only "enrolled, with this
 * ref" or "not yet". Submissions do not touch accounts, profiles or SSG — staff review them and
 * enrol the learner from the E-Attendance page. Rate limited per IP (generous: a class shares
 * the venue Wi-Fi) and per NRIC.
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

    const ref = await findEnrolmentRefByNric(run.id, d.nric);
    if (ref) return res.status(200).json({ success: true, enrolled: true, enrolmentRef: ref });

    const employer = d.sponsorshipType === 'Employer';
    await pool.query(
      `INSERT INTO enrolment_detail_request
         (course_run_uuid, trainee_name, nric, contact_number, email, date_of_birth,
          sponsorship_type, employer_name, employer_uen, employer_contact_name, employer_contact_email, employer_contact_number)
       VALUES ($1, $2, $3, $4, $5, $6::date, $7, $8, $9, $10, $11, $12)
       ON CONFLICT (course_run_uuid, nric) DO UPDATE SET
         trainee_name = EXCLUDED.trainee_name, contact_number = EXCLUDED.contact_number,
         email = EXCLUDED.email, date_of_birth = EXCLUDED.date_of_birth, sponsorship_type = EXCLUDED.sponsorship_type,
         employer_name = EXCLUDED.employer_name, employer_uen = EXCLUDED.employer_uen,
         employer_contact_name = EXCLUDED.employer_contact_name, employer_contact_email = EXCLUDED.employer_contact_email,
         employer_contact_number = EXCLUDED.employer_contact_number,
         status = 'submitted', last_error = NULL, updated_at = NOW()
       WHERE enrolment_detail_request.status <> 'enrolled'`,
      [
        run.id, d.traineeName, d.nric, d.contactNumber, d.email, d.dateOfBirth, d.sponsorshipType,
        employer ? d.employerName : null, employer ? d.employerUen : null, employer ? d.employerContactName : null,
        employer ? d.employerContactEmail : null, employer ? d.employerContactNumber : null,
      ]
    );
    return res.status(200).json({ success: true, enrolled: false, submitted: true });
  } catch (err: any) {
    console.error('[public enrolment-request] failed:', err?.message);
    return res.status(500).json({ success: false, error: 'Something went wrong. Please try again.' });
  }
}
