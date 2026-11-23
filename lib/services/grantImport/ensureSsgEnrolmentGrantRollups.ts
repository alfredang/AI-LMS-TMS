import pool from '@/lib/db';
import { ensureColumns, ensureIndex } from '@/lib/dbSchemaGuard';

const gEnsure = globalThis as unknown as {
  __ssgEnrolmentGrantColumnsEnsured?: Promise<void>;
  __ssgEnrolmentIndexesEnsured?: Promise<void>;
};

/**
 * Backward-compatible schema guard for Consolidated Finance.
 * Ensures the grant-payment rollup columns exist on `ssg_enrolments`.
 *
 * This intentionally does NOT require the full grant-import tables to exist, so the
 * finance page doesn't 500 if only partial migrations were applied.
 *
 * Runs once per process: `ALTER TABLE … ADD COLUMN IF NOT EXISTS` takes an ACCESS EXCLUSIVE
 * lock even when the column already exists, so running it on every page load queued every
 * read of ssg_enrolments behind any long-running query ("Loading enrolments…" for ages).
 */
export function ensureSsgEnrolmentGrantRollupColumns(): Promise<void> {
  if (!gEnsure.__ssgEnrolmentGrantColumnsEnsured) {
    gEnsure.__ssgEnrolmentGrantColumnsEnsured = ensureNow().catch((e) => {
      gEnsure.__ssgEnrolmentGrantColumnsEnsured = undefined;
      throw e;
    });
  }
  return gEnsure.__ssgEnrolmentGrantColumnsEnsured.then(startIndexBuild);
}

/**
 * Indexes are built in the background: a CONCURRENTLY build waits for queries already running on
 * the table, and the finance page must not wait (or fail) on that. A failed build is retried on
 * the next call; a finished one is never re-run in this process.
 */
function startIndexBuild(): void {
  if (gEnsure.__ssgEnrolmentIndexesEnsured) return;
  gEnsure.__ssgEnrolmentIndexesEnsured = ensureIndexes().catch((e) => {
    gEnsure.__ssgEnrolmentIndexesEnsured = undefined;
    console.warn('[ensureSsgEnrolmentGrantRollups] index build deferred:', e instanceof Error ? e.message : e);
  });
}

async function ensureNow(): Promise<void> {
  // Enum type first — the grant_payment_status column below uses it.
  await pool.query(
    `DO $$
     BEGIN
       IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'grant_payment_status') THEN
         CREATE TYPE public.grant_payment_status AS ENUM ('NOT_RECEIVED','PARTIAL','FULLY_PAID');
       END IF;
     END $$;`
  );

  // Columns. Catalog check first, lock timeout if one is really missing (lib/dbSchemaGuard):
  // each new process used to take ACCESS EXCLUSIVE locks on ssg_enrolments here.
  await ensureColumns(pool, 'ssg_enrolments', {
    total_grant_expected: 'numeric(10,2)',
    total_grant_received: 'numeric(10,2) NOT NULL DEFAULT 0',
    total_grant_pending: 'numeric(10,2)',
    grant_payment_status: 'public.grant_payment_status',
    last_grant_import_at: 'timestamptz',
    // When the missing-grant sync (lib/services/missingGrantSync.ts) last asked TPG for this
    // enrolment's grants. NULL = never checked.
    grants_checked_at: 'timestamptz',
  });

}

async function ensureIndexes(): Promise<void> {
  await ensureIndex(
    pool,
    'idx_ssg_enrolments_grant_payment_status',
    `CREATE INDEX IF NOT EXISTS idx_ssg_enrolments_grant_payment_status
     ON public.ssg_enrolments(grant_payment_status)`
  );
  await ensureIndex(
    pool,
    'idx_ssg_enrolments_last_grant_import_at',
    `CREATE INDEX IF NOT EXISTS idx_ssg_enrolments_last_grant_import_at
     ON public.ssg_enrolments(last_grant_import_at DESC)`
  );

  // Without these, "enrolments with no grants" (missingGrantSync) and the superseded-duplicate
  // filter in /api/finance/all-course-runs rescan the whole table per enrolment — measured at
  // 34s and 130s+ on prod (2026-10-15). CONCURRENTLY so the first build never blocks writes.
  await ensureIndex(
    pool,
    'idx_ssg_grants_enrollment_id',
    `CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_ssg_grants_enrollment_id
     ON public.ssg_grants(enrollment_id)`
  );
  await ensureIndex(
    pool,
    'idx_ssg_enrolments_nric_run',
    `CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_ssg_enrolments_nric_run
     ON public.ssg_enrolments(trainee_nric, ((raw_data->'course'->'run'->>'id')))`
  );

  // /api/finance/all-course-runs joins every table to the enrolment on
  // LOWER(TRIM(COALESCE(<enrolment id>, ''))), which a plain column index cannot serve: each
  // shown enrolment scanned all of ssg_grants (twice), ssg_claims, invoice_jobs, da_application
  // and company_application, and one view ran 9+ minutes on prod (2026-11-23), holding locks that
  // stalled a Bulk SFC upload. These index exactly those expressions — they must stay textually
  // identical to the query's join expressions to be used. See
  // database/migrations/add_enrolment_join_expression_indexes.sql.
  for (const [name, table, columns] of ENROLMENT_JOIN_INDEXES) {
    await ensureIndex(pool, name, `CREATE INDEX CONCURRENTLY IF NOT EXISTS ${name} ON public.${table} (${columns})`);
  }
}

// [index name, table, indexed columns]. ssg_claims also carries claim_id: the query takes the
// latest claim (ORDER BY claim_id DESC LIMIT 1), and without it the planner walked the whole
// claim_id index backwards for every enrolment instead.
const ENROLMENT_JOIN_INDEXES: Array<[name: string, table: string, columns: string]> = [
  ['idx_ssg_grants_enrollment_norm', 'ssg_grants', "(LOWER(TRIM(COALESCE(enrollment_id::text, ''))))"],
  ['idx_ssg_claims_enrollment_norm_claim', 'ssg_claims', "(LOWER(TRIM(COALESCE(enrollment_id::text, '')))), claim_id"],
  ['idx_invoice_jobs_enrolment_norm', 'invoice_jobs', "(LOWER(TRIM(COALESCE(enrolment_id::text, ''))))"],
  ['idx_da_application_enrolment_norm', 'da_application', "(LOWER(TRIM(COALESCE(enrolment_id, ''))))"],
  ['idx_company_application_enrolment_norm', 'company_application', "(LOWER(TRIM(COALESCE(enrolment_id, ''))))"],
];
