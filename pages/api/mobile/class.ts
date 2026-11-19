import type { NextApiResponse } from 'next';
import { withAuth, AuthedApiRequest } from '../../../lib/auth/withAuth';
import { classDetail, hasAccess, MobileRole } from '../../../lib/mobile/app';

// GET ?id=<course run uuid>&role=learner|trainer — one class the caller is enrolled in or teaches.
export default withAuth(async (req: AuthedApiRequest, res: NextApiResponse) => {
  if (req.method !== 'GET') return res.status(405).end();
  const user = req.authUser!;
  const role = String(req.query.role || 'learner') as MobileRole;
  const id = String(req.query.id || '');
  if (user.isService || !['learner', 'trainer'].includes(role) || !user.roles.has(role)) return res.status(403).json({ error: 'Learner or trainer access required' });
  res.setHeader('Cache-Control', 'no-store');
  try {
    if (!(await hasAccess(user.id, role, id))) return res.status(404).json({ error: 'Class not found' });
    const data = await classDetail(user.id, role, id);
    return data ? res.json({ data }) : res.status(404).json({ error: 'Class not found' });
  } catch {
    return res.status(500).json({ error: 'This class could not be loaded. Please try again.' });
  }
}, { roles: ['learner', 'trainer'] });
