import type { NextApiRequest, NextApiResponse } from 'next';
import { google } from 'googleapis';
import { sendViaGmailOAuth, invalidateGmailSenderCache } from '../../../../lib/gmailOauthSend';
import pool from '@lib/db';

// POST /api/integrations/gmail/test
// Body: { recipient: string, config?: { emailUser, googleClientId, googleClientSecret, googleRefreshToken } }
//
// Sends a one-shot test email via Gmail OAuth. The `config` field lets the
// admin test the form values BEFORE saving. If omitted, falls back to the
// currently-saved DB credentials.

async function sendWithProvidedCreds(
  recipient: string,
  creds: { emailUser: string; clientId: string; clientSecret: string; refreshToken: string; fromName: string }
): Promise<{ ok: boolean; messageId?: string; error?: string }> {
  try {
    const client = new google.auth.OAuth2(
      creds.clientId,
      creds.clientSecret,
      'https://developers.google.com/oauthplayground'
    );
    client.setCredentials({ refresh_token: creds.refreshToken });
    try {
      await client.getAccessToken();
    } catch (tokenErr: any) {
      return { ok: false, error: `Token refresh failed: ${tokenErr?.message || tokenErr}` };
    }
    const gmail = google.gmail({ version: 'v1', auth: client });

    const subject = 'Gmail OAuth test from your LMS-TMS';
    const html = `<div style="font-family: Arial, sans-serif; font-size: 14px; color: #333;">
      <p>This is a test email confirming that Gmail OAuth is configured correctly.</p>
      <ul>
        <li><strong>Email User:</strong> ${creds.emailUser}</li>
        <li><strong>Client ID:</strong> ${creds.clientId}</li>
      </ul>
      <p>If you received this, your Gmail OAuth credentials are working.</p>
    </div>`;

    const raw = Buffer.from([
      `From: ${creds.fromName} <${creds.emailUser}>`,
      `To: ${recipient}`,
      `Subject: ${subject}`,
      'MIME-Version: 1.0',
      'Content-Type: text/html; charset=utf-8',
      '',
      html,
    ].join('\r\n'))
      .toString('base64')
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=+$/, '');

    const resp = await gmail.users.messages.send({ userId: 'me', requestBody: { raw } });
    return { ok: true, messageId: resp.data.id || undefined };
  } catch (err: any) {
    return { ok: false, error: err?.message || String(err) };
  }
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ ok: false, error: 'Method not allowed' });
  }

  const { recipient, config } = req.body || {};

  if (!recipient || typeof recipient !== 'string' || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(recipient)) {
    return res.status(400).json({ ok: false, error: 'A valid recipient email is required.' });
  }

  if (config && typeof config === 'object') {
    const emailUser = String(config.emailUser || '').trim();
    const clientId = String(config.googleClientId || '').trim();
    const clientSecret = String(config.googleClientSecret || '').trim();
    const refreshToken = String(config.googleRefreshToken || '').trim();
    if (!emailUser || !clientId || !clientSecret || !refreshToken) {
      return res.status(400).json({ ok: false, error: 'Missing one of: Email User, Client ID, Client Secret, Refresh Token.' });
    }
    // Use whatever company name we have for the From header.
    let fromName = 'Training Provider';
    try {
      const r = await pool.query(
        `SELECT company_shortname, company_name FROM training_provider ORDER BY created_at ASC NULLS LAST LIMIT 1`
      );
      fromName = r.rows[0]?.company_shortname || r.rows[0]?.company_name || fromName;
    } catch { /* keep default */ }

    const result = await sendWithProvidedCreds(recipient, { emailUser, clientId, clientSecret, refreshToken, fromName });
    if (!result.ok) return res.status(500).json({ ok: false, error: result.error || 'Gmail send failed.' });
    return res.status(200).json({ ok: true, messageId: result.messageId });
  }

  // Fallback: use saved DB credentials. Bust the in-process cache so a
  // freshly-saved value is picked up without waiting for the 60s TTL.
  invalidateGmailSenderCache();
  const result = await sendViaGmailOAuth({
    to: recipient,
    subject: 'Gmail OAuth test from your LMS-TMS',
    html: '<p>This is a test email confirming that Gmail OAuth (saved in Company Setting) is configured correctly.</p>',
  });

  if (!result.ok) return res.status(500).json({ ok: false, error: result.error || 'Gmail send failed.' });
  return res.status(200).json({ ok: true, messageId: result.messageId });
}
