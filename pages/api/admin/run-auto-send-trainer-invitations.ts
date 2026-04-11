import type { NextApiRequest, NextApiResponse } from 'next';
import { runAutomation } from '../../api/external/auto-send-trainer-invitations';

/**
 * POST /api/admin/run-auto-send-trainer-invitations
 *
 * Admin "Run Now" trigger for the Auto Send Trainer Invitations sweep.
 * No API key required — protected by the admin session layer.
 */
export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const result = await runAutomation();
    return res.status(200).json({ success: true, ...result });
  } catch (err) {
    console.error('❌ run-auto-send-trainer-invitations error:', err);
    return res.status(500).json({ success: false, error: err instanceof Error ? err.message : 'Unknown error' });
  }
}
