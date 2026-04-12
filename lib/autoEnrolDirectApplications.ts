/**
 * Auto-Enrol Direct Applications pipeline.
 *
 * Runs the end-to-end flow for a direct application row:
 *   1. Load row from da_application (skip if not in "Confirm application" state)
 *   2. Submit SSG enrolment via /tpg/enrolments → save enrolment_id
 *   3. Search SSG grants by enrolment reference → save grant_id (non-fatal)
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
import {
  createDirectApplicationInvoice,
  type DaApplicationForInvoice,
} from './quickbooks/createDirectApplicationInvoice';
import { google } from 'googleapis';
import { getGoogleCredentials } from './google-auth/googleAuth';

export type AutoEnrolStatus =
  | 'pending'
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

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

async function updateRow(
  id: string,
  fields: Record<string, string | null>
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

  if (httpResponse.status !== 200 && httpResponse.status !== 201) {
    throw new Error(`SSG ${path} returned ${httpResponse.status}`);
  }

  const rawBody = typeof httpResponse.data === 'string'
    ? httpResponse.data
    : JSON.stringify(httpResponse.data);

  const decipher = crypto.createDecipheriv('aes-256-cbc', ctx.encKey, IV);
  let decrypted = decipher.update(rawBody, 'base64', 'utf8');
  decrypted += decipher.final('utf8');

  return JSON.parse(decrypted);
}

function extractEnrolmentReference(parsed: any): string | null {
  // SSG /tpg/enrolments success response shapes vary slightly by version;
  // try the common paths in order.
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
  const baseUrl = process.env.QBO_PROXY_BASE_URL || process.env.NEXT_PUBLIC_BASE_URL || 'http://localhost:3000';
  const resp = await fetch(`${baseUrl}/api/quickbooks/proxy`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action: 'send', entity: 'invoice', id: invoiceId, sendTo: email }),
  });
  const data = await resp.json().catch(() => null);
  if (!resp.ok || !data?.success) {
    throw new Error(data?.error || `QB send returned ${resp.status}`);
  }
}

// ---------------------------------------------------------------------------
// Google Calendar: add learner email to matching event
// ---------------------------------------------------------------------------

/**
 * Strip common prefixes from a calendar event summary so we can match it
 * against the course title from the DA application. Known prefixes:
 * "WSQ ", "VIRTUAL ", "EXTERNAL ", "[WSQ]", "[VIRTUAL]", "[EXTERNAL]",
 * and combinations thereof.
 */
function stripCalendarPrefixes(title: string): string {
  return (title || '')
    .replace(/^\s*\[?(WSQ|VIRTUAL|EXTERNAL|HYBRID)\]?\s*/gi, '')
    .replace(/^\s*\[?(WSQ|VIRTUAL|EXTERNAL|HYBRID)\]?\s*/gi, '') // second pass for double-prefix
    .trim();
}

/**
 * Attempt to add a learner's email to the Google Calendar event that
 * matches the DA's course title + course start date.
 *
 * Matching rules:
 *   1. Strip WSQ/VIRTUAL/EXTERNAL/HYBRID prefixes from both sides
 *   2. Case-insensitive substring match (event title contains course title
 *      or vice-versa)
 *   3. Event start date (YYYY-MM-DD) matches course_start_date
 *   4. If the learner's email is already in the attendee list → no-op
 *
 * This step is always non-fatal. If calendar is not configured, credentials
 * are missing, or no matching event is found, we log a warning and move on.
 */
async function addLearnerToCalendarEvent(
  learnerEmail: string,
  courseTitle: string,
  courseStartDate: string | Date | null
): Promise<void> {
  if (!learnerEmail || !courseTitle) return;

  // Load calendar config
  const tpRes = await pool.query(
    `SELECT sync_google_calendar, google_calendar_url FROM training_provider LIMIT 1`
  );
  const tpRow = tpRes.rows[0];
  if (!tpRow?.sync_google_calendar) {
    console.log(`📅 [calendar-attendee] sync_google_calendar is off — skipping`);
    return;
  }

  const credentials = await getGoogleCredentials(pool);

  // Extract calendar ID
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

  // Normalise the course start date to YYYY-MM-DD
  let startDateIso: string;
  if (!courseStartDate) return;
  if (courseStartDate instanceof Date) {
    startDateIso = courseStartDate.toISOString().slice(0, 10);
  } else {
    startDateIso = String(courseStartDate).slice(0, 10);
  }

  // Fetch calendar events around the course start date (±1 day window)
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

  // Find matching event: stripped title contains course title (or vice-versa) AND date matches
  const matchedEvent = events.find(evt => {
    const evtSummary = stripCalendarPrefixes(evt.summary || '').toLowerCase();
    const titleMatch =
      evtSummary.includes(strippedCourseTitle) ||
      strippedCourseTitle.includes(evtSummary);
    if (!titleMatch) return false;

    // Check date match
    const evtDate = (evt.start?.dateTime?.slice(0, 10) || evt.start?.date || '');
    return evtDate === startDateIso;
  });

  if (!matchedEvent || !matchedEvent.id) {
    console.log(`📅 [calendar-attendee] No matching event for "${courseTitle}" on ${startDateIso} — skipping`);
    return;
  }

  // Check if learner email is already an attendee
  const existingAttendees = matchedEvent.attendees || [];
  const emailLower = learnerEmail.trim().toLowerCase();
  if (existingAttendees.some(a => (a.email || '').toLowerCase() === emailLower)) {
    console.log(`📅 [calendar-attendee] ${learnerEmail} already in event "${matchedEvent.summary}" — no-op`);
    return;
  }

  // Add the learner as a new attendee
  await calendar.events.patch({
    calendarId,
    eventId: matchedEvent.id,
    requestBody: {
      attendees: [
        ...existingAttendees,
        { email: learnerEmail, responseStatus: 'needsAction' },
      ],
    },
    // Don't send update notifications to all attendees for each individual add
    sendUpdates: 'none',
  });

  console.log(`📅 [calendar-attendee] Added ${learnerEmail} to event "${matchedEvent.summary}" (${matchedEvent.id})`);
}

