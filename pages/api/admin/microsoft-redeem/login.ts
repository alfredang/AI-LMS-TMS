/**
 * POST /api/admin/microsoft-redeem/login
 *
 * Runs the one-time headless Microsoft Learn sign-in using the MS_EMAIL /
 * MS_PASSWORD environment variables and persists the session for the code
 * generator to reuse.
 */
import type { NextApiRequest, NextApiResponse } from 'next';
import { runMicrosoftLogin } from '../../../../lib/microsoft-redeem/login';

// Playwright sign-in can take up to ~1 minute; keep the route alive for it.
export const config = {
  api: { responseLimit: false },
  maxDuration: 300,
};

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ ok: false, error: 'Method Not Allowed' });
  }
  try {
    const body = req.body || {};
    const email = typeof body.email === 'string' ? body.email : undefined;
    const password = typeof body.password === 'string' ? body.password : undefined;
    const result = await runMicrosoftLogin({ email, password });
    return res.status(result.ok ? 200 : 400).json(result);
  } catch (err: any) {
    return res
      .status(500)
      .json({ ok: false, error: err?.message || 'Microsoft sign-in failed' });
  }
}
