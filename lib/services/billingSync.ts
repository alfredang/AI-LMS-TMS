/**
 * Per-learner SSG data sync for billing history.
 *
 * On billing history load:
 *   1. Look up learner NRIC
 *   2. Search SSG enrolments by NRIC
 *   3. Upsert into ssg_enrolments + enrich local enrollment rows
 *   4. Fetch grants per enrolment from SSG
 *   5. Upsert into ssg_grants
 *
 * Never throws — logs warnings on failure so billing history degrades to stale local data.
 */

import pool from '../db';
import { getSSGCredentialsService } from '../ssg/services/credentials-service';
import { getTrainingPartnerIdentifiers } from '../trainingPartnerIdentifiers';
import { HttpClient, HTTPRequestBuilder, HttpMethod } from '../ssg/utils/http-utils';
import crypto from 'crypto';

const IV = Buffer.from('SSGAPIInitVector', 'utf8');

// ---------------------------------------------------------------------------
// SSG encrypted POST helper
// ---------------------------------------------------------------------------

interface SSGCredentials {
  encryptionKey: string;
  certificateContent?: string;
  privateKeyContent?: string;
  uen: string;
  ssgApiBaseUrl?: string;
}

async function ssgEncryptedPost(
  credentials: SSGCredentials,
  path: string,
  payload: unknown
): Promise<unknown> {
  const ssgBaseUrl = credentials.ssgApiBaseUrl || process.env.SSG_API_URL || 'https://api.ssg-wsg.sg';
  const encKey = Buffer.from(credentials.encryptionKey, 'base64');

  const cipher = crypto.createCipheriv('aes-256-cbc', encKey, IV);
  let encrypted = cipher.update(JSON.stringify(payload), 'utf8', 'base64');
  encrypted += cipher.final('base64');

  const builder = new HTTPRequestBuilder()
    .withEndpoint(ssgBaseUrl, path)
    .withMethod(HttpMethod.POST)
    .withBody(encrypted);

  if (credentials.certificateContent && credentials.privateKeyContent) {
    builder.withCertificate(credentials.certificateContent, credentials.privateKeyContent);
  }

  const httpClient = new HttpClient(ssgBaseUrl, {
    'Content-Type': 'application/json',
    'Accept': 'application/json',
  });

  const httpResponse = await httpClient.request(builder.build());

  if (httpResponse.status !== 200) {
    throw new Error(`SSG ${path} returned ${httpResponse.status}`);
  }

  const rawBody = typeof httpResponse.data === 'string'
    ? httpResponse.data
    : JSON.stringify(httpResponse.data);

  const decipher = crypto.createDecipheriv('aes-256-cbc', encKey, IV);
  let decrypted = decipher.update(rawBody, 'base64', 'utf8');
  decrypted += decipher.final('utf8');

  return JSON.parse(decrypted);
}

// ---------------------------------------------------------------------------
// ssg_enrolments upsert (mirrors ssg-enrolment-utils.js upsertEnrolment)
// ---------------------------------------------------------------------------

async function upsertSsgEnrolment(record: Record<string, unknown>): Promise<void> {
  const trainee = (record.trainee ?? {}) as Record<string, unknown>;
  const course = (record.course ?? {}) as Record<string, unknown>;
  const run = (course.run ?? {}) as Record<string, unknown>;
  const tp = (record.trainingPartner ?? {}) as Record<string, unknown>;
  const email = (trainee.email as Record<string, unknown>)?.full ?? null;

  await pool.query(
    `INSERT INTO ssg_enrolments (
       id, enrolment_id, trainee_name, trainee_nric,
       course_title, course_reference, course_run_id,
       training_partner_code, enrolment_status, sponsorship_type,
       enrolment_date, raw_data, created_date, imported_at
     ) VALUES (
       gen_random_uuid(), $1, $2, $3, $4, $5, $6, $7, $8, $9,
       $10::timestamptz, $11, NOW(), NOW()
     )
     ON CONFLICT (enrolment_id) DO UPDATE SET
       trainee_name = EXCLUDED.trainee_name,
       trainee_nric = EXCLUDED.trainee_nric,
       course_title = EXCLUDED.course_title,
       course_reference = EXCLUDED.course_reference,
       course_run_id = EXCLUDED.course_run_id,
       enrolment_status = EXCLUDED.enrolment_status,
       sponsorship_type = EXCLUDED.sponsorship_type,
       enrolment_date = EXCLUDED.enrolment_date,
       raw_data = EXCLUDED.raw_data,
       imported_at = NOW()`,
    [
      record.referenceNumber,                                    // enrolment_id
      (trainee.fullName as string) || null,                      // trainee_name
      (trainee.id as string) || null,                            // trainee_nric
      (course.title as string) || null,                          // course_title
      (course.referenceNumber as string) || null,                // course_reference
      (run.id as string) || null,                                // course_run_id
      (tp.code as string) || null,                               // training_partner_code
      (record.status as string) || null,                         // enrolment_status
      (trainee.sponsorshipType as string) || null,               // sponsorship_type
      (trainee.enrolmentDate as string) || null,                 // enrolment_date
      JSON.stringify({ ...record, trainee: { ...trainee, email: { full: email } } }), // raw_data
    ]
  );
}

