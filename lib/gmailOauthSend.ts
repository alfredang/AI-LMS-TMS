import { google } from 'googleapis';
import pool from './db';
import { loadServiceAccountCredentials } from './google-auth/googleAuth';

// Shared Gmail sender. Two transports, tried in order:
//
// 1. Service account with domain-wide delegation, impersonating email_user
//    (training_provider.google_service_account_json). Permanent — the key
//    never expires and survives password changes on the mailbox account.
//    Requires the SA's client ID to be authorized for the Gmail scope under
//    Workspace Admin → Security → API controls → Domain-wide delegation.
// 2. OAuth2 refresh token from the training_provider row (email_user,
//    google_client_id, google_client_secret, google_refresh_token) — revoked
//    by Google whenever the mailbox password changes, so it's the fallback.
//
// Caller-agnostic: send-otp.ts has its own retry-heavy inline implementation
// kept for OTP latency tuning; this helper exists for everything else
// (notifications, support tickets, etc.) that needs a plain "send via Gmail"
// without depending on Coolify SMTP env vars.

const GMAIL_SEND_SCOPE = 'https://www.googleapis.com/auth/gmail.send';

interface GmailCreds {
  emailUser: string;
  fromName: string;
  // OAuth refresh-token trio — optional: the service-account transport only
  // needs emailUser (the mailbox to impersonate / send From).
  clientId: string | null;
  clientSecret: string | null;
  refreshToken: string | null;
}

interface CachedCreds {
  creds: GmailCreds | null;
  expiresAt: number;
}

let cachedCreds: CachedCreds | null = null;
const CREDS_TTL_MS = 60_000;

let cachedOAuth2Client: InstanceType<typeof google.auth.OAuth2> | null = null;
let cachedOAuth2Key = '';

async function loadCreds(): Promise<GmailCreds | null> {
  if (cachedCreds && cachedCreds.expiresAt > Date.now()) return cachedCreds.creds;
  let creds: GmailCreds | null = null;
  try {
    const r = await pool.query(
      `SELECT email_user, google_client_id, google_client_secret, google_refresh_token,
              company_shortname, company_name
         FROM training_provider
        ORDER BY created_at ASC NULLS LAST
        LIMIT 1`,
    );
    const row = r.rows[0];
    if (row && row.email_user) {
      creds = {
        emailUser: row.email_user,
        fromName: row.company_shortname || row.company_name || 'Training Provider',
        clientId: row.google_client_id || null,
        clientSecret: row.google_client_secret || null,
        refreshToken: row.google_refresh_token || null,
      };
    }
  } catch {
    creds = null;
  }
  cachedCreds = { creds, expiresAt: Date.now() + CREDS_TTL_MS };
  return creds;
}

function getOrCreateClient(c: GmailCreds) {
  const key = `${c.clientId}:${c.refreshToken}`;
  if (cachedOAuth2Client && cachedOAuth2Key === key) return cachedOAuth2Client;
  const client = new google.auth.OAuth2(
    c.clientId || undefined,
    c.clientSecret || undefined,
    'https://developers.google.com/oauthplayground',
  );
  client.setCredentials({ refresh_token: c.refreshToken });
  cachedOAuth2Client = client;
  cachedOAuth2Key = key;
  return client;
}

// --- Service-account (domain-wide delegation) transport ---------------------
// Cached JWT client impersonating email_user. null = tried and unavailable
// (no key uploaded / DWD not authorized); we re-probe after the TTL so an
// admin enabling DWD doesn't need an app restart.
let cachedJwtClient: InstanceType<typeof google.auth.JWT> | null = null;
let cachedJwtSubject = '';
let jwtUnavailableUntil = 0;
const JWT_RETRY_MS = 60_000;

async function getServiceAccountGmailClient(subject: string): Promise<InstanceType<typeof google.auth.JWT> | null> {
  if (cachedJwtClient && cachedJwtSubject === subject) return cachedJwtClient;
  if (Date.now() < jwtUnavailableUntil) return null;
  try {
    const sa = await loadServiceAccountCredentials(pool);
    const jwt = new google.auth.JWT({
      email: sa.client_email,
      key: sa.private_key,
      scopes: [GMAIL_SEND_SCOPE],
      subject,
    });
    // authorize() fails fast with unauthorized_client until the SA's client ID
    // is granted the Gmail scope in Workspace Admin domain-wide delegation.
    await jwt.authorize();
    cachedJwtClient = jwt;
    cachedJwtSubject = subject;
    return jwt;
  } catch (e: any) {
    console.warn(`[gmail-send] Service account transport unavailable (${e?.message || e}); falling back to OAuth refresh token`);
    jwtUnavailableUntil = Date.now() + JWT_RETRY_MS;
    return null;
  }
}

export function invalidateGmailSenderCache(): void {
  cachedCreds = null;
  cachedOAuth2Client = null;
  cachedOAuth2Key = '';
  cachedJwtClient = null;
  cachedJwtSubject = '';
  jwtUnavailableUntil = 0;
}

export async function isGmailOauthConfigured(): Promise<boolean> {
  return (await loadCreds()) !== null;
}

