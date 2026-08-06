import { withAuth } from '@lib/auth/withAuth';
import type { NextApiRequest, NextApiResponse } from 'next';
import { getJob } from '../../../lib/cw-slides-jobs';

async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });
  const jobId = String(req.query.jobId || '');
  if (!jobId) return res.status(400).json({ error: 'Missing jobId' });

  const job = getJob(jobId);
  if (!job) return res.status(404).json({ error: 'Job not found' });

  return res.status(200).json({
    id: job.id,
    status: job.status,
    progress: job.progress,
    slideCount: job.result?.slideCount,
    fileName: job.result?.fileName,
    stats: job.result?.stats,
    message: job.result?.message,
    error: job.error,
  });
}

export default withAuth(handler, { roles: ['admin', 'trainingProvider', 'developer'] });
