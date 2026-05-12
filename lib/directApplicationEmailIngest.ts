import pool from './db';
import { processDirectApplication } from './autoEnrolDirectApplications';
import { inferIdType } from './utils/id-type';

const PENDING_IDENTITY_ERROR = 'identity: Missing trainee ID/NRIC for SSG enrolment';
const TERMINAL_AUTO_ENROL_STATUSES = new Set(['enroled', 'grant_found', 'invoiced']);

export interface DirectApplicationEmailPayload {
  source?: string | null;
  sourceMessageId?: string | null;
  sourceThreadId?: string | null;
  subject?: string | null;
  receivedAt?: string | null;
  applicationId?: string | null;
  applicationStatus?: string | null;
  courseReferenceNumber?: string | null;
  courseTitle?: string | null;
  courseRunId?: string | null;
  courseStartDate?: string | null;
  courseEndDate?: string | null;
  traineeName?: string | null;
  traineeEmail?: string | null;
  traineePhoneCountryCode?: string | null;
  traineePhone?: string | null;
  payableFee?: number | string | null;
  skillsfutureCredit?: number | string | null;
  skillsfutureCreditClaimId?: string | null;
  traineeId?: string | null;
  traineeIdType?: string | null;
  dateOfBirth?: string | null;
  rawText?: string | null;
}

type IdentityResolution =
  | {
      status: 'resolved';
      traineeId: string;
      traineeIdType?: string | null;
      dateOfBirth?: string | null;
      source: string;
    }
  | {
      status: 'missing';
      source: 'none';
    }
  | {
      status: 'ambiguous';
      source: string;
      candidates: number;
    };

interface NormalizedDirectApplicationEmailPayload {
  source: string | null;
  sourceMessageId: string | null;
  sourceThreadId: string | null;
  subject: string | null;
  receivedAt: string | null;
  applicationId: string;
  applicationStatus: string;
  courseReferenceNumber: string;
  courseTitle: string | null;
  courseRunId: string;
  courseStartDate: string;
  courseEndDate: string;
  traineeName: string;
  traineeEmail: string;
  traineePhoneCountryCode: string;
  traineePhone: string | null;
  payableFee: number | null;
  skillsfutureCredit: number | null;
  skillsfutureCreditClaimId: string | null;
  traineeId: string | null;
  traineeIdType: string | null;
  dateOfBirth: string | null;
  rawText: string | null;
}

export class DirectApplicationEmailIngestError extends Error {
  statusCode: number;
  code: string;
  retryable: boolean;

  constructor(statusCode: number, code: string, message: string, retryable: boolean) {
    super(message);
    this.name = 'DirectApplicationEmailIngestError';
    this.statusCode = statusCode;
    this.code = code;
    this.retryable = retryable;
  }
}

