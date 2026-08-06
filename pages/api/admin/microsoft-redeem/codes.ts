import { withAuth } from '@lib/auth/withAuth';
/**
 * GET /api/admin/microsoft-redeem/codes?limit=50
 *
 * Returns the most recently generated achievement codes (history).
 */
import type { NextApiRequest, NextApiResponse } from 'next';
import { listCodes } from '../../../../lib/microsoft-redeem/db';

async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') {
    return res.status(405).json({ ok: false, error: 'Method Not Allowed' });
  }
  try {
    const limit = Math.min(Math.max(Number(req.query.limit) || 50, 1), 200);
    const codes = await listCodes(limit);
    return res.status(200).json({ ok: true, codes });
  } catch (err: any) {
    return res
      .status(500)
      .json({ ok: false, error: err?.message || 'Failed to load code history' });
  }
}

export default withAuth(handler, { roles: ['admin', 'trainingProvider', 'developer'] });
