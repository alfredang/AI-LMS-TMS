import type { NextApiRequest, NextApiResponse } from 'next';
import pool from '../../../lib/db';
import { getSSGCredentialsService } from '../../../lib/ssg/services/credentials-service';
import { HttpClient, HTTPRequestBuilder, HttpMethod } from '../../../lib/ssg/utils/http-utils';
import crypto from 'crypto';
import { getTrainingPartnerIdentifiers } from '../../../lib/trainingPartnerIdentifiers';
import { buildEnrolmentPayload } from '../../../lib/ssg/buildEnrolmentPayload';
import { createNativeEnrolmentFromDA } from '../../../lib/autoEnrolDirectApplications';
import { searchEnrolment } from '../../../lib/ssg/services/enrolment-service';

/**
 * POST /api/admin/da-enrol
 * Create SSG enrolments for a batch of DA applications.
 * Body: { applications: [...da_application rows...] }
 *
 * For each application:
 *  1. Build SSG enrolment payload from DA application data
 *  2. Call POST /tpg/enrolments (encrypted)
 *  3. Update da_application.enrolment_status in DB on success
 *
 * Returns: { results: [{ application_id, success, error? }] }
 */

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { applications } = req.body;
  if (!applications || !Array.isArray(applications) || applications.length === 0) {
    return res.status(400).json({ success: false, error: 'applications array is required' });
  }

  try {
    const credentials = await getSSGCredentialsService().getSSGCredentials(undefined, (req.headers['x-ssg-app'] as string) || undefined);
    if (!credentials) {
      return res.status(500).json({ success: false, error: 'SSG credentials not found' });
    }

    const ssgBaseUrl = process.env.SSG_API_URL || 'https://api.ssg-wsg.sg';
    const encKey = Buffer.from(credentials.encryptionKey, 'base64');
    const iv = Buffer.from('SSGAPIInitVector', 'utf8');
    const tp = await getTrainingPartnerIdentifiers();
    const uen = credentials.uen || tp.uen;

    const httpClient = new HttpClient(ssgBaseUrl, {
      'Content-Type': 'application/json',
      'Accept': 'application/json',
    });

    const results: { application_id: string; success: boolean; error?: string }[] = [];

    for (const app of applications) {
      const applicationId = app.application_id;

      // Skip cancelled/rejected/failed applications
      const appStatus = (app.application_status || '').toLowerCase();
      if (['cancelled', 'rejected', 'failed'].includes(appStatus)) {
        results.push({ application_id: applicationId, success: false, error: `Skipped: application status is "${app.application_status}"` });
        continue;
      }

      try {
        const payload = buildEnrolmentPayload(app, uen, tp.code);

        const cipher = crypto.createCipheriv('aes-256-cbc', encKey, iv);
        let encryptedPayload = cipher.update(JSON.stringify(payload), 'utf8', 'base64');
        encryptedPayload += cipher.final('base64');

        const builder = new HTTPRequestBuilder()
          .withEndpoint(ssgBaseUrl, '/tpg/enrolments')
          .withMethod(HttpMethod.POST)
          .withBody(encryptedPayload);

        if (credentials.certificateContent && credentials.privateKeyContent) {
          builder.withCertificate(credentials.certificateContent, credentials.privateKeyContent);
        }

        const httpResponse = await httpClient.request(builder.build());

        let rawBody = '';
        if (httpResponse.data) {
          rawBody = typeof httpResponse.data === 'string'
            ? httpResponse.data
            : JSON.stringify(httpResponse.data);
        }

        if (!rawBody || rawBody.trim() === '') {
           results.push({ application_id: applicationId, success: false, error: `SSG error ${httpResponse.status} (empty body)` });
           continue;
        }

        let parsed: any;
        try {
          // Handle wrapped error JSON from SSG Gateway (common on 400 errors)
          let toDecrypt = rawBody;
          if (rawBody.startsWith('{')) {
            try {
              const p = JSON.parse(rawBody);
              if (p.error && typeof p.error === 'string') {
                toDecrypt = p.error;
              }
            } catch { /* not valid JSON */ }
          }

          const decipher = crypto.createDecipheriv('aes-256-cbc', encKey, iv);
          let decrypted = decipher.update(toDecrypt, 'base64', 'utf8');
          decrypted += decipher.final('utf8');
          parsed = JSON.parse(decrypted);
        } catch (err) {
          results.push({ application_id: applicationId, success: false, error: `Failed to decrypt SSG response (status: ${httpResponse.status})` });
          continue;
        }

        console.log(`📦 SSG enrol [${applicationId}]:`, JSON.stringify(parsed));

        const hasError = parsed?.error && (parsed.error.code || parsed.error.message ||
          (parsed.error.details && parsed.error.details.length > 0));

        let enrolmentReference = parsed?.data?.enrolment?.referenceNumber || parsed?.enrolment?.referenceNumber || parsed?.data?.referenceNumber || parsed?.referenceNumber;

        if (hasError) {
          const errMsg = parsed.error.details?.[0]?.message || parsed.error.message || 'Enrolment failed';
          
          if (errMsg.toLowerCase().includes('duplicate')) {
             console.log(`ℹ️  da-enrol [${applicationId}]: Duplicate detected in SSG, searching for existing enrolment...`);
             const searchPayload = {
               enrolment: {
                 course: payload.enrolment.course,
                 trainee: payload.enrolment.trainee,
                 trainingPartner: payload.enrolment.trainingPartner
               },
               parameters: { page: 0, pageSize: 10 }
             };
             
             try {
               const searchResult = await searchEnrolment(searchPayload as any);
               if (searchResult.success && searchResult.referenceNumber) {
                 console.log(`✅ da-enrol [${applicationId}]: Recovered duplicate enrolment reference: ${searchResult.referenceNumber}`);
                 enrolmentReference = searchResult.referenceNumber;
               } else {
                 results.push({ application_id: applicationId, success: false, error: `Duplicate record found, but search failed to recover reference` });
                 continue;
               }
             } catch (searchErr) {
               results.push({ application_id: applicationId, success: false, error: `Duplicate record found, but search threw an error` });
               continue;
             }
          } else {
            results.push({ application_id: applicationId, success: false, error: errMsg });
            continue;
          }
        }
        
        if (!enrolmentReference) {
          results.push({ application_id: applicationId, success: false, error: 'no enrolment reference in SSG response' });
          continue;
        }

        // Save enrolment_id to DB
        await pool.query(
          `UPDATE da_application SET enrolment_id = $1, auto_enrol_status = 'enroled', enrolment_status = 'Confirmed', updated_at = NOW() WHERE application_id = $2`,
          [enrolmentReference, applicationId]
        );

        // Try to run Native Enrolment so the system is fully synced
        try {
          const appRes = await pool.query(`SELECT * FROM da_application WHERE application_id = $1`, [applicationId]);
          const record = appRes.rows[0];
          if (record) {
            await createNativeEnrolmentFromDA(record, pool);
            
            // NEW: Also trigger Calendar Sync for manual enrolments
            if (record.trainee_email) {
              const { addDaLearnerToCalendar } = await import('../../../lib/google-calendar/da-calendar-sync');
              
              // Resolve internal course_run UUID first
              const crRes = await pool.query(
                `SELECT id FROM course_run WHERE (id::text = $1 OR course_run_id = $1) AND is_deleted IS NOT TRUE LIMIT 1`,
                [record.course_run_id]
              );
              const courseRunUuid = crRes.rows[0]?.id || record.course_run_id;

              const calResult = await addDaLearnerToCalendar(
                record.trainee_email,
                courseRunUuid,
                record.course_title,
                record.course_start_date
              );
              
              if (calResult.addedTo > 0) {
                await pool.query(
                  `UPDATE da_application SET calendar_added = true WHERE id = $1`,
                  [record.id]
                );
              }
            }
          }
        } catch (nativeErr) {
          console.error(`⚠️ Native Enrolment / Calendar sync failed for ${applicationId}:`, nativeErr);
        }

        results.push({ application_id: applicationId, success: true });

      } catch (err) {
        results.push({
          application_id: applicationId,
          success: false,
          error: err instanceof Error ? err.message : 'Unknown error',
        });
      }
    }

    return res.status(200).json({ success: true, results });

  } catch (error) {
    console.error('❌ DA enrol error:', error);
    return res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Internal server error',
    });
  }
}
