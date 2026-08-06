/**
 * Copy SkillsFuture Credit claim IDs onto Direct Application rows.
 *
 * A claim ID does not exist when an application is confirmed on TPGateway — it
 * is only created later, when the learner actually claims their credit. It
 * reaches the LMS through the SFC payout import, which lands it in `ssg_claims`.
 * Nothing then copied it across to `da_application`, so DA rows kept a blank
 * `skillsfuture_credit_claim_id` and their SFC invoices fell back to being
 * referenced by application id (see lib/autoEnrolDirectApplications.ts, where
 * `sfcReferenceId` degrades to `application_id`).
 *
 * This fills that blank. Deliberately narrow:
 *   - matches ONLY on enrolment id, which is unique per enrolment. Matching on
 *     NRIC + course reference would risk stitching the wrong claim to the wrong
 *     run, and a wrong claim id is far worse than a missing one.
 *   - never overwrites a claim id that is already set.
 *   - never clears anything; a row with no matching claim is left untouched.
 *
 * Runs after an SFC payout import (scoped to the enrolment just applied) and can
 * be swept across every existing row from the admin endpoint.
 */
import pool from '@lib/db';

export interface DaSfcClaimBackfillMatch {
  id: string;
  application_id: string | null;
  enrolment_id: string | null;
  claim_id: string;
}

export interface DaSfcClaimBackfillResult {
  /** Rows that were updated, or that WOULD be updated when dryRun is true. */
  matched: DaSfcClaimBackfillMatch[];
  updated: number;
  dryRun: boolean;
}

/** Enrolment id placeholders that are not real SSG references. */
const PLACEHOLDER_ENROLMENT_IDS = ['N/A', 'NA', '-', 'MANUAL', 'NONE'];

/**
 * Selects DA rows whose claim id is blank but whose enrolment has a claim in
 * `ssg_claims`. DISTINCT ON keeps the most recently actioned claim when an
 * enrolment somehow has more than one, mirroring how
 * createDirectApplicationSfcInvoice picks a claim amount.
 */
const CANDIDATE_SQL = `
  SELECT DISTINCT ON (da.id)
         da.id,
         da.application_id,
         da.enrolment_id,
         TRIM(c.claim_id) AS claim_id
    FROM da_application da
    JOIN ssg_claims c
      ON LOWER(TRIM(c.enrollment_id)) = LOWER(TRIM(da.enrolment_id))
   WHERE NULLIF(TRIM(COALESCE(da.skillsfuture_credit_claim_id, '')), '') IS NULL
     AND NULLIF(TRIM(COALESCE(da.enrolment_id, '')), '') IS NOT NULL
     AND UPPER(TRIM(da.enrolment_id)) <> ALL($1::text[])
     AND NULLIF(TRIM(COALESCE(c.claim_id, '')), '') IS NOT NULL
     AND ($2::text IS NULL OR LOWER(TRIM(da.enrolment_id)) = LOWER(TRIM($2::text)))
   ORDER BY da.id, COALESCE(c.approval_date, c.submission_date, c.created_date) DESC
`;

/**
 * @param opts.enrolmentId Restrict to one enrolment (used after an SFC import).
 *                         Omit to sweep every eligible row.
 * @param opts.dryRun      Report what would change without writing.
 */
export async function backfillDaSfcClaimIds(opts?: {
  enrolmentId?: string | null;
  dryRun?: boolean;
}): Promise<DaSfcClaimBackfillResult> {
  const dryRun = opts?.dryRun === true;
  const enrolmentId = opts?.enrolmentId ? String(opts.enrolmentId).trim() : null;

  const candidates = await pool.query(CANDIDATE_SQL, [PLACEHOLDER_ENROLMENT_IDS, enrolmentId]);
  const matched: DaSfcClaimBackfillMatch[] = candidates.rows.map((r) => ({
    id: r.id,
    application_id: r.application_id,
    enrolment_id: r.enrolment_id,
    claim_id: r.claim_id,
  }));

  if (dryRun || matched.length === 0) {
    return { matched, updated: 0, dryRun };
  }

  // Re-assert the "still blank" condition in the UPDATE so a concurrent write
  // between the SELECT and here can't be clobbered.
  let updated = 0;
  for (const m of matched) {
    const res = await pool.query(
      `UPDATE da_application
          SET skillsfuture_credit_claim_id = $1,
              updated_at = NOW()
        WHERE id = $2
          AND NULLIF(TRIM(COALESCE(skillsfuture_credit_claim_id, '')), '') IS NULL`,
      [m.claim_id, m.id]
    );
    updated += res.rowCount ?? 0;
  }

  console.log(
    `[da-sfc-claim-backfill] filled ${updated} claim id(s)` +
      (enrolmentId ? ` for enrolment ${enrolmentId}` : ' across all Direct Applications')
  );
  return { matched, updated, dryRun };
}
