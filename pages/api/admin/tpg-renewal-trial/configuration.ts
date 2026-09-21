import type { NextApiRequest, NextApiResponse } from 'next';
import { withAuth } from '@lib/auth/withAuth';
import { renewalConfiguration } from '@lib/tpg/renewalTrialRequest';

function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') return res.status(405).end();
  res.setHeader('Cache-Control', 'no-store');
  if ((req as any).authUser?.isService) return res.status(403).end();
  return res.status(200).json(renewalConfiguration());
}

export default withAuth(handler, { roles: ['admin', 'developer'] });
