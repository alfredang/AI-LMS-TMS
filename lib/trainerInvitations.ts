import crypto from 'crypto';

export const DEFAULT_TRAINER_INVITATION_SUBJECT = '{COMPANY_SHORT_NAME} LMS - Trainer Invitation for {COURSE_TITLE} ({COURSE_RUN_ID})';

export const DEFAULT_TRAINER_INVITATION_BODY = `Hi {TRAINER_NAME},

You are invited to facilitate the following class:

Course: {COURSE_TITLE}
Course Reference Code: {COURSE_CODE}
Course Run ID: {COURSE_RUN_ID}
Start Date: {START_DATE}
End Date: {END_DATE}
Assigned Trainer (TPG): {TPG_TRAINER}

Please review this invitation and choose one of the options below:

{ACCEPT_BUTTON}

{DECLINE_BUTTON}

Once accepted, please check the TMS portal to view your upcoming class:
https://ai-lms-tms.tertiaryinfo.tech

Warm regards
{COMPANY_SHORT_NAME}`;

export const DEFAULT_TRAINER_ACCEPT_SUBJECT = 'Thank You for Accepting - {COURSE_TITLE} ({COURSE_RUN_ID})';

export const DEFAULT_TRAINER_ACCEPT_BODY = `Hi {TRAINER_NAME},

Thank you for confirming your availability for the upcoming training session. We appreciate your commitment and support.

Course Schedule Confirmation
Course Title: {COURSE_TITLE}
Course Code: {COURSE_CODE}
Course Run ID: {COURSE_RUN_ID}
Start Date: {START_DATE}
End Date: {END_DATE}

We will send you a Google Calendar invite with the confirmed training details shortly. Please kindly ensure you accept the RSVP on Google Calendar to officially confirm your participation.

A reminder will be sent closer to the course date to keep you updated.

Thank you once again for partnering with us. We look forward to working with you to make this class a success!

Best regards,
Support Team
{COMPANY_SHORT_NAME}
Tel: 61000613 | Email: support@tertiaryinfotech.com | WhatsApp: https://wa.me/6561000613`;

export const DEFAULT_TRAINER_DECLINE_SUBJECT = 'Thank You for Your Response - {COURSE_TITLE} ({COURSE_RUN_ID})';

export const DEFAULT_TRAINER_DECLINE_BODY = `Hi {TRAINER_NAME},

Thank you for letting us know. We completely understand and truly appreciate your response.

While we're sorry to miss you for this session, we sincerely look forward to working with you on future training opportunities.

Thank you once again for your support and collaboration. We value your partnership and hope to connect again soon.

Best regards,
Support Team
{COMPANY_SHORT_NAME}
Tel: 61000613 | Email: support@tertiaryinfotech.com | WhatsApp: https://wa.me/6561000613`;

