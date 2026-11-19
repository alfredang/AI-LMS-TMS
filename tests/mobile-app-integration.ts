// Integration checks for the learner/trainer app routes added for TIA TMS (iOS and Android):
// password sign-in, profile, class detail, attendance, assessments and course feedback.
// Disposable database only — never a live tenant. Start the app on port 3004 first:
//   DATABASE_URL=postgresql://postgres@127.0.0.1:15439/postgres ENABLE_APP_SCHEDULER=false npx next dev --webpack -p 3004
//   DATABASE_URL=postgresql://postgres@127.0.0.1:15439/postgres node --import tsx tests/mobile-app-integration.ts
import { Pool } from 'pg';
import crypto from 'node:crypto';
import assert from 'node:assert/strict';
import bcrypt from 'bcryptjs';

const db = new Pool({ connectionString: process.env.DATABASE_URL });
const base = 'http://localhost:3004/api/mobile';
assert.equal(process.env.DATABASE_URL, 'postgresql://postgres@127.0.0.1:15439/postgres', 'This fixture suite only runs against the disposable local database.');

const ids = {
  learner: '11000000-0000-0000-0000-000000000001', // enrolled in the class
  outsider: '11000000-0000-0000-0000-000000000002', // learner, not enrolled
  trainer: '11000000-0000-0000-0000-000000000003', // assigned trainer
  stranger: '11000000-0000-0000-0000-000000000004', // trainer of nothing
  admin: '11000000-0000-0000-0000-000000000005',
  classmate: '11000000-0000-0000-0000-000000000006', // second enrolled learner
};
const course = '21000000-0000-0000-0000-000000000001', run = '31000000-0000-0000-0000-000000000001';
const session = '41000000-0000-0000-0000-000000000001';
const token = (id: string) => 'lms_' + crypto.createHash('sha256').update('app-' + id).digest('hex');
const sgToday = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Singapore' }).format(new Date());

