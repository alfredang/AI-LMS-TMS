import { withAuth } from '@lib/auth/withAuth';
import type { NextApiRequest, NextApiResponse } from 'next';
import { requireFinanceOrAdmin } from '@/lib/services/grantImport/requireFinanceOrAdmin';
import { applyGrantImportBatch } from '@/lib/services/grantImport/grantImportApply';
import { acquireGrantImportRunLock, withGrantImportRunLock } from '@/lib/services/grantImport/grantImportRunLock';

async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', ['POST']);
    return res.status(405).json({ success: false, error: 'Method not allowed' });
  }

  const batchId = typeof req.query.batchId === 'string' ? req.query.batchId.trim() : '';
  if (!batchId) return res.status(400).json({ success: false, error: 'batchId is required' });

  try {
    const { actorUserId } = await requireFinanceOrAdmin(req);
    const dryRun = Boolean(req.body?.dryRun ?? true);
    const allowOverwriteAlreadyApplied = Boolean(req.body?.allowOverwriteAlreadyApplied ?? false);
    const rowIds: string[] | undefined = Array.isArray(req.body?.rowIds)
      ? (req.body.rowIds as unknown[]).map((x) => String(x)).filter(Boolean)
      : undefined;

    // Only one Bulk Grant run at a time across all users — see grantImportRunLock.
    const lock = await acquireGrantImportRunLock('apply', actorUserId, batchId);
    if (!lock.ok) return res.status(409).json({ success: false, error: lock.message, busy: lock.holder });

    const out = await withGrantImportRunLock(lock.token, () => applyGrantImportBatch({
      batchId,
      actorUserId,
      dryRun,
      allowOverwriteAlreadyApplied,
      rowIds: rowIds && rowIds.length > 0 ? rowIds : undefined,
    }));

    return res.status(200).json({ success: true, data: out });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : 'Internal server error';
    return res.status(500).json({ success: false, error: msg });
  }
}

export default withAuth(handler, { roles: ['admin', 'trainingProvider', 'finance'] });
