/**
 * Schedule-change / cancellation email notifications.
 *
 * Sends a branded email to a course run's **confirmed learners + accepted trainer(s)**
 * (trainers with an accepted invitation) when an admin reschedules or cancels (date/time, venue, or mode changes, or a
 * cancellation). Routed through the shared `emailService`, which auto-selects
 * **Gmail OAuth** (the connected Google account) or **standalone SMTP** based on the
 * Company Setting — so this works with or without Google Calendar integration.
 *
 * Branding matches the cert/admin emails: company logo (training_provider.company_logo_url)
 * or company name in the header, Arial body, and a company contact footer. The same
 * email is sent to every recipient.
 *
 * IMPORTANT: only ever invoked by an explicit, admin-confirmed action — never automated.
 */
import pool from '../db';
import { emailService } from '../services/emailService';
import { getBaseUrl } from '../config';

/**
 * Logos are stored as app-relative paths (e.g. /uploads/training_provider/logo/x.png),
 * which can't render in an email. Make them absolute via the app base URL. If the URL
 * is already absolute (http/https/data) keep it; if it's relative and no base URL is
 * configured, return '' so the email falls back to the company-name text header
 * instead of a broken image.
 */
function resolveLogoUrl(raw?: string): string {
  const url = (raw || '').trim();
  if (!url) return '';
  if (/^(https?:)?\/\//i.test(url) || url.startsWith('data:')) return url;
  if (url.startsWith('/')) {
    const base = getBaseUrl().replace(/\/$/, '');
    return base ? `${base}${url}` : '';
  }
  return ''; // unrecognised relative form — don't risk a broken image
}

/**
 * Per-scenario change types. The `_cancel` suffix drives the red/cancel styling;
 * everything else is a reschedule. 'reschedule' / 'cancel' are kept as generic
 * legacy aliases for older callers.
 */
export type ScheduleChangeType =
  | 'session_reschedule'
  | 'day_reschedule'
  | 'class_reschedule'
  | 'session_cancel'
  | 'day_cancel'
  | 'class_cancel'
  | 'reschedule'
  | 'cancel';

/** Subject / heading / intro wording per scenario, on the shared branded layout. */
const CHANGE_META: Record<ScheduleChangeType, { subject: string; heading: string; intro: string }> = {
  session_reschedule: { subject: 'Class Schedule Update', heading: 'Session Rescheduled', intro: 'A session in your class has been rescheduled:' },
  day_reschedule:     { subject: 'Class Schedule Update', heading: 'Class Day Rescheduled', intro: 'A full day of your class has been rescheduled:' },
  class_reschedule:   { subject: 'Class Rescheduled',     heading: 'Class Rescheduled', intro: 'Your class has been rescheduled:' },
  session_cancel:     { subject: 'Session Cancelled',     heading: 'Session Cancelled', intro: 'A session in your class has been cancelled:' },
  day_cancel:         { subject: 'Class Sessions Cancelled', heading: 'Class Day Cancelled', intro: "A full day's sessions in your class have been cancelled:" },
  class_cancel:       { subject: 'Class Cancelled',       heading: 'Class Cancellation', intro: 'Please note that your class has been cancelled:' },
  reschedule:         { subject: 'Class Schedule Update', heading: 'Class Schedule Update', intro: 'Please note the following change to your class schedule:' },
  cancel:             { subject: 'Class Cancelled',       heading: 'Class Cancellation', intro: 'Please note that the following class has been cancelled:' },
};
const isCancelType = (t: ScheduleChangeType) => t === 'cancel' || t.endsWith('_cancel');

export interface EmailCompany {
  name: string;
  shortName: string;
  logoUrl?: string;
  website?: string;
  email?: string;
  tel?: string;
}

export interface NotifyInput {
  courseRunId: string;            // SSG run id or course_run UUID
  changeType: ScheduleChangeType;
  summary: string;                // human change description (the editable email body)
  reason?: string;                // optional admin note
  includeTrainer?: boolean;       // default true
  subjectOverride?: string;       // admin-edited subject (composer)
  /** Explicit recipient emails to send to (composer per-attendee exclusion).
   *  When provided, ONLY these are emailed — overrides the gathered learner/trainer list. */
  recipientsOverride?: string[];
}

export interface NotifyResult {
  success: boolean;
  sent: number;
  failed: number;
  recipients: string[];
  error?: string;
}

export interface RecipientInfo {
  email: string;
  name: string;
  role: 'learner' | 'trainer';
}

interface ScheduleChangeContext {
  run: { id: string; course_run_id: string; course_title: string; course_code: string };
  company: EmailCompany;
  learners: RecipientInfo[];
  trainers: RecipientInfo[];
}

/** Resolve the run, its branding, and the candidate recipients (named). Shared by send + preview. */
export async function gatherScheduleChangeContext(courseRunId: string): Promise<ScheduleChangeContext | null> {
  const run = (await pool.query<{ id: string; course_run_id: string; course_title: string; course_code: string }>(
    `SELECT cr.id, cr.course_run_id, c.title AS course_title, c.course_code
       FROM course_run cr JOIN course c ON c.id = cr.course_id
      WHERE cr.id::text = $1 OR cr.course_run_id = $1 LIMIT 1`,
    [courseRunId]
  )).rows[0];
  if (!run) return null;

  const learners: RecipientInfo[] = (await pool.query<{ email: string; name: string }>(
    `SELECT DISTINCT lower(btrim(au.email)) AS email, COALESCE(NULLIF(btrim(au.full_name), ''), au.email) AS name
       FROM enrollment e JOIN app_user au ON au.id = e.user_id
      WHERE e.course_run_id = $1 AND e.enrolment_status = 'Confirmed'
        AND nullif(btrim(au.email), '') IS NOT NULL`,
    [run.id]
  )).rows.map((r) => ({ email: r.email, name: r.name, role: 'learner' as const }));

  // Only ACCEPTED trainers (an accepted trainer_invitation) — not merely assigned.
  const trainers: RecipientInfo[] = (await pool.query<{ email: string; name: string }>(
    `SELECT DISTINCT lower(btrim(trainer_email)) AS email, COALESCE(NULLIF(btrim(trainer_name), ''), trainer_email) AS name
       FROM trainer_invitation WHERE course_run_id = $1 AND status = 'accepted'
        AND nullif(btrim(trainer_email), '') IS NOT NULL`,
    [run.id]
  )).rows.map((r) => ({ email: r.email, name: r.name, role: 'trainer' as const }));

  const tp = (await pool.query<{
    company_name: string; company_shortname: string; company_logo_url: string;
    company_website: string; company_email: string; support_email: string; contact_tel: string; company_tel: string;
  }>(
    `SELECT company_name, company_shortname, company_logo_url, company_website, company_email, support_email, contact_tel, company_tel
       FROM training_provider LIMIT 1`
  )).rows[0] || ({} as any);

  const company: EmailCompany = {
    name: tp.company_name || 'Tertiary Infotech Academy',
    shortName: tp.company_shortname || tp.company_name || 'Tertiary Infotech Academy',
    logoUrl: resolveLogoUrl(tp.company_logo_url),
    website: tp.company_website || '',
    email: tp.support_email || tp.company_email || '',
    tel: tp.contact_tel || tp.company_tel || '',
  };

  return { run, company, learners, trainers };
}

/** Build the email + candidate recipients WITHOUT sending — powers the composer preview. */
export async function previewScheduleChangeNotification(input: NotifyInput): Promise<{
  subject: string; html: string; summary: string; recipients: RecipientInfo[]; error?: string;
}> {
  const ctx = await gatherScheduleChangeContext(input.courseRunId);
  if (!ctx) return { subject: '', html: '', summary: input.summary, recipients: [], error: 'course run not found' };
  const recipients = input.includeTrainer === false ? ctx.learners : [...ctx.learners, ...ctx.trainers];
  const { subject, html } = buildScheduleChangeEmail({
    changeType: input.changeType,
    courseTitle: ctx.run.course_title,
    courseCode: ctx.run.course_code,
    courseRunId: ctx.run.course_run_id,
    summary: input.summary,
    reason: input.reason,
    company: ctx.company,
  });
  return { subject: input.subjectOverride || subject, html, summary: input.summary, recipients };
}

const esc = (s: string) =>
  String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/** Branded HTML aligned with the cert/admin emails (logo or company-name header, Arial, contact footer). */
export function buildScheduleChangeEmail(p: {
  changeType: ScheduleChangeType;
  courseTitle: string;
  courseCode: string;
  courseRunId: string;
  summary: string;
  reason?: string;
  company: EmailCompany;
}): { subject: string; html: string } {
  const c = p.company;
  const isCancel = isCancelType(p.changeType);
  const meta = CHANGE_META[p.changeType] || CHANGE_META.reschedule;
  const subject = `${meta.subject} — ${p.courseTitle}`;
  const accent = isCancel ? '#dc2626' : '#1f2937';
  const heading = meta.heading;
  const intro = meta.intro;
  const header = c.logoUrl
    ? `<img src="${esc(c.logoUrl)}" alt="${esc(c.name)}" style="max-height:44px;max-width:220px;display:block;" />`
    : `<div style="color:#111827;font-size:18px;font-weight:bold;">${esc(c.name)}</div>`;
  const footerBits = [
    c.website ? `<a href="${esc(c.website)}" style="color:#6b7280;text-decoration:none;">${esc(c.website.replace(/^https?:\/\//, ''))}</a>` : '',
    c.email ? esc(c.email) : '',
    c.tel ? esc(c.tel) : '',
  ].filter(Boolean).join(' &middot; ');

  const html = `
  <div style="margin:0;padding:0;background:#f3f4f6;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f3f4f6;padding:24px 0;font-family:Arial,Helvetica,sans-serif;color:#333;">
      <tr><td align="center">
        <table role="presentation" width="600" cellpadding="0" cellspacing="0" style="max-width:600px;background:#ffffff;border-radius:8px;overflow:hidden;border:1px solid #e5e7eb;">
          <tr><td style="padding:20px 28px;border-bottom:3px solid ${accent};">
            ${header}
            <div style="color:#6b7280;font-size:13px;margin-top:6px;">${heading}</div>
          </td></tr>
          <tr><td style="padding:28px;font-size:14px;line-height:1.6;color:#333;">
            <p style="margin:0 0 14px;">Dear participant,</p>
            <p style="margin:0 0 14px;">${intro}</p>
            <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border:1px solid #e5e7eb;border-radius:6px;margin:0 0 16px;">
              <tr><td style="padding:12px 16px;border-bottom:1px solid #f3f4f6;"><strong>Course</strong><br>${esc(p.courseTitle)}</td></tr>
              <tr><td style="padding:12px 16px;border-bottom:1px solid #f3f4f6;"><strong>Course Code</strong><br>${esc(p.courseCode || 'N/A')} &middot; Run ${esc(p.courseRunId)}</td></tr>
              <tr><td style="padding:12px 16px;"><strong>${isCancel ? 'Details' : 'Change'}</strong><br>${esc(p.summary)}</td></tr>
            </table>
            ${p.reason ? `<p style="margin:0 0 14px;"><strong>Note:</strong> ${esc(p.reason)}</p>` : ''}
            <p style="margin:0 0 14px;">If you have any questions, please contact us${c.email ? ` at <a href="mailto:${esc(c.email)}" style="color:${accent};">${esc(c.email)}</a>` : ''}.</p>
            <p style="margin:0;">Thank you,<br>${esc(c.shortName)}</p>
          </td></tr>
          <tr><td style="padding:16px 28px;background:#f9fafb;color:#6b7280;font-size:12px;border-top:1px solid #e5e7eb;">
            <div style="font-weight:bold;color:#374151;">${esc(c.name)}</div>
            ${footerBits ? `<div style="margin-top:4px;">${footerBits}</div>` : ''}
          </td></tr>
        </table>
      </td></tr>
    </table>
  </div>`;
  return { subject, html };
}

/** Gather recipients (confirmed learners + accepted trainers), build, and send. */
export async function sendScheduleChangeNotification(input: NotifyInput): Promise<NotifyResult> {
  const empty: NotifyResult = { success: true, sent: 0, failed: 0, recipients: [] };
  const ctx = await gatherScheduleChangeContext(input.courseRunId);
  if (!ctx) return { ...empty, success: false, error: 'course run not found' };

  const candidates = input.includeTrainer === false ? ctx.learners : [...ctx.learners, ...ctx.trainers];
  let recipients = Array.from(new Set(candidates.map((r) => r.email))).filter(Boolean);

  // Composer per-attendee exclusion: when an explicit list is given, send ONLY to
  // those (intersected with real candidates so a stale/forged email can't be added).
  if (Array.isArray(input.recipientsOverride)) {
    const allow = new Set(input.recipientsOverride.map((e) => e.toLowerCase().trim()).filter(Boolean));
    recipients = recipients.filter((e) => allow.has(e));
  }
  if (recipients.length === 0) return empty;

  const built = buildScheduleChangeEmail({
    changeType: input.changeType,
    courseTitle: ctx.run.course_title,
    courseCode: ctx.run.course_code,
    courseRunId: ctx.run.course_run_id,
    summary: input.summary,
    reason: input.reason,
    company: ctx.company,
  });
  const subject = input.subjectOverride?.trim() || built.subject;
  const html = built.html;

  let sent = 0, failed = 0;
  for (const to of recipients) {
    try {
      const r = await emailService.sendEmail({ to, subject, html });
      if (r.success) sent++; else failed++;
    } catch { failed++; }
  }
  return { success: failed === 0, sent, failed, recipients };
}
