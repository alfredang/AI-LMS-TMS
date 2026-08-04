import { withAuth } from '@lib/auth/withAuth';
import type { NextApiRequest, NextApiResponse } from 'next';
import { google } from 'googleapis';
import pool from '@lib/db';
import { getTrainingPartnerIdentifiers } from '@lib/trainingPartnerIdentifiers';

/**
 * POST /api/training-provider/send-test-certificate-email
 *
 * Sends a test certificate email using the current template with sample data.
 * Body: { testEmail, subject, body }
 */
async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ success: false, error: 'Method not allowed' });
  }

  const { testEmail, subject, body: emailBody } = req.body;

  if (!testEmail || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(testEmail)) {
    return res.status(400).json({ success: false, error: 'Valid test email address is required.' });
  }

  try {
    const tp = await getTrainingPartnerIdentifiers();

    // Get Google credentials from training_provider
    const result = await pool.query(
      `SELECT email_user, google_client_id, google_client_secret, google_refresh_token,
              contact_person_name, company_email, company_name, company_shortname, company_website
       FROM training_provider LIMIT 1`
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ success: false, error: 'Training provider not found.' });
    }

    const tpRow = result.rows[0];
    const { email_user, google_client_id, google_client_secret, google_refresh_token } = tpRow;

    if (!email_user || !google_client_id || !google_client_secret || !google_refresh_token) {
      return res.status(400).json({ success: false, error: 'Google Integration settings are incomplete. Configure them in Company Settings.' });
    }

    const senderName = tpRow.contact_person_name || '';
    const companyName = tpRow.company_name || tp.name || 'Training Provider';
    const companyShortName = tpRow.company_shortname || companyName;
    const companyWebsite = tpRow.company_website || '';

    // Replace template variables with sample data
    const sampleSubject = (subject || 'Certificate for Completing {COURSE_NAME}')
      .replace(/\{STUDENT_NAME\}/g, 'John Doe')
      .replace(/\{COURSE_NAME\}/g, 'WSQ Advanced Certificate in AI')
      .replace(/\{COMPANY_NAME\}/g, companyName)
      .replace(/\{COMPANY_SHORT_NAME\}/g, companyShortName)
      .replace(/\{COMPANY_WEBSITE\}/g, companyWebsite)
      .replace(/\{CERTIFICATE_URL\}/g, 'https://drive.google.com/file/d/example/view');

    const sampleBody = (emailBody || '')
      .replace(/\{STUDENT_NAME\}/g, 'John Doe')
      .replace(/\{COURSE_NAME\}/g, 'WSQ Advanced Certificate in AI')
      .replace(/\{COMPANY_NAME\}/g, companyName)
      .replace(/\{COMPANY_SHORT_NAME\}/g, companyShortName)
      .replace(/\{COMPANY_WEBSITE\}/g, companyWebsite)
      .replace(/\{CERTIFICATE_URL\}/g, 'https://drive.google.com/file/d/example/view');

    const isHtml = /<[a-z][\s\S]*>/i.test(sampleBody);
    const htmlBody = `
      <div style="font-family: Arial, sans-serif; color: #333;">
        ${isHtml ? sampleBody : sampleBody.split('\n').map(line => line.trim() ? `<p style="margin:0 0 2px 0;">${line}</p>` : '<br/>').join('\n        ')}
        <br/>
        <p style="margin:0 0 4px 0; color: #999; font-size: 11px;">--- This is a test email sent from the Certificate Email Template editor ---</p>
      </div>
    `;

    // Set up Gmail API
    const oauth2Client = new google.auth.OAuth2(
      google_client_id,
      google_client_secret,
      'https://developers.google.com/oauthplayground'
    );
    oauth2Client.setCredentials({ refresh_token: google_refresh_token });
    const gmail = google.gmail({ version: 'v1', auth: oauth2Client });

    // Build raw email
    const rawEmail = [
      `From: ${senderName ? `${senderName} <${email_user}>` : email_user}`,
      `To: ${testEmail}`,
      `Subject: [TEST] ${sampleSubject}`,
      'MIME-Version: 1.0',
      'Content-Type: text/html; charset=UTF-8',
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

    return res.status(200).json({ success: true, message: `Test email sent to ${testEmail}` });
  } catch (error) {
    console.error('Error sending test certificate email:', error);
    return res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Failed to send test email.',
    });
  }
}

export default withAuth(handler, { roles: ['admin', 'trainingProvider'] });
