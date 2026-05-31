import { NextApiRequest, NextApiResponse } from 'next';
import { cors } from '../../../lib/cors';
import pool from '../../../lib/db';
import { google } from 'googleapis';
import { isSmtpEnabled, sendViaSmtp, getSmtpConfig } from '../../../lib/smtp';

interface SendOtpResponse {
  success: boolean;
  message?: string;
  error?: string;
}

// Generate a 6-digit OTP
function generateOtp(): string {
  return Math.floor(100000 + Math.random() * 900000).toString();
}

// Module-level cached OAuth2 client — survives across requests so token refresh
// only happens once (on first call or after expiry), not on every OTP send.
let cachedOAuth2Client: InstanceType<typeof google.auth.OAuth2> | null = null;
let cachedOAuth2Key = ''; // tracks credential identity so we rebuild on config change

function getOrCreateOAuth2Client(clientId: string, clientSecret: string, refreshToken: string) {
  const key = `${clientId}:${refreshToken}`;
  if (cachedOAuth2Client && cachedOAuth2Key === key) {
    return cachedOAuth2Client;
  }
  const client = new google.auth.OAuth2(
    clientId,
    clientSecret,
    'https://developers.google.com/oauthplayground'
  );
  client.setCredentials({ refresh_token: refreshToken });
  cachedOAuth2Client = client;
  cachedOAuth2Key = key;
  return client;
}

