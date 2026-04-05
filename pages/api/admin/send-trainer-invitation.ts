import type { NextApiRequest, NextApiResponse } from 'next';
import { google } from 'googleapis';
import pool from '@lib/db';
import {
  convertPlainTextToHtml,
  createInvitationToken,
  DEFAULT_TRAINER_INVITATION_BODY,
  DEFAULT_TRAINER_INVITATION_SUBJECT,
  ensureTrainerInvitationTable,
  ensureTrainerInvitationTemplateColumns,
  ensureTpgTrainerColumns,
  formatDateLabel,
  normalizeTrainerName,
  renderInvitationTemplate,
  splitTrainerList,
} from '@/lib/trainerInvitations';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ success: false, error: 'Method not allowed' });
  }

  try {
    await ensureTrainerInvitationTable((sql, params) => pool.query(sql, params));
    await ensureTrainerInvitationTemplateColumns((sql, params) => pool.query(sql, params));
    await ensureTpgTrainerColumns((sql, params) => pool.query(sql, params));

    const { courseRunUuid } = req.body;
    if (!courseRunUuid || typeof courseRunUuid !== 'string') {
      return res.status(400).json({ success: false, error: 'courseRunUuid is required' });
    }

    const classResult = await pool.query(
      `SELECT
        cr.id,
        cr.course_run_id,
        cr.start_date,
        cr.end_date,
        c.title AS course_title,
        c.course_code,
        c.trainers_list,
        COALESCE(cr.tpg_assigned_trainer_name, cr.assigned_trainer_name) AS tpg_assigned_trainer_name,
        (
          SELECT JSON_AGG(JSON_BUILD_OBJECT('trainerName', crt.trainer_name, 'trainerEmail', crt.trainer_email) ORDER BY crt.assigned_at)
          FROM course_run_trainer crt
          WHERE crt.course_run_id = cr.id
        ) AS local_trainers,
        (
          SELECT JSON_AGG(JSON_BUILD_OBJECT('trainerName', ti.trainer_name, 'trainerEmail', ti.trainer_email, 'status', ti.status) ORDER BY ti.created_at DESC)
          FROM trainer_invitation ti
          WHERE ti.course_run_id = cr.id
        ) AS invitations
      FROM course_run cr
      JOIN course c ON c.id = cr.course_id
      WHERE cr.id = $1
      LIMIT 1`,
      [courseRunUuid]
    );

    const classRow = classResult.rows[0];
    if (!classRow) {
      return res.status(404).json({ success: false, error: 'Course run not found' });
    }

    const trainerPool = splitTrainerList(classRow.trainers_list);
    const localTrainerSet = new Set(((classRow.local_trainers || []) as any[]).map((trainer) => normalizeTrainerName(trainer.trainerName)));
    const invitationHistory = Array.isArray(classRow.invitations) ? classRow.invitations : [];

    let nextTrainerName = '';
    for (const trainerName of trainerPool) {
      const normalized = normalizeTrainerName(trainerName);
      if (!normalized || localTrainerSet.has(normalized)) continue;
      const invite = invitationHistory.find((entry: any) => normalizeTrainerName(entry?.trainerName) === normalized);
      if (invite?.status === 'declined') continue;
      nextTrainerName = trainerName;
      break;
    }

    if (!nextTrainerName) {
      return res.status(400).json({ success: false, error: 'No next available trainer found for this class' });
    }

    const existingPending = invitationHistory.find((entry: any) =>
      normalizeTrainerName(entry?.trainerName) === normalizeTrainerName(nextTrainerName) && entry?.status === 'pending'
    );
    if (existingPending) {
      return res.status(200).json({ success: true, message: `Invitation already pending for ${nextTrainerName}.` });
    }

    const trainerResult = await pool.query(
      `SELECT au.full_name, COALESCE(NULLIF(au.email, ''), NULLIF(au.secondary_email, '')) AS email
       FROM app_user au
       JOIN user_role_map urm ON urm.user_id = au.id
       WHERE LOWER(au.full_name) = LOWER($1) AND urm.role = 'Trainer'
       LIMIT 1`,
      [nextTrainerName]
    );
    const trainer = trainerResult.rows[0];
    if (!trainer?.email) {
      return res.status(400).json({ success: false, error: `Trainer email not found for ${nextTrainerName}` });
    }

    const tpResult = await pool.query(
      `SELECT email_user, company_email, google_client_id, google_client_secret, google_refresh_token,
              company_name, company_shortname, trainer_invitation_email_subject, trainer_invitation_email_body
       FROM training_provider LIMIT 1`
    );
    const tp = tpResult.rows[0];
    if (!tp) {
      return res.status(404).json({ success: false, error: 'Training provider not found' });
    }
    const { email_user, company_email, google_client_id, google_client_secret, google_refresh_token } = tp;
    if (!email_user || !google_client_id || !google_client_secret || !google_refresh_token) {
      return res.status(400).json({ success: false, error: 'Training provider Gmail OAuth is not configured' });
    }

    const token = createInvitationToken();
    const siteUrl = process.env.NEXT_PUBLIC_APP_URL || 'https://ai-lms-tms.tertiaryinfo.tech';
    const acceptUrl = `${siteUrl}/api/public/trainer-invitation/respond?token=${token}&action=accept`;
    const declineUrl = `${siteUrl}/api/public/trainer-invitation/respond?token=${token}&action=decline`;
    const replacements = {
      COMPANY_SHORT_NAME: tp.company_shortname || tp.company_name || 'Training Provider',
      TRAINER_NAME: trainer.full_name || nextTrainerName,
      COURSE_TITLE: classRow.course_title || '',
      COURSE_CODE: classRow.course_code || '',
      COURSE_RUN_ID: classRow.course_run_id || '',
      START_DATE: formatDateLabel(classRow.start_date),
      END_DATE: formatDateLabel(classRow.end_date),
      TPG_TRAINER: classRow.tpg_assigned_trainer_name || 'N/A',
      ACCEPT_URL: acceptUrl,
      DECLINE_URL: declineUrl,
    };

    const subject = renderInvitationTemplate(tp.trainer_invitation_email_subject || DEFAULT_TRAINER_INVITATION_SUBJECT, replacements);
    const body = renderInvitationTemplate(tp.trainer_invitation_email_body || DEFAULT_TRAINER_INVITATION_BODY, replacements);
    const htmlBody = `
      <div style="font-family: Arial, sans-serif; font-size: 14px; color: #334155; line-height: 1.6;">
        ${convertPlainTextToHtml(body)}
        <div style="margin-top: 24px; display: flex; gap: 12px;">
          <a href="${acceptUrl}" style="background:#16a34a;color:#fff;padding:12px 18px;border-radius:8px;text-decoration:none;font-weight:600;">Accept Invitation</a>
          <a href="${declineUrl}" style="background:#dc2626;color:#fff;padding:12px 18px;border-radius:8px;text-decoration:none;font-weight:600;">Decline Invitation</a>
        </div>
      </div>
    `;

    const oauth2Client = new google.auth.OAuth2(
      google_client_id,
      google_client_secret,
      'https://developers.google.com/oauthplayground'
    );
    oauth2Client.setCredentials({ refresh_token: google_refresh_token });
    const gmail = google.gmail({ version: 'v1', auth: oauth2Client });

    const rawEmail = [
      `From: ${tp.company_shortname || tp.company_name || 'Training Provider'} <${email_user}>`,
      `Reply-To: ${company_email || email_user}`,
      `To: ${trainer.email}`,
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

    await pool.query(
      `INSERT INTO trainer_invitation (course_run_id, trainer_name, trainer_email, token, status, email_subject, email_body)
       VALUES ($1, $2, $3, $4, 'pending', $5, $6)`,
      [courseRunUuid, nextTrainerName, trainer.email, token, subject, body]
    );

    return res.status(200).json({
      success: true,
      message: `Trainer invitation sent to ${nextTrainerName}.`,
    });
  } catch (error) {
    console.error('Error sending trainer invitation:', error);
    return res.status(500).json({ success: false, error: error instanceof Error ? error.message : 'Failed to send trainer invitation' });
  }
}
