import type { NextApiRequest, NextApiResponse } from 'next';
import { google } from 'googleapis';
import pool from '@lib/db';
import { getTrainingPartnerIdentifiers } from '@lib/trainingPartnerIdentifiers';
import { renderInvitationHtmlEmail, renderInvitationTemplate, parseCcList } from '@lib/trainerInvitations';

/**
 * POST /api/training-provider/send-test-email
 *
 * Generic test email sender for all email templates.
 * Body: { testEmail, subject, body, templateType }
 *
 * templateType: 'certificate' | 'course-confirmation' | 'final-course-confirmation' |
 *               'otp' | 'feedback' | 'password-reset' | 'trainer-invitation' | 'courseware-attendance'
 */

// Sample data per template type for variable replacement
const SAMPLE_DATA: Record<string, Record<string, string>> = {
  certificate: {
    '{STUDENT_NAME}': 'John Doe',
    '{COURSE_NAME}': 'WSQ Advanced Certificate in AI',
    '{CERTIFICATE_URL}': 'https://drive.google.com/file/d/example/view',
  },
  'course-confirmation': {
    '{STUDENT_NAME}': 'John Doe',
    '{COURSE_NAME}': 'WSQ Advanced Certificate in AI',
    '{COURSE_START_DATE}': 'Mon Apr 14 2026 09:30:00',
  },
  'final-course-confirmation': {
    '{STUDENT_NAME}': 'John Doe',
    '{COURSE_NAME}': 'WSQ Advanced Certificate in AI',
    '{COURSE_START_DATE}': 'Mon Apr 14 2026 09:30:00',
  },
  otp: {
    '{OTP}': '123456',
    '{STUDENT_NAME}': 'John Doe',
  },
  feedback: {
    '{STUDENT_NAME}': 'John Doe',
    '{COURSE_NAME}': 'WSQ Advanced Certificate in AI',
    '{FEEDBACK_URL}': 'https://example.com/feedback/sample',
  },
  'password-reset': {
    '{STUDENT_NAME}': 'John Doe',
    '{RESET_URL}': 'https://example.com/reset-password?token=sample',
    '{RESET_LINK}': 'https://example.com/reset-password?token=sample',
  },
  'trainer-invitation': {
    '{TRAINER_NAME}': 'Jane Smith',
    '{COURSE_TITLE}': 'Generative AI for Business',
    '{COURSE_TYPE}': 'Physical',
    '{COURSE_CODE}': 'TGS-2023036653',
    '{COURSE_RUN_ID}': '1131876',
    '{START_DATE}': '06/04/2026',
    '{END_DATE}': '09/04/2026',
    '{DURATION}': '4 days',
    '{COURSE_HOURS}': '32h',
    '{CONFIRM_BY}': '04/04/2026, 23:59 PM',
    '{TPG_TRAINER}': 'Dr Alvin Ang Wei Hern',
  },
  'courseware-attendance': {
    '{COURSE_NAME}': 'WSQ - Tax Computations for Individuals and Organizations',
    '{DIGITAL_ATTENDANCE_ID}': 'RA572084',
  },
};

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ success: false, error: 'Method not allowed' });
  }

  const { testEmail, subject, body: emailBody, templateType = 'certificate', cc } = req.body;

  if (!testEmail || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(testEmail)) {
    return res.status(400).json({ success: false, error: 'Valid test email address is required.' });
  }

  try {
    const tp = await getTrainingPartnerIdentifiers();

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

    // Build replacement map: template-specific samples + common company vars
    const replacements: Record<string, string> = {
      ...(SAMPLE_DATA[templateType] || SAMPLE_DATA.certificate),
      '{COMPANY_NAME}': companyName,
      '{COMPANY_SHORT_NAME}': companyShortName,
      '{COMPANY_WEBSITE}': companyWebsite,
    };

    // Replace all variables
    let sampleSubject = subject || '';
    let sampleBody = emailBody || '';
    for (const [key, value] of Object.entries(replacements)) {
      const regex = new RegExp(key.replace(/[{}]/g, '\\$&'), 'g');
      sampleSubject = sampleSubject.replace(regex, value);
      sampleBody = sampleBody.replace(regex, value);
    }

    // Trainer-invitation templates need the specialized HTML renderer so that
    // **bold** lines, tight line spacing, and side-by-side Accept/Decline
    // buttons render correctly. Strip the leading `{` in sample keys to match
    // the placeholder shape expected by renderInvitationHtmlEmail.
    let htmlBody: string;
    if (templateType === 'trainer-invitation') {
      const invitationReplacements: Record<string, string> = {};
      for (const [k, v] of Object.entries(replacements)) {
        invitationReplacements[k.replace(/[{}]/g, '')] = v;
      }
      const renderedBody = renderInvitationHtmlEmail(
        emailBody || '',
        invitationReplacements,
        '#',
        '#'
      );
      htmlBody = `
      ${renderedBody}
      <p style="margin:0 16px; color: #999; font-size: 11px;">--- This is a test email sent from the Email Template editor ---</p>
      `;
    } else {
      const isHtml = /<[a-z][\s\S]*>/i.test(sampleBody);
      htmlBody = `
      <div style="font-family: Arial, sans-serif; color: #333;">
        ${isHtml ? sampleBody : sampleBody.split('\n').map((line: string) => line.trim() ? `<p style="margin:0 0 2px 0;">${line}</p>` : '<br/>').join('\n        ')}
        <br/>
        <p style="margin:0; color: #999; font-size: 11px;">--- This is a test email sent from the Email Template editor ---</p>
      </div>
    `;
    }

    // Set up Gmail API
    const oauth2Client = new google.auth.OAuth2(
      google_client_id, google_client_secret, 'https://developers.google.com/oauthplayground'
    );
    oauth2Client.setCredentials({ refresh_token: google_refresh_token });
    const gmail = google.gmail({ version: 'v1', auth: oauth2Client });

    // Optional CC list passed from the template editor — validates and
    // dedupes via parseCcList so test sends mirror real production sends.
    const ccList = parseCcList(typeof cc === 'string' ? cc : null);

    const headers = [
      `From: ${senderName ? `${senderName} <${email_user}>` : email_user}`,
      `To: ${testEmail}`,
    ];
    if (ccList.length > 0) {
      headers.push(`Cc: ${ccList.join(', ')}`);
    }
    headers.push(
      `Subject: [TEST] ${sampleSubject}`,
      'MIME-Version: 1.0',
      'Content-Type: text/html; charset=UTF-8',
      '',
      htmlBody
    );
    const rawEmail = headers.join('\r\n');

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
    console.error('Error sending test email:', error);
    return res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Failed to send test email.',
    });
  }
}
