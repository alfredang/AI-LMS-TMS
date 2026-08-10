import type { NextApiRequest, NextApiResponse } from 'next';
import crypto from 'crypto';
import { withAuth } from '@lib/auth/withAuth';
import pool from '@lib/db';
import { getGoogleOauthRedirectUri, GOOGLE_OAUTH_SCOPES } from '../../../../lib/googleOauthRenew';

// POST /api/integrations/google/oauth-start
// Returns { url } — the Google consent URL the admin opens (popup) to renew
// the Gmail/Drive/Calendar refresh token via sign-in, instead of hand-copying
// a token out of the OAuth Playground. The callback route saves the new token.

async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ success: false, error: 'Method not allowed' });
  }

  const tp = await pool.query(
    'SELECT google_client_id, email_user FROM training_provider LIMIT 1'
  );
  const clientId = tp.rows[0]?.google_client_id;
  if (!clientId) {
    return res.status(400).json({
      success: false,
      error: 'Save a Google Client ID in Company Settings → Integration → Google first — the sign-in flow needs it.',
    });
  }

  // Single-use CSRF state, validated (and deleted) by the callback route.
  await pool.query(`
    CREATE TABLE IF NOT EXISTS google_oauth_state (
      state TEXT PRIMARY KEY,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `);
  await pool.query(`DELETE FROM google_oauth_state WHERE created_at < now() - interval '1 hour'`);
  const state = crypto.randomBytes(24).toString('hex');
  await pool.query('INSERT INTO google_oauth_state (state) VALUES ($1)', [state]);

  const params = new URLSearchParams({
    response_type: 'code',
    client_id: clientId,
    redirect_uri: getGoogleOauthRedirectUri(),
    scope: GOOGLE_OAUTH_SCOPES.join(' '),
    access_type: 'offline',
    // prompt=consent forces Google to issue a NEW refresh token even when the
    // account previously consented (a plain re-auth returns no refresh_token).
    prompt: 'consent',
    state,
  });
  if (tp.rows[0]?.email_user) params.set('login_hint', tp.rows[0].email_user);

  return res.status(200).json({
    success: true,
    url: `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`,
    redirectUri: getGoogleOauthRedirectUri(),
  });
}

export default withAuth(handler, { roles: ['admin', 'trainingProvider'] });