export async function ingestDirectApplicationEmail(payload: DirectApplicationEmailPayload) {
  const normalized = normalizeAndValidatePayload(payload);

  const settings = await pool.query(
    `SELECT COALESCE(auto_import_da_from_email, false) AS auto_import_da_from_email
       FROM training_provider
      LIMIT 1`
  );

  if (!settings.rows[0]?.auto_import_da_from_email) {
    throw new DirectApplicationEmailIngestError(
      403,
      'DISABLED',
      'Direct Application email import is disabled in Company Settings.',
      true
    );
  }

  const existing = await getExistingDaApplication(normalized.applicationId);
  if (existing && isCancelledRow(existing)) {
    await logIngest({
      payload: normalized,
      status: 'duplicate_conflict_cancelled',
      identityStatus: null,
      autoEnrolStatus: existing.auto_enrol_status || null,
      errorMessage: 'Existing Direct Application row is cancelled; email ingest did not reactivate it.',
    });

    return {
      success: true,
      code: 'CANCELLED_CONFLICT',
      applicationId: normalized.applicationId,
      applicationDbId: existing.id,
      action: 'duplicate_noop',
      identityStatus: 'missing',
      autoEnrolStatus: existing.auto_enrol_status || null,
      message: 'Existing Direct Application row is cancelled; email ingest did not reactivate it.',
    };
  }

  const identity = await resolveIdentity(normalized);
  const rowForUpsert = {
    ...normalized,
    traineeId: identity.status === 'resolved' ? identity.traineeId : normalized.traineeId,
    traineeIdType: identity.status === 'resolved'
      ? (identity.traineeIdType || inferIdType(identity.traineeId, normalized.traineeIdType || undefined))
      : normalized.traineeIdType,
    dateOfBirth: identity.status === 'resolved'
      ? (identity.dateOfBirth || normalized.dateOfBirth)
      : normalized.dateOfBirth,
  };

  const { row, action } = await upsertDaApplication(rowForUpsert, identity);

  if (shouldSkipEmailTriggeredAutomation(row)) {
    await logIngest({
      payload: normalized,
      status: action === 'inserted' ? 'imported_already_processed' : 'duplicate_already_processed',
      identityStatus: identity.status,
      autoEnrolStatus: row.auto_enrol_status || null,
      errorMessage: null,
    });

    return {
      success: true,
      code: 'DUPLICATE_ALREADY_PROCESSED',
      applicationId: normalized.applicationId,
      applicationDbId: row.id,
      action: 'duplicate_noop',
      identityStatus: identity.status,
      autoEnrolStatus: row.auto_enrol_status || null,
      message: 'Application already processed; email ingest did not re-run automation.',
    };
  }

  if (!hasIdentifier(row.trainee_id)) {
    await markPendingIdentity(row.id);
    await logIngest({
      payload: normalized,
      status: action === 'inserted' ? 'imported_pending_identity' : 'duplicate_pending_identity',
      identityStatus: identity.status,
      autoEnrolStatus: 'pending_identity',
      errorMessage: PENDING_IDENTITY_ERROR,
    });

    return {
      success: true,
      code: 'PENDING_IDENTITY',
      applicationId: normalized.applicationId,
      applicationDbId: row.id,
      action,
      identityStatus: identity.status,
      autoEnrolStatus: 'pending_identity',
      message: 'Imported and held for identity review.',
    };
  }

  await pool.query(
    `UPDATE da_application
        SET auto_enrol_status = 'pending',
            auto_enrol_error = NULL,
            updated_at = NOW()
      WHERE id = $1
        AND (auto_enrol_status IS NULL OR auto_enrol_status IN ('failed', 'pending_identity', 'pending'))`,
    [row.id]
  );

  const automationOptions = action === 'inserted'
    ? { sendInvoiceEmail: true }
    : { suppressInvoiceEmail: true };

  setImmediate(() => {
    processDirectApplication(row.id, undefined, automationOptions).catch(async (err) => {
      console.error('[direct-application-email] Background auto-enrol failed:', err);
      await logIngest({
        payload: normalized,
        status: 'failed_server',
        identityStatus: identity.status,
        autoEnrolStatus: 'failed',
        errorMessage: err instanceof Error ? err.message : String(err),
      });
    });
  });

  await logIngest({
    payload: normalized,
    status: action === 'inserted' ? 'imported_queued' : 'duplicate_queued',
    identityStatus: identity.status,
    autoEnrolStatus: 'pending',
    errorMessage: null,
  });

  return {
    success: true,
    code: 'QUEUED',
    applicationId: normalized.applicationId,
    applicationDbId: row.id,
    action,
    identityStatus: identity.status,
    autoEnrolStatus: 'pending',
    message: 'Imported and queued for DA automation.',
  };
}

