import type { NextApiRequest, NextApiResponse } from 'next';
import { RenewalPlanError } from './renewalSync';

export function renewalConfiguration() {
  const local = process.env.ENABLE_TPG_RENEWAL_TRIAL === 'true';
  const enabled = local || process.env.ENABLE_TPG_RENEWAL_SYNC === 'true';
  const value = local ? 'http://localhost:3000' : process.env.TPG_RENEWAL_ORIGIN;
  let origin = '';
  try { origin = new URL(value || '').origin; } catch { /* Missing configuration disables access. */ }
  return { enabled: enabled && Boolean(origin) && (local || (origin.startsWith('https://') && Boolean(process.env.TPG_RENEWAL_JOB_DIR))), origin, local };
}

export function guardRenewalTrial(req: NextApiRequest, res: NextApiResponse): boolean {
  const configuration = renewalConfiguration();
  if (!configuration.enabled) {
    res.status(404).json({ success: false, message: 'TPG renewal trial is disabled.' });
    return false;
  }
  if (req.headers.origin !== configuration.origin) {
    res.status(403).json({ success: false, message: 'Renewal updates must originate from the configured TIA website.' });
    return false;
  }
  const user = (req as any).authUser;
  if (!user || user.isService) {
    res.status(403).json({ success: false, message: 'An interactive authorised session is required.' });
    return false;
  }
  return true;
}

export function reportTrialError(res: NextApiResponse, error: unknown): void {
  const message = error instanceof Error ? error.message : String(error);
  const status = error instanceof RenewalPlanError ? 400 : 500;
  if (status === 500) console.error('TPG renewal trial error:', error);
  res.status(status).json({ success: false, message });
}
