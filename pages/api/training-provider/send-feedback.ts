import type { NextApiRequest, NextApiResponse } from 'next';
import { google } from 'googleapis';
import pool from '@lib/db';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ success: false, error: 'Method not allowed' });
  }

  const { name, email, tel, message } = req.body;

  if (!name || !email || !message) {
    return res.status(400).json({ success: false, error: 'Name, email, and message are required.' });
  }

  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!emailRegex.test(email)) {
    return res.status(400).json({ success: false, error: 'Invalid email address.' });
  }

  try {
    // Fetch training provider Gmail OAuth credentials and contact person email
    const result = await pool.query(
      `SELECT email_user, company_email, google_client_id, google_client_secret, google_refresh_token,
              contact_person_name, contact_tel, company_name
       FROM training_provider LIMIT 1`
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ success: false, error: 'Training provider not found.' });
    }

    const tp = result.rows[0];
    const { email_user, company_email, google_client_id, google_client_secret, google_refresh_token, company_name } = tp;
    const replyToEmail = company_email || email_user;
    const senderName = tp.contact_person_name || '';

    // Get contact person email from app_user table (linked via training_provider_member or provider_admin_user)
    let contactEmail: string | null = null;
    try {
      const contactResult = await pool.query(
        `SELECT au.email FROM app_user au
         INNER JOIN training_provider_member tpm ON tpm.user_id = au.id
         INNER JOIN training_provider tp ON tp.id = tpm.provider_id
         WHERE tp.id = (SELECT id FROM training_provider LIMIT 1)
         LIMIT 1`
      );
      if (contactResult.rows.length > 0) {
        contactEmail = contactResult.rows[0].email;
      }
    } catch (e) {
      console.error('Error fetching contact email:', e);
    }

    // Fallback: use email_user as recipient if contact email not found
    const recipientEmail = contactEmail || email_user;

    if (!email_user || !google_client_id || !google_client_secret || !google_refresh_token) {
      return res.status(400).json({
        success: false,
        error: 'Gmail OAuth settings are not configured. Please set up Email User, Client ID, Client Secret, and Refresh Token in Company Settings.'
      });
    }

    if (!recipientEmail) {
      return res.status(400).json({
        success: false,
        error: 'No contact person email found. Please configure contact person in Company Settings.'
      });
    }

    // Set up Google OAuth2
    const oauth2Client = new google.auth.OAuth2(
      google_client_id,
      google_client_secret,
      'https://developers.google.com/oauthplayground'
    );
    oauth2Client.setCredentials({ refresh_token: google_refresh_token });

    const gmail = google.gmail({ version: 'v1', auth: oauth2Client });

    // Fetch feedback email template from DB (or use defaults)
    let dbSubject = '';
    let dbBody = '';
    let dbCc = '';
    try {
      const tplResult = await pool.query('SELECT feedback_email_subject, feedback_email_body, feedback_email_cc FROM training_provider LIMIT 1');
      if (tplResult.rows.length > 0) {
        dbSubject = tplResult.rows[0].feedback_email_subject || '';
        dbBody = tplResult.rows[0].feedback_email_body || '';
        dbCc = tplResult.rows[0].feedback_email_cc || '';
      }
    } catch (e) { /* columns don't exist yet */ }

    const replaceVars = (text: string) => text
      .replace(/\{SENDER_NAME\}/g, name)
      .replace(/\{SENDER_EMAIL\}/g, email)
      .replace(/\{SENDER_TEL\}/g, tel || 'Not provided')
      .replace(/\{MESSAGE\}/g, message)
      .replace(/\{COMPANY_NAME\}/g, company_name || 'LMS/TMS');

    const defaultSubject = 'Feedback from {SENDER_NAME} - {COMPANY_NAME}';
    const subject = replaceVars(dbSubject || defaultSubject);

    const defaultBody = `<div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
        <h2 style="color: #1e40af; border-bottom: 2px solid #3b82f6; padding-bottom: 10px;">New Feedback Received</h2>
        <table style="width: 100%; border-collapse: collapse; margin-top: 15px;">
          <tr>
            <td style="padding: 8px 12px; font-weight: bold; color: #374151; width: 120px; vertical-align: top;">Name:</td>
            <td style="padding: 8px 12px; color: #1f2937;">{SENDER_NAME}</td>
          </tr>
          <tr style="background-color: #f9fafb;">
            <td style="padding: 8px 12px; font-weight: bold; color: #374151; vertical-align: top;">Email:</td>
            <td style="padding: 8px 12px; color: #1f2937;"><a href="mailto:{SENDER_EMAIL}">{SENDER_EMAIL}</a></td>
          </tr>
          <tr>
            <td style="padding: 8px 12px; font-weight: bold; color: #374151; vertical-align: top;">Tel:</td>
            <td style="padding: 8px 12px; color: #1f2937;">{SENDER_TEL}</td>
          </tr>
          <tr style="background-color: #f9fafb;">
            <td style="padding: 8px 12px; font-weight: bold; color: #374151; vertical-align: top;">Message:</td>
            <td style="padding: 8px 12px; color: #1f2937; white-space: pre-wrap;">{MESSAGE}</td>
          </tr>
        </table>
        <p style="margin-top: 20px; font-size: 12px; color: #9ca3af;">
          This feedback was submitted via the {COMPANY_NAME} login page.
        </p>
      </div>`;
    const htmlBody = replaceVars(dbBody || defaultBody);

    const ccList = dbCc ? dbCc.split(',').map((e: string) => e.trim()).filter(Boolean) : [];

    const rawEmail = [
      `From: ${senderName ? `${senderName} <${email_user}>` : email_user}`,
      `To: ${recipientEmail}`,
      ...(ccList.length > 0 ? [`Cc: ${ccList.join(', ')}`] : []),
      `Reply-To: ${email}`,
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

    return res.status(200).json({ success: true, message: 'Feedback sent successfully.' });
  } catch (error) {
    console.error('Error sending feedback:', error);
    return res.status(500).json({
      success: false,
      error: 'Failed to send feedback. Please try again later.'
    });
  }
}
