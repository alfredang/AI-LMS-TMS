import type {NextApiRequest,NextApiResponse} from 'next';
import {mobileAccount,normalizedEmail,limited} from '../../../lib/android/auth';
import {createSession} from '../../../lib/auth/session';
import pool from '../../../lib/db';
// Atomic OTP consumption prevents replay across devices; no account creation or password path.
export default async function handler(req:NextApiRequest,res:NextApiResponse){
 res.setHeader('Cache-Control','no-store');
 if(req.method!=='POST')return res.status(405).end();
 const email=normalizedEmail(req.body?.email),otp=req.body?.otp;
 if(!email||typeof otp!=='string'||!/^\d{6}$/.test(otp))return res.status(400).json({error:'Enter your email and six-digit code.'});
 try {
 if(await limited('verify:'+email,8,15))return res.status(429).json({error:'Too many attempts. Please wait 15 minutes before trying again.'});
 const user=await mobileAccount(email);if(!user)return res.status(401).json({error:'Invalid or expired sign-in code.'});
 const settings=await pool.query('SELECT enable_otp_login FROM training_provider LIMIT 1');
 if(settings.rows[0]?.enable_otp_login===false)return res.status(403).json({error:'Email sign-in is disabled. Please contact your training provider.'});
 const used=await pool.query(`UPDATE otp_codes SET used=true WHERE id=(SELECT id FROM otp_codes WHERE lower(email)=$1 AND otp_code=$2 AND NOT used AND expires_at>now() ORDER BY created_at DESC LIMIT 1) AND NOT used RETURNING id`,[email,otp]);
 if(!used.rowCount)return res.status(401).json({error:'Invalid or expired sign-in code.'});
 const result=await pool.query(`SELECT id,email,full_name AS "fullName" FROM app_user WHERE id=$1`,[user.id]);
 const roles=await pool.query(`SELECT lower(role::text) AS role FROM user_role_map WHERE user_id=$1 AND lower(role::text) IN('learner','trainer') ORDER BY role`,[user.id]);
 return res.json({success:true,data:{user:{...result.rows[0],roles:roles.rows.map(r=>r.role)},token:await createSession(user.id)}});
 }catch{return res.status(503).json({error:'Sign-in is temporarily unavailable. Please try again.'});}
}
