import crypto from 'crypto';
import type { Pool } from 'pg';

import pool from '../db';
import { sendViaGmailOAuth } from '../gmailOauthSend';
import { getGoogleDriveClient } from '../google-auth/googleAuth';
import { getTrainingPartnerIdentifiers } from '../trainingPartnerIdentifiers';
import { generateAndUploadCertificate } from './certificateService';
import { checkCertificateIssuance } from './certificateIssuance';
import type { CertificateEligibilityMode, CertificateIssueInput } from './certificateDeliveryRules';

const GENERATING_MARKER = '__generating__';
const DELIVERY_CLAIM_TTL_MINUTES = 15;
const deliveryTableReady = new WeakMap<Pool, Promise<void>>();

export interface CertificateCandidate {
  enrollmentId: string;
  learnerId: string | null;
  learnerName: string;
  learnerEmail: string | null;
  certificateUrl: string | null;
  courseId: string;
  courseCode: string | null;
  courseTitle: string;
  courseRunUuid: string;
  courseRunId: string | null;
  courseDates: string;
  assessmentStatus: string | null;
  enrolmentStatus: string | null;
  classStatus: string | null;
}

export type CertificateIssueStatus =
  | 'preview'
  | 'generated'
  | 'existing'
  | 'sent'
  | 'already_sent'
  | 'email_failed';

export interface CertificateIssueResult {
  success: boolean;
  status: CertificateIssueStatus;
  enrollmentId: string;
  learnerName: string;
  learnerEmail: string | null;
  courseCode: string | null;
  courseTitle: string;
  courseRunId: string | null;
  courseRunUuid: string;
  certificateUrl: string | null;
  generated: boolean;
  emailed: boolean;
  gmailMessageId?: string;
  error?: string;
}

export class CertificateIssueError extends Error {
  constructor(
    message: string,
    public readonly code: string,
    public readonly status: number,
    public readonly details?: unknown,
  ) {
    super(message);
    this.name = 'CertificateIssueError';
  }
}

interface IssueOptions extends CertificateIssueInput {
  requestSource: string;
}

interface DeliveryClaim {
  key: string;
  state: 'claimed' | 'already_sent' | 'in_progress' | 'uncertain';
  messageId?: string;
}

export async function ensureCertificateDeliveryTable(db: Pool = pool): Promise<void> {
  const existing = deliveryTableReady.get(db);
  if (existing) return existing;

  const setup = db.query(`
    CREATE TABLE IF NOT EXISTS certificate_delivery_log (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      delivery_key text NOT NULL UNIQUE,
      enrollment_id uuid REFERENCES enrollment(id) ON DELETE SET NULL,
      recipient_email text NOT NULL,
      certificate_url text,
      status text NOT NULL,
      request_source text NOT NULL,
      request_reason text,
      attempt_count integer NOT NULL DEFAULT 1,
      gmail_message_id text,
      error_message text,
      claimed_at timestamptz NOT NULL DEFAULT now(),
      sent_at timestamptz,
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now()
    );
    CREATE INDEX IF NOT EXISTS certificate_delivery_enrollment_idx
      ON certificate_delivery_log (enrollment_id, created_at DESC);
    CREATE INDEX IF NOT EXISTS certificate_delivery_status_idx
      ON certificate_delivery_log (status, updated_at DESC);
  `).then(() => undefined).catch((error) => {
    deliveryTableReady.delete(db);
    throw error;
  });
  deliveryTableReady.set(db, setup);
  return setup;
}

function buildCandidate(row: any): CertificateCandidate {
  const rawCertificate = String(row.certificate_url || '').trim();
  return {
    enrollmentId: row.enrollment_id,
    learnerId: row.learner_id || null,
    learnerName: row.learner_name,
    learnerEmail: row.learner_email || null,
    certificateUrl: rawCertificate && rawCertificate !== GENERATING_MARKER ? rawCertificate : null,
    courseId: row.course_id,
    courseCode: row.course_code || null,
    courseTitle: row.course_title,
    courseRunUuid: row.course_run_uuid,
    courseRunId: row.course_run_id || null,
    courseDates: row.course_dates || '',
    assessmentStatus: row.assessment_status || null,
    enrolmentStatus: row.enrolment_status || null,
    classStatus: row.class_status || null,
  };
}

