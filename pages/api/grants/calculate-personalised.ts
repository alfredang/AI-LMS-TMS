import type { NextApiRequest, NextApiResponse } from 'next';
import { getSSGCredentialsService } from '../../../lib/ssg/services/credentials-service';
import { HttpClient, HTTPRequestBuilder, HttpMethod } from '../../../lib/ssg/utils/http-utils';

/**
 * POST /api/grants/calculate-personalised
 * Calculate personalised grant via SSG Grant Calculator API (v3.0).
 * Body: { courses, applicant, course, trainee, app?: string }
 *
 * This endpoint does NOT use encryption — it sends plain JSON.
 * Supports cert auth (App 1/2/3) and OAuth (App 4).
 */
export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { courses, applicant, course, trainee, app } = req.body;

  if (!courses || !Array.isArray(courses) || courses.length === 0) {
    return res.status(400).json({
      success: false,
      error: 'courses array is required.',
    });
  }

  if (!applicant || !course || !trainee) {
    return res.status(400).json({
      success: false,
      error: 'applicant, course, and trainee objects are required for personalised grant calculation.',
    });
  }

  try {
    const credentials = await getSSGCredentialsService().getSSGCredentials(undefined, app);
    if (!credentials) {
      return res.status(500).json({ success: false, error: 'SSG credentials not found' });
    }

    const ssgBaseUrl = credentials.ssgApiBaseUrl || process.env.SSG_API_URL || 'https://api.ssg-wsg.sg';
    const ssgPayload = { courses, applicant, course, trainee };

    const builder = new HTTPRequestBuilder()
      .withEndpoint(ssgBaseUrl, '/grantCalculators/individual/personalised')
      .withMethod(HttpMethod.POST)
      .withHeader('x-api-version', 'v3.0')
      .withBody(ssgPayload);

    // App 4 uses OAuth bearer token; others use mTLS certificate
    if (credentials.oauthClientId && credentials.oauthClientSecret) {
      const token = await getOAuthToken(ssgBaseUrl, credentials.oauthClientId, credentials.oauthClientSecret);
      builder.withHeader('Authorization', `Bearer ${token}`);
    } else if (credentials.certificateContent && credentials.privateKeyContent) {
      builder.withCertificate(credentials.certificateContent, credentials.privateKeyContent);
    }

    const httpClient = new HttpClient(ssgBaseUrl, {
      'Content-Type': 'application/json',
      'Accept': 'application/json',
    });

    const httpResponse = await httpClient.request(builder.build());

    console.log(`📊 SSG Personalised Grant Calculator [${app || 'default'}] response [${httpResponse.status}]:`, JSON.stringify(httpResponse.data));

    if (httpResponse.status !== 200) {
      return res.status(httpResponse.status).json({
        success: false,
        error: `SSG error ${httpResponse.status}`,
        details: httpResponse.data,
      });
    }

    return res.status(200).json({ success: true, data: httpResponse.data });

  } catch (error) {
    console.error('❌ Personalised Grant Calculator error:', error);
    return res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Internal server error',
    });
  }
}

/** Fetch OAuth bearer token for App 4 (public API) */
async function getOAuthToken(baseUrl: string, clientId: string, clientSecret: string): Promise<string> {
  const tokenUrl = `${baseUrl}/dp-oauth/oauth/token`;
  const basic = Buffer.from(`${clientId}:${clientSecret}`).toString('base64');

  const resp = await fetch(tokenUrl, {
    method: 'POST',
    headers: {
      'Authorization': `Basic ${basic}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: 'grant_type=client_credentials',
  });

  if (!resp.ok) {
    throw new Error(`OAuth token request failed: ${resp.status} ${resp.statusText}`);
  }

  const data = await resp.json();
  return data.access_token;
}
