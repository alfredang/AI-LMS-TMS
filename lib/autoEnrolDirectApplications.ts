/**
 * Auto-Enrol Direct Applications pipeline.
 *
 * Runs the end-to-end flow for a direct application row:
 *   1. Load row from da_application (skip if not in "Confirm application" state)
 *   2. Submit SSG enrolment via /tpg/enrolments → save enrolment_id
 *   3. Search SSG grants by enrolment reference → save grant_id (non-fatal)
 *   3b. Refresh grants into ssg_grants (BL + Non-BL for invoices / FMS; non-fatal)
 *   4. (If enabled) Create QuickBooks invoice → save invoice_id
 *   5. (If enabled) Send invoice email (non-fatal)
 *   6. Add learner email to matching Google Calendar event (non-fatal)
 *
 * Called from:
 *   - pages/api/admin/upload-da-applications.ts (fire-and-forget after upload)
 *   - pages/api/admin/auto-enrol-direct-applications.ts (manual batch / retry)
 */

import crypto from 'crypto';
import pool from './db';
import { getSSGCredentialsService } from './ssg/services/credentials-service';
import { HttpClient, HTTPRequestBuilder, HttpMethod } from './ssg/utils/http-utils';
import { getTrainingPartnerIdentifiers } from './trainingPartnerIdentifiers';
import { buildEnrolmentPayload } from './ssg/buildEnrolmentPayload';
import { searchEnrolment } from './ssg/services/enrolment-service';
import {
  createDirectApplicationInvoice,
  type DaApplicationForInvoice,
} from './quickbooks/createDirectApplicationInvoice';
import {
  buildDaGrantInvoicePdfFileName,
  createDirectApplicationGrantInvoice,
} from './quickbooks/createDirectApplicationGrantInvoice';
import {
  buildDaSfcInvoicePdfFileName,
  createDirectApplicationSfcInvoice,
} from './quickbooks/createDirectApplicationSfcInvoice';
import { buildPurchaseOrderInvoiceFields } from './quickbooks/directApplicationInvoiceFields';
import { refreshGrantsForEnrolments } from './services/billingSync';
import { loadSplitGrantDeductionsFromDb } from './services/daInvoiceGrantLines';
import { driveFileExists, uploadInvoicePdfToDrive } from './services/invoiceDriveUpload';
import { ensureInvoiceJobsTable } from './services/invoiceJobs';
import { qboFetchInvoicePdf, qboReadInvoice, qboSendInvoice, qboSparseUpdateInvoice } from './services/qboInvoiceService';
import { shouldSendQboInvoiceEmailFromQuickBooks } from './services/qboInvoiceEmailPolicy';
import { toDateOnlyIso } from './utils/dateOnly';
import { google } from 'googleapis';
import { getGoogleCredentials } from './google-auth/googleAuth';
import { calendarWritesAllowed } from './calendar/calendarGuard';
import { getLocalYMD } from './dateHelpers';

export type AutoEnrolStatus =
  | 'pending'
  | 'pending_identity'
  | 'enroled'
  | 'grant_found'
  | 'invoiced'
  | 'failed';

export interface DaPipelineResult {
  id: string;
  applicationId: string;
  success: boolean;
  finalStatus: AutoEnrolStatus;
  enrolmentId?: string;
  grantId?: string;
  invoiceId?: string;
  error?: string;
  failedStep?: string;
}

const IV = Buffer.from('SSGAPIInitVector', 'utf8');
const BATCH_SIZE = 5;

function buildDaInvoicePdfFileName(docNumber: string | null | undefined, invoiceId: string): string {
  const raw = String(docNumber || invoiceId || '').trim() || 'invoice';
  return `DA_QB_invoice_${raw}`;
}

function hasIdentifier(value: unknown): value is string {
  return typeof value === 'string' && value.trim() !== '';
}

function isManualMarker(value: unknown): boolean {
  return String(value || '').trim().toUpperCase() === 'MANUAL';
}

function hasRealInvoiceId(value: unknown): value is string {
  return hasIdentifier(value) && !isManualMarker(value);
}

function toMoney(value: unknown): number {
  if (typeof value === 'number') return Number.isFinite(value) ? value : 0;
  if (typeof value === 'string') {
    const parsed = parseFloat(value);
    return Number.isFinite(parsed) ? parsed : 0;
  }
  return 0;
}

function isQboObjectNotFoundError(err: unknown): boolean {
  const message = err instanceof Error ? err.message : String(err || '');
  return /\bObject Not Found\b/i.test(message) || /\(code 610\)/i.test(message) || /\berror 610\b/i.test(message);
}

function isRealSsgEnrolmentId(value: unknown): value is string {
  return /^ENR-/i.test(String(value || '').trim());
}

function isMainInvoiceDocNumber(value: unknown): value is string {
  return /^TC\d{2}-\d{4}-\d{6}$/i.test(String(value || '').trim());
}

