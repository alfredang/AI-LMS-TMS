import type { NextApiRequest, NextApiResponse } from 'next';
import { runAutomation } from '../../api/external/auto-sanitise-data';

/**
 * POST /api/admin/run-auto-sanitise-data
 *
 * Admin "Run Once" trigger for the Auto Sanitise Data sweep.
 * No API key required — protected by the admin session layer.
 */
export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const result = await runAutomation();
    return res.status(200).json({ success: true, ...result });
  } catch (err) {
    console.error('❌ run-auto-sanitise-data error:', err);
    return res.status(500).json({ success: false, error: err instanceof Error ? err.message : 'Unknown error' });
  }
}
