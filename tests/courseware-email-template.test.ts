import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import * as renderer from '../lib/learner/coursewareEmailTemplate';
import { buildCoursewareMasterTemplate } from '../lib/learner/coursewareMasterTemplate';

const master = buildCoursewareMasterTemplate({ companyName: 'Example Academy', teamName: 'Example Team',
  logoUrl: 'https://example.test/logo.jpg', websiteUrl: 'https://example.test/', fundedPortalUrl: 'https://funded.example.test/',
  nonFundedPortalUrl: 'https://nonfunded.example.test/learnerlogin', supportPhone: '1234', supportEmail: 'support@example.test' });
const sample = (code: string): renderer.CoursewareValues => ({ courseCode: code, courseName: 'Example course', courseRunCode: '1467809',
  courseDates: '20 November 2026', attendanceId: '1467809', attendanceVerified: true });
const render = (code: string, extra: Partial<renderer.CoursewareValues> = {}) => renderer.renderCoursewareEmail(master.subject, master.body, { ...sample(code), ...extra });

test('classifies registered codes, including whitespace and existing C-number codes', () => {
  for (const code of ['TGS-2023036153', ' tgs-2023036153 ']) assert.equal(renderer.coursewareScenario(code), 'funded');
  for (const code of ['C-197', 'C197', ' c251 ']) assert.equal(renderer.coursewareScenario(code), 'non-funded');
  for (const code of ['', null, undefined, 'OTHER', 'COURSE', 'TGS-', 'C-', 'M123']) assert.equal(renderer.coursewareScenario(code), 'unrecognised');
});
test('one master renders exactly the relevant funded, non-funded and fallback sections', () => {
  const funded = render('TGS-2023036153').html;
  assert.match(funded, /funded\.example\.test/); assert.match(funded, /E-Attendance/); assert.match(funded, /Assessment Information/);
  assert.doesNotMatch(funded, /nonfunded\.example\.test|Class Attendance|If you are unsure/);
  assert.match(funded, /take-attendance\/1467809/);
  const nonFunded = render('C251').html;
  assert.match(nonFunded, /nonfunded\.example\.test/); assert.match(nonFunded, /Class Attendance/);
  assert.doesNotMatch(nonFunded, /https:\/\/funded\.|E-Attendance|WSQ|SWDA|Assessment|take-attendance/);
  const fallback = render('OTHER', { attendanceVerified: false }).html;
  for (const text of ['funded.example.test', 'nonfunded.example.test', 'If you are unsure', 'Class Attendance', 'E-Attendance', 'If you are attending a WSQ course']) assert.ok(fallback.includes(text));
  for (const html of [funded, nonFunded, fallback]) {
    assert.equal((html.match(/Course Material and Login/g) || []).length, 1);
    assert.equal((html.match(/spam or junk folder/g) || []).length, 1);
    assert.equal((html.match(/Course: Example course/g) || []).length, 1);
    assert.doesNotMatch(html, /<!--\s*cw:|\{[A-Z_]+\}|this afternoon|SSG/);
  }
});
test('missing run code and unverified/MMS identifiers cannot generate a false SWDA link', () => {
  const missing = render('OTHER', { courseRunCode: '', attendanceId: '', attendanceVerified: false }).html;
  assert.match(missing, /ask your trainer or Example Academy Support/); assert.doesNotMatch(missing, /Course Run Code shown above/);
  for (const id of ['C004129', 'SAMPLE-ONLY', '0', 'javascript:alert(1)']) assert.doesNotMatch(render('TGS-123', { attendanceId: id }).html, /take-attendance\//);
  assert.doesNotMatch(render('OTHER', { attendanceVerified: false }).html, /take-attendance\//);
});
test('validates every conditional block, including hidden malformed sections', () => {
  for (const body of ['<!-- cw:if WRONG -->bad<!-- cw:end -->', '<!-- cw:end -->', '<!-- cw:if FUNDED -->', '<!-- cw:if FUNDED -->a<!-- cw:else -->b<!-- cw:end -->', '<!-- cw:if FUNDED -->{UNKNOWN}<!-- cw:end -->']) {
    assert.throws(() => renderer.validateCoursewareTemplate(master.subject, body), renderer.CoursewareTemplateError);
  }
  assert.throws(() => renderer.validateCoursewareTemplate(master.subject, '<!-- cw:if FUNDED -->'.repeat(13)), /too deeply/);
});
test('escapes course values and never reinterprets their markers or replacement syntax', () => {
  const courseName = '<img src=x onerror=alert(1)> <!-- cw:if FUNDED --> $& {COMPANY_NAME}';
  const result = render('C251', { courseName, companyName: 'Different name' });
  assert.match(result.html, /&lt;img src=x onerror=alert\(1\)&gt;/);
  assert.ok(result.html.includes('$&amp; {COMPANY_NAME}'));
  assert.doesNotMatch(result.html, /<img src=x|E-Attendance/);
  assert.equal(renderer.renderCoursewareEmail('{COURSE_NAME}', 'Hi', { ...sample('C1'), courseName: 'hello\r\nBcc:evil' }).subject, 'hello Bcc:evil');
});
test('ordinary HTML remains supported and date ranges collapse when dates match', () => {
  const legacy = renderer.renderCoursewareEmail('For {COURSE_NAME}', '<p>Hello {STUDENT_NAME}</p>', { ...sample('C1'), studentName: 'Alex' });
  assert.match(legacy.html, /<p>Hello Alex<\/p>/); assert.doesNotMatch(legacy.html, /Assessment Information/);
  assert.equal(renderer.coursewareDates('20 Nov', '20 Nov'), '20 Nov');
  assert.equal(renderer.coursewareDates('20 Nov', '21 Nov'), '20 Nov - 21 Nov');
  const edited = { ...master, body: master.body.replace('Dear Learners,', 'Shared greeting edited once') };
  for (const code of ['TGS-123', 'C251', 'OTHER']) assert.match(renderer.renderCoursewareEmail(edited.subject, edited.body, sample(code)).html, /Shared greeting edited once/);
});

function loadModule(file: string, dependencies: Record<string, unknown>) {
  const js = ts.transpileModule(readFileSync(file, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, esModuleInterop: true, target: ts.ScriptTarget.ES2022 } }).outputText;
  const exports: Record<string, any> = {};
  vm.runInNewContext(js, { exports, require: (name: string) => {
    if (!(name in dependencies)) throw new Error(`Unexpected dependency ${name}`);
    return dependencies[name];
  }, console, Buffer, URL, setTimeout }, { filename: file });
  return exports;
}
test('MMS course-day rendering retains readiness, membership and notification holds; confirmations remain unchanged', async () => {
  let platform = 'mms', state = 'ready', enabled = true, recipient = 'learner@example.test';
  const context = () => ({ platform, state, class_id: 'C004129', snapshot: {} });
  const mod = loadModule('lib/mmsSync/legacyRouting.ts', {
    './accessContext': { prepareClassAccess: async () => context() },
    './accessPolicy': { recipients: () => [{ role: 'learner', email: recipient }], accessMessage: () => ({ subject: 'Existing MMS', html: 'Existing body' }), accessInstruction: () => 'Existing instructions' },
    './contract': { MmsSyncError: class extends Error {} }, './runtimeConfig': { getMmsRuntimeConfig: () => ({ notificationsEnabled: enabled }) },
    '../learner/coursewareEmailTemplate': renderer,
  });
  const opts = { name: 'Alex', email: 'learner@example.test', support: 'Support', title: 'Course', dates: '20 Nov', venue: '',
    courseware: { ...master, values: sample('C251') } };
  const sent = await mod.learnerMail({ courseCode: 'C251' }, opts);
  assert.match(sent.html, /Course Run Code: C004129/); assert.doesNotMatch(sent.html, /take-attendance|WSQ/);
  assert.equal((await mod.learnerMail({}, { ...opts, confirmation: true })).subject, 'Existing MMS');
  assert.equal((await mod.learnerMail({}, { ...opts, courseware: { ...opts.courseware, body: '<p>Legacy</p>' } })).subject, 'Existing MMS');
  platform = 'tms'; assert.equal(await mod.learnerMail({}, opts), null);
  platform = 'review'; await assert.rejects(() => mod.learnerMail({}, opts));
  platform = 'mms'; state = 'pending'; await assert.rejects(() => mod.learnerMail({}, opts));
  state = 'ready'; enabled = false; await assert.rejects(() => mod.learnerMail({}, opts));
  enabled = true; recipient = 'different@example.test'; await assert.rejects(() => mod.learnerMail({}, opts));
});
test('template API preserves one raw body, validates markers, and scopes the update to its provider', async () => {
  const calls: { sql: string; params?: unknown[] }[] = [];
  const handler = loadModule('pages/api/training-provider/courseware-attendance-email-template.ts', {
    '@lib/auth/withAuth': { withAuth: (h: unknown) => h },
    '../../../lib/db': { query: async (sql: string, params?: unknown[]) => { calls.push({ sql, params }); return { rows: sql.startsWith('SELECT id') ? [{ id: 'provider-one' }] : [{ courseware_attendance_email_body: master.body, courseware_attendance_email_subject: master.subject }] }; } },
    '../../../lib/cors': { cors: async () => {} }, '../../../lib/trainingPartnerIdentifiers': { getTrainingPartnerIdentifiers: async () => ({ uen: 'TEST-UEN', name: 'Example' }) },
    '@lib/learner/coursewareEmailTemplate': renderer,
  }).default;
  const response = () => ({ code: 200, value: null as any, status(code: number) { this.code = code; return this; }, json(value: any) { this.value = value; return this; } });
  const get = response(); await handler({ method: 'GET' }, get); assert.equal(get.value.data.coursewareAttendanceEmailBody, master.body);
  const bad = response(); await handler({ method: 'PUT', body: { coursewareAttendanceEmailSubject: master.subject, coursewareAttendanceEmailBody: '<!-- cw:if WRONG -->x<!-- cw:end -->' } }, bad); assert.equal(bad.code, 400);
  const save = response(); await handler({ method: 'PUT', body: { coursewareAttendanceEmailSubject: master.subject, coursewareAttendanceEmailBody: master.body, coursewareAttendanceEmailCc: 'copy@example.test' } }, save);
  assert.equal(save.code, 200);
  const update = calls.find(c => c.sql.startsWith('UPDATE'))!; assert.match(update.sql, /WHERE id=\$4 AND uen=\$5/);
  assert.deepEqual(Array.from(update.params || []), [master.subject, master.body, 'copy@example.test', 'provider-one', 'TEST-UEN']);
});
test('test-email endpoint uses the same renderer for all scenarios and rejects invalid templates before send', async () => {
  const sent: string[] = [];
  const handler = loadModule('pages/api/training-provider/send-test-email.ts', {
    '@lib/auth/withAuth': { withAuth: (h: unknown) => h },
    'googleapis': { google: { auth: { OAuth2: class { setCredentials() {} } }, gmail: () => ({ users: { messages: { send: async (x: any) => { sent.push(Buffer.from(x.requestBody.raw, 'base64url').toString('utf8')); } } } }) } },
    '@lib/db': { query: async () => ({ rows: [{ email_user: 'sender@example.test', google_client_id: 'synthetic-id', google_client_secret: 'synthetic-secret', google_refresh_token: 'synthetic-token', company_name: 'Example Academy' }] }) },
    '@lib/trainingPartnerIdentifiers': { getTrainingPartnerIdentifiers: async () => ({ name: 'Example Academy', contactTel: '123', companyEmail: 'support@example.test' }) },
    '@lib/trainerInvitations': { parseCcList: () => [] },
    '@lib/learner/welcomeSigninEmailTemplate': { passwordSectionHtml: () => '' },
    '@lib/learner/selfEnrolment': { loginUrlFrom: () => 'https://example.test' },
    '@lib/learner/coursewareEmailTemplate': renderer,
    '@lib/mmsSync/accessEmailTemplate': {},
  }).default;
  const response = () => ({ code: 200, value: null as any, status(code: number) { this.code = code; return this; }, json(value: any) { this.value = value; return this; } });
  for (const scenario of renderer.COURSEWARE_SCENARIOS) {
    const res = response();
    await handler({ method: 'POST', headers: { host: 'localhost' }, body: { testEmail: 'reviewer@example.test', ...master, templateType: 'courseware-attendance', coursewareScenario: scenario } }, res);
    assert.equal(res.code, 200); assert.match(sent.at(-1)!, /To: reviewer@example.test/);
    assert.doesNotMatch(sent.at(-1)!, /\r\nCc:|take-attendance\//);
    assert.match(sent.at(-1)!, /Mock email only/);
  }
  assert.doesNotMatch(sent[1], /WSQ|SWDA|Assessment/);
  const invalid = response(); await handler({ method: 'POST', headers: {}, body: { testEmail: 'reviewer@example.test', subject: 'Test', body: '<!-- cw:if BAD -->', templateType: 'courseware-attendance' } }, invalid);
  assert.equal(invalid.code, 400); assert.equal(sent.length, 3);
});
