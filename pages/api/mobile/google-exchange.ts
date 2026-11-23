import type { NextApiRequest, NextApiResponse } from 'next';
import { limited } from '../../../lib/android/auth';
import { exchangeMobileGoogleCode } from '../../../lib/mobileGoogleSignIn';

// PUBLIC: trades the single-use code from the Google callback plus the app's verifier for a
// mobile session. See lib/mobileGoogleSignIn.ts.
export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') return res.status(405).end();
  const fwd = req.headers['x-forwarded-for'];
  const ip = (Array.isArray(fwd) ? fwd[0] : fwd || '').split(',')[0].trim() || req.socket?.remoteAddress || 'unknown';
  if (await limited(`mobile-google:ip:${ip}`, 30, 15)) {
    return res.status(429).json({ error: 'Too many attempts. Please try again in 15 minutes.' });
  }
  return exchangeMobileGoogleCode(req, res);
}
