import type { NextApiRequest, NextApiResponse } from 'next';
import { requireFinanceOrAdmin } from '@/lib/services/grantImport/requireFinanceOrAdmin';
import { getGrantImportBatchPreview } from '@/lib/services/grantImport/grantImportDb';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', ['GET']);
    return res.status(405).json({ success: false, error: 'Method not allowed' });
  }

  const batchId = typeof req.query.batchId === 'string' ? req.query.batchId.trim() : '';
  if (!batchId) return res.status(400).json({ success: false, error: 'batchId is required' });

  try {
    await requireFinanceOrAdmin(req);
    const { batch, rows } = await getGrantImportBatchPreview(batchId);
    return res.status(200).json({ success: true, data: { batch, rows } });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : 'Internal server error';
    return res.status(500).json({ success: false, error: msg });
  }
}

