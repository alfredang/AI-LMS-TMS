import crypto from 'crypto';

export const DEFAULT_TRAINER_INVITATION_SUBJECT = '{COMPANY_SHORT_NAME} LMS - Trainer Invitation for {COURSE_TITLE} ({COURSE_RUN_ID})';

export const DEFAULT_TRAINER_INVITATION_BODY = `Hi {TRAINER_NAME},

You are invited to facilitate the following class:

Course: {COURSE_TITLE}
Course Reference Code: {COURSE_CODE}
Course Run ID: {COURSE_RUN_ID}
Start Date: {START_DATE}
End Date: {END_DATE}
Assigned Trainer (TPG0): {TPG_TRAINER}

Please review this invitation and choose one of the options below:

{ACCEPT_URL}
{DECLINE_URL}

Warm regards
{COMPANY_SHORT_NAME}`;

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
