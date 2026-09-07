import type { NextApiResponse } from 'next';
import { withAuth, AuthedApiRequest } from '../../../lib/auth/withAuth';
import pool from '../../../lib/db';
export default withAuth(async(req:AuthedApiRequest,res:NextApiResponse)=>{
 if(req.method!=='GET')return res.status(405).end();
 const u=req.authUser!;if(u.isService)return res.status(403).end();
 const result=await pool.query('SELECT id,email,full_name AS "fullName" FROM app_user WHERE id=$1',[u.id]);
 const roles=[...u.roles].filter(r=>['learner','trainer'].includes(r));
 return res.json({data:{user:{...result.rows[0],role:roles[0],roles}}});
},{roles:['learner','trainer']});
