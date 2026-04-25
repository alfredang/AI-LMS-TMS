import type { NextApiRequest, NextApiResponse } from 'next';
import { requireFinanceOrAdmin } from '@/lib/services/grantImport/requireFinanceOrAdmin';
import { getSfcImportUploadJob } from '@/lib/services/sfcImport/sfcImportUploadJob';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', ['GET']);
    return res.status(405).json({ success: false, error: 'Method not allowed' });
  }

  try {
    await requireFinanceOrAdmin(req);
    const jobId = String(req.query.jobId || '').trim();
    if (!jobId) return res.status(400).json({ success: false, error: 'Missing jobId' });

    const job = getSfcImportUploadJob(jobId);
    if (!job) return res.status(404).json({ success: false, error: 'Job not found or expired' });
    return res.status(200).json({ success: true, data: job });
  } catch (e: unknown) {
    return res.status(500).json({ success: false, error: e instanceof Error ? e.message : 'Internal server error' });
  }
}
