import type { NextApiRequest, NextApiResponse } from 'next';
import pool from '../../../lib/db';
import { emailService } from '../../../lib/services/emailService';

/**
 * External API — Funding Renewal Reminder Email
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * SCHEDULE: Default daily 08:00 SGT (configurable from Task Scheduler).
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * FLOW:
 *   1. Tenant gate: recipients come from the FUNDING_REMINDER_RECIPIENTS env
 *      var (comma-separated email list). Not set → single 'skipped' log row +
 *      return, so tenants without the var are unaffected.
 *   2. Select courses whose funding_validity has expired or expires within
 *      1 month (SGT, day precision) and whose renewed_status is empty — the
 *      same set shown in the "Expiring Within 1 Month — Not Yet Renewed"
 *      section of the Course Funding Validity page.
 *   3. Nothing pending → 'success' log row, no email. Otherwise one email
 *      listing all pending courses is sent to all recipients via the shared
 *      emailService (Gmail OAuth / SMTP routing from Company Settings).
 *   4. One summary row per run in funding_reminder_log.
 *
 * POST /api/external/funding-renewal-reminder
 * Headers: x-api-key: <EXTERNAL_API_KEY_FOR_CLAWDBOT>
 */

// Mirrors parseValidityDate in components/admin/FundingValidityView.tsx —
// funding_validity is free-text; ISO-prefixed strings are taken at day
// precision, anything else goes through Date parsing.
function parseValidityDate(value?: string | null): Date | null {
  if (!value) return null;
  if (/^\d{4}-\d{2}-\d{2}/.test(value)) {
    const parsed = new Date(`${value.slice(0, 10)}T00:00:00`);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
  }
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return null;
  parsed.setHours(0, 0, 0, 0);
  return parsed;
}

// Types are stored literally since the CASL conversion (Aug 2026) — Non-WSQ is
// genuinely unfunded and is no longer folded into CASL.
const displayCourseType = (value?: string | null) => value || 'Non-WSQ';

const formatDate = (date: Date) => date.toLocaleDateString('en-GB');

const escapeHtml = (value: string) =>
  value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