function normalizeAndValidatePayload(payload: DirectApplicationEmailPayload): NormalizedDirectApplicationEmailPayload {
  const normalized = {
    source: clean(payload.source),
    sourceMessageId: clean(payload.sourceMessageId),
    sourceThreadId: clean(payload.sourceThreadId),
    subject: clean(payload.subject),
    receivedAt: normalizeIsoDateTime(payload.receivedAt),
    applicationId: clean(payload.applicationId) || '',
    applicationStatus: clean(payload.applicationStatus) || 'Confirmed',
    courseReferenceNumber: clean(payload.courseReferenceNumber) || '',
    courseTitle: clean(payload.courseTitle),
    courseRunId: clean(payload.courseRunId) || '',
    courseStartDate: normalizeDate(payload.courseStartDate) || '',
    courseEndDate: normalizeDate(payload.courseEndDate) || '',
    traineeName: clean(payload.traineeName) || '',
    traineeEmail: normalizeEmail(payload.traineeEmail),
    traineePhoneCountryCode: clean(payload.traineePhoneCountryCode) || '65',
    traineePhone: normalizePhone(payload.traineePhone),
    payableFee: normalizeMoney(payload.payableFee),
    skillsfutureCredit: normalizeMoney(payload.skillsfutureCredit),
    skillsfutureCreditClaimId: clean(payload.skillsfutureCreditClaimId),
    traineeId: clean(payload.traineeId),
    traineeIdType: clean(payload.traineeIdType),
    dateOfBirth: normalizeDate(payload.dateOfBirth),
    rawText: clean(payload.rawText),
  };

  const missing = [
    !normalized.applicationId && 'applicationId',
    !normalized.courseReferenceNumber && 'courseReferenceNumber',
    !normalized.courseRunId && 'courseRunId',
    !normalized.courseStartDate && 'courseStartDate',
    !normalized.courseEndDate && 'courseEndDate',
    !normalized.traineeName && 'traineeName',
    !normalized.traineeEmail && 'traineeEmail',
  ].filter(Boolean);

  if (missing.length > 0) {
    throw new DirectApplicationEmailIngestError(
      400,
      'VALIDATION_ERROR',
      `Missing required field(s): ${missing.join(', ')}`,
      false
    );
  }

  const validationErrors = [
    !/^CA-\d{4}-\d{6}$/i.test(normalized.applicationId) && 'applicationId must look like CA-2605-000472',
    !/^TGS-/i.test(normalized.courseReferenceNumber) && 'courseReferenceNumber must start with TGS-',
    !/^\d+$/.test(normalized.courseRunId) && 'courseRunId must be numeric',
    !/^\d{4}-\d{2}-\d{2}$/.test(normalized.courseStartDate) && 'courseStartDate must be YYYY-MM-DD',
    !/^\d{4}-\d{2}-\d{2}$/.test(normalized.courseEndDate) && 'courseEndDate must be YYYY-MM-DD',
    !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(normalized.traineeEmail) && 'traineeEmail must be valid',
  ].filter(Boolean);

  if (validationErrors.length > 0) {
    throw new DirectApplicationEmailIngestError(
      400,
      'VALIDATION_ERROR',
      validationErrors.join('; '),
      false
    );
  }

  return normalized;
}

