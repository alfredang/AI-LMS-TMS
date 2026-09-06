import type { NextApiRequest, NextApiResponse } from 'next';
import { withServiceAuth } from '../../../lib/auth/withAuth';
import pool from '../../../lib/db';
import { ensureMobileSchema } from '../../../lib/mobile/schema';
import { mobileData } from '../../../lib/mobile/data';
import { classStart,dueReminderDays } from '../../../lib/mobile/reminders';
import { sendPush } from '../../../lib/mobile/apns';
export default withServiceAuth(async(req:NextApiRequest,res:NextApiResponse)=>{
 if(req.method!=='POST')return res.status(405).end();
 if(process.env.MOBILE_APNS_ENABLED!=='true')return res.status(503).json({error:'Mobile push is not enabled'});
 await ensureMobileSchema();const client=await pool.connect();let sent=0,failed=0;
 try{
 const lock=await client.query('SELECT pg_try_advisory_lock(17092026) AS locked');
 if(!lock.rows[0].locked)return res.json({success:true,skipped:'already running'});
 const devices=await client.query(`SELECT d.*,array_agg(DISTINCT lower(r.role::text)) AS roles FROM mobile_push_device d
 JOIN app_user u ON u.id=d.user_id JOIN user_role_map r ON r.user_id=u.id
 WHERE d.enabled AND lower(coalesce(u.account_status,'active'))='active' AND lower(r.role::text) IN('learner','trainer') GROUP BY d.token`);
 const now=new Date();
 for(const device of devices.rows){
 const sessions=new Map<string,any>();
 for(const role of device.roles){const data=await mobileData(device.user_id,role);data.sessions.forEach(s=>sessions.set(s.id,s));}
 for(const session of sessions.values()){
 const start=classStart(session.startDate,session.startTime);if(!start)continue;
 for(const days of dueReminderDays(start,now)){
 const confirmed=await client.query(`SELECT 1 FROM course_session cs JOIN course_run cr ON cr.id=cs.course_run_id WHERE cs.id=$1 AND cr.class_status::text='Confirmed' AND NOT coalesce(cs.deleted,false) AND NOT coalesce(cr.is_deleted,false)`,[session.id]);
 if(!confirmed.rowCount)continue;
 const exists=await client.query(`SELECT 1 FROM mobile_push_delivery WHERE token=$1 AND session_id=$2 AND starts_at=$3 AND days=$4 AND sent_at IS NOT NULL`,[device.token,session.id,start,days]);
 if(exists.rowCount)continue;
 try{
 const status=await sendPush(device.token,device.environment,session.id,days);
 if(status===200){await client.query(`INSERT INTO mobile_push_delivery(token,session_id,starts_at,days,sent_at) VALUES($1,$2,$3,$4,now()) ON CONFLICT(token,session_id,starts_at,days) DO UPDATE SET sent_at=now()`,[device.token,session.id,start,days]);sent++;}
 else{failed++;if(status===410)await client.query('DELETE FROM mobile_push_device WHERE token=$1',[device.token]);}
 }catch{failed++;}
 }
 }
 }
 return res.status(failed?502:200).json({success:failed===0,sent,failed});
 }finally{await client.query('SELECT pg_advisory_unlock(17092026)');client.release();}
});
