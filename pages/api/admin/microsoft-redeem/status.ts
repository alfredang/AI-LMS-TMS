/**
 * GET /api/admin/microsoft-redeem/status
 *
 * Reports whether a Microsoft Learn session is currently stored.
 */
import type { NextApiRequest, NextApiResponse } from 'next';
import { getStoredSession } from '../../../../lib/microsoft-redeem/db';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') {
    return res.status(405).json({ ok: false, error: 'Method Not Allowed' });
  }
  try {
    const session = await getStoredSession();
    return res.status(200).json({
      ok: true,
      signedIn: !!session,
      email: session?.email ?? null,
      updatedAt: session?.updatedAt ?? null,
    });
  } catch (err: any) {
    return res
      .status(500)
      .json({ ok: false, error: err?.message || 'Failed to read session status' });
  }
}
