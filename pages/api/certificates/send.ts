import type { NextApiRequest, NextApiResponse } from 'next';
import pool from '../../../lib/db';
import { generateAndUploadCertificate } from '../../../lib/services/certificateService';
import { checkCertificateEligibility } from '../../../lib/services/enrolmentEligibility';

/**
 * POST /api/certificates/send
 * Manually send certificates to selected learners for a given course run.
 * Body: { courseRunId: string, enrolmentIds: string[] }
 */
export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ success: false, message: 'Method not allowed' });
  }

  const { courseRunId, enrolmentIds } = req.body;

  if (!courseRunId || !Array.isArray(enrolmentIds) || enrolmentIds.length === 0) {
    return res.status(400).json({ success: false, message: 'courseRunId and enrolmentIds[] are required' });
  }

  try {
    // Get course run details for the email
    const crRes = await pool.query(`
      SELECT cr.id, c.title as course_title,
             TO_CHAR(cr.start_date AT TIME ZONE 'Asia/Singapore', 'DD Mon YYYY') || ' - ' || TO_CHAR(cr.end_date AT TIME ZONE 'Asia/Singapore', 'DD Mon YYYY') as course_dates
      FROM course_run cr
      JOIN course c ON cr.course_id = c.id
      WHERE cr.id = $1
    `, [courseRunId]);

    if (crRes.rows.length === 0) {
      return res.status(404).json({ success: false, message: 'Course run not found' });
    }
    const courseRun = crRes.rows[0];

    // Get training provider Google credentials for email sending
    const tpRes = await pool.query(`
      SELECT email_user, google_client_id, google_client_secret, google_refresh_token,
             google_slides_template_id, contact_person_name,
             certificate_email_subject, certificate_email_body, certificate_email_cc
      FROM training_provider LIMIT 1
    `);
    if (tpRes.rows.length === 0) {
      return res.status(500).json({ success: false, message: 'Training provider not found' });
    }
    const tp = tpRes.rows[0];

    if (!tp.email_user || !tp.google_client_id || !tp.google_client_secret || !tp.google_refresh_token || !tp.google_slides_template_id) {
      return res.status(500).json({ success: false, message: 'Google Integration settings incomplete' });
    }

    // Fetch selected enrolments
    const enrolRes = await pool.query(`
      SELECT e.id as enrolment_id, e.nric, e.certificate,
             COALESCE(au.full_name, e.nric, 'Unknown') as learner_name,
             COALESCE(au.email, e.email) as learner_email
      FROM enrollment e
      LEFT JOIN app_user au ON e.user_id = au.id
      WHERE e.id = ANY($1)
        AND e.course_run_id = $2
    `, [enrolmentIds, courseRunId]);

    const results: { name: string; status: string; error?: string }[] = [];

    // Import sendCertificateEmail from auto-create-certificates
    const { google: goog } = await import('googleapis');
    const { getTrainingPartnerIdentifiers } = await import('../../../lib/trainingPartnerIdentifiers');
    const tpIdentifiers = await getTrainingPartnerIdentifiers();

    const oauth2Client = new goog.auth.OAuth2(tp.google_client_id, tp.google_client_secret, 'https://developers.google.com/oauthplayground');
    oauth2Client.setCredentials({ refresh_token: tp.google_refresh_token });
    const drive = goog.drive({ version: 'v3', auth: oauth2Client });
    const slides = goog.slides({ version: 'v1', auth: oauth2Client });
    const gmail = goog.gmail({ version: 'v1', auth: oauth2Client });

    for (const learner of enrolRes.rows) {
      try {
        // Guard: do not issue a certificate for a cancelled class or a
        // cancelled/withdrawn enrolment. Skip this learner, continue the rest.
        const eligibility = await checkCertificateEligibility(learner.enrolment_id);
        if (!eligibility.eligible) {
          results.push({ name: learner.learner_name, status: 'skipped', error: `Skipped — ${eligibility.reason}` });
          continue;
        }

        // Generate certificate (uploads to Drive, saves URL in enrollment)
        const certificateUrl = await generateAndUploadCertificate(learner.enrolment_id, pool, learner.learner_name);

        // Send email if learner has email
        if (learner.learner_email) {
          // Generate PDF from template for email attachment
          const copyResponse = await drive.files.copy({
            fileId: tp.google_slides_template_id,
            requestBody: { name: `Certificate - ${learner.learner_name}` },
          });
          const tempFileId = copyResponse.data.id!;

          try {
            await slides.presentations.batchUpdate({
              presentationId: tempFileId,
              requestBody: {
                requests: [
                  { replaceAllText: { containsText: { text: '[Student Name]', matchCase: true }, replaceText: learner.learner_name } },
                  { replaceAllText: { containsText: { text: '[Course Name]', matchCase: true }, replaceText: courseRun.course_title } },
                  { replaceAllText: { containsText: { text: '[Course Dates]', matchCase: true }, replaceText: courseRun.course_dates || '' } },
                ],
              },
            });

            const pdfResponse = await drive.files.export(
              { fileId: tempFileId, mimeType: 'application/pdf' },
              { responseType: 'arraybuffer' }
            );
            const pdfBuffer = Buffer.from(pdfResponse.data as ArrayBuffer);
            await drive.files.delete({ fileId: tempFileId });

            // Compose email
            const sanitizedName = learner.learner_name.replace(/[^a-zA-Z0-9\s-]/g, '').replace(/\s+/g, '-');
            const fileName = `${sanitizedName}-Certificate-of-Achievement.pdf`;
            const boundary = '----CertBoundary' + Date.now();

            const replacePlaceholders = (text: string) => text
              .replace(/\{STUDENT_NAME\}/g, learner.learner_name)
              .replace(/\{COURSE_NAME\}/g, courseRun.course_title)
              .replace(/\{COMPANY_NAME\}/g, tpIdentifiers.name || 'Training Provider')
              .replace(/\{COMPANY_SHORT_NAME\}/g, tpIdentifiers.companyShortname || tpIdentifiers.name || 'Training Provider')
              .replace(/\{COMPANY_WEBSITE\}/g, tpIdentifiers.companyWebsite || '')
              .replace(/\{CERTIFICATE_URL\}/g, certificateUrl || '');

            const subject = replacePlaceholders(tp.certificate_email_subject || 'Certificate for Completing {COURSE_NAME}');
            const defaultBody = `Hello {STUDENT_NAME},\n\nCongratulations on successfully completing the course {COURSE_NAME}!\n\nPlease find attached your Certificate of Achievement.\n\nYou can also download your certificate here: {CERTIFICATE_URL}\n\nBest regards,\n{COMPANY_SHORT_NAME}`;
            const bodyText = replacePlaceholders(tp.certificate_email_body || defaultBody);
            const isHtml = /<[a-z][\s\S]*>/i.test(bodyText);
            const htmlBody = `<div style="font-family: Arial, sans-serif; color: #333;">${isHtml ? bodyText : bodyText.split('\n').map(line => line.trim() ? `<p style="margin:0 0 2px 0;">${line}</p>` : '<br/>').join('\n')}</div>`;

            const rawEmail = [
              `From: ${tp.contact_person_name ? `${tp.contact_person_name} <${tp.email_user}>` : tp.email_user}`,
              `To: ${learner.learner_email}`,
              ...(tp.certificate_email_cc ? [`Cc: ${tp.certificate_email_cc}`] : []),
              `Subject: ${subject}`,
              `MIME-Version: 1.0`,
              `Content-Type: multipart/mixed; boundary="${boundary}"`,
              '',
              `--${boundary}`,
              `Content-Type: text/html; charset="UTF-8"`,
              '',
              htmlBody,
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

            const encodedMessage = Buffer.from(rawEmail).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
            await gmail.users.messages.send({ userId: 'me', requestBody: { raw: encodedMessage } });
          } catch (emailErr) {
            // Clean up temp file on error
            try { await drive.files.delete({ fileId: tempFileId }); } catch {}
            throw emailErr;
          }

          results.push({ name: learner.learner_name, status: 'sent' });
        } else {
          results.push({ name: learner.learner_name, status: 'generated', error: 'No email address — certificate generated but not emailed' });
        }
      } catch (err: any) {
        console.error(`[send-certificate] Error for ${learner.learner_name}:`, err.message);
        results.push({ name: learner.learner_name, status: 'error', error: err.message });
      }
    }

    const sent = results.filter(r => r.status === 'sent').length;
    const errors = results.filter(r => r.status === 'error').length;

    return res.status(200).json({
      success: true,
      message: `${sent} certificate(s) sent, ${errors} error(s)`,
      results
    });
  } catch (error: any) {
    console.error('[send-certificate] Fatal error:', error);
    return res.status(500).json({ success: false, message: error.message || 'Internal server error' });
  }
}
