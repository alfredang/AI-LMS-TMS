/**
 * Correct Direct Applications that were wrongly marked 'failed'.
 *
 * markFailed() used to stamp auto_enrol_status='failed' for ANY failing pipeline
 * step, but only 1 of its ~12 call sites is the enrolment itself — the rest
 * (invoice, Drive upload, grant/SFC invoice, billing sync) run after SSG has
 * already enrolled the learner. Those rows therefore read "not enrolled" about
 * someone who was. A second pipeline processing the same row could also
 * overwrite a successful status with a straggler's failure.
 *
 * markFailed no longer does that. This repairs the rows already stored that way:
 * a row is only corrected when it holds a REAL SSG enrolment reference, which is
 * proof the enrolment itself succeeded.
 *
 * auto_enrol_error is deliberately left intact — whatever failed after the
 * enrolment really did fail, and the UI shows those rows amber ("enrolled, but a
 * later step failed") rather than a clean green. Repairing the status must not
 * erase the problem.
 */
import pool from '@lib/db';

export interface DaEnrolStatusRepairRow {
  id: string;
  application_id: string | null;
  trainee_name: string | null;
  enrolment_id: string | null;
  auto_enrol_error: string | null;
  corrected_status: string;
}

export interface DaEnrolStatusRepairResult {
  matched: DaEnrolStatusRepairRow[];
  updated: number;
  dryRun: boolean;
}

/** Enrolment-id placeholders that are not real SSG references. */
const PLACEHOLDER_ENROLMENT_IDS = ['N/A', 'NA', '-', 'MANUAL', 'NONE'];

/**
 * The status the row should hold, derived from how far the pipeline actually
 * got — mirroring the order the pipeline itself sets them in.
 */
const CORRECTED_STATUS_SQL = `
  CASE
    WHEN NULLIF(TRIM(COALESCE(invoice_id, '')), '') IS NOT NULL
     AND UPPER(TRIM(COALESCE(invoice_id, ''))) <> ALL($2::text[]) THEN 'invoiced'
    WHEN NULLIF(TRIM(COALESCE(grant_id, '')), '') IS NOT NULL   THEN 'grant_found'
    ELSE 'enroled'
  END
`;

const CANDIDATE_WHERE = `
  LOWER(TRIM(COALESCE(auto_enrol_status, ''))) = 'failed'
  AND NULLIF(TRIM(COALESCE(enrolment_id, '')), '') IS NOT NULL
  AND UPPER(TRIM(COALESCE(enrolment_id, ''))) <> ALL($1::text[])
`;

/**
 * @param opts.dryRun Report what would change without writing (default true at
 *                    the API layer, so a stray call can't mutate anything).
 */
export async function repairFalseEnrolFailures(opts?: {
  dryRun?: boolean;
}): Promise<DaEnrolStatusRepairResult> {
  const dryRun = opts?.dryRun !== false;

  const candidates = await pool.query(
    `SELECT id,
            application_id,
            trainee_name,
            enrolment_id,
            auto_enrol_error,
            ${CORRECTED_STATUS_SQL} AS corrected_status
       FROM da_application
      WHERE ${CANDIDATE_WHERE}
      ORDER BY updated_at DESC NULLS LAST`,
    [PLACEHOLDER_ENROLMENT_IDS, PLACEHOLDER_ENROLMENT_IDS]
  );

  const matched: DaEnrolStatusRepairRow[] = candidates.rows;

  if (dryRun || matched.length === 0) {
    return { matched, updated: 0, dryRun };
  }

  // Re-assert the candidate condition in the UPDATE so a row that changed
  // between the SELECT and here isn't overwritten.
  const updateRes = await pool.query(
    `UPDATE da_application
        SET auto_enrol_status = ${CORRECTED_STATUS_SQL},
            updated_at = NOW()
      WHERE ${CANDIDATE_WHERE}`,
    [PLACEHOLDER_ENROLMENT_IDS, PLACEHOLDER_ENROLMENT_IDS]
  );

  const updated = updateRes.rowCount ?? 0;
  console.log(`[da-enrol-status-repair] corrected ${updated} wrongly-failed row(s)`);
  return { matched, updated, dryRun };
}
