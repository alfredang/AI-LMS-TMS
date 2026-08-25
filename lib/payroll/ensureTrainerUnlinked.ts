import pool from '../db';

/**
 * Idempotently ensure `payroll_manual_class.trainer_unlinked` exists, memoized
 * so the (additive, IF NOT EXISTS) ALTER runs at most ONCE per process rather
 * than on every payroll request — the same treatment ensureClassDates.ts gives
 * its column, and for the same reason: repeated momentary ACCESS EXCLUSIVE
 * locks on a hot table under load.
 *
 * The column records that Payroll deliberately declined to link a class to a
 * trainer account. Without it, `trainer_id IS NULL` cannot be told apart from
 * "not matched yet", and re-saving the class would silently re-apply the name
 * match that was refused. Keep in sync with
 * database/migrations/add_payroll_trainer_unlinked.sql.
 *
 * On failure the memo is reset so a later request retries.
 */
let ensured: Promise<void> | null = null;

export function ensureTrainerUnlinkedColumn(): Promise<void> {
  if (!ensured) {
    ensured = pool
      .query(
        `ALTER TABLE public.payroll_manual_class
           ADD COLUMN IF NOT EXISTS trainer_unlinked BOOLEAN NOT NULL DEFAULT FALSE`
      )
      .then(() => undefined)
      .catch((err) => {
        ensured = null; // allow a retry on the next request
        console.warn(
          '[payroll] ensureTrainerUnlinkedColumn failed:',
          err instanceof Error ? err.message : err
        );
      });
  }
  return ensured;
}
