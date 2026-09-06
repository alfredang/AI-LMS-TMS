import {test,after} from 'node:test';
import assert from 'node:assert/strict';
import pool from '../lib/db';
import {mobileData} from '../lib/android/data';
import {ensureAndroidSchema} from '../lib/android/schema';
import {isoDate,isoTime} from '../lib/android/dates';
import {reminderDay,sendAndroidReminders} from '../lib/android/reminders';
import {createSession} from '../lib/auth/session';
import login from '../pages/api/android/login';
import dashboard from '../pages/api/android/dashboard';
import device from '../pages/api/android/device';
function response(){return {statusCode:200,body:null as any,setHeader(){},status(n:number){this.statusCode=n;return this},json(v:any){this.body=v;return this},end(){return this}}}
const ids={learner:'11111111-1111-4111-8111-111111111111',other:'22222222-2222-4222-8222-222222222222',trainer:'33333333-3333-4333-8333-333333333333',admin:'44444444-4444-4444-8444-444444444444',course:'55555555-5555-4555-8555-555555555555',run:'66666666-6666-4666-8666-666666666666',session:'77777777-7777-4777-8777-777777777777'};
test('mobile authorization, material privacy, OTP replay and device lifecycle',async()=>{
 assert.match(process.env.DATABASE_URL||'',/127.0.0.1:15449\/ailms_android$/);
 await ensureAndroidSchema();await ensureAndroidSchema();
 for(const [name,id]of Object.entries(ids).slice(0,4)){
  await pool.query(`INSERT INTO app_user(id,email,full_name,account_status) VALUES($1,$2,$3,'active') ON CONFLICT(id) DO NOTHING`,[id,name+'@example.invalid',name]);
  await pool.query(`INSERT INTO user_role_map(user_id,role) VALUES($1,$2) ON CONFLICT DO NOTHING`,[id,name==='other'?'Learner':name[0].toUpperCase()+name.slice(1)]);
 }
 await pool.query(`INSERT INTO trainer_profile(user_id,tel,gender,trainer_type,status)VALUES($1,'00000000','Prefer not to say','non-ACLP','Active')ON CONFLICT DO NOTHING`,[ids.trainer]);
 await pool.query(`INSERT INTO course(id,title,course_code,slides_url,trainer_slides_url)VALUES($1,'Native Mobile Training','TEST-ANDROID','https://example.com/slides','https://example.com/trainer') ON CONFLICT(id)DO NOTHING`,[ids.course]);
 await pool.query(`INSERT INTO course_run(id,course_id,course_run_id,start_date,end_date,assigned_trainer_id)VALUES($1,$2,'ANDROID-TEST',current_date+3,current_date+3,$3)ON CONFLICT(id)DO NOTHING`,[ids.run,ids.course,ids.trainer]);
 await pool.query(`INSERT INTO course_session(id,course_run_id,start_date,end_date,start_time,end_time)VALUES($1,$2,to_char(current_date+3,'YYYYMMDD'),to_char(current_date+3,'YYYYMMDD'),'0900','1700')ON CONFLICT(id)DO NOTHING`,[ids.session,ids.run]);
 await pool.query(`INSERT INTO enrollment(user_id,course_id,course_run_id,enrolment_status)VALUES($1,$2,$3,'Confirmed')ON CONFLICT(user_id,course_run_id) DO UPDATE SET enrolment_status='Confirmed'`,[ids.learner,ids.course,ids.run]);
 const learner=await mobileData(ids.learner,'learner'),trainer=await mobileData(ids.trainer,'trainer'),other=await mobileData(ids.other,'learner');
 assert.equal(learner.courses.length,1);assert.equal(learner.courses[0].trainerSlidesURL,null);assert.equal(trainer.courses[0].trainerSlidesURL,'https://example.com/trainer');assert.equal(other.courses.length,0);assert.equal(other.sessions.length,0);assert.equal(learner.sessions[0].startTime,'09:00');
 const token=await createSession(ids.learner),adminToken=await createSession(ids.admin);
 for(const [auth,role,status]of [[undefined,'learner',401],[token,'trainer',403],[adminToken,'learner',403]] as const){const res=response();await dashboard({method:'GET',headers:{authorization:auth?'Bearer '+auth:undefined},query:{role}} as any,res as any);assert.equal(res.statusCode,status)}
 await pool.query(`INSERT INTO otp_codes(email,otp_code,expires_at)VALUES('learner@example.invalid','123456',now()+interval '5 minutes')`);
 const req=()=>({method:'POST',headers:{},body:{email:'learner@example.invalid',otp:'123456'}} as any);
 const a=response(),b=response();await Promise.all([login(req(),a as any),login(req(),b as any)]);assert.deepEqual([a.statusCode,b.statusCode].sort(),[200,401]);
 const t='testfcm:'.padEnd(160,'x'),r=response();await device({method:'POST',headers:{authorization:'Bearer '+token},body:{token:t,enabled:true}} as any,r as any);assert.equal(r.statusCode,200);
 const now=new Date(new Date().toISOString().slice(0,10)+'T09:00:00+08:00');
 let delivered=0;const sendMessage=async(message:any)=>{assert.equal(message.token,t);delivered++;};
 assert.equal((await sendAndroidReminders({now,sendMessage})).sent,1);
 assert.equal((await sendAndroidReminders({now,sendMessage})).sent,0);assert.equal(delivered,1);
 const d=response();await device({method:'DELETE',headers:{authorization:'Bearer '+token},body:{token:t}} as any,d as any);assert.equal(d.statusCode,200);assert.equal((await pool.query('SELECT 1 FROM android_push_device WHERE token=$1',[t])).rowCount,0);
 await pool.query(`UPDATE enrollment SET enrolment_status='Withdrawn' WHERE user_id=$1`,[ids.learner]);assert.equal((await mobileData(ids.learner,'learner')).sessions.length,0);
});
test('Singapore reminder dates and legacy time formats',()=>{
 assert.equal(isoDate('20260910'),'2026-09-10');assert.equal(isoDate('20260230'),'');assert.equal(isoTime('0900'),'09:00');assert.equal(isoTime('2500'),'');
 assert.equal(reminderDay(new Date('2026-09-10T01:00:00Z'),new Date('2026-09-07T01:00:00Z')),3);
 assert.equal(reminderDay(new Date('2026-09-10T01:00:00Z'),new Date('2026-09-09T01:00:00Z')),1);
 assert.equal(reminderDay(new Date('2026-09-10T01:00:00Z'),new Date('2026-09-07T00:59:00Z')),null);
 assert.equal(reminderDay(new Date('2026-09-10T01:00:00Z'),new Date('2026-09-08T01:00:00Z')),null);
});
after(async()=>{await pool.end()});
