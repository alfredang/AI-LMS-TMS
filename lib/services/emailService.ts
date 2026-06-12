import { isSmtpEnabled, sendViaSmtp } from '../smtp';
import { sendViaGmailOAuth } from '../gmailOauthSend';

// Single email sender used by callers that don't have their own provider
// integration (e.g. support tickets, generic notifications). Routing:
//   1. SMTP toggle ON  → SMTP is primary, Gmail OAuth is fallback on failure.
//   2. SMTP toggle OFF → Gmail OAuth is primary, SMTP is fallback on failure.
// Both transports always read credentials from the Company Setting DB row.
// No Coolify SMTP_* env vars are consulted.

interface SendEmailOptions {
  to: string;
  subject: string;
  text?: string;
  html?: string;
  replyTo?: string;
  from?: string;
}

class EmailService {
  async sendEmail(options: SendEmailOptions): Promise<{ success: boolean; error?: string; messageId?: string; via?: 'smtp' | 'gmail' }> {
    const smtpOn = await isSmtpEnabled();

    // Primary transport
    if (smtpOn) {
      const r = await sendViaSmtp(options);
      if (r.ok) return { success: true, messageId: r.messageId, via: 'smtp' };
      console.warn('⚠️ SMTP send failed, falling back to Gmail OAuth:', r.error);
      const fb = await sendViaGmailOAuth(options);
      if (fb.ok) return { success: true, messageId: fb.messageId, via: 'gmail' };
      console.error('❌ Both SMTP and Gmail OAuth failed. SMTP error:', r.error, '| Gmail error:', fb.error);
      return { success: false, error: `SMTP failed (${r.error}); Gmail OAuth fallback also failed (${fb.error})` };
    }

    const r = await sendViaGmailOAuth(options);
    if (r.ok) return { success: true, messageId: r.messageId, via: 'gmail' };
    console.warn('⚠️ Gmail OAuth send failed, falling back to SMTP from Company Setting:', r.error);
    const fb = await sendViaSmtp(options);
    if (fb.ok) return { success: true, messageId: fb.messageId, via: 'smtp' };
    console.error('❌ Both Gmail OAuth and SMTP failed. Gmail error:', r.error, '| SMTP error:', fb.error);
    return { success: false, error: `Gmail OAuth failed (${r.error}); SMTP fallback also failed (${fb.error})` };
  }
}

export const emailService = new EmailService();
