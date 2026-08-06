import { withAuth } from '@lib/auth/withAuth';
import type { NextApiRequest, NextApiResponse } from 'next';
import { getZoomCurrentUser, saveZoomConnectedUser } from '../../../../lib/zoom/client';

async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const user = await getZoomCurrentUser();
    await saveZoomConnectedUser(user);
    return res.status(200).json({ success: true, data: { email: user.email || null, userId: user.id || null } });
  } catch (error) {
    return res.status(400).json({ success: false, error: error instanceof Error ? error.message : 'Zoom connection test failed' });
  }
}

export default withAuth(handler, { roles: ['admin', 'trainingProvider'] });