async function ensureLogTable() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS funding_reminder_log (
      id           SERIAL PRIMARY KEY,
      run_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      status       TEXT NOT NULL,
      course_count INTEGER NOT NULL DEFAULT 0,
      recipients   TEXT,
      error        TEXT
    )
  `);
}

async function logRun(status: string, courseCount: number, recipients: string | null, error: string | null) {
  await pool.query(
    `INSERT INTO funding_reminder_log (status, course_count, recipients, error) VALUES ($1, $2, $3, $4)`,
    [status, courseCount, recipients, error]
  ).catch(err => console.error('❌ funding-renewal-reminder: failed to write log row:', err));
}

export interface FundingReminderSummary {
  status: 'sent' | 'skipped' | 'nothing_pending' | 'error';
  courseCount: number;
  recipients: string[];
  message: string;
}

export async function runAutomation(): Promise<FundingReminderSummary> {
  await ensureLogTable();

  const recipients = (process.env.FUNDING_REMINDER_RECIPIENTS || '')
    .split(',')
    .map(email => email.trim())
    .filter(Boolean);

  if (recipients.length === 0) {
    const message = 'FUNDING_REMINDER_RECIPIENTS is not configured — skipping (tenant without funding reminders).';
    console.log(`📭 funding-renewal-reminder: ${message}`);
    await logRun('skipped', 0, null, message);
    return { status: 'skipped', courseCount: 0, recipients: [], message };
  }

  // "Today" at day precision in SGT, independent of the server timezone.
  const todayYMD = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Singapore' }).format(new Date());
  const today = new Date(`${todayYMD}T00:00:00`);
  const oneMonthAhead = new Date(today);
  oneMonthAhead.setMonth(oneMonthAhead.getMonth() + 1);

  const result = await pool.query(`
    SELECT id, title, course_code, new_course_code, course_type, funding_validity
    FROM course
    WHERE funding_validity IS NOT NULL
      AND btrim(funding_validity) <> ''
      AND (renewed_status IS NULL OR btrim(renewed_status) = '')
  `);

  const pending = result.rows
    .map((row: any) => ({ ...row, validityDate: parseValidityDate(row.funding_validity) }))
    .filter((row: any) => row.validityDate && row.validityDate <= oneMonthAhead)
    .sort((a: any, b: any) => a.validityDate.getTime() - b.validityDate.getTime());

  if (pending.length === 0) {
    const message = 'No courses expired or expiring within 1 month are pending renewal — no email sent.';
    console.log(`📭 funding-renewal-reminder: ${message}`);
    await logRun('nothing_pending', 0, recipients.join(', '), null);
    return { status: 'nothing_pending', courseCount: 0, recipients, message };
  }

  const dayMs = 86400000;
  const statusText = (validityDate: Date) => {
    const days = Math.round((validityDate.getTime() - today.getTime()) / dayMs);
    if (days < 0) return `Expired ${-days} day(s) ago`;
    if (days === 0) return 'Expires today';
    return `${days} day(s) left`;
  };

  const tableRows = pending.map((row: any) => `
    <tr>
      <td style="padding:6px 10px;border:1px solid #ddd;">${escapeHtml(row.title || '')}</td>
      <td style="padding:6px 10px;border:1px solid #ddd;white-space:nowrap;">${escapeHtml(row.new_course_code || row.course_code || '—')}</td>
      <td style="padding:6px 10px;border:1px solid #ddd;">${displayCourseType(row.course_type)}</td>
      <td style="padding:6px 10px;border:1px solid #ddd;white-space:nowrap;">${formatDate(row.validityDate)}</td>
      <td style="padding:6px 10px;border:1px solid #ddd;white-space:nowrap;color:${row.validityDate < today ? '#dc2626' : '#d97706'};font-weight:bold;">${statusText(row.validityDate)}</td>
    </tr>`).join('');

  const html = `
    <div style="font-family:Arial,Helvetica,sans-serif;font-size:14px;color:#111;">
      <p>Dear team,</p>
      <p>The following <strong>${pending.length}</strong> course(s) have funding validity that has <strong>expired or expires within 1 month</strong> and are <strong>not yet marked as renewed</strong> on the Course Funding Validity page:</p>
      <table style="border-collapse:collapse;font-size:13px;">
        <thead>
          <tr style="background:#f3f4f6;">
            <th style="padding:6px 10px;border:1px solid #ddd;text-align:left;">Course Title</th>
            <th style="padding:6px 10px;border:1px solid #ddd;text-align:left;">Ref Code</th>
            <th style="padding:6px 10px;border:1px solid #ddd;text-align:left;">Type</th>
            <th style="padding:6px 10px;border:1px solid #ddd;text-align:left;">Validity End</th>
            <th style="padding:6px 10px;border:1px solid #ddd;text-align:left;">Status</th>
          </tr>
        </thead>
        <tbody>${tableRows}</tbody>
      </table>
      <p>Please arrange the funding renewal, then tick the <strong>Renew</strong> checkbox on the Course Funding Validity page to stop reminders for that course.</p>
      <p style="color:#6b7280;font-size:12px;">This is an automated daily reminder from the LMS Task Scheduler (Funding Renewal Reminder).</p>
    </div>`;

  const text = [
    `${pending.length} course(s) have funding validity expired or expiring within 1 month and are not yet renewed:`,
    '',
    ...pending.map((row: any) =>
      `- ${row.title} [${row.new_course_code || row.course_code || '—'}] (${displayCourseType(row.course_type)}) — ends ${formatDate(row.validityDate)} — ${statusText(row.validityDate)}`),
    '',
    'Tick the Renew checkbox on the Course Funding Validity page once renewed to stop reminders for that course.',
  ].join('\n');

  const subject = `[LMS] Funding renewal reminder — ${pending.length} course(s) expiring within 1 month`;

  const sendResult = await emailService.sendEmail({
    to: recipients.join(', '),
    subject,
    html,
    text,
  });

  if (!sendResult.success) {
    const message = `Failed to send reminder email: ${sendResult.error}`;
    console.error(`❌ funding-renewal-reminder: ${message}`);
    await logRun('error', pending.length, recipients.join(', '), sendResult.error || 'unknown error');
    throw new Error(message);
  }

  const message = `Sent reminder for ${pending.length} course(s) to ${recipients.join(', ')} via ${sendResult.via}.`;
  console.log(`📧 funding-renewal-reminder: ${message}`);
  await logRun('sent', pending.length, recipients.join(', '), null);
  return { status: 'sent', courseCount: pending.length, recipients, message };
}

// ── HTTP handler (external) ──────────────────────────────────────────────────

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ success: false, error: 'Method not allowed' });
  }

  const apiKey = req.headers['x-api-key'];
  const validKey = process.env.EXTERNAL_API_KEY_FOR_CLAWDBOT;
  if (!validKey) {
    console.error('❌ EXTERNAL_API_KEY_FOR_CLAWDBOT is not configured');
    return res.status(500).json({ success: false, error: 'API key not configured on server' });
  }
  if (!apiKey || apiKey !== validKey) {
    return res.status(401).json({ success: false, error: 'Invalid or missing API key' });
  }

  try {
    const summary = await runAutomation();
    return res.status(200).json({ success: true, ...summary });
  } catch (err) {
    console.error('❌ funding-renewal-reminder error:', err);
    return res.status(500).json({
      success: false,
      error: err instanceof Error ? err.message : 'Internal server error',
    });
  }
}
