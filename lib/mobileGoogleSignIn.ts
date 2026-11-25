// Admin sign-in with Google for the TIA TMS mobile apps (iOS and Android).
//
// Reuses the training provider's own Google OAuth client and its already registered
// redirect URI (/api/integrations/google/oauth-callback), so nothing changes in Google
// Cloud. The flow:
//   1. The app makes a random verifier and opens
//      GET /api/mobile/google-start?challenge=<sha256 hex of the verifier>.
//   2. We store a single-use state bound to that challenge and send the browser to Google
//      (scopes openid + email only; this never touches the stored refresh token).
//   3. Google returns to the shared callback; a state starting with "m_" is handed here.
//      We read the signed-in email, accept only allow-listed admin accounts that are
//      active here, and return to the app's scheme with a single-use two-minute code.
//      No web session is created.
//   4. The app posts code + verifier to /api/mobile/google-exchange and receives the same
//      session token as the email-code sign-in.
import type { NextApiRequest, NextApiResponse } from 'next';
import crypto from 'node:crypto';
import pool from './db';
import { createSession } from './auth/session';
import { loadAppRoles } from './mobile/roles';
import { getGoogleOauthRedirectUri } from './googleOauthRenew';

export const MOBILE_STATE_PREFIX = 'm_';
const APP_SCHEME = 'tiatms';
const APP_CALLBACK = `${APP_SCHEME}://auth`;

/** The academy's admins who may use admin sign-in in the apps (each also holds Admin on the website). */
export const MOBILE_ADMIN_GOOGLE_EMAILS = [
  'angch@tertiaryinfotech.com',
  'danny@tertiaryinfotech.com',
  'deepa@tertiaryinfotech.com',
  'angss@tertiaryinfotech.com',
  'tansc@tertiaryinfotech.com',
];

/** Who may use admin sign-in: the list above plus any in env MOBILE_ADMIN_GOOGLE_EMAILS (comma separated). */
export function mobileAdminEmails(): string[] {
  const extra = (process.env.MOBILE_ADMIN_GOOGLE_EMAILS || '').split(',');
  return [...new Set([...MOBILE_ADMIN_GOOGLE_EMAILS, ...extra].map(s => s.trim().toLowerCase()).filter(Boolean))];
}

let schema: Promise<unknown> | undefined;
function ensure() {
  return (schema ||= pool.query(`CREATE TABLE IF NOT EXISTS mobile_google_signin (
    state text PRIMARY KEY,
    challenge text NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    code_digest text UNIQUE,
    user_id uuid REFERENCES app_user(id) ON DELETE CASCADE,
    code_expires_at timestamptz
  )`).catch(e => { schema = undefined; throw e; }));
}

const sha256 = (s: string) => crypto.createHash('sha256').update(s).digest('hex');

function back(res: NextApiResponse, params: Record<string, string>) {
  res.setHeader('Cache-Control', 'no-store');
  res.redirect(302, `${APP_CALLBACK}?${new URLSearchParams(params).toString()}`);
}

/** GET /api/mobile/google-start?challenge= */
export async function startMobileGoogleSignIn(req: NextApiRequest, res: NextApiResponse) {
  const challenge = typeof req.query.challenge === 'string' ? req.query.challenge.toLowerCase() : '';
  if (!/^[0-9a-f]{64}$/.test(challenge)) return back(res, { error: 'Google sign-in could not start. Please try again.' });
  try {
    const tp = await pool.query('SELECT google_client_id FROM training_provider LIMIT 1');
    const clientId = tp.rows[0]?.google_client_id;
    if (!clientId) return back(res, { error: 'Admin sign-in with Google is not available right now.' });
    await ensure();
    await pool.query(`DELETE FROM mobile_google_signin WHERE created_at < now() - interval '1 hour'`);
    const state = MOBILE_STATE_PREFIX + crypto.randomBytes(24).toString('hex');
    await pool.query('INSERT INTO mobile_google_signin (state, challenge) VALUES ($1, $2)', [state, challenge]);
    const params = new URLSearchParams({
      response_type: 'code',
      client_id: clientId,
      redirect_uri: getGoogleOauthRedirectUri(),
      scope: 'openid email',
      prompt: 'select_account',
      state,
    });
    const admins = mobileAdminEmails();
    if (admins.length === 1) params.set('login_hint', admins[0]);
    res.setHeader('Cache-Control', 'no-store');
    return res.redirect(302, `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`);
  } catch {
    return back(res, { error: 'Google sign-in could not start. Please try again.' });
  }
}