export function normalizeTrainerName(name: string | null | undefined) {
  return String(name || '')
    .replace(/\[[^\]]+\]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

export function splitTrainerList(raw: string | null | undefined) {
  return String(raw || '')
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
}

export function createInvitationToken() {
  return crypto.randomBytes(24).toString('hex');
}

export function formatDateLabel(dateValue: string | Date | null | undefined) {
  if (!dateValue) return 'N/A';
  const date = new Date(dateValue);
  if (Number.isNaN(date.getTime())) return 'N/A';
  return date.toLocaleDateString('en-GB');
}

export async function ensureTpgTrainerColumns(query: (sql: string, params?: any[]) => Promise<any>) {
  await query(`ALTER TABLE course_run ADD COLUMN IF NOT EXISTS tpg_assigned_trainer_id UUID`);
  await query(`ALTER TABLE course_run ADD COLUMN IF NOT EXISTS tpg_assigned_trainer_name TEXT`);
  await query(`ALTER TABLE course_run ADD COLUMN IF NOT EXISTS tpg_assigned_trainer_email TEXT`);
}

export async function ensureTrainerInvitationTemplateColumns(query: (sql: string, params?: any[]) => Promise<any>) {
  await query(`ALTER TABLE training_provider ADD COLUMN IF NOT EXISTS trainer_invitation_email_subject TEXT`);
  await query(`ALTER TABLE training_provider ADD COLUMN IF NOT EXISTS trainer_invitation_email_body TEXT`);
  await query(`ALTER TABLE training_provider ADD COLUMN IF NOT EXISTS trainer_accept_email_subject TEXT`);
  await query(`ALTER TABLE training_provider ADD COLUMN IF NOT EXISTS trainer_accept_email_body TEXT`);
  await query(`ALTER TABLE training_provider ADD COLUMN IF NOT EXISTS trainer_decline_email_subject TEXT`);
  await query(`ALTER TABLE training_provider ADD COLUMN IF NOT EXISTS trainer_decline_email_body TEXT`);
}

export async function ensureTrainerInvitationTable(query: (sql: string, params?: any[]) => Promise<any>) {
  await query(`
    CREATE TABLE IF NOT EXISTS trainer_invitation (
      id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
      course_run_id UUID NOT NULL REFERENCES course_run(id) ON DELETE CASCADE,
      trainer_name TEXT NOT NULL,
      trainer_email TEXT NOT NULL,
      token TEXT NOT NULL UNIQUE,
      status TEXT NOT NULL DEFAULT 'pending',
      email_subject TEXT,
      email_body TEXT,
      sent_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      responded_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
  await query(`CREATE INDEX IF NOT EXISTS idx_trainer_invitation_course_run ON trainer_invitation(course_run_id, created_at DESC)`);
}

export function renderInvitationTemplate(template: string, replacements: Record<string, string>) {
  return Object.entries(replacements).reduce((output, [key, value]) => {
    const safeValue = value ?? '';
    return output.replace(new RegExp(`\\{${key}\\}`, 'g'), safeValue);
  }, template);
}

export function renderInvitationHtmlEmail(template: string, replacements: Record<string, string>, acceptUrl: string, declineUrl: string) {
  // First do regular text replacements
  let textWithVars = renderInvitationTemplate(template, replacements);
  
  // Convert standard text to HTML
  let htmlBody = convertPlainTextToHtml(textWithVars);

  // Inject HTML buttons right where the placeholders are over raw links
  const acceptButtonHtml = `
  <table cellpadding="0" cellspacing="0" style="margin:16px 0;">
    <tr>
      <td>
        <a href="${acceptUrl}" style="display:inline-block;background:#16a34a;color:#ffffff;padding:12px 28px;border-radius:6px;text-decoration:none;font-weight:700;font-size:15px;text-align:center;">✓ Accept Invitation</a>
      </td>
    </tr>
  </table>`;

  const declineButtonHtml = `
  <table cellpadding="0" cellspacing="0" style="margin:16px 0;">
    <tr>
      <td>
        <a href="${declineUrl}" style="display:inline-block;background:#dc2626;color:#ffffff;padding:12px 28px;border-radius:6px;text-decoration:none;font-weight:700;font-size:15px;text-align:center;">✗ Decline Invitation</a>
      </td>
    </tr>
  </table>`;

  htmlBody = htmlBody.replace(/\{ACCEPT_BUTTON\}/g, acceptButtonHtml);
  htmlBody = htmlBody.replace(/\{DECLINE_BUTTON\}/g, declineButtonHtml);
  // Backwards compatibility
  htmlBody = htmlBody.replace(/\{ACCEPT_URL\}/g, acceptButtonHtml);
  htmlBody = htmlBody.replace(/\{DECLINE_URL\}/g, declineButtonHtml);

  return `
<div style="font-family:Arial,sans-serif;font-size:14px;color:#334155;line-height:1.6;max-width:600px;margin:0 auto;padding:20px;">
  ${htmlBody}
  <div style="border-top:1px solid #e2e8f0;padding-top:16px;margin-top:32px;">
    <p style="margin:0;font-size:12px;color:#94a3b8;font-style:italic;">This is an automated email. Please do not reply directly to this message.</p>
  </div>
</div>`;
}

export function convertPlainTextToHtml(text: string) {
  return text
    .split('\n')
    .map((line) => {
      if (!line.trim()) return '<br />';
      const escaped = line
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;');
      const linked = escaped.replace(/(https?:\/\/[^\s]+)/g, '<a href="$1" style="color:#2563eb;text-decoration:none;">$1</a>');
      return `<p style="margin:0 0 8px 0;">${linked}</p>`;
    })
    .join('');
}