// ---------------------------------------------------------------------------
// enrollment enrichment (mirrors sync-enrolments.js primary sync)
// ---------------------------------------------------------------------------

async function enrichLocalEnrollment(enrolmentId: string, record: Record<string, unknown>): Promise<void> {
  const trainee = (record.trainee ?? {}) as Record<string, unknown>;
  const sponsorship = (trainee.sponsorshipType as string || '').toUpperCase().includes('EMPLOYER')
    ? 'Employer'
    : 'Individual';

  await pool.query(
    `UPDATE enrollment SET
       enrolment_status = $2,
       raw_data = $3,
       nric = COALESCE($4, nric),
       course_sponsorship = $5::course_sponsorship
     WHERE enrolment_id = $1`,
    [
      enrolmentId,
      (record.status as string) || null,
      JSON.stringify(record),
      (trainee.id as string) || null,
      sponsorship,
    ]
  );
}

// ---------------------------------------------------------------------------
// ssg_grants upsert (mirrors populate-grants.js upsertGrant)
// ---------------------------------------------------------------------------

async function upsertSsgGrant(grant: Record<string, unknown>): Promise<void> {
  const enrolment = (grant.enrolment ?? {}) as Record<string, unknown>;
  const scheme = (grant.fundingScheme ?? {}) as Record<string, unknown>;
  const component = (grant.fundingComponent ?? {}) as Record<string, unknown>;
  const amount = (grant.grantAmount ?? {}) as Record<string, unknown>;

  await pool.query(
    `INSERT INTO ssg_grants (
       id, grant_id, enrollment_id, status,
       funding_scheme_code, funding_scheme_description,
       component_code, component_description,
       estimated_grant_amount, approved_grant_amount,
       api_response, created_date, imported_at
     ) VALUES (
       gen_random_uuid(), $1, $2, $3,
       $4, $5, $6, $7, $8, $9, $10,
       NOW(), NOW()
     )
     ON CONFLICT (grant_id) DO UPDATE SET
       status = EXCLUDED.status,
       estimated_grant_amount = EXCLUDED.estimated_grant_amount,
       approved_grant_amount = EXCLUDED.approved_grant_amount,
       api_response = EXCLUDED.api_response,
       imported_at = NOW()`,
    [
      grant.referenceNumber,                           // grant_id
      (enrolment.referenceNumber as string) || null,   // enrollment_id
      (grant.status as string) || null,                // status
      (scheme.code as string) || null,                 // funding_scheme_code
      (scheme.description as string) || null,          // funding_scheme_description
      (component.code as string) || null,              // component_code
      (component.description as string) || null,       // component_description
      (amount.estimated as number) ?? null,            // estimated_grant_amount
      (amount.paid as number) ?? null,                 // approved_grant_amount
      JSON.stringify(grant),                           // api_response
    ]
  );
}

// ---------------------------------------------------------------------------
// Main export
// ---------------------------------------------------------------------------

/**
 * Syncs a single learner's SSG enrolment and grant data into the local database.
 * Called before billing history query so data is fresh.
 * Never throws — billing history falls back to stale local data on failure.
 */
