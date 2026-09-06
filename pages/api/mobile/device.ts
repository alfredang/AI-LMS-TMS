import type { NextApiResponse } from 'next';
import { withAuth, AuthedApiRequest } from '../../../lib/auth/withAuth';
import pool from '../../../lib/db';
import { ensureMobileSchema } from '../../../lib/mobile/schema';
export default withAuth(async(req:AuthedApiRequest,res:NextApiResponse)=>{
 if(!['POST','DELETE'].includes(req.method||'')) return res.status(405).end();
 if(req.authUser!.isService) return res.status(403).end();
 const {token,environment,enabled}=req.body||{};
 if(typeof token!=='string'||! /^[a-f0-9]{64,200}$/.test(token)) return res.status(400).json({error:'Invalid device token'});
 try {
 await ensureMobileSchema();
 if(req.method==='DELETE') await pool.query('DELETE FROM mobile_push_device WHERE token=$1 AND user_id=$2',[token,req.authUser!.id]);
 else {
 if(!['production','sandbox'].includes(environment)||typeof enabled!=='boolean')return res.status(400).json({error:'Invalid notification settings'});
 await pool.query(`INSERT INTO mobile_push_device(token,user_id,environment,enabled) VALUES($1,$2,$3,$4)
 ON CONFLICT(token) DO UPDATE SET user_id=$2,environment=$3,enabled=$4,updated_at=now()`,[token,req.authUser!.id,environment,enabled]);
 }
 return res.json({success:true});
 }catch{return res.status(500).json({error:'Unable to update notifications'});}
},{roles:['learner','trainer']});