async function ensureQboInvoicePurchaseOrder(
  invoiceId: string,
  desiredPoNumber: string | null | undefined,
  label: 'grant' | 'sfc'
): Promise<void> {
  const desiredPo = String(desiredPoNumber || '').trim();
  if (!invoiceId || !desiredPo) return;

  const invoice = await qboReadInvoice(undefined, invoiceId);
  if (!invoice.syncToken) {
    throw new Error(`Cannot update ${label} invoice ${invoiceId} PO#: QuickBooks did not return a SyncToken`);
  }

  await qboSparseUpdateInvoice(
    undefined,
    invoiceId,
    invoice.syncToken,
    await buildPurchaseOrderInvoiceFields(desiredPo, invoice.raw)
  );
  console.log(`[QBO ${label} invoice] Set PO# ${desiredPo} on invoice ${invoiceId}`);
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

async function updateRow(
  id: string,
  fields: Record<string, string | boolean | null>
): Promise<void> {
  const keys = Object.keys(fields);
  if (keys.length === 0) return;
  const setClause = keys.map((k, i) => `${k} = $${i + 2}`).join(', ');
  await pool.query(
    `UPDATE da_application SET ${setClause}, updated_at = NOW() WHERE id = $1`,
    [id, ...keys.map(k => fields[k])]
  );
}

async function markFailed(
  id: string,
  step: string,
  err: unknown
): Promise<void> {
  const message = err instanceof Error ? err.message : String(err);
  await updateRow(id, {
    auto_enrol_status: 'failed',
    auto_enrol_error: `${step}: ${message}`.slice(0, 1000),
  });
}

async function createNativeEnrolmentForPipeline(appId: string): Promise<void> {
  const updatedRowRes = await pool.query(`SELECT * FROM da_application WHERE id = $1`, [appId]);
  if (updatedRowRes.rows[0]) {
    await createNativeEnrolmentFromDA(updatedRowRes.rows[0], pool);
  }
}

async function syncDaMainInvoiceToBillingHistory(appId: string): Promise<void> {
  await ensureInvoiceJobsTable();

  const result = await pool.query(
    `SELECT
        da.enrolment_id,
        da.trainee_email,
        da.course_reference_number,
        da.invoice_id,
        da.invoice_doc_number,
        da.invoice_drive_file_id,
        da.invoice_drive_web_view_link,
        da.trainee_id,
        da.trainee_name,
        e.user_id AS user_id,
        COALESCE(c.course_code, da.course_reference_number) AS course_code
     FROM da_application da
     LEFT JOIN app_user u
       ON LOWER(TRIM(u.email::text)) = LOWER(TRIM(da.trainee_email::text))
       OR LOWER(TRIM(COALESCE(u.secondary_email::text, ''))) = LOWER(TRIM(da.trainee_email::text))
     LEFT JOIN course_run cr
       ON cr.id::text = da.course_run_id::text
       OR cr.course_run_id::text = da.course_run_id::text
     LEFT JOIN course c ON c.id = cr.course_id
     LEFT JOIN enrollment e
       ON e.user_id = u.id
      AND e.course_run_id = cr.id
     WHERE da.id = $1
     ORDER BY e.updated_at DESC NULLS LAST
     LIMIT 1`,
    [appId]
  );

  const row = result.rows[0];
  if (!row?.enrolment_id || !isRealSsgEnrolmentId(row.enrolment_id) || !hasRealInvoiceId(row.invoice_id)) {
    return;
  }

  let learnerUserId = row.user_id || null;
  if (!learnerUserId && row.trainee_email) {
    const email = String(row.trainee_email).trim().toLowerCase();
    const existingUser = await pool.query(
      `SELECT id
         FROM app_user
        WHERE LOWER(TRIM(email::text)) = LOWER(TRIM($1::text))
           OR LOWER(TRIM(COALESCE(secondary_email::text, ''))) = LOWER(TRIM($1::text))
        ORDER BY updated_at DESC NULLS LAST
        LIMIT 1`,
      [email]
    );

    learnerUserId = existingUser.rows[0]?.id || null;
    if (!learnerUserId) {
      const createdUser = await pool.query(
        `INSERT INTO app_user (id, email, full_name, password_hash, account_status, created_at, updated_at)
         VALUES (gen_random_uuid(), $1, $2, '', 'active', NOW(), NOW())
         RETURNING id`,
        [email, row.trainee_name || email]
      );
      learnerUserId = createdUser.rows[0]?.id || null;
    }

    if (learnerUserId) {
      await pool.query(
        `INSERT INTO user_role_map (user_id, role)
         VALUES ($1, 'Learner')
         ON CONFLICT DO NOTHING`,
        [learnerUserId]
      );
      await pool.query(
        `INSERT INTO learner_profile (user_id, nric, tel)
         VALUES ($1, $2, '')
         ON CONFLICT (user_id) DO UPDATE SET
           nric = COALESCE(learner_profile.nric, EXCLUDED.nric)`,
        [learnerUserId, row.trainee_id || null]
      );
    }
  }

  if (!learnerUserId || !row.trainee_email || !row.course_code) {
    const missing = [
      !learnerUserId && 'learner user account',
      !row.trainee_email && 'trainee_email',
      !row.course_code && 'course_code',
    ].filter(Boolean).join(', ');
    throw new Error(`Cannot sync invoice to learner billing history: missing ${missing}`);
  }

  await pool.query(
    `INSERT INTO public.invoice_jobs (
        batch_id,
        status,
        enrolment_id,
        user_id,
        learner_email,
        course_code,
        attempts,
        qbo_invoice_id,
        qbo_doc_number,
        invoice_no,
        drive_file_id,
        drive_web_view_link,
        last_attempt_at,
        updated_at
     )
     VALUES (
        'direct_application',
        'done',
        $1,
        $2,
        $3,
        $4,
        1,
        $5,
        $6,
        $6,
        $7,
        $8,
        now(),
        now()
     )
     ON CONFLICT (enrolment_id) DO UPDATE SET
       batch_id = COALESCE(public.invoice_jobs.batch_id, EXCLUDED.batch_id),
       status = 'done',
       user_id = EXCLUDED.user_id,
       learner_email = EXCLUDED.learner_email,
       course_code = EXCLUDED.course_code,
       attempts = GREATEST(public.invoice_jobs.attempts, 1),
       last_error = NULL,
       qbo_invoice_id = EXCLUDED.qbo_invoice_id,
       qbo_doc_number = EXCLUDED.qbo_doc_number,
       invoice_no = COALESCE(public.invoice_jobs.invoice_no, EXCLUDED.invoice_no),
       drive_file_id = EXCLUDED.drive_file_id,
       drive_web_view_link = EXCLUDED.drive_web_view_link,
       last_attempt_at = now(),
       updated_at = now()`,
    [
      String(row.enrolment_id).trim(),
      learnerUserId,
      String(row.trainee_email).trim(),
      String(row.course_code).trim(),
      String(row.invoice_id).trim(),
      row.invoice_doc_number ? String(row.invoice_doc_number).trim() : null,
      row.invoice_drive_file_id || null,
      row.invoice_drive_web_view_link || null,
    ]
  );
}

interface SsgCredentialLike {
  encryptionKey: string;
  certificateContent?: string;
  privateKeyContent?: string;
  uen?: string;
  ssgApiBaseUrl?: string;
}

interface SSGContext {
  encKey: Buffer;
  ssgBaseUrl: string;
  httpClient: HttpClient;
  credentials: SsgCredentialLike;
  uen: string;
  tpCode: string;
}

async function loadSsgContext(): Promise<SSGContext> {
  const credentials = await getSSGCredentialsService().getSSGCredentials();
  if (!credentials) {
    throw new Error('SSG credentials not configured');
  }
  const ssgBaseUrl = credentials.ssgApiBaseUrl || process.env.SSG_API_URL || 'https://api.ssg-wsg.sg';
  const encKey = Buffer.from(credentials.encryptionKey, 'base64');
  const tp = await getTrainingPartnerIdentifiers();
  const httpClient = new HttpClient(ssgBaseUrl, {
    'Content-Type': 'application/json',
    'Accept': 'application/json',
  });
  return {
    encKey,
    ssgBaseUrl,
    httpClient,
    credentials,
    uen: credentials.uen || tp.uen,
    tpCode: tp.code,
  };
}

async function ssgEncryptedPost(
  ctx: SSGContext,
  path: string,
  payload: unknown
): Promise<any> {
  const cipher = crypto.createCipheriv('aes-256-cbc', ctx.encKey, IV);
  let encrypted = cipher.update(JSON.stringify(payload), 'utf8', 'base64');
  encrypted += cipher.final('base64');

  const builder = new HTTPRequestBuilder()
    .withEndpoint(ctx.ssgBaseUrl, path)
    .withMethod(HttpMethod.POST)
    .withBody(encrypted);

  if (ctx.credentials?.certificateContent && ctx.credentials?.privateKeyContent) {
    builder.withCertificate(ctx.credentials.certificateContent, ctx.credentials.privateKeyContent);
  }

  const httpResponse = await ctx.httpClient.request(builder.build());

  const isError = httpResponse.status !== 200 && httpResponse.status !== 201 && httpResponse.status !== 400;
  if (isError) {
    throw new Error(`SSG ${path} returned ${httpResponse.status}`);
  }

  let rawBody = '';
  if (httpResponse.data) {
    rawBody = typeof httpResponse.data === 'string'
      ? httpResponse.data
      : JSON.stringify(httpResponse.data);
  } else if (httpResponse.status === 400) {
    throw new Error(`SSG ${path} returned 400 with no body`);
  }

  if (rawBody && rawBody.trim() !== '') {
    try {
      // Handle wrapped error JSON from SSG Gateway (common on 400 errors)
      let toDecrypt = rawBody;
      if (rawBody.startsWith('{')) {
        try {
          const parsed = JSON.parse(rawBody);
          if (parsed.error && typeof parsed.error === 'string') {
            toDecrypt = parsed.error;
          }
        } catch { /* not valid JSON, treat as raw */ }
      }

      const decipher = crypto.createDecipheriv('aes-256-cbc', ctx.encKey, IV);
      let decrypted = decipher.update(toDecrypt, 'base64', 'utf8');
      decrypted += decipher.final('utf8');
      return JSON.parse(decrypted);
    } catch (err) {
      if (httpResponse.status === 400) {
        throw new Error(`SSG ${path} returned 400 (failed to decrypt body: ${err instanceof Error ? err.message : 'Unknown error'})`);
      }
      // If it's a 200/201 but decryption fails
      throw new Error(`Failed to decrypt SSG response: ${err instanceof Error ? err.message : 'Unknown error'}`);
    }
  }

  if (httpResponse.status === 400) {
    throw new Error(`SSG ${path} returned 400 with empty body`);
  }

  return {};
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

async function callInvoiceSend(invoiceId: string, email: string): Promise<void> {
  await qboSendInvoice(undefined, invoiceId, email);
}

// ---------------------------------------------------------------------------
// Google Calendar: add learner email to matching event
// ---------------------------------------------------------------------------

function stripCalendarPrefixes(title: string): string {
  return (title || '')
    .replace(/^\s*\[?(WSQ|VIRTUAL|EXTERNAL|HYBRID)\]?\s*/gi, '')
    .replace(/^\s*\[?(WSQ|VIRTUAL|EXTERNAL|HYBRID)\]?\s*/gi, '')
    .trim();
}

async function addLearnerToCalendarEvent(
  learnerEmail: string,
  courseTitle: string,
  courseStartDate: string | Date | null
): Promise<boolean> {
  if (!learnerEmail || !courseTitle) return false;

  const tpRes = await pool.query(
    `SELECT sync_google_calendar, google_calendar_url FROM training_provider LIMIT 1`
  );
  const tpRow = tpRes.rows[0];
  if (!tpRow?.sync_google_calendar || !calendarWritesAllowed()) {
    console.log(`📅 [calendar-attendee] sync_google_calendar is off — skipping`);
    return false;
  }

  // Verify the application is still active (not cancelled)
  const activeAppRes = await pool.query(
    `SELECT application_status FROM da_application 
     WHERE LOWER(trainee_email) = LOWER($1) 
       AND LOWER(course_title) = LOWER($2)
       AND LOWER(application_status) IN ('confirmed', 'confirm application')
     LIMIT 1`,
    [learnerEmail, courseTitle]
  );
  if (activeAppRes.rows.length === 0) {
    console.log(`📅 [calendar-attendee] No active application for ${learnerEmail} in ${courseTitle} — skipping add`);
    return false;
  }

  const credentials = await getGoogleCredentials(pool);

  let calendarId = 'primary';
  const calUrl = tpRow.google_calendar_url || '';
  if (calUrl) {
    const cidMatch = calUrl.match(/[?&]cid=([^&]+)/);
    if (cidMatch) {
      try {
        calendarId = Buffer.from(cidMatch[1], 'base64').toString('utf-8');
      } catch {
        calendarId = cidMatch[1];
      }
    } else if (calUrl.includes('@')) {
      calendarId = calUrl;
    }
  }

  const oauth2Client = new google.auth.OAuth2(
    credentials.clientId,
    credentials.clientSecret,
    'https://developers.google.com/oauthplayground'
  );
  oauth2Client.setCredentials({ refresh_token: credentials.refreshToken });
  const calendar = google.calendar({ version: 'v3', auth: oauth2Client });

  let startDateIso: string;
  if (!courseStartDate) return false;
  if (courseStartDate instanceof Date) {
    startDateIso = getLocalYMD(courseStartDate);
  } else {
    startDateIso = String(courseStartDate).slice(0, 10);
  }

  const dayBefore = new Date(startDateIso);
  dayBefore.setDate(dayBefore.getDate() - 1);
  const dayAfter = new Date(startDateIso);
  dayAfter.setDate(dayAfter.getDate() + 2);

  const eventsResponse = await calendar.events.list({
    calendarId,
    timeMin: dayBefore.toISOString(),
    timeMax: dayAfter.toISOString(),
    singleEvents: true,
    maxResults: 200,
  });

  const events = eventsResponse.data.items || [];
  const strippedCourseTitle = stripCalendarPrefixes(courseTitle).toLowerCase();

  const matchedEvent = events.find(evt => {
    const evtSummary = stripCalendarPrefixes(evt.summary || '').toLowerCase();
    const titleMatch =
      evtSummary.includes(strippedCourseTitle) ||
      strippedCourseTitle.includes(evtSummary);
    if (!titleMatch) return false;
    const evtDate = (evt.start?.dateTime?.slice(0, 10) || evt.start?.date || '');
    return evtDate === startDateIso;
  });

  if (!matchedEvent || !matchedEvent.id) {
    console.log(`📅 [calendar-attendee] No matching event for "${courseTitle}" on ${startDateIso} — skipping`);
    return false;
  }

  const existingAttendees = matchedEvent.attendees || [];
  const emailLower = learnerEmail.trim().toLowerCase();
  if (existingAttendees.some(a => (a.email || '').toLowerCase() === emailLower)) {
    console.log(`📅 [calendar-attendee] ${learnerEmail} already in event "${matchedEvent.summary}" — no-op`);
    return true;
  }

  await calendar.events.patch({
    calendarId,
    eventId: matchedEvent.id,
    requestBody: {
      attendees: [
        ...existingAttendees,
        { email: learnerEmail, responseStatus: 'needsAction' },
      ],
    },
    sendUpdates: 'none',
  });

  console.log(`📅 [calendar-attendee] Added ${learnerEmail} to event "${matchedEvent.summary}" (${matchedEvent.id})`);
  return true;
}

/**
 * Add a trainer to ALL calendar events for a course run.
 *
 * Strategy: find the first event by title + date (same as addLearnerToCalendarEvent),
 * extract the recurring event base ID, then fetch all sibling events with the same
 * base ID and patch them all.
 *
 * Falls back to single-event patch if no recurring base ID found.
 */
export async function addTrainerToCalendarEvent(
  trainerEmail: string,
  courseTitle: string,
  courseStartDate: string | Date | null
): Promise<{ found: number; added: number }> {
  const result = { found: 0, added: 0 };
  if (!trainerEmail || !courseTitle) return result;

  const tpRes = await pool.query(
    `SELECT sync_google_calendar, google_calendar_url FROM training_provider LIMIT 1`
  );
  const tpRow = tpRes.rows[0];
  if (!tpRow?.sync_google_calendar || !calendarWritesAllowed()) return result;

  const credentials = await getGoogleCredentials(pool);

  let calendarId = 'primary';
  const calUrl = tpRow.google_calendar_url || '';
  if (calUrl) {
    const cidMatch = calUrl.match(/[?&]cid=([^&]+)/);
    if (cidMatch) {
      try { calendarId = Buffer.from(cidMatch[1], 'base64').toString('utf-8'); }
      catch { calendarId = cidMatch[1]; }
    } else if (calUrl.includes('@')) { calendarId = calUrl; }
  }

  const oauth2Client = new google.auth.OAuth2(
    credentials.clientId,
    credentials.clientSecret,
    'https://developers.google.com/oauthplayground'
  );
  oauth2Client.setCredentials({ refresh_token: credentials.refreshToken });
  const calendar = google.calendar({ version: 'v3', auth: oauth2Client });

  // Step 1: Find first event by title + date (same logic as addLearnerToCalendarEvent)
  let startDateIso: string;
  if (!courseStartDate) return result;
  if (courseStartDate instanceof Date) {
    startDateIso = getLocalYMD(courseStartDate);
  } else {
    startDateIso = String(courseStartDate).slice(0, 10);
  }

  const dayBefore = new Date(startDateIso);
  dayBefore.setDate(dayBefore.getDate() - 1);
  const dayAfter = new Date(startDateIso);
  dayAfter.setDate(dayAfter.getDate() + 2);

  const firstSearch = await calendar.events.list({
    calendarId,
    timeMin: dayBefore.toISOString(),
    timeMax: dayAfter.toISOString(),
    singleEvents: true,
    maxResults: 200,
  });

  const strippedCourseTitle = stripCalendarPrefixes(courseTitle).toLowerCase();
  const matchedEvent = (firstSearch.data.items || []).find(evt => {
    const evtSummary = stripCalendarPrefixes(evt.summary || '').toLowerCase();
    const titleMatch = evtSummary.includes(strippedCourseTitle) || strippedCourseTitle.includes(evtSummary);
    if (!titleMatch) return false;
    const evtDate = (evt.start?.dateTime?.slice(0, 10) || evt.start?.date || '');
    return evtDate === startDateIso;
  });

  if (!matchedEvent || !matchedEvent.id) {
    console.log(`📅 [addTrainerToCalendar] No matching event for "${courseTitle}" on ${startDateIso}`);
    return result;
  }

  // Step 2: Extract recurring base ID
  // Google event IDs for recurring instances: "baseId_20260415T013000Z"
  // Non-recurring events just have a plain ID with no underscore+timestamp
  const baseId = matchedEvent.id.includes('_')
    ? matchedEvent.id.split('_')[0]
    : null;

  let eventsToUpdate: Array<{ id: string; attendees: any[] }> = [];

  if (baseId) {
    // Fetch all events in a wide range to find all siblings
    const wideStart = new Date(startDateIso);
    wideStart.setDate(wideStart.getDate() - 7);
    const wideEnd = new Date(startDateIso);
    wideEnd.setDate(wideEnd.getDate() + 60); // up to 2 months ahead

    const allEvents = await calendar.events.list({
      calendarId,
      timeMin: wideStart.toISOString(),
      timeMax: wideEnd.toISOString(),
      singleEvents: true,
      maxResults: 2500,
    });

    // Find all events sharing the same base ID
    eventsToUpdate = (allEvents.data.items || [])
      .filter(evt => evt.id && evt.id.startsWith(baseId + '_'))
      .map(evt => ({ id: evt.id!, attendees: evt.attendees || [] }));

    console.log(`📅 [addTrainerToCalendar] Found ${eventsToUpdate.length} recurring events with base ID ${baseId}`);
  }

  // Fallback: if no recurring ID or no siblings found, just patch the single matched event
  if (eventsToUpdate.length === 0) {
    eventsToUpdate = [{ id: matchedEvent.id, attendees: matchedEvent.attendees || [] }];
  }

  result.found = eventsToUpdate.length;
  const emailLower = trainerEmail.trim().toLowerCase();

  // Step 3: Patch all events
  for (const evt of eventsToUpdate) {
    const alreadyPresent = evt.attendees.some(a => (a.email || '').toLowerCase() === emailLower);
    if (alreadyPresent) {
      result.added++;
      continue;
    }

    try {
      await calendar.events.patch({
        calendarId,
        eventId: evt.id,
        requestBody: {
          attendees: [
            ...evt.attendees,
            { email: trainerEmail, responseStatus: 'needsAction' },
          ],
        },
        sendUpdates: 'none',
      });
      result.added++;
    } catch (err) {
      console.error(`❌ [addTrainerToCalendar] Patch failed for event ${evt.id}:`, err);
    }
  }

  console.log(`📅 [addTrainerToCalendar] Added ${trainerEmail} to ${result.added}/${result.found} events for "${courseTitle}"`);
  return result;
}

// ---------------------------------------------------------------------------
// Single-row pipeline
// ---------------------------------------------------------------------------

export async function processDirectApplication(
  appId: string,
  sharedCtx?: SSGContext,
  options?: { forceInvoice?: boolean; suppressInvoiceEmail?: boolean; sendInvoiceEmail?: boolean }
): Promise<DaPipelineResult> {
  const rowRes = await pool.query(
    `SELECT
        da.*,
        sg.bl_grant_id,
        sg.bl_amount,
        sg.other_grant_id,
        sg.other_scheme_code,
        sg.other_amount,
        sg.tg_amount
     FROM da_application da
     LEFT JOIN (
        SELECT
            LOWER(TRIM(enrollment_id)) AS enrolment_key,
            MAX(CASE WHEN UPPER(COALESCE(funding_scheme_code,'')) IN ('BL','BASELINE')
                     OR  UPPER(COALESCE(funding_scheme_code,'')) LIKE '%BASELINE%'
                THEN grant_id END) AS bl_grant_id,
            MAX(CASE WHEN UPPER(COALESCE(funding_scheme_code,'')) IN ('BL','BASELINE')
                     OR  UPPER(COALESCE(funding_scheme_code,'')) LIKE '%BASELINE%'
                THEN CASE WHEN COALESCE(approved_grant_amount,0) > 0 THEN approved_grant_amount
                          ELSE COALESCE(estimated_grant_amount,0) END END) AS bl_amount,
            MAX(CASE WHEN UPPER(COALESCE(funding_scheme_code,'')) NOT IN ('BL','BASELINE')
                     AND UPPER(COALESCE(funding_scheme_code,'')) NOT LIKE '%BASELINE%'
                     AND funding_scheme_code IS NOT NULL
                THEN grant_id END) AS other_grant_id,
            MAX(CASE WHEN UPPER(COALESCE(funding_scheme_code,'')) NOT IN ('BL','BASELINE')
                     AND UPPER(COALESCE(funding_scheme_code,'')) NOT LIKE '%BASELINE%'
                     AND funding_scheme_code IS NOT NULL
                THEN funding_scheme_code END) AS other_scheme_code,
            MAX(CASE WHEN UPPER(COALESCE(funding_scheme_code,'')) NOT IN ('BL','BASELINE')
                     AND UPPER(COALESCE(funding_scheme_code,'')) NOT LIKE '%BASELINE%'
                     AND funding_scheme_code IS NOT NULL
                THEN CASE WHEN COALESCE(approved_grant_amount,0) > 0 THEN approved_grant_amount
                          ELSE COALESCE(estimated_grant_amount,0) END END) AS other_amount,
            SUM(CASE WHEN COALESCE(approved_grant_amount,0) > 0 THEN approved_grant_amount
                     ELSE COALESCE(estimated_grant_amount,0) END) AS tg_amount
        FROM ssg_grants
        GROUP BY LOWER(TRIM(enrollment_id))
     ) sg ON sg.enrolment_key = LOWER(TRIM(da.enrolment_id))
     WHERE da.id = $1`,
    [appId]
  );
  const row = rowRes.rows[0];
  if (!row) {
    return {
      id: appId,
      applicationId: '',
      success: false,
      finalStatus: 'failed',
      error: 'row not found',
      failedStep: 'load',
    };
  }

  const applicationId: string = row.application_id || '';

  const currentStatus = (row.application_status || '').toLowerCase();
  if (currentStatus !== 'confirm application' && currentStatus !== 'confirmed' && !options?.forceInvoice) {
    return {
      id: appId,
      applicationId,
      success: false,
      finalStatus: (row.auto_enrol_status as AutoEnrolStatus) || 'pending',
      error: `skipped: application_status is ${row.application_status}`,
      failedStep: 'load',
    };
  }

  if (!hasIdentifier(row.trainee_id) && !options?.forceInvoice) {
    const error = 'identity: Missing trainee ID/NRIC for SSG enrolment';
    await updateRow(appId, {
      auto_enrol_status: 'pending_identity',
      auto_enrol_error: error,
    });
    return {
      id: appId,
      applicationId,
      success: false,
      finalStatus: 'pending_identity',
      error,
      failedStep: 'identity',
    };
  }

  const tpRes = await pool.query(
    `SELECT auto_generate_qb_invoice, auto_add_learner_to_calendar, auto_send_invoice_email FROM training_provider LIMIT 1`
  );
  const autoInvoice: boolean = !!tpRes.rows[0]?.auto_generate_qb_invoice;
  const autoCalendar: boolean = !!tpRes.rows[0]?.auto_add_learner_to_calendar;
  const autoSendInvoiceEmail: boolean = !!tpRes.rows[0]?.auto_send_invoice_email;

  await updateRow(appId, { auto_enrol_status: 'pending', auto_enrol_error: null });

  // Step 1: SSG enrolment (skip if already enrolled)
  let enrolmentReference: string | null = row.enrolment_id || null;
  if (!enrolmentReference) {
    try {
      const ctx = sharedCtx || (await loadSsgContext());
      const payload = buildEnrolmentPayload(row, ctx.uen, ctx.tpCode);
      const parsed = await ssgEncryptedPost(ctx, '/tpg/enrolments', payload);
      console.log(`📦 auto-enrol [${applicationId}]:`, JSON.stringify(parsed));

      const errMsg = hasSsgError(parsed);
      if (errMsg) {
        if (errMsg.toLowerCase().includes('duplicate')) {
          console.log(`ℹ️  auto-enrol [${applicationId}]: Duplicate detected in SSG, searching for existing enrolment...`);
          const p = payload as any;
          const searchPayload = {
            enrolment: {
              course: p.enrolment.course,
              trainee: p.enrolment.trainee,
              trainingPartner: p.enrolment.trainingPartner
            },
            parameters: { page: 0, pageSize: 10 }
          };

          const searchResult = await searchEnrolment(searchPayload as any);
          if (searchResult.success && searchResult.referenceNumber) {
            console.log(`✅ auto-enrol [${applicationId}]: Recovered duplicate enrolment reference: ${searchResult.referenceNumber}`);
            enrolmentReference = searchResult.referenceNumber;
          } else {
            throw new Error(`Duplicate record found, but search failed to recover reference`);
          }
        } else {
          throw new Error(errMsg);
        }
      } else {
        enrolmentReference = extractEnrolmentReference(parsed);
      }

      if (!enrolmentReference) {
        throw new Error('no enrolment reference in SSG response');
      }

      await updateRow(appId, {
        enrolment_id: enrolmentReference,
        enrolment_status: 'Confirmed',
        auto_enrol_status: 'enroled',
      });
    } catch (err) {
      await markFailed(appId, 'enrolment', err);
      return {
        id: appId,
        applicationId,
        success: false,
        finalStatus: 'failed',
        error: err instanceof Error ? err.message : String(err),
        failedStep: 'enrolment',
      };
    }
  } else {
    console.log(`ℹ️  auto-enrol [${applicationId}] enrolment already exists: ${enrolmentReference}`);
  }

  // Step 2: Grant search (skip if already found; non-fatal)
  let grantId: string | null = row.grant_id || null;
  if (!grantId) {
    try {
      const ctx = sharedCtx || (await loadSsgContext());
      const grantPayload = {
        grants: {
          enrolment: { referenceNumber: enrolmentReference },
          trainingPartner: { uen: ctx.uen, code: ctx.tpCode },
        },
        parameters: { page: 0, pageSize: 10 },
      };
      const parsed = await ssgEncryptedPost(ctx, '/tpg/grants/search', grantPayload);
      const errMsg = hasSsgError(parsed);
      if (errMsg) {
        console.warn(`⚠️  auto-enrol [${applicationId}] grant search warning:`, errMsg);
      } else {
        const grants = Array.isArray(parsed?.data) ? parsed.data : [];
        console.log(`📋 auto-enrol [${applicationId}] grant search returned ${grants.length} record(s):`, JSON.stringify(grants));
        const first = grants[0] ?? null;
        grantId = first?.referenceNumber || null;
        if (grantId) {
          await updateRow(appId, {
            grant_id: grantId,
            auto_enrol_status: 'grant_found',
          });
        } else {
          console.log(`ℹ️  auto-enrol [${applicationId}] grant not yet available — SSG has not created a grant for enrolment ${enrolmentReference} yet`);
        }
      }
    } catch (err) {
      console.warn(
        `⚠️  auto-enrol [${applicationId}] grant search failed (non-fatal):`,
        err instanceof Error ? err.message : err
      );
    }
  } else {
    console.log(`ℹ️  auto-enrol [${applicationId}] grant already exists: ${grantId}`);
  }

  if (enrolmentReference) {
    try {
      await refreshGrantsForEnrolments([enrolmentReference]);
    } catch (err) {
      console.warn(
        `⚠️  auto-enrol [${applicationId}] refreshGrantsForEnrolments (non-fatal):`,
        err instanceof Error ? err.message : err
      );
    }
  }

  // Step 3: QuickBooks invoice
  if (!autoInvoice && !options?.forceInvoice) {
    if (autoCalendar && row.trainee_email) {
      try {
        const calAdded = await addLearnerToCalendarEvent(row.trainee_email, row.course_title || '', row.course_start_date);
        if (calAdded) await updateRow(appId, { calendar_added: true });
      } catch (err) {
        console.warn(`⚠️  auto-enrol [${applicationId}] calendar attendee failed (non-fatal):`, err instanceof Error ? err.message : err);
      }
    }
    try {
      await createNativeEnrolmentForPipeline(appId);
    } catch (err) {
      console.warn(
        `⚠️  auto-enrol [${applicationId}] native enrolment creation failed (non-fatal):`,
        err instanceof Error ? err.message : err
      );
    }
    return {
      id: appId,
      applicationId,
      success: true,
      finalStatus: grantId ? 'grant_found' : 'enroled',
      enrolmentId: enrolmentReference,
      grantId: grantId || undefined,
    };
  }

  let invoiceId: string | null = hasRealInvoiceId(row.invoice_id) ? row.invoice_id : null;
  // Prefer the cached DocNumber on the DA row — avoids a qboReadInvoice hop on
  // every re-run and is reliable enough that pipeline steps depending on it
  // (supplemental grant/SFC PO#, Drive filename) don't need to fall back to
  // QBO. Set at create time below; older rows may be null and will be
  // backfilled via the lookup block further down.
  let invoiceDocNumber: string | null = row.invoice_doc_number || null;
  if (!invoiceDocNumber && isMainInvoiceDocNumber(invoiceId)) {
    invoiceDocNumber = String(invoiceId).trim();
  }
  // Track the QB customer ref across the pipeline — `row` is an in-memory
  // snapshot and doesn't pick up the UPDATE we issue after the main invoice
  // create, so the supplemental grant/SFC steps need this local copy.
  let customerRef: string | null = row.qb_customer_ref || null;
  let mainInvoiceDriveFileId: string | null = row.invoice_drive_file_id || null;
  try {
    if (invoiceId) {
      try {
        await qboReadInvoice(undefined, invoiceId);
      } catch (err) {
        if (!isQboObjectNotFoundError(err)) throw err;
        console.warn(
          `auto-enrol [${applicationId}] main invoice id ${invoiceId} is stale in QBO; clearing and regenerating`
        );
        invoiceId = null;
        invoiceDocNumber = null;
        mainInvoiceDriveFileId = null;
        await updateRow(appId, {
          invoice_id: null,
          invoice_doc_number: null,
          invoice_drive_file_id: null,
          invoice_drive_web_view_link: null,
        });
      }
    }

    if (!invoiceId) {
      if (invoiceDocNumber || mainInvoiceDriveFileId || row.invoice_drive_web_view_link) {
        invoiceDocNumber = null;
        mainInvoiceDriveFileId = null;
        await updateRow(appId, {
          invoice_doc_number: null,
          invoice_drive_file_id: null,
          invoice_drive_web_view_link: null,
        });
      }

      const forInvoice: DaApplicationForInvoice & { enrolment_id?: string } = {
        id: row.id,
        trainee_name: row.trainee_name,
        trainee_email: row.trainee_email,
        course_title: row.course_title,
        course_reference_number: row.course_reference_number,
        course_start_date: toDateOnlyIso(row.course_start_date),
        full_course_fee: row.full_course_fee,
        gst: row.gst,
        skillsfuture_subsidy: row.skillsfuture_subsidy,
        skillsfuture_credit: row.skillsfuture_credit,
        qb_customer_ref: row.qb_customer_ref,
        // Add missing fields with fallback to null or appropriate value
        trainee_id: row.trainee_id ?? null,
        course_end_date: toDateOnlyIso(row.course_end_date),
        course_run_id: row.course_run_id ?? null,
        grant_id: grantId ?? null,
        application_id: row.application_id ?? null,
        bl_grant_id: null,
        bl_amount: null,
        other_grant_id: null,
        other_scheme_code: null,
        other_amount: null,
        enrolment_id: enrolmentReference ?? undefined,
      };
      const created = await createDirectApplicationInvoice(forInvoice);
      invoiceId = created.invoiceId;
      invoiceDocNumber = created.docNumber || null;
      customerRef = created.customerRef;
      mainInvoiceDriveFileId = null;

      await updateRow(appId, {
        invoice_id: created.invoiceId,
        invoice_doc_number: invoiceDocNumber,
        qb_customer_ref: created.customerRef,
        auto_enrol_status: 'invoiced',
      });
    } else {
      console.log(`auto-enrol [${applicationId}] reusing existing invoice: ${invoiceId}`);
    }
  } catch (err) {
    await markFailed(appId, 'invoice', err);
    return {
      id: appId,
      applicationId,
      success: false,
      finalStatus: 'failed',
      enrolmentId: enrolmentReference,
      grantId: grantId || undefined,
      error: err instanceof Error ? err.message : String(err),
      failedStep: 'invoice',
    };
  }

  // Upload main invoice PDF to Drive if we haven't yet — or if the previously
  // stored Drive file is missing (deleted/trashed/moved). `driveFileExists`
  // lets the pipeline self-heal stale `invoice_drive_file_id` values.
  const mainDriveFileOk = mainInvoiceDriveFileId
    ? await driveFileExists(mainInvoiceDriveFileId)
    : false;
  if (invoiceId && !mainDriveFileOk) {
    try {
      if (!invoiceDocNumber) {
        const existingInvoice = await qboReadInvoice(undefined, invoiceId);
        invoiceDocNumber = existingInvoice.docNumber || null;
        if (invoiceDocNumber) {
          await updateRow(appId, { invoice_doc_number: invoiceDocNumber });
        }
      }

      const pdf = await qboFetchInvoicePdf(undefined, invoiceId);
      const driveUpload = await uploadInvoicePdfToDrive({
        pdf,
        fileName: buildDaInvoicePdfFileName(invoiceDocNumber, invoiceId),
      });

      await updateRow(appId, {
        invoice_drive_file_id: driveUpload.fileId,
        invoice_drive_web_view_link: driveUpload.webViewLink,
      });
    } catch (err) {
      await markFailed(appId, 'invoice_drive', err);
      return {
        id: appId,
        applicationId,
        success: false,
        finalStatus: 'failed',
        enrolmentId: enrolmentReference,
        grantId: grantId || undefined,
        invoiceId,
        error: err instanceof Error ? err.message : String(err),
        failedStep: 'invoice_drive',
      };
    }
  }

  // Step 4: Send invoice email via QBO proxy (non-fatal; off by default — same as invoice jobs)
  // Only the split grant rows tied to this enrolment should trigger the
  // supplemental Grant invoice. This matches the visible "Grant ID (BL)" and
  // "Grant ID" columns in the admin table, instead of the legacy single
  // da_application.grant_id field.
  const { lines: effectiveGrantLines } = await loadSplitGrantDeductionsFromDb(enrolmentReference);
  const effectiveGrantId = effectiveGrantLines[0]?.grantId?.trim() || '';
  const fallbackGrantId =
    effectiveGrantId ||
    (hasIdentifier(row.bl_grant_id) ? row.bl_grant_id : '') ||
    (hasIdentifier(row.other_grant_id) ? row.other_grant_id : '') ||
    (hasIdentifier(row.grant_id) ? row.grant_id : '');
  const hasVisibleGrantData =
    hasIdentifier(row.bl_grant_id) ||
    toMoney(row.bl_amount) > 0 ||
    hasIdentifier(row.other_grant_id) ||
    hasIdentifier(row.other_scheme_code) ||
    toMoney(row.other_amount) > 0 ||
    toMoney(row.tg_amount) > 0 ||
    (hasIdentifier(row.grant_id) && (toMoney(row.grant_amount) > 0 || toMoney(row.skillsfuture_subsidy) > 0));
  const shouldGenerateGrantInvoice = effectiveGrantLines.length > 0 || hasVisibleGrantData;
  const effectiveSfcClaimId = hasIdentifier(row.skillsfuture_credit_claim_id) ? row.skillsfuture_credit_claim_id : '';
  const shouldGenerateSfcInvoice = hasIdentifier(row.skillsfuture_credit_claim_id) || toMoney(row.skillsfuture_credit) > 0;
  const sfcReferenceId = effectiveSfcClaimId || String(row.application_id || '').trim();
  const supplementalErrors: { step: string; message: string }[] = [];
  let existingGrantInvoiceId = hasIdentifier(row.grant_invoice_id) ? row.grant_invoice_id : '';
  let existingGrantDriveFileId = hasIdentifier(row.grant_invoice_drive_file_id) ? row.grant_invoice_drive_file_id : '';
  let existingSfcInvoiceId = hasIdentifier(row.sfc_invoice_id) ? row.sfc_invoice_id : '';
  let existingSfcDriveFileId = hasIdentifier(row.sfc_invoice_drive_file_id) ? row.sfc_invoice_drive_file_id : '';

  if (shouldGenerateGrantInvoice && existingGrantInvoiceId) {
    try {
      await qboReadInvoice(undefined, existingGrantInvoiceId);
    } catch (err) {
      if (!isQboObjectNotFoundError(err)) throw err;
      console.warn(
        `auto-enrol [${applicationId}] grant invoice id ${existingGrantInvoiceId} is stale in QBO; clearing and regenerating`
      );
      existingGrantInvoiceId = '';
      existingGrantDriveFileId = '';
      await updateRow(appId, {
        grant_invoice_id: null,
        grant_invoice_drive_file_id: null,
        grant_invoice_drive_web_view_link: null,
      });
    }
  }

  if (shouldGenerateSfcInvoice && existingSfcInvoiceId) {
    try {
      await qboReadInvoice(undefined, existingSfcInvoiceId);
    } catch (err) {
      if (!isQboObjectNotFoundError(err)) throw err;
      console.warn(`auto-enrol [${applicationId}] sfc invoice id ${existingSfcInvoiceId} is stale in QBO; clearing and regenerating`);
      existingSfcInvoiceId = '';
      existingSfcDriveFileId = '';
      await updateRow(appId, {
        sfc_invoice_id: null,
        sfc_invoice_drive_file_id: null,
        sfc_invoice_drive_web_view_link: null,
      });
    }
  }

  // Resolve main invoice DocNumber so we can pass it as PO# on the supplemental
  // grant and SFC invoices. Skipped if neither supplemental invoice is needed
  // or if we already know the DocNumber from the create step above.
  if (
    invoiceId &&
    !invoiceDocNumber &&
    (shouldGenerateGrantInvoice || shouldGenerateSfcInvoice)
  ) {
    try {
      const existingInvoice = await qboReadInvoice(undefined, invoiceId);
      invoiceDocNumber = existingInvoice.docNumber || null;
      if (invoiceDocNumber) {
        await updateRow(appId, { invoice_doc_number: invoiceDocNumber });
      }
    } catch (err) {
      await markFailed(appId, 'invoice_lookup', err);
      return {
        id: appId,
        applicationId,
        success: false,
        finalStatus: 'failed',
        enrolmentId: enrolmentReference,
        grantId: grantId || undefined,
        invoiceId,
        error: err instanceof Error ? err.message : String(err),
        failedStep: 'invoice_lookup',
      };
    }
  }

  if ((shouldGenerateGrantInvoice || shouldGenerateSfcInvoice) && !invoiceDocNumber) {
    const err = new Error(
      `Cannot create or update Grant/SFC invoices without the main tax invoice number. ` +
      `Expected a TC invoice number like TC26-0430-119707 for DA application ${applicationId}.`
    );
    await markFailed(appId, 'invoice_lookup', err);
    return {
      id: appId,
      applicationId,
      success: false,
      finalStatus: 'failed',
      enrolmentId: enrolmentReference,
      grantId: grantId || undefined,
      invoiceId: invoiceId || undefined,
      error: err.message,
      failedStep: 'invoice_lookup',
    };
  }

  if (invoiceDocNumber && shouldGenerateGrantInvoice && existingGrantInvoiceId) {
    try {
      await ensureQboInvoicePurchaseOrder(existingGrantInvoiceId, invoiceDocNumber, 'grant');
    } catch (err) {
      await markFailed(appId, 'grant_invoice_po', err);
      supplementalErrors.push({
        step: 'grant_invoice_po',
        message: err instanceof Error ? err.message : String(err),
      });
    }
  }

  if (invoiceDocNumber && shouldGenerateSfcInvoice && existingSfcInvoiceId) {
    try {
      await ensureQboInvoicePurchaseOrder(existingSfcInvoiceId, invoiceDocNumber, 'sfc');
    } catch (err) {
      await markFailed(appId, 'sfc_invoice_po', err);
      supplementalErrors.push({
        step: 'sfc_invoice_po',
        message: err instanceof Error ? err.message : String(err),
      });
    }
  }

  // Step 4a: Supplemental Grant invoice in QuickBooks (staff-only, not emailed).
  //   DocNumber = Baseline grant_id from ssg_grants. Line items = one per grant
  //   scheme (BL + Non-BL), positive amounts, OOS tax. PO# references back to
  //   the main tax invoice.
  if (shouldGenerateGrantInvoice && !existingGrantInvoiceId) {
    try {
      const grantInvoice = await createDirectApplicationGrantInvoice({
        enrolmentId: enrolmentReference,
        mainInvoiceDocNumber: invoiceDocNumber,
        fallbackGrantId: fallbackGrantId || null,
        fallbackTotalAmount: toMoney(row.tg_amount) || toMoney(row.grant_amount) || toMoney(row.skillsfuture_subsidy),
        fallbackBlGrantId: hasIdentifier(row.bl_grant_id) ? row.bl_grant_id : null,
        fallbackBlAmount: toMoney(row.bl_amount),
        fallbackOtherGrantId: hasIdentifier(row.other_grant_id) ? row.other_grant_id : null,
        fallbackOtherSchemeCode: hasIdentifier(row.other_scheme_code) ? row.other_scheme_code : null,
        fallbackOtherAmount: toMoney(row.other_amount),
      });

      if (grantInvoice) {
        await updateRow(appId, { grant_invoice_id: grantInvoice.invoiceId });
        existingGrantInvoiceId = grantInvoice.invoiceId;

        const grantDriveFileOk = existingGrantDriveFileId
          ? await driveFileExists(existingGrantDriveFileId)
          : false;
        if (!grantDriveFileOk) {
          const grantPdf = await qboFetchInvoicePdf(undefined, grantInvoice.invoiceId);
          const grantDriveUpload = await uploadInvoicePdfToDrive({
            pdf: grantPdf,
            fileName: buildDaGrantInvoicePdfFileName(grantInvoice.docNumber),
          });
          await updateRow(appId, {
            grant_invoice_drive_file_id: grantDriveUpload.fileId,
            grant_invoice_drive_web_view_link: grantDriveUpload.webViewLink,
          });
          existingGrantDriveFileId = grantDriveUpload.fileId;
        }
      }
    } catch (err) {
      await markFailed(appId, 'grant_invoice', err);
      supplementalErrors.push({
        step: 'grant_invoice',
        message: err instanceof Error ? err.message : String(err),
      });
    }
  } else if (
    shouldGenerateGrantInvoice &&
    existingGrantInvoiceId &&
    !(existingGrantDriveFileId ? await driveFileExists(existingGrantDriveFileId) : false)
  ) {
    // Recovery path — QB invoice already exists but Drive upload never ran.
    try {
      const grantPdf = await qboFetchInvoicePdf(undefined, existingGrantInvoiceId);
      const grantDriveUpload = await uploadInvoicePdfToDrive({
        pdf: grantPdf,
        fileName: buildDaGrantInvoicePdfFileName(fallbackGrantId || row.grant_id || 'grant'),
      });
      await updateRow(appId, {
        grant_invoice_drive_file_id: grantDriveUpload.fileId,
        grant_invoice_drive_web_view_link: grantDriveUpload.webViewLink,
      });
      existingGrantDriveFileId = grantDriveUpload.fileId;
    } catch (err) {
      await markFailed(appId, 'grant_invoice_drive', err);
      supplementalErrors.push({
        step: 'grant_invoice_drive',
        message: err instanceof Error ? err.message : String(err),
      });
    }
  }

  // Step 4b: Supplemental SFC invoice in QuickBooks (staff-only, not emailed).
  //   DocNumber = SSG claim id. Single positive line, OOS tax.
  //   Terms = "25 Days SFC" (must exist in QBO). PO# = main invoice DocNumber.
  if (shouldGenerateSfcInvoice && !existingSfcInvoiceId) {
    try {
      const sfcInvoice = await createDirectApplicationSfcInvoice({
        enrolmentId: enrolmentReference,
        mainInvoiceDocNumber: invoiceDocNumber,
        sfcClaimId: effectiveSfcClaimId,
        applicationId: row.application_id ?? null,
        fallbackAmount: toMoney(row.skillsfuture_credit),
      });

      if (sfcInvoice) {
        await updateRow(appId, { sfc_invoice_id: sfcInvoice.invoiceId });
        existingSfcInvoiceId = sfcInvoice.invoiceId;

        const sfcDriveFileOk = existingSfcDriveFileId
          ? await driveFileExists(existingSfcDriveFileId)
          : false;
        if (!sfcDriveFileOk) {
          const sfcPdf = await qboFetchInvoicePdf(undefined, sfcInvoice.invoiceId);
          const sfcDriveUpload = await uploadInvoicePdfToDrive({
            pdf: sfcPdf,
            fileName: buildDaSfcInvoicePdfFileName(sfcInvoice.docNumber),
          });
          await updateRow(appId, {
            sfc_invoice_drive_file_id: sfcDriveUpload.fileId,
            sfc_invoice_drive_web_view_link: sfcDriveUpload.webViewLink,
          });
          existingSfcDriveFileId = sfcDriveUpload.fileId;
        }
      }
    } catch (err) {
      await markFailed(appId, 'sfc_invoice', err);
      supplementalErrors.push({
        step: 'sfc_invoice',
        message: err instanceof Error ? err.message : String(err),
      });
    }
  } else if (
    shouldGenerateSfcInvoice &&
    existingSfcInvoiceId &&
    !(existingSfcDriveFileId ? await driveFileExists(existingSfcDriveFileId) : false)
  ) {
    // Recovery path — QB invoice already exists but Drive upload never ran.
    try {
      const sfcPdf = await qboFetchInvoicePdf(undefined, existingSfcInvoiceId);
      const sfcDriveUpload = await uploadInvoicePdfToDrive({
        pdf: sfcPdf,
        fileName: buildDaSfcInvoicePdfFileName(sfcReferenceId || 'sfc'),
      });
      await updateRow(appId, {
        sfc_invoice_drive_file_id: sfcDriveUpload.fileId,
        sfc_invoice_drive_web_view_link: sfcDriveUpload.webViewLink,
      });
      existingSfcDriveFileId = sfcDriveUpload.fileId;
    } catch (err) {
      await markFailed(appId, 'sfc_invoice_drive', err);
      supplementalErrors.push({
        step: 'sfc_invoice_drive',
        message: err instanceof Error ? err.message : String(err),
      });
    }
  }

  // Step 5: Add learner to calendar (non-fatal)
  if (autoCalendar && row.trainee_email) {
    try {
      const calAdded = await addLearnerToCalendarEvent(
        row.trainee_email,
        row.course_title || '',
        row.course_start_date
      );
      if (calAdded) await updateRow(appId, { calendar_added: true });
    } catch (err) {
      console.warn(
        `⚠️  auto-enrol [${applicationId}] calendar attendee failed (non-fatal):`,
        err instanceof Error ? err.message : err
      );
    }
  }

  // Step 6: Create Native Enrolment in the LMS
  try {
    await createNativeEnrolmentForPipeline(appId);
  } catch (err) {
    console.warn(
      `⚠️  auto-enrol [${applicationId}] native enrolment creation failed (non-fatal):`,
      err instanceof Error ? err.message : err
    );
  }

  try {
    await syncDaMainInvoiceToBillingHistory(appId);
  } catch (err) {
    await markFailed(appId, 'billing_history_sync', err);
    return {
      id: appId,
      applicationId,
      success: false,
      finalStatus: 'failed',
      enrolmentId: enrolmentReference,
      grantId: grantId || undefined,
      invoiceId: invoiceId || undefined,
      error: err instanceof Error ? err.message : String(err),
      failedStep: 'billing_history_sync',
    };
  }

  // Send the main tax invoice email AFTER the invoice_jobs row exists, so
  // the UPDATE that stamps invoice_sent_at actually finds its row.
  // Why: syncDaMainInvoiceToBillingHistory is what first inserts the
  // invoice_jobs row keyed by qbo_invoice_id; sending earlier means the
  // UPDATE matches 0 rows and the EMAIL column in the DA admin view stays
  // greyed out even though QBO did deliver the email.
  if (row.trainee_email && invoiceId) {
    const shouldSend =
      !options?.suppressInvoiceEmail &&
      autoSendInvoiceEmail &&
      (options?.sendInvoiceEmail || shouldSendQboInvoiceEmailFromQuickBooks());
    if (shouldSend) {
      try {
        await callInvoiceSend(invoiceId, row.trainee_email);
        await pool.query(
          `UPDATE public.invoice_jobs
              SET invoice_sent_at = COALESCE(invoice_sent_at, now()),
                  invoice_sent_to = COALESCE(invoice_sent_to, $2),
                  updated_at = now()
            WHERE qbo_invoice_id = $1`,
          [String(invoiceId).trim(), String(row.trainee_email).trim()]
        ).catch(() => {});
      } catch (err) {
        console.warn(
          `⚠️  auto-enrol [${applicationId}] invoice send failed (non-fatal):`,
          err instanceof Error ? err.message : err
        );
      }
    } else {
      const reason = options?.suppressInvoiceEmail
        ? '(suppressed for manual generate / cron sweep)'
        : !autoSendInvoiceEmail
          ? '(auto_send_invoice_email toggle is OFF in DA admin view)'
          : '— set QBO_SEND_INVOICE_EMAIL=true to send';
      console.log(`ℹ️  auto-enrol [${applicationId}] skipping invoice email ${reason}`);
    }
  }

  if (supplementalErrors.length > 0) {
    return {
      id: appId,
      applicationId,
      success: false,
      finalStatus: 'failed',
      enrolmentId: enrolmentReference,
      grantId: grantId || undefined,
      invoiceId,
      error: supplementalErrors.map(e => `${e.step}: ${e.message}`).join(' | '),
      failedStep: supplementalErrors[0]?.step,
    };
  }

  return {
    id: appId,
    applicationId,
    success: true,
    finalStatus: 'invoiced',
    enrolmentId: enrolmentReference,
    grantId: grantId || undefined,
    invoiceId,
  };
}

// ---------------------------------------------------------------------------
// Bulk pipeline
// ---------------------------------------------------------------------------

export async function bulkProcessDirectApplications(
  appIds: string[]
): Promise<DaPipelineResult[]> {
  const results: DaPipelineResult[] = [];
  if (appIds.length === 0) return results;

  let sharedCtx: SSGContext | undefined;
  try {
    sharedCtx = await loadSsgContext();
  } catch (err) {
    console.error('❌ auto-enrol: failed to load SSG context, falling back to per-row loads:', err);
  }

  for (let i = 0; i < appIds.length; i += BATCH_SIZE) {
    const batch = appIds.slice(i, i + BATCH_SIZE);
    for (const appId of batch) {
      try {
        const result = await processDirectApplication(appId, sharedCtx, { sendInvoiceEmail: true });
        results.push(result);
      } catch (err) {
        console.error(`❌ auto-enrol [${appId}] unexpected error:`, err);
        results.push({
          id: appId,
          applicationId: '',
          success: false,
          finalStatus: 'failed',
          error: err instanceof Error ? err.message : String(err),
          failedStep: 'unknown',
        });
      }
    }
  }

  const succeeded = results.filter(r => r.success).length;
  console.log(`✅ auto-enrol batch complete: ${succeeded}/${results.length} succeeded`);

  return results;
}

/**
 * Creates Native Enrolment (enrollment and app_user) records inside the LMS from a DA application.
 */
export async function createNativeEnrolmentFromDA(record: any, dbPool: any) {
  if (!record.course_run_id || !record.trainee_id || !record.trainee_email) return null;
  try {
    // Look up the course_id from course_run
    // DA record.course_run_id often contains the external string ID (e.g. TGS-...)
    // rather than the internal UUID. We check both.
    const runRes = await dbPool.query(
      `SELECT id as internal_id, course_id FROM course_run 
       WHERE (id::text = $1 OR course_run_id = $1) AND is_deleted IS NOT TRUE LIMIT 1`,
      [record.course_run_id]
    );

    const internalRunId = runRes.rows[0]?.internal_id;
    const courseId = runRes.rows[0]?.course_id;
    if (!courseId || !internalRunId) {
      console.warn(`⚠️ [DA] Could not find course_run for ID: ${record.course_run_id}`);
      return null;
    }

    // We must ensure the user has an app_user and learner_profile
    // Look up by email first
    const existingUser = await dbPool.query(
      `SELECT id FROM app_user WHERE LOWER(email) = LOWER($1) OR LOWER(secondary_email) = LOWER($1) LIMIT 1`,
      [record.trainee_email]
    );

    let userId = existingUser.rows[0]?.id;

    if (!userId) {
      // Create user if they don't exist, using empty password hash, we can let them reset it
      const newUser = await dbPool.query(
        `INSERT INTO app_user (id, email, full_name, password_hash, account_status, created_at, updated_at)
         VALUES (gen_random_uuid(), $1, $2, '', 'active', NOW(), NOW())
         RETURNING id`,
        [record.trainee_email.toLowerCase(), record.trainee_name || '']
      );
      userId = newUser.rows[0].id;

      await dbPool.query(`INSERT INTO user_role_map (user_id, role) VALUES ($1, 'Learner') ON CONFLICT DO NOTHING`, [userId]);
      await dbPool.query(`INSERT INTO learner_profile (user_id, nric, tel) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING`,
        [userId, record.trainee_id, record.trainee_phone || '']
      );
    }

    const ssgEnrolmentReference = isRealSsgEnrolmentId(record.enrolment_id)
      ? String(record.enrolment_id).trim()
      : null;

    const { rows } = await dbPool.query(
      `INSERT INTO enrollment (
          id, user_id, course_id, course_run_id, progress_percent, payment_status, 
          assessment_status, enrolment_status, enrolment_date, email, nric,
          enrolment_id, course_reference, created_at, updated_at
       )
       VALUES (gen_random_uuid(), $1, $2, $3, 0, 'Unpaid', 'Pending', 'Confirmed', CURRENT_DATE, $4, $5, $6, $7, NOW(), NOW())
       ON CONFLICT (user_id, course_run_id) DO UPDATE SET
          enrolment_status = 'Confirmed',
          enrolment_id = COALESCE(EXCLUDED.enrolment_id, enrollment.enrolment_id),
          email = COALESCE(EXCLUDED.email, enrollment.email),
          nric = COALESCE(EXCLUDED.nric, enrollment.nric),
          course_reference = COALESCE(EXCLUDED.course_reference, enrollment.course_reference),
          updated_at = NOW()
       RETURNING id`,
      [
        userId,
        courseId,
        internalRunId,
        record.trainee_email,
        record.trainee_id,
        ssgEnrolmentReference,
        record.course_reference_number || null
      ]
    );

    const enrolmentId = rows[0]?.id;

    // Preserve the real SSG ENR-... reference on the DA row if we already
    // have one. `MANUAL` is only a fallback marker for manual/native-only
    // rows that do not have an SSG enrolment reference to keep.
    if (record.application_id) {
      let preservedEnrolmentId = ssgEnrolmentReference;

      if (!preservedEnrolmentId) {
        const currentDaRes = await dbPool.query(
          `SELECT enrolment_id FROM da_application WHERE application_id = $1 LIMIT 1`,
          [record.application_id]
        );
        const currentDaEnrolmentId = currentDaRes.rows[0]?.enrolment_id;
        if (isRealSsgEnrolmentId(currentDaEnrolmentId)) {
          preservedEnrolmentId = String(currentDaEnrolmentId).trim();
        }
      }

      await dbPool.query(
        `UPDATE da_application
         SET enrolment_status = 'Confirmed',
             enrolment_id = COALESCE(NULLIF(enrolment_id, ''), $1)
         WHERE application_id = $2`,
        [preservedEnrolmentId || (enrolmentId ? 'MANUAL' : null), record.application_id]
      );
    }

    return enrolmentId || true;
  } catch (err) {
    console.error(`❌ createNativeEnrolmentFromDA failed:`, err);
    return null;
  }
}
