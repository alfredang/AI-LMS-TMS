import type { NextApiRequest, NextApiResponse } from 'next';
import { runDateSync } from '../external/sync-course-run-dates';

/**
 * POST /api/admin/run-date-sync
 * Admin-accessible trigger for the course run date sync (no API key required).
 */
export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ success: false, error: 'Method not allowed' });
  }

  try {
    const result = await runDateSync();
    return res.status(200).json({ success: true, ...result });
  } catch (err) {
    console.error('❌ run-date-sync error:', err);
    return res.status(500).json({
      success: false,
      error: err instanceof Error ? err.message : 'Internal server error',
    });
  }
}
