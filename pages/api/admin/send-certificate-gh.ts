import type { NextApiRequest, NextApiResponse } from 'next';
import { google } from 'googleapis';
import pool from '@lib/db';
import { getTrainingPartnerIdentifiers } from '@lib/trainingPartnerIdentifiers';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { studentName, studentEmail, courseName, courseDates, userId, ccEmails } = req.body;
  const tp = await getTrainingPartnerIdentifiers();

  // Parse CC list from request
  const ccList: string[] = typeof ccEmails === 'string' && ccEmails.trim()
    ? ccEmails.split(',').map((e: string) => e.trim()).filter(Boolean)
    : [];

  if (!studentName || !studentEmail || !courseName || !courseDates || !userId) {
    return res.status(400).json({ error: 'All fields are required' });
  }

  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!emailRegex.test(studentEmail)) {
    return res.status(400).json({ error: 'Invalid email address' });
  }

  // Resolve training provider from user ID (via member table or direct ownership)
  let emailUser: string, clientId: string, clientSecret: string, refreshToken: string, slidesTemplateId: string;
  let senderName = '';
  let senderEmail = '';
  let replyToEmail = '';
  try {
    let result = await pool.query(
      `SELECT tp.email_user, tp.google_client_id, tp.google_client_secret, tp.google_refresh_token, tp.google_slides_template_id, tp.contact_person_name, tp.company_email
       FROM training_provider tp
       INNER JOIN training_provider_member tpm ON tpm.provider_id = tp.id
       WHERE tpm.user_id = $1`,
      [userId]
    );
    if (result.rows.length === 0) {
      result = await pool.query(
        'SELECT email_user, google_client_id, google_client_secret, google_refresh_token, google_slides_template_id, contact_person_name, company_email FROM training_provider WHERE id = $1',
        [userId]
      );
    }
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Training provider not found' });
    }
    const tp = result.rows[0];
    emailUser = tp.email_user;
    clientId = tp.google_client_id;
    clientSecret = tp.google_client_secret;
    refreshToken = tp.google_refresh_token;
    slidesTemplateId = tp.google_slides_template_id;
    senderName = tp.contact_person_name || '';
    senderEmail = tp.company_email || emailUser;
    // Safely fetch support_email (column may not exist yet)
    try {
      const seResult = await pool.query('SELECT support_email FROM training_provider WHERE id = (SELECT provider_id FROM training_provider_member WHERE user_id = $1 LIMIT 1)', [userId]);
      if (seResult.rows.length > 0 && seResult.rows[0].support_email) replyToEmail = seResult.rows[0].support_email;
    } catch (e) { /* column doesn't exist yet */ }
    if (!replyToEmail) replyToEmail = senderEmail;

    if (!emailUser || !clientId || !clientSecret || !refreshToken || !slidesTemplateId) {
      return res.status(400).json({ error: 'Google Integration settings are incomplete. Please configure Email User, Client ID, Client Secret, Refresh Token, and Slides Template ID in Company Settings.' });
    }
  } catch (err) {
    console.error('Failed to fetch training provider settings:', err);
    return res.status(500).json({ error: 'Failed to fetch training provider settings' });
  }

  // Set up Google OAuth2
  const oauth2Client = new google.auth.OAuth2(
    clientId,
    clientSecret,
    'https://developers.google.com/oauthplayground'
  );
  oauth2Client.setCredentials({ refresh_token: refreshToken });

  const drive = google.drive({ version: 'v3', auth: oauth2Client });
  const slides = google.slides({ version: 'v1', auth: oauth2Client });
  const gmail = google.gmail({ version: 'v1', auth: oauth2Client });

  let tempFileId: string | null = null;

  try {
    // 1. Copy the Google Slides template
    const copyResponse = await drive.files.copy({
      fileId: slidesTemplateId,
      requestBody: { name: `Certificate - ${studentName}` },
    });
    tempFileId = copyResponse.data.id!;

    // 2. Replace placeholders in the copy
    await slides.presentations.batchUpdate({
      presentationId: tempFileId,
      requestBody: {
        requests: [
          { replaceAllText: { containsText: { text: '[Student Name]', matchCase: true }, replaceText: studentName } },
          { replaceAllText: { containsText: { text: '[Course Name]', matchCase: true }, replaceText: courseName } },
          { replaceAllText: { containsText: { text: '[Course Dates]', matchCase: true }, replaceText: courseDates } },
        ],
      },
    });

    // 3. Export as PDF
    const pdfResponse = await drive.files.export(
      { fileId: tempFileId, mimeType: 'application/pdf' },
      { responseType: 'arraybuffer' }
    );
    const pdfBuffer = Buffer.from(pdfResponse.data as ArrayBuffer);

    // 4. Delete the temp copy
    await drive.files.delete({ fileId: tempFileId });
    tempFileId = null;

    // 5. Send email with PDF attachment via Gmail API
    const sanitizedName = studentName.replace(/[^a-zA-Z0-9\s-]/g, '').replace(/\s+/g, '-');
    const fileName = `${sanitizedName}-Certificate-of-Achievement.pdf`;

    const boundary = '----CertBoundary' + Date.now();

    // Fetch certificate email template from DB (or use defaults)
    let dbSubject = '';
    let dbBody = '';
    try {
      const tplResult = await pool.query('SELECT certificate_email_subject, certificate_email_body FROM training_provider LIMIT 1');
      if (tplResult.rows.length > 0) {
        dbSubject = tplResult.rows[0].certificate_email_subject || '';
        dbBody = tplResult.rows[0].certificate_email_body || '';
      }
    } catch (e) { /* columns don't exist yet */ }

    const subject = (dbSubject || 'Certificate for Completing {COURSE_NAME}')
      .replace(/\{STUDENT_NAME\}/g, studentName)
      .replace(/\{COURSE_NAME\}/g, courseName)
      .replace(/\{COMPANY_NAME\}/g, tp.name || 'Training Provider')
      .replace(/\{COMPANY_SHORT_NAME\}/g, tp.companyShortname || tp.name || 'Training Provider')
      .replace(/\{COMPANY_WEBSITE\}/g, tp.companyWebsite || '')
      .replace(/\{CERTIFICATE_URL\}/g, '');

    const defaultBody = `Hello {STUDENT_NAME},

Congratulations on successfully completing the course {COURSE_NAME}! We are truly proud of your perseverance, dedication, and motivation throughout the program.

Please find attached your Certificate of Achievement in recognition of your accomplishment.

Your commitment to learning and professional growth is commendable, and we wish you continued success in applying your new skills.

For learners who have achieved at least 75% attendance and passed their assessment for WSQ courses, they can view and download their WSQ SOA (Statement of Attainment) through http://www.MySkillsFuture.gov.sg.

Please note that SkillsFuture Singapore uses OpenCerts certificates to issue the WSQ Statements of Attainment (SOA). The OpenCerts will be ready for viewing/downloading 4-5 weeks upon completion of WSQ courses.

Feel free to let me know if you need anything else. Thank you.

Best regards,
Support Team
{COMPANY_SHORT_NAME}
Tel: 61000613 | Email: support@tertiaryinfotech.com | WhatsApp: https://wa.me/6561000613`;

    const bodyText = (dbBody || defaultBody)
      .replace(/\{STUDENT_NAME\}/g, studentName)
      .replace(/\{COURSE_NAME\}/g, courseName)
      .replace(/\{COMPANY_NAME\}/g, tp.name || 'Training Provider')
      .replace(/\{COMPANY_SHORT_NAME\}/g, tp.companyShortname || tp.name || 'Training Provider')
      .replace(/\{COMPANY_WEBSITE\}/g, tp.companyWebsite || '')
      .replace(/\{CERTIFICATE_URL\}/g, '');

    const htmlBody = `
      <div style="font-family: Arial, sans-serif; color: #333;">
        ${bodyText.split('\n').map(line => line.trim() ? `<p style="margin:0 0 8px 0;">${line}</p>` : '').join('\n        ')}
      </div>
    `;

    const rawEmail = [
      `From: ${senderName ? `${senderName} <${emailUser}>` : emailUser}`,
      `Reply-To: ${replyToEmail}`,
      `To: ${studentEmail}`,
      `Cc: ${ccList.join(', ')}`,
      `Subject: ${subject}`,
      `MIME-Version: 1.0`,
      `Content-Type: multipart/mixed; boundary="${boundary}"`,
      '',
      `--${boundary}`,
      `Content-Type: multipart/alternative; boundary="alt-${boundary}"`,
      '',
      `--alt-${boundary}`,
      `Content-Type: text/plain; charset="UTF-8"`,
      '',
      `Dear ${studentName}, Congratulations on completing ${courseName}! Your Certificate of Achievement is attached.`,
      '',
      `--alt-${boundary}`,
      `Content-Type: text/html; charset="UTF-8"`,
      '',
      htmlBody,
      '',
      `--alt-${boundary}--`,
      '',
      `--${boundary}`,
      `Content-Type: application/pdf; name="${fileName}"`,
      `Content-Disposition: attachment; filename="${fileName}"`,
      `Content-Transfer-Encoding: base64`,
      '',
      pdfBuffer.toString('base64'),
      '',
      `--${boundary}--`,
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

    return res.status(200).json({ success: true, message: `Certificate sent to ${studentEmail} (CC: ${ccList.join(', ')})`, fileName });
  } catch (err: any) {
    if (tempFileId) {
      try {
        await drive.files.delete({ fileId: tempFileId });
      } catch {}
    }
    console.error('Certificate generation/sending failed:', err);
    return res.status(500).json({ error: err.message || 'Failed to generate and send certificate' });
  }
}