async function resolveIdentity(payload: NormalizedDirectApplicationEmailPayload): Promise<IdentityResolution> {
  if (hasIdentifier(payload.traineeId)) {
    return {
      status: 'resolved',
      traineeId: payload.traineeId,
      traineeIdType: payload.traineeIdType || inferIdType(payload.traineeId, undefined),
      dateOfBirth: payload.dateOfBirth,
      source: 'payload',
    };
  }

  const email = payload.traineeEmail;
  const phone = payload.traineePhone;

  const emailResult = await pool.query(
    `SELECT lp.nric AS trainee_id, lp.dob::text AS date_of_birth
       FROM app_user au
       INNER JOIN learner_profile lp ON lp.user_id = au.id
      WHERE (LOWER(TRIM(au.email::text)) = LOWER(TRIM($1::text))
          OR LOWER(TRIM(COALESCE(au.secondary_email::text, ''))) = LOWER(TRIM($1::text))
          OR LOWER(TRIM($1::text)) = ANY(
              SELECT LOWER(TRIM(x)) FROM unnest(COALESCE(au.additional_emails, ARRAY[]::text[])) AS x
          ))
        AND NULLIF(TRIM(COALESCE(lp.nric, '')), '') IS NOT NULL
      ORDER BY au.updated_at DESC NULLS LAST
      LIMIT 2`,
    [email]
  );
  const byEmail = uniqueIdentityCandidates(emailResult.rows);
  if (byEmail.length === 1) return resolvedFromCandidate(byEmail[0], 'learner_profile_email');
  if (byEmail.length > 1) return { status: 'ambiguous', source: 'learner_profile_email', candidates: byEmail.length };

  if (phone) {
    const phoneResult = await pool.query(
      `SELECT lp.nric AS trainee_id, lp.dob::text AS date_of_birth
         FROM learner_profile lp
        WHERE regexp_replace(COALESCE(lp.tel, ''), '[^0-9]', '', 'g') = $1
          AND NULLIF(TRIM(COALESCE(lp.nric, '')), '') IS NOT NULL
        LIMIT 2`,
      [phone]
    );
    const byPhone = uniqueIdentityCandidates(phoneResult.rows);
    if (byPhone.length === 1) return resolvedFromCandidate(byPhone[0], 'learner_profile_phone');
    if (byPhone.length > 1) return { status: 'ambiguous', source: 'learner_profile_phone', candidates: byPhone.length };
  }

  const daEmailResult = await pool.query(
    `SELECT trainee_id, trainee_id_type, date_of_birth::text AS date_of_birth
       FROM da_application
      WHERE LOWER(TRIM(trainee_email::text)) = LOWER(TRIM($1::text))
        AND NULLIF(TRIM(COALESCE(trainee_id, '')), '') IS NOT NULL
      ORDER BY updated_at DESC NULLS LAST
      LIMIT 2`,
    [email]
  );
  const byDaEmail = uniqueIdentityCandidates(daEmailResult.rows);
  if (byDaEmail.length === 1) return resolvedFromCandidate(byDaEmail[0], 'da_application_email');
  if (byDaEmail.length > 1) return { status: 'ambiguous', source: 'da_application_email', candidates: byDaEmail.length };

  if (phone) {
    const daPhoneResult = await pool.query(
      `SELECT trainee_id, trainee_id_type, date_of_birth::text AS date_of_birth
         FROM da_application
        WHERE regexp_replace(COALESCE(trainee_phone, ''), '[^0-9]', '', 'g') = $1
          AND NULLIF(TRIM(COALESCE(trainee_id, '')), '') IS NOT NULL
        ORDER BY updated_at DESC NULLS LAST
        LIMIT 2`,
      [phone]
    );
    const byDaPhone = uniqueIdentityCandidates(daPhoneResult.rows);
    if (byDaPhone.length === 1) return resolvedFromCandidate(byDaPhone[0], 'da_application_phone');
    if (byDaPhone.length > 1) return { status: 'ambiguous', source: 'da_application_phone', candidates: byDaPhone.length };
  }

  const enrolmentEmailResult = await pool.query(
    `SELECT e.nric AS trainee_id
       FROM enrollment e
       INNER JOIN app_user au ON au.id = e.user_id
      WHERE (LOWER(TRIM(COALESCE(e.email, ''))) = LOWER(TRIM($1::text))
          OR LOWER(TRIM(au.email::text)) = LOWER(TRIM($1::text))
          OR LOWER(TRIM(COALESCE(au.secondary_email::text, ''))) = LOWER(TRIM($1::text)))
        AND NULLIF(TRIM(COALESCE(e.nric, '')), '') IS NOT NULL
      ORDER BY e.updated_at DESC NULLS LAST
      LIMIT 2`,
    [email]
  );
  const byEnrolment = uniqueIdentityCandidates(enrolmentEmailResult.rows);
  if (byEnrolment.length === 1) return resolvedFromCandidate(byEnrolment[0], 'enrollment_email');
  if (byEnrolment.length > 1) return { status: 'ambiguous', source: 'enrollment_email', candidates: byEnrolment.length };

  const ssgRecordResult = await pool.query(
    `SELECT learner_nric AS trainee_id
       FROM ssg_enrolment_record
      WHERE LOWER(TRIM(COALESCE(learner_email, ''))) = LOWER(TRIM($1::text))
        AND NULLIF(TRIM(COALESCE(learner_nric, '')), '') IS NOT NULL
      ORDER BY updated_at DESC NULLS LAST
      LIMIT 2`,
    [email]
  );
  const bySsgRecord = uniqueIdentityCandidates(ssgRecordResult.rows);
  if (bySsgRecord.length === 1) return resolvedFromCandidate(bySsgRecord[0], 'ssg_enrolment_record_email');
  if (bySsgRecord.length > 1) return { status: 'ambiguous', source: 'ssg_enrolment_record_email', candidates: bySsgRecord.length };

  return { status: 'missing', source: 'none' };
}