export async function resolveCertificateCandidates(
  input: Pick<CertificateIssueInput, 'enrollmentId' | 'learnerName' | 'learnerEmail' | 'courseRunId' | 'courseCode' | 'courseTitle' | 'course'>,
  db: Pool = pool,
): Promise<CertificateCandidate[]> {
  const conditions: string[] = [];
  const params: string[] = [];
  const add = (sql: string, value: string) => {
    params.push(value);
    conditions.push(sql.replace('?', `$${params.length}`));
  };

  if (input.enrollmentId) add('e.id::text = ?', input.enrollmentId);
  if (input.learnerName) add("LOWER(COALESCE(au.full_name, '')) = LOWER(?)", input.learnerName);
  if (input.learnerEmail) {
    params.push(input.learnerEmail);
    conditions.push(`(LOWER(au.email) = LOWER($${params.length}) OR LOWER(e.email) = LOWER($${params.length}))`);
  }
  if (input.courseRunId) {
    params.push(input.courseRunId);
    conditions.push(`(cr.id::text = $${params.length} OR cr.course_run_id = $${params.length})`);
  }
  if (input.courseCode) {
    params.push(input.courseCode);
    conditions.push(`(
      LOWER(c.course_code) = LOWER($${params.length})
      OR LOWER(COALESCE(c.new_course_code, '')) = LOWER($${params.length})
    )`);
  }
  if (input.courseTitle) add('LOWER(c.title) = LOWER(?)', input.courseTitle);
  if (input.course) {
    params.push(input.course, input.course, `%${input.course}%`);
    const n = params.length;
    conditions.push(`(
      LOWER(c.course_code) = LOWER($${n - 2})
      OR LOWER(COALESCE(c.new_course_code, '')) = LOWER($${n - 1})
      OR c.title ILIKE $${n}
    )`);
  }

  if (conditions.length === 0) return [];

  const result = await db.query(`
    SELECT
      e.id AS enrollment_id,
      e.user_id AS learner_id,
      COALESCE(au.full_name, e.nric, 'Unknown') AS learner_name,
      COALESCE(au.email, e.email) AS learner_email,
      e.certificate AS certificate_url,
      e.assessment_status,
      e.enrolment_status,
      c.id AS course_id,
      COALESCE(NULLIF(c.new_course_code, ''), c.course_code) AS course_code,
      c.title AS course_title,
      cr.id AS course_run_uuid,
      cr.course_run_id,
      cr.class_status,
      CASE
        WHEN cr.start_date IS NULL AND cr.end_date IS NULL THEN ''
        WHEN cr.start_date IS NULL OR cr.end_date IS NULL OR cr.start_date = cr.end_date
          THEN TO_CHAR(COALESCE(cr.start_date, cr.end_date) AT TIME ZONE 'Asia/Singapore', 'DD Mon YYYY')
        ELSE TO_CHAR(cr.start_date AT TIME ZONE 'Asia/Singapore', 'DD Mon YYYY')
          || ' - ' || TO_CHAR(cr.end_date AT TIME ZONE 'Asia/Singapore', 'DD Mon YYYY')
      END AS course_dates
    FROM enrollment e
    LEFT JOIN app_user au ON au.id = e.user_id
    JOIN course c ON c.id = e.course_id
    JOIN course_run cr ON cr.id = e.course_run_id
    WHERE ${conditions.join(' AND ')}
    ORDER BY cr.end_date DESC NULLS LAST, e.created_at DESC
    LIMIT 10
  `, params);

  return result.rows.map((row) => {
    const candidate = buildCandidate(row);
    // If the caller supplied an email that matched either the account or the
    // enrollment record, honour that explicit delivery address.
    if (input.learnerEmail) candidate.learnerEmail = input.learnerEmail;
    return candidate;
  });
}

