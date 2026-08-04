import { withAuth } from '@lib/auth/withAuth';
import type { NextApiRequest, NextApiResponse } from 'next';
import { unconfirmClass } from '@lib/class/unconfirmClass';

/**
 * Dedicated "Unconfirm class" action (multi-step + hits SSG), kept out of the
 * generic class-status PUT. The status dropdown's "Unconfirmed" option calls this.
 */
async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ success: false, error: 'Method not allowed' });
  }
  const { courseRunUuid, id } = req.body || {};
  const runId = courseRunUuid || id;
  if (!runId) {
    return res.status(400).json({ success: false, error: 'courseRunUuid (or id) is required' });
  }
  try {
    const result = await unconfirmClass(String(runId));
    return res.status(result.status === 'ok' ? 200 : 500).json({ success: result.status === 'ok', ...result });
  } catch (error) {
    return res.status(500).json({ success: false, error: error instanceof Error ? error.message : 'Unknown error' });
  }
}

export default withAuth(handler, { roles: ['admin', 'trainingProvider', 'developer'] });
