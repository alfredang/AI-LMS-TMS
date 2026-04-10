import type { NextApiRequest, NextApiResponse } from 'next';
import { google } from 'googleapis';
import pool from '@lib/db';
import {
  ensureTrainerInvitationTable,
  ensureTrainerInvitationTemplateColumns,
  renderInvitationTemplate,
  convertPlainTextToHtml,
  formatDateLabel,
  parseCcList,
  DEFAULT_TRAINER_ACCEPT_SUBJECT,
  DEFAULT_TRAINER_ACCEPT_BODY,
  DEFAULT_TRAINER_DECLINE_SUBJECT,
  DEFAULT_TRAINER_DECLINE_BODY,
} from '@/lib/trainerInvitations';
import { sendNextTrainerInvitationForCourseRun } from '@/lib/trainerInvitationSender';

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
  tp: any,
  ccList?: string[]
) {
  try {
    const oauth2Client = new google.auth.OAuth2(
      tp.google_client_id,
      tp.google_client_secret,
      'https://developers.google.com/oauthplayground'
    );
    oauth2Client.setCredentials({ refresh_token: tp.google_refresh_token });
    const gmail = google.gmail({ version: 'v1', auth: oauth2Client });

    const headers = [
      `From: ${tp.company_shortname || tp.company_name || 'Training Provider'} <${tp.email_user}>`,
      `Reply-To: ${tp.company_email || tp.email_user}`,
      `To: ${trainerEmail}`,
    ];
    if (ccList && ccList.length > 0) {
      headers.push(`Cc: ${ccList.join(', ')}`);
    }
    headers.push(
      `Subject: ${subject}`,
      'MIME-Version: 1.0',
      'Content-Type: text/html; charset=utf-8',
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

    console.log(`📧 Follow-up email sent to ${trainerEmail}: ${subject}`);
  } catch (e) {
    console.error(`❌ Failed to send follow-up email to ${trainerEmail}:`, e);
  }
}

async function sendNextTrainerInvitation(courseRunUuid: string, tp: any) {
  try {
    const result = await sendNextTrainerInvitationForCourseRun({ courseRunUuid, tp });
    if (result.status === 'sent') {
      console.log(
        `✅ [auto-escalation] course_run=${courseRunUuid} → invited "${result.trainerName}" (${result.trainerEmail})`
      );
    } else {
      console.log(
        `ℹ️  [auto-escalation] course_run=${courseRunUuid} → ${result.status}: ${result.message}`
      );
    }
  } catch (e) {
    console.error('❌ [auto-escalation] Failed to auto-send next trainer invitation:', e);
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

    // If accepted, assign trainer to course run. Isolated in its own
    // try/catch so a failure here does NOT break the trainer-facing
    // "Invitation Accepted" page — the invitation status has already been
    // updated above, and the admin can resync via the Upcoming Classes
    // Refresh button. Every branch logs loudly so prod failures are visible.
    if (action === 'accept') {
      try {
        const trainerLookup = await pool.query(
          `SELECT au.id FROM app_user au
           JOIN trainer_profile tp ON tp.user_id = au.id
           WHERE LOWER(au.email) = LOWER($1) OR LOWER(au.secondary_email) = LOWER($1)
           LIMIT 1`,
          [invitation.trainer_email]
        );
        const trainerId = trainerLookup.rows[0]?.id || null;

        console.log(
          `🎯 [trainer-invitation/respond] Accept: course_run=${invitation.course_run_id} ` +
          `trainer_name="${invitation.trainer_name}" trainer_email="${invitation.trainer_email}" ` +
          `trainer_id=${trainerId ?? 'NULL (no trainer_profile)'}`
        );

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
          ON course_run_trainer(course_run_id, COALESCE(trainer_id, '00000000-0000-0000-0000-000000000000'::uuid))
        `);

        // Insert with explicit ::uuid cast on the COALESCE literal so the
        // ON CONFLICT expression matches the unique index signature exactly.
        // Without the cast, Postgres may refuse to match the expression
        // index and throw "no unique or exclusion constraint matching the
        // ON CONFLICT specification".
        const ins = await pool.query(
          `INSERT INTO course_run_trainer (course_run_id, trainer_id, trainer_name, trainer_email)
           VALUES ($1, $2, $3, $4)
           ON CONFLICT (course_run_id, COALESCE(trainer_id, '00000000-0000-0000-0000-000000000000'::uuid))
           DO UPDATE SET
             trainer_name = EXCLUDED.trainer_name,
             trainer_email = EXCLUDED.trainer_email
           RETURNING id, (xmax = 0) AS was_inserted`,
          [invitation.course_run_id, trainerId, invitation.trainer_name, invitation.trainer_email]
        );

        const row = ins.rows[0];
        console.log(
          `✅ [trainer-invitation/respond] course_run_trainer ${row?.was_inserted ? 'INSERTED' : 'UPDATED'} ` +
          `id=${row?.id} for course_run=${invitation.course_run_id}`
        );
      } catch (crtErr) {
        // Log loudly but do NOT rethrow — the invitation is already marked
        // accepted and the trainer should still see the thank-you page.
        // The admin can backfill via the Refresh button / re-run the
        // accepted invitation from the trainer_invitation table.
        console.error(
          `❌ [trainer-invitation/respond] FAILED to upsert course_run_trainer for ` +
          `course_run=${invitation.course_run_id} trainer="${invitation.trainer_name}":`,
          crtErr
        );
      }
    }

    // Get training provider config for sending follow-up emails
    const tpResult = await pool.query(
      `SELECT email_user, company_email, company_name, company_shortname,
              google_client_id, google_client_secret, google_refresh_token,
              trainer_accept_email_subject, trainer_accept_email_body, trainer_accept_email_cc,
              trainer_decline_email_subject, trainer_decline_email_body, trainer_decline_email_cc,
              trainer_invitation_email_subject, trainer_invitation_email_body, trainer_invitation_email_cc
       FROM training_provider LIMIT 1`
    );
    const tp = tpResult.rows[0];

    // Send the accept/decline acknowledgement email (best-effort; depends on
    // Gmail OAuth being configured on the training provider).
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
        const acceptCc = parseCcList(tp.trainer_accept_email_cc);
        await sendFollowUpEmail(invitation.trainer_email, subject, htmlBody, tp, acceptCc);
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
        const declineCc = parseCcList(tp.trainer_decline_email_cc);
        await sendFollowUpEmail(invitation.trainer_email, subject, htmlBody, tp, declineCc);
      }
    }

    // Auto-escalate a decline to the next available trainer. This must run
    // OUTSIDE the OAuth gate above — the sender loads its own TP config,
    // and we want the escalation to fire even if the acknowledgement email
    // failed or Gmail isn't configured. Isolated in its own try/catch so a
    // failure here cannot break the trainer-facing thank-you page.
    if (action === 'decline') {
      try {
        console.log(
          `🔁 [trainer-invitation/respond] Auto-escalating decline for course_run=${invitation.course_run_id} ` +
          `(declined by "${invitation.trainer_name}")`
        );
        await sendNextTrainerInvitation(invitation.course_run_id, tp);
      } catch (escErr) {
        console.error(
          `❌ [trainer-invitation/respond] Auto-escalation failed for course_run=${invitation.course_run_id}:`,
          escErr
        );
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
