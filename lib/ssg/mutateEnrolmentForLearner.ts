import crypto from 'crypto';
import pool from '../db';
import { getSSGCredentialsService } from './services/credentials-service';
import { HttpClient, HTTPRequestBuilder, HttpMethod } from './utils/http-utils';
import { searchEnrolment } from './services/enrolment-service';
import { getTrainingPartnerIdentifiers } from '../trainingPartnerIdentifiers';
import { inferIdType } from '../utils/id-type';

/**
 * Re-point / cancel an existing SSG-TPGateway enrolment for ONE learner.
 *
 * Both operations go through the PROVEN mutation endpoint
 *   POST /tpg/enrolments/details/{ref}   body { enrolment: { action, course: { run: { id } } } }
 * (the same path pages/api/enrolment/cancel.ts uses — NOT the api-client's
 * `/tpg/enrolments/{ref}` path, which is unverified). Verified live 2026-06-25:
 *   - action "Update" with a new course.run.id RE-POINTS the enrolment to the new run,
 *     preserving the same referenceNumber (no cancel+create needed).
 *   - action "Cancel" cancels it (existing proven behaviour).
 *
 * Like pushEnrolmentToSsgForLearner: NEVER throws (returns a status), opt-in /
 * confirm-gated at the call site, idempotent-friendly (skips when the learner was
 * never pushed, i.e. no stored enrolment_id). These helpers do NOT mutate local
 * enrolment state — the caller owns the local row (move-class-to-run has already
 * re-pointed/soft-removed it) and decides what to do with enrolment_id.
 */

const IV = Buffer.from('SSGAPIInitVector', 'utf8');

export interface EnrolmentMutateResult {
  status: 'synced' | 'skipped_no_enrolment_id' | 'not_found' | 'error';
  message: string;
  action?: 'Update' | 'Cancel';
  enrolmentRef?: string;
  ssgStatus?: number;
}

/** Low-level: encrypted POST to /tpg/enrolments/details/{ref} with an action + target run. */
async function postEnrolmentDetailsAction(
  ref: string,
  action: 'Update' | 'Cancel',
  ssgRunId: string
): Promise<{ ok: boolean; status?: number; message: string }> {
  const credentials = await getSSGCredentialsService().getSSGCredentials();
  if (!credentials) return { ok: false, message: 'SSG credentials not found' };

  const baseUrl =
    (credentials as any).ssgApiBaseUrl || process.env.SSG_API_URL || process.env.SSG_API_BASE_URL || 'https://api.ssg-wsg.sg';
  const payload = { enrolment: { action, course: { run: { id: String(ssgRunId) } } } };

  const encKey = Buffer.from(credentials.encryptionKey, 'base64');
  const cipher = crypto.createCipheriv('aes-256-cbc', encKey, IV);
  let body = cipher.update(JSON.stringify(payload), 'utf8', 'base64');
  body += cipher.final('base64');

  const builder = new HTTPRequestBuilder()
    .withEndpoint(baseUrl, `/tpg/enrolments/details/${ref}`)
    .withMethod(HttpMethod.POST)
    .withBody(body);
  if (credentials.certificateContent && credentials.privateKeyContent) {
    builder.withCertificate(credentials.certificateContent, credentials.privateKeyContent);
  }

  const httpClient = new HttpClient(baseUrl, { 'Content-Type': 'application/json', Accept: 'application/json' });
  const r = await httpClient.request(builder.build());
  if (r.status !== 200) return { ok: false, status: r.status, message: `SSG HTTP ${r.status}` };

  const raw = typeof r.data === 'string' ? r.data : JSON.stringify(r.data);
  const decipher = crypto.createDecipheriv('aes-256-cbc', encKey, IV);
  let dec = decipher.update(raw, 'base64', 'utf8');
  dec += decipher.final('utf8');
  let parsed: any;
  try { parsed = JSON.parse(dec); } catch { return { ok: false, message: 'Could not parse SSG response' }; }

  if (parsed?.status && String(parsed.status) !== '200') {
    const msg = parsed?.error?.details?.[0]?.message || parsed?.error?.message || `SSG status ${parsed.status}`;
    return { ok: false, status: Number(parsed.status), message: msg };
  }
  return { ok: true, status: 200, message: 'ok' };
}

/**
 * Create an enrolment on SSG via POST /tpg/enrolments and return the referenceNumber.
 * Uses the PROVEN raw-POST + manual-decrypt path (the api-client's createEnrolment does
 * NOT decrypt its response, so its body can't be read for the ref — that was the bug that
 * left enrolment_id unstored). Mirrors lib/autoEnrolDirectApplications.ts. NEVER throws.
 */
