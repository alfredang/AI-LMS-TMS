import type { NextApiRequest, NextApiResponse } from 'next';
import { withAuth } from '@lib/auth/withAuth';
import { createTrialPlan } from '@lib/tpg/renewalTrial';
import { saveTrialJob } from '@lib/tpg/renewalTrialJobs';
import { guardRenewalTrial, reportTrialError } from '@lib/tpg/renewalTrialRequest';

export const config = { api: { bodyParser: { sizeLimit: '5mb' } } };

async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') return res.status(405).json({ success: false, message: 'Method not allowed' });
  if (!guardRenewalTrial(req, res)) return;
  try {
    const captures = req.body?.captures;
    const plan = await createTrialPlan(captures);
    const jobId = await saveTrialJob((req as any).authUser.id, captures, plan);
    return res.status(200).json({ success: true, jobId, plan });
  } catch (error) {
    reportTrialError(res, error);
  }
}

export default withAuth(handler, { roles: ['admin', 'developer'] });
