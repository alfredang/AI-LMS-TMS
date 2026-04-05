import type { NextApiRequest, NextApiResponse } from 'next';
import { getSSGCredentialsService } from '../../../../lib/ssg/services/credentials-service';
import { HttpClient, HTTPRequestBuilder, HttpMethod } from '../../../../lib/ssg/utils/http-utils';

/**
 * POST /api/sf-credits/claims/cancel
 * Cancel a SkillsFuture Credit claim via SSG API (v2).
 * Body: { claimId, nric, claimCancelCode, app? }
 */
export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { claimId, nric, claimCancelCode, app } = req.body;

  if (!claimId || !nric || !claimCancelCode) {
    return res.status(400).json({ success: false, error: 'claimId, nric, and claimCancelCode are required.' });
  }

  try {
    const credentials = await getSSGCredentialsService().getSSGCredentials(undefined, app);
    if (!credentials) {
      return res.status(500).json({ success: false, error: 'SSG credentials not found' });
    }

    const ssgBaseUrl = credentials.ssgApiBaseUrl || process.env.SSG_API_URL || 'https://api.ssg-wsg.sg';

    const builder = new HTTPRequestBuilder()
      .withEndpoint(ssgBaseUrl, `/skillsFutureCredits/claims/${claimId}`)
      .withMethod(HttpMethod.POST)
      .withHeader('x-api-version', 'v2')
      .withBody({ nric, claimCancelCode });

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
    console.log(`🚫 SSG Cancel Claim [${app || 'default'}] response [${httpResponse.status}]:`, JSON.stringify(httpResponse.data));

    if (httpResponse.status !== 200) {
      return res.status(httpResponse.status).json({ success: false, error: `SSG error ${httpResponse.status}`, details: httpResponse.data });
    }

    return res.status(200).json({ success: true, data: httpResponse.data });
  } catch (error) {
    console.error('❌ Cancel Claim error:', error);
    return res.status(500).json({ success: false, error: error instanceof Error ? error.message : 'Internal server error' });
  }
}

async function getOAuthToken(baseUrl: string, clientId: string, clientSecret: string): Promise<string> {
  const basic = Buffer.from(`${clientId}:${clientSecret}`).toString('base64');
  const resp = await fetch(`${baseUrl}/dp-oauth/oauth/token`, {
    method: 'POST',
    headers: { 'Authorization': `Basic ${basic}`, 'Content-Type': 'application/x-www-form-urlencoded' },
    body: 'grant_type=client_credentials',
  });
  if (!resp.ok) throw new Error(`OAuth token request failed: ${resp.status}`);
  const data = await resp.json();
  return data.access_token;
}
