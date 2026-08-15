/**
 * Bridge: a manual SSG enrolment → a `da_application` row → the DA pipeline.
 *
 * Enrolling a learner through TPG Management → Enrolment → Enrol Learners used
 * to be a dead end for automation: it wrote to `enrollment` only, so the learner
 * got no calendar invite, no Grant invoice, no SFC invoice, and (unless
 * QBO_AUTO_INVOICE_AFTER_ENROLMENT was set) no invoice at all. Because the row
 * never reached `da_application`, the nightly DA sweep could not catch it
 * either — there was no safety net behind that screen.
 *
 * Rather than grow a second invoicing pipeline, we mint the `da_application`
 * row the DA pipeline already knows how to drive, and hand it over. One code
 * path, one set of behaviours, one safety net.
 *
 * Where the money comes from — all of it mirrors what the existing invoice-jobs
 * processor already does for these same learners (lib/services/invoiceJobProcessor.ts):
 *   - full_course_fee ← course.course_fees_exclude_gst. It MUST be the ex-GST
 *     figure: the DA main invoice line posts `Amount: fullFee` under a GST tax
 *     code, so QuickBooks computes the tax itself.
 *   - gst ← 0. The column never reaches QuickBooks; it only feeds an internal
 *     net-amount sanity check, where 0 is the conservative value.
 *   - skillsfuture_subsidy ← left null. The pipeline resolves the real subsidy
 *     from ssg_grants once SSG issues the grant.
 *   - skillsfuture_credit / claim id ← ssg_claims, if the learner made a claim.
 */

import pool from '../db';

/**
 * Synthetic rows are marked in `application_id` so they can be told apart from
 * genuine MySkillsFuture applications — the Excel upload needs to recognise one
 * and upgrade it in place instead of rejecting the real application as a
 * duplicate of its own placeholder.
 *
 * The marker is an internal key: never print it as an "Application ID". See
 * `lib/daApplicationId.ts`, which owns the id rules and is safe to import from
 * client code (this module pulls in the DB pool).
 */
import {
  buildSyntheticDaApplicationId,
  isSyntheticDaApplicationId,
} from '../daApplicationId';

export { buildSyntheticDaApplicationId, isSyntheticDaApplicationId };

function isRealSsgEnrolmentId(value: unknown): boolean {
  return /^ENR-/i.test(String(value || '').trim());
}

/** `course_fees_exclude_gst` is text and may carry thousands separators. */
function parseMoney(value: unknown): number {
  if (value == null) return 0;
  const n = parseFloat(String(value).replace(/,/g, '').trim());
  return Number.isFinite(n) ? n : 0;
}

export interface EnsureDaApplicationInput {
  enrolmentId: string;
  userId: string;
  learnerEmail: string;
  courseReferenceNumber: string;
  courseRunId: string;
  traineeName?: string | null;
  traineeNric?: string | null;
  sponsorshipType?: string | null;
}

export interface EnsureDaApplicationResult {
  daApplicationId: string;
  applicationId: string;
  created: boolean;
  fullCourseFee: number;
}

/**
 * Create (or refresh) the `da_application` row that represents a manually
 * enrolled learner, and return its id so the caller can run the DA pipeline.
 *
 * Returns null — meaning "not ours, leave it alone" — when:
 *   - the enrolment reference is not a real SSG ENR- value;
 *   - a genuine Direct Application row already covers this enrolment, or this
 *     trainee on this course run. That row is the source of truth and already
 *     carries SSG's own fee/subsidy figures; shadowing it with a synthetic copy
 *     would double-invoice the learner.
 */
