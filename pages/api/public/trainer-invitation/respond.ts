import type { NextApiRequest, NextApiResponse } from 'next';
import { google } from 'googleapis';
import pool from '@lib/db';
import {
  ensureTrainerInvitationTable,
  ensureTrainerInvitationTemplateColumns,
  renderInvitationTemplate,
  convertPlainTextToHtml,
  renderInvitationHtmlEmail,
  formatDateLabel,
  createInvitationToken,
  normalizeTrainerName,
  splitTrainerList,
  DEFAULT_TRAINER_ACCEPT_SUBJECT,
  DEFAULT_TRAINER_ACCEPT_BODY,
  DEFAULT_TRAINER_DECLINE_SUBJECT,
  DEFAULT_TRAINER_DECLINE_BODY,
  DEFAULT_TRAINER_INVITATION_SUBJECT,
  DEFAULT_TRAINER_INVITATION_BODY,
} from '@/lib/trainerInvitations';

function renderPage(title: string, description: string, tone: 'green' | 'red' | 'gray') {
  const colors = {
    green: { bg: '#dcfce7', text: '#166534' },
    red: { bg: '#fee2e2', text: '#991b1b' },
    gray: { bg: '#e2e8f0', text: '#334155' },
  }[tone];

  return `<!doctype html>
  <html>
    <head>
      <meta charset="utf-8" />
      <meta name="viewport" content="width=device-width, initial-scale=1" />
      <title>${title}</title>
    </head>
    <body style="margin:0;font-family:Arial,sans-serif;background:#0f172a;color:#e2e8f0;display:flex;align-items:center;justify-content:center;min-height:100vh;padding:24px;">
      <div style="max-width:560px;width:100%;background:#1e293b;border-radius:16px;padding:32px;box-shadow:0 20px 50px rgba(15,23,42,0.45);">
        <div style="display:inline-block;padding:8px 12px;border-radius:999px;background:${colors.bg};color:${colors.text};font-weight:700;margin-bottom:16px;">${title}</div>
        <p style="margin:0;font-size:16px;line-height:1.6;color:#cbd5e1;">${description}</p>
      </div>
    </body>
  </html>`;
}