/**
 * RFC 2047 "encoded-word" for header values containing non-ASCII (e.g. an em dash
 * "—" or accented course titles). Email headers must be 7-bit ASCII; the body's
 * charset declaration does NOT apply to headers, so an un-encoded UTF-8 subject
 * shows up mojibaked ("—" → "Ã¢Â€Â""). Pure-ASCII strings are returned unchanged.
 */
function encodeMimeHeaderWord(value: string): string {
  if (/^[\x00-\x7F]*$/.test(value)) return value;
  return `=?UTF-8?B?${Buffer.from(value, 'utf8').toString('base64')}?=`;
}

export interface GmailSendOptions {
  to: string;
  subject: string;
  text?: string;
  html?: string;
  from?: string;
  replyTo?: string;
}

export interface GmailSendResult {
  ok: boolean;
  messageId?: string;
  error?: string;
}

function buildRawMessage(creds: GmailCreds, options: GmailSendOptions): string {
  // Encode only the display-name part of From (the <email> must stay raw ASCII).
  const fromHeader = options.from || `${encodeMimeHeaderWord(creds.fromName)} <${creds.emailUser}>`;
  const html = options.html || (options.text ? `<pre style="font-family: Arial, sans-serif; font-size: 14px; color: #333; white-space: pre-wrap;">${options.text}</pre>` : '');

  const headers = [
    `From: ${fromHeader}`,
    `To: ${options.to}`,
  ];
  if (options.replyTo) headers.push(`Reply-To: ${options.replyTo}`);
  headers.push(
    `Subject: ${encodeMimeHeaderWord(options.subject)}`,
    'MIME-Version: 1.0',
    'Content-Type: text/html; charset=utf-8',
    'Content-Transfer-Encoding: 8bit',
    '',
    html,
  );

  return Buffer.from(headers.join('\r\n'))
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

/**
 * Attempts a send using ONLY the service-account (domain-wide delegation)
 * transport. Returns null when that transport is unavailable (no key uploaded,
 * DWD not authorized, or a recent failure is being backed off) so the caller
 * can run its own fallback chain — used by send-otp.ts, which keeps a
 * latency-tuned inline OAuth implementation as its fallback.
 */
export async function trySendViaGmailServiceAccount(options: GmailSendOptions): Promise<GmailSendResult | null> {
  const creds = await loadCreds();
  if (!creds) return null;
  const jwt = await getServiceAccountGmailClient(creds.emailUser);
  if (!jwt) return null;
  try {
    const gmail = google.gmail({ version: 'v1', auth: jwt });
    const resp = await gmail.users.messages.send({
      userId: 'me',
      requestBody: { raw: buildRawMessage(creds, options) },
    });
    return { ok: true, messageId: resp.data.id || undefined };
  } catch (err: any) {
    console.warn(`[gmail-send] Service account send failed (${err?.message || err})`);
    cachedJwtClient = null;
    cachedJwtSubject = '';
    jwtUnavailableUntil = Date.now() + JWT_RETRY_MS;
    return null;
  }
}

export async function sendViaGmailOAuth(options: GmailSendOptions): Promise<GmailSendResult> {
  const creds = await loadCreds();
  if (!creds) {
    return { ok: false, error: 'Gmail sending is not configured. Set email_user (plus a service account key or OAuth client/refresh token) in Company Settings → Integration → Google.' };
  }

  const raw = buildRawMessage(creds, options);

  // Transport 1: service account with domain-wide delegation (permanent).
  const jwt = await getServiceAccountGmailClient(creds.emailUser);
  if (jwt) {
    try {
      const gmail = google.gmail({ version: 'v1', auth: jwt });
      const resp = await gmail.users.messages.send({
        userId: 'me',
        requestBody: { raw },
      });
      return { ok: true, messageId: resp.data.id || undefined };
    } catch (err: any) {
      console.warn(`[gmail-send] Service account send failed (${err?.message || err}); falling back to OAuth refresh token`);
      cachedJwtClient = null;
      cachedJwtSubject = '';
      jwtUnavailableUntil = Date.now() + JWT_RETRY_MS;
    }
  }

  // Transport 2: OAuth2 refresh token (revoked on mailbox password change).
  if (!creds.clientId || !creds.clientSecret || !creds.refreshToken) {
    return { ok: false, error: 'Gmail send failed: service account transport unavailable and no OAuth refresh token configured in Company Settings → Integration → Google.' };
  }

  try {
    const client = getOrCreateClient(creds);
    try {
      await client.getAccessToken();
    } catch (tokenErr: any) {
      cachedOAuth2Client = null;
      cachedOAuth2Key = '';
      return { ok: false, error: `Gmail OAuth token refresh failed: ${tokenErr?.message || tokenErr}` };
    }

    const gmail = google.gmail({ version: 'v1', auth: client });
    const resp = await gmail.users.messages.send({
      userId: 'me',
      requestBody: { raw },
    });

    return { ok: true, messageId: resp.data.id || undefined };
  } catch (err: any) {
    return { ok: false, error: err?.message || String(err) };
  }
}