async function claimGeneration(target: CertificateCandidate, db: Pool): Promise<{ url: string; generated: boolean }> {
  if (target.certificateUrl) return { url: target.certificateUrl, generated: false };

  const claim = await db.query(
    `UPDATE enrollment
        SET certificate = $2, updated_at = now()
      WHERE id = $1
        AND (
          certificate IS NULL
          OR BTRIM(certificate) = ''
          OR (
            certificate = $2
            AND COALESCE(updated_at, to_timestamp(0)) <= now() - ($3::text || ' minutes')::interval
          )
        )
      RETURNING id`,
    [target.enrollmentId, GENERATING_MARKER, DELIVERY_CLAIM_TTL_MINUTES],
  );

  if (claim.rowCount === 0) {
    const current = await db.query(`SELECT certificate FROM enrollment WHERE id = $1`, [target.enrollmentId]);
    const value = String(current.rows[0]?.certificate || '').trim();
    if (value === GENERATING_MARKER) {
      throw new CertificateIssueError(
        'Certificate generation is already in progress for this enrollment.',
        'generation_in_progress',
        409,
      );
    }
    if (value) return { url: value, generated: false };
    throw new CertificateIssueError('Enrollment was not found.', 'not_found', 404);
  }

  try {
    const url = await generateAndUploadCertificate(target.enrollmentId, db, target.learnerName);
    return { url, generated: true };
  } catch (error) {
    await db.query(
      `UPDATE enrollment SET certificate = NULL, updated_at = now()
        WHERE id = $1 AND certificate = $2`,
      [target.enrollmentId, GENERATING_MARKER],
    ).catch(() => {});
    if (error instanceof CertificateIssueError) throw error;
    throw new CertificateIssueError(
      error instanceof Error ? error.message : 'Certificate generation failed.',
      'generation_failed',
      502,
    );
  }
}

function defaultDeliveryKey(enrollmentId: string, email: string): string {
  return crypto.createHash('sha256').update(`${enrollmentId}:${email.toLowerCase()}`).digest('hex');
}

async function claimDelivery(
  target: CertificateCandidate,
  certificateUrl: string,
  options: IssueOptions,
  db: Pool,
): Promise<DeliveryClaim> {
  const email = target.learnerEmail!;
  const key = options.resend
    ? `${defaultDeliveryKey(target.enrollmentId, email)}:${crypto.randomUUID()}`
    : defaultDeliveryKey(target.enrollmentId, email);

  const inserted = await db.query(
    `INSERT INTO certificate_delivery_log
       (delivery_key, enrollment_id, recipient_email, certificate_url, status,
        request_source, request_reason, claimed_at, updated_at)
     VALUES ($1, $2, $3, $4, 'sending', $5, $6, now(), now())
     ON CONFLICT (delivery_key) DO NOTHING
     RETURNING delivery_key`,
    [key, target.enrollmentId, email, certificateUrl, options.requestSource, options.requestReason || null],
  );
  if (inserted.rowCount) return { key, state: 'claimed' };

  const existing = await db.query(
    `SELECT status, gmail_message_id,
            updated_at > now() - ($2::text || ' minutes')::interval AS claim_is_fresh
       FROM certificate_delivery_log
      WHERE delivery_key = $1`,
    [key, DELIVERY_CLAIM_TTL_MINUTES],
  );
  const row = existing.rows[0];
  if (row?.status === 'sent') {
    return { key, state: 'already_sent', messageId: row.gmail_message_id || undefined };
  }
  if (row?.status === 'uncertain') return { key, state: 'uncertain' };
  if (row?.status === 'sending' && row.claim_is_fresh) return { key, state: 'in_progress' };

  const reclaimed = await db.query(
    `UPDATE certificate_delivery_log
        SET status = 'sending', certificate_url = $2, request_source = $3,
            request_reason = $4, error_message = NULL, claimed_at = now(),
            updated_at = now(), attempt_count = attempt_count + 1
      WHERE delivery_key = $1
        AND (status = 'failed' OR updated_at <= now() - ($5::text || ' minutes')::interval)
      RETURNING delivery_key`,
    [key, certificateUrl, options.requestSource, options.requestReason || null, DELIVERY_CLAIM_TTL_MINUTES],
  );
  return { key, state: reclaimed.rowCount ? 'claimed' : 'in_progress' };
}

