import pool from '../db';

/**
 * Idempotently ensure the trainer_bill table exists, memoized so the DDL runs
 * at most ONCE per process instead of on every payroll request. Mirrors
 * ensureClassDates.ts — the payroll tables are created lazily so a deploy that
 * hasn't had database/migrations/add_payroll_trainer_bill.sql applied by hand
 * still works. Keep this DDL in sync with that migration.
 *
 * On failure the memo is reset so a later request retries.
 */
let ensured: Promise<void> | null = null;

const DDL = `
CREATE TABLE IF NOT EXISTS public.trainer_bill (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    source TEXT NOT NULL CHECK (source IN ('wsq','manual')),
    -- SET NULL, never CASCADE: this row is the only LMS record of a real
    -- payable in QuickBooks. Deleting the class it came from (which an admin
    -- can do from outside Payroll entirely) must not erase the trail to a bill
    -- that is still live in QBO. The row survives, parentless but traceable,
    -- carrying bill_no / qb_bill_id / the Drive link.
    payout_id       UUID REFERENCES public.trainer_payout(id) ON DELETE SET NULL,
    manual_class_id UUID REFERENCES public.payroll_manual_class(id) ON DELETE SET NULL,
    -- "Never both", not "exactly one" — after the parent is deleted the owning
    -- side is null, and the source column remains the discriminator.
    CONSTRAINT trainer_bill_one_source CHECK (
        (source = 'wsq'    AND manual_class_id IS NULL)
     OR (source = 'manual' AND payout_id IS NULL)
    ),
    -- Unique among LIVE bills only (see idx_trainer_bill_no_live). The ref
    -- belongs to the payout, not to one billing attempt: un-confirming voids
    -- the row but leaves the number on the payout, and re-confirming raises a
    -- new bill under the SAME number. A table-wide UNIQUE would reject that.
    bill_no   TEXT NOT NULL,
    bill_date DATE NOT NULL,
    trainer_id   UUID,
    trainer_name TEXT NOT NULL,
    course_title TEXT NOT NULL,
    course_code  TEXT,
    amount       NUMERIC(12,2) NOT NULL,
    vendor_ref   TEXT,
    vendor_name  TEXT,
    qb_bill_id   TEXT,
    -- The generated PDF in Google Drive: file id (for staleness checks) and the
    -- link the Payroll "View PDF" button opens.
    drive_file_id   TEXT,
    drive_view_link TEXT,
    status TEXT NOT NULL DEFAULT 'pending'
        CHECK (status IN ('pending','posted','failed','voided')),
    error TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    created_by UUID REFERENCES public.app_user(id)
)`;

// Additive columns for tables created by an earlier build of this feature.
const COLUMNS = [
  `ALTER TABLE public.trainer_bill ADD COLUMN IF NOT EXISTS drive_file_id TEXT`,
  `ALTER TABLE public.trainer_bill ADD COLUMN IF NOT EXISTS drive_view_link TEXT`,
];

// Migrate a table created by an earlier build off ON DELETE CASCADE. Each pair
// drops then re-adds, so the whole list stays idempotent.
const CONSTRAINTS = [
  `ALTER TABLE public.trainer_bill DROP CONSTRAINT IF EXISTS trainer_bill_payout_id_fkey`,
  `ALTER TABLE public.trainer_bill ADD CONSTRAINT trainer_bill_payout_id_fkey
     FOREIGN KEY (payout_id) REFERENCES public.trainer_payout(id) ON DELETE SET NULL`,
  `ALTER TABLE public.trainer_bill DROP CONSTRAINT IF EXISTS trainer_bill_manual_class_id_fkey`,
  `ALTER TABLE public.trainer_bill ADD CONSTRAINT trainer_bill_manual_class_id_fkey
     FOREIGN KEY (manual_class_id) REFERENCES public.payroll_manual_class(id) ON DELETE SET NULL`,
  `ALTER TABLE public.trainer_bill DROP CONSTRAINT IF EXISTS trainer_bill_one_source`,
  `ALTER TABLE public.trainer_bill ADD CONSTRAINT trainer_bill_one_source CHECK (
       (source = 'wsq'    AND manual_class_id IS NULL)
    OR (source = 'manual' AND payout_id IS NULL)
   )`,
];

const INDEXES = [
  // Drop the old table-wide UNIQUE if this table was created by an earlier
  // build — re-confirming a payout would otherwise fail on its own number.
  `ALTER TABLE public.trainer_bill DROP CONSTRAINT IF EXISTS trainer_bill_bill_no_key`,
  `CREATE UNIQUE INDEX IF NOT EXISTS idx_trainer_bill_no_live
     ON public.trainer_bill(bill_no)
     WHERE status <> 'voided'`,
  `CREATE UNIQUE INDEX IF NOT EXISTS idx_trainer_bill_payout_live
     ON public.trainer_bill(payout_id)
     WHERE payout_id IS NOT NULL AND status <> 'voided'`,
  `CREATE UNIQUE INDEX IF NOT EXISTS idx_trainer_bill_manual_live
     ON public.trainer_bill(manual_class_id)
     WHERE manual_class_id IS NOT NULL AND status <> 'voided'`,
  `CREATE INDEX IF NOT EXISTS idx_trainer_bill_status  ON public.trainer_bill(status)`,
  `CREATE INDEX IF NOT EXISTS idx_trainer_bill_date    ON public.trainer_bill(bill_date DESC)`,
  `CREATE INDEX IF NOT EXISTS idx_trainer_bill_trainer ON public.trainer_bill(trainer_id)`,
];

export function ensureTrainerBillTable(): Promise<void> {
  if (!ensured) {
    ensured = (async () => {
      await pool.query(DDL);
      for (const sql of COLUMNS) await pool.query(sql);
      for (const sql of CONSTRAINTS) await pool.query(sql);
      for (const sql of INDEXES) await pool.query(sql);

      // Discard withdrawn bills that never reached QuickBooks. They reference
      // no QBO document and no Drive file, so they are pure noise in the
      // Billing Invoices list. onPayoutUnconfirmed now deletes these instead of
      // voiding them; this clears any left by earlier builds. Safe by
      // construction — the WHERE clause cannot match a bill that ever posted.
      const purged = await pool.query(
        `DELETE FROM trainer_bill WHERE status = 'voided' AND qb_bill_id IS NULL`
      );
      if (purged.rowCount) {
        console.log(`[payroll] Discarded ${purged.rowCount} withdrawn bill(s) that never reached QuickBooks.`);
      }
    })().catch((err) => {
      ensured = null; // allow a retry on the next request
      console.warn('[payroll] ensureTrainerBillTable failed:', err instanceof Error ? err.message : err);
    });
  }
  return ensured;
}
