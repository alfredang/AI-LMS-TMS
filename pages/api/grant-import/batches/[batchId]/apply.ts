import type { NextApiRequest, NextApiResponse } from 'next';
import { requireFinanceOrAdmin } from '@/lib/services/grantImport/requireFinanceOrAdmin';
import { applyGrantImportBatch } from '@/lib/services/grantImport/grantImportApply';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
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

    const out = await applyGrantImportBatch({
      batchId,
      actorUserId,
      dryRun,
      allowOverwriteAlreadyApplied,
    });

    return res.status(200).json({ success: true, data: out });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : 'Internal server error';
    return res.status(500).json({ success: false, error: msg });
  }
}