function extractDriveFileId(url: string): string | null {
  return url.match(/\/file\/d\/([^/?]+)/)?.[1]
    || url.match(/[?&]id=([^&]+)/)?.[1]
    || null;
}

async function downloadCertificatePdf(certificateUrl: string, db: Pool): Promise<Buffer> {
  const fileId = extractDriveFileId(certificateUrl);
  if (!fileId) throw new Error('The issued certificate URL is not a supported Google Drive file URL.');
  const drive = await getGoogleDriveClient(db);
  const response = await drive.files.get(
    { fileId, alt: 'media' },
    { responseType: 'arraybuffer' },
  );
  return Buffer.from(response.data as ArrayBuffer);
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

async function sendIssuedCertificate(
  target: CertificateCandidate,
  certificateUrl: string,
  deliveryKey: string,
  db: Pool,
): Promise<{ ok: boolean; messageId?: string; error?: string; uncertain?: boolean; retryable?: boolean }> {
  const settings = await db.query(`
    SELECT certificate_email_subject, certificate_email_body, certificate_email_cc,
           support_email, company_email
      FROM training_provider
     ORDER BY created_at ASC NULLS LAST
     LIMIT 1
  `);
  if (!settings.rows.length) return { ok: false, error: 'Training provider settings were not found.' };

  const row = settings.rows[0];
  const tp = await getTrainingPartnerIdentifiers();
  const replacements: Record<string, string> = {
    '{STUDENT_NAME}': target.learnerName,
    '{COURSE_NAME}': target.courseTitle,
    '{COMPANY_NAME}': tp.name || 'Training Provider',
    '{COMPANY_SHORT_NAME}': tp.companyShortname || tp.name || 'Training Provider',
    '{COMPANY_WEBSITE}': tp.companyWebsite || '',
    '{CERTIFICATE_URL}': certificateUrl,
  };
  const replace = (text: string, html: boolean) => Object.entries(replacements).reduce(
    (value, [placeholder, replacement]) => value.split(placeholder).join(html ? escapeHtml(replacement) : replacement),
    text,
  );

  const subject = replace(row.certificate_email_subject || 'Certificate for Completing {COURSE_NAME}', false);
  const defaultBody = `Hello {STUDENT_NAME},\n\nCongratulations on successfully completing {COURSE_NAME}.\n\nYour Certificate of Achievement is attached. You can also download it here: {CERTIFICATE_URL}\n\nBest regards,\n{COMPANY_SHORT_NAME}`;
  const template = row.certificate_email_body || defaultBody;
  const isHtml = /<[a-z][\s\S]*>/i.test(template);
  const body = replace(template, isHtml);
  const html = isHtml
    ? body
    : `<div style="font-family:Arial,sans-serif;color:#333">${body.split('\n').map((line) => line ? `<p style="margin:0 0 8px">${escapeHtml(line)}</p>` : '<br>').join('')}</div>`;
  const pdf = await downloadCertificatePdf(certificateUrl, db);
  const safeName = target.learnerName.replace(/[^a-zA-Z0-9\s-]/g, '').trim().replace(/\s+/g, '-') || 'Learner';

  return sendViaGmailOAuth({
    to: target.learnerEmail!,
    cc: row.certificate_email_cc || undefined,
    replyTo: row.support_email || row.company_email || undefined,
    subject,
    html,
    avoidDuplicateRetry: true,
    messageId: `<certificate-${crypto.createHash('sha256').update(deliveryKey).digest('hex')}@lms.local>`,
    attachments: [{
      filename: `${safeName}-Certificate-of-Achievement.pdf`,
      contentType: 'application/pdf',
      content: pdf,
    }],
  });
}

function resultBase(target: CertificateCandidate, certificateUrl: string | null, generated: boolean) {
  return {
    enrollmentId: target.enrollmentId,
    learnerName: target.learnerName,
    learnerEmail: target.learnerEmail,
    courseCode: target.courseCode,
    courseTitle: target.courseTitle,
    courseRunId: target.courseRunId,
    courseRunUuid: target.courseRunUuid,
    certificateUrl,
    generated,
  };
}

export async function issueCertificate(
  options: IssueOptions,
  db: Pool = pool,
): Promise<CertificateIssueResult> {
  await ensureCertificateDeliveryTable(db);
  const candidates = await resolveCertificateCandidates(options, db);
  if (candidates.length === 0) {
    throw new CertificateIssueError('No matching enrollment was found.', 'not_found', 404);
  }
  if (candidates.length > 1) {
    throw new CertificateIssueError(
      'More than one enrollment matches. Provide course_run_id, course_code, course_title, or enrollment_id.',
      'ambiguous_enrollment',
      409,
      { candidates },
    );
  }

  const target = candidates[0];
  const decision = await checkCertificateIssuance(
    target.enrollmentId,
    { manual: options.eligibilityMode === 'manual' },
  );
  if (!decision.allowed) {
    throw new CertificateIssueError(
      decision.reason || 'Certificate issuance is not allowed.',
      decision.code || 'ineligible',
      409,
      decision,
    );
  }

  if (options.dryRun) {
    return {
      success: true,
      status: 'preview',
      ...resultBase(target, target.certificateUrl, false),
      emailed: false,
    };
  }

  const issued = await claimGeneration(target, db);
  if (!options.sendEmail) {
    return {
      success: true,
      status: issued.generated ? 'generated' : 'existing',
      ...resultBase(target, issued.url, issued.generated),
      emailed: false,
    };
  }
  if (!target.learnerEmail) {
    return {
      success: false,
      status: 'email_failed',
      ...resultBase(target, issued.url, issued.generated),
      emailed: false,
      error: 'The learner has no email address.',
    };
  }

  const delivery = await claimDelivery(target, issued.url, options, db);
  if (delivery.state === 'already_sent') {
    return {
      success: true,
      status: 'already_sent',
      ...resultBase(target, issued.url, issued.generated),
      emailed: true,
      gmailMessageId: delivery.messageId,
    };
  }
  if (delivery.state === 'in_progress') {
    throw new CertificateIssueError(
      'Certificate email delivery is already in progress.',
      'delivery_in_progress',
      409,
    );
  }
  if (delivery.state === 'uncertain') {
    throw new CertificateIssueError(
      'A previous Gmail delivery had an uncertain outcome. Check the learner mailbox before explicitly resending.',
      'delivery_uncertain',
      409,
    );
  }

  try {
    const sent = await sendIssuedCertificate(target, issued.url, delivery.key, db);
    if (!sent.ok && sent.uncertain) {
      const message = sent.error || 'Gmail delivery outcome is uncertain.';
      await db.query(
        `UPDATE certificate_delivery_log
            SET status = 'uncertain', error_message = $2, updated_at = now()
          WHERE delivery_key = $1`,
        [delivery.key, message],
      );
      return {
        success: false,
        status: 'email_failed',
        ...resultBase(target, issued.url, issued.generated),
        emailed: false,
        error: `${message} Check the learner mailbox before resending.`,
      };
    }
    if (!sent.ok) throw new Error(sent.error || 'Gmail did not accept the message.');
    await db.query(
      `UPDATE certificate_delivery_log
          SET status = 'sent', gmail_message_id = $2, sent_at = now(), updated_at = now()
        WHERE delivery_key = $1`,
      [delivery.key, sent.messageId || null],
    );
    return {
      success: true,
      status: 'sent',
      ...resultBase(target, issued.url, issued.generated),
      emailed: true,
      gmailMessageId: sent.messageId,
    };
  } catch (error: any) {
    const message = error?.message || String(error);
    await db.query(
      `UPDATE certificate_delivery_log
          SET status = 'failed', error_message = $2, updated_at = now()
        WHERE delivery_key = $1`,
      [delivery.key, message],
    ).catch(() => {});
    return {
      success: false,
      status: 'email_failed',
      ...resultBase(target, issued.url, issued.generated),
      emailed: false,
      error: message,
    };
  }
}

export function manualIssueOptions(reason: string): { eligibilityMode: CertificateEligibilityMode; requestReason: string } {
  return { eligibilityMode: 'manual', requestReason: reason };
}
