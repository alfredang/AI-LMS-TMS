import crypto from 'crypto';

export const DEFAULT_TRAINER_INVITATION_SUBJECT = '{COMPANY_SHORT_NAME} LMS - Trainer Invitation for {COURSE_TITLE} ({COURSE_RUN_ID})';

export const DEFAULT_TRAINER_INVITATION_BODY = `Hi {TRAINER_NAME},

We hope this message finds you well. As one of our valued trainers, we are pleased to invite you to conduct the upcoming session of the **{COURSE_TITLE}** course.

**Course Schedule**
**Course Title:** {COURSE_TITLE}
**Course Type:** {COURSE_TYPE}
**Course Code:** {COURSE_CODE}
**Start Date:** {START_DATE}
**End Date:** {END_DATE}
**Duration:** {DURATION}
**Course Hours:** {COURSE_HOURS}

**Note:** Each day represents 8 hours of training (evening classes are around 3 hours each). Detailed timing and dates will be sent via Google Calendar invite upon acceptance.

To help us finalize the schedule, we kindly ask that you confirm your availability to teach this session by **{CONFIRM_BY}**.

You can confirm simply by clicking on the Accept or Decline buttons below. If you have any questions regarding the course details, logistics, or terms, please do not hesitate to reach out to us.

{ACTION_BUTTONS}

Thank you very much for your time and support. We look forward to your response and hope to work with you on this session.

Best regards,
Support Team
{COMPANY_SHORT_NAME}
Tel: 61000613 | Email: support@tertiaryinfotech.com | WhatsApp: https://wa.me/6561000613`;

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

/**
 * Shape accepted by `buildInvitationReplacements`. Both the manual-send and
 * the auto-escalation paths provide this from joined `course_run` + `course`
 * rows. Fields are loosely typed so either SQL or pre-formatted values work.
 */
export interface InvitationClassRow {
  course_run_id?: string | null;          // external/TPG course run id
  course_title?: string | null;
  course_code?: string | null;
  course_mode?: string | null;            // maps to mode_of_learning (Physical/Virtual/...)
  training_hours?: string | number | null;
  start_date?: string | Date | null;
  end_date?: string | Date | null;
  tpg_assigned_trainer_name?: string | null;
}

/**
 * Build the full placeholder map used by `renderInvitationTemplate` +
 * `renderInvitationHtmlEmail`. Centralized here so the manual-send endpoint
 * (`/api/admin/send-trainer-invitation`) and the auto-escalation path
 * (`/api/public/trainer-invitation/respond` on decline) stay in sync — any
 * new placeholder only needs to be added once.
 */