// ---------------------------------------------------------------------------
// Single-row pipeline
// ---------------------------------------------------------------------------

export async function processDirectApplication(
  appId: string,
  sharedCtx?: SSGContext
): Promise<DaPipelineResult> {
  // Step 0: Load row + training-provider toggles
  const rowRes = await pool.query(
    `SELECT * FROM da_application WHERE id = $1`,
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

  if ((row.application_status || '').toLowerCase() !== 'confirm application') {
    return {
      id: appId,
      applicationId,
      success: false,
      finalStatus: (row.auto_enrol_status as AutoEnrolStatus) || 'pending',
      error: `skipped: application_status is ${row.application_status}`,
      failedStep: 'load',
    };
  }

  const tpRes = await pool.query(
    `SELECT auto_generate_qb_invoice FROM training_provider LIMIT 1`
  );
  const autoInvoice: boolean = !!tpRes.rows[0]?.auto_generate_qb_invoice;

  await updateRow(appId, { auto_enrol_status: 'pending', auto_enrol_error: null });

  // Step 1: SSG enrolment
  let enrolmentReference: string | null = null;
  try {
    const ctx = sharedCtx || (await loadSsgContext());
    const payload = buildEnrolmentPayload(row, ctx.uen, ctx.tpCode);
    const parsed = await ssgEncryptedPost(ctx, '/tpg/enrolments', payload);
    console.log(`📦 auto-enrol [${applicationId}]:`, JSON.stringify(parsed));

    const errMsg = hasSsgError(parsed);
    if (errMsg) throw new Error(errMsg);

    enrolmentReference = extractEnrolmentReference(parsed);
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

  // Step 2: Grant search (non-fatal on failure)
  let grantId: string | null = null;
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
      const grants = parsed?.data ?? [];
      const first = Array.isArray(grants) ? grants[0] : null;
      grantId = first?.referenceNumber || null;
      if (grantId) {
        await updateRow(appId, {
          grant_id: grantId,
          auto_enrol_status: 'grant_found',
        });
      } else {
        console.log(`ℹ️  auto-enrol [${applicationId}] grant not yet available`);
      }
    }
  } catch (err) {
    console.warn(
      `⚠️  auto-enrol [${applicationId}] grant search failed (non-fatal):`,
      err instanceof Error ? err.message : err
    );
  }

  // Step 3: QuickBooks invoice (skipped unless toggle is on)
  if (!autoInvoice) {
    // Still add learner to calendar even when invoice is skipped
    if (row.trainee_email) {
      try {
        await addLearnerToCalendarEvent(row.trainee_email, row.course_title || '', row.course_start_date);
      } catch (err) {
        console.warn(`⚠️  auto-enrol [${applicationId}] calendar attendee failed (non-fatal):`, err instanceof Error ? err.message : err);
      }
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

  let invoiceId: string | null = null;
  try {
    const forInvoice: DaApplicationForInvoice = {
      id: row.id,
      trainee_name: row.trainee_name,
      trainee_email: row.trainee_email,
      course_title: row.course_title,
      course_reference_number: row.course_reference_number,
      course_start_date: row.course_start_date
        ? new Date(row.course_start_date).toISOString().slice(0, 10)
        : null,
      full_course_fee: row.full_course_fee,
      skillsfuture_subsidy: row.skillsfuture_subsidy,
      skillsfuture_credit: row.skillsfuture_credit,
      qb_customer_ref: row.qb_customer_ref,
    };
    const created = await createDirectApplicationInvoice(forInvoice);
    invoiceId = created.invoiceId;

    await updateRow(appId, {
      invoice_id: created.invoiceId,
      qb_customer_ref: created.customerRef,
      auto_enrol_status: 'invoiced',
    });
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

  // Step 4: Send invoice email (non-fatal)
  if (row.trainee_email && invoiceId) {
    try {
      await callInvoiceSend(invoiceId, row.trainee_email);
    } catch (err) {
      console.warn(
        `⚠️  auto-enrol [${applicationId}] invoice send failed (non-fatal):`,
        err instanceof Error ? err.message : err
      );
    }
  }

  // Step 5: Add learner email to matching Google Calendar event (non-fatal)
  // Matches by course title (ignoring WSQ/VIRTUAL/EXTERNAL prefixes) + start date.
  // If the learner is already an attendee, this is a no-op.
  if (row.trainee_email) {
    try {
      await addLearnerToCalendarEvent(
        row.trainee_email,
        row.course_title || '',
        row.course_start_date
      );
    } catch (err) {
      console.warn(
        `⚠️  auto-enrol [${applicationId}] calendar attendee failed (non-fatal):`,
        err instanceof Error ? err.message : err
      );
    }
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

  // Load SSG context once and share across rows to avoid re-fetching creds.
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
        const result = await processDirectApplication(appId, sharedCtx);
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
