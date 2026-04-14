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
import { qboFetchInvoicePdf } from './services/qboInvoiceService';
import { uploadInvoicePdfToDrive } from './services/invoiceDriveUpload';
import { addDaLearnerToCalendar } from './google-calendar/da-calendar-sync';

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


// Google Calendar logic moved to lib/google-calendar/da-calendar-sync.ts

// ---------------------------------------------------------------------------
// Single-row pipeline
// ---------------------------------------------------------------------------

export async function processDirectApplication(
  appId: string,
  sharedCtx?: SSGContext,
  options?: { forceInvoice?: boolean }
): Promise<DaPipelineResult> {
  const rowRes = await pool.query(
    `SELECT da.*,
            sg.bl_grant_id,
            sg.bl_amount,
            sg.other_grant_id,
            sg.other_scheme_code,
            sg.other_amount
     FROM da_application da
     LEFT JOIN (
       SELECT
         LOWER(TRIM(enrollment_id)) AS enrolment_key,
         MAX(CASE WHEN UPPER(COALESCE(funding_scheme_code,'')) IN ('BL','BASELINE')
                       OR UPPER(COALESCE(funding_scheme_code,'')) LIKE '%BASELINE%'
                  THEN grant_id END) AS bl_grant_id,
         MAX(CASE WHEN UPPER(COALESCE(funding_scheme_code,'')) IN ('BL','BASELINE')
                       OR UPPER(COALESCE(funding_scheme_code,'')) LIKE '%BASELINE%'
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
                            ELSE COALESCE(estimated_grant_amount,0) END END) AS other_amount
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

  // Step 3: QuickBooks invoice
  if (!autoInvoice && !options?.forceInvoice) {
    if (autoCalendar && row.trainee_email) {
      try {
        // Resolve local course_run UUID for session lookup
        const runRes = await pool.query(
          `SELECT id FROM course_run WHERE (id::text = $1 OR course_run_id = $1) AND is_deleted IS NOT TRUE LIMIT 1`, 
          [row.course_run_id]
        );
        const courseRunUuid = runRes.rows[0]?.id;

        const calResults = await addDaLearnerToCalendar(
          row.trainee_email, 
          courseRunUuid || row.course_run_id, 
          row.course_title || '', 
          row.course_start_date
        );
        if (calResults.addedTo > 0) await updateRow(appId, { calendar_added: true });
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
      bl_grant_id: row.bl_grant_id ?? null,
      bl_amount: row.bl_amount ?? null,
      other_grant_id: row.other_grant_id ?? null,
      other_scheme_code: row.other_scheme_code ?? null,
      other_amount: row.other_amount ?? null,
    };
    const created = await createDirectApplicationInvoice(forInvoice);
    invoiceId = created.invoiceId;

    await updateRow(appId, {
      invoice_id: created.invoiceId,
      qb_customer_ref: created.customerRef,
      auto_enrol_status: 'invoiced',
    });

    // Upload invoice PDF to Google Drive (non-fatal)
    try {
      const pdf = await qboFetchInvoicePdf(undefined, created.invoiceId);
      const driveFile = await uploadInvoicePdfToDrive({ pdf, fileName: `${created.docNumber}.pdf` });
      await updateRow(appId, { invoice_drive_file_id: driveFile.fileId });
      console.log(`[DA invoice] PDF uploaded to Drive: ${created.docNumber}.pdf (${driveFile.fileId})`);
    } catch (driveErr) {
      console.warn(`⚠️  [DA invoice] Drive upload failed (non-fatal):`, driveErr instanceof Error ? driveErr.message : driveErr);
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

  // Step 5: Add learner email to matching Google Calendar event (non-fatal)
  if (autoCalendar && row.trainee_email) {
    try {
      // Resolve local course_run UUID for session lookup
      const runRes = await pool.query(
        `SELECT id FROM course_run WHERE (id::text = $1 OR course_run_id = $1) AND is_deleted IS NOT TRUE LIMIT 1`, 
        [row.course_run_id]
      );
      const courseRunUuid = runRes.rows[0]?.id;

      const calResults = await addDaLearnerToCalendar(
        row.trainee_email,
        courseRunUuid || row.course_run_id,
        row.course_title || '',
        row.course_start_date
      );
      if (calResults.addedTo > 0) await updateRow(appId, { calendar_added: true });
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

// Automatically creates a public.enrollment record from a da_application
export async function createNativeEnrolmentFromDA(record: any, pool: any) {
  if (!record.course_run_id || !record.trainee_id || !record.trainee_email) return null;
  try {
    // Look up the course_id from course_run
    // DA record.course_run_id often contains the external string ID (e.g. TGS-...) 
    // rather than the internal UUID. We check both.
    const runRes = await pool.query(
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
    const existingUser = await pool.query(
      `SELECT id FROM app_user WHERE LOWER(email) = LOWER($1) OR LOWER(secondary_email) = LOWER($1) LIMIT 1`,
      [record.trainee_email]
    );

    let userId = existingUser.rows[0]?.id;

    if (!userId) {
      // Create user if they don't exist, using empty password hash, we can let them reset it
      const newUser = await pool.query(
        `INSERT INTO app_user (id, email, full_name, password_hash, account_status, created_at, updated_at)
         VALUES (gen_random_uuid(), $1, $2, '', 'active', NOW(), NOW())
         RETURNING id`,
        [record.trainee_email.toLowerCase(), record.trainee_name || '']
      );
      userId = newUser.rows[0].id;
      
      await pool.query(`INSERT INTO user_role_map (user_id, role) VALUES ($1, 'Learner') ON CONFLICT DO NOTHING`, [userId]);
      await pool.query(`INSERT INTO learner_profile (user_id, nric, tel) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING`, 
        [userId, record.trainee_id, record.trainee_phone || '']
      );
    }

    const { rows } = await pool.query(
      `INSERT INTO enrollment (
          id, user_id, course_id, course_run_id, progress_percent, payment_status, 
          assessment_status, enrolment_status, enrolment_date, email, nric, created_at, updated_at
       )
       VALUES (gen_random_uuid(), $1, $2, $3, 0, 'Unpaid', 'Pending', 'Confirmed', CURRENT_DATE, $4, $5, NOW(), NOW())
       ON CONFLICT DO NOTHING
       RETURNING id`,
      [
        userId,
        courseId,
        internalRunId,
        record.trainee_email,
        record.trainee_id
      ]
    );

    const enrolmentId = rows[0]?.id;

    // Update the DA record to link it and show success
    if (record.application_id) {
      await pool.query(
        `UPDATE da_application 
         SET enrolment_status = 'Confirmed',
             enrolment_id = $1
         WHERE application_id = $2`,
        [enrolmentId || null, record.application_id]
      );
    }

    return enrolmentId || true;
  } catch (err) {
    console.error(`❌ createNativeEnrolmentFromDA failed:`, err);
    return null;
  }
}
