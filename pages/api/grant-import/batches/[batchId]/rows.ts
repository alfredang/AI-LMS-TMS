import { withAuth } from '@lib/auth/withAuth';
import type { NextApiRequest, NextApiResponse } from 'next';
import { requireFinanceOrAdmin } from '@/lib/services/grantImport/requireFinanceOrAdmin';
import { updateGrantImportRowSelection } from '@/lib/services/grantImport/grantImportDb';

async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'PATCH') {
    res.setHeader('Allow', ['PATCH']);
    return res.status(405).json({ success: false, error: 'Method not allowed' });
  }

  const batchId = typeof req.query.batchId === 'string' ? req.query.batchId.trim() : '';
  if (!batchId) return res.status(400).json({ success: false, error: 'batchId is required' });

  const updatesRaw = req.body?.updates;
  const updates = Array.isArray(updatesRaw)
    ? updatesRaw
        .map((u: any) => ({ id: String(u?.id ?? '').trim(), selected: Boolean(u?.selected) }))
        .filter((u: any) => u.id)
    : [];

  if (updates.length === 0) {
    return res.status(400).json({ success: false, error: 'updates array is required' });
  }
  if (updates.length > 500) {
    return res.status(400).json({ success: false, error: 'Too many updates (max 500)' });
  }

  try {
    await requireFinanceOrAdmin(req);
    await updateGrantImportRowSelection(batchId, updates);
    return res.status(200).json({ success: true });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : 'Internal server error';
    return res.status(500).json({ success: false, error: msg });
  }
}

export default withAuth(handler, { roles: ['admin', 'trainingProvider', 'finance'] });
