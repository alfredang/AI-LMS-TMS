import pool from '../db';
import {isoDate,isoTime} from './dates';
import {google} from 'googleapis';
import {ensureAndroidSchema} from './schema';

export function reminderDay(starts:Date,now:Date):1|3|null {
 const date=(d:Date)=>new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Singapore',year:'numeric',month:'2-digit',day:'2-digit'}).format(d);
 const delta=Math.round((Date.parse(date(starts))-Date.parse(date(now)))/86400000);
 const hour=Number(new Intl.DateTimeFormat('en-GB',{timeZone:'Asia/Singapore',hour:'2-digit',hourCycle:'h23'}).format(now));
 return hour>=9 && (delta===1||delta===3) ? delta : null;
}
export async function sendAndroidReminders(options:{now?:Date,sendMessage?:(message:any)=>Promise<unknown>}={}){
 const now=options.now||new Date();
 if(!process.env.ANDROID_FCM_CREDENTIALS_JSON&&!options.sendMessage)return {disabled:true,sent:0};
 await ensureAndroidSchema();
 const client=await pool.connect();let sent=0,failed=0;
 try {
 const lock=await client.query('SELECT pg_try_advisory_lock(93827461) AS locked');if(!lock.rows[0].locked)return {locked:true,sent:0};
 const credentials=JSON.parse(process.env.ANDROID_FCM_CREDENTIALS_JSON||'{}');
 const auth=new google.auth.GoogleAuth({credentials,scopes:['https://www.googleapis.com/auth/firebase.messaging']});
 const http=options.sendMessage?null:await auth.getClient();
 // Current account, active session, enrollment and per-session teaching assignment are checked on every run.
 const rows=await client.query(`SELECT DISTINCT d.token,d.user_id,cs.id,cs.start_date::text,cs.start_time::text,
  c.title,cr.id AS course_id FROM android_push_device d
  JOIN app_user u ON u.id=d.user_id AND coalesce(lower(u.account_status),'active')='active'
  JOIN user_session us ON us.token_hash=d.session_hash AND us.user_id=d.user_id AND us.expires_at>now()
  JOIN course_session cs ON NOT coalesce(cs.deleted,false)
  JOIN course_run cr ON cr.id=cs.course_run_id AND NOT coalesce(cr.is_deleted,false)
  JOIN course c ON c.id=cr.course_id
  WHERE d.enabled AND lower(coalesce(cr.class_status::text,''))='confirmed'
  AND replace(left(cs.start_date,10),'-','') IN(to_char(($1::timestamptz AT TIME ZONE 'Asia/Singapore')::date+1,'YYYYMMDD'),to_char(($1::timestamptz AT TIME ZONE 'Asia/Singapore')::date+3,'YYYYMMDD'))
  AND (
   (EXISTS(SELECT 1 FROM user_role_map r WHERE r.user_id=u.id AND lower(r.role::text)='learner')
    AND EXISTS(SELECT 1 FROM enrollment e WHERE e.user_id=u.id AND e.course_run_id=cr.id AND lower(coalesce(e.enrolment_status,'')) NOT IN('cancelled','canceled','withdrawn')))
   OR (EXISTS(SELECT 1 FROM user_role_map r WHERE r.user_id=u.id AND lower(r.role::text)='trainer') AND
    (cs.trainer_id=u.id OR (cs.trainer_id IS NULL AND (cr.assigned_trainer_id=u.id OR cr.tpg_assigned_trainer_id=u.id OR EXISTS(SELECT 1 FROM course_run_trainer crt WHERE crt.course_run_id=cr.id AND crt.trainer_id=u.id)))))
  )`,[now]);
 for(const row of rows.rows){
  const date=isoDate(row.start_date),time=isoTime(row.start_time);if(!date||!time)continue;
  row.starts=new Date(`${date}T${time}:00+08:00`);
  const days=reminderDay(row.starts,now);if(!days)continue;
  const args=[row.token,row.id,row.starts,days];
  const claim=await client.query(`INSERT INTO android_push_delivery(token,session_id,starts_at,days,status,lease_at) VALUES($1,$2,$3,$4,'sending',now())
   ON CONFLICT(token,session_id,starts_at,days) DO UPDATE SET status='sending',lease_at=now()
   WHERE android_push_delivery.status='pending' OR (android_push_delivery.status='sending' AND android_push_delivery.lease_at<now()-interval '15 minutes') RETURNING token`,args);
  if(!claim.rowCount)continue;
  try {
   const message={token:row.token,data:{title:`Class in ${days} day${days===1?'':'s'}`,body:`${row.title} · ${date} ${time} SGT. Open your calendar for details.`,userId:row.user_id,courseId:row.course_id,sessionId:row.id,deliveryId:`${row.id}:${new Date(row.starts).toISOString()}:${days}`},android:{priority:'HIGH',ttl:'86400s'}};
   if(options.sendMessage)await options.sendMessage(message);
   else await http!.request({url:`https://fcm.googleapis.com/v1/projects/${credentials.project_id}/messages:send`,method:'POST',timeout:20000,data:{message}});
   await client.query("UPDATE android_push_delivery SET status='sent',sent_at=now() WHERE token=$1 AND session_id=$2 AND starts_at=$3 AND days=$4",args);sent++;
  }catch(e:any){
   const details=e.response?.data?.error?.details||[];
   if(details.some((d:any)=>d.errorCode==='UNREGISTERED'))await client.query('DELETE FROM android_push_device WHERE token=$1',[row.token]);
   else await client.query("UPDATE android_push_delivery SET status='pending' WHERE token=$1 AND session_id=$2 AND starts_at=$3 AND days=$4",args);
   failed++;
  }
 }
 return {sent,failed};
 }finally{await client.query('SELECT pg_advisory_unlock(93827461)');client.release();}
}
export function startAndroidReminderScheduler(){
 const state=globalThis as typeof globalThis & {androidReminderTimer?:ReturnType<typeof setInterval>};
 if(state.androidReminderTimer||!process.env.ANDROID_FCM_CREDENTIALS_JSON)return;
 const run=()=>sendAndroidReminders().then(r=>{if(r.sent||r.failed)console.log('[Android reminders]',r)}).catch(()=>console.error('[Android reminders] Scheduler failed; will retry.'));
 state.androidReminderTimer=setInterval(run,5*60*1000);state.androidReminderTimer.unref();void run();
}
