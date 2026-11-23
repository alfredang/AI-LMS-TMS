import { withAuth, AuthedApiRequest } from '@lib/auth/withAuth';
import type { NextApiRequest, NextApiResponse } from 'next';
import {
  getLatestSnapshot,
  getReconJobState,
  getSnapshotHistory,
  startReconJob,
} from '@/lib/services/receivablesRecon/reconJob';

/**
 * GET  /api/finance/receivables-recon  → latest overdue breakdown snapshot + refresh status + history
 * POST /api/finance/receivables-recon  { action: 'refresh' | 'refreshTpg' } → start a background refresh
 *
 * Read-only towards QuickBooks and TPG: 'refresh' re-reads QuickBooks; 'refreshTpg' first re-reads
 * the overdue grants / SFC claims from TPG into ssg_grants / ssg_claims, then re-reads QuickBooks.
 */
async function handler(req: NextApiRequest, res: NextApiResponse) {
  try {
    if (req.method === 'GET') {
      const [snapshot, history] = await Promise.all([getLatestSnapshot(), getSnapshotHistory(30)]);
      return res.status(200).json({ success: true, data: { job: getReconJobState(), snapshot, history } });
    }
    if (req.method === 'POST') {
      const action = String(req.body?.action || '');
      if (action !== 'refresh' && action !== 'refreshTpg') {
        return res.status(400).json({ success: false, error: "action must be 'refresh' or 'refreshTpg'" });
      }
      const user = (req as AuthedApiRequest).authUser;
      const started = startReconJob(action === 'refreshTpg' ? 'tpg' : 'quickbooks', user && !user.isService ? user.id : null);
      return res.status(started ? 202 : 409).json({
        success: started,
        error: started ? undefined : 'A refresh is already running',
        data: { job: getReconJobState() },
      });
    }
    res.setHeader('Allow', ['GET', 'POST']);
    return res.status(405).json({ success: false, error: 'Method not allowed' });
  } catch (e) {
    console.error('[receivables-recon]', e);
    return res.status(500).json({ success: false, error: e instanceof Error ? e.message : 'Internal server error' });
  }
}

export default withAuth(handler, { roles: ['admin', 'finance'] });
