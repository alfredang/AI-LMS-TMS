/**
 * GET /api/finance/grant-fetch/helper
 *
 * Is an office agent (scripts/tpg-grant-fetch-agent.mjs) currently listening
 * for work? TPGateway refuses connections from this server, so runs started
 * here are driven by an agent on a trusted network. Whether one is running is
 * otherwise invisible: staff click Fetch & Upload and the run either starts or
 * waits indefinitely, with nothing to tell them which. This lets the page say
 * so before they click. Mirrors pages/api/admin/tpg-confirm/helper.ts.
 *
 * Reports 'notNeeded' where the browser runs locally — an operator's own
 * machine has no agent and needs none.
 */
import type { NextApiRequest, NextApiResponse } from 'next';
import { requireRole } from '@lib/auth/requireRole';
import { grantFetchAgentStatus } from '@lib/tpg/grantFetchJobStore';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') {
    return res.status(405).json({ success: false, error: 'Method Not Allowed' });
  }

  const user = await requireRole(req, res, ['admin', 'developer', 'trainingProvider', 'finance']);
  if (!user) return; // requireRole already sent 401/403

  const runsHere = process.env.NODE_ENV !== 'production' || process.env.TPG_SERVER_BROWSER === 'true';

  if (runsHere) {
    return res.status(200).json({ success: true, notNeeded: true, online: true, lastSeenAt: null });
  }

  return res.status(200).json({ success: true, notNeeded: false, ...grantFetchAgentStatus() });
}
