import type { NextApiRequest, NextApiResponse } from 'next';
import { getSSGCredentialsService } from '../../../lib/ssg/services/credentials-service';
import { HttpClient, HTTPRequestBuilder, HttpMethod } from '../../../lib/ssg/utils/http-utils';
import crypto from 'crypto';

/**
 * POST /api/assessments/ssg-search
 * Search assessments via SSG TPG API.
 * Body: { courseRunId, courseReferenceNumber, enrolmentReferenceNumber?, traineeIdNumber? }
 */
export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { courseRunId, courseReferenceNumber, enrolmentReferenceNumber, traineeIdNumber } = req.body;

  if (!courseRunId || !courseReferenceNumber) {
    return res.status(400).json({ success: false, error: 'courseRunId and courseReferenceNumber are required' });
  }

  try {
    const credentials = await getSSGCredentialsService().getSSGCredentials();
    if (!credentials) {
      return res.status(500).json({ success: false, error: 'SSG credentials not found' });
    }

    const ssgBaseUrl = process.env.SSG_API_URL || 'https://api.ssg-wsg.sg';
    const encKey = Buffer.from(process.env.ENCRYPTION_KEY || credentials.encryptionKey, 'base64');
    const iv = Buffer.from('SSGAPIInitVector', 'utf8');

    const ssgPayload: any = {
      parameters: {
        page: 0,
        pageSize: 100
      },
      assessments: {
        course: {
          run: {
            id: String(courseRunId)
          },
          referenceNumber: String(courseReferenceNumber)
        },
        trainingPartner: {
          uen: credentials.uen || process.env.TRAINING_PARTNER_UEN || '201200696W',
          code: process.env.TRAINING_PARTNER_CODE || '201200696W-01'
        }
      }
    };

    if (enrolmentReferenceNumber?.trim()) {
      ssgPayload.assessments.enrolment = { referenceNumber: enrolmentReferenceNumber.trim() };
    }

    if (traineeIdNumber?.trim()) {
      ssgPayload.assessments.trainee = { id: traineeIdNumber.trim() };
    }

    const cipher = crypto.createCipheriv('aes-256-cbc', encKey, iv);
    let encryptedPayload = cipher.update(JSON.stringify(ssgPayload), 'utf8', 'base64');
    encryptedPayload += cipher.final('base64');

    const builder = new HTTPRequestBuilder()
      .withEndpoint(ssgBaseUrl, '/tpg/assessments/search')
      .withMethod(HttpMethod.POST)
      .withBody(encryptedPayload);

    if (credentials.certificateContent && credentials.privateKeyContent) {
      builder.withCertificate(credentials.certificateContent, credentials.privateKeyContent);
    }

    const httpClient = new HttpClient(ssgBaseUrl, {
      'Content-Type': 'application/json',
      'Accept': 'application/json',
    });

    const httpResponse = await httpClient.request(builder.build());

    if (httpResponse.status !== 200) {
      console.error(`❌ SSG search assessments error [${httpResponse.status}]:`, JSON.stringify(httpResponse.data));
      return res.status(httpResponse.status).json({
        success: false,
        error: `SSG error ${httpResponse.status}`,
        details: httpResponse.data,
      });
    }

    // Decrypt SSG response
    const rawBody = typeof httpResponse.data === 'string'
      ? httpResponse.data
      : JSON.stringify(httpResponse.data);

    const decipher = crypto.createDecipheriv('aes-256-cbc', encKey, iv);
    let decrypted = decipher.update(rawBody, 'base64', 'utf8');
    decrypted += decipher.final('utf8');
    const parsed = JSON.parse(decrypted);

    console.log('📦 SSG search assessments response:', JSON.stringify(parsed));

    // SSG always returns "error": {} even on success — only treat as error if code/message present
    const hasError = parsed?.error && (parsed.error.code || parsed.error.message);
    if (hasError) {
      const decryptedStatus = Number(parsed.status) || 400;
      if (decryptedStatus === 403 || decryptedStatus === 404) {
        return res.status(404).json({ success: false, error: 'No assessments found for the given criteria.' });
      }
      return res.status(decryptedStatus).json({ success: false, error: parsed.error.message });
    }

    return res.status(200).json({ success: true, data: parsed?.data ?? [], meta: parsed?.meta ?? {} });

  } catch (error) {
    console.error('❌ Search assessments error:', error);
    return res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Internal server error',
    });
  }
}
