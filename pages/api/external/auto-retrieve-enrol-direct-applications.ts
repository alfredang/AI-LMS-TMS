import type { NextApiRequest, NextApiResponse } from 'next';
import { withServiceAuth } from '@lib/auth/withAuth';
import { runDirectApplicationAutomation } from '@lib/directApplicationAutomation';

export const config = { maxDuration: 300 };
async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') return res.status(405).json({ success: false, error: 'Method not allowed' });
  try {
    const report = await runDirectApplicationAutomation();
    return res.status(report?.status === 'failed' ? 500 : 200).json({ success: !report || report.error_count === 0,
      skipped: !report, message: !report ? 'Another automatic run is already working' : undefined, report });
  } catch {
    return res.status(500).json({ success: false, error: 'Unable to record automation run; check server logs' });
  }
}
export default withServiceAuth(handler);