async function request(path: string, user?: string, method = 'GET', body?: unknown) {
  const r = await fetch(base + path, {
    method,
    headers: { 'content-type': 'application/json', ...(user ? { authorization: 'Bearer ' + token(user) } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  return { status: r.status, body: await r.json().catch(() => ({})) };
}

async function main() {
  for (const [name, id] of Object.entries(ids)) {
    await db.query(`INSERT INTO app_user(id,email,full_name,password_hash) VALUES($1,$2,$3,$4)
      ON CONFLICT(id) DO UPDATE SET account_status='active',email=$2,full_name=$3,password_hash=$4,must_change_password=false`,
      [id, `app-${name}@example.test`, `App ${name}`, await bcrypt.hash('correct-horse-1', 4)]);
    await db.query('DELETE FROM user_role_map WHERE user_id=$1', [id]);
    await db.query('INSERT INTO user_role_map(user_id,role) VALUES($1,$2)', [id, name === 'admin' ? 'Admin' : ['trainer', 'stranger'].includes(name) ? 'Trainer' : 'Learner']);
    await db.query(`INSERT INTO user_session(user_id,token_hash,expires_at) VALUES($1,$2,now()+interval '1 day') ON CONFLICT DO NOTHING`,
      [id, crypto.createHash('sha256').update(token(id)).digest('hex')]);
  }
  for (const id of [ids.trainer, ids.stranger]) await db.query(`INSERT INTO trainer_profile(user_id,tel,gender,trainer_type,status) VALUES($1,'00000000','Prefer not to say','ACLP','Active') ON CONFLICT DO NOTHING`, [id]);
  await db.query(`INSERT INTO course(id,title,course_code,slides_url,trainer_slides_url,lesson_plan_url,facilitator_guide_url,assessment_methods)
    VALUES($1,'App test course','APPTEST','https://example.test/slides','https://example.test/trainer','https://example.test/lp','https://example.test/fg',$2)
    ON CONFLICT(id) DO UPDATE SET assessment_methods=$2`,
    [course, JSON.stringify({ writtenAssessment: { enabled: true, link: 'https://example.test/wa' }, practicalExam: { enabled: true, link: 'https://example.test/pp' } })]);
  await db.query(`INSERT INTO course_run(id,course_id,course_run_id,assigned_trainer_id,start_date,end_date,class_status,digital_attendance_id,published_assessment_methods)
    VALUES($1,$2,'APPTEST-RUN',$3,$4,$4,'Confirmed','RA123456','{"writtenAssessment":true}')
    ON CONFLICT(id) DO UPDATE SET class_status='Confirmed',start_date=$4,end_date=$4,published_assessment_methods='{"writtenAssessment":true}'`,
    [run, course, ids.trainer, sgToday]);
  for (const id of [ids.learner, ids.classmate]) {
    await db.query(`INSERT INTO enrollment(user_id,course_id,course_run_id,enrolment_status) SELECT $1,$2,$3,'Confirmed'
      WHERE NOT EXISTS(SELECT 1 FROM enrollment WHERE user_id=$1 AND course_run_id=$3)`, [id, course, run]);
  }
  await db.query(`UPDATE enrollment SET assessment_status=NULL, enrolment_status='Confirmed' WHERE course_run_id=$1`, [run]);
  await db.query(`INSERT INTO course_session(id,course_run_id,title,start_date,start_time,end_time) VALUES($1,$2,'Session 1',$3,'09:00','17:00')
    ON CONFLICT(id) DO UPDATE SET deleted=false,start_date=$3`, [session, run, sgToday.replace(/-/g, '')]);
  await db.query('DELETE FROM course_attendance WHERE session_id=$1', [session]);
  await db.query('DELETE FROM link_assessment_submission WHERE course_run_id=$1', [run]);
  await db.query('DELETE FROM feedback_form_response WHERE course_run_id=$1', [run]);
  await db.query(`DELETE FROM android_otp_limit`).catch(() => {});
  const enrolmentOf = async (id: string) => (await db.query('SELECT id::text FROM enrollment WHERE user_id=$1 AND course_run_id=$2', [id, run])).rows[0].id;

  // --- password sign-in
  assert.equal((await request('/login', undefined, 'POST', { email: 'app-learner@example.test', password: 'wrong' })).status, 401);
  assert.equal((await request('/login', undefined, 'POST', { email: 'nobody@example.test', password: 'correct-horse-1' })).status, 401);
  assert.equal((await request('/login', undefined, 'POST', { email: 'app-admin@example.test', password: 'correct-horse-1' })).status, 403);
  const login = await request('/login', undefined, 'POST', { email: 'APP-Learner@example.test', password: 'correct-horse-1' });
  assert.equal(login.status, 200); assert.deepEqual(login.body.data.user.roles, ['learner']); assert.ok(login.body.data.token.startsWith('lms_'));
  assert.equal(login.body.data.forcePasswordChange, false);
  for (let n = 0; n < 9; n++) await request('/login', undefined, 'POST', { email: 'app-outsider@example.test', password: 'wrong' });
  assert.equal((await request('/login', undefined, 'POST', { email: 'app-outsider@example.test', password: 'correct-horse-1' })).status, 429);

  // --- profile: own only, allow-listed fields
  assert.equal((await request('/profile')).status, 401);
  assert.equal((await request('/profile', ids.admin)).status, 403);
  const patch = await request('/profile', ids.learner, 'PATCH', { fullName: 'App Learner Renamed', phone: '+65 9000 0000', theme: 'dark', email: 'evil@example.test', userId: ids.classmate, role: 'Admin' });
  assert.equal(patch.status, 200); assert.equal(patch.body.data.fullName, 'App Learner Renamed'); assert.equal(patch.body.data.theme, 'dark');
  assert.equal(patch.body.data.email, 'app-learner@example.test'); assert.equal(patch.body.data.phone, '+65 9000 0000');
  assert.equal((await db.query('SELECT full_name FROM app_user WHERE id=$1', [ids.classmate])).rows[0].full_name, 'App classmate');
  assert.equal((await request('/profile', ids.learner, 'PATCH', { theme: 'neon' })).status, 400);
  assert.equal((await request('/profile', ids.learner, 'PATCH', { fullName: 'x' })).status, 400);

  // --- class detail: enrolment and assignment, role-filtered content
  assert.equal((await request(`/class?id=${run}&role=learner`, ids.outsider)).status, 404);
  assert.equal((await request(`/class?id=${run}&role=trainer`, ids.stranger)).status, 404);
  assert.equal((await request(`/class?id=${run}&role=trainer`, ids.learner)).status, 403);
  const mine = (await request(`/class?id=${run}&role=learner`, ids.learner)).body.data;
  assert.deepEqual(mine.materials.map((m: any) => m.id), ['slides']); // no trainer slides, no lesson plan, no facilitator guide
  assert.deepEqual(mine.assessments.map((a: any) => a.type), ['writtenAssessment']); // unpublished paper withheld
  assert.equal(mine.roster, undefined);
  assert.equal(mine.ssgAttendanceURL, 'https://www.myskillsfuture.gov.sg/api/take-attendance/RA123456');
  assert.equal(mine.sessions.length, 1); assert.equal(mine.sessions[0].attendance, null);
  const teach = (await request(`/class?id=${run}&role=trainer`, ids.trainer)).body.data;
  assert.deepEqual(teach.materials.map((m: any) => m.id), ['trainer-slides', 'slides', 'lesson-plan', 'facilitator-guide']);
  assert.equal(teach.assessments.length, 2); assert.equal(teach.roster.length, 2);
  assert.ok(!JSON.stringify(teach).includes('nric'));

  // --- attendance: manual marking by the assigned trainer only
  assert.equal((await request(`/attendance?sessionId=${session}`, ids.stranger)).status, 404);
  assert.equal((await request(`/attendance?sessionId=${session}`, ids.learner)).status, 403);
  const sheet = await request(`/attendance?sessionId=${session}`, ids.trainer);
  assert.equal(sheet.status, 200); assert.equal(sheet.body.data.learners.length, 2); assert.match(sheet.body.data.checkinURL, /\/checkin\/[0-9a-f]{32}$/);
  const classmateEnrolment = await enrolmentOf(ids.classmate);
  assert.equal((await request('/attendance', ids.stranger, 'POST', { action: 'mark', sessionId: session, records: [{ enrolmentId: classmateEnrolment, isPresent: true }] })).status, 404);
  const marked = await request('/attendance', ids.trainer, 'POST', { action: 'mark', sessionId: session, records: [
    { enrolmentId: classmateEnrolment, isPresent: false, reason: 'Medical leave' },
    { enrolmentId: '99999999-0000-0000-0000-000000000000', isPresent: true }, // not on the class: ignored
  ] });
  assert.equal(marked.status, 200); assert.equal(marked.body.saved, 1);
  assert.equal(marked.body.data.learners.find((l: any) => l.enrolmentId === classmateEnrolment).isPresent, false);

  // --- attendance: learner check-in with the session QR code
  const code = sheet.body.data.checkinURL;
  assert.equal((await request('/attendance', ids.learner, 'POST', { action: 'checkin', code: 'https://example.test/not-a-code' })).status, 400);
  assert.equal((await request('/attendance', ids.learner, 'POST', { action: 'checkin', code: 'f'.repeat(32) })).status, 404);
  assert.equal((await request('/attendance', ids.trainer, 'POST', { action: 'checkin', code })).status, 403);
  const checkin = await request('/attendance', ids.learner, 'POST', { action: 'checkin', code });
  assert.equal(checkin.status, 200); assert.equal(checkin.body.already, false);
  assert.equal((await request('/attendance', ids.learner, 'POST', { action: 'checkin', code })).body.already, true);
  assert.equal((await request(`/class?id=${run}&role=learner`, ids.learner)).body.data.sessions[0].attendance, 'present');
  assert.equal((await request(`/class?id=${run}&role=learner`, ids.classmate)).body.data.sessions[0].attendance, 'absent');

  // --- assessments: own class, published method, Drive links only; delete own only
  const good = { action: 'submit', runId: run, type: 'writtenAssessment', fileName: 'wa.pdf', fileURL: 'https://drive.google.com/file/d/abcdefghijk/view' };
  assert.equal((await request('/assessments', ids.outsider, 'POST', good)).status, 404);
  assert.equal((await request('/assessments', ids.learner, 'POST', { ...good, type: 'practicalExam' })).status, 403);
  assert.equal((await request('/assessments', ids.learner, 'POST', { ...good, fileURL: 'https://evil.example/x' })).status, 400);
  const sub = await request('/assessments', ids.learner, 'POST', { ...good, userId: ids.classmate });
  assert.equal(sub.status, 201);
  assert.equal((await db.query('SELECT user_id::text FROM link_assessment_submission WHERE id=$1', [sub.body.id])).rows[0].user_id, ids.learner);
  assert.equal((await request(`/class?id=${run}&role=learner`, ids.learner)).body.data.assessments[0].submissions.length, 1);
  assert.equal((await request('/assessments', ids.classmate, 'DELETE', { submissionId: sub.body.id })).status, 404);
  assert.equal((await request('/assessments', ids.learner, 'DELETE', { submissionId: sub.body.id })).status, 200);

  // --- grading: assigned trainer only
  const learnerEnrolment = await enrolmentOf(ids.learner);
  assert.equal((await request('/assessments', ids.stranger, 'POST', { action: 'grade', enrolmentIds: [learnerEnrolment], isCompetent: true })).status, 404);
  assert.equal((await request('/assessments', ids.learner, 'POST', { action: 'grade', enrolmentIds: [learnerEnrolment], isCompetent: true })).status, 400);
  assert.equal((await request('/assessments', ids.trainer, 'POST', { action: 'grade', enrolmentIds: [learnerEnrolment], isCompetent: true })).status, 200);
  assert.equal((await request(`/class?id=${run}&role=learner`, ids.learner)).body.data.assessmentStatus, 'Competent');

  // --- feedback: enrolled learner, once per class
  assert.equal((await request(`/feedback?runId=${run}`, ids.outsider)).status, 404);
  assert.equal((await request(`/feedback?runId=${run}`, ids.trainer)).status, 403);
  const form = (await request(`/feedback?runId=${run}`, ids.learner)).body.data;
  assert.equal(form.submitted, false); assert.ok(form.sections.length > 0);
  const answers: Record<string, unknown> = {};
  for (const f of form.sections.flatMap((s: any) => s.fields)) answers[f.id] = f.type === 'rating1to5' ? 5 : f.type === 'select' ? f.options?.[0] : f.type === 'date' ? sgToday : 'Clear and useful';
  assert.equal((await request('/feedback', ids.learner, 'POST', { runId: run, answers: {} })).status, 400);
  assert.equal((await request('/feedback', ids.learner, 'POST', { runId: run, answers })).status, 201);
  assert.equal((await request('/feedback', ids.learner, 'POST', { runId: run, answers })).status, 409);
  assert.equal((await db.query('SELECT user_id::text FROM feedback_form_response WHERE course_run_id=$1', [run])).rows[0].user_id, ids.learner);

  // --- change password: current password required, other sessions end
  assert.equal((await request('/password', ids.classmate, 'POST', { currentPassword: 'wrong', newPassword: 'another-horse-2' })).status, 401);
  assert.equal((await request('/password', ids.classmate, 'POST', { currentPassword: 'correct-horse-1', newPassword: 'short' })).status, 400);
  assert.equal((await request('/password', ids.classmate, 'POST', { currentPassword: 'correct-horse-1', newPassword: 'another-horse-2' })).status, 200);
  assert.equal((await request('/login', undefined, 'POST', { email: 'app-classmate@example.test', password: 'another-horse-2' })).status, 200);

  // --- withdrawn learner loses the class
  await db.query(`UPDATE enrollment SET enrolment_status='Withdrawn' WHERE id=$1`, [learnerEnrolment]);
  assert.equal((await request(`/class?id=${run}&role=learner`, ids.learner)).status, 404);
  assert.equal((await request('/assessments', ids.learner, 'POST', good)).status, 404);

  console.log('PASS: mobile app integration — password sign-in and rate limit, own-profile edits, class detail by enrolment/assignment, role-filtered courseware and assessments, trainer-only manual attendance, QR check-in, own submissions, assigned-trainer grading, one feedback per class, password change, withdrawal');
}
main().catch(e => { console.error(e); process.exitCode = 1; }).finally(() => db.end());
