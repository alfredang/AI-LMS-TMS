import type { NextApiRequest, NextApiResponse } from 'next';
import fs from 'fs';
import { getJob } from '../../../lib/cw-slides-jobs';

export const config = {
  api: {
    responseLimit: false, // allow streaming arbitrarily large PPTX files
  },
};

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });
  const jobId = String(req.query.jobId || '');
  if (!jobId) return res.status(400).json({ error: 'Missing jobId' });

  const job = getJob(jobId);
  if (!job) return res.status(404).json({ error: 'Job not found' });
  if (job.status !== 'done' || !job.result) {
    return res.status(409).json({ error: `Job not ready (status=${job.status})` });
  }
  const { filePath, fileName } = job.result;
  if (!fs.existsSync(filePath)) {
    return res.status(410).json({ error: 'Generated file no longer available' });
  }

  const stat = fs.statSync(filePath);
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.presentationml.presentation');
  res.setHeader('Content-Length', stat.size.toString());
  res.setHeader('Content-Disposition', `attachment; filename="${fileName}"`);

  const stream = fs.createReadStream(filePath);
  stream.on('error', (err) => {
    console.error('[cw-slides-download] stream error:', err);
    try { res.end(); } catch {}
  });
  stream.pipe(res);
}
