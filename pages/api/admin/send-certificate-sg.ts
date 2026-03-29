import type { NextApiRequest, NextApiResponse } from 'next';
import { google } from 'googleapis';
import pool from '@lib/db';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { studentName, studentEmail, courseName, courseDates, userId, ccEmails } = req.body;

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
  try {
    // Try member table first, then direct ownership
    let result = await pool.query(
      `SELECT tp.email_user, tp.google_client_id, tp.google_client_secret, tp.google_refresh_token, tp.google_slides_template_id
       FROM training_provider tp
       INNER JOIN training_provider_member tpm ON tpm.provider_id = tp.id
       WHERE tpm.user_id = $1`,
      [userId]
    );
    if (result.rows.length === 0) {
      result = await pool.query(
        'SELECT email_user, google_client_id, google_client_secret, google_refresh_token, google_slides_template_id FROM training_provider WHERE id = $1',
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
    const subject = 'Certificate of Achievement: Congratulations!';

    const htmlBody = `
      <div style="font-family: Arial, sans-serif; color: #333;">
        <p>Dear ${studentName},</p>
        <p>Congratulations on successfully completing <strong>${courseName}</strong>!</p>
        <p>Please find your Certificate of Achievement attached to this email.</p>
        <br/>
        <p>Best regards,</p>
        <p><strong>Tertiary Infotech Pte Ltd</strong></p>
        <p style="font-size: 12px; color: #666;">
          <a href="https://www.tertiarycourses.com.sg">www.tertiarycourses.com.sg</a> |
          <a href="https://www.tertiaryinfotech.com">www.tertiaryinfotech.com</a>
        </p>
      </div>
    `;

    const rawEmail = [
      `From: ${emailUser}`,
      `To: ${studentEmail}`,
      ...(ccList.length > 0 ? [`Cc: ${ccList.join(', ')}`] : []),
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

    return res.status(200).json({ success: true, message: `Certificate sent to ${studentEmail}${ccList.length > 0 ? ` (CC: ${ccList.join(', ')})` : ''}`, fileName });
  } catch (err: any) {
    // Clean up temp file if it exists
    if (tempFileId) {
      try {
        await drive.files.delete({ fileId: tempFileId });
      } catch {}
    }
    console.error('Certificate generation/sending failed:', err);
    return res.status(500).json({ error: err.message || 'Failed to generate and send certificate' });
  }
}
