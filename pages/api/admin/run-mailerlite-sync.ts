import type { NextApiRequest, NextApiResponse } from 'next';
import { runAutomation } from '../external/sync-learners-to-mailerlite';
import { requireRole } from '@lib/auth/requireRole';

/**
 * POST /api/admin/run-mailerlite-sync
 *
 * Admin "Run Once" trigger for the MailerLite learner-email sync.
 */
export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const authed = await requireRole(req, res, ['admin', 'trainingProvider', 'developer']);
  if (!authed) return;

  try {
    const result = await runAutomation();
    return res.status(200).json({ success: true, ...result });
  } catch (err) {
    console.error('❌ run-mailerlite-sync error:', err);
    return res.status(500).json({ success: false, error: err instanceof Error ? err.message : 'Unknown error' });
  }
}
