import pool from '../db';
import { ensureAndroidSchema } from './schema';
import { createHash } from 'crypto';
export function normalizedEmail(value:unknown){return typeof value==='string' && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim()) && value.length<255 ? value.trim().toLowerCase():null;}
export async function mobileAccount(email:string){
 const r=await pool.query(`SELECT u.id FROM app_user u WHERE (lower(u.email)=$1 OR lower(u.secondary_email)=$1)
 AND coalesce(lower(u.account_status),'active')='active'
 AND EXISTS(SELECT 1 FROM user_role_map r WHERE r.user_id=u.id AND lower(r.role::text) IN ('learner','trainer')) LIMIT 1`,[email]);return r.rows[0];
}
export async function limited(key:string,max:number,minutes:number){
 await ensureAndroidSchema();
 const hash=createHash('sha256').update(key).digest('hex');
 const r=await pool.query(`INSERT INTO android_otp_limit(key,attempts) VALUES($1,1)
 ON CONFLICT(key) DO UPDATE SET attempts=CASE WHEN android_otp_limit.window_start<now()-make_interval(mins=>$2) THEN 1 ELSE android_otp_limit.attempts+1 END,
 window_start=CASE WHEN android_otp_limit.window_start<now()-make_interval(mins=>$2) THEN now() ELSE android_otp_limit.window_start END RETURNING attempts`,[hash,minutes]);
 return r.rows[0].attempts>max;
}