/** Called by the shared Google callback when the state carries MOBILE_STATE_PREFIX. */
export async function finishMobileGoogleSignIn(req: NextApiRequest, res: NextApiResponse) {
  const { code, state, error: oauthError } = req.query;
  if (typeof state !== 'string') return back(res, { error: 'Google sign-in did not complete. Please try again.' });
  try {
    await ensure();
    // Claim the state atomically (10 minute window): a replayed callback finds it taken.
    const row = (await pool.query(
      `UPDATE mobile_google_signin SET code_digest = 'pending-' || state
        WHERE state = $1 AND code_digest IS NULL AND created_at > now() - interval '10 minutes'
        RETURNING state`, [state])).rows[0];
    if (!row) return back(res, { error: 'This sign-in expired. Please try again.' });
    if (oauthError || typeof code !== 'string') {
      await pool.query('DELETE FROM mobile_google_signin WHERE state = $1', [state]);
      return back(res, { error: oauthError === 'access_denied' ? 'Sign-in was cancelled.' : 'Google sign-in did not complete. Please try again.' });
    }

    const tp = await pool.query('SELECT google_client_id, google_client_secret FROM training_provider LIMIT 1');
    const { google_client_id: clientId, google_client_secret: clientSecret } = tp.rows[0] || {};
    if (!clientId || !clientSecret) return back(res, { error: 'Admin sign-in with Google is not available right now.' });
    const tokenResp = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        code, client_id: clientId, client_secret: clientSecret,
        redirect_uri: getGoogleOauthRedirectUri(), grant_type: 'authorization_code',
      }),
    });
    const data: any = await tokenResp.json().catch(() => ({}));
    // The id_token comes straight from Google's token endpoint over TLS.
    let email = '';
    let verified = false;
    try {
      const claims = JSON.parse(Buffer.from(String(data.id_token).split('.')[1], 'base64url').toString('utf8'));
      if (claims.aud === clientId) {
        email = String(claims.email || '').toLowerCase();
        verified = claims.email_verified === true || claims.email_verified === 'true';
      }
    } catch { /* handled below */ }
    if (!tokenResp.ok || !email || !verified) {
      await pool.query('DELETE FROM mobile_google_signin WHERE state = $1', [state]);
      return back(res, { error: 'Google sign-in did not complete. Please try again.' });
    }
    if (!mobileAdminEmails().includes(email)) {
      await pool.query('DELETE FROM mobile_google_signin WHERE state = $1', [state]);
      return back(res, { error: `Admin sign-in is not available for ${email}. Sign in with your email code instead.` });
    }
    const user = (await pool.query(
      `SELECT id FROM app_user WHERE lower(email) = $1 AND lower(coalesce(account_status,'active')) = 'active' LIMIT 1`, [email])).rows[0];
    if (!user) {
      await pool.query('DELETE FROM mobile_google_signin WHERE state = $1', [state]);
      return back(res, { error: 'There is no active account for this Google address.' });
    }
    const handoff = crypto.randomBytes(32).toString('hex');
    await pool.query(
      `UPDATE mobile_google_signin SET code_digest = $2, user_id = $3, code_expires_at = now() + interval '2 minutes'
        WHERE state = $1`, [state, sha256(handoff), user.id]);
    return back(res, { code: handoff });
  } catch {
    return back(res, { error: 'Google sign-in did not complete. Please try again.' });
  }
}

/** POST /api/mobile/google-exchange { code, verifier } */
export async function exchangeMobileGoogleCode(req: NextApiRequest, res: NextApiResponse) {
  res.setHeader('Cache-Control', 'no-store');
  const { code, verifier } = req.body || {};
  if (typeof code !== 'string' || !/^[0-9a-f]{64}$/.test(code) || typeof verifier !== 'string' || verifier.length < 32 || verifier.length > 256) {
    return res.status(400).json({ error: 'Google sign-in did not complete. Please try again.' });
  }
  try {
    await ensure();
    // Single use: the row is deleted whether or not the verifier matches.
    const row = (await pool.query(
      `DELETE FROM mobile_google_signin WHERE code_digest = $1 RETURNING challenge, user_id, code_expires_at`, [sha256(code)])).rows[0];
    if (!row || !row.user_id || new Date(row.code_expires_at) <= new Date()) {
      return res.status(401).json({ error: 'This sign-in expired. Please try again.' });
    }
    const a = Buffer.from(sha256(verifier), 'hex');
    const b = Buffer.from(String(row.challenge), 'hex');
    if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
      return res.status(401).json({ error: 'Google sign-in did not complete. Please try again.' });
    }
    const u = (await pool.query(
      `SELECT id, email, full_name AS "fullName" FROM app_user WHERE id = $1 AND lower(coalesce(account_status,'active')) = 'active'`, [row.user_id])).rows[0];
    if (!u || !mobileAdminEmails().includes(String(u.email).toLowerCase())) {
      return res.status(403).json({ error: 'Admin sign-in is not available for this account.' });
    }
    const roles = await loadAppRoles(u.id);
    if (!roles.length) return res.status(403).json({ error: 'This app is for learners and trainers. Your account has neither role.' });
    const token = await createSession(u.id);
    return res.json({ data: { user: { ...u, role: roles[0], roles }, token } });
  } catch {
    return res.status(500).json({ error: 'Sign in is temporarily unavailable. Please try again.' });
  }
}