async function upsertDaApplication(
  payload: NormalizedDirectApplicationEmailPayload,
  identity: IdentityResolution
): Promise<{ row: any; action: 'inserted' | 'updated' }> {
  const result = await pool.query(
    `INSERT INTO da_application (
       trainee_id_type,
       trainee_id,
       date_of_birth,
       trainee_name,
       course_run_id,
       trainee_email,
       trainee_phone_country_code,
       trainee_phone,
       sponsorship_type,
       application_id,
       application_date,
       payable_fee,
       skillsfuture_credit,
       skillsfuture_credit_claim_id,
       application_status,
       course_title,
       course_reference_number,
       course_start_date,
       course_end_date,
       auto_enrol_status,
       auto_enrol_error
     ) VALUES (
       $1, $2, $3, $4, $5, $6, $7, $8, 'INDIVIDUAL', $9, COALESCE($10::date, CURRENT_DATE),
       $11, $12, $13, $14, $15, $16, $17, $18,
       $19, $20
     )
     ON CONFLICT (application_id)
     DO UPDATE SET
       trainee_id_type = COALESCE(EXCLUDED.trainee_id_type, da_application.trainee_id_type),
       trainee_id = COALESCE(EXCLUDED.trainee_id, da_application.trainee_id),
       date_of_birth = COALESCE(EXCLUDED.date_of_birth, da_application.date_of_birth),
       trainee_name = COALESCE(EXCLUDED.trainee_name, da_application.trainee_name),
       course_run_id = COALESCE(EXCLUDED.course_run_id, da_application.course_run_id),
       trainee_email = COALESCE(EXCLUDED.trainee_email, da_application.trainee_email),
       trainee_phone_country_code = COALESCE(EXCLUDED.trainee_phone_country_code, da_application.trainee_phone_country_code),
       trainee_phone = COALESCE(EXCLUDED.trainee_phone, da_application.trainee_phone),
       sponsorship_type = COALESCE(EXCLUDED.sponsorship_type, da_application.sponsorship_type),
       payable_fee = COALESCE(EXCLUDED.payable_fee, da_application.payable_fee),
       skillsfuture_credit = COALESCE(EXCLUDED.skillsfuture_credit, da_application.skillsfuture_credit),
       skillsfuture_credit_claim_id = COALESCE(EXCLUDED.skillsfuture_credit_claim_id, da_application.skillsfuture_credit_claim_id),
       application_status = CASE
         WHEN LOWER(COALESCE(da_application.application_status, '')) = 'cancelled' THEN da_application.application_status
         ELSE COALESCE(EXCLUDED.application_status, da_application.application_status)
       END,
       course_title = COALESCE(EXCLUDED.course_title, da_application.course_title),
       course_reference_number = COALESCE(EXCLUDED.course_reference_number, da_application.course_reference_number),
       course_start_date = COALESCE(EXCLUDED.course_start_date, da_application.course_start_date),
       course_end_date = COALESCE(EXCLUDED.course_end_date, da_application.course_end_date),
       auto_enrol_status = CASE
         WHEN da_application.auto_enrol_status IN ('enroled', 'grant_found', 'invoiced') THEN da_application.auto_enrol_status
         WHEN COALESCE(NULLIF(TRIM(da_application.trainee_id), ''), NULLIF(TRIM(EXCLUDED.trainee_id), '')) IS NULL THEN 'pending_identity'
         ELSE COALESCE(da_application.auto_enrol_status, EXCLUDED.auto_enrol_status)
       END,
       auto_enrol_error = CASE
         WHEN da_application.auto_enrol_status IN ('enroled', 'grant_found', 'invoiced') THEN da_application.auto_enrol_error
         WHEN COALESCE(NULLIF(TRIM(da_application.trainee_id), ''), NULLIF(TRIM(EXCLUDED.trainee_id), '')) IS NULL THEN $20
         ELSE da_application.auto_enrol_error
       END,
       updated_at = NOW()
     RETURNING *, (xmax = 0) AS inserted`,
    [
      payload.traineeIdType || (payload.traineeId ? inferIdType(payload.traineeId, undefined) : null),
      payload.traineeId,
      payload.dateOfBirth,
      payload.traineeName,
      payload.courseRunId,
      payload.traineeEmail,
      payload.traineePhoneCountryCode || '65',
      payload.traineePhone,
      payload.applicationId,
      payload.receivedAt ? payload.receivedAt.slice(0, 10) : null,
      payload.payableFee,
      payload.skillsfutureCredit,
      payload.skillsfutureCreditClaimId,
      payload.applicationStatus || 'Confirmed',
      payload.courseTitle,
      payload.courseReferenceNumber,
      payload.courseStartDate,
      payload.courseEndDate,
      identity.status === 'resolved' ? 'pending' : 'pending_identity',
      identity.status === 'resolved' ? null : PENDING_IDENTITY_ERROR,
    ]
  );

  const row = result.rows[0];
  return { row, action: row.inserted ? 'inserted' : 'updated' };
}

