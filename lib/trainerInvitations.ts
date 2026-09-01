import crypto from 'crypto';

export const DEFAULT_TRAINER_INVITATION_SUBJECT = '{COMPANY_SHORT_NAME} LMS - Trainer Invitation for {COURSE_TITLE} ({COURSE_RUN_ID})';

export const DEFAULT_TRAINER_INVITATION_BODY = `Hi {TRAINER_NAME},

We hope this message finds you well. As one of our valued trainers, we are pleased to invite you to conduct the upcoming session of the **{COURSE_TITLE}** course.

**Course Schedule**
**Course Title:** {COURSE_TITLE}
**Course Code:** {COURSE_CODE}
**Class Type:** {COURSE_TYPE}
**Start Date:** {START_DATE}
**End Date:** {END_DATE}
**Total Class Duration:** {DURATION}

**Note:** Each day represents 8 hours of training (evening classes are around 3 hours each). Detailed timing and dates will be sent via Google Calendar invite upon acceptance.

To help us finalize the schedule, we kindly ask that you confirm your availability to teach this session by **{CONFIRM_BY}**.

You can confirm simply by clicking the Accept or Decline button below. If you have any questions regarding the course details, logistics, or terms, please do not hesitate to reach out to us.

{ACTION_BUTTONS}

Thank you very much for your time and support. We look forward to your response and hope to work with you on this session.

Best regards,
Support Team
{COMPANY_SHORT_NAME}
Tel: {COMPANY_PHONE} | Email: {COMPANY_EMAIL} | WhatsApp: https://wa.me/{COMPANY_WHATSAPP}`;

export const DEFAULT_TRAINER_ACCEPT_SUBJECT = 'Thank You for Accepting - {COURSE_TITLE} ({COURSE_RUN_ID})';

export const DEFAULT_TRAINER_ACCEPT_BODY = `Hi {TRAINER_NAME},

Thank you for confirming your availability for the upcoming training session. We appreciate your commitment and support.

Course Schedule Confirmation
Course Title: {COURSE_TITLE}
Course Code: {COURSE_CODE}
Course Run ID: {COURSE_RUN_ID}
Training Mode: {TRAINING_MODE}{MEET_LINK_LINE}
Start Date: {START_DATE}
End Date: {END_DATE}

A Google Calendar invite with the confirmed training details has been sent to this email address. Please kindly accept the Google Calendar invite (RSVP "Yes") to officially confirm your participation.

A reminder will be sent closer to the course date to keep you updated.

Thank you once again for partnering with us. We look forward to working with you to make this class a success!

Best regards,
Support Team
{COMPANY_SHORT_NAME}
Tel: {COMPANY_PHONE} | Email: {COMPANY_EMAIL} | WhatsApp: https://wa.me/{COMPANY_WHATSAPP}`;

export const DEFAULT_TRAINER_DECLINE_SUBJECT = 'Thank You for Your Response - {COURSE_TITLE} ({COURSE_RUN_ID})';

export const DEFAULT_TRAINER_DECLINE_BODY = `Hi {TRAINER_NAME},

Thank you for letting us know. We completely understand and truly appreciate your response.

While we're sorry to miss you for this session, we sincerely look forward to working with you on future training opportunities.

Thank you once again for your support and collaboration. We value your partnership and hope to connect again soon.

Best regards,
Support Team
{COMPANY_SHORT_NAME}
Tel: {COMPANY_PHONE} | Email: {COMPANY_EMAIL} | WhatsApp: https://wa.me/{COMPANY_WHATSAPP}`;