export async function createEnrolmentOnSsg(
  payload: object
): Promise<{ ok: boolean; ref?: string; status?: number; message: string }> {
  const credentials = await getSSGCredentialsService().getSSGCredentials();
  if (!credentials) return { ok: false, message: 'SSG credentials not found' };

  const baseUrl =
    (credentials as any).ssgApiBaseUrl || process.env.SSG_API_URL || process.env.SSG_API_BASE_URL || 'https://api.ssg-wsg.sg';
  const encKey = Buffer.from(credentials.encryptionKey, 'base64');
  const cipher = crypto.createCipheriv('aes-256-cbc', encKey, IV);
  let body = cipher.update(JSON.stringify(payload), 'utf8', 'base64');
  body += cipher.final('base64');

  const builder = new HTTPRequestBuilder()
    .withEndpoint(baseUrl, '/tpg/enrolments')
    .withMethod(HttpMethod.POST)
    .withBody(body);
  if (credentials.certificateContent && credentials.privateKeyContent) {
    builder.withCertificate(credentials.certificateContent, credentials.privateKeyContent);
  }

  const httpClient = new HttpClient(baseUrl, { 'Content-Type': 'application/json', Accept: 'application/json' });
  const r = await httpClient.request(builder.build());
  const raw = typeof r.data === 'string' ? r.data : JSON.stringify(r.data);

  // The success body is encrypted; a hard failure may be plain JSON. Try decrypt, then JSON.
  let parsed: any = null;
  try {
    const decipher = crypto.createDecipheriv('aes-256-cbc', encKey, IV);
    let dec = decipher.update(raw, 'base64', 'utf8');
    dec += decipher.final('utf8');
    parsed = JSON.parse(dec);
  } catch {
    try { parsed = JSON.parse(raw); } catch { parsed = null; }
  }
  if (!parsed) return { ok: false, status: r.status, message: `SSG create unreadable (HTTP ${r.status})` };

  const statusNum = Number(parsed?.status ?? r.status);
  const hasError = parsed?.error && (parsed.error.code || parsed.error.message || (parsed.error.details && parsed.error.details.length > 0));
  if (hasError || (statusNum && statusNum >= 400)) {
    const msg = parsed?.error?.details?.[0]?.message || parsed?.error?.message || `SSG status ${statusNum}`;
    return { ok: false, status: statusNum, message: msg };
  }

  const ref =
    parsed?.data?.enrolment?.referenceNumber ?? parsed?.enrolment?.referenceNumber ??
    parsed?.data?.referenceNumber ?? parsed?.referenceNumber;
  if (!ref) return { ok: false, status: statusNum, message: 'SSG create returned no reference number' };
  return { ok: true, ref: String(ref), status: statusNum, message: 'created' };
}

interface ResolvedEnrolment {
  enrolment_uuid: string;
  enrolment_id: string | null;
  ssg_run_id: string;
  nric: string | null;
  course_ref: string;
  sponsorship: string | null;
}

/** Resolve a learner's enrolment row on a given run, incl. fields needed to search SSG. */
async function resolveLearnerEnrolmentOnRun(
  courseRunUuid: string,
  learner: { userId?: string | null; email?: string | null }
): Promise<ResolvedEnrolment | undefined> {
  return (await pool.query<ResolvedEnrolment>(
    `SELECT e.id AS enrolment_uuid, e.enrolment_id, cr.course_run_id AS ssg_run_id,
            COALESCE(NULLIF(TRIM(e.nric), ''), lp.nric) AS nric,
            COALESCE(
              (SELECT h.code FROM public.course_code_history h WHERE h.course_id = c.id AND h.is_current LIMIT 1),
              NULLIF(c.new_course_code, ''),
              c.course_code
            ) AS course_ref, e.course_sponsorship AS sponsorship
       FROM enrollment e
       JOIN course_run cr ON cr.id = e.course_run_id
       JOIN course c ON c.id = cr.course_id
       LEFT JOIN app_user au ON au.id = e.user_id
       LEFT JOIN learner_profile lp ON lp.user_id = e.user_id
      WHERE e.course_run_id = $1
        AND ( ($2::uuid IS NOT NULL AND e.user_id = $2)
           OR ($3 <> '' AND (LOWER(au.email) = LOWER($3) OR LOWER(e.email) = LOWER($3))) )
      ORDER BY e.updated_at DESC
      LIMIT 1`,
    [courseRunUuid, learner.userId || null, (learner.email || '').trim()]
  )).rows[0];
}

