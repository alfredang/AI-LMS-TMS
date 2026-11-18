// Light/dark theme sweep: screenshots representative screens of every role in both themes and
// counts axe-core colour-contrast violations on each. Read-only UI navigation against a LOCAL
// dev server backed by a LOCAL database copy — never point it at production.
//
// Usage:
//   SWEEP_TOKEN=lms_<64 hex>  SWEEP_USER_ID=<app_user uuid with every role>  \
//   SWEEP_OUT=/tmp/sweep  [SWEEP_BASE=http://localhost:3003]  [SWEEP_THEMES=light,dark]  \
//   [SWEEP_ENROL=<course_run uuid>] [SWEEP_CHECKIN=<checkin token>]  node scripts/ui-theme-sweep.mjs
//
// The token must be a user_session row (sha256 of the token) for SWEEP_USER_ID in that database.
// Output: <out>/<theme>/<role>-<page>.png and <out>/report.json (+ a summary table on stdout).
import { chromium } from 'playwright';
import fs from 'node:fs/promises';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const BASE = process.env.SWEEP_BASE || 'http://localhost:3003';
const TOKEN = process.env.SWEEP_TOKEN;
const USER_ID = process.env.SWEEP_USER_ID;
const OUT = process.env.SWEEP_OUT || path.resolve('.sweep');
const THEMES = (process.env.SWEEP_THEMES || 'light,dark').split(',');
if (!TOKEN || !USER_ID) { console.error('Set SWEEP_TOKEN and SWEEP_USER_ID'); process.exit(1); }
if (!/^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(BASE)) { console.error('SWEEP_BASE must be a localhost URL'); process.exit(1); }

const ALL_ROLES = ['admin', 'trainer', 'learner', 'developer', 'trainingProvider', 'finance', 'payroll'];

/** role, page name, URL query (and optional localStorage) — representative screens per role. */
const SCREENS = [
  ['learner', 'dashboard', '/?view=dashboard'],
  ['learner', 'courses', '/?view=courses'],
  ['trainer', 'my-classes', '/?trainerPage=myClasses'],
  ['trainer', 'e-attendance', '/?trainerPage=eAttendance'],
  ['trainer', 'assessment-grading', '/?trainerPage=assessmentGrading'],
  ['trainer', 'my-calendar', '/?trainerPage=myCalendar'],
  ['trainer', 'past-attendance', '/?trainerPage=pastAttendance'],
  ['trainingProvider', 'dashboard', '/?view=dashboard'],
  ['trainingProvider', 'user-management', '/?view=userManagement'],
  ['developer', 'dashboard', '/?view=dashboard'],
  ['payroll', 'dashboard', '/?view=dashboard'],
  ['finance', 'dashboard', '/', { 'lms.financePage': 'dashboard' }],
  ['finance', 'all-course-runs', '/', { 'lms.financePage': 'allCourseRuns' }],
  ['finance', 'claim-management', '/', { 'lms.financePage': 'claimManagement' }],
  ['admin', 'dashboard', '/?adminPage=dashboard'],
  ['admin', 'class-management', '/?adminPage=classManagement'],
  ['admin', 'upcoming-classes', '/?adminPage=upcomingClasses'],
  ['admin', 'view-courses', '/?adminPage=viewCourses'],
  ['admin', 'view-trainers', '/?adminPage=viewTrainers'],
  ['admin', 'view-learners', '/?adminPage=viewLearners'],
  ['admin', 'check-attendance', '/?adminPage=checkAttendance'],
];
if (process.env.SWEEP_ENROL) SCREENS.push(['public', 'enrol', `/enrol/${process.env.SWEEP_ENROL}`]);
if (process.env.SWEEP_CHECKIN) SCREENS.push(['public', 'checkin', `/checkin/${process.env.SWEEP_CHECKIN}`]);

const axeSource = await fs.readFile(require.resolve('axe-core/axe.min.js'), 'utf8');
const browser = await chromium.launch({ channel: process.env.SWEEP_CHANNEL || 'chrome' });
const report = [];

for (const theme of THEMES) {
  await fs.mkdir(path.join(OUT, theme), { recursive: true });
  for (const [role, name, url, storage] of SCREENS) {
    const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    await ctx.addInitScript(({ token, userId, role, theme, storage, allRoles }) => {
      if (role !== 'public') {
        localStorage.setItem('auth_token', token);
        localStorage.setItem('user_data', JSON.stringify({ id: userId, email: 'sweep@localhost', fullName: 'Theme Sweep', role, roles: allRoles }));
      }
      localStorage.setItem('trainingProviderTheme', theme);
      for (const [k, v] of Object.entries(storage || {})) localStorage.setItem(k, v);
    }, { token: TOKEN, userId: USER_ID, role, theme, storage, allRoles: ALL_ROLES });
    const page = await ctx.newPage();
    const errors = [];
    page.on('pageerror', e => errors.push(e.message));
    let contrast = null;
    try {
      await page.goto(BASE + url, { waitUntil: 'networkidle', timeout: 60000 });
      await page.waitForTimeout(2500);
      await page.screenshot({ path: path.join(OUT, theme, `${role}-${name}.png`), fullPage: false });
      await page.addScriptTag({ content: axeSource });
      contrast = await page.evaluate(async () => {
        const r = await window.axe.run(document, { runOnly: ['color-contrast'] });
        return r.violations.reduce((n, v) => n + v.nodes.length, 0);
      });
    } catch (e) {
      errors.push(String(e.message || e).split('\n')[0]);
    }
    report.push({ theme, role, page: name, contrastViolations: contrast, errors });
    await ctx.close();
  }
}
await browser.close();
await fs.writeFile(path.join(OUT, 'report.json'), JSON.stringify(report, null, 2));

const pad = (s, n) => String(s).padEnd(n);
console.log(pad('theme', 7) + pad('role', 18) + pad('page', 22) + 'contrast  errors');
for (const r of report) console.log(pad(r.theme, 7) + pad(r.role, 18) + pad(r.page, 22) + pad(r.contrastViolations ?? '—', 10) + (r.errors[0] || ''));
const total = t => report.filter(r => r.theme === t).reduce((n, r) => n + (r.contrastViolations || 0), 0);
console.log(THEMES.map(t => `${t}: ${total(t)} contrast violations`).join(' | '));
