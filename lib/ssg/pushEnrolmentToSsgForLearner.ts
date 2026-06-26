import pool from '../db';
import { getTrainingPartnerIdentifiers } from '../trainingPartnerIdentifiers';
import { buildEnrolmentPayload } from './buildEnrolmentPayload';
import { createEnrolmentOnSsg } from './mutateEnrolmentForLearner';
import { searchEnrolment } from './services/enrolment-service';
import { inferIdType } from '../utils/id-type';

export interface PushEnrolmentResult {
  // SSG mandates NRIC + dateOfBirth + contactNumber on create (TGS-441 otherwise), so a learner
  // missing any of them is skipped with a specific reason rather than firing a doomed SSG call.
  status: 'synced' | 'already_enrolled' | 'skipped_no_nric' | 'skipped_no_dob' | 'skipped_no_phone' | 'not_found' | 'error';
  message: string;
  enrolmentRef?: string;
  ssgStatus?: number;
}

/**
 * Push ONE locally-enrolled learner to SSG / TPGateway as a native enrolment (creates a TPG enrolment
 * via POST /tpg/enrolments and stores the returned `enrollment.enrolment_id`). Mirrors
 * pushTrainerToTpgForRun: opt-in / confirm-gated at the call site, skips when no NRIC (can't exist on
 * SSG), idempotent when already enrolled. NEVER throws — returns a status.
 *
 * The payload is assembled into the proven da_application shape and built with the shared
 * `buildEnrolmentPayload`, so it's identical to what the DA pipeline already sends to SSG.
 *
 * @param courseRunUuid course_run.id (the run UUID)
 * @param learner       identifies the learner's local enrolment: by userId and/or email
 */