export function normalizeTrainerName(name: string | null | undefined) {
  return String(name || '')
    .replace(/\[[^\]]+\]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

export function splitTrainerList(raw: string | null | undefined) {
  const s = String(raw || '').trim();
  if (!s) return [];
  // Primary: pipe delimiter
  if (s.includes('|')) {
    return s.split('|').map((item) => item.trim()).filter(Boolean);
  }
  // Fallback: comma delimiter (legacy data)
  return s.split(',').map((item) => item.trim()).filter(Boolean);
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
  course_mode?: string | null;            // mode_of_learning: Physical/Virtual/Hybrid
  course_type?: string | null;            // WSQ, Non-WSQ, etc.
  training_hours?: string | number | null;
  assessment_hours?: string | number | null;
  num_of_days?: string | number | null;   // course.num_of_days — authoritative source for class days
  session_days?: string | number | null;  // distinct count of course_session.start_date for this run, optional
  start_date?: string | Date | null;
  end_date?: string | Date | null;
  tpg_assigned_trainer_name?: string | null;
}

/**
 * Resolve the class duration label. Preference order:
 *   1. Distinct session count from course_session (caller passes via session_days).
 *   2. course.num_of_days (the authoritative course-level field).
 *   3. Calendar span (end - start + 1) — last resort, naive and counts weekends.
 *
 * Returns a label like "2 days" / "1 day", or 'N/A' when no source is usable.
 */
export function resolveClassDurationDays(row: Pick<InvitationClassRow, 'num_of_days' | 'session_days' | 'start_date' | 'end_date'>): { days: number | null; label: string } {
  const toPositiveInt = (v: unknown): number | null => {
    if (v == null || v === '') return null;
    const n = Number(v);
    return Number.isFinite(n) && n > 0 ? Math.round(n) : null;
  };

  const sessionDays = toPositiveInt(row.session_days);
  if (sessionDays) return { days: sessionDays, label: `${sessionDays} day${sessionDays === 1 ? '' : 's'}` };

  const numOfDays = toPositiveInt(row.num_of_days);
  if (numOfDays) return { days: numOfDays, label: `${numOfDays} day${numOfDays === 1 ? '' : 's'}` };

  if (row.start_date && row.end_date) {
    const startMs = new Date(row.start_date as any).getTime();
    const endMs = new Date(row.end_date as any).getTime();
    if (!Number.isNaN(startMs) && !Number.isNaN(endMs) && endMs >= startMs) {
      const span = Math.round((endMs - startMs) / (1000 * 60 * 60 * 24)) + 1;
      return { days: span, label: `${span} day${span === 1 ? '' : 's'}` };
    }
  }

  return { days: null, label: 'N/A' };
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
  companyPhone?: string;
  companyEmail?: string;
  acceptUrl: string;
  declineUrl: string;
}): Record<string, string> {
  const { classRow, trainerName, companyShortName, companyPhone, companyEmail, acceptUrl, declineUrl } = opts;

  // Duration: prefer course.num_of_days / session count over the naive span
  // (see resolveClassDurationDays for the preference order).
  const { label: durationLabel } = resolveClassDurationDays(classRow);

  // Confirmation deadline: 2 days from now at 23:59 SGT. Formatted as
  // DD-MM-YYYY with hyphens to match the agreed copy.
  const confirmBy = new Date();
  confirmBy.setDate(confirmBy.getDate() + 2);
  const dd = String(confirmBy.getDate()).padStart(2, '0');
  const mm = String(confirmBy.getMonth() + 1).padStart(2, '0');
  const yyyy = confirmBy.getFullYear();
  const confirmByLabel = `${dd}-${mm}-${yyyy}, 23:59 PM`;

  // Course hours: show as "Xh" when a positive numeric value is present
  const trainingVal = classRow.training_hours != null ? Number(classRow.training_hours) : 0;
  const assessmentVal = classRow.assessment_hours != null ? Number(classRow.assessment_hours) : 0;
  const hoursVal = (Number.isFinite(trainingVal) ? trainingVal : 0) + (Number.isFinite(assessmentVal) ? assessmentVal : 0);
  const courseHoursLabel = hoursVal > 0 ? `${hoursVal} hours` : 'N/A';

  return {
    COMPANY_SHORT_NAME: companyShortName,
    TRAINER_NAME: trainerName,
    COURSE_TITLE: classRow.course_title || '',
    COURSE_CODE: classRow.course_code || '',
    CLASS_TYPE: classRow.course_mode || 'N/A',
    COURSE_TYPE: classRow.course_type || classRow.course_mode || 'N/A',
    COURSE_RUN_ID: classRow.course_run_id || '',
    START_DATE: formatDateLabel(classRow.start_date),
    END_DATE: formatDateLabel(classRow.end_date),
    DURATION: durationLabel,
    COURSE_HOURS: courseHoursLabel,
    CONFIRM_BY: confirmByLabel,
    TPG_TRAINER: classRow.tpg_assigned_trainer_name || 'N/A',
    ACCEPT_URL: acceptUrl,
    DECLINE_URL: declineUrl,
    COMPANY_PHONE: companyPhone || '',
    COMPANY_EMAIL: companyEmail || '',
    COMPANY_WHATSAPP: (companyPhone || '').replace(/[^0-9]/g, ''),
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
  // Comma-separated list of addresses to CC on every trainer invitation
  // (manual send, auto-escalation on decline, and the weekly sweep all
  // honour this). NULL means "no CC".
  await query(`ALTER TABLE training_provider ADD COLUMN IF NOT EXISTS trainer_invitation_email_cc TEXT`);
  await query(`ALTER TABLE training_provider ADD COLUMN IF NOT EXISTS trainer_accept_email_subject TEXT`);
  await query(`ALTER TABLE training_provider ADD COLUMN IF NOT EXISTS trainer_accept_email_body TEXT`);
  // CC list for the accept confirmation email sent to the trainer after
  // they click Accept. NULL means "no CC".
  await query(`ALTER TABLE training_provider ADD COLUMN IF NOT EXISTS trainer_accept_email_cc TEXT`);
  await query(`ALTER TABLE training_provider ADD COLUMN IF NOT EXISTS trainer_decline_email_subject TEXT`);
  await query(`ALTER TABLE training_provider ADD COLUMN IF NOT EXISTS trainer_decline_email_body TEXT`);
  // CC list for the decline acknowledgement email sent to the trainer
  // after they click Decline. NULL means "no CC".
  await query(`ALTER TABLE training_provider ADD COLUMN IF NOT EXISTS trainer_decline_email_cc TEXT`);
  // Reply-To override for ALL trainer emails (invitation + accept/decline acks).
  // When NULL/blank, falls back to company_email then email_user (legacy behaviour).
  // Dr Ang's requirement: trainer replies should reach the assignment owner.
  await query(`ALTER TABLE training_provider ADD COLUMN IF NOT EXISTS trainer_invitation_reply_to TEXT`);
  // Recipients (comma/semicolon/newline list) for the "invite list exhausted"
  // alert — sent once when every approved trainer for a run has declined and
  // none accepted. NULL/blank means the alert is disabled (no email sent).
  await query(`ALTER TABLE training_provider ADD COLUMN IF NOT EXISTS trainer_exhausted_alert_recipients TEXT`);
  // Minimum lead time (days) before class start for the auto-invite cron to still
  // send. The cron's lower bound is start_date >= today + this value. Default 1 =
  // exclude same-day starts (invite only for tomorrow onward); 0 = allow same-day.
  await query(`ALTER TABLE training_provider ADD COLUMN IF NOT EXISTS trainer_invitation_min_lead_days INTEGER DEFAULT 1`);
}

// Dedupe column for the exhausted-list alert: set when an alert fires for a run,
// cleared whenever a fresh invitation later goes out (so a re-exhausted run can
// re-alert). Kept separate from the template columns so the invite sender can
// ensure it cheaply.
export async function ensureExhaustedAlertColumn(query: (sql: string, params?: any[]) => Promise<any>) {
  await query(`ALTER TABLE course_run ADD COLUMN IF NOT EXISTS exhausted_alert_sent_at TIMESTAMPTZ`);
}

/**
 * Parse and validate a comma/semicolon/newline-separated CC list into a
 * deduplicated array of lowercase email addresses. Invalid tokens are
 * silently dropped — that's fine here because the UI shows the raw text
 * back to the admin, so they can correct typos themselves.
 */
export function parseCcList(raw: string | null | undefined): string[] {
  if (!raw) return [];
  const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  const tokens = raw
    .split(/[,;\n\r]+/)
    .map(s => s.trim())
    .filter(Boolean);
  const seen = new Set<string>();
  const out: string[] = [];
  for (const t of tokens) {
    const lower = t.toLowerCase();
    if (!EMAIL_RE.test(lower)) continue;
    if (seen.has(lower)) continue;
    seen.add(lower);
    out.push(lower);
  }
  return out;
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
<div style="font-family:Arial,sans-serif;font-size:14px;color:#1f2937;line-height:1.55;background-color:#ffffff;">
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
