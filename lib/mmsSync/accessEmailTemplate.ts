export const DEFAULT_MMS_ACCESS_EMAIL_SUBJECT = '{PURPOSE}: {COURSE_TITLE} — MMS {CLASS_ID}';

export const DEFAULT_MMS_ACCESS_EMAIL_BODY = `Dear {RECIPIENT_NAME},

Please {ACTION} this class using MMS.

{COURSE_TITLE} ({COURSE_CODE})
Class: {CLASS_ID}
{SESSIONS}

Open MMS class: {MMS_CLASS_URL}
MMS login: {MMS_LOGIN_URL}

Use the email registered for this class. Request an email OTP or use your existing MMS password. Select {ROLE} if asked to choose a role. Your TMS password is not automatically your MMS password. Course materials and attendance are available in your MMS class.{FEEDBACK_LINE}

Support: {SUPPORT}`;

export interface MmsAccessEmailTemplate {
  subject: string;
  body: string;
}

export interface MmsAccessEmailValues {
  PURPOSE: string;
  RECIPIENT_NAME: string;
  ACTION: string;
  ROLE: string;
  COURSE_TITLE: string;
  COURSE_CODE: string;
  CLASS_ID: string;
  SESSIONS: string;
  MMS_CLASS_URL: string;
  MMS_LOGIN_URL: string;
  FEEDBACK_URL: string;
  FEEDBACK_LINE: string;
  SUPPORT: string;
}

const escapeHtml = (value: unknown) => String(value ?? '').replace(
  /[&<>"']/g,
  character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[character]!),
);

export function renderMmsAccessTemplate(template: string, values: MmsAccessEmailValues): string {
  return template.replace(/\{([A-Z_]+)\}/g, (placeholder, key: keyof MmsAccessEmailValues) =>
    Object.prototype.hasOwnProperty.call(values, key) ? values[key] : placeholder,
  );
}

export function renderMmsAccessEmail(
  template: MmsAccessEmailTemplate,
  values: MmsAccessEmailValues,
): { subject: string; text: string; html: string } {
  const subject = renderMmsAccessTemplate(template.subject, values).replace(/[\r\n]+/g, ' ').trim();
  const text = renderMmsAccessTemplate(template.body, values);
  // Outlook does not reliably honor white-space:pre-wrap in received email.
  // Explicit <br> elements preserve the editable plain-text layout everywhere.
  const htmlText = escapeHtml(text).replace(/\r\n|\r|\n/g, '<br>');
  return {
    subject,
    text,
    html: `<div style="font-family:Arial,sans-serif;line-height:1.5">${htmlText}</div>`,
  };
}
