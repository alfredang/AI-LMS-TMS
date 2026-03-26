import type { NextApiRequest, NextApiResponse } from 'next';
import pool from '../../../lib/db';
import { getSSGCredentialsService } from '../../../lib/ssg/services/credentials-service';
import { HttpClient, HTTPRequestBuilder, HttpMethod } from '../../../lib/ssg/utils/http-utils';
import crypto from 'crypto';

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

function buildIdType(raw: string): string {
  const upper = (raw || '').toUpperCase();
  if (upper.includes('FIN')) return 'FIN';
  if (upper.includes('PASSPORT')) return 'PASSPORT';
  return 'NRIC';
}

function buildSponsorshipType(raw: string): string {
  return (raw || '').toUpperCase().includes('EMPLOYER') ? 'EMPLOYER' : 'INDIVIDUAL';
}

function buildEnrolmentPayload(app: Record<string, any>, uen: string): object {
  const today = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Singapore' });

  const trainee: Record<string, any> = {
    idType: { type: buildIdType(app.trainee_id_type) },
    id: String(app.trainee_id || ''),
    dateOfBirth: app.date_of_birth ? String(app.date_of_birth).split('T')[0] : undefined,
    fullName: String(app.trainee_name || ''),
    emailAddress: String(app.trainee_email || ''),
    sponsorshipType: buildSponsorshipType(app.sponsorship_type),
    fees: {
      discountAmount: 0,
      collectionStatus: 'Pending Payment',
    },
    enrolmentDate: today,
  };

  if (app.trainee_phone) {
    trainee.contactNumber = {
      countryCode: String(app.trainee_phone_country_code || '65'),
      areaCode: '',
      phoneNumber: String(app.trainee_phone),
    };
  }

  return {
    enrolment: {
      trainingPartner: {
        uen,
        code: process.env.TRAINING_PARTNER_CODE || '201200696W-01',
      },
      course: {
        referenceNumber: String(app.course_reference_number || ''),
        run: { id: String(app.course_run_id || '') },
      },
      trainee,
    },
  };
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { applications } = req.body;
  if (!applications || !Array.isArray(applications) || applications.length === 0) {
    return res.status(400).json({ success: false, error: 'applications array is required' });
  }

  try {
    const credentials = await getSSGCredentialsService().getSSGCredentials();
    if (!credentials) {
      return res.status(500).json({ success: false, error: 'SSG credentials not found' });
    }

    const ssgBaseUrl = process.env.SSG_API_URL || 'https://api.ssg-wsg.sg';
    const encKey = Buffer.from(process.env.ENCRYPTION_KEY || credentials.encryptionKey, 'base64');
    const iv = Buffer.from('SSGAPIInitVector', 'utf8');
    const uen = credentials.uen || process.env.TRAINING_PARTNER_UEN || '201200696W';

    const httpClient = new HttpClient(ssgBaseUrl, {
      'Content-Type': 'application/json',
      'Accept': 'application/json',
    });

    const results: { application_id: string; success: boolean; error?: string }[] = [];

    for (const app of applications) {
      const applicationId = app.application_id;

      try {
        const payload = buildEnrolmentPayload(app, uen);

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

        if (httpResponse.status !== 200 && httpResponse.status !== 201) {
          results.push({ application_id: applicationId, success: false, error: `SSG error ${httpResponse.status}` });
          continue;
        }

        const rawBody = typeof httpResponse.data === 'string'
          ? httpResponse.data
          : JSON.stringify(httpResponse.data);

        const decipher = crypto.createDecipheriv('aes-256-cbc', encKey, iv);
        let decrypted = decipher.update(rawBody, 'base64', 'utf8');
        decrypted += decipher.final('utf8');
        const parsed = JSON.parse(decrypted);

        console.log(`📦 SSG enrol [${applicationId}]:`, JSON.stringify(parsed));

        const hasError = parsed?.error && (parsed.error.code || parsed.error.message ||
          (parsed.error.details && parsed.error.details.length > 0));

        if (hasError) {
          const errMsg = parsed.error.details?.[0]?.message || parsed.error.message || 'Enrolment failed';
          results.push({ application_id: applicationId, success: false, error: errMsg });
          continue;
        }

        // Success — update da_application enrolment_status in DB
        await pool.query(
          `UPDATE da_application SET enrolment_status = 'Confirmed', updated_at = NOW() WHERE application_id = $1`,
          [applicationId]
        );

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
