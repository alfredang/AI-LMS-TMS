import crypto from 'crypto';
import pool from './db';
import { extractCourseReferenceNumber } from './courseTitleMatch';
import { ensureCompanyApplicationsTable, appendPipelineWarning } from './companyApplicationsTable';
import { buildEnrolmentPayload } from './ssg/buildEnrolmentPayload';
import { getSSGCredentialsService } from './ssg/services/credentials-service';
import { searchEnrolment } from './ssg/services/enrolment-service';
import { HttpClient, HTTPRequestBuilder, HttpMethod } from './ssg/utils/http-utils';
import { refreshGrantsForEnrolments } from './services/billingSync';
import { getTrainingPartnerIdentifiers } from './trainingPartnerIdentifiers';
import { RUN_COURSE_CODE_SQL } from './courseCode';
import { addCaLearnerToCalendar } from './google-calendar/ca-calendar-sync';

function isRealSsgEnrolmentId(value: unknown): value is string {
  return /^ENR-/i.test(String(value || '').trim());
}

type AutoEnrolStatus = 'pending' | 'enroled' | 'grant_found' | 'invoiced' | 'failed';

interface SsgCredentialLike {
  encryptionKey: string;
  certificateContent?: string | null;
  privateKeyContent?: string | null;
  ssgApiBaseUrl?: string | null;
  uen?: string | null;
  certificatePath?: string | null;
  privateKeyPath?: string | null;
}

interface SSGContext {
  encKey: Buffer;
  ssgBaseUrl: string;
  httpClient: HttpClient;
  credentials: SsgCredentialLike;
  uen: string;
  tpCode: string;
}

interface ResolvedRun {
  courseRunUuid: string;
  courseRunId: string;
  courseReferenceNumber: string;
  courseTitle: string;
  startDate: string | null;
  courseFee: number | null;
}

const IV = Buffer.from('SSGAPIInitVector', 'utf8');
const BATCH_SIZE = 1;
const MAX_SSG_RETRY_ATTEMPTS = 4;
const SSG_RETRY_BASE_DELAY_MS = 2000;

// Treat SSG 5xx, underlying network errors, and generic "try again later"
// response bodies as transient so a single SSG blip doesn't park a row at
// auto_enrol_status='failed' until a manual re-upload. Specific SSG 400s
// (validation, duplicate) are still handled by processCompanyApplication.
function isTransientSsgError(err: unknown): boolean {
  const message = err instanceof Error ? err.message : String(err);
  if (/ETIMEDOUT|ECONNRESET|ECONNREFUSED|EAI_AGAIN|socket hang up|network error/i.test(message)) {
    return true;
  }
  const statusMatch = message.match(/returned (\d{3})/);
  if (statusMatch) {
    const status = Number(statusMatch[1]);
    return status >= 500 && status < 600;
  }
  return false;
}

function isTransientSsgMessage(message: string): boolean {
  return /unable to process|try again later|temporarily unavailable|service unavailable|timeout|timed out|too many requests|rate limit/i.test(message);
}

function normalizeDate(value: unknown): string | null {
  const raw = String(value || '').trim();
  if (!raw) return null;

  const dmy = raw.match(/^(\d{1,2})[-/](\d{1,2})[-/](\d{4})$/);
  if (dmy) {
    const [, dd, mm, yyyy] = dmy;
    return `${yyyy}-${mm.padStart(2, '0')}-${dd.padStart(2, '0')}`;
  }

  const ymd = raw.match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})/);
  if (ymd) {
    const [, yyyy, mm, dd] = ymd;
    return `${yyyy}-${mm.padStart(2, '0')}-${dd.padStart(2, '0')}`;
  }

  // Textual month with optional day range and trailing weekday tag, e.g.
  // "18/22 May 2026 (Mon/Fri)", "18-22 May 2026", "1 May 2026", "18 May 2026 (Mon)".
  // Take the first day in the range as the start date.
  const textual = raw.match(/^(\d{1,2})(?:\s*[\/\-,]\s*\d{1,2})?\s+([A-Za-z]+)\s+(\d{4})/);
  if (textual) {
    const [, dd, monthName, yyyy] = textual;
    const parsedTextual = new Date(`${dd} ${monthName} ${yyyy} UTC`);
    if (!Number.isNaN(parsedTextual.getTime())) {
      const mm = String(parsedTextual.getUTCMonth() + 1).padStart(2, '0');
      return `${yyyy}-${mm}-${dd.padStart(2, '0')}`;
    }
  }

  const parsed = new Date(raw);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString().slice(0, 10);
}