async function getExistingDaApplication(applicationId: string): Promise<any | null> {
  const result = await pool.query(`SELECT * FROM da_application WHERE application_id = $1 LIMIT 1`, [applicationId]);
  return result.rows[0] || null;
}

async function markPendingIdentity(id: string): Promise<void> {
  await pool.query(
    `UPDATE da_application
        SET auto_enrol_status = 'pending_identity',
            auto_enrol_error = $2,
            updated_at = NOW()
      WHERE id = $1
        AND (enrolment_id IS NULL OR enrolment_id = '' OR UPPER(enrolment_id) = 'MANUAL')`,
    [id, PENDING_IDENTITY_ERROR]
  );
}

function shouldSkipEmailTriggeredAutomation(row: any): boolean {
  return (
    TERMINAL_AUTO_ENROL_STATUSES.has(String(row.auto_enrol_status || '').toLowerCase()) ||
    isRealSsgEnrolmentId(row.enrolment_id) ||
    hasRealInvoiceId(row.invoice_id)
  );
}

function isCancelledRow(row: any): boolean {
  return (
    String(row.application_status || '').trim().toLowerCase() === 'cancelled' ||
    String(row.enrolment_status || '').trim().toLowerCase() === 'cancelled'
  );
}

function hasIdentifier(value: unknown): value is string {
  return typeof value === 'string' && value.trim() !== '';
}

function isRealSsgEnrolmentId(value: unknown): boolean {
  return /^ENR-/i.test(String(value || '').trim());
}

function hasRealInvoiceId(value: unknown): boolean {
  const invoiceId = String(value || '').trim().toUpperCase();
  return !!invoiceId && !['MANUAL', 'N/A', 'NA', '-'].includes(invoiceId);
}

function clean(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  const text = String(value).trim();
  return text === '' ? null : text;
}

function normalizeEmail(value: unknown): string {
  return String(value || '').trim().toLowerCase();
}

function normalizePhone(value: unknown): string | null {
  const digits = String(value || '').replace(/\D/g, '');
  if (!digits) return null;
  if (digits.startsWith('65') && digits.length > 8) return digits.slice(2);
  return digits;
}

function normalizeMoney(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null;
  const parsed = typeof value === 'number'
    ? value
    : Number(String(value).replace(/[^0-9.-]/g, ''));
  return Number.isFinite(parsed) ? parsed : null;
}

function normalizeDate(value: unknown): string | null {
  const text = clean(value);
  if (!text) return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(text)) return text;
  const date = new Date(text);
  if (Number.isNaN(date.getTime())) return null;
  return date.toISOString().slice(0, 10);
}

function normalizeIsoDateTime(value: unknown): string | null {
  const text = clean(value);
  if (!text) return null;
  const date = new Date(text);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function uniqueIdentityCandidates(rows: any[]): any[] {
  const seen = new Set<string>();
  const candidates: any[] = [];
  for (const row of rows) {
    const traineeId = String(row.trainee_id || '').trim();
    if (!traineeId || seen.has(traineeId.toUpperCase())) continue;
    seen.add(traineeId.toUpperCase());
    candidates.push(row);
  }
  return candidates;
}

function resolvedFromCandidate(candidate: any, source: string): IdentityResolution {
  const traineeId = String(candidate.trainee_id || '').trim();
  return {
    status: 'resolved',
    traineeId,
    traineeIdType: clean(candidate.trainee_id_type) || inferIdType(traineeId, undefined),
    dateOfBirth: normalizeDate(candidate.date_of_birth),
    source,
  };
}

async function logIngest(fields: {
  payload: NormalizedDirectApplicationEmailPayload;
  status: string;
  identityStatus: string | null;
  autoEnrolStatus: string | null;
  errorMessage: string | null;
}): Promise<void> {
  try {
    await pool.query(
      `INSERT INTO direct_application_email_ingest_log (
         application_id,
         source_message_id,
         source_thread_id,
         subject,
         status,
         identity_status,
         auto_enrol_status,
         error_message,
         payload
       ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb)`,
      [
        fields.payload.applicationId,
        fields.payload.sourceMessageId,
        fields.payload.sourceThreadId,
        fields.payload.subject,
        fields.status,
        fields.identityStatus,
        fields.autoEnrolStatus,
        fields.errorMessage,
        JSON.stringify(fields.payload),
      ]
    );
  } catch (err) {
    console.warn('[direct-application-email] Failed to write ingest log:', err instanceof Error ? err.message : err);
  }
}
