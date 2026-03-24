import { NextApiRequest, NextApiResponse } from 'next';
import { getSSGCredentialsService } from '../../../lib/ssg/services/credentials-service';
import { HttpClient, HTTPRequestBuilder, HttpMethod } from '../../../lib/ssg/utils/http-utils';
import pool from '../../../lib/db';
import crypto from 'crypto';

/**
 * POST /api/enrolment/cancel
 * Cancel an enrolment via SSG API directly.
 * Body: { enrolmentId, courseRunId }
 */
export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { enrolmentId, courseRunId } = req.body;
  if (!enrolmentId || !courseRunId) {
    return res.status(400).json({ success: false, error: 'enrolmentId and courseRunId are required' });
  }

  try {
    // Look up NRIC and course reference number from local DB
    const dbRow = await pool.query(
      `SELECT e.nric, c.course_code
       FROM enrollment e
       JOIN course_run cr ON cr.id = e.course_run_id
       JOIN course c ON c.id = cr.course_id
       WHERE e.enrolment_id = $1 AND cr.course_run_id = $2
       LIMIT 1`,
      [enrolmentId, courseRunId]
    );

    if (dbRow.rows.length === 0) {
      return res.status(404).json({ success: false, error: 'Enrolment not found in local database' });
    }

    const { nric, course_code } = dbRow.rows[0];

    const credentials = await getSSGCredentialsService().getSSGCredentials();
    if (!credentials) {
      return res.status(500).json({ success: false, error: 'SSG credentials not found' });
    }

    const ssgBaseUrl = process.env.SSG_API_URL || 'https://api.ssg-wsg.sg';
    const tpUen  = process.env.TRAINING_PARTNER_UEN  || credentials.uen;
    const tpCode = process.env.TRAINING_PARTNER_CODE || '';

    const payload = {
      enrolment: {
        course: {
          run: { id: courseRunId },
          referenceNumber: course_code
        },
        trainee: {
          id: nric,
          idType: { type: 'NRIC' }
        },
        trainingPartner: {
          uen: tpUen,
          code: tpCode
        }
      }
    };

    const encKey = Buffer.from(process.env.ENCRYPTION_KEY || credentials.encryptionKey, 'base64');
    const iv = Buffer.from('SSGAPIInitVector', 'utf8');
    const cipher = crypto.createCipheriv('aes-256-cbc', encKey, iv);
    let encryptedPayload = cipher.update(JSON.stringify(payload), 'utf8', 'base64');
    encryptedPayload += cipher.final('base64');

    const builder = new HTTPRequestBuilder()
      .withEndpoint(ssgBaseUrl, `/tpg/enrolments/${enrolmentId}/cancel`)
      .withMethod(HttpMethod.POST)
      .withBody(encryptedPayload);

    if (credentials.certificateContent && credentials.privateKeyContent) {
      builder.withCertificate(credentials.certificateContent, credentials.privateKeyContent);
    }

    const httpClient = new HttpClient(ssgBaseUrl, { 'Content-Type': 'application/json', 'Accept': 'application/json' });
    const httpResponse = await httpClient.request(builder.build());

    if (httpResponse.status !== 200) {
      return res.status(httpResponse.status).json({ success: false, error: `SSG error ${httpResponse.status}` });
    }

    // Decrypt raw response
    const rawBody = typeof httpResponse.data === 'string' ? httpResponse.data : JSON.stringify(httpResponse.data);
    const decipher = crypto.createDecipheriv('aes-256-cbc', encKey, iv);
    let decrypted = decipher.update(rawBody, 'base64', 'utf8');
    decrypted += decipher.final('utf8');
    const parsed = JSON.parse(decrypted);
    console.log('📦 Cancel enrolment SSG response:', JSON.stringify(parsed));

    if (parsed?.status && String(parsed.status) !== '200') {
      return res.status(Number(parsed.status) || 400).json({ success: false, error: parsed?.error ?? `SSG status ${parsed.status}` });
    }

    // Update local DB to Cancelled
    await pool.query(
      `UPDATE enrollment SET enrolment_status = 'Cancelled', updated_at = NOW() WHERE enrolment_id = $1`,
      [enrolmentId]
    );

    return res.status(200).json({ success: true, data: parsed?.data ?? parsed });

  } catch (error) {
    console.error('❌ Cancel enrolment error:', error);
    return res.status(500).json({ success: false, error: error instanceof Error ? error.message : 'Internal server error' });
  }
}
