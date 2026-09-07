import {Pool} from 'pg';import crypto from 'node:crypto';import assert from 'node:assert/strict';
const db=new Pool({connectionString:process.env.DATABASE_URL});
const base='http://localhost:3004/api/mobile';
assert.equal(process.env.DATABASE_URL,'postgresql://postgres@127.0.0.1:15439/postgres','This fixture suite only runs against the disposable local database.');
const ids={learner:'10000000-0000-0000-0000-000000000001',other:'10000000-0000-0000-0000-000000000002',trainer:'10000000-0000-0000-0000-000000000003',override:'10000000-0000-0000-0000-000000000004',admin:'10000000-0000-0000-0000-000000000005'};
const token=(id:string)=>'lms_'+crypto.createHash('sha256').update(id).digest('hex');
async function request(path:string,user?:string,method='GET',body?:unknown){const r=await fetch(base+path,{method,headers:{'content-type':'application/json',...(user?{authorization:'Bearer '+token(user)}:{})},body:body?JSON.stringify(body):undefined});return {status:r.status,body:await r.json()};}
async function main(){
for(const [name,id]of Object.entries(ids)){
await db.query(`INSERT INTO app_user(id,email,full_name) VALUES($1,$2,$3) ON CONFLICT(id) DO UPDATE SET account_status='active',email=$2`,[id,name+'@example.test',name]);
await db.query('DELETE FROM user_role_map WHERE user_id=$1',[id]);
await db.query('INSERT INTO user_role_map(user_id,role) VALUES($1,$2)',[id,name==='admin'?'Admin':['trainer','override'].includes(name)?'Trainer':'Learner']);
await db.query(`INSERT INTO user_session(user_id,token_hash,expires_at) VALUES($1,$2,now()+interval '1 day') ON CONFLICT DO NOTHING`,[id,crypto.createHash('sha256').update(token(id)).digest('hex')]);
}
for(const id of [ids.trainer,ids.override]) await db.query(`INSERT INTO trainer_profile(user_id,tel,gender,trainer_type,status) VALUES($1,'00000000','Prefer not to say','ACLP','Active') ON CONFLICT DO NOTHING`,[id]);
const course='20000000-0000-0000-0000-000000000001',run='30000000-0000-0000-0000-000000000001';
await db.query(`INSERT INTO course(id,title,course_code,slides_url,trainer_slides_url) VALUES($1,'Test course','TEST','https://example.test/slides','https://example.test/trainer') ON CONFLICT(id) DO NOTHING`,[course]);
await db.query(`INSERT INTO course_run(id,course_id,course_run_id,assigned_trainer_id,start_date,end_date,class_status) VALUES($1,$2,'TEST-MOBILE',$3,'2026-09-10','2026-09-11','Confirmed') ON CONFLICT(id) DO UPDATE SET class_status='Confirmed'`,[run,course,ids.trainer]);
await db.query(`INSERT INTO enrollment(user_id,course_id,course_run_id,enrolment_status) SELECT $1,$2,$3,'Confirmed' WHERE NOT EXISTS(SELECT 1 FROM enrollment WHERE user_id=$1 AND course_run_id=$3)`,[ids.learner,course,run]);
for(const [n,trainer] of [[1,null],[2,ids.override]] as const){await db.query(`INSERT INTO course_session(id,course_run_id,title,start_date,start_time,end_time,trainer_id) VALUES($1,$2,$3,'20260910','0900','1700',$4) ON CONFLICT(id) DO UPDATE SET deleted=false`,[`40000000-0000-0000-0000-00000000000${n}`,run,'Session '+n,trainer]);}
assert.equal((await request('/dashboard?role=learner')).status,401);
assert.equal((await request('/dashboard?role=learner',ids.admin)).status,403);
assert.equal((await request('/dashboard?role=trainer',ids.learner)).status,403);
const own=await request('/dashboard?role=learner',ids.learner);assert.equal(own.status,200);assert.equal(own.body.courses.length,1);assert.equal(own.body.sessions.length,2);assert.equal(own.body.courses[0].trainerSlidesURL,null);
assert.equal((await request('/dashboard?role=learner&userId='+ids.learner,ids.other)).body.courses.length,0);
const trainer=await request('/dashboard?role=trainer',ids.trainer);assert.equal(trainer.body.sessions.length,1);assert.ok(trainer.body.courses[0].trainerSlidesURL);
assert.equal((await request('/dashboard?role=trainer',ids.override)).body.sessions.length,1);
await db.query(`UPDATE course_run SET class_status='Cancelled' WHERE id=$1`,[run]);assert.equal((await request('/dashboard?role=learner',ids.learner)).body.sessions.length,0);await db.query(`UPDATE course_run SET class_status='Confirmed' WHERE id=$1`,[run]);
// Initialize OTP schema without sending email: this address has no account.
assert.equal((await request('/auth',undefined,'POST',{action:'send',email:'nobody@example.test'})).status,200);
const salt='test-salt';await db.query(`INSERT INTO mobile_otp(email,user_id,digest,salt,expires_at) VALUES('learner@example.test',$1,$2,$3,now()+interval '10 minutes') ON CONFLICT(email) DO UPDATE SET digest=$2,salt=$3,used=false,attempts=0,expires_at=now()+interval '10 minutes'`,[ids.learner,crypto.createHash('sha256').update(salt+'123456').digest('hex'),salt]);
assert.equal((await request('/auth',undefined,'POST',{action:'verify',email:'learner@example.test',otp:'000000'})).status,401);
const login=await request('/auth',undefined,'POST',{action:'verify',email:'learner@example.test',otp:'123456'});assert.equal(login.status,200);assert.deepEqual(login.body.data.user.roles,['learner']);
assert.equal((await request('/auth',undefined,'POST',{action:'verify',email:'learner@example.test',otp:'123456'})).status,401);
await db.query("UPDATE mobile_otp SET used=false,attempts=0 WHERE email='learner@example.test'");
for(let n=0;n<5;n++) assert.equal((await request('/auth',undefined,'POST',{action:'verify',email:'learner@example.test',otp:'000000'})).status,401);
assert.equal((await request('/auth',undefined,'POST',{action:'verify',email:'learner@example.test',otp:'123456'})).status,401);
const device='a'.repeat(64);assert.equal((await request('/device',ids.learner,'POST',{token:device,environment:'sandbox',enabled:true})).status,200);
assert.equal((await request('/send-reminders',ids.learner,'POST',{})).status,401);
assert.equal((await request('/delete-account',ids.other,'POST',{confirmation:'DELETE'})).status,200);
assert.equal((await request('/me',ids.other)).status,401);
const deleted=await db.query('SELECT email,password_hash,full_name,account_status FROM app_user WHERE id=$1',[ids.other]);assert.equal(deleted.rows[0].account_status,'deleted');assert.equal(deleted.rows[0].full_name,'Deleted account');
console.log('PASS: mobile integration — unauthorized access, role isolation, ownership, trainer overrides, cancellation, OTP success/replay, device registration, scheduler isolation and account deletion');
}
main().finally(()=>db.end());
