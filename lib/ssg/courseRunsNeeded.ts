import { emailService } from '../services/emailService';
import {
  fetchMagentoSchedules,
  futureScheduleItems,
  getPriorFailureMap,
  logWsqSyncCronRun,
  sgtToday,
} from '../wsqScheduleSync';
import { startWsqSyncJob } from '../../pages/api/admin/wsq-schedule-sync/run-sync';
import { planRunsNeeded, type RunsNeededCourse, type RunsNeededPlan } from './courseRunsNeededPlan';

/**
 * Storefront → TMS: "these enabled courses have no future course run on SSG".
 *
 * The storefront never closes registration for an enabled course. Instead, its
 * answer to the daily availability sync (`runs_needed`) lists the enabled courses SSG
 * has no future run for, and this publishes those courses' website schedule to
 * TPGateway through the shared WSQ sync job (same job as the daily 2am sync, which
 * skips runs that already exist), then emails staff what was published and what still
 * needs a person: a course with no future website schedule, or a schedule that failed
 * before on a non-eligibility error.
 *
 * Recipients: COURSE_RUNS_NEEDED_RECIPIENTS, else FUNDING_REMINDER_RECIPIENTS
 * (comma-separated). With neither set the runs are still published; no email is sent.
 */

export interface RunsNeededResult {
  requested: number;
  submitting: number;
  jobId: number | null;
  job: 'started' | 'already_running' | 'not_configured' | 'nothing_to_submit';
  noWebsiteSchedule: string[];
  needsDeveloper: string[];
  email: 'sent' | 'skipped' | 'failed' | 'not_needed';
  message: string;
}

const escapeHtml = (value: string) =>
  value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

const fmtDay = (ymd: string) => {
  const [y, m, d] = ymd.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });
};

function buildEmail(plan: RunsNeededPlan, job: RunsNeededResult['job']) {
  const jobNote =
    job === 'started' ? 'The schedules marked "Publishing" are being added to TPGateway now.'
      : job === 'already_running' ? 'Another WSQ schedule sync was running, so nothing was published this time. The schedules marked "Publishing" go out with the next daily sync.'
        : job === 'not_configured' ? 'SSG credentials are not configured, so nothing was published. Please add the course runs on TPGateway.'
          : 'No schedule could be published automatically.';
  const action = (c: RunsNeededPlan['courses'][number]) => {
    const parts: string[] = [];
    if (c.submitting.length) parts.push(`Publishing ${c.submitting.length} run(s): ${c.submitting.map(fmtDay).join(', ')}`);
    if (c.needsDeveloper.length) parts.push(`Failed before, needs a developer: ${c.needsDeveloper.map(fmtDay).join(', ')}`);
    if (c.noWebsiteSchedule) parts.push('No future schedule on the website. Add class dates on the website, or add the course run on TPGateway');
    return parts.join('. ');
  };
  const cell = 'padding:6px 10px;border:1px solid #ddd;';
  const rows = plan.courses.map((c) => `
    <tr>
      <td style="${cell}">${escapeHtml(c.course_title || '—')}</td>
      <td style="${cell}white-space:nowrap;">${escapeHtml(c.course_code)}</td>
      <td style="${cell}">${escapeHtml(action(c))}</td>
    </tr>`).join('');
  const html = `
    <div style="font-family:Arial,Helvetica,sans-serif;font-size:14px;color:#111;">
      <p>Dear team,</p>
      <p><strong>${plan.courses.length}</strong> active course(s) on the website have <strong>no future course run on SSG</strong>. Registration on the website stays open for them.</p>
      <p>${escapeHtml(jobNote)}</p>
      <table style="border-collapse:collapse;font-size:13px;">
        <thead>
          <tr style="background:#f3f4f6;">
            <th style="${cell}text-align:left;">Course Title</th>
            <th style="${cell}text-align:left;">Course Code</th>
            <th style="${cell}text-align:left;">Action</th>
          </tr>
        </thead>
        <tbody>${rows}</tbody>
      </table>
      <p>Results of the publish are on Admin → WSQ Schedule Sync.</p>
      <p style="color:#6b7280;font-size:12px;">This is an automated message from the LMS Task Scheduler (Sync SSG Course Availability to Website).</p>
    </div>`;
  const text = [
    `${plan.courses.length} active course(s) on the website have no future course run on SSG. Registration on the website stays open for them.`,
    jobNote,
    '',
    ...plan.courses.map((c) => `- ${c.course_title || '—'} [${c.course_code}]: ${action(c)}`),
    '',
    'Results of the publish are on Admin → WSQ Schedule Sync.',
  ].join('\n');
  return { html, text };
}

export async function requestCourseRunsForStorefront(needed: RunsNeededCourse[]): Promise<RunsNeededResult> {
  const empty: RunsNeededResult = {
    requested: 0, submitting: 0, jobId: null, job: 'nothing_to_submit',
    noWebsiteSchedule: [], needsDeveloper: [], email: 'not_needed',
    message: 'The storefront reported no enabled course without a future SSG run.',
  };
  if (!Array.isArray(needed) || needed.length === 0) return empty;

  const magento = await fetchMagentoSchedules();
  const plan = planRunsNeeded(needed, futureScheduleItems(magento, sgtToday()), await getPriorFailureMap());

  let job: RunsNeededResult['job'] = 'nothing_to_submit';
  let jobId: number | null = null;
  if (plan.toSubmit.length > 0) {
    const started = await startWsqSyncJob(plan.toSubmit, 'cron');
    if (started.started) {
      job = 'started';
      jobId = started.jobId;
    } else {
      job = started.reason === 'already_running' ? 'already_running' : 'not_configured';
      jobId = started.reason === 'already_running' ? started.jobId : null;
    }
  }
  await logWsqSyncCronRun({
    cron: 'storefront_request',
    status: job === 'started' ? 'started' : job === 'already_running' ? 'already_running' : job === 'not_configured' ? 'error' : 'nothing_to_do',
    considered: plan.toSubmit.length,
    mmsCourses: plan.courses.length,
    jobId,
    message: `${plan.courses.length} enabled course(s) without a future SSG run`,
  });

  const recipients = (process.env.COURSE_RUNS_NEEDED_RECIPIENTS || process.env.FUNDING_REMINDER_RECIPIENTS || '')
    .split(',').map((email) => email.trim()).filter(Boolean);
  let email: RunsNeededResult['email'] = 'skipped';
  if (recipients.length > 0) {
    const { html, text } = buildEmail(plan, job);
    const sent = await emailService.sendEmail({
      to: recipients.join(', '),
      subject: `[LMS] ${plan.courses.length} active course(s) have no future course run on SSG`,
      html,
      text,
    }).catch((err: any) => ({ success: false, error: err?.message || String(err) }));
    email = sent.success ? 'sent' : 'failed';
    if (!sent.success) console.error('[course-runs-needed] email failed:', sent.error);
  }

  return {
    requested: plan.courses.length,
    submitting: plan.toSubmit.length,
    jobId,
    job,
    noWebsiteSchedule: plan.courses.filter((c) => c.noWebsiteSchedule).map((c) => c.course_code),
    needsDeveloper: plan.courses.filter((c) => c.needsDeveloper.length > 0).map((c) => c.course_code),
    email,
    message: `${plan.courses.length} course(s) without a future SSG run; ${plan.toSubmit.length} website schedule(s) sent to TPGateway (${job}).`,
  };
}