/** SSG ground truth: the learner's ACTIVE (non-cancelled) enrolment ref on a run, or null. */
async function findActiveEnrolmentRefOnRun(row: ResolvedEnrolment, ssgRunId: string): Promise<string | null> {
  const nric = String(row.nric || '').trim().toUpperCase();
  if (!nric) return null;
  try {
    const tp = await getTrainingPartnerIdentifiers();
    const sponsorship = (row.sponsorship || 'INDIVIDUAL').toUpperCase().includes('EMPLOYER') ? 'EMPLOYER' : 'INDIVIDUAL';
    const found = await searchEnrolment({
      enrolment: {
        course: { run: { id: ssgRunId }, referenceNumber: row.course_ref },
        trainee: { id: nric, idType: { type: inferIdType(nric, '') }, sponsorshipType: sponsorship },
        trainingPartner: { uen: tp.uen, code: tp.code },
      },
      parameters: { page: 0, pageSize: 10 },
    });
    if (found.success && found.referenceNumber &&
        !['cancelled', 'withdrawn', 'rejected'].includes(String(found.enrolmentStatus || '').toLowerCase())) {
      return found.referenceNumber;
    }
  } catch { /* best-effort */ }
  return null;
}

/** A stale-ref error means the stored ref points to a cancelled/non-updatable enrolment. */
function isStaleRefError(msg: string): boolean {
  return /TGS-439|cannot be updated|cancelled/i.test(msg || '');
}

/**
 * Re-point a moved learner's SSG enrolment to the run they now sit on.
 * Call AFTER the local move (enrollment.course_run_id already = targetRunUuid).
 * The SSG referenceNumber is preserved, so no local change is needed.
 */
export async function repointEnrolmentToRunForLearner(
  targetRunUuid: string,
  learner: { userId?: string | null; email?: string | null },
  opts?: { sourceRunUuid?: string }
): Promise<EnrolmentMutateResult> {
  try {
    const row = await resolveLearnerEnrolmentOnRun(targetRunUuid, learner);
    if (!row) return { status: 'not_found', message: 'No enrolment found for this learner on the target run', action: 'Update' };

    // Try the stored ref first.
    if (row.enrolment_id) {
      const r = await postEnrolmentDetailsAction(row.enrolment_id, 'Update', row.ssg_run_id);
      if (r.ok) return { status: 'synced', message: `Re-pointed on TPGateway to run ${row.ssg_run_id} (${row.enrolment_id})`, action: 'Update', enrolmentRef: row.enrolment_id, ssgStatus: r.status };
      // A non-staleness error is a real failure; only fall through to reconcile if the ref is stale.
      if (!isStaleRefError(r.message)) return { status: 'error', message: r.message, action: 'Update', enrolmentRef: row.enrolment_id, ssgStatus: r.status };
    }

    // Reconcile against SSG truth: the stored ref is missing or dead (e.g. cancelled/re-created
    // on TPG outside the LMS). Find the learner's ACTUAL active enrolment on the source run and
    // re-point THAT, then heal the local enrolment_id. Needs the source run to search.
    const srcRow = opts?.sourceRunUuid ? await resolveLearnerEnrolmentOnRun(opts.sourceRunUuid, learner) : undefined;
    const searchSsgRun = srcRow?.ssg_run_id;
    const liveRef = searchSsgRun ? await findActiveEnrolmentRefOnRun(row, searchSsgRun) : null;
    if (!liveRef) {
      return { status: 'skipped_no_enrolment_id', message: 'No active TPGateway enrolment found to re-point (none on file or on SSG)', action: 'Update' };
    }
    const r2 = await postEnrolmentDetailsAction(liveRef, 'Update', row.ssg_run_id);
    if (!r2.ok) return { status: 'error', message: r2.message, action: 'Update', enrolmentRef: liveRef, ssgStatus: r2.status };
    await pool.query(`UPDATE enrollment SET enrolment_id = $1, updated_at = NOW() WHERE id = $2`, [liveRef, row.enrolment_uuid]);
    return { status: 'synced', message: `Re-pointed on TPGateway to run ${row.ssg_run_id} (${liveRef}; reconciled from SSG)`, action: 'Update', enrolmentRef: liveRef, ssgStatus: r2.status };
  } catch (err: any) {
    return { status: 'error', message: err?.message || 'Unknown error', action: 'Update' };
  }
}

/**
 * Cancel a removed learner's SSG enrolment on a run.
 * Call AFTER the local soft-remove (enrollment.enrolment_status already = 'Admin Removed').
 * Does NOT clear the local enrolment_id — the caller decides (clearing it would let a
 * future re-add re-create on SSG; keeping it preserves the cancelled ref for history).
 */
