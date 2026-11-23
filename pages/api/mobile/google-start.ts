import type { NextApiRequest, NextApiResponse } from 'next';
import { startMobileGoogleSignIn } from '../../../lib/mobileGoogleSignIn';

// PUBLIC: starts admin sign-in with Google for the TIA TMS apps. See lib/mobileGoogleSignIn.ts.
export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') return res.status(405).end();
  return startMobileGoogleSignIn(req, res);
}
