import { withAuth } from '@lib/auth/withAuth';
import type { NextApiRequest, NextApiResponse } from 'next';
import { getSSGCredentialsService } from '../../../lib/ssg/services/credentials-service';
import { HttpClient, HTTPRequestBuilder, HttpMethod } from '../../../lib/ssg/utils/http-utils';

/**
 * POST /api/grants/calculate-baseline
 * Calculate baseline grant via SSG Grant Calculator API (v3.0).
 * Body: { courses: [{ trainingPartnerUen, courseReferenceNumber }], app?: string }
 *
 * Sends plain JSON (no encryption) with x-api-version: v3.0 and mTLS cert auth.
 */
async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { courses, app } = req.body;

  if (!courses || !Array.isArray(courses) || courses.length === 0) {
    return res.status(400).json({ success: false, error: 'courses array is required.' });
  }

  try {
    const credentials = await getSSGCredentialsService().getSSGCredentials(undefined, app);
    if (!credentials) {
      return res.status(500).json({ success: false, error: 'SSG credentials not found' });
    }

    const ssgBaseUrl = credentials.ssgApiBaseUrl || process.env.SSG_API_URL || 'https://api.ssg-wsg.sg';
    const ssgPayload = { courses };

    const builder = new HTTPRequestBuilder()
      .withEndpoint(ssgBaseUrl, '/grantCalculators/individual')
      .withMethod(HttpMethod.POST)
      .withHeader('x-api-version', 'v3.0')
      .withBody(ssgPayload);

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
    console.log(`📊 SSG Grant Calculator [${app || 'default'}] response [${httpResponse.status}]:`, JSON.stringify(httpResponse.data));

    if (httpResponse.status !== 200) {
      return res.status(httpResponse.status).json({ success: false, error: `SSG error ${httpResponse.status}`, details: httpResponse.data });
    }

    return res.status(200).json({ success: true, data: httpResponse.data });

  } catch (error) {
    console.error('❌ Grant Calculator error:', error);
    return res.status(500).json({ success: false, error: error instanceof Error ? error.message : 'Internal server error' });
  }
}

export default withAuth(handler, { roles: ['admin', 'trainingProvider', 'finance'] });