export async function cancelEnrolmentForLearnerOnRun(
  courseRunUuid: string,
  learner: { userId?: string | null; email?: string | null }
): Promise<EnrolmentMutateResult> {
  try {
    const row = await resolveLearnerEnrolmentOnRun(courseRunUuid, learner);
    if (!row) return { status: 'not_found', message: 'No enrolment found for this learner on the run', action: 'Cancel' };

    // Prefer the stored ref; if it's missing, reconcile against SSG truth (an enrolment created
    // on TPG outside the LMS won't have a local ref). Either way we cancel the ACTIVE one.
    let ref = row.enrolment_id;
    if (!ref) {
      ref = await findActiveEnrolmentRefOnRun(row, row.ssg_run_id);
      if (!ref) return { status: 'skipped_no_enrolment_id', message: 'No active TPGateway enrolment found to cancel (none on file or on SSG)', action: 'Cancel' };
    }
    const r = await postEnrolmentDetailsAction(ref, 'Cancel', row.ssg_run_id);
    // Already-cancelled on SSG (stale ref) is a successful no-op for our purposes, not an error.
    if (!r.ok && isStaleRefError(r.message)) {
      return { status: 'synced', message: `Already cancelled on TPGateway (${ref})`, action: 'Cancel', enrolmentRef: ref, ssgStatus: r.status };
    }
    if (!r.ok) return { status: 'error', message: r.message, action: 'Cancel', enrolmentRef: ref, ssgStatus: r.status };
    return { status: 'synced', message: `Cancelled on TPGateway (${ref})`, action: 'Cancel', enrolmentRef: ref, ssgStatus: r.status };
  } catch (err: any) {
    return { status: 'error', message: err?.message || 'Unknown error', action: 'Cancel' };
  }
}

/**
 * Re-point a learner's SSG enrolment from source run to target run,
 * calling BEFORE the local LMS move (enrollment.course_run_id still = sourceRunUuid).
 *
 * Unlike repointEnrolmentToRunForLearner (which expects enrollment already on target UUID),
 * this resolves the enrolment on the SOURCE run and updates it to point at the target SSG
 * run ID. Use this when TPG must be committed before local state is changed.
 */
export async function repointEnrolmentPreMove(
  sourceRunUuid: string,
  targetRunUuid: string,
  learner: { userId?: string | null; email?: string | null }
): Promise<EnrolmentMutateResult> {
  try {
    const row = await resolveLearnerEnrolmentOnRun(sourceRunUuid, learner);
    if (!row) {
      return { status: 'not_found', message: 'No enrolment found for this learner on the current run', action: 'Update' };
    }

    const targetRunRow = (await pool.query<{ ssg_run_id: string }>(
      `SELECT course_run_id AS ssg_run_id FROM course_run WHERE id = $1 LIMIT 1`,
      [targetRunUuid]
    )).rows[0];
    if (!targetRunRow) {
      return { status: 'not_found', message: `Target run UUID ${targetRunUuid} not found in LMS`, action: 'Update' };
    }
    const targetSsgRunId = targetRunRow.ssg_run_id;

    // Try the stored ref first
    if (row.enrolment_id) {
      const r = await postEnrolmentDetailsAction(row.enrolment_id, 'Update', targetSsgRunId);
      if (r.ok) {
        return { status: 'synced', message: `Re-pointed on TPGateway to ${targetSsgRunId} (${row.enrolment_id})`, action: 'Update', enrolmentRef: row.enrolment_id, ssgStatus: r.status };
      }
      if (!isStaleRefError(r.message)) {
        return { status: 'error', message: r.message, action: 'Update', enrolmentRef: row.enrolment_id, ssgStatus: r.status };
      }
    }

    // Stored ref missing or stale — reconcile against SSG truth on the source run
    const liveRef = await findActiveEnrolmentRefOnRun(row, row.ssg_run_id);
    if (!liveRef) {
      return { status: 'skipped_no_enrolment_id', message: 'No active TPGateway enrolment found (none stored locally or found on SSG)', action: 'Update' };
    }
    const r2 = await postEnrolmentDetailsAction(liveRef, 'Update', targetSsgRunId);
    if (!r2.ok) {
      return { status: 'error', message: r2.message, action: 'Update', enrolmentRef: liveRef, ssgStatus: r2.status };
    }
    // Heal local ref so future operations have the correct reference
    await pool.query(`UPDATE enrollment SET enrolment_id = $1, updated_at = NOW() WHERE id = $2`, [liveRef, row.enrolment_uuid]);
    return { status: 'synced', message: `Re-pointed on TPGateway to ${targetSsgRunId} (${liveRef}; ref reconciled from SSG)`, action: 'Update', enrolmentRef: liveRef, ssgStatus: r2.status };
  } catch (err: any) {
    return { status: 'error', message: err?.message || 'Unknown error', action: 'Update' };
  }
}