async function sendFollowUpEmail(
  trainerEmail: string,
  subject: string,
  htmlBody: string,
  tp: any
) {
  try {
    const oauth2Client = new google.auth.OAuth2(
      tp.google_client_id,
      tp.google_client_secret,
      'https://developers.google.com/oauthplayground'
    );
    oauth2Client.setCredentials({ refresh_token: tp.google_refresh_token });
    const gmail = google.gmail({ version: 'v1', auth: oauth2Client });

    const rawEmail = [
      `From: ${tp.company_shortname || tp.company_name || 'Training Provider'} <${tp.email_user}>`,
      `Reply-To: ${tp.company_email || tp.email_user}`,
      `To: ${trainerEmail}`,
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

    console.log(`📧 Follow-up email sent to ${trainerEmail}: ${subject}`);
  } catch (e) {
    console.error(`❌ Failed to send follow-up email to ${trainerEmail}:`, e);
  }
}

async function sendNextTrainerInvitation(courseRunUuid: string, tp: any) {
  try {
    // Get course run details
    const crResult = await pool.query(
      `SELECT cr.id, cr.course_run_id, c.title AS course_title, c.course_code,
              cr.start_date, cr.end_date, c.trainers_list,
              cr.tpg_assigned_trainer_name
       FROM course_run cr
       JOIN course c ON c.id = cr.course_id
       WHERE cr.id = $1`,
      [courseRunUuid]
    );
    const cr = crResult.rows[0];
    if (!cr) return;

    // Get already assigned local trainers
    const localResult = await pool.query(
      `SELECT trainer_name FROM course_run_trainer WHERE course_run_id = $1`,
      [courseRunUuid]
    );
    const localTrainerSet = new Set(localResult.rows.map((r: any) => normalizeTrainerName(r.trainer_name)));

    // Get all declined invitations
    const declinedResult = await pool.query(
      `SELECT trainer_name FROM trainer_invitation WHERE course_run_id = $1 AND status = 'declined'`,
      [courseRunUuid]
    );
    const declinedSet = new Set(declinedResult.rows.map((r: any) => normalizeTrainerName(r.trainer_name)));

    // Get pending invitations
    const pendingResult = await pool.query(
      `SELECT trainer_name FROM trainer_invitation WHERE course_run_id = $1 AND status = 'pending'`,
      [courseRunUuid]
    );
    const pendingSet = new Set(pendingResult.rows.map((r: any) => normalizeTrainerName(r.trainer_name)));

    // Find next available trainer from the approved list
    const approvedTrainers = splitTrainerList(cr.trainers_list);
    let nextTrainerName: string | null = null;

    for (const name of approvedTrainers) {
      const normalized = normalizeTrainerName(name);
      if (localTrainerSet.has(normalized)) continue;
      if (declinedSet.has(normalized)) continue;
      if (pendingSet.has(normalized)) continue;
      nextTrainerName = name;
      break;
    }

    if (!nextTrainerName) {
      console.log(`⚠️ No more available trainers for course run ${cr.course_run_id}`);
      return;
    }

    // Look up trainer email
    const trainerResult = await pool.query(
      `SELECT au.id, au.full_name, au.email
       FROM app_user au
       JOIN user_role_map urm ON urm.user_id = au.id
       WHERE LOWER(au.full_name) = LOWER($1) AND urm.role = 'Trainer'
       LIMIT 1`,
      [nextTrainerName]
    );
    const trainer = trainerResult.rows[0];
    if (!trainer?.email) {
      console.log(`⚠️ No email found for trainer ${nextTrainerName}`);
      return;
    }

    // Create invitation
    const token = createInvitationToken();
    const siteUrl = process.env.NEXT_PUBLIC_APP_URL || 'https://ai-lms-tms.tertiaryinfo.tech';
    const acceptUrl = `${siteUrl}/api/public/trainer-invitation/respond?token=${token}&action=accept`;
    const declineUrl = `${siteUrl}/api/public/trainer-invitation/respond?token=${token}&action=decline`;

    const replacements: Record<string, string> = {
      COMPANY_SHORT_NAME: tp.company_shortname || tp.company_name || 'Training Provider',
      TRAINER_NAME: trainer.full_name || nextTrainerName,
      COURSE_TITLE: cr.course_title || '',
      COURSE_CODE: cr.course_code || '',
      COURSE_RUN_ID: cr.course_run_id || '',
      START_DATE: formatDateLabel(cr.start_date),
      END_DATE: formatDateLabel(cr.end_date),
      TPG_TRAINER: cr.tpg_assigned_trainer_name || 'N/A',
      ACCEPT_URL: acceptUrl,
      DECLINE_URL: declineUrl,
    };

    const subject = renderInvitationTemplate(
      tp.trainer_invitation_email_subject || DEFAULT_TRAINER_INVITATION_SUBJECT,
      replacements
    );
    const body = renderInvitationTemplate(
      tp.trainer_invitation_email_body || DEFAULT_TRAINER_INVITATION_BODY,
      replacements
    );
<<<<<<< Updated upstream
    const htmlBody = renderInvitationHtmlEmail({
      trainerName: trainer.full_name || nextTrainerName,
      courseTitle: cr.course_title || '',
      courseCode: cr.course_code || '',
      courseRunId: cr.course_run_id || '',
      startDate: formatDateLabel(cr.start_date),
      endDate: formatDateLabel(cr.end_date),
      tpgTrainer: cr.tpg_assigned_trainer_name || 'N/A',
=======
    const htmlBody = renderInvitationHtmlEmail(
      tp.trainer_invitation_email_body || DEFAULT_TRAINER_INVITATION_BODY,
      replacements,
>>>>>>> Stashed changes
      acceptUrl,
      declineUrl
    );

    await sendFollowUpEmail(trainer.email, subject, htmlBody, tp);

    await pool.query(
      `INSERT INTO trainer_invitation (course_run_id, trainer_name, trainer_email, token, status, email_subject, email_body)
       VALUES ($1, $2, $3, $4, 'pending', $5, $6)`,
      [courseRunUuid, nextTrainerName, trainer.email, token, subject, body]
    );

    console.log(`📨 Auto-sent invitation to next trainer: ${nextTrainerName} (${trainer.email})`);
  } catch (e) {
    console.error('❌ Failed to auto-send next trainer invitation:', e);
  }
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const { token, action } = req.query;

  if (typeof token !== 'string' || !token || (action !== 'accept' && action !== 'decline')) {
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    return res.status(400).send(renderPage('Invalid Invitation', 'This invitation link is invalid or incomplete.', 'red'));
  }

  try {
    await ensureTrainerInvitationTable((sql, params) => pool.query(sql, params));
    await ensureTrainerInvitationTemplateColumns((sql) => pool.query(sql));

    // Look up invitation with course details
    const invitationResult = await pool.query(
      `SELECT ti.*, cr.course_run_id AS external_course_run_id,
              c.title AS course_title, c.course_code,
              cr.start_date, cr.end_date
       FROM trainer_invitation ti
       JOIN course_run cr ON cr.id = ti.course_run_id
       JOIN course c ON c.id = cr.course_id
       WHERE ti.token = $1
       LIMIT 1`,
      [token]
    );
    const invitation = invitationResult.rows[0];

    if (!invitation) {
      res.setHeader('Content-Type', 'text/html; charset=utf-8');
      return res.status(404).send(renderPage('Invitation Not Found', 'This trainer invitation could not be found or may have expired.', 'red'));
    }

    if (invitation.status !== 'pending') {
      const msg = invitation.status === 'accepted'
        ? `This invitation has already been accepted. ${invitation.trainer_name} is assigned to this class.`
        : invitation.status === 'declined'
        ? `This invitation was declined. The class may have been assigned to another trainer.`
        : `This invitation for ${invitation.trainer_name} was already marked as ${invitation.status}.`;
      res.setHeader('Content-Type', 'text/html; charset=utf-8');
      return res.status(200).send(renderPage('Already Responded', msg, 'gray'));
    }

    // Update invitation status
    await pool.query(
      `UPDATE trainer_invitation SET status = $1, responded_at = NOW(), updated_at = NOW() WHERE id = $2`,
      [action === 'accept' ? 'accepted' : 'declined', invitation.id]
    );

    // If accepted, assign trainer to course run
    if (action === 'accept') {
      const trainerLookup = await pool.query(
        `SELECT au.id FROM app_user au
         JOIN trainer_profile tp ON tp.user_id = au.id
         WHERE LOWER(au.email) = LOWER($1) OR LOWER(au.secondary_email) = LOWER($1)
         LIMIT 1`,
        [invitation.trainer_email]
      );
      const trainerId = trainerLookup.rows[0]?.id || null;

      await pool.query(`
        CREATE TABLE IF NOT EXISTS course_run_trainer (
          id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
          course_run_id UUID NOT NULL REFERENCES course_run(id) ON DELETE CASCADE,
          trainer_id UUID, trainer_name TEXT NOT NULL, trainer_email TEXT,
          assigned_at TIMESTAMPTZ DEFAULT NOW()
        )
      `);
      await pool.query(`
        CREATE UNIQUE INDEX IF NOT EXISTS uq_crt_run_trainer
        ON course_run_trainer(course_run_id, COALESCE(trainer_id, '00000000-0000-0000-0000-000000000000'))
      `);
      await pool.query(
        `INSERT INTO course_run_trainer (course_run_id, trainer_id, trainer_name, trainer_email)
         VALUES ($1, $2, $3, $4)
         ON CONFLICT (course_run_id, COALESCE(trainer_id, '00000000-0000-0000-0000-000000000000'))
         DO UPDATE SET trainer_name = EXCLUDED.trainer_name, trainer_email = EXCLUDED.trainer_email`,
        [invitation.course_run_id, trainerId, invitation.trainer_name, invitation.trainer_email]
      );
    }

    // Get training provider config for sending follow-up emails
    const tpResult = await pool.query(
      `SELECT email_user, company_email, company_name, company_shortname,
              google_client_id, google_client_secret, google_refresh_token,
              trainer_accept_email_subject, trainer_accept_email_body,
              trainer_decline_email_subject, trainer_decline_email_body,
              trainer_invitation_email_subject, trainer_invitation_email_body
       FROM training_provider LIMIT 1`
    );
    const tp = tpResult.rows[0];

    if (tp?.email_user && tp?.google_client_id && tp?.google_client_secret && tp?.google_refresh_token) {
      const replacements: Record<string, string> = {
        COMPANY_SHORT_NAME: tp.company_shortname || tp.company_name || 'Training Provider',
        TRAINER_NAME: invitation.trainer_name,
        COURSE_TITLE: invitation.course_title || '',
        COURSE_CODE: invitation.course_code || '',
        COURSE_RUN_ID: invitation.external_course_run_id || '',
        START_DATE: formatDateLabel(invitation.start_date),
        END_DATE: formatDateLabel(invitation.end_date),
      };

      if (action === 'accept') {
        // Send accept confirmation email
        const subject = renderInvitationTemplate(
          tp.trainer_accept_email_subject || DEFAULT_TRAINER_ACCEPT_SUBJECT,
          replacements
        );
        const body = renderInvitationTemplate(
          tp.trainer_accept_email_body || DEFAULT_TRAINER_ACCEPT_BODY,
          replacements
        );
        const htmlBody = `<div style="font-family:Arial,sans-serif;font-size:14px;color:#334155;line-height:1.6;">${convertPlainTextToHtml(body)}</div>`;
        await sendFollowUpEmail(invitation.trainer_email, subject, htmlBody, tp);
      } else {
        // Send decline acknowledgement email
        const subject = renderInvitationTemplate(
          tp.trainer_decline_email_subject || DEFAULT_TRAINER_DECLINE_SUBJECT,
          replacements
        );
        const body = renderInvitationTemplate(
          tp.trainer_decline_email_body || DEFAULT_TRAINER_DECLINE_BODY,
          replacements
        );
        const htmlBody = `<div style="font-family:Arial,sans-serif;font-size:14px;color:#334155;line-height:1.6;">${convertPlainTextToHtml(body)}</div>`;
        await sendFollowUpEmail(invitation.trainer_email, subject, htmlBody, tp);

        // Auto-send invitation to next available trainer
        await sendNextTrainerInvitation(invitation.course_run_id, tp);
      }
    }

    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    return res.status(200).send(
      renderPage(
        action === 'accept' ? 'Invitation Accepted' : 'Invitation Declined',
        action === 'accept'
          ? `Thank you, ${invitation.trainer_name}! You have been assigned to course run ${invitation.external_course_run_id}. A confirmation email has been sent.`
          : `Thank you, ${invitation.trainer_name}, for your response. The invitation for course run ${invitation.external_course_run_id} has been declined. We will reach out to the next available trainer.`,
        action === 'accept' ? 'green' : 'red'
      )
    );
  } catch (error) {
    console.error('Error responding to trainer invitation:', error);
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    return res.status(500).send(renderPage('Request Failed', 'We could not process your trainer invitation response.', 'red'));
  }
}
