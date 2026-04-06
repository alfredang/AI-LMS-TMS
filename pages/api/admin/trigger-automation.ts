import type { NextApiRequest, NextApiResponse } from 'next';
import { runAutomation } from '../external/auto-create-learners';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ success: false, message: 'Method not allowed' });
  }

  try {
    const result = await runAutomation();
    return res.status(200).json({ success: true, ...result });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    console.error('❌ trigger-automation error:', err);
    return res.status(500).json({ success: false, message });
  }
}