export async function ensureDaApplicationForEnrolment(
  input: EnsureDaApplicationInput
): Promise<EnsureDaApplicationResult | null> {
  const enrolmentId = String(input.enrolmentId || '').trim();
  if (!isRealSsgEnrolmentId(enrolmentId)) return null;
  if (!input.userId || !input.learnerEmail) return null;

  const applicationId = buildSyntheticDaApplicationId(enrolmentId);

  // Does a DA row already own this learner? Match on the enrolment reference
  // first, then on trainee + course run (the same pair the Excel upload uses to
  // detect a duplicate application).
  const existing = await pool.query(
    `SELECT id, application_id
       FROM da_application
      WHERE LOWER(TRIM(COALESCE(enrolment_id, ''))) = LOWER(TRIM($1))
         OR (
              $2::text <> ''
          AND LOWER(TRIM(COALESCE(trainee_id, ''))) = LOWER(TRIM($2))
          AND LOWER(TRIM(COALESCE(course_run_id, ''))) = LOWER(TRIM($3))
            )
      ORDER BY updated_at DESC NULLS LAST
      LIMIT 1`,
    [enrolmentId, String(input.traineeNric || '').trim(), String(input.courseRunId || '').trim()]
  );

  const existingRow = existing.rows[0];
  if (existingRow && !isSyntheticDaApplicationId(existingRow.application_id)) {
    console.log(
      `[da-from-enrolment] ${enrolmentId} is already covered by Direct Application ${existingRow.application_id} — leaving it to the DA flow`
    );
    return null;
  }

  // Course, run and learner details — same shape the invoice-jobs processor
  // builds for an SSG-enrolled learner.
  const ctxRes = await pool.query(
    `SELECT
        c.title                    AS course_title,
        c.course_code              AS course_code,
        c.course_fees_exclude_gst  AS course_fees_exclude_gst,
        cr.course_run_id::text     AS course_run_id,
        cr.start_date::text        AS start_date,
        cr.end_date::text          AS end_date,
        u.full_name                AS full_name,
        COALESCE(lp.nric::text, e.nric::text) AS trainee_nric
       FROM enrollment e
       JOIN course c       ON c.id = e.course_id
       JOIN course_run cr  ON cr.id = e.course_run_id
       JOIN app_user u     ON u.id = e.user_id
       LEFT JOIN learner_profile lp ON lp.user_id = e.user_id
      WHERE e.user_id = $1::uuid
        AND LOWER(TRIM(COALESCE(e.enrolment_id::text, ''))) = LOWER(TRIM($2::text))
      LIMIT 1`,
    [input.userId, enrolmentId]
  );

  const ctx = ctxRes.rows[0];
  if (!ctx) {
    console.warn(
      `[da-from-enrolment] no local enrollment found for ${enrolmentId} — skipping DA row creation`
    );
    return null;
  }

  const fullCourseFee = parseMoney(ctx.course_fees_exclude_gst);

  // A SkillsFuture Credit claim only exists if the learner made one; absent is
  // the normal case for a manual enrolment and simply means no SFC invoice.
  const sfcRes = await pool.query(
    `SELECT claim_id, claim_amount
       FROM ssg_claims
      WHERE LOWER(TRIM(COALESCE(enrollment_id::text, ''))) = LOWER(TRIM($1::text))
      ORDER BY claim_id DESC
      LIMIT 1`,
    [enrolmentId]
  );
  const sfcClaimId = sfcRes.rows[0]?.claim_id ? String(sfcRes.rows[0].claim_id) : null;
  const sfcAmount = parseMoney(sfcRes.rows[0]?.claim_amount);

  const traineeName = String(input.traineeName || ctx.full_name || '').trim() || null;
  const traineeNric = String(input.traineeNric || ctx.trainee_nric || '').trim() || null;
  const courseRunId = String(ctx.course_run_id || input.courseRunId || '').trim() || null;
  const courseRef = String(ctx.course_code || input.courseReferenceNumber || '').trim() || null;

  const upsert = await pool.query(
    `INSERT INTO da_application (
        application_id,
        application_status,
        application_date,
        trainee_id,
        trainee_name,
        trainee_email,
        sponsorship_type,
        course_run_id,
        course_title,
        course_reference_number,
        course_start_date,
        course_end_date,
        full_course_fee,
        gst,
        skillsfuture_credit,
        skillsfuture_credit_claim_id,
        enrolment_id,
        enrolment_status,
        user_id
     ) VALUES (
        $1, 'Confirmed', CURRENT_DATE,
        $2, $3, $4, $5,
        $6, $7, $8, $9::date, $10::date,
        $11, 0, $12, $13,
        $14, 'Confirmed', $15::uuid
     )
     ON CONFLICT (application_id) DO UPDATE SET
        trainee_id                   = COALESCE(EXCLUDED.trainee_id, da_application.trainee_id),
        trainee_name                 = COALESCE(EXCLUDED.trainee_name, da_application.trainee_name),
        trainee_email                = COALESCE(EXCLUDED.trainee_email, da_application.trainee_email),
        sponsorship_type             = COALESCE(EXCLUDED.sponsorship_type, da_application.sponsorship_type),
        course_run_id                = COALESCE(EXCLUDED.course_run_id, da_application.course_run_id),
        course_title                 = COALESCE(EXCLUDED.course_title, da_application.course_title),
        course_reference_number      = COALESCE(EXCLUDED.course_reference_number, da_application.course_reference_number),
        course_start_date            = COALESCE(EXCLUDED.course_start_date, da_application.course_start_date),
        course_end_date              = COALESCE(EXCLUDED.course_end_date, da_application.course_end_date),
        -- Fee is refreshed from the course record: it is derived data, and a
        -- corrected course price should reach an invoice that hasn't been cut yet.
        full_course_fee              = COALESCE(EXCLUDED.full_course_fee, da_application.full_course_fee),
        skillsfuture_credit          = COALESCE(EXCLUDED.skillsfuture_credit, da_application.skillsfuture_credit),
        skillsfuture_credit_claim_id = COALESCE(EXCLUDED.skillsfuture_credit_claim_id, da_application.skillsfuture_credit_claim_id),
        enrolment_id                 = COALESCE(EXCLUDED.enrolment_id, da_application.enrolment_id),
        enrolment_status             = COALESCE(EXCLUDED.enrolment_status, da_application.enrolment_status),
        user_id                      = COALESCE(EXCLUDED.user_id, da_application.user_id),
        updated_at                   = NOW()
     RETURNING id, (xmax = 0) AS inserted`,
    [
      applicationId,
      traineeNric,
      traineeName,
      String(input.learnerEmail).trim(),
      String(input.sponsorshipType || 'INDIVIDUAL').trim(),
      courseRunId,
      String(ctx.course_title || '').trim() || courseRef,
      courseRef,
      ctx.start_date || null,
      ctx.end_date || null,
      fullCourseFee > 0 ? fullCourseFee : null,
      sfcAmount > 0 ? sfcAmount : null,
      sfcClaimId,
      enrolmentId,
      input.userId,
    ]
  );

  const row = upsert.rows[0];
  if (!row?.id) return null;

  if (fullCourseFee <= 0) {
    // Not fatal here — the pipeline will record the failure against the row, and
    // it becomes visible/retryable in the DA view once the course price is set.
    console.warn(
      `[da-from-enrolment] ${applicationId}: course "${courseRef}" has no course_fees_exclude_gst — the invoice step will fail until it is set`
    );
  }

  return {
    daApplicationId: String(row.id),
    applicationId,
    created: row.inserted === true,
    fullCourseFee,
  };
}
