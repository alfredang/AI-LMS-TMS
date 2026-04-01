import type { NextApiRequest, NextApiResponse } from 'next';
import { getSSGCredentialsService } from '../../../lib/ssg/services/credentials-service';
import { HttpClient, HTTPRequestBuilder, HttpMethod } from '../../../lib/ssg/utils/http-utils';
import crypto from 'crypto';

/**
 * GET /api/assessments/ssg-view?referenceNumber=ASM-XXXX-XXXXXX
 * View a single assessment record from SSG by its reference number.
 */
export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { referenceNumber } = req.query;

  if (!referenceNumber || typeof referenceNumber !== 'string' || !referenceNumber.trim()) {
    return res.status(400).json({ success: false, error: 'referenceNumber query parameter is required' });
  }

  try {
    const credentials = await getSSGCredentialsService().getSSGCredentials();
    if (!credentials) {
      return res.status(500).json({ success: false, error: 'SSG credentials not found' });
    }

    const ssgBaseUrl = process.env.SSG_API_URL || 'https://api.ssg-wsg.sg';
    const encKey = Buffer.from(credentials.encryptionKey, 'base64');
    const iv = Buffer.from('SSGAPIInitVector', 'utf8');

    const builder = new HTTPRequestBuilder()
      .withEndpoint(ssgBaseUrl, `/tpg/assessments/details/${referenceNumber.trim()}`)
      .withMethod(HttpMethod.GET)
      .withParam('uen', credentials.uen);

    if (credentials.certificateContent && credentials.privateKeyContent) {
      builder.withCertificate(credentials.certificateContent, credentials.privateKeyContent);
    }

    const httpClient = new HttpClient(ssgBaseUrl, {
      'Content-Type': 'application/json',
      'Accept': 'application/json',
    });

    const httpResponse = await httpClient.request(builder.build());

    if (httpResponse.status !== 200) {
      console.error(`❌ SSG view assessment error [${httpResponse.status}]:`, JSON.stringify(httpResponse.data));
      if (httpResponse.status === 403 || httpResponse.status === 404) {
        return res.status(404).json({ success: false, error: 'Assessment not found. Please check the Reference Number and try again.' });
      }
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

    console.log('📦 SSG view assessment response:', JSON.stringify(parsed));

    // SSG always returns "error": {} even on success — only treat as error if code/message present
    const hasError = parsed?.error && (parsed.error.code || parsed.error.message);
    if (hasError) {
      const decryptedStatus = Number(parsed.status) || 400;
      if (decryptedStatus === 403 || decryptedStatus === 404) {
        return res.status(404).json({ success: false, error: 'Assessment not found. Please check the Reference Number and try again.' });
      }
      return res.status(decryptedStatus).json({ success: false, error: parsed.error.message });
    }

    return res.status(200).json({ success: true, data: parsed?.data ?? parsed });

  } catch (error) {
    console.error('❌ View assessment error:', error);
    return res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Internal server error',
    });
  }
}
