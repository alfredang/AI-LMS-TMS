import type { NextApiRequest, NextApiResponse } from 'next';
import { getSSGCredentialsService } from '../../../../lib/ssg/services/credentials-service';
import { HttpClient, HTTPRequestBuilder, HttpMethod } from '../../../../lib/ssg/utils/http-utils';

/**
 * GET /api/sf-credits/claims/view?claimId=xxx&nric=xxx&app=app1
 * View SkillsFuture Credit claim details via SSG API (v2).
 */
export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { claimId, nric, app } = req.query;

  if (!claimId || !nric) {
    return res.status(400).json({ success: false, error: 'claimId and nric are required.' });
  }

  try {
    const credentials = await getSSGCredentialsService().getSSGCredentials(undefined, app as string);
    if (!credentials) {
      return res.status(500).json({ success: false, error: 'SSG credentials not found' });
    }

    const ssgBaseUrl = credentials.ssgApiBaseUrl || process.env.SSG_API_URL || 'https://api.ssg-wsg.sg';

    const builder = new HTTPRequestBuilder()
      .withEndpoint(ssgBaseUrl, `/skillsFutureCredits/claims/${claimId}`)
      .withMethod(HttpMethod.GET)
      .withHeader('x-api-version', 'v2')
      .withParam('nric', nric as string);

    if (credentials.oauthClientId && credentials.oauthClientSecret) {
      const token = await getOAuthToken(ssgBaseUrl, credentials.oauthClientId, credentials.oauthClientSecret);
      builder.withHeader('Authorization', `Bearer ${token}`);
    } else if (credentials.certificateContent && credentials.privateKeyContent) {
      builder.withCertificate(credentials.certificateContent, credentials.privateKeyContent);
    }

    const httpClient = new HttpClient(ssgBaseUrl, {
      'Accept': 'application/json',
    });

    const httpResponse = await httpClient.request(builder.build());
    console.log(`📋 SSG View Claim [${app || 'default'}] response [${httpResponse.status}]:`, JSON.stringify(httpResponse.data));

    if (httpResponse.status !== 200) {
      return res.status(httpResponse.status).json({ success: false, error: `SSG error ${httpResponse.status}`, details: httpResponse.data });
    }

    return res.status(200).json({ success: true, data: httpResponse.data });
  } catch (error) {
    console.error('❌ View Claim error:', error);
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
