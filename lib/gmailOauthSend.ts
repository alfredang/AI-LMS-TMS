import { google } from 'googleapis';
import pool from './db';

// Shared Gmail OAuth sender. Reads credentials from the single
// training_provider row (email_user, google_client_id, google_client_secret,
// google_refresh_token) — same as pages/api/auth/send-otp.ts.
//
// Caller-agnostic: send-otp.ts has its own retry-heavy inline implementation
// kept for OTP latency tuning; this helper exists for everything else
// (notifications, support tickets, etc.) that needs a plain "send via Gmail"
// without depending on Coolify SMTP env vars.

interface GmailCreds {
  emailUser: string;
  clientId: string;
  clientSecret: string;
  refreshToken: string;
  fromName: string;
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
    if (row && row.email_user && row.google_client_id && row.google_client_secret && row.google_refresh_token) {
      creds = {
        emailUser: row.email_user,
        clientId: row.google_client_id,
        clientSecret: row.google_client_secret,
        refreshToken: row.google_refresh_token,
        fromName: row.company_shortname || row.company_name || 'Training Provider',
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
    c.clientId,
    c.clientSecret,
    'https://developers.google.com/oauthplayground',
  );
  client.setCredentials({ refresh_token: c.refreshToken });
  cachedOAuth2Client = client;
  cachedOAuth2Key = key;
  return client;
}

export function invalidateGmailSenderCache(): void {
  cachedCreds = null;
  cachedOAuth2Client = null;
  cachedOAuth2Key = '';
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

export async function sendViaGmailOAuth(options: GmailSendOptions): Promise<GmailSendResult> {
  const creds = await loadCreds();
  if (!creds) {
    return { ok: false, error: 'Gmail OAuth is not configured. Set email_user / google_client_id / google_client_secret / google_refresh_token in Company Settings → Integration → Google.' };
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

    const raw = Buffer.from(headers.join('\r\n'))
      .toString('base64')
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=+$/, '');

    const resp = await gmail.users.messages.send({
      userId: 'me',
      requestBody: { raw },
    });

    return { ok: true, messageId: resp.data.id || undefined };
  } catch (err: any) {
    return { ok: false, error: err?.message || String(err) };
  }
}
