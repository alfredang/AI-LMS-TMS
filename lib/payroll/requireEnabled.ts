import type { NextApiResponse } from 'next';
import { getPayrollEnabled } from './featureFlag';

/**
 * Gate a payroll API route on the tenant's `payroll_enabled` flag.
 *
 * The flag used to be consulted only at login and in /api/users/role, so
 * turning payroll off hid the role from future sign-ins but left every payroll
 * endpoint wide open — an already-authenticated session (or any direct call)
 * kept working indefinitely. Enforcing it per request is what makes the switch
 * mean something.
 *
 * Deliberately NOT applied to /api/payroll/tiers: that route owns the flag, and
 * gating it on the flag would make a disabled tenant impossible to re-enable.
 *
 * Returns true when the caller may proceed; otherwise it has already sent 403.
 */
export async function requirePayrollEnabled(res: NextApiResponse): Promise<boolean> {
  const enabled = await getPayrollEnabled();
  // Only a definite `false` blocks. `null` means the flag could not be read at
  // all — refusing then would turn a database blip into "Payroll is switched
  // off" for every user at once, which is both wrong and alarming. The request
  // continues and fails on its own query instead, with an honest error.
  if (enabled !== false) return true;
  res.status(403).json({
    success: false,
    error: 'Payroll is switched off for this account. An administrator can re-enable it in Payout Tier Settings.',
  });
  return false;
}