function normalizeTitle(value: unknown): string {
  return String(value || '')
    .replace(/\b(WSQ|VIRTUAL|EXTERNAL|HYBRID)\b/gi, ' ')
    .replace(/[^a-z0-9]+/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

// Word-order-insensitive key: "A class" and "class A" produce the same key.
function titleTokenKey(value: unknown): string {
  return normalizeTitle(value).split(' ').filter(Boolean).sort().join(' ');
}

function extractEnrolmentReference(parsed: any): string | null {
  return (
    parsed?.data?.enrolment?.referenceNumber ||
    parsed?.enrolment?.referenceNumber ||
    parsed?.data?.referenceNumber ||
    parsed?.referenceNumber ||
    null
  );
}

function hasSsgError(parsed: any): string | null {
  const err = parsed?.error;
  if (!err) return null;
  if (err.code || err.message || (err.details && err.details.length > 0)) {
    return err.details?.[0]?.message || err.message || err.code || 'SSG error';
  }
  return null;
}

async function updateCompanyRow(
  id: string,
  fields: Record<string, string | number | boolean | null>
): Promise<void> {
  const keys = Object.keys(fields);
  if (!keys.length) return;

  const setClause = keys.map((key, index) => `${key} = $${index + 2}`).join(', ');
  await pool.query(
    `UPDATE public.company_application SET ${setClause}, updated_at = now() WHERE id = $1`,
    [id, ...keys.map(key => fields[key])]
  );
}

async function markFailed(id: string, step: string, err: unknown): Promise<void> {
  const message = err instanceof Error ? err.message : String(err);
  await updateCompanyRow(id, {
    auto_enrol_status: 'failed',
    auto_enrol_error: `${step}: ${message}`,
  });
}

async function loadSsgContext(): Promise<SSGContext> {
  const credentials = await getSSGCredentialsService().getSSGCredentials();

  if (!credentials) {
    throw new Error('SSG credentials not configured');
  }

  console.log('🔐 SSG credential debug:', {
    certificatePath: credentials.certificatePath,
    privateKeyPath: credentials.privateKeyPath,
    hasCertificateContent: !!credentials.certificateContent,
    hasPrivateKeyContent: !!credentials.privateKeyContent,
    hasEncryptionKey: !!credentials.encryptionKey,
    uen: credentials.uen,
    baseUrl: credentials.ssgApiBaseUrl,
  });

  if (!credentials.certificateContent || !credentials.privateKeyContent) {
    throw new Error(
      `SSG certificate/private key missing for auto-enrol. ` +
      `Check training_provider SSG credential files: cert=${credentials.certificatePath || '-'}, key=${credentials.privateKeyPath || '-'}`
    );
  }

  const tp = await getTrainingPartnerIdentifiers();
  const ssgBaseUrl = credentials.ssgApiBaseUrl || process.env.SSG_API_URL || 'https://api.ssg-wsg.sg';
  const httpClient = new HttpClient(ssgBaseUrl, {
    'Content-Type': 'application/json',
    Accept: 'application/json',
  });

  return {
    encKey: Buffer.from(credentials.encryptionKey, 'base64'),
    ssgBaseUrl,
    httpClient,
    credentials,
    uen: credentials.uen || tp.uen,
    tpCode: tp.code,
  };
}

async function ssgEncryptedPost(ctx: SSGContext, path: string, payload: unknown, timeoutMs?: number): Promise<any> {
  let lastErr: unknown;
  for (let attempt = 1; attempt <= MAX_SSG_RETRY_ATTEMPTS; attempt++) {
    try {
      const parsed = await ssgEncryptedPostOnce(ctx, path, payload, timeoutMs);
      const errMsg = hasSsgError(parsed);
      if (errMsg && isTransientSsgMessage(errMsg) && attempt < MAX_SSG_RETRY_ATTEMPTS) {
        const delayMs = SSG_RETRY_BASE_DELAY_MS * Math.pow(2, attempt - 1);
        console.warn(
          `[CA SSG] transient ${path} response attempt ${attempt}/${MAX_SSG_RETRY_ATTEMPTS}, retrying in ${delayMs}ms:`,
          errMsg
        );
        await new Promise(resolve => setTimeout(resolve, delayMs));
        continue;
      }
      return parsed;
    } catch (err) {
      lastErr = err;
      if (attempt === MAX_SSG_RETRY_ATTEMPTS || !isTransientSsgError(err)) throw err;
      const delayMs = SSG_RETRY_BASE_DELAY_MS * Math.pow(2, attempt - 1);
      console.warn(
        `[CA SSG] transient ${path} failure attempt ${attempt}/${MAX_SSG_RETRY_ATTEMPTS}, retrying in ${delayMs}ms:`,
        err instanceof Error ? err.message : err
      );
      await new Promise(resolve => setTimeout(resolve, delayMs));
    }
  }
  throw lastErr;
}

async function ssgEncryptedPostOnce(ctx: SSGContext, path: string, payload: unknown, timeoutMs?: number): Promise<any> {
  const cipher = crypto.createCipheriv('aes-256-cbc', ctx.encKey, IV);
  let encrypted = cipher.update(JSON.stringify(payload), 'utf8', 'base64');
  encrypted += cipher.final('base64');

  const builder = new HTTPRequestBuilder()
    .withEndpoint(ctx.ssgBaseUrl, path)
    .withMethod(HttpMethod.POST)
    .withBody(encrypted);

  // Override the default 30s cap for slow endpoints (e.g. create-enrolment).
  if (timeoutMs) builder.withTimeout(timeoutMs);

  if (ctx.credentials.certificateContent && ctx.credentials.privateKeyContent) {
    builder.withCertificate(ctx.credentials.certificateContent, ctx.credentials.privateKeyContent);
  }

  const httpResponse = await ctx.httpClient.request(builder.build());
  const isError = httpResponse.status !== 200 && httpResponse.status !== 201 && httpResponse.status !== 400;
  if (isError) throw new Error(`SSG ${path} returned ${httpResponse.status}`);

  const rawBody = httpResponse.data
    ? typeof httpResponse.data === 'string'
      ? httpResponse.data
      : JSON.stringify(httpResponse.data)
    : '';

  if (!rawBody.trim()) {
    if (httpResponse.status === 400) throw new Error(`SSG ${path} returned 400 with empty body`);
    return {};
  }

  let toDecrypt = rawBody;
  if (rawBody.startsWith('{')) {
    try {
      const parsed = JSON.parse(rawBody);
      if (parsed.error && typeof parsed.error === 'string') toDecrypt = parsed.error;
    } catch {
      // Keep raw body.
    }
  }

  const decipher = crypto.createDecipheriv('aes-256-cbc', ctx.encKey, IV);
  let decrypted = decipher.update(toDecrypt, 'base64', 'utf8');
  decrypted += decipher.final('utf8');
  return JSON.parse(decrypted);
}

/**
 * Refuse to pick between equally-good course runs.
 *
 * Two sittings of one course can start on the same day (an onsite class and an
 * external one). Nothing the matcher looks at — title, start date, even
 * mode_of_learning — distinguishes them, so any choice is a coin flip. A wrong
 * pick puts the learner on the wrong class and bills the wrong run, and it is
 * only noticed when someone reads the table against the invoice.
 *
 * Failing loudly is the only safe answer: the row stops with a message naming
 * the candidates, and an admin pins the right one.
 */
function assertSingleCourseRun(rows: any[], title: string, startDate: string | null): void {
  if (rows.length <= 1) return;
  const ids = rows.map(r => String(r.course_run_id)).join(', ');
  throw new Error(
    `Ambiguous course run: ${rows.length} runs of "${title}" start on ${startDate || '(no date)'} — ${ids}. ` +
    `The LMS will not guess which one this learner is on. Re-upload and pick the course run, ` +
    `or set the Course Run ID on the application.`
  );
}

/**
 * The reference number comes from RUN_COURSE_CODE_SQL, never bare c.course_code:
 * for a renewed course that column holds the RETIRED code, and SSG rejects the
 * enrolment with "TGS-406 - Invalid course reference number" (hit on run 1415270,
 * where TGS-2020503487 had been superseded by TGS-2026064720).
 */
async function resolveCourseRun(row: any): Promise<ResolvedRun | null> {
  const title = String(row.course_title || '').trim();
  const startDate = normalizeDate(row.course_start_date);

  // An admin already answered "did you mean this run?" at upload time, and that
  // answer was stamped on the row. Trust it — re-deriving from the same title
  // and date that failed to match would just fail again.
  const preResolved = String(row.course_run_id || '').trim();
  if (preResolved) {
    const pinned = await pool.query(
      `SELECT cr.id::text AS course_run_uuid,
              cr.course_run_id::text AS course_run_id,
              ${RUN_COURSE_CODE_SQL}::text AS course_reference_number,
              c.title::text AS course_title,
              c.course_fee::numeric AS course_fee,
              cr.start_date::text AS start_date
         FROM public.course_run cr
         JOIN public.course c ON c.id = cr.course_id
        WHERE cr.course_run_id = $1
          AND COALESCE(cr.is_deleted, false) = false
        LIMIT 1`,
      [preResolved]
    );
    const run = pinned.rows[0];
    if (run) {
      return {
        courseRunUuid: run.course_run_uuid,
        courseRunId: run.course_run_id,
        courseReferenceNumber: run.course_reference_number,
        courseTitle: run.course_title,
        startDate: run.start_date ? normalizeDate(run.start_date) : startDate,
        courseFee: run.course_fee == null ? null : Number(run.course_fee),
      };
    }
  }

  if (!title) return null;
  const normalizedTitle = normalizeTitle(title);

  const params: any[] = [title];
  let dateClause = '';
  if (startDate) {
    params.push(startDate);
    dateClause = `AND cr.start_date::date = $2::date`;
  }

  const exact = await pool.query(
    `SELECT cr.id::text AS course_run_uuid,
            cr.course_run_id::text AS course_run_id,
            ${RUN_COURSE_CODE_SQL}::text AS course_reference_number,
            c.title::text AS course_title,
            c.course_fee::numeric AS course_fee,
            cr.start_date::text AS start_date
       FROM public.course_run cr
       JOIN public.course c ON c.id = cr.course_id
      WHERE LOWER(TRIM(c.title::text)) = LOWER(TRIM($1::text))
        ${dateClause}
        AND COALESCE(cr.is_deleted, false) = false
      ORDER BY cr.start_date ASC NULLS LAST, cr.course_run_id ASC
      LIMIT 5`,
    params
  );

  // More than one run of this course starts on this date — an onsite and an
  // external sitting, typically. Title and start date cannot separate them, and
  // guessing silently writes the wrong run onto the learner: wrong class, wrong
  // invoice, and a table that contradicts the enrolment. Refuse instead. The
  // upload popup exists so a human pins the run up front; this is the backstop
  // for rows that arrive without one.
  assertSingleCourseRun(exact.rows, title, startDate);

  const found = exact.rows[0];
  if (found) {
    return {
      courseRunUuid: found.course_run_uuid,
      courseRunId: found.course_run_id,
      courseReferenceNumber: found.course_reference_number,
      courseTitle: found.course_title,
      startDate: found.start_date ? normalizeDate(found.start_date) : startDate,
      courseFee: found.course_fee == null ? null : Number(found.course_fee),
    };
  }

  if (startDate && normalizedTitle) {
    const sameDateRuns = await pool.query(
      `SELECT cr.id::text AS course_run_uuid,
              cr.course_run_id::text AS course_run_id,
              ${RUN_COURSE_CODE_SQL}::text AS course_reference_number,
              c.title::text AS course_title,
              c.course_fee::numeric AS course_fee,
              cr.start_date::text AS start_date
         FROM public.course_run cr
         JOIN public.course c ON c.id = cr.course_id
        WHERE cr.start_date::date = $1::date
        -- Stable tie-break, as above.
        ORDER BY cr.start_date ASC NULLS LAST, cr.course_run_id ASC
        LIMIT 100`,
      [startDate]
    );

    // A TGS code pasted into the title is exact and survives renames — try it
    // before falling back to comparing words.
    const pastedCode = extractCourseReferenceNumber(title);
    const targetTokens = titleTokenKey(title);

    const byCode = pastedCode
      ? sameDateRuns.rows.filter(
          (candidate: any) => String(candidate.course_reference_number || '').trim().toUpperCase() === pastedCode
        )
      : [];
    const byTitle = sameDateRuns.rows.filter((candidate: any) => {
      const candidateTitle = normalizeTitle(candidate.course_title);
      return (
        candidateTitle === normalizedTitle ||
        candidateTitle.includes(normalizedTitle) ||
        normalizedTitle.includes(candidateTitle) ||
        (!!targetTokens && titleTokenKey(candidate.course_title) === targetTokens) // same words, any order
      );
    });

    // Same rule as the exact path: several equally-good runs means we do not
    // know, so we say so rather than pick one. (A TGS code narrows to one
    // course but not to one sitting of it, so it needs the check too.)
    const matches = byCode.length > 0 ? byCode : byTitle;
    assertSingleCourseRun(matches, title, startDate);
    const fuzzy = matches[0];

    if (fuzzy) {
      return {
        courseRunUuid: fuzzy.course_run_uuid,
        courseRunId: fuzzy.course_run_id,
        courseReferenceNumber: fuzzy.course_reference_number,
        courseTitle: fuzzy.course_title,
        startDate: fuzzy.start_date ? normalizeDate(fuzzy.start_date) : startDate,
        courseFee: fuzzy.course_fee == null ? null : Number(fuzzy.course_fee),
      };
    }
  }

  return null;
}

async function findGrantSummary(enrolmentId: string): Promise<{ grantId: string | null; amount: number | null }> {
  // Pick the highest-amount grant for this enrolment. Amount is approved if
  // positive, else estimated. Cannot use COALESCE(approved, estimated, 0)
  // because that returns 0 when approved_grant_amount=0 (not NULL), masking
  // a positive estimated value during SSG's "Grant Processing" status.
  const grantRes = await pool.query(
    `SELECT grant_id,
            (CASE
               WHEN COALESCE(approved_grant_amount, 0) > 0 THEN approved_grant_amount
               ELSE COALESCE(estimated_grant_amount, 0)
             END) AS amount
       FROM public.ssg_grants
      WHERE LOWER(TRIM(enrollment_id::text)) = LOWER(TRIM($1::text))
        AND COALESCE(status, '') <> 'Cancelled'
      ORDER BY (CASE
                  WHEN COALESCE(approved_grant_amount, 0) > 0 THEN approved_grant_amount
                  ELSE COALESCE(estimated_grant_amount, 0)
                END) DESC NULLS LAST
      LIMIT 1`,
    [enrolmentId]
  );

  const grant = grantRes.rows[0];
  if (!grant) return { grantId: null, amount: null };

  const amount = Number(grant.amount);
  return {
    grantId: grant.grant_id || null,
    amount: Number.isFinite(amount) ? amount : null,
  };
}

function buildCompanyApplicationId(row: any): string {
  const raw = String(row.id || '').trim();
  const compact = raw.replace(/[^a-z0-9]+/gi, '-').replace(/^-+|-+$/g, '').slice(0, 80);
  return `CA-${compact || row.id}`;
}

function mapTraineeIdType(value: unknown): string | null {
  const raw = String(value || '').trim();
  const lower = raw.toLowerCase();

  if (!raw) return null;
  if (lower.includes('blue') || lower.includes('pink') || lower.includes('nric')) return 'NRIC';
  if (lower.includes('fin')) return 'FIN';
  if (lower.includes('passport')) return 'Passport';

  return raw;
}

function buildCompanyApplicationRecord(row: any, run: ResolvedRun, enrolmentId?: string | null): any {
  return {
    id: row.id,
    application_id: buildCompanyApplicationId(row),
    application_status: 'Confirmed',
    enrolment_status: enrolmentId ? 'Confirmed' : null,

    course_title: run.courseTitle || row.course_title,
    course_run_id: run.courseRunId,
    course_reference_number: run.courseReferenceNumber,

    trainee_id: row.trainee_nric,
    trainee_id_type: mapTraineeIdType(row.trainee_id_type),
    trainee_name: row.trainee_full_name,
    trainee_email: row.trainee_email,
    trainee_phone: row.trainee_phone,
    date_of_birth: normalizeDate(row.date_of_birth),

    sponsorship_type: 'EMPLOYER',
    employer_uen: row.employer_uen,

    highest_qualification: row.trainee_highest_qualification,

    course_fee: run.courseFee || 0,
    net_fee: run.courseFee || 0,
    discount_amount: 0,

    enrolment_id: enrolmentId || null,
  };
}

/**
 * Creates the native LMS enrolment rows for a Company Application record:
 *   - Ensures the trainee has an `app_user` + `user_role_map` + `learner_profile`
 *   - Upserts a row in `enrollment` so the trainee shows up in the LMS course
 *
 * Mirrors what DA does for its native enrolment, but writes back to
 * `company_application` (not `da_application`) for status preservation.
 */
async function createNativeEnrolment(
  record: any,
  options: { calendarSynced?: boolean } = {}
): Promise<string | null> {
  if (!record.course_run_id || !record.trainee_id || !record.trainee_email) return null;
  const calendarSynced = options.calendarSynced === true;

  try {
    // CA's course_run_id is the external SSG string (e.g. "1310712"). Resolve
    // both internal UUID and external code so we can join on either.
    const runRes = await pool.query(
      `SELECT id AS internal_id, course_id
         FROM course_run
        WHERE (id::text = $1 OR course_run_id = $1) AND is_deleted IS NOT TRUE
        LIMIT 1`,
      [record.course_run_id]
    );

    const internalRunId = runRes.rows[0]?.internal_id;
    const courseId = runRes.rows[0]?.course_id;
    if (!courseId || !internalRunId) {
      console.warn(`⚠️ [CA] Could not find course_run for ID: ${record.course_run_id}`);
      return null;
    }

    const existingUser = await pool.query(
      `SELECT id FROM app_user
        WHERE LOWER(email) = LOWER($1) OR LOWER(secondary_email) = LOWER($1)
        LIMIT 1`,
      [record.trainee_email]
    );

    let userId: string | undefined = existingUser.rows[0]?.id;

    if (!userId) {
      const newUser = await pool.query(
        `INSERT INTO app_user (id, email, full_name, password_hash, account_status, created_at, updated_at)
         VALUES (gen_random_uuid(), $1, $2, '', 'active', NOW(), NOW())
         RETURNING id`,
        [record.trainee_email.toLowerCase(), record.trainee_name || '']
      );
      userId = newUser.rows[0].id;

      await pool.query(
        `INSERT INTO user_role_map (user_id, role) VALUES ($1, 'Learner') ON CONFLICT DO NOTHING`,
        [userId]
      );
      await pool.query(
        `INSERT INTO learner_profile (user_id, nric, tel) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING`,
        [userId, record.trainee_id, record.trainee_phone || '']
      );
    }

    const ssgEnrolmentReference = isRealSsgEnrolmentId(record.enrolment_id)
      ? String(record.enrolment_id).trim()
      : null;

    // calendar_added mirrors company_application.calendar_added so the generic
    // sync-calendar action in enrolment-actions.ts (which calls
    // addDaLearnerToCalendar — auto-creates events on miss) skips this row.
    // Without this the admin's "Sync Calendar" button on Class Management
    // would re-process CA learners through the DA path and create a duplicate
    // recurring event whenever its matching logic disagreed with CA's.
    const inserted = await pool.query(
      `INSERT INTO enrollment (
          id, user_id, course_id, course_run_id, progress_percent, payment_status,
          assessment_status, enrolment_status, enrolment_date, email, nric,
          enrolment_id, course_reference, calendar_added, created_at, updated_at
       )
       VALUES (gen_random_uuid(), $1, $2, $3, 0, 'Unpaid', 'Pending', 'Confirmed', CURRENT_DATE, $4, $5, $6, $7, $8, NOW(), NOW())
       ON CONFLICT (user_id, course_run_id) DO UPDATE SET
          enrolment_status = 'Confirmed',
          enrolment_id = COALESCE(EXCLUDED.enrolment_id, enrollment.enrolment_id),
          email = COALESCE(EXCLUDED.email, enrollment.email),
          nric = COALESCE(EXCLUDED.nric, enrollment.nric),
          course_reference = COALESCE(EXCLUDED.course_reference, enrollment.course_reference),
          calendar_added = enrollment.calendar_added OR EXCLUDED.calendar_added,
          updated_at = NOW()
       RETURNING id`,
      [
        userId,
        courseId,
        internalRunId,
        record.trainee_email,
        record.trainee_id,
        ssgEnrolmentReference,
        record.course_reference_number || null,
        calendarSynced,
      ]
    );

    const nativeId = inserted.rows[0]?.id;
    return nativeId ? String(nativeId) : null;
  } catch (err) {
    console.error('❌ [CA] createNativeEnrolment failed:', err);
    return null;
  }
}

export async function processCompanyApplication(
  appId: string,
  sharedCtx?: SSGContext
): Promise<{
  id: string;
  success: boolean;
  finalStatus: AutoEnrolStatus;
  enrolmentId?: string;
  grantId?: string;
  error?: string;
}> {
  await ensureCompanyApplicationsTable();

  // Advisory lock so two concurrent pipeline runs over the same row can't both
  // POST to SSG / QBO. We hold a dedicated connection from the pool for the
  // duration; pg advisory locks are database-global so the rest of the body
  // can use pool.query normally. If we can't acquire the lock, another worker
  // is already mid-processing — skip cleanly rather than racing.
  const lockKey = `ca-app:${appId}`;
  let lockClient;
  try {
    lockClient = await pool.connect();
  } catch (connectErr) {
    // Pool exhausted or DB unreachable — surface as a row-level failure so
    // bulkProcessCompanyApplications can keep going on the next row instead
    // of throwing out of the whole batch.
    const message = connectErr instanceof Error ? connectErr.message : String(connectErr);
    console.error(`[processCompanyApplication] pool.connect failed for ${appId}:`, message);
    return {
      id: appId,
      success: false,
      finalStatus: 'failed',
      error: `Could not acquire DB connection for advisory lock: ${message}`,
    };
  }
  let lockAcquired = false;
  try {
    const lockRes = await lockClient.query(
      `SELECT pg_try_advisory_lock(hashtext($1)) AS locked`,
      [lockKey]
    );
    lockAcquired = !!lockRes.rows[0]?.locked;
    if (!lockAcquired) {
      console.log(`[processCompanyApplication] ${appId} already being processed by another worker; skipping`);
      return {
        id: appId,
        success: false,
        finalStatus: 'failed',
        error: 'Already being processed by another worker (advisory lock contended)',
      };
    }

  const rowRes = await pool.query(`SELECT * FROM public.company_application WHERE id = $1`, [appId]);
  const row = rowRes.rows[0];

  if (!row) {
    return { id: appId, success: false, finalStatus: 'failed', error: 'row not found' };
  }

  await updateCompanyRow(appId, { auto_enrol_status: 'pending', auto_enrol_error: null });

  const run = await resolveCourseRun(row);

  if (!run) {
    const message = `Could not resolve course run for "${row.course_title || ''}" on "${row.course_start_date || ''}"`;
    await markFailed(appId, 'course_run', new Error(message));
    return { id: appId, success: false, finalStatus: 'failed', error: message };
  }

  // Never silently replace a course run that is already on the row.
  //
  // The matcher keys on (title, start date), which cannot separate two runs of
  // the same course starting the same day — an onsite and an external sitting of
  // one course, say. Its tie-break is `ORDER BY start_date LIMIT 1`, so on a tie
  // the winner is whatever the query plan returns, and two passes over the same
  // row can legitimately disagree. That is not theoretical: a row was enrolled
  // and invoiced against run 1386025, then a later pass flipped the column to
  // 1404702, leaving the table contradicting the invoice.
  //
  // A run ID already on the row came either from an admin confirming it at
  // upload, or from the pass that actually enrolled the learner. Both beat a
  // fresh guess. Keep it, and surface the disagreement instead of burying it.
  // Reaching here with a mismatch means the run ID on the row could not be
  // loaded from course_run at all (deleted, or never imported) — resolveCourseRun
  // returns the pinned run untouched whenever it exists. Keeping a run ID that
  // points at nothing would be worse than useless, so the matcher's answer is
  // used; the warning is what makes the swap visible instead of silent.
  const existingRunId = String(row.course_run_id || '').trim();
  if (existingRunId && existingRunId !== run.courseRunId) {
    console.warn(
      `[CA] Course run ${existingRunId} on ${appId} is not in course_run — falling back to matched run ${run.courseRunId}`
    );
    await appendPipelineWarning(
      appId,
      `Course run changed from ${existingRunId} to ${run.courseRunId}: ${existingRunId} was not found in the LMS. Check this is the right run — two sittings of one course can share a start date.`
    ).catch(() => { /* advisory only; never break the pipeline over a warning */ });
  }

  await updateCompanyRow(appId, {
    course_reference_number: run.courseReferenceNumber,
    course_run_id: run.courseRunId,
  });

  let enrolmentReference: string | null = row.enrolment_id || null;
  let enrolmentError: string | null = null;
  let caRecord = buildCompanyApplicationRecord(row, run, enrolmentReference);

  if (!enrolmentReference) {
    // Captured just before the create call so the catch can search SSG for an
    // enrolment it may have created even though the create request timed out.
    let recoveryPayload: any = null;
    try {
      const ctx = sharedCtx || (await loadSsgContext());

      console.log('🏢 Company auto-enrol data check:', {
        course_title: caRecord.course_title,
        course_run_id: caRecord.course_run_id,
        course_reference_number: caRecord.course_reference_number,
        course_fee: caRecord.course_fee,
        net_fee: caRecord.net_fee,
        run_course_fee: run.courseFee,
        trainee_id: caRecord.trainee_id,
        trainee_id_type: caRecord.trainee_id_type,
        trainee_name: caRecord.trainee_name,
        trainee_email: caRecord.trainee_email,
        trainee_phone: caRecord.trainee_phone,
        date_of_birth: caRecord.date_of_birth,
        employer_uen: caRecord.employer_uen,
        uen: ctx.uen,
        tpCode: ctx.tpCode,
      });

      const payload = buildEnrolmentPayload(caRecord, ctx.uen, ctx.tpCode) as any;

      const feeAmount = Number(run.courseFee) || Number(caRecord.course_fee) || 0;

      if (payload?.enrolment?.trainee) {
        payload.enrolment.trainee.sponsorshipType = 'EMPLOYER';

        // ✅ FIX 1: Fees
        payload.enrolment.trainee.fees = {
          courseFee: feeAmount,
          netFee: feeAmount,
          discountAmount: 0,
          collectionStatus: 'Pending Payment',
        };

        const employerEmailRaw = String(row.employer_contact_email || '').trim();
        const employerEmail = /\S+@\S+\.\S+/.test(employerEmailRaw)
          ? employerEmailRaw
          : String(row.trainee_email || '').trim();

        payload.enrolment.trainee.employer = {
          uen: String(row.employer_uen || '').trim(),
          contact: {
            fullName: String(row.employer_contact_name || '').trim(),
            emailAddress: employerEmail,
            contactNumber: {
              countryCode: '65',
              areaCode: '',
              phoneNumber: String(row.employer_contact_phone || '').replace(/\D/g, ''),
            },
          },
        };
      }

      console.log('📦 Company SSG payload check:', JSON.stringify(payload, null, 2));

      // SSG create-enrolment routinely exceeds the default 30s and aborts even
      // though SSG created the record — give it 60s (mirrors /api/enrolment/create).
      recoveryPayload = payload;
      const parsed = await ssgEncryptedPost(ctx, '/tpg/enrolments', payload, 60000);
      const errMsg = hasSsgError(parsed);

      if (errMsg) {
        if (errMsg.toLowerCase().includes('duplicate')) {
          const p = payload as any;
          const searchPayload = {
            enrolment: {
              course: p.enrolment.course,
              trainee: p.enrolment.trainee,
              trainingPartner: p.enrolment.trainingPartner,
            },
            parameters: { page: 0, pageSize: 10 },
          };

          const searchResult = await searchEnrolment(searchPayload as any);

          if (searchResult.success && searchResult.referenceNumber) {
            enrolmentReference = searchResult.referenceNumber;
          } else {
            throw new Error('Duplicate record found, but search failed to recover reference');
          }
        } else {
          throw new Error(errMsg);
        }
      } else {
        enrolmentReference = extractEnrolmentReference(parsed);
      }

      if (!enrolmentReference) throw new Error('no enrolment reference in SSG response');

      // auto_enrol_status stays 'pending' until the whole pipeline finishes
      // (calendar + native enrolment included) so the upload UI's polling can
      // hold its spinner until everything is actually done.
      await updateCompanyRow(appId, {
        enrolment_id: enrolmentReference,
        enrolment_status: 'Confirmed',
      });

      caRecord = buildCompanyApplicationRecord(row, run, enrolmentReference);
    } catch (err) {
      // Timeout / network — SSG may have created the enrolment anyway. Search
      // for it and adopt an existing (non-cancelled) reference before failing,
      // so the row isn't parked at 'failed' with a live orphan enrolment.
      let recovered: string | null = null;
      if (recoveryPayload) {
        try {
          const p = recoveryPayload;
          const searchResult = await searchEnrolment({
            enrolment: {
              course: p.enrolment.course,
              trainee: p.enrolment.trainee,
              trainingPartner: p.enrolment.trainingPartner,
            },
            parameters: { page: 0, pageSize: 10 },
          } as any);
          const dead = ['cancelled', 'withdrawn', 'rejected'];
          if (
            searchResult.success &&
            searchResult.referenceNumber &&
            !dead.includes(String(searchResult.enrolmentStatus || '').toLowerCase())
          ) {
            recovered = searchResult.referenceNumber;
          }
        } catch (searchErr) {
          console.warn('[company auto-enrol] recovery search failed:', searchErr instanceof Error ? searchErr.message : searchErr);
        }
      }

      if (recovered) {
        console.log(`✅ [company auto-enrol] recovered enrolment after failed create: ${recovered}`);
        enrolmentReference = recovered;
        await updateCompanyRow(appId, {
          enrolment_id: enrolmentReference,
          enrolment_status: 'Confirmed',
        });
        caRecord = buildCompanyApplicationRecord(row, run, enrolmentReference);
      } else {
        await markFailed(appId, 'enrolment', err);
        enrolmentError = err instanceof Error ? err.message : String(err);

        console.error('[company auto-enrol] enrolment failed:', {
          companyApplicationId: appId,
          error: enrolmentError,
        });
      }
    }
  }

  let grantId: string | null = row.grant_id || null;
  let grantAmount: number | null = row.grant_amount == null ? null : Number(row.grant_amount);

  if (enrolmentReference) {
    try {
      const ctx = sharedCtx || (await loadSsgContext());

      const parsed = await ssgEncryptedPost(ctx, '/tpg/grants/search', {
        grants: {
          enrolment: { referenceNumber: enrolmentReference },
          trainingPartner: { uen: ctx.uen, code: ctx.tpCode },
        },
        parameters: { page: 0, pageSize: 10 },
      });

      const errMsg = hasSsgError(parsed);

      if (!errMsg) {
        const first = Array.isArray(parsed?.data) ? parsed.data[0] : null;
        grantId = first?.referenceNumber || grantId;

        const amount = Number(first?.approvedGrantAmount ?? first?.estimatedGrantAmount ?? first?.grantAmount);
        if (Number.isFinite(amount)) grantAmount = amount;
      }

      const refreshResults = await refreshGrantsForEnrolments([enrolmentReference]);
      const failedRefresh = refreshResults.find(r => !r.success);
      if (failedRefresh) {
        await appendPipelineWarning(
          appId,
          'grant_upsert',
          failedRefresh.error || 'refreshGrantsForEnrolments reported failure',
        );
      }

      const dbGrant = await findGrantSummary(enrolmentReference);
      grantId = dbGrant.grantId || grantId;
      grantAmount = dbGrant.amount ?? grantAmount;

      if (grantId || grantAmount != null) {
        // Same reason as above — defer auto_enrol_status until the end of the
        // pipeline so the upload UI keeps spinning through calendar/native.
        await updateCompanyRow(appId, {
          grant_id: grantId,
          grant_amount: grantAmount,
          grant_application_nos: grantId || row.grant_application_nos || null,
        });
      }
    } catch (err) {
      console.warn('[company auto-enrol] grant lookup failed:', err instanceof Error ? err.message : err);
      await appendPipelineWarning(appId, 'grant_fetch', err);
    }
  }

  let calendarSynced = false;
  try {
    const calendarResult = await addCaLearnerToCalendar(
      caRecord.trainee_email,
      run.courseRunUuid,
      caRecord.course_title,
      run.startDate || row.course_start_date
    );

    if (calendarResult.addedTo > 0) {
      await updateCompanyRow(appId, { calendar_added: true });
      calendarSynced = true;
    }
  } catch (err) {
    console.warn('[company auto-enrol] calendar sync failed:', err instanceof Error ? err.message : err);
    await appendPipelineWarning(appId, 'calendar_sync', err);
  }

  try {
    if (enrolmentReference) {
      await createNativeEnrolment(caRecord, { calendarSynced });
    }
  } catch (err) {
    console.warn('[company auto-enrol] native enrolment failed:', err instanceof Error ? err.message : err);
    await appendPipelineWarning(appId, 'native_enrol', err);
  }

  // auto_enrol_status stays 'pending' here. bulkProcessCompanyApplications
  // flips it at the very end after the grant poll, invoice, and email steps.
  // Enrolment failure already wrote status='failed' via markFailed() above.
  const finalStatus: AutoEnrolStatus = enrolmentError ? 'failed' : grantId ? 'grant_found' : 'enroled';

  return {
    id: appId,
    success: !enrolmentError,
    finalStatus,
    enrolmentId: enrolmentReference || undefined,
    grantId: grantId || undefined,
    error: enrolmentError || undefined,
  };
  } finally {
    if (lockAcquired) {
      await lockClient
        .query(`SELECT pg_advisory_unlock(hashtext($1))`, [lockKey])
        .catch(unlockErr => {
          console.warn(
            `[processCompanyApplication] Failed to release advisory lock for ${appId}:`,
            unlockErr instanceof Error ? unlockErr.message : unlockErr
          );
        });
    }
    lockClient.release();
  }
}

export async function bulkProcessCompanyApplications(applicationIds: string[]): Promise<void> {
  const uniqueIds = Array.from(new Set(applicationIds.filter(Boolean)));
  if (!uniqueIds.length) return;

  for (let i = 0; i < uniqueIds.length; i += BATCH_SIZE) {
    const batch = uniqueIds.slice(i, i + BATCH_SIZE);

    for (const id of batch) {
      await processCompanyApplication(id).catch(err => markFailed(id, 'pipeline', err));
    }
  }

  // Grant materialisation polling — SSG creates the grant asynchronously as a
  // side-effect of POST /tpg/enrolments. The grant typically appears within
  // seconds but can take 15+ minutes. Re-run the wide-net sweep for a bounded
  // window, then continue into the guarded invoice sweep. Rows still awaiting
  // grants are skipped by generateInvoicesForApplications instead of blocking
  // this background worker forever.
  //
  // Restart recovery: this loop is in-process. If the server restarts mid-poll
  // (deploy, crash), affected rows stay at auto_enrol_status='pending' with no
  // background process to resume them. Recovery is manual — admin clicks the
  // "Sync Grants" button on the View Company Application page, which runs the
  // same sweepGrantsByCourseRunForApplications logic against the same rows.
  const POLL_INTERVAL_MS = 30_000;
  const MAX_GRANT_POLL_ITERATIONS = 30;
  let pollIteration = 0;
  while (true) {
    try {
      await sweepGrantsByCourseRunForApplications(uniqueIds);
    } catch (err) {
      console.warn('[bulkProcessCompanyApplications] grant sweep iteration failed (non-fatal):', err instanceof Error ? err.message : err);
    }

    const pendingRes = await pool.query(
      `SELECT COUNT(*)::int AS pending_count
         FROM public.company_application
        WHERE id = ANY($1::uuid[])
          AND auto_enrol_status = 'pending'
          AND enrolment_id IS NOT NULL
          AND COALESCE(grant_id, '') = ''
          AND COALESCE(grant_ineligible, false) = false`,
      [uniqueIds]
    );
    const pendingCount = pendingRes.rows[0]?.pending_count ?? 0;
    if (pendingCount === 0) break;

    pollIteration++;
    if (pollIteration >= MAX_GRANT_POLL_ITERATIONS) {
      console.warn(
        `[bulkProcessCompanyApplications] grant poll timed out after ${pollIteration} iteration(s): ${pendingCount} row(s) still awaiting grant — continuing to guarded invoice sweep`
      );
      break;
    }
    console.log(`[bulkProcessCompanyApplications] grant poll iteration ${pollIteration}: ${pendingCount} row(s) still awaiting grant — sleeping ${POLL_INTERVAL_MS}ms`);
    await new Promise(resolve => setTimeout(resolve, POLL_INTERVAL_MS));
  }

  // Auto-invoice. Runs after the poll has confirmed every enroled row has
  // a grant_id (or is marked grant_ineligible), so skippedAwaitingGrants
  // should be 0. Idempotent — groups that already have invoice_id are skipped.
  try {
    const { generateInvoicesForApplications } = await import('./quickbooks/createCompanyApplicationInvoice');
    const summary = await generateInvoicesForApplications(uniqueIds);
    console.log(
      `[bulkProcessCompanyApplications] invoice sweep — generated ${summary.generated}, alreadyInvoiced ${summary.skippedAlreadyInvoiced}, notEnrolled ${summary.skippedNotEnrolled}, awaitingGrants ${summary.skippedAwaitingGrants}, failed ${summary.failed}`
    );
    if (summary.skippedAwaitingGrants > 0) {
      console.warn(
        `[bulkProcessCompanyApplications] ${summary.skippedAwaitingGrants} invoice group(s) skipped because grants have not materialised yet`
      );
    }
    if (summary.failed > 0) {
      console.warn('[bulkProcessCompanyApplications] invoice failures:', summary.errors);
    }
  } catch (err) {
    console.error('[bulkProcessCompanyApplications] invoice generation crashed (non-fatal):', err);
  }

  // Auto-send the consolidated invoice email IF the master switch is ON. The
  // switch (training_provider.ca_auto_send_invoice_email) is checked inside the
  // send helper and fails closed (switch OFF → nothing sent, "held in test
  // mode"). Per product decision, this automatic send does NOT wait for
  // supporting-doc verification (skipDocVerification: true) — unlike the manual
  // "Send Invoice Email" button, which still enforces it. Idempotent: the send
  // helper atomically claims invoice_sent_at, so a later manual click won't
  // double-send. Non-fatal — a send failure never breaks enrolment.
  try {
    const { sendCompanyApplicationInvoiceEmails } = await import('./quickbooks/sendCompanyApplicationInvoiceEmails');
    const emailSummary = await sendCompanyApplicationInvoiceEmails(uniqueIds, { skipDocVerification: true });
    if (emailSummary.toggleDisabled) {
      console.log('[bulkProcessCompanyApplications] invoice email auto-send skipped — master switch OFF (held in test mode)');
    } else {
      console.log(
        `[bulkProcessCompanyApplications] invoice email auto-send — sent ${emailSummary.sent}, alreadySent ${emailSummary.skippedAlreadySent}, missingEmail ${emailSummary.skippedMissingEmail}, noInvoice ${emailSummary.skippedNoInvoice}, failed ${emailSummary.failed}`
      );
      if (emailSummary.failed > 0) {
        console.warn('[bulkProcessCompanyApplications] invoice email failures:', emailSummary.failures);
      }
    }
  } catch (err) {
    console.error('[bulkProcessCompanyApplications] invoice email auto-send crashed (non-fatal):', err);
  }

  // Flip final per-row status. Rows still at 'pending' get classified by what
  // actually landed in the DB. We ALSO re-classify rows wrongly stuck at
  // 'failed' that have since acquired an enrolment_id — the first pass can stamp
  // 'failed' (enrolment_id IS NULL branch) before SSG returns the id, and
  // without this a later-successful row would flag "failed" forever with all
  // stages green. Genuinely-failed rows (no enrolment_id) are not matched by the
  // WHERE clause, so they correctly stay 'failed' with their original error.
  await pool.query(
    `UPDATE public.company_application
        SET auto_enrol_status = CASE
              WHEN enrolment_id IS NULL THEN 'failed'
              WHEN COALESCE(invoice_id, '') <> '' THEN 'invoiced'
              WHEN COALESCE(grant_id, '') <> '' OR COALESCE(grant_ineligible, false) = true THEN 'grant_found'
              ELSE 'enroled'
            END,
            auto_enrol_error = CASE WHEN enrolment_id IS NULL THEN auto_enrol_error ELSE NULL END,
            updated_at = now()
      WHERE id = ANY($1::uuid[])
        AND (auto_enrol_status = 'pending'
             OR (auto_enrol_status = 'failed' AND enrolment_id IS NOT NULL))`,
    [uniqueIds]
  );
}

/**
 * Sweep SSG grants by course.run.id for every distinct courseRunId touched
 * by the given application rows, upsert into ssg_grants, then backfill
 * ca.grant_id / grant_amount. Wider than the per-row narrow search — catches
 * grants stakeholders pre-applied via the SSG portal that the narrow
 * /tpg/grants/search by enrolment.referenceNumber misses.
 *
 * Inline implementation of /api/admin/ca-sync-grants so the upload pipeline
 * runs the same sweep without an HTTP hop. Failures are logged and swallowed
 * by the caller.
 */
export async function sweepGrantsByCourseRunForApplications(applicationIds: string[]): Promise<void> {
  const ids = Array.from(new Set(applicationIds.filter(Boolean)));
  if (ids.length === 0) return;

  const runRes = await pool.query(
    `SELECT DISTINCT course_run_id
       FROM public.company_application
      WHERE id = ANY($1::uuid[])
        AND course_run_id IS NOT NULL
        AND TRIM(course_run_id) <> ''`,
    [ids]
  );
  const courseRunIds: string[] = runRes.rows.map((r: any) => String(r.course_run_id));
  if (courseRunIds.length === 0) {
    // Nothing to sweep, but residency is knowable without SSG — settle it so
    // this path doesn't leave rows waiting on a grant that can't exist.
    await markNonResidentsGrantIneligible(ids);
    return;
  }

  const ctx = await loadSsgContext();
  const { upsertSsgGrant } = await import('./services/billingSync');

  let totalUpserted = 0;
  for (const courseRunId of courseRunIds) {
    try {
      const parsed = await ssgEncryptedPost(ctx, '/tpg/grants/search', {
        grants: {
          course: { run: { id: courseRunId } },
          trainingPartner: { uen: ctx.uen, code: ctx.tpCode },
        },
        parameters: { page: 0, pageSize: 100 },
      });
      const errMsg = hasSsgError(parsed);
      if (errMsg) {
        console.warn(`[sweepGrantsByCourseRun] Run ${courseRunId} returned error:`, errMsg);
        continue;
      }
      const grants: Record<string, unknown>[] = Array.isArray(parsed?.data) ? parsed.data : [];
      for (const grant of grants) {
        try {
          await upsertSsgGrant(grant);
          totalUpserted++;
        } catch (err) {
          console.warn(`[sweepGrantsByCourseRun] Upsert failed for run ${courseRunId}:`, err instanceof Error ? err.message : err);
        }
      }
    } catch (err) {
      console.warn(`[sweepGrantsByCourseRun] Search failed for run ${courseRunId}:`, err instanceof Error ? err.message : err);
    }
  }

  // Backfill ca.grant_id from the freshly-populated ssg_grants so the View
  // page reflects the new state and the invoice guard's read-path is
  // consistent with the upsert. Picks the highest-amount positive grant
  // per enrolment.
  //
  // Note: "amount" is approved if positive, else estimated. Using
  // COALESCE(approved, estimated, 0) is WRONG when approved=0 (not NULL)
  // because COALESCE picks 0 over the positive estimated value. SSG often
  // returns approved=0 + estimated=N while a grant is in "Grant Processing"
  // status, so we must compute the amount with a CASE / GREATEST instead.
  if (totalUpserted > 0) {
    await pool.query(
      `UPDATE public.company_application ca
          SET grant_id = sg.grant_id,
              grant_amount = sg.amount,
              grant_application_nos = COALESCE(ca.grant_application_nos, sg.grant_id),
              updated_at = now()
        FROM (
          SELECT DISTINCT ON (LOWER(TRIM(enrollment_id)))
                 LOWER(TRIM(enrollment_id)) AS enrolment_key,
                 grant_id,
                 (CASE
                    WHEN COALESCE(approved_grant_amount, 0) > 0 THEN approved_grant_amount
                    ELSE COALESCE(estimated_grant_amount, 0)
                  END) AS amount
            FROM public.ssg_grants
           WHERE COALESCE(status, '') <> 'Cancelled'
             AND (
                   COALESCE(approved_grant_amount, 0) > 0
                OR COALESCE(estimated_grant_amount, 0) > 0
             )
           ORDER BY LOWER(TRIM(enrollment_id)),
                    (CASE
                       WHEN COALESCE(approved_grant_amount, 0) > 0 THEN approved_grant_amount
                       ELSE COALESCE(estimated_grant_amount, 0)
                     END) DESC NULLS LAST
        ) sg
       WHERE LOWER(TRIM(ca.enrolment_id)) = sg.enrolment_key
         AND ca.id = ANY($1::uuid[])
         AND (COALESCE(ca.grant_id, '') = '' OR ca.grant_id <> sg.grant_id)`,
      [ids]
    );
  }

  console.log(`[sweepGrantsByCourseRun] swept ${courseRunIds.length} run(s), upserted ${totalUpserted} grant(s)`);

  // Settle residency-based ineligibility now that SSG has had its chance to
  // produce a grant. Runs on every sweep (upload pipeline, Sync Grants, Run
  // Pipeline) so no caller can skip it.
  await markNonResidentsGrantIneligible(ids);
}

/**
 * Mark learners who can never receive an SSG grant — foreigners on a FIN /
 * Work Permit / passport — as `grant_ineligible`.
 *
 * SSG funding is Citizens and PRs only, so waiting on a grant for these rows is
 * waiting for something that will never come; worse, the per-group invoice guard
 * withholds the ENTIRE employer group's invoice while any learner is
 * "awaiting grant". Marking them lets the group bill correctly: the foreign
 * learner at full course fee, everyone else net of grant.
 *
 * Conservative on purpose:
 *   - Never touches a row that already has a grant_id. If SSG did grant one,
 *     reality beats our classification.
 *   - Never touches a row already marked ineligible (no redundant writes, and an
 *     admin's manual mark stands).
 *   - Only marks IDs we can positively identify as foreign. An unparseable or
 *     ambiguous ID stays untouched so a typo'd NRIC is never silently billed at
 *     full fee — it surfaces to the admin as "awaiting grant" instead.
 *
 * Returns the number of rows marked.
 */
export async function markNonResidentsGrantIneligible(applicationIds: string[]): Promise<number> {
  const ids = Array.from(new Set(applicationIds.filter(Boolean)));
  if (ids.length === 0) return 0;

  const { assessGrantEligibility } = await import('./grantEligibility');

  const candidates = await pool.query(
    `SELECT id, trainee_full_name, trainee_nric, trainee_id_type, trainee_identity_type
       FROM public.company_application
      WHERE id = ANY($1::uuid[])
        AND COALESCE(grant_ineligible, false) = false
        AND COALESCE(grant_id, '') = ''`,
    [ids]
  );
  if (candidates.rows.length === 0) return 0;

  const toMark: string[] = [];
  for (const row of candidates.rows) {
    const verdict = assessGrantEligibility({
      nric: row.trainee_nric,
      idType: row.trainee_id_type,
      identityType: row.trainee_identity_type,
    });
    if (verdict.status !== 'ineligible') continue;
    toMark.push(String(row.id));
    console.log(
      `[grant-eligibility] ${String(row.trainee_full_name || '').trim() || row.id}: not grant eligible — ${verdict.reason}`
    );
  }
  if (toMark.length === 0) return 0;

  await pool.query(
    `UPDATE public.company_application
        SET grant_ineligible = true,
            updated_at = now()
      WHERE id = ANY($1::uuid[])`,
    [toMark]
  );
  console.log(
    `[grant-eligibility] marked ${toMark.length} learner(s) Not Grant Eligible (not a Singapore Citizen or PR) — they will be billed at the full course fee`
  );
  return toMark.length;
}
