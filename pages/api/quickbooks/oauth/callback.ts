import type { NextApiRequest, NextApiResponse } from 'next';
import pool from '../../../../lib/db';
import { getQboRedirectUri } from '../../../../lib/quickbooks/qboRedirect';

/**
 * GET /api/quickbooks/oauth/callback
 * Handles the OAuth redirect from Intuit, exchanges the authorization code
 * for access + refresh tokens, and saves the refresh token to the database.
 */

const QBO_TOKEN_URL = 'https://oauth.platform.intuit.com/oauth2/v1/tokens/bearer';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { code, state, realmId, error: oauthError } = req.query;

  if (oauthError) {
    return res.status(400).send(htmlPage('Authorization Failed', `QuickBooks returned an error: ${oauthError}`, false));
  }

  if (!code || !realmId) {
    return res.status(400).send(htmlPage('Missing Parameters', 'Missing authorization code or realmId.', false));
  }

  // Determine which app from state (e.g. "app1_1713200000000")
  const app = typeof state === 'string' && state.startsWith('app2') ? 'app2' : 'app1';

  // Get client credentials from DB
  const clientIdKey = app === 'app2' ? 'QUICKBOOKS_APP2_CLIENT_ID' : 'QUICKBOOKS_APP1_CLIENT_ID';
  const clientSecretKey = app === 'app2' ? 'QUICKBOOKS_APP2_CLIENT_SECRET' : 'QUICKBOOKS_APP1_CLIENT_SECRET';

  const credsResult = await pool.query(
    `SELECT key_name, key_value FROM training_provider_api WHERE key_name IN ($1, $2) LIMIT 2`,
    [clientIdKey, clientSecretKey]
  );
  const credsMap: Record<string, string> = {};
  for (const row of credsResult.rows) credsMap[row.key_name] = row.key_value;

  const clientId = credsMap[clientIdKey] || process.env.QBO_CLIENT_ID;
  const clientSecret = credsMap[clientSecretKey] || process.env.QBO_CLIENT_SECRET;

  if (!clientId || !clientSecret) {
    return res.status(500).send(htmlPage('Configuration Error', 'QuickBooks client credentials not found.', false));
  }

  // Must match the redirect URI used in /connect (same resolver) and registered
  // in Intuit Developer portal. Resolved from Company Setting → QuickBooks (DB),
  // env, or computed default.
  const redirectUri = await getQboRedirectUri();

  // Exchange authorization code for tokens
  try {
    const tokenRes = await fetch(QBO_TOKEN_URL, {
      method: 'POST',
      headers: {
        'Authorization': `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString('base64')}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: `grant_type=authorization_code&code=${encodeURIComponent(code as string)}&redirect_uri=${encodeURIComponent(redirectUri)}`,
    });

    if (!tokenRes.ok) {
      const errText = await tokenRes.text();
      console.error('Token exchange failed:', errText);
      return res.status(500).send(htmlPage('Token Exchange Failed', `Intuit returned ${tokenRes.status}: ${errText}`, false));
    }

    const tokenData = await tokenRes.json();
    const refreshToken = tokenData.refresh_token;
    const accessToken = tokenData.access_token;

    if (!refreshToken) {
      return res.status(500).send(htmlPage('No Refresh Token', 'Token response did not include a refresh token.', false));
    }

    // Get training provider ID
    const tpResult = await pool.query(`SELECT id FROM training_provider ORDER BY created_at DESC LIMIT 1`);
    const tpId = tpResult.rows[0]?.id;
    if (!tpId) {
      return res.status(500).send(htmlPage('Error', 'No training provider found.', false));
    }

    // Save refresh token and realm ID
    const refreshTokenKey = app === 'app2' ? 'QUICKBOOKS_APP2_REFRESH_TOKEN' : 'QUICKBOOKS_APP1_REFRESH_TOKEN';
    const upserts = [
      { key: refreshTokenKey, value: refreshToken },
      { key: 'QUICKBOOKS_REFRESH_TOKEN', value: refreshToken },
      { key: 'QUICKBOOKS_REALM_ID', value: realmId as string },
    ];

    for (const { key, value } of upserts) {
      const existing = await pool.query(
        `SELECT id FROM training_provider_api WHERE training_provider_id = $1 AND key_name = $2 LIMIT 1`,
        [tpId, key]
      );
      if (existing.rows.length > 0) {
        await pool.query(
          `UPDATE training_provider_api SET key_value = $1, updated_at = now() WHERE id = $2`,
          [value, existing.rows[0].id]
        );
      } else {
        await pool.query(
          `INSERT INTO training_provider_api (training_provider_id, key_name, key_value) VALUES ($1, $2, $3)`,
          [tpId, key, value]
        );
      }
    }

    return res.status(200).send(htmlPage(
      'QuickBooks Connected!',
      `Refresh token saved for ${app.toUpperCase()}. Realm ID: ${realmId}. You can close this window.`,
      true
    ));
  } catch (err: any) {
    console.error('OAuth callback error:', err);
    return res.status(500).send(htmlPage('Error', err.message || 'Unexpected error during token exchange.', false));
  }
}

function htmlPage(title: string, message: string, success: boolean): string {
  const color = success ? '#22c55e' : '#ef4444';
  const icon = success ? '&#10004;' : '&#10008;';
  return `<!DOCTYPE html>
<html><head><title>${title}</title></head>
<body style="font-family:system-ui;display:flex;justify-content:center;align-items:center;min-height:100vh;background:#0f172a;color:white;margin:0">
  <div style="text-align:center;max-width:500px;padding:40px">
    <div style="font-size:64px;color:${color};margin-bottom:16px">${icon}</div>
    <h1 style="margin:0 0 12px">${title}</h1>
    <p style="color:#94a3b8;line-height:1.6">${message}</p>
    <button onclick="window.close()" style="margin-top:24px;padding:10px 24px;background:#3b82f6;color:white;border:none;border-radius:8px;font-size:14px;cursor:pointer">Close Window</button>
  </div>
</body></html>`;
}
