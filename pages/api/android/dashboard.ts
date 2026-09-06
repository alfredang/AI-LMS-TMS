import type { NextApiResponse } from 'next';
import { withAuth, AuthedApiRequest } from '../../../lib/auth/withAuth';
import pool from '../../../lib/db';
import { mobileData } from '../../../lib/android/data';
export default withAuth(async (req: AuthedApiRequest,res: NextApiResponse) => {
  if(req.method!=='GET') return res.status(405).end();
  const user=req.authUser!;
  const role=String(req.query.role||'learner');
  if(user.isService || !['learner','trainer'].includes(role) || !user.roles.has(role)) return res.status(403).json({error:'Learner or trainer access required'});
  try {
    const explicitRole=await pool.query('SELECT 1 FROM user_role_map WHERE user_id=$1 AND lower(role::text)=$2',[user.id,role]);
    if(!explicitRole.rowCount)return res.status(403).json({error:'Learner or trainer access required'});
    res.setHeader('Cache-Control','no-store'); return res.json(await mobileData(user.id,role)); }
  catch { return res.status(500).json({error:'Unable to load your classes. Please try again.'}); }
},{roles:['learner','trainer']});
