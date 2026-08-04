import { withAuth } from '@lib/auth/withAuth';
import type { NextApiRequest, NextApiResponse } from 'next';
import { sendViaSmtp, getSmtpConfig, SmtpConfig } from '../../../../lib/smtp';

// POST /api/integrations/smtp/test
// Body: { recipient: string, config?: { host, port, secure, auth, user, password, from } }
//
// Sends a one-shot test email via SMTP. The `config` field lets the admin
// test the form values BEFORE saving — useful for validating credentials
// without committing them. If omitted, falls back to the currently-saved
// DB config (post-save verification).
//
// Toggle state is intentionally ignored here: this endpoint always uses SMTP
// because that's the whole point of "Send Test". Real OTP / notification
// routing still respects smtp_enabled.

async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ ok: false, error: 'Method not allowed' });
  }

  const { recipient, config } = req.body || {};

  if (!recipient || typeof recipient !== 'string' || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(recipient)) {
    return res.status(400).json({ ok: false, error: 'A valid recipient email is required.' });
  }

  let cfg: SmtpConfig | null = null;

  if (config && typeof config === 'object') {
    const secureRaw = String(config.secure || '').toLowerCase();
    const secure: 'tls' | 'ssl' = secureRaw === 'ssl' ? 'ssl' : 'tls';
    const parsedPort = parseInt(String(config.port || ''), 10);
    const port = Number.isFinite(parsedPort) && parsedPort > 0 ? parsedPort : (secure === 'ssl' ? 465 : 587);
    cfg = {
      enabled: true,
      host: String(config.host || ''),
      port,
      secure,
      auth: String(config.auth || 'login').toLowerCase() === 'plain' ? 'plain' : 'login',
      user: String(config.user || ''),
      password: String(config.password || ''),
      from: String(config.from || config.user || ''),
    };
    if (!cfg.host || !cfg.user || !cfg.password) {
      return res.status(400).json({ ok: false, error: 'Missing host, username, or password.' });
    }
  } else {
    cfg = await getSmtpConfig();
    if (!cfg || !cfg.host || !cfg.user || !cfg.password) {
      return res.status(400).json({ ok: false, error: 'No SMTP config in request body and nothing saved in DB.' });
    }
  }

  const subject = 'SMTP test from your LMS-TMS';
  const text = `This is a test email confirming that SMTP is configured correctly.\n\nHost: ${cfg.host}\nPort: ${cfg.port}\nSecure: ${cfg.secure}\nUser: ${cfg.user}\n\nIf you received this, your SMTP credentials are working.`;
  const html = `<div style="font-family: Arial, sans-serif; font-size: 14px; color: #333;">
    <p>This is a test email confirming that SMTP is configured correctly.</p>
    <ul>
      <li><strong>Host:</strong> ${cfg.host}</li>
      <li><strong>Port:</strong> ${cfg.port}</li>
      <li><strong>Secure:</strong> ${cfg.secure}</li>
      <li><strong>User:</strong> ${cfg.user}</li>
    </ul>
    <p>If you received this, your SMTP credentials are working.</p>
  </div>`;

  const result = await sendViaSmtp({ to: recipient, subject, text, html }, cfg);

  if (!result.ok) {
    return res.status(500).json({ ok: false, error: result.error || 'SMTP send failed.' });
  }
  return res.status(200).json({ ok: true, messageId: result.messageId });
}

export default withAuth(handler, { roles: ['admin', 'trainingProvider'] });
