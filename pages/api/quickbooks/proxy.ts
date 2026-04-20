import type { NextApiRequest, NextApiResponse } from 'next';
import pool from '../../../lib/db';

/**
 * POST /api/quickbooks/proxy
 * Proxies requests to QuickBooks Online API with OAuth 2.0.
 * Body: { action, entity, id?, query?, body?, sendTo? }
 *
 * Actions: query, create, send, delete, void, pdf, read
 * Entities: estimate, invoice, payment
 */

const QBO_BASE_URL = process.env.QBO_BASE_URL || 'https://quickbooks.api.intuit.com';
const QBO_TOKEN_URL = 'https://oauth.platform.intuit.com/oauth2/v1/tokens/bearer';
const MINOR_VERSION = '75';

interface QBOCredentials {
  clientId: string;
  clientSecret: string;
  refreshToken: string;
  realmId: string;
  accessToken?: string;
  accessTokenExpiry?: number;
}

type QBOCredentialsResolved = QBOCredentials & {
  selectedApp?: 'app1' | 'app2';
  refreshTokenKeyName?: 'QUICKBOOKS_REFRESH_TOKEN' | 'QUICKBOOKS_APP1_REFRESH_TOKEN' | 'QUICKBOOKS_APP2_REFRESH_TOKEN';
  fallbackRefreshToken?: string;
};

type CachedAccessToken = {
  accessToken: string;
  accessTokenExpiry: number;
};

const accessTokenByCredsKey = new Map<string, CachedAccessToken>();
const inFlightTokenByCredsKey = new Map<string, Promise<string>>();

async function getQBOCredentials(appOverride?: string): Promise<QBOCredentialsResolved | null> {
  try {
    const result = await pool.query(
      `SELECT a.key_name, a.key_value
       FROM training_provider_api a
       JOIN training_provider tp ON tp.id = a.training_provider_id
       WHERE a.key_name IN (
         'QUICKBOOKS_APP1_CLIENT_ID', 'QUICKBOOKS_APP1_CLIENT_SECRET',
         'QUICKBOOKS_APP2_CLIENT_ID', 'QUICKBOOKS_APP2_CLIENT_SECRET',
         'QUICKBOOKS_REFRESH_TOKEN',
         'QUICKBOOKS_APP1_REFRESH_TOKEN', 'QUICKBOOKS_APP2_REFRESH_TOKEN',
         'QUICKBOOKS_REALM_ID', 'QUICKBOOKS_DEFAULT_APP'
       )
       LIMIT 10`
    );
    const map: Record<string, string> = {};
    for (const row of result.rows) map[row.key_name] = row.key_value;

    const selectedApp = (appOverride || map.QUICKBOOKS_DEFAULT_APP || 'app1') as 'app1' | 'app2';
    const clientId = selectedApp === 'app2' ? map.QUICKBOOKS_APP2_CLIENT_ID : map.QUICKBOOKS_APP1_CLIENT_ID;
    const clientSecret = selectedApp === 'app2' ? map.QUICKBOOKS_APP2_CLIENT_SECRET : map.QUICKBOOKS_APP1_CLIENT_SECRET;
    const appSpecificRefreshToken = selectedApp === 'app2' ? map.QUICKBOOKS_APP2_REFRESH_TOKEN : map.QUICKBOOKS_APP1_REFRESH_TOKEN;
    const globalRefreshToken = map.QUICKBOOKS_REFRESH_TOKEN;
    const refreshToken = appSpecificRefreshToken || globalRefreshToken;
    const realmId = map.QUICKBOOKS_REALM_ID;

    if (clientId && clientSecret && refreshToken && realmId) {
      const refreshTokenKeyName: QBOCredentialsResolved['refreshTokenKeyName'] =
        appSpecificRefreshToken ? (selectedApp === 'app2' ? 'QUICKBOOKS_APP2_REFRESH_TOKEN' : 'QUICKBOOKS_APP1_REFRESH_TOKEN') : 'QUICKBOOKS_REFRESH_TOKEN';
      const fallbackRefreshToken = appSpecificRefreshToken && globalRefreshToken && globalRefreshToken !== appSpecificRefreshToken
        ? globalRefreshToken
        : undefined;
      return { clientId, clientSecret, refreshToken, realmId, selectedApp, refreshTokenKeyName, fallbackRefreshToken };
    }
  } catch (err) {
    console.warn('Could not fetch QBO credentials from DB:', err);
  }

  // Fallback to env vars
  const clientId = process.env.QBO_CLIENT_ID;
  const clientSecret = process.env.QBO_CLIENT_SECRET;
  const refreshToken = process.env.QBO_REFRESH_TOKEN;
  const realmId = process.env.QBO_REALM_ID;
  if (clientId && clientSecret && refreshToken && realmId) {
    return { clientId, clientSecret, refreshToken, realmId, refreshTokenKeyName: 'QUICKBOOKS_REFRESH_TOKEN' };
  }
  return null;
}

