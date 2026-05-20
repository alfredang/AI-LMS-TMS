/**
 * GET /api/admin/microsoft-redeem/export-session
 *
 * Returns the currently-stored Microsoft Learn storageState as a JSON file
 * download. Lets an admin export the session captured on localhost (where
 * the headed sign-in works) and re-import it on a headless production
 * deployment via /api/admin/microsoft-redeem/import-session.
 */
import type { NextApiRequest, NextApiResponse } from 'next';
import { getStoredSession } from '../../../../lib/microsoft-redeem/db';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') {
    return res.status(405).json({ ok: false, error: 'Method Not Allowed' });
  }
  try {
    const session = await getStoredSession();
    if (!session) {
      return res
        .status(404)
        .json({ ok: false, error: 'No Microsoft Learn session is stored yet.' });
    }
    const payload = {
      version: 1,
      email: session.email,
      updatedAt: session.updatedAt,
      storageState: session.storageState,
    };
    const filename = `microsoft-learn-session-${new Date().toISOString().slice(0, 10)}.json`;
    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    return res.status(200).send(JSON.stringify(payload, null, 2));
  } catch (err: any) {
    return res
      .status(500)
      .json({ ok: false, error: err?.message || 'Failed to export session' });
  }
}
