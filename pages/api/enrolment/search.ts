import { NextApiRequest, NextApiResponse } from 'next';
import { getSSGCredentialsService } from '../../../lib/ssg/services/credentials-service';
import { HttpClient, HTTPRequestBuilder, HttpMethod } from '../../../lib/ssg/utils/http-utils';
import crypto from 'crypto';

/**
 * POST /api/enrolment/search
 * Search enrolments by Course Run ID via SSG API directly.
 */
export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { courseRunId } = req.body;
  if (!courseRunId) {
    return res.status(400).json({ success: false, error: 'courseRunId is required' });
  }

  try {
    const credentials = await getSSGCredentialsService().getSSGCredentials();
    if (!credentials) {
      return res.status(500).json({ success: false, error: 'SSG credentials not found' });
    }

    const ssgBaseUrl = process.env.SSG_API_URL || 'https://api.ssg-wsg.sg';
    const tpUen  = process.env.TRAINING_PARTNER_UEN  || credentials.uen;
    const tpCode = process.env.TRAINING_PARTNER_CODE || '';

    // Encrypt the payload
    const payload = {
      parameters: { page: 0, pageSize: 100 },
      enrolment: {
        course: { run: { id: courseRunId } },
        trainingPartner: { uen: tpUen, code: tpCode }
      }
    };

    console.log('📤 Search payload:', JSON.stringify(payload, null, 2));

    const encKey = Buffer.from(process.env.ENCRYPTION_KEY || credentials.encryptionKey, 'base64');
    const iv = Buffer.from('SSGAPIInitVector', 'utf8');
    const cipher = crypto.createCipheriv('aes-256-cbc', encKey, iv);
    let encryptedPayload = cipher.update(JSON.stringify(payload), 'utf8', 'base64');
    encryptedPayload += cipher.final('base64');

    // Build request with cert/key
    const builder = new HTTPRequestBuilder()
      .withEndpoint(ssgBaseUrl, '/tpg/enrolments/search')
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

    // Decrypt raw response body directly
    const rawBody = typeof httpResponse.data === 'string' ? httpResponse.data : JSON.stringify(httpResponse.data);
    const decipher = crypto.createDecipheriv('aes-256-cbc', encKey, iv);
    let decrypted = decipher.update(rawBody, 'base64', 'utf8');
    decrypted += decipher.final('utf8');

    const parsed = JSON.parse(decrypted);
    console.log('📦 Decrypted SSG response:', JSON.stringify(parsed, null, 2));

    if (parsed?.status && String(parsed.status) === '404') {
      // No enrolments found — not an error
      return res.status(200).json({ success: true, data: [] });
    }

    if (parsed?.status && String(parsed.status) !== '200') {
      return res.status(Number(parsed.status) || 400).json({ success: false, error: parsed?.error ?? `SSG status ${parsed.status}` });
    }

    return res.status(200).json({ success: true, data: parsed?.data ?? [] });

  } catch (error) {
    console.error('❌ Search enrolment error:', error);
    return res.status(500).json({ success: false, error: error instanceof Error ? error.message : 'Internal server error' });
  }
}
