import type { NextApiRequest, NextApiResponse } from 'next';
import { getSSGCredentialsService } from '../../../lib/ssg/services/credentials-service';
import { HttpClient, HTTPRequestBuilder, HttpMethod } from '../../../lib/ssg/utils/http-utils';
import crypto from 'crypto';

/**
 * GET /api/grants/view?grantId=GRN-XXXX-XXXXXX
 * View a single grant record from SSG by its grant ID.
 */
export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { grantId } = req.query;

  if (!grantId || typeof grantId !== 'string' || !grantId.trim()) {
    return res.status(400).json({ success: false, error: 'grantId query parameter is required' });
  }

  try {
    const credentials = await getSSGCredentialsService().getSSGCredentials();
    if (!credentials) {
      return res.status(500).json({ success: false, error: 'SSG credentials not found' });
    }

    const ssgBaseUrl = process.env.SSG_API_URL || 'https://api.ssg-wsg.sg';
    const encKey = Buffer.from(process.env.ENCRYPTION_KEY || credentials.encryptionKey, 'base64');
    const iv = Buffer.from('SSGAPIInitVector', 'utf8');

    const builder = new HTTPRequestBuilder()
      .withEndpoint(ssgBaseUrl, `/tpg/grants/details/${grantId.trim()}`)
      .withMethod(HttpMethod.GET);

    if (credentials.certificateContent && credentials.privateKeyContent) {
      builder.withCertificate(credentials.certificateContent, credentials.privateKeyContent);
    }

    const httpClient = new HttpClient(ssgBaseUrl, {
      'Content-Type': 'application/json',
      'Accept': 'application/json',
    });

    const httpResponse = await httpClient.request(builder.build());

    if (httpResponse.status !== 200) {
      console.error(`❌ SSG view grant error [${httpResponse.status}]:`, JSON.stringify(httpResponse.data));
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

    console.log('📦 SSG view grant response:', JSON.stringify(parsed));

    // SSG always returns "error": {} even on success — only treat as error if code/message present
    const hasError = parsed?.error && (parsed.error.code || parsed.error.message);
    if (hasError) {
      return res.status(parsed.status || 400).json({ success: false, error: parsed.error.message });
    }

    return res.status(200).json({ success: true, data: parsed?.data ?? parsed });

  } catch (error) {
    console.error('❌ View grant error:', error);
    return res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Internal server error',
    });
  }
}
