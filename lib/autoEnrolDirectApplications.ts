/**
 * Auto-Enrol Direct Applications pipeline.
 *
 * Runs the end-to-end flow for a direct application row:
 *   1. Load row from da_application (skip if not in "Confirm application" state)
 *   2. Submit SSG enrolment via /tpg/enrolments → save enrolment_id
 *   3. Search SSG grants by enrolment reference → save grant_id (non-fatal)
 *   4. (If enabled) Create QuickBooks invoice → save invoice_id
 *   5. (If enabled) Send invoice email (non-fatal)
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