export async function pushEnrolmentToSsgForLearner(
  courseRunUuid: string,
  learner: { userId?: string | null; email?: string | null }
): Promise<PushEnrolmentResult> {
  try {
    const row = (await pool.query<{
      enrolment_uuid: string; enrolment_id: string | null; enrol_email: string | null; enrol_nric: string | null;
      course_sponsorship: string | null; full_name: string | null; au_email: string | null;
      lp_nric: string | null; dob: string | null; lp_tel: string | null; ssg_run_id: string; course_ref: string;
    }>(
      `SELECT e.id AS enrolment_uuid, e.enrolment_id, e.email AS enrol_email, e.nric AS enrol_nric,
              e.course_sponsorship, au.full_name, au.email AS au_email,
              lp.nric AS lp_nric, lp.dob::text AS dob, lp.tel AS lp_tel,
              cr.course_run_id AS ssg_run_id, c.course_code AS course_ref
         FROM enrollment e
         JOIN course_run cr ON cr.id = e.course_run_id
         JOIN course c ON c.id = cr.course_id
         LEFT JOIN app_user au ON au.id = e.user_id
         LEFT JOIN learner_profile lp ON lp.user_id = e.user_id
        WHERE e.course_run_id = $1
          AND ( ($2::uuid IS NOT NULL AND e.user_id = $2)
             OR ($3 <> '' AND (LOWER(au.email) = LOWER($3) OR LOWER(e.email) = LOWER($3))) )
          AND LOWER(COALESCE(e.enrolment_status, '')) NOT IN ('admin removed', 'cancelled', 'withdrawn')
        LIMIT 1`,
      [courseRunUuid, learner.userId || null, (learner.email || '').trim()]
    )).rows[0];

    if (!row) return { status: 'not_found', message: 'No active local enrolment found for this learner on the run' };
    if (row.enrolment_id) return { status: 'already_enrolled', message: `Already on TPGateway (${row.enrolment_id})`, enrolmentRef: row.enrolment_id };

    const nric = String(row.enrol_nric || row.lp_nric || '').trim().toUpperCase();
    if (!nric) return { status: 'skipped_no_nric', message: 'Learner has no NRIC/FIN on file — cannot enrol on TPGateway' };

    // SSG requires dateOfBirth and a contact number on create (proven via probe: omitting either
    // returns TGS-441 "Required fields cannot be blank"). Pre-flight them so the learner is flagged
    // with a precise reason instead of a generic SSG rejection.
    const dob = String(row.dob || '').trim();
    if (!dob) return { status: 'skipped_no_dob', message: 'Learner has no date of birth on file — SSG requires it to enrol' };

    const phone = String(row.lp_tel || '').replace(/\D/g, '');
    if (!phone) return { status: 'skipped_no_phone', message: 'Learner has no phone number on file — SSG requires it to enrol' };

    const tp = await getTrainingPartnerIdentifiers();
    const sponsorship = (row.course_sponsorship || 'INDIVIDUAL').toUpperCase().includes('EMPLOYER') ? 'EMPLOYER' : 'INDIVIDUAL';

    // Dedup guard — SSG silently ALLOWS duplicate active enrolments (verified: real prod cases),
    // and our local enrolment_id can drift (e.g. a create that didn't get recorded). Before
    // creating, search SSG for an existing enrolment for this trainee+run; if one is already
    // ACTIVE, adopt its ref locally and return instead of creating a second. This is what keeps
    // us from BECOMING a duplicate source. Best-effort: a transient search error falls through to
    // create (not enrolling a valid learner is the worse, more-common failure).
    try {
      const found = await searchEnrolment({
        enrolment: {
          course: { run: { id: row.ssg_run_id }, referenceNumber: row.course_ref },
          trainee: { id: nric, idType: { type: inferIdType(nric, '') }, sponsorshipType: sponsorship },
          trainingPartner: { uen: tp.uen, code: tp.code },
        },
        parameters: { page: 0, pageSize: 10 },
      });
      if (
        found.success && found.referenceNumber &&
        !['cancelled', 'withdrawn', 'rejected'].includes(String(found.enrolmentStatus || '').toLowerCase())
      ) {
        await pool.query(`UPDATE enrollment SET enrolment_id = $1, updated_at = NOW() WHERE id = $2`, [found.referenceNumber, row.enrolment_uuid]);
        return {
          status: 'already_enrolled',
          message: `Already on TPGateway (${found.referenceNumber}) — adopted existing enrolment, no duplicate created`,
          enrolmentRef: found.referenceNumber,
        };
      }
    } catch (e) {
      console.warn('[pushEnrolment] SSG dedup search failed — proceeding to create:', e instanceof Error ? e.message : e);
    }

    const payload = buildEnrolmentPayload({
      trainee_id: nric,
      trainee_id_type: '',                                   // inferIdType derives NRIC/FIN/OTHERS from the id
      date_of_birth: dob,
      trainee_name: row.full_name || '',
      trainee_email: row.au_email || row.enrol_email || '',
      trainee_phone: phone,                                  // SSG-mandatory; countryCode defaults to 65
      sponsorship_type: row.course_sponsorship || 'INDIVIDUAL',
      course_reference_number: row.course_ref,
      course_run_id: row.ssg_run_id,
    }, tp.uen, tp.code);

    // Uses the proven raw-POST + manual-decrypt create (api-client's createEnrolment does NOT
    // decrypt, so the ref couldn't be read — that left enrolment_id unstored on a real success).
    const res = await createEnrolmentOnSsg(payload);
    if (!res.ok || !res.ref) {
      return { status: 'error', message: res.message, ssgStatus: res.status };
    }

    await pool.query(`UPDATE enrollment SET enrolment_id = $1, updated_at = NOW() WHERE id = $2`, [res.ref, row.enrolment_uuid]);
    return { status: 'synced', message: `Enrolled on TPGateway (${res.ref})`, enrolmentRef: res.ref, ssgStatus: res.status };
  } catch (err: any) {
    return { status: 'error', message: err?.message || 'Unknown error' };
  }
}