function credsCacheKey(creds: QBOCredentialsResolved): string {
  // Key by clientId+realmId+refreshToken so app1/app2 tokens never mix.
  return `${creds.clientId}|${creds.realmId}|${creds.refreshToken}`;
}

async function refreshAccessToken(creds: QBOCredentialsResolved, refreshTokenToUse: string): Promise<any> {
  const basic = Buffer.from(`${creds.clientId}:${creds.clientSecret}`).toString('base64');
  const resp = await fetch(QBO_TOKEN_URL, {
    method: 'POST',
    headers: {
      'Authorization': `Basic ${basic}`,
      'Content-Type': 'application/x-www-form-urlencoded',
      'Accept': 'application/json',
    },
    body: `grant_type=refresh_token&refresh_token=${encodeURIComponent(refreshTokenToUse)}`,
  });

  if (!resp.ok) {
    const text = await resp.text();
    throw new Error(`QBO token refresh failed: ${resp.status} ${text}`);
  }

  return await resp.json();
}

async function maybePersistRotatedRefreshToken(creds: QBOCredentialsResolved, newRefreshToken: string) {
  const keyName = creds.refreshTokenKeyName || 'QUICKBOOKS_REFRESH_TOKEN';
  try {
    await pool.query(
      `UPDATE training_provider_api SET key_value = $1 WHERE key_name = $2`,
      [newRefreshToken, keyName]
    );
    console.log(`[qbo] Refresh token updated in DB (${keyName})`);
  } catch (err) {
    console.warn('[qbo] Failed to update refresh token:', err);
  }
}

