import type {NextApiRequest,NextApiResponse} from 'next';
import crypto from 'node:crypto';
import pool from '../../../lib/db';
import {createSession} from '../../../lib/auth/session';
import {sendViaGmailOAuth,trySendViaGmailServiceAccount} from '../../../lib/gmailOauthSend';
import {isSmtpEnabled,sendViaSmtp,getSmtpConfig} from '../../../lib/smtp';
let schema:Promise<unknown>|undefined;
function ensure(){return schema ||= pool.query(`CREATE TABLE IF NOT EXISTS mobile_otp (
 email text PRIMARY KEY, user_id uuid NOT NULL REFERENCES app_user(id) ON DELETE CASCADE,
 digest text NOT NULL, salt text NOT NULL, expires_at timestamptz NOT NULL,
 attempts integer NOT NULL DEFAULT 0, used boolean NOT NULL DEFAULT false);
 CREATE TABLE IF NOT EXISTS mobile_auth_rate (bucket text PRIMARY KEY, count integer NOT NULL, expires_at timestamptz NOT NULL);`).catch(e=>{schema=undefined;throw e})}
export default async function handler(req:NextApiRequest,res:NextApiResponse){
 if(req.method!=='POST')return res.status(405).end();
 const {action,email:raw,otp}=req.body||{};
 if(typeof raw!=='string'||raw.length>254||! /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(raw)||!['send','verify'].includes(action))return res.status(400).json({error:'Enter a valid registered email address'});
 const email=raw.trim().toLowerCase();
 try{
 await ensure();
 const window=Math.floor(Date.now()/900000);
 const ip=req.socket.remoteAddress||'unknown';
 for(const [value,max] of [[email,action==='send'?5:15],[ip,200]] as [string,number][]){
 const bucket=crypto.createHash('sha256').update(`${action}:${value}:${window}`).digest('hex');
 const rate=await pool.query(`INSERT INTO mobile_auth_rate(bucket,count,expires_at) VALUES($1,1,now()+interval '30 minutes') ON CONFLICT(bucket) DO UPDATE SET count=mobile_auth_rate.count+1 RETURNING count`,[bucket]);
 if(rate.rows[0].count>max)return res.status(429).json({error:'Too many attempts. Please try again in 15 minutes.'});
 }
 await pool.query('DELETE FROM mobile_auth_rate WHERE expires_at<now()');
 if(action==='send'){
 const user=await pool.query(`SELECT u.id,u.email FROM app_user u WHERE (lower(u.email)=$1 OR lower(u.secondary_email)=$1) AND lower(u.account_status)='active'
 AND EXISTS(SELECT 1 FROM user_role_map r WHERE r.user_id=u.id AND lower(r.role::text) IN ('learner','trainer')) LIMIT 1`,[email]);
 if(!user.rowCount)return res.json({success:true}); // Do not reveal account existence.
 const code=crypto.randomInt(100000,1000000).toString();const salt=crypto.randomBytes(24).toString('hex');const digest=crypto.createHash('sha256').update(salt+code).digest('hex');
 await pool.query(`INSERT INTO mobile_otp(email,user_id,digest,salt,expires_at) VALUES($1,$2,$3,$4,now()+interval '10 minutes') ON CONFLICT(email) DO UPDATE SET user_id=$2,digest=$3,salt=$4,expires_at=now()+interval '10 minutes',attempts=0,used=false`,[email,user.rows[0].id,digest,salt]);
 const message={to:email,subject:'Your learning portal verification code',text:`Your verification code is ${code}. It expires in 10 minutes. Do not share this code. If you did not request it, ignore this email.`};
 let result=await trySendViaGmailServiceAccount(message);
 if(!result?.ok && await isSmtpEnabled())result=await sendViaSmtp(message);
 if(!result?.ok)result=await sendViaGmailOAuth(message);
 if(!result?.ok){const config=await getSmtpConfig();if(config?.host)result=await sendViaSmtp(message);}
 if(!result?.ok){await pool.query('UPDATE mobile_otp SET used=true WHERE email=$1 AND digest=$2',[email,digest]);return res.status(503).json({error:'The verification email could not be sent. Please try again later.'});}
 return res.json({success:true});
 }
 if(typeof otp!=='string'||! /^\d{6}$/.test(otp))return res.status(400).json({error:'Enter the six-digit code'});
 const client=await pool.connect();
 try{
 await client.query('BEGIN');
 const r=await client.query('SELECT * FROM mobile_otp WHERE email=$1 FOR UPDATE',[email]);const c=r.rows[0];
 if(!c||c.used||c.attempts>=5||new Date(c.expires_at)<=new Date()){await client.query('ROLLBACK');return res.status(401).json({error:'Invalid or expired code. Request a new code.'});}
 const digest=crypto.createHash('sha256').update(c.salt+otp).digest('hex');
 if(!crypto.timingSafeEqual(Buffer.from(digest,'hex'),Buffer.from(c.digest,'hex'))){await client.query('UPDATE mobile_otp SET attempts=attempts+1 WHERE email=$1',[email]);await client.query('COMMIT');return res.status(401).json({error:'Invalid or expired code'});}
 const u=await client.query(`SELECT id,email,full_name AS "fullName" FROM app_user WHERE id=$1 AND lower(account_status)='active'`,[c.user_id]);
 const roles=await client.query(`SELECT lower(role::text) AS role FROM user_role_map WHERE user_id=$1 AND lower(role::text) IN('learner','trainer')`,[c.user_id]);
 if(!u.rowCount||!roles.rowCount){await client.query('ROLLBACK');return res.status(403).json({error:'Learner or trainer access required'});}
 await client.query('UPDATE mobile_otp SET used=true WHERE email=$1',[email]);await client.query('COMMIT');
 const token=await createSession(c.user_id);const roleList=roles.rows.map(x=>x.role);
 return res.json({data:{user:{...u.rows[0],role:roleList[0],roles:roleList},token}});
 }catch(e){await client.query('ROLLBACK');throw e;}finally{client.release();}
 }catch{return res.status(500).json({error:'Sign in is temporarily unavailable. Please try again.'});}
}
