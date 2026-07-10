import pool from '../db';

// Idempotently ensure the non-consecutive-dates column exists, memoized so the
// (additive, IF NOT EXISTS) ALTER runs at most ONCE per process instead of on
// every payroll request — avoids repeated momentary ACCESS EXCLUSIVE table
// locks under load. On failure we reset the memo so a later request retries.
let ensured: Promise<void> | null = null;

export function ensureClassDatesColumn(): Promise<void> {
  if (!ensured) {
    ensured = pool
      .query(`ALTER TABLE public.payroll_manual_class ADD COLUMN IF NOT EXISTS class_dates TEXT`)
      .then(() => undefined)
      .catch((err) => {
        ensured = null; // allow a retry on the next request
        console.warn('[payroll] ensureClassDatesColumn failed:', err instanceof Error ? err.message : err);
      });
  }
  return ensured;
}