export function buildInvitationReplacements(opts: {
  classRow: InvitationClassRow;
  trainerName: string;
  companyShortName: string;
  acceptUrl: string;
  declineUrl: string;
}): Record<string, string> {
  const { classRow, trainerName, companyShortName, acceptUrl, declineUrl } = opts;

  // Duration in days (inclusive of start and end)
  let durationLabel = 'N/A';
  if (classRow.start_date && classRow.end_date) {
    const startMs = new Date(classRow.start_date as any).getTime();
    const endMs = new Date(classRow.end_date as any).getTime();
    if (!Number.isNaN(startMs) && !Number.isNaN(endMs) && endMs >= startMs) {
      const days = Math.round((endMs - startMs) / (1000 * 60 * 60 * 24)) + 1;
      durationLabel = `${days} day${days === 1 ? '' : 's'}`;
    }
  }

  // Confirmation deadline: 2 days from now at 23:59 SGT
  const confirmBy = new Date();
  confirmBy.setDate(confirmBy.getDate() + 2);
  const confirmByLabel = `${confirmBy.toLocaleDateString('en-GB')}, 23:59 PM`;

  // Course hours: show as "Xh" when a positive numeric value is present
  const hoursVal = classRow.training_hours != null ? Number(classRow.training_hours) : NaN;
  const courseHoursLabel = Number.isFinite(hoursVal) && hoursVal > 0 ? `${hoursVal}h` : 'N/A';

  return {
    COMPANY_SHORT_NAME: companyShortName,
    TRAINER_NAME: trainerName,
    COURSE_TITLE: classRow.course_title || '',
    COURSE_CODE: classRow.course_code || '',
    COURSE_TYPE: classRow.course_mode || 'N/A',
    COURSE_RUN_ID: classRow.course_run_id || '',
    START_DATE: formatDateLabel(classRow.start_date),
    END_DATE: formatDateLabel(classRow.end_date),
    DURATION: durationLabel,
    COURSE_HOURS: courseHoursLabel,
    CONFIRM_BY: confirmByLabel,
    TPG_TRAINER: classRow.tpg_assigned_trainer_name || 'N/A',
    ACCEPT_URL: acceptUrl,
    DECLINE_URL: declineUrl,
  };
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
  // Protect button placeholders so convertPlainTextToHtml does not touch them
  // (otherwise raw URLs inside them would get wrapped in <a> tags).
  const safeReplacements = { ...replacements };
  safeReplacements['ACCEPT_URL'] = '{PRESERVED_ACCEPT}';
  safeReplacements['DECLINE_URL'] = '{PRESERVED_DECLINE}';
  safeReplacements['ACCEPT_BUTTON'] = '{PRESERVED_ACCEPT}';
  safeReplacements['DECLINE_BUTTON'] = '{PRESERVED_DECLINE}';
  safeReplacements['ACTION_BUTTONS'] = '{PRESERVED_ACTIONS}';

  // Apply regular text replacements using the safe mapping
  const textWithVars = renderInvitationTemplate(template, safeReplacements);

  // Convert plain text to tightly-packed HTML
  let htmlBody = convertPlainTextToHtml(textWithVars);

  // Side-by-side Accept + Decline buttons in a single row (Gmail-safe table layout)
  const actionButtonsHtml = `
  <table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:20px 0;">
    <tr>
      <td style="padding-right:12px;">
        <a href="${acceptUrl}" style="display:inline-block;background:#16a34a;color:#ffffff;padding:12px 28px;border-radius:6px;text-decoration:none;font-weight:700;font-size:15px;text-align:center;font-family:Arial,sans-serif;">&#10003; Accept Invitation</a>
      </td>
      <td>
        <a href="${declineUrl}" style="display:inline-block;background:#dc2626;color:#ffffff;padding:12px 28px;border-radius:6px;text-decoration:none;font-weight:700;font-size:15px;text-align:center;font-family:Arial,sans-serif;">&#10007; Decline Invitation</a>
      </td>
    </tr>
  </table>`;

  // Backward-compat single-button blocks (for templates still using {ACCEPT_BUTTON}/{DECLINE_BUTTON})
  const acceptButtonHtml = `
  <table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:12px 0;">
    <tr>
      <td>
        <a href="${acceptUrl}" style="display:inline-block;background:#16a34a;color:#ffffff;padding:12px 28px;border-radius:6px;text-decoration:none;font-weight:700;font-size:15px;text-align:center;font-family:Arial,sans-serif;">&#10003; Accept Invitation</a>
      </td>
    </tr>
  </table>`;

  const declineButtonHtml = `
  <table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:12px 0;">
    <tr>
      <td>
        <a href="${declineUrl}" style="display:inline-block;background:#dc2626;color:#ffffff;padding:12px 28px;border-radius:6px;text-decoration:none;font-weight:700;font-size:15px;text-align:center;font-family:Arial,sans-serif;">&#10007; Decline Invitation</a>
      </td>
    </tr>
  </table>`;

  htmlBody = htmlBody.replace(/\{PRESERVED_ACTIONS\}/g, actionButtonsHtml);
  htmlBody = htmlBody.replace(/\{PRESERVED_ACCEPT\}/g, acceptButtonHtml);
  htmlBody = htmlBody.replace(/\{PRESERVED_DECLINE\}/g, declineButtonHtml);
  htmlBody = htmlBody.replace(/\{ACTION_BUTTONS\}/g, actionButtonsHtml);
  htmlBody = htmlBody.replace(/\{ACCEPT_BUTTON\}/g, acceptButtonHtml);
  htmlBody = htmlBody.replace(/\{DECLINE_BUTTON\}/g, declineButtonHtml);
  htmlBody = htmlBody.replace(/\{ACCEPT_URL\}/g, acceptButtonHtml);
  htmlBody = htmlBody.replace(/\{DECLINE_URL\}/g, declineButtonHtml);

  return `
<div style="font-family:Arial,sans-serif;font-size:14px;color:#1f2937;line-height:1.55;max-width:640px;margin:0 auto;padding:24px;background-color:#ffffff;">
  ${htmlBody}
  <div style="border-top:1px solid #e5e7eb;padding-top:14px;margin-top:28px;">
    <p style="margin:0;font-size:12px;color:#94a3b8;font-style:italic;">This is an automated email. Please do not reply directly to this message.</p>
  </div>
</div>`;
}

/**
 * Convert plain text to Gmail-safe HTML with tight line spacing.
 * - Consecutive non-empty lines have zero margin (no visual gap).
 * - Blank lines in the source become a single spacer to separate paragraphs/blocks.
 * - `**bold**` is converted to `<strong>bold</strong>`.
 * - Raw URLs become clickable links.
 */
export function convertPlainTextToHtml(text: string) {
  const lines = text.split('\n');
  const out: string[] = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (!line.trim()) {
      // Collapse multiple consecutive blanks into one spacer to avoid huge gaps.
      if (out.length > 0 && !out[out.length - 1].endsWith('__SPACER__')) {
        out.push('<div style="height:10px;line-height:10px;font-size:0;">&nbsp;</div>__SPACER__');
      }
      continue;
    }

    const escaped = line
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');

    // Bold: **text** → <strong>text</strong>
    const bolded = escaped.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');

    // Auto-link raw URLs
    const linked = bolded.replace(/(https?:\/\/[^\s<]+)/g, '<a href="$1" style="color:#2563eb;text-decoration:none;">$1</a>');

    out.push(`<div style="margin:0;padding:0;">${linked}</div>`);
  }

  // Strip the __SPACER__ sentinels used only to detect back-to-back blanks.
  return out.join('').replace(/__SPACER__/g, '');
}
