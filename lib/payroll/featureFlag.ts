import pool from '@lib/db';

let cachedFlag: { value: boolean; at: number } | null = null;
const TTL_MS = 30_000;

/**
 * The flag as it actually stands, or `null` when it could not be determined —
 * the database is unreachable, or this tenant's `training_provider` predates the
 * column.
 *
 * The distinction matters because the flag now gates every payroll API route.
 * Collapsing "couldn't ask" into "it's off" would turn a transient database
 * blip into a blanket 403 across Payroll, which reads to the user as "my access
 * was revoked" rather than "something is broken". Callers decide which way to
 * lean; see isPayrollEnabled (leans off) and requirePayrollEnabled (leans on).
 */
export async function getPayrollEnabled(): Promise<boolean | null> {
  if (cachedFlag && Date.now() - cachedFlag.at < TTL_MS) return cachedFlag.value;
  try {
    const r = await pool.query(`SELECT payroll_enabled FROM training_provider ORDER BY id LIMIT 1`);
    const v = !!r.rows[0]?.payroll_enabled;
    cachedFlag = { value: v, at: Date.now() };
    return v;
  } catch (e) {
    // Not cached: an outage must not pin the answer for the next 30 seconds.
    console.warn('[payroll] could not read payroll_enabled:', e instanceof Error ? e.message : e);
    return null;
  }
}

/**
 * Is payroll on? Undetermined counts as OFF.
 *
 * For the role-listing callers (login, /api/users/role), where the cost of
 * guessing wrong is only that a role is missing from a picker — recoverable by
 * signing in again once the database is back.
 */
export async function isPayrollEnabled(): Promise<boolean> {
  return (await getPayrollEnabled()) === true;
}

export function invalidatePayrollFlagCache() {
  cachedFlag = null;
}

