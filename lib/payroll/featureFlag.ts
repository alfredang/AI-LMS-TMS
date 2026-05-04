import pool from '@lib/db';

let cachedFlag: { value: boolean; at: number } | null = null;
const TTL_MS = 30_000;

export async function isPayrollEnabled(): Promise<boolean> {
  if (cachedFlag && Date.now() - cachedFlag.at < TTL_MS) return cachedFlag.value;
  try {
    const r = await pool.query(`SELECT payroll_enabled FROM training_provider ORDER BY id LIMIT 1`);
    const v = !!r.rows[0]?.payroll_enabled;
    cachedFlag = { value: v, at: Date.now() };
    return v;
  } catch (e) {
    console.warn('isPayrollEnabled: query failed, defaulting to false', e);
    return false;
  }
}

export function invalidatePayrollFlagCache() {
  cachedFlag = null;
}

export function filterPayrollRole<T extends string>(roles: T[], enabled: boolean): T[] {
  if (enabled) return roles;
  return roles.filter((r) => r !== 'Payroll' && r !== 'payroll');
}
