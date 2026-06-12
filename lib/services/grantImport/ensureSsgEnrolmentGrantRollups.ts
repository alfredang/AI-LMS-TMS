import pool from '@/lib/db';

/**
 * Backward-compatible schema guard for Consolidated Finance.
 * Ensures the grant-payment rollup columns exist on `ssg_enrolments`.
 *
 * This intentionally does NOT require the full grant-import tables to exist, so the
 * finance page doesn't 500 if only partial migrations were applied.
 */
export async function ensureSsgEnrolmentGrantRollupColumns(): Promise<void> {
  // Columns
  await pool.query(
    `ALTER TABLE public.ssg_enrolments
     ADD COLUMN IF NOT EXISTS total_grant_expected numeric(10,2)`
  );
  await pool.query(
    `ALTER TABLE public.ssg_enrolments
     ADD COLUMN IF NOT EXISTS total_grant_received numeric(10,2) NOT NULL DEFAULT 0`
  );
  await pool.query(
    `ALTER TABLE public.ssg_enrolments
     ADD COLUMN IF NOT EXISTS total_grant_pending numeric(10,2)`
  );

  // Enum type + column (create if missing)
  await pool.query(
    `DO $$
     BEGIN
       IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'grant_payment_status') THEN
         CREATE TYPE public.grant_payment_status AS ENUM ('NOT_RECEIVED','PARTIAL','FULLY_PAID');
       END IF;
     END $$;`
  );
  await pool.query(
    `ALTER TABLE public.ssg_enrolments
     ADD COLUMN IF NOT EXISTS grant_payment_status public.grant_payment_status`
  );

  await pool.query(
    `ALTER TABLE public.ssg_enrolments
     ADD COLUMN IF NOT EXISTS last_grant_import_at timestamptz`
  );

  // Indexes
  await pool.query(
    `CREATE INDEX IF NOT EXISTS idx_ssg_enrolments_grant_payment_status
     ON public.ssg_enrolments(grant_payment_status)`
  );
  await pool.query(
    `CREATE INDEX IF NOT EXISTS idx_ssg_enrolments_last_grant_import_at
     ON public.ssg_enrolments(last_grant_import_at DESC)`
  );
}

