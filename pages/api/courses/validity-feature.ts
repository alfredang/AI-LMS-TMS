import { withAuth } from '@lib/auth/withAuth';
import { isCourseValidityTpgEnabled } from '@lib/courseValidityFeature';
import type { NextApiRequest, NextApiResponse } from 'next';

async function handler(req: NextApiRequest, res: NextApiResponse) {
  res.setHeader('Cache-Control', 'no-store, max-age=0');
  if (req.method !== 'GET') return res.status(405).json({ message: 'Method not allowed' });
  return res.status(200).json({ enabled: await isCourseValidityTpgEnabled() });
}

export default withAuth(handler, { roles: ['admin', 'trainingProvider', 'developer'] });