async function handler(req: NextApiRequest, res: NextApiResponse<SendOtpResponse>) {
  // Handle CORS
  if (cors(req, res)) {
    return;
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ success: false, error: 'Method not allowed' });
  }

  const { email } = req.body;

  if (!email || !email.includes('@')) {
    return res.status(400).json({
      success: false,
      error: 'Valid email is required'
    });
  }

  try {
    console.log(`📧 Send OTP request for email: ${email}`);

    // Invalidate any existing unused OTPs for this email
    await pool.query(`
      UPDATE public.otp_codes
      SET used = TRUE
      WHERE LOWER(email) = LOWER($1) AND used = FALSE
    `, [email]);

    // Generate new OTP
    const otp = generateOtp();
    const expiryMinutes = 30;
    const expiresAt = new Date(Date.now() + expiryMinutes * 60 * 1000);

    // Store OTP in database
    await pool.query(`
      INSERT INTO public.otp_codes (email, otp_code, expires_at)
      VALUES (LOWER($1), $2, $3)
    `, [email, otp, expiresAt]);

    console.log(`✅ OTP generated and stored for ${email}, expires at ${expiresAt.toISOString()}`);

    // Fetch Gmail OAuth credentials and OTP email template from Training Provider Company Settings
    let tpResult;
    try {
      tpResult = await pool.query(
        'SELECT email_user, company_email, google_client_id, google_client_secret, google_refresh_token, company_name, company_shortname, otp_email_subject, otp_email_body, support_email FROM training_provider LIMIT 1'
      );
    } catch (e) {
      // support_email or otp_email columns may not exist yet
      try {
        tpResult = await pool.query(
          'SELECT email_user, company_email, google_client_id, google_client_secret, google_refresh_token, company_name, company_shortname, otp_email_subject, otp_email_body FROM training_provider LIMIT 1'
        );
      } catch (e2) {
        tpResult = await pool.query(
          'SELECT email_user, company_email, google_client_id, google_client_secret, google_refresh_token, company_name, company_shortname FROM training_provider LIMIT 1'
        );
      }
    }

    if (tpResult.rows.length === 0) {
      console.error('❌ No training provider found');
      return res.status(500).json({ success: false, error: 'Email configuration not found. Please contact admin.' });
    }

    const tp = tpResult.rows[0];
    const { email_user, company_email, google_client_id, google_client_secret, google_refresh_token, company_name } = tp;
    const supportEmail = tp.support_email || '';
    const replyToEmail = supportEmail || company_email || email_user;
    console.log('📧 OTP reply-to:', replyToEmail, '(support_email:', supportEmail, ', company_email:', company_email, ')');

    // SMTP toggle takes precedence when enabled in Company Settings → Integration → SMTP.
    // Default is OFF, so the existing Gmail OAuth flow below runs unchanged for every
    // deployment that hasn't explicitly opted in.
    const smtpOn = await isSmtpEnabled();

    if (!smtpOn && (!email_user || !google_client_id || !google_client_secret || !google_refresh_token)) {
      console.error('❌ Gmail OAuth not configured in Company Settings');
      console.error(`  email_user: ${email_user ? 'set' : 'MISSING'}, google_client_id: ${google_client_id ? 'set' : 'MISSING'}, google_client_secret: ${google_client_secret ? 'set' : 'MISSING'}, google_refresh_token: ${google_refresh_token ? 'set' : 'MISSING'}`);
      return res.status(500).json({ success: false, error: 'Email not configured. Please configure Gmail OAuth in Company Settings, or enable SMTP under Integrations.' });
    }

    // Return success immediately — OTP is stored, email config is valid.
    // The user transitions to the OTP screen right away while the email
    // is sent in the background. This eliminates the 3-10s delay caused by
    // OAuth token refresh + Gmail API round-trip on first attempt.
    res.status(200).json({
      success: true,
      message: 'OTP has been sent to your email address'
    });

    // --- Fire-and-forget: send the OTP email asynchronously ---
    // Safe because we run on Coolify (persistent Node.js process), not serverless.
    (async () => {
      // Shared template prep (used by both SMTP and Gmail OAuth branches).
      const companyShortName = tp.company_shortname || company_name || 'Training Provider';
      const siteUrl = (process.env.NEXT_PUBLIC_BASE_URL || '').replace(/\/$/, '') + '/';
      const replaceVars = (template: string) =>
        template
          .replace(/\{OTP\}/g, otp)
          .replace(/\{COMPANY_SHORT_NAME\}/g, companyShortName)
          .replace(/\{COMPANY_NAME\}/g, companyShortName)
          .replace(/\{SITE_URL\}/g, siteUrl)
          .replace(/\{EXPIRY_MINUTES\}/g, String(expiryMinutes))
          .replace(/\{USER_EMAIL\}/g, email);
      const defaultSubjectTpl = '{COMPANY_SHORT_NAME} LMS - Verification Code';
      const defaultBodyTpl = `Hi,

Your OTP is {OTP}.

Please use this to login to your account on the {COMPANY_SHORT_NAME} AI LMS TMS {SITE_URL} within {EXPIRY_MINUTES} minutes.

If your OTP does not work, please request for a new OTP on the login page.

If you did not make this request, you may ignore this email. Do not share this OTP with anyone. This is strictly confidential and to be used by you only.

Warm regards
{COMPANY_SHORT_NAME}`;
      const subjectForSend = replaceVars(tp.otp_email_subject || defaultSubjectTpl);
      const bodyTextForSend = replaceVars(tp.otp_email_body || defaultBodyTpl);
      const htmlBodyForSend = `
          <div style="font-family: Arial, sans-serif; font-size: 14px; color: #333; line-height: 1.6;">
            ${bodyTextForSend.split('\n').map(line => {
              if (!line.trim()) return '<br style="line-height: 0.5;">';
              const highlighted = line.replace(new RegExp(otp, 'g'), `<strong style="font-size: 18px; letter-spacing: 2px;">${otp}</strong>`);
              const withLinks = highlighted.replace(/(https?:\/\/[^\s]+)/g, '<a href="$1">$1</a>');
              return `<p style="margin: 0 0 4px 0;">${withLinks}</p>`;
            }).join('\n')}
          </div>
        `;

      // SMTP branch — only when explicitly enabled. Skips Gmail OAuth entirely.
      if (smtpOn) {
        try {
          const smtpCfg = await getSmtpConfig();
          const fromHeader = smtpCfg?.from
            ? `${companyShortName} <${smtpCfg.from}>`
            : `${companyShortName} <${smtpCfg?.user || ''}>`;
          const result = await sendViaSmtp({
            to: email,
            subject: subjectForSend,
            text: bodyTextForSend,
            html: htmlBodyForSend,
            from: fromHeader,
            replyTo: replyToEmail || undefined,
          });
          if (result.ok) {
            console.log(`✅ OTP email sent successfully to ${email} via SMTP (messageId: ${result.messageId})`);
          } else {
            console.error(`❌ SMTP OTP send failed for ${email}:`, result.error);
          }
        } catch (smtpErr: any) {
          console.error('❌ SMTP OTP send threw:', smtpErr?.message || smtpErr);
        }
        return;
      }

      try {
        // Reuse cached OAuth2 client (avoids redundant token refresh on every request)
        let oauth2Client = getOrCreateOAuth2Client(google_client_id, google_client_secret, google_refresh_token);

        // Ensure access token is fresh — retry on transient failures (cold-start
        // network blips, slow DNS, intermittent Google OAuth endpoint hiccups).
        // Without retry, the first OTP send after a Coolify redeploy often fails
        // and the user has to click "Resend" to get a working second attempt.
        let tokenReady = false;
        for (let tokenAttempt = 1; tokenAttempt <= 3; tokenAttempt++) {
          try {
            await oauth2Client.getAccessToken();
            console.log(`✅ Gmail OAuth access token ready (attempt ${tokenAttempt})`);
            tokenReady = true;
            break;
          } catch (tokenError: any) {
            console.error(`❌ Token refresh attempt ${tokenAttempt} failed:`, tokenError?.message);
            // Invalidate the cached client so we rebuild fresh on the next try
            cachedOAuth2Client = null;
            cachedOAuth2Key = '';
            if (tokenAttempt < 3) {
              await new Promise(r => setTimeout(r, tokenAttempt * 500));
              oauth2Client = getOrCreateOAuth2Client(google_client_id, google_client_secret, google_refresh_token);
            }
          }
        }
        if (!tokenReady) {
          console.error('❌ Failed to refresh Gmail OAuth access token after 3 attempts');
          return;
        }

        const gmail = google.gmail({ version: 'v1', auth: oauth2Client });

        const companyShortName = tp.company_shortname || company_name || 'Training Provider';
        const siteUrl = (process.env.NEXT_PUBLIC_BASE_URL || '').replace(/\/$/, '') + '/';

        // Helper to replace template variables
        const replaceVars = (template: string) =>
          template
            .replace(/\{OTP\}/g, otp)
            .replace(/\{COMPANY_SHORT_NAME\}/g, companyShortName)
            .replace(/\{COMPANY_NAME\}/g, companyShortName)
            .replace(/\{SITE_URL\}/g, siteUrl)
            .replace(/\{EXPIRY_MINUTES\}/g, String(expiryMinutes))
            .replace(/\{USER_EMAIL\}/g, email);

        // Use custom template from DB if available, otherwise use defaults
        const defaultSubject = '{COMPANY_SHORT_NAME} LMS - Verification Code';
        const defaultBody = `Hi,

Your OTP is {OTP}.

Please use this to login to your account on the {COMPANY_SHORT_NAME} AI LMS TMS {SITE_URL} within {EXPIRY_MINUTES} minutes.

If your OTP does not work, please request for a new OTP on the login page.

If you did not make this request, you may ignore this email. Do not share this OTP with anyone. This is strictly confidential and to be used by you only.

Warm regards
{COMPANY_SHORT_NAME}`;

        const subject = replaceVars(tp.otp_email_subject || defaultSubject);
        const bodyText = replaceVars(tp.otp_email_body || defaultBody);

        // Convert plain text body to HTML
        const htmlBody = `
          <div style="font-family: Arial, sans-serif; font-size: 14px; color: #333; line-height: 1.6;">
            ${bodyText.split('\n').map(line => {
              if (!line.trim()) return '<br style="line-height: 0.5;">';
              // Bold the OTP value
              const highlighted = line.replace(new RegExp(otp, 'g'), `<strong style="font-size: 18px; letter-spacing: 2px;">${otp}</strong>`);
              // Make URLs clickable
              const withLinks = highlighted.replace(/(https?:\/\/[^\s]+)/g, '<a href="$1">$1</a>');
              return `<p style="margin: 0 0 4px 0;">${withLinks}</p>`;
            }).join('\n')}
          </div>
        `;

        const rawEmail = [
          `From: ${companyShortName} <${email_user}>`,
          `Reply-To: ${replyToEmail}`,
          `To: ${email}`,
          `Subject: ${subject}`,
          'MIME-Version: 1.0',
          'Content-Type: text/html; charset=utf-8',
          '',
          htmlBody,
        ].join('\r\n');

        const encodedMessage = Buffer.from(rawEmail)
          .toString('base64')
          .replace(/\+/g, '-')
          .replace(/\//g, '_')
          .replace(/=+$/, '');

        // Send with retry — Gmail API can transiently fail on first attempt after cold start
        for (let attempt = 1; attempt <= 3; attempt++) {
          try {
            await gmail.users.messages.send({
              userId: 'me',
              requestBody: { raw: encodedMessage },
            });
            console.log(`✅ OTP email sent successfully to ${email} via Gmail OAuth (attempt ${attempt})`);
            return;
          } catch (sendError: any) {
            console.error(`❌ Gmail send attempt ${attempt} failed:`, sendError?.message);
            if (attempt < 3) {
              // Exponential backoff: 1s, then 2s
              await new Promise(r => setTimeout(r, attempt * 1000));
              // On auth errors, force token refresh before retrying
              if (sendError?.code === 401 || sendError?.message?.includes('invalid_grant')) {
                try {
                  oauth2Client.setCredentials({ refresh_token: google_refresh_token });
                  await oauth2Client.getAccessToken();
                  console.log('🔄 Refreshed OAuth token after auth error');
                } catch {
                  cachedOAuth2Client = null;
                  cachedOAuth2Key = '';
                }
              }
            } else {
              console.error(`❌ All ${attempt} attempts to send OTP email to ${email} failed`);
            }
          }
        }
      } catch (bgError: any) {
        console.error('❌ Background OTP email error:', bgError?.message || bgError);
      }
    })();

  } catch (error: any) {
    console.error('❌ Send OTP error:', error?.message || error);
    console.error('❌ Error details:', JSON.stringify({ code: error?.code, status: error?.status, errors: error?.errors }, null, 2));
    return res.status(500).json({
      success: false,
      error: `Failed to send OTP: ${error?.message || 'Unknown error'}. Please try again.`
    });
  }
}

export default handler;
