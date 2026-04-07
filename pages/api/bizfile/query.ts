import type { NextApiRequest, NextApiResponse } from 'next';
import pool from '../../../lib/db';

/**
 * GET /api/bizfile/query?endpoint=entityVerification&uen=xxx
 * GET /api/bizfile/query?endpoint=entityBasicInformation&uen=xxx
 * GET /api/bizfile/query?endpoint=entityNameSearch&name=xxx
 * GET /api/bizfile/query?endpoint=businessProfile&uen=xxx
 *
 * Proxies requests to Bizfile ACRA API with OAuth token.
 */

const BIZFILE_BASE_URL = 'https://api.bizfile.gov.sg';
const BIZFILE_TOKEN_URL = `${BIZFILE_BASE_URL}/authorizeServer/oauth/token?grant_type=client_credentials`;

let cachedToken: { token: string; expiresAt: number } | null = null;

async function getBizfileToken(clientId: string, clientSecret: string): Promise<string> {
  if (cachedToken && Date.now() < cachedToken.expiresAt) {
    return cachedToken.token;
  }

  const basic = Buffer.from(`${clientId}:${clientSecret}`).toString('base64');
  const resp = await fetch(BIZFILE_TOKEN_URL, {
    method: 'POST',
    headers: { 'Authorization': `Basic ${basic}` },
  });

  if (!resp.ok) {
    const text = await resp.text();
    throw new Error(`Bizfile token request failed: ${resp.status} ${text}`);
  }

  const data = await resp.json();
  cachedToken = {
    token: data.access_token,
    expiresAt: Date.now() + (data.expires_in ? data.expires_in * 1000 - 60000 : 3300000), // 55 min default
  };
  return cachedToken.token;
}

async function getBizfileCredentials(): Promise<{ clientId: string; clientSecret: string } | null> {
  try {
    const result = await pool.query(
      `SELECT a.key_value, a.key_name
       FROM training_provider_api a
       JOIN training_provider tp ON tp.id = a.training_provider_id
       WHERE a.key_name IN ('BIZFILE_CLIENT_ID', 'BIZFILE_CLIENT_SECRET')
       LIMIT 2`
    );
    if (result.rows.length > 0) {
      const map: Record<string, string> = {};
      for (const row of result.rows) {
        map[row.key_name] = row.key_value;
      }
      if (map.BIZFILE_CLIENT_ID && map.BIZFILE_CLIENT_SECRET) {
        return { clientId: map.BIZFILE_CLIENT_ID, clientSecret: map.BIZFILE_CLIENT_SECRET };
      }
    }
  } catch (err) {
    console.warn('Could not fetch Bizfile credentials from DB:', err);
  }

  // Fallback to env vars
  const clientId = process.env.BIZFILE_CLIENT_ID;
  const clientSecret = process.env.BIZFILE_CLIENT_SECRET;
  if (clientId && clientSecret) {
    return { clientId, clientSecret };
  }

  return null;
}

const ALLOWED_ENDPOINTS = [
  'entityVerification',
  'entityNameSearch',
  'entityBasicInformation',
  'businessProfile',
  'entitySearch',
  'entityRegistrationKeyDates',
  'entityRegisteredAddress',
  'entitySsicDetails',
  'companyCapitalDetails',
  'companyShareholdersDetails',
];

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { endpoint, ...params } = req.query;

  if (!endpoint || typeof endpoint !== 'string' || !ALLOWED_ENDPOINTS.includes(endpoint)) {
    return res.status(400).json({
      success: false,
      error: `Invalid endpoint. Allowed: ${ALLOWED_ENDPOINTS.join(', ')}`,
    });
  }

  try {
    const creds = await getBizfileCredentials();
    if (!creds) {
      return res.status(500).json({ success: false, error: 'Bizfile credentials not configured. Set them in Company Settings > Credentials > Bizfile.' });
    }

    const token = await getBizfileToken(creds.clientId, creds.clientSecret);
    console.log(`[bizfile] Token obtained (first 20 chars): ${token?.substring(0, 20)}...`);

    // Build query string from remaining params
    const queryParams = new URLSearchParams();
    for (const [key, value] of Object.entries(params)) {
      if (value && typeof value === 'string') {
        queryParams.set(key, value);
      }
    }

    const url = `${BIZFILE_BASE_URL}/api/acra/entityQuery/${endpoint}?${queryParams}`;
    console.log(`[bizfile] Requesting: ${url}`);

    // Try with 'token' header first (per Bizfile docs), fallback headers if needed
    const apiResp = await fetch(url, {
      method: 'GET',
      headers: {
        'token': token,
        'Authorization': `Bearer ${token}`,
        'Accept': 'application/json',
      },
    });

    const rawText = await apiResp.text();
    let data: any = null;
    try { data = JSON.parse(rawText); } catch { data = rawText; }

    console.log(`📋 Bizfile ${endpoint} [${apiResp.status}]:`, typeof data === 'string' ? data.substring(0, 500) : JSON.stringify(data));

    if (!apiResp.ok) {
      const detailMsg = typeof data === 'string' ? data : data?.message || data?.error || JSON.stringify(data);
      const isSubscription = detailMsg?.includes('subscription not found');
      return res.status(apiResp.status).json({
        success: false,
        error: isSubscription
          ? 'Bizfile API subscription not found. Please subscribe to the EIQ API at bizfile.gov.sg/apimarketplace/data-api/eiq'
          : `Bizfile API error ${apiResp.status}: ${detailMsg}`,
        details: data,
      });
    }

    return res.status(200).json({ success: true, data });
  } catch (error) {
    console.error('❌ Bizfile query error:', error);
    return res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Internal server error',
    });
  }
}