async function getAccessToken(creds: QBOCredentialsResolved): Promise<string> {
  const key = credsCacheKey(creds);
  const cached = accessTokenByCredsKey.get(key);
  if (cached && Date.now() < cached.accessTokenExpiry) return cached.accessToken;

  const inflight = inFlightTokenByCredsKey.get(key);
  if (inflight) return inflight;

  const p = (async () => {
    // 1) Try app-specific / selected refresh token
    try {
      const data = await refreshAccessToken(creds, creds.refreshToken);
      if (data.refresh_token && data.refresh_token !== creds.refreshToken) {
        await maybePersistRotatedRefreshToken(creds, data.refresh_token);
      }

      const accessToken = data.access_token;
      const accessTokenExpiry = Date.now() + (data.expires_in ? data.expires_in * 1000 - 60000 : 3300000);
      accessTokenByCredsKey.set(key, { accessToken, accessTokenExpiry });
      return accessToken;
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      // 2) If invalid_grant and we have a fallback refresh token, retry once with it.
      if (creds.fallbackRefreshToken && msg.includes('invalid_grant')) {
        const data = await refreshAccessToken(creds, creds.fallbackRefreshToken);
        if (data.refresh_token && data.refresh_token !== creds.fallbackRefreshToken) {
          // Persist to GLOBAL token key, because fallback is the global token by definition.
          await maybePersistRotatedRefreshToken({ ...creds, refreshTokenKeyName: 'QUICKBOOKS_REFRESH_TOKEN' }, data.refresh_token);
        }
        const accessToken = data.access_token;
        const accessTokenExpiry = Date.now() + (data.expires_in ? data.expires_in * 1000 - 60000 : 3300000);
        accessTokenByCredsKey.set(key, { accessToken, accessTokenExpiry });
        return accessToken;
      }
      throw e;
    }
  })();

  inFlightTokenByCredsKey.set(key, p);
  try {
    return await p;
  } finally {
    inFlightTokenByCredsKey.delete(key);
  }
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { action, entity, id, query, body: reqBody, sendTo, app: appOverride } = req.body;

  if (!action || !entity) {
    return res.status(400).json({ success: false, error: 'action and entity are required.' });
  }

  try {
    const creds = await getQBOCredentials(appOverride);
    if (!creds) {
      return res.status(500).json({ success: false, error: 'QuickBooks credentials not configured. Set Client ID, Client Secret, Refresh Token, and Realm ID in Company Settings.' });
    }

    const token = await getAccessToken(creds);
    const baseUrl = `${QBO_BASE_URL}/v3/company/${creds.realmId}`;
    let url: string;
    let method: string = 'GET';
    let headers: Record<string, string> = {
      'Authorization': `Bearer ${token}`,
      'Accept': 'application/json',
      'Content-Type': 'application/json',
    };
    let fetchBody: string | undefined;

    switch (action) {
      case 'query': {
        const q = query || `SELECT * FROM ${capitalize(entity)} MAXRESULTS 100`;
        url = `${baseUrl}/query?query=${encodeURIComponent(q)}&minorversion=${MINOR_VERSION}`;
        method = 'GET';
        break;
      }
      case 'create': {
        url = `${baseUrl}/${entity}?minorversion=${MINOR_VERSION}`;
        method = 'POST';
        fetchBody = JSON.stringify(reqBody);
        break;
      }
      case 'send': {
        if (!id) return res.status(400).json({ success: false, error: 'id is required for send.' });
        url = `${baseUrl}/${entity}/${id}/send${sendTo ? `?sendTo=${encodeURIComponent(sendTo)}` : ''}${sendTo ? '&' : '?'}minorversion=${MINOR_VERSION}`;
        method = 'POST';
        break;
      }
      case 'delete': {
        url = `${baseUrl}/${entity}?operation=delete&minorversion=${MINOR_VERSION}`;
        method = 'POST';
        fetchBody = JSON.stringify(reqBody);
        break;
      }
      case 'void': {
        url = `${baseUrl}/${entity}?operation=void&minorversion=${MINOR_VERSION}`;
        method = 'POST';
        fetchBody = JSON.stringify(reqBody);
        break;
      }
      case 'pdf': {
        if (!id) return res.status(400).json({ success: false, error: 'id is required for pdf.' });
        url = `${baseUrl}/${entity}/${id}/pdf?minorversion=${MINOR_VERSION}`;
        method = 'GET';
        headers['Accept'] = 'application/pdf';
        const pdfResp = await fetch(url, { method, headers });
        if (!pdfResp.ok) {
          const errText = await pdfResp.text();
          return res.status(pdfResp.status).json({ success: false, error: `QBO error ${pdfResp.status}`, details: errText });
        }
        const pdfBuffer = Buffer.from(await pdfResp.arrayBuffer());
        res.setHeader('Content-Type', 'application/pdf');
        res.setHeader('Content-Disposition', `attachment; filename="${entity}-${id}.pdf"`);
        return res.send(pdfBuffer);
      }
      case 'read': {
        if (!id) return res.status(400).json({ success: false, error: 'id is required for read.' });
        url = `${baseUrl}/${entity}/${id}?minorversion=${MINOR_VERSION}`;
        method = 'GET';
        break;
      }
      default:
        return res.status(400).json({ success: false, error: `Unknown action: ${action}` });
    }

    const apiResp = await fetch(url, {
      method,
      headers,
      body: method === 'POST' ? fetchBody : undefined,
    });

    const data = await apiResp.json().catch(() => null);
    console.log(`📒 QBO ${action} ${entity} [${apiResp.status}]`);

    if (!apiResp.ok) {
      return res.status(apiResp.status).json({
        success: false,
        error: data?.Fault?.Error?.[0]?.Message || `QBO error ${apiResp.status}`,
        details: data,
      });
    }

    return res.status(200).json({ success: true, data });
  } catch (error) {
    console.error('❌ QBO proxy error:', error);
    return res.status(500).json({ success: false, error: error instanceof Error ? error.message : 'Internal server error' });
  }
}

function capitalize(s: string) { return s.charAt(0).toUpperCase() + s.slice(1); }
