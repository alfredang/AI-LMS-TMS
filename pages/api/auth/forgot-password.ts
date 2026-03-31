import { NextApiRequest, NextApiResponse } from 'next';
import { cors } from '../../../lib/cors';
import pool from '../../../lib/db';
import crypto from 'crypto';
import bcrypt from 'bcryptjs';
import { google } from 'googleapis';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (cors(req, res)) return;

  if (req.method !== 'POST') {
    return res.status(405).json({ success: false, error: 'Method not allowed' });
  }

  const { email } = req.body;

  if (!email || !email.includes('@')) {
    return res.status(400).json({ success: false, error: 'Valid email is required' });
  }

  try {
    // Check if user exists
    const userResult = await pool.query(
      'SELECT id, email, full_name FROM app_user WHERE LOWER(email) = LOWER($1)',
      [email]
    );

    // Always return success to prevent email enumeration
    if (userResult.rows.length === 0) {
      console.log(`⚠️ Forgot password: user not found for ${email}`);
      return res.status(200).json({
        success: true,
        message: 'If an account with that email exists, a temporary password has been sent.'
      });
    }

    const user = userResult.rows[0];

    // Generate a temporary password (8 chars, alphanumeric)
    const tempPassword = crypto.randomBytes(4).toString('hex'); // e.g. "a1b2c3d4"
    const hashedPassword = await bcrypt.hash(tempPassword, 10);

    // Update user's password
    await pool.query(
      'UPDATE app_user SET password = $1, password_hash = $2, updated_at = CURRENT_TIMESTAMP WHERE id = $3',
      [tempPassword, hashedPassword, user.id]
    );

    // Set per-user flag to force password change on next login
    try {
      await pool.query('UPDATE app_user SET must_change_password = TRUE WHERE id = $1', [user.id]);
    } catch (e) {
      await pool.query('ALTER TABLE app_user ADD COLUMN IF NOT EXISTS must_change_password BOOLEAN DEFAULT FALSE');
      await pool.query('UPDATE app_user SET must_change_password = TRUE WHERE id = $1', [user.id]);
    }

    // Fetch Gmail OAuth credentials, company info, and email template
    const tpResult = await pool.query(
      'SELECT email_user, google_client_id, google_client_secret, google_refresh_token, company_name, company_shortname FROM training_provider LIMIT 1'
    );

    // Try to fetch customised email template
    let dbSubject = '';
    let dbBody = '';
    try {
      const tplResult = await pool.query('SELECT password_reset_email_subject, password_reset_email_body FROM training_provider LIMIT 1');
      if (tplResult.rows.length > 0) {
        dbSubject = tplResult.rows[0].password_reset_email_subject || '';
        dbBody = tplResult.rows[0].password_reset_email_body || '';
      }
    } catch (e) {
      // columns don't exist yet, use defaults
    }

    if (tpResult.rows.length === 0) {
      console.error('❌ No training provider found for sending email');
      return res.status(200).json({
        success: true,
        message: 'If an account with that email exists, a temporary password has been sent.'
      });
    }

    const tp = tpResult.rows[0];
    const { email_user, google_client_id, google_client_secret, google_refresh_token } = tp;

    if (!email_user || !google_client_id || !google_client_secret || !google_refresh_token) {
      console.error('❌ Gmail OAuth not configured for forgot password emails');
      return res.status(500).json({
        success: false,
        error: 'Email not configured. Please contact your administrator.'
      });
    }

    // Send email with temporary password
    const oauth2Client = new google.auth.OAuth2(
      google_client_id,
      google_client_secret,
      'https://developers.google.com/oauthplayground'
    );
    oauth2Client.setCredentials({ refresh_token: google_refresh_token });

    const gmail = google.gmail({ version: 'v1', auth: oauth2Client });

    const companyName = tp.company_name || 'Training Provider';
    const companyShortName = tp.company_shortname || companyName;

    const replaceVars = (text: string) =>
      text
        .replace(/\{USER_NAME\}/g, user.full_name || 'there')
        .replace(/\{USER_EMAIL\}/g, user.email)
        .replace(/\{TEMP_PASSWORD\}/g, tempPassword)
        .replace(/\{COMPANY_NAME\}/g, companyName)
        .replace(/\{COMPANY_SHORT_NAME\}/g, companyShortName);

    const defaultSubject = `${companyShortName} - Password Reset`;
    const defaultBody = `<div style="font-family: Arial, sans-serif; font-size: 14px; color: #333; line-height: 1.6; max-width: 600px;">
        <p>Hi {USER_NAME},</p>
        <p>We received a request to reset your password for the {COMPANY_NAME} AI LMS TMS.</p>
        <p>Your temporary password is:</p>
        <p style="font-size: 20px; font-weight: bold; letter-spacing: 2px; color: #1e40af; background: #eff6ff; padding: 12px 20px; border-radius: 8px; display: inline-block; margin: 8px 0;">
          {TEMP_PASSWORD}
        </p>
        <p>Please log in with this temporary password. You will be prompted to set a new password immediately.</p>
        <p>If you did not request this reset, please contact your administrator immediately.</p>
        <br/>
        <p>Warm regards,<br/>{COMPANY_NAME}</p>
      </div>`;

    const subject = replaceVars(dbSubject || defaultSubject);
    const htmlBody = replaceVars(dbBody || defaultBody);

    const rawEmail = [
      `From: ${email_user}`,
      `To: ${user.email}`,
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

    await gmail.users.messages.send({
      userId: 'me',
      requestBody: { raw: encodedMessage },
    });

    console.log(`✅ Temporary password email sent to ${user.email}`);

    return res.status(200).json({
      success: true,
      message: 'If an account with that email exists, a temporary password has been sent.'
    });
  } catch (error: any) {
    console.error('❌ Forgot password error:', error?.message || error);
    return res.status(500).json({
      success: false,
      error: 'Failed to process password reset. Please try again.'
    });
  }
}
