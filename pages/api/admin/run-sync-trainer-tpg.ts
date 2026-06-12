import type { NextApiRequest, NextApiResponse } from 'next';
import { runSyncTrainerToTpg } from '../../api/external/sync-trainer-to-tpg';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const result = await runSyncTrainerToTpg();
    return res.status(200).json({ success: true, ...result });
  } catch (err) {
    console.error('❌ run-sync-trainer-tpg error:', err);
    return res.status(500).json({ success: false, error: err instanceof Error ? err.message : 'Unknown error' });
  }
}
