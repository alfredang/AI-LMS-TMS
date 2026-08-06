import { withAuth } from '@lib/auth/withAuth';
import type { NextApiRequest, NextApiResponse } from 'next';
import { getSSGCredentialsService } from '../../../lib/ssg/services/credentials-service';
import { HttpClient, HTTPRequestBuilder, HttpMethod } from '../../../lib/ssg/utils/http-utils';
import crypto from 'crypto';

/**
 * POST /api/grants/calculate-personalised
 * Calculate personalised grant via SSG Grant Calculator API (v3.0).
 * Body: { courses, applicant, course, trainee, app?: string }
 *
 * Uses AES-256-CBC encryption (request + response) with mTLS cert auth.
 */
async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { courses, applicant, course, trainee, app } = req.body;

  if (!courses || !Array.isArray(courses) || courses.length === 0) {
    return res.status(400).json({ success: false, error: 'courses array is required.' });
  }

  try {
    const credentials = await getSSGCredentialsService().getSSGCredentials(undefined, app);
    if (!credentials) {
      return res.status(500).json({ success: false, error: 'SSG credentials not found' });
    }

    const ssgBaseUrl = credentials.ssgApiBaseUrl || process.env.SSG_API_URL || 'https://api.ssg-wsg.sg';
    const encKey = Buffer.from(credentials.encryptionKey, 'base64');
    const iv = Buffer.from('SSGAPIInitVector', 'utf8');

    const ssgPayload: any = { courses };
    if (applicant) ssgPayload.applicant = applicant;
    if (course) ssgPayload.course = course;
    if (trainee) ssgPayload.trainee = trainee;

    // Encrypt the payload
    const cipher = crypto.createCipheriv('aes-256-cbc', encKey, iv);
    let encryptedPayload = cipher.update(JSON.stringify(ssgPayload), 'utf8', 'base64');
    encryptedPayload += cipher.final('base64');

    const builder = new HTTPRequestBuilder()
      .withEndpoint(ssgBaseUrl, '/grantCalculators/individual/personalised')
      .withMethod(HttpMethod.POST)
      .withHeader('x-api-version', 'v3.0')
      .withBody(encryptedPayload);

    if (credentials.oauthClientId && credentials.oauthClientSecret) {
      const basic = Buffer.from(`${credentials.oauthClientId}:${credentials.oauthClientSecret}`).toString('base64');
      const tokenResp = await fetch(`${ssgBaseUrl}/dp-oauth/oauth/token`, {
        method: 'POST',
        headers: { 'Authorization': `Basic ${basic}`, 'Content-Type': 'application/x-www-form-urlencoded' },
        body: 'grant_type=client_credentials',
      });
      if (!tokenResp.ok) throw new Error(`OAuth token failed: ${tokenResp.status}`);
      const tokenData = await tokenResp.json();
      builder.withHeader('Authorization', `Bearer ${tokenData.access_token}`);
    } else if (credentials.certificateContent && credentials.privateKeyContent) {
      builder.withCertificate(credentials.certificateContent, credentials.privateKeyContent);
    }

    const httpClient = new HttpClient(ssgBaseUrl, {
      'Content-Type': 'application/json',
      'Accept': 'application/json',
    });

    const httpResponse = await httpClient.request(builder.build());

    if (httpResponse.status !== 200) {
      console.error(`❌ SSG Personalised Grant Calculator [${app || 'default'}] error [${httpResponse.status}]:`, JSON.stringify(httpResponse.data));
      return res.status(httpResponse.status).json({ success: false, error: `SSG error ${httpResponse.status}`, details: httpResponse.data });
    }

    // Decrypt the response
    const rawBody = typeof httpResponse.data === 'string' ? httpResponse.data : JSON.stringify(httpResponse.data);
    let parsed: any;
    try {
      const decipher = crypto.createDecipheriv('aes-256-cbc', encKey, iv);
      let decrypted = decipher.update(rawBody, 'base64', 'utf8');
      decrypted += decipher.final('utf8');
      parsed = JSON.parse(decrypted);
    } catch {
      parsed = httpResponse.data;
    }

    console.log(`📊 SSG Personalised Grant Calculator [${app || 'default'}] response:`, JSON.stringify(parsed).substring(0, 300));

    const hasError = parsed?.error && (parsed.error.code || parsed.error.message);
    if (hasError) {
      return res.status(Number(parsed.status) || 400).json({ success: false, error: parsed.error.message, details: parsed });
    }

    return res.status(200).json({ success: true, data: parsed });

  } catch (error) {
    console.error('❌ Personalised Grant Calculator error:', error);
    return res.status(500).json({ success: false, error: error instanceof Error ? error.message : 'Internal server error' });
  }
}

export default withAuth(handler, { roles: ['admin', 'trainingProvider', 'finance'] });
