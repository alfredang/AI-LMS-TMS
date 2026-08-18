import pool from '../db';

// Idempotently ensure the payroll-local override columns on trainer_payout
// exist, memoized so the (additive, IF NOT EXISTS) ALTER runs at most ONCE per
// process rather than on every payroll request — same pattern, and the same
// reasoning, as ensureClassDates.ts. Keep in sync with
// database/migrations/add_payout_end_date_override.sql.
let ensured: Promise<void> | null = null;

export function ensurePayoutColumns(): Promise<void> {
  if (!ensured) {
    ensured = pool
      .query(`ALTER TABLE public.trainer_payout ADD COLUMN IF NOT EXISTS end_date_override DATE`)
      .then(() => undefined)
      .catch((err) => {
        ensured = null; // allow a retry on the next request
        console.warn('[payroll] ensurePayoutColumns failed:', err instanceof Error ? err.message : err);
      });
  }
  return ensured;
}

/**
 * The end date payroll should use for a payout row: the Payroll correction if
 * one was entered, otherwise the class's own end date. Both the payout list and
 * the trainer-bill builder must resolve it the same way, or a corrected date
 * would move the row in the list but still bill under the old one.
 */
export const EFFECTIVE_END_DATE = `COALESCE(tp.end_date_override, cr.end_date)`;
