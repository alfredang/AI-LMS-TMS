import type {NextApiResponse} from 'next';
import {withAuth,AuthedApiRequest} from '../../../lib/auth/withAuth';
import {hashSessionToken} from '../../../lib/auth/session';
import {ensureAndroidSchema} from '../../../lib/android/schema';
import pool from '../../../lib/db';
export default withAuth(async(req:AuthedApiRequest,res:NextApiResponse)=>{
 if(!['POST','DELETE'].includes(req.method||''))return res.status(405).end();
 if(req.authUser!.isService)return res.status(403).end();
 const {token,enabled}=req.body||{};
 if(typeof token!=='string'||token.length<40||token.length>4096||!/^[\w:-]+$/.test(token))return res.status(400).json({error:'Invalid device token'});
 await ensureAndroidSchema();
 if(req.method==='DELETE')await pool.query('DELETE FROM android_push_device WHERE token=$1 AND user_id=$2',[token,req.authUser!.id]);
 else {
 if(typeof enabled!=='boolean')return res.status(400).json({error:'Notification preference is required'});
 const hash=hashSessionToken(req.headers.authorization!.slice(7).trim());
 await pool.query(`DELETE FROM android_push_device WHERE session_hash=$1 AND token<>$2`,[hash,token]);
 await pool.query(`INSERT INTO android_push_device(token,user_id,session_hash,enabled)VALUES($1,$2,$3,$4)
 ON CONFLICT(token) DO UPDATE SET user_id=$2,session_hash=$3,enabled=$4,updated_at=now()`,[token,req.authUser!.id,hash,enabled]);
 }
 return res.json({success:true});
},{roles:['learner','trainer']});
