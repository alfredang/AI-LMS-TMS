import type { NextApiRequest, NextApiResponse } from 'next';
import pool from '@lib/db';
import { invalidateGmailSenderCache } from '../../../../lib/gmailOauthSend';
import { invalidateGoogleAuthCache } from '../../../../lib/google-auth/googleAuth';
import { getGoogleOauthRedirectUri } from '../../../../lib/googleOauthRenew';

// GET /api/integrations/google/oauth-callback — Google OAuth redirect target
// for the "Renew via Google Sign-In" flow. Public by design (the browser
// arrives here from accounts.google.com without a Bearer token); protected by
// the single-use `state` nonce minted by the admin-only oauth-start route.
// Exchanges the code and overwrites training_provider.google_refresh_token.

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { code, state, error: oauthError } = req.query;

  if (oauthError) {
    return res.status(400).send(htmlPage('Google Sign-In Failed', `Google returned: ${oauthError}`, false));
  }
  if (!code || typeof code !== 'string' || !state || typeof state !== 'string') {
    return res.status(400).send(htmlPage('Missing Parameters', 'Google did not return an authorization code/state.', false));
  }

  try {
    // Validate + consume the single-use state (10 minute window).
    const stateRow = await pool.query(
      `DELETE FROM google_oauth_state
        WHERE state = $1 AND created_at > now() - interval '10 minutes'
        RETURNING state`,
      [state]
    );
    if (stateRow.rowCount === 0) {
      return res.status(400).send(htmlPage(
        'Sign-In Expired',
        'This sign-in link is invalid or expired. Please click "Renew via Google Sign-In" again.',
        false
      ));
    }

    const tp = await pool.query(
      'SELECT google_client_id, google_client_secret, email_user FROM training_provider LIMIT 1'
    );
    const { google_client_id: clientId, google_client_secret: clientSecret, email_user: emailUser } = tp.rows[0] || {};
    if (!clientId || !clientSecret) {
      return res.status(400).send(htmlPage(
        'Not Configured',
        'Google Client ID/Secret are missing in Company Settings → Integration → Google.',
        false
      ));
    }

    const tokenResp = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        code,
        client_id: clientId,
        client_secret: clientSecret,
        redirect_uri: getGoogleOauthRedirectUri(),
        grant_type: 'authorization_code',
      }),
    });
    const data: any = await tokenResp.json().catch(() => ({}));

    if (!tokenResp.ok || !data.refresh_token) {
      const why = data.error_description || data.error || `HTTP ${tokenResp.status}`;
      return res.status(400).send(htmlPage(
        'Token Exchange Failed',
        `${escapeHtml(String(why))}. Check that this exact redirect URI is registered on the OAuth client in Google Cloud Console: ${escapeHtml(getGoogleOauthRedirectUri())}`,
        false
      ));
    }

    // Which mailbox actually signed in? (id_token payload, no verification
    // needed — it came straight from Google's token endpoint over TLS.)
    let signedInEmail = '';
    if (data.id_token) {
      try {
        const payload = String(data.id_token).split('.')[1];
        const claims = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
        signedInEmail = String(claims.email || '');
      } catch { /* non-fatal */ }
    }

    await pool.query(
      'UPDATE training_provider SET google_refresh_token = $1, updated_at = now()',
      [data.refresh_token]
    );
    invalidateGmailSenderCache();
    invalidateGoogleAuthCache();
    console.log(`✅ [google-oauth] Refresh token renewed via Google Sign-In${signedInEmail ? ` by ${signedInEmail}` : ''}`);

    const mismatch = signedInEmail && emailUser && signedInEmail.toLowerCase() !== String(emailUser).toLowerCase()
      ? `<br><br><strong style="color:#f59e0b">Warning:</strong> you signed in as ${escapeHtml(signedInEmail)} but the configured Email User is ${escapeHtml(String(emailUser))}. Mail will send as the signed-in account — sign in again with the right mailbox, or update Email User to match.`
      : '';

    return res.status(200).send(htmlPage(
      'Google Token Renewed',
      `New refresh token saved${signedInEmail ? ` for ${escapeHtml(signedInEmail)}` : ''}. Gmail, Drive, Slides and Calendar integrations are live again. You can close this window.${mismatch}`,
      true
    ));
  } catch (error) {
    console.error('❌ [google-oauth] Callback error:', error);
    return res.status(500).send(htmlPage(
      'Renewal Failed',
      error instanceof Error ? escapeHtml(error.message) : 'Unexpected error',
      false
    ));
  }
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function htmlPage(title: string, message: string, success: boolean): string {
  const color = success ? '#16a34a' : '#dc2626';
  const icon = success ? '&#10004;' : '&#10008;';
  return `<!DOCTYPE html>
<html><head><title>${title}</title></head>
<body style="font-family:system-ui;display:flex;justify-content:center;align-items:center;min-height:100vh;background:#0f172a;color:white;margin:0">
  <div style="text-align:center;max-width:560px;padding:40px">
    <div style="font-size:64px;color:${color};margin-bottom:16px">${icon}</div>
    <h1 style="margin:0 0 12px">${title}</h1>
    <p style="color:#cbd5e1;line-height:1.6">${message}</p>
    <button onclick="window.close()" style="margin-top:24px;padding:10px 24px;background:#2563eb;color:white;border:none;border-radius:8px;font-size:14px;cursor:pointer">Close Window</button>
  </div>
</body></html>`;
}
