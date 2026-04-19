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
import {
  createDirectApplicationInvoice,
  type DaApplicationForInvoice,
} from './quickbooks/createDirectApplicationInvoice';
import { refreshGrantsForEnrolments } from './services/billingSync';
import { shouldSendQboInvoiceEmailFromQuickBooks } from './services/qboInvoiceEmailPolicy';
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
  if (!tpRow?.sync_google_calendar) {
    console.log(`📅 [calendar-attendee] sync_google_calendar is off — skipping`);
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
    startDateIso = courseStartDate.toISOString().slice(0, 10);
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
  if (!tpRow?.sync_google_calendar) return result;

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
    startDateIso = courseStartDate.toISOString().slice(0, 10);
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
  options?: { forceInvoice?: boolean }
): Promise<DaPipelineResult> {
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

  if ((row.application_status || '').toLowerCase() !== 'confirm application' && !options?.forceInvoice) {
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
    `SELECT auto_generate_qb_invoice, auto_add_learner_to_calendar FROM training_provider LIMIT 1`
  );
  const autoInvoice: boolean = !!tpRes.rows[0]?.auto_generate_qb_invoice;
  const autoCalendar: boolean = !!tpRes.rows[0]?.auto_add_learner_to_calendar;

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
    const forInvoice: DaApplicationForInvoice & { enrolment_id?: string } = {
      id: row.id,
      trainee_name: row.trainee_name,
      trainee_email: row.trainee_email,
      course_title: row.course_title,
      course_reference_number: row.course_reference_number,
      course_start_date: row.course_start_date
        ? new Date(row.course_start_date).toISOString().slice(0, 10)
        : null,
      full_course_fee: row.full_course_fee,
      gst: row.gst,
      skillsfuture_subsidy: row.skillsfuture_subsidy,
      skillsfuture_credit: row.skillsfuture_credit,
      qb_customer_ref: row.qb_customer_ref,
      // Add missing fields with fallback to null or appropriate value
      trainee_id: row.trainee_id ?? null,
      course_end_date: row.course_end_date ? new Date(row.course_end_date).toISOString().slice(0, 10) : null,
      course_run_id: row.course_run_id ?? null,
      grant_id: grantId ?? null,
      application_id: row.application_id ?? null,
      enrolment_id: enrolmentReference ?? undefined,
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

  // Step 4: Send invoice email via QBO proxy (non-fatal; off by default — same as invoice jobs)
  if (row.trainee_email && invoiceId) {
    if (shouldSendQboInvoiceEmailFromQuickBooks()) {
      try {
        await callInvoiceSend(invoiceId, row.trainee_email);
      } catch (err) {
        console.warn(
          `⚠️  auto-enrol [${applicationId}] invoice send failed (non-fatal):`,
          err instanceof Error ? err.message : err
        );
      }
    } else {
      console.log(
        `ℹ️  auto-enrol [${applicationId}] skipping invoice email — set QBO_SEND_INVOICE_EMAIL=true to send`
      );
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