export async function syncLearnerFromSSG(userId: string): Promise<void> {
  try {
    // 1. Look up NRIC
    const userResult = await pool.query(
      `SELECT lp.nric FROM learner_profile lp WHERE lp.user_id = $1`,
      [userId]
    );

    const nric = userResult.rows[0]?.nric;
    if (!nric) {
      console.log(`[billingSync] No NRIC for user ${userId} — skipping SSG sync`);
      return;
    }

    // 2. Load SSG credentials
    const credentials = await getSSGCredentialsService().getSSGCredentials();
    if (!credentials) {
      console.warn('[billingSync] SSG credentials not available — skipping sync');
      return;
    }

    const tp = await getTrainingPartnerIdentifiers();
    const ourCode = tp.code;

    const ssgCreds: SSGCredentials = {
      encryptionKey: credentials.encryptionKey,
      certificateContent: credentials.certificateContent,
      privateKeyContent: credentials.privateKeyContent,
      uen: credentials.uen || tp.uen,
      ssgApiBaseUrl: credentials.ssgApiBaseUrl,
    };

    // 3. Search SSG enrolments by NRIC
    console.log(`[billingSync] Searching SSG enrolments for NRIC ${nric.substring(0, 3)}****`);

    const enrolmentPayload = {
      enrolment: {
        trainee: { id: nric.toUpperCase() },
        trainingPartner: { uen: ssgCreds.uen, code: ourCode },
      },
      parameters: { page: 0, pageSize: 100 },
    };

    const enrolmentResponse = await ssgEncryptedPost(ssgCreds, '/tpg/enrolments/search', enrolmentPayload) as {
      data?: Record<string, unknown>[];
      status?: string | number;
    };

    // SSG returns status 404 when no enrolments found
    if (String(enrolmentResponse?.status) === '404') {
      console.log('[billingSync] No SSG enrolments found for this NRIC');
      return;
    }

    const rawRecords = enrolmentResponse?.data ?? [];
    if (rawRecords.length === 0) {
      console.log('[billingSync] SSG returned 0 enrolment records');
      return;
    }

    // Filter to our training partner only
    const records = rawRecords.filter(r => {
      const recordTp = (r.trainingPartner ?? r) as Record<string, unknown>;
      return (recordTp.code as string) === ourCode;
    });

    console.log(`[billingSync] ${records.length} enrolments from our TP (${rawRecords.length} total from SSG)`);

    // 4. Upsert ssg_enrolments + enrich enrollment
    const enrolmentRefs: string[] = [];

    for (const record of records) {
      const ref = record.referenceNumber as string;
      if (!ref) continue;

      try {
        await upsertSsgEnrolment(record);
        await enrichLocalEnrollment(ref, record);
        enrolmentRefs.push(ref);
      } catch (err) {
        console.warn(`[billingSync] Failed to upsert enrolment ${ref}:`, (err as Error).message);
      }
    }

    console.log(`[billingSync] Upserted ${enrolmentRefs.length} enrolments, fetching grants...`);

    // 5. Fetch grants for each enrolment (in parallel)
    const grantPromises = enrolmentRefs.map(async (ref) => {
      try {
        const grantPayload = {
          grants: {
            enrolment: { referenceNumber: ref },
            trainingPartner: { uen: ssgCreds.uen, code: ourCode },
          },
          parameters: { page: 0, pageSize: 100 },
        };

        const grantResponse = await ssgEncryptedPost(ssgCreds, '/tpg/grants/search', grantPayload) as {
          data?: Record<string, unknown>[];
        };

        const grants = grantResponse?.data ?? [];
        let upserted = 0;

        for (const grant of grants) {
          try {
            await upsertSsgGrant(grant);
            upserted++;
          } catch (err) {
            console.warn(`[billingSync] Failed to upsert grant ${grant.referenceNumber}:`, (err as Error).message);
          }
        }

        return upserted;
      } catch (err) {
        console.warn(`[billingSync] Grant fetch failed for ${ref}:`, (err as Error).message);
        return 0;
      }
    });

    const grantCounts = await Promise.all(grantPromises);
    const totalGrants = grantCounts.reduce((sum, c) => sum + c, 0);

    console.log(`[billingSync] Sync complete — ${enrolmentRefs.length} enrolments, ${totalGrants} grants`);

  } catch (err) {
    console.warn('[billingSync] Sync failed (billing history will use stale local data):', (err as Error).message);
  }
}
