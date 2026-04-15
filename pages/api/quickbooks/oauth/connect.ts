import type { NextApiRequest, NextApiResponse } from 'next';
import pool from '../../../../lib/db';

/**
 * GET /api/quickbooks/oauth/connect?app=app1
 * Redirects the user to Intuit's OAuth authorization page.
 */

const QBO_AUTH_URL = 'https://appcenter.intuit.com/connect/oauth2';
const SCOPES = 'com.intuit.quickbooks.accounting';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const app = (req.query.app as string) || 'app1';

  // Get client ID from DB
  const keyName = app === 'app2' ? 'QUICKBOOKS_APP2_CLIENT_ID' : 'QUICKBOOKS_APP1_CLIENT_ID';
  const result = await pool.query(
    `SELECT key_value FROM training_provider_api WHERE key_name = $1 LIMIT 1`,
    [keyName]
  );

  const clientId = result.rows[0]?.key_value || process.env.QBO_CLIENT_ID;
  if (!clientId) {
    return res.status(400).json({ error: 'QuickBooks Client ID not configured.' });
  }

  // Determine redirect URI based on host
  const protocol = req.headers['x-forwarded-proto'] || 'https';
  const host = req.headers['x-forwarded-host'] || req.headers.host;
  const redirectUri = `${protocol}://${host}/api/quickbooks/oauth/callback`;

  const state = `${app}_${Date.now()}`;

  const authUrl = `${QBO_AUTH_URL}?client_id=${encodeURIComponent(clientId)}&response_type=code&scope=${encodeURIComponent(SCOPES)}&redirect_uri=${encodeURIComponent(redirectUri)}&state=${encodeURIComponent(state)}`;

  res.redirect(authUrl);
}
