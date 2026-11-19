import type { NextApiResponse } from 'next';
import { withAuth, AuthedApiRequest } from '../../../lib/auth/withAuth';
import { getProfile, updateProfile } from '../../../lib/mobile/app';

// The signed-in user's own profile. GET reads it; PATCH edits an allow-list of fields.
export default withAuth(async (req: AuthedApiRequest, res: NextApiResponse) => {
  const user = req.authUser!;
  if (user.isService) return res.status(403).end();
  res.setHeader('Cache-Control', 'no-store');
  try {
    if (req.method === 'PATCH') {
      const error = await updateProfile(user.id, user.roles, req.body || {});
      if (error) return res.status(400).json({ error });
    } else if (req.method !== 'GET') return res.status(405).end();
    return res.json({ data: await getProfile(user.id) });
  } catch {
    return res.status(500).json({ error: 'Your profile could not be loaded. Please try again.' });
  }
}, { roles: ['learner', 'trainer'] });
