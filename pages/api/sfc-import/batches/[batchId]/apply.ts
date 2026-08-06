import { withAuth } from '@lib/auth/withAuth';
import type { NextApiRequest, NextApiResponse } from 'next';
import { requireFinanceOrAdmin } from '@/lib/services/grantImport/requireFinanceOrAdmin';
import { applySfcImportRows } from '@/lib/services/sfcImport/sfcImportApply';

async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', ['POST']);
    return res.status(405).json({ success: false, error: 'Method not allowed' });
  }

  const batchId = parseInt(String(req.query.batchId || ''), 10);
  if (!Number.isFinite(batchId) || batchId <= 0) {
    return res.status(400).json({ success: false, error: 'batchId is required' });
  }

  try {
    const { actorUserId } = await requireFinanceOrAdmin(req);

    const rawRowIds = req.body?.rowIds;
    const rowIds: number[] = Array.isArray(rawRowIds)
      ? rawRowIds.map((x: unknown) => parseInt(String(x ?? ''), 10)).filter((n: number) => Number.isFinite(n) && n > 0)
      : [];

    if (rowIds.length === 0) {
      return res.status(400).json({ success: false, error: 'rowIds array is required' });
    }

    const out = await applySfcImportRows({ batchId, rowIds, actorUserId });
    return res.status(200).json({ success: true, data: out });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : 'Internal server error';
    return res.status(500).json({ success: false, error: msg });
  }
}

export default withAuth(handler, { roles: ['admin', 'trainingProvider', 'finance'] });
