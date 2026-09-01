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
import { sendNextTrainerInvitationForCourseRun, sendExhaustedListAlert } from '@/lib/trainerInvitationSender';
import { pushTrainerToTpgForRun } from '@/lib/ssg/pushTrainerToTpgForRun';
import { autoShareCourseResourcesWithTrainerByRun } from '@/lib/google-drive/drive-helpers';
import { confirmTrainerOnCalendar } from '@/lib/calendar/confirmTrainerOnCalendar';

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

    const replyTo = (tp.trainer_invitation_reply_to || '').trim() || tp.company_email || tp.email_user;
    const headers = [
      `From: ${tp.company_shortname || tp.company_name || 'Training Provider'} <${tp.email_user}>`,
      `Reply-To: ${replyTo}`,
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
      // No one left to invite → the list may be exhausted (all declined).
      // sendExhaustedListAlert verifies the true exhausted condition, dedupes,
      // and no-ops if no recipients are configured.
      if (result.status === 'skipped_all_invited') {
        const alert = await sendExhaustedListAlert(courseRunUuid, tp);
        console.log(`🚨 [auto-escalation] exhausted-alert for course_run=${courseRunUuid} → ${alert.status}`);
      }
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
              cr.start_date, cr.end_date,
              cr.class_type, cr.mode_of_learning::text AS mode_of_learning,
              cr.virtual_meeting_link,
              COALESCE(cr.invitation_replies_blocked, false) AS replies_blocked
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
        : invitation.status === 'blocked'
        ? `Thank you for your response, ${invitation.trainer_name}. Unfortunately, this class has already been assigned. We appreciate your willingness and will reach out for future opportunities.`
        : invitation.status === 'expired'
        ? `This invitation has expired, ${invitation.trainer_name} — we did not receive a response within a week, so the class has been offered to another trainer. We hope to work with you on a future session.`
        : `This invitation for ${invitation.trainer_name} was already marked as ${invitation.status}.`;
      res.setHeader('Content-Type', 'text/html; charset=utf-8');
      return res.status(200).send(renderPage('Already Responded', msg, 'gray'));
    }

    // If replies are blocked for this course run:
    // - Decline: always allow (mark declined, show decline message, no cascade)
    // - Accept + is local trainer: show "already accepted" (green)
    // - Accept + not local trainer: block
    if (invitation.replies_blocked) {
      if (action === 'decline') {
        await pool.query(
          `UPDATE trainer_invitation SET status = 'declined', responded_at = NOW(), updated_at = NOW() WHERE id = $1`,
          [invitation.id]
        );
        res.setHeader('Content-Type', 'text/html; charset=utf-8');
        return res.status(200).send(renderPage(
          'Invitation Declined',
          `Thank you, ${invitation.trainer_name}, for your response. The invitation for course run ${invitation.external_course_run_id} has been declined. We will reach out to the next available trainer.`,
          'red'
        ));
      }

      // Accept path — check if this trainer is already assigned locally
      const isLocalTrainer = await pool.query(
        `SELECT 1 FROM course_run_trainer
         WHERE course_run_id = $1 AND LOWER(trainer_email) = LOWER($2)
         LIMIT 1`,
        [invitation.course_run_id, invitation.trainer_email]
      );
      const isScalarTrainer = isLocalTrainer.rows.length === 0
        ? await pool.query(
            `SELECT 1 FROM course_run
             WHERE id = $1 AND LOWER(assigned_trainer_email) = LOWER($2)
             LIMIT 1`,
            [invitation.course_run_id, invitation.trainer_email]
          )
        : isLocalTrainer;

      if (isScalarTrainer.rows.length > 0) {
        // This trainer is the local trainer — show "already accepted"
        await pool.query(
          `UPDATE trainer_invitation SET status = 'accepted', responded_at = NOW(), updated_at = NOW() WHERE id = $1`,
          [invitation.id]
        );
        res.setHeader('Content-Type', 'text/html; charset=utf-8');
        return res.status(200).send(renderPage(
          'Invitation Accepted',
          `This invitation has already been accepted. ${invitation.trainer_name} is assigned to this class.`,
          'green'
        ));
      }

      // Not the local trainer trying to accept — block
      await pool.query(
        `UPDATE trainer_invitation SET status = 'blocked', responded_at = NOW(), updated_at = NOW() WHERE id = $1`,
        [invitation.id]
      );
      res.setHeader('Content-Type', 'text/html; charset=utf-8');
      return res.status(200).send(renderPage(
        'Already Assigned',
        `Thank you for your response, ${invitation.trainer_name}. Unfortunately, this class has already been assigned. We appreciate your willingness and will reach out for future opportunities.`,
        'gray'
      ));
    }

    // If accepting, check if ANY trainer is already assigned locally
    // (via junction table, legacy scalar, or accepted invitation).
    // Covers: manual admin assignment, calendar sync, invitation accept.
    if (action === 'accept') {
      // Check junction table for any assigned trainer (not this trainer)
      const junctionAssigned = await pool.query(
        `SELECT trainer_name, trainer_email FROM course_run_trainer
         WHERE course_run_id = $1 AND LOWER(trainer_email) != LOWER($2)
         LIMIT 1`,
        [invitation.course_run_id, invitation.trainer_email]
      );

      // Check legacy scalar for any assigned trainer (not this trainer)
      const scalarAssigned = junctionAssigned.rows.length === 0
        ? await pool.query(
            `SELECT assigned_trainer_name, assigned_trainer_email FROM course_run
             WHERE id = $1
               AND assigned_trainer_email IS NOT NULL AND assigned_trainer_email != ''
               AND LOWER(assigned_trainer_email) != LOWER($2)
             LIMIT 1`,
            [invitation.course_run_id, invitation.trainer_email]
          )
        : { rows: [] };

      // Check accepted invitation (not this one)
      const acceptedInvitation = (junctionAssigned.rows.length === 0 && scalarAssigned.rows.length === 0)
        ? await pool.query(
            `SELECT trainer_name FROM trainer_invitation
             WHERE course_run_id = $1 AND status = 'accepted' AND id != $2
             LIMIT 1`,
            [invitation.course_run_id, invitation.id]
          )
        : { rows: [] };

      if (junctionAssigned.rows.length > 0 || scalarAssigned.rows.length > 0 || acceptedInvitation.rows.length > 0) {
        await pool.query(
          `UPDATE trainer_invitation SET status = 'blocked', responded_at = NOW(), updated_at = NOW() WHERE id = $1`,
          [invitation.id]
        );
        res.setHeader('Content-Type', 'text/html; charset=utf-8');
        return res.status(200).send(renderPage(
          'Already Assigned',
          `Thank you for your response, ${invitation.trainer_name}. Unfortunately, this class has already been assigned. We appreciate your willingness and will reach out for future opportunities.`,
          'gray'
        ));
      }
    }

    // Update invitation status
    await pool.query(
      `UPDATE trainer_invitation SET status = $1, responded_at = NOW(), updated_at = NOW() WHERE id = $2`,
      [action === 'accept' ? 'accepted' : 'declined', invitation.id]
    );

    // If declined, remove any existing trainer assignment for this trainer
    // so they no longer show as "assigned" in the admin UI.
    if (action === 'decline') {
      try {
        // 1. Remove from course_run_trainer junction table
        const delResult = await pool.query(
          `DELETE FROM course_run_trainer
           WHERE course_run_id = $1 AND LOWER(trainer_email) = LOWER($2)
           RETURNING id`,
          [invitation.course_run_id, invitation.trainer_email]
        );
        if (delResult.rowCount && delResult.rowCount > 0) {
          console.log(
            `🗑️ [trainer-invitation/respond] Removed ${delResult.rowCount} course_run_trainer row(s) for declined trainer "${invitation.trainer_name}"`
          );
        }

        // 2. Clear TPG trainer assignment if it matches the declined trainer
        const tpgClear = await pool.query(
          `UPDATE course_run
           SET tpg_assigned_trainer_name = NULL, tpg_assigned_trainer_email = NULL,
               tpg_sync_status = 'declined', updated_at = NOW()
           WHERE id = $1
             AND (LOWER(tpg_assigned_trainer_email) = LOWER($2)
                  OR LOWER(tpg_assigned_trainer_name) = LOWER($3))
           RETURNING id`,
          [invitation.course_run_id, invitation.trainer_email, invitation.trainer_name]
        );
        if (tpgClear.rowCount && tpgClear.rowCount > 0) {
          console.log(
            `🗑️ [trainer-invitation/respond] Cleared tpg_assigned_trainer for declined trainer "${invitation.trainer_name}"`
          );
        }

        // 3. Clear legacy assigned_trainer fields if they match
        const legacyClear = await pool.query(
          `UPDATE course_run
           SET assigned_trainer_name = NULL, assigned_trainer_email = NULL,
               assigned_trainer_id = NULL, updated_at = NOW()
           WHERE id = $1
             AND (LOWER(assigned_trainer_email) = LOWER($2)
                  OR LOWER(assigned_trainer_name) = LOWER($3))
           RETURNING id`,
          [invitation.course_run_id, invitation.trainer_email, invitation.trainer_name]
        );
        if (legacyClear.rowCount && legacyClear.rowCount > 0) {
          console.log(
            `🗑️ [trainer-invitation/respond] Cleared legacy assigned_trainer for declined trainer "${invitation.trainer_name}"`
          );
        }
      } catch (cleanupErr) {
        // Non-fatal — log but don't break the decline flow
        console.error(
          `❌ [trainer-invitation/respond] Failed to clean up trainer assignment on decline:`,
          cleanupErr
        );
      }
    }

    // Meet link surfaced in the accept confirmation email. Seeded from the run
    // (may already exist); the calendar confirm step below can generate a fresh
    // one for Virtual classes.
    let acceptMeetLink: string | null = (invitation.virtual_meeting_link || '').trim() || null;

    // If accepted, assign trainer to course run. Isolated in its own
    // try/catch so a failure here does NOT break the trainer-facing
    // "Invitation Accepted" page — the invitation status has already been
    // updated above, and the admin can resync via the Upcoming Classes
    // Refresh button. Every branch logs loudly so prod failures are visible.
    if (action === 'accept') {
      try {
        // Prefer an account with a trainer_profile, but fall back to any user
        // account matching the email — trainer_id must be set whenever possible
        // because the trainer's My Calendar scopes classes by trainer_id.
        const trainerLookup = await pool.query(
          `SELECT au.id FROM app_user au
           LEFT JOIN trainer_profile tp ON tp.user_id = au.id
           WHERE LOWER(au.email) = LOWER($1) OR LOWER(au.secondary_email) = LOWER($1)
           ORDER BY (tp.user_id IS NULL), au.created_at ASC
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

        // Keep the legacy scalar representation consistent with the junction
        // table (repo invariant: trainer-assignment writes update BOTH).
        await pool.query(
          `UPDATE course_run
           SET assigned_trainer_id = $2,
               assigned_trainer_name = $3,
               assigned_trainer_email = $4,
               updated_at = NOW()
           WHERE id = $1`,
          [invitation.course_run_id, trainerId, invitation.trainer_name, invitation.trainer_email]
        );

        // Auto-share courseware + assessment folders with the accepting trainer (non-blocking)
        autoShareCourseResourcesWithTrainerByRun(invitation.course_run_id, invitation.trainer_email).catch(err => {
          console.warn(`⚠️ [trainer-invitation/respond] auto-share failed (non-blocking): ${err?.message}`);
        });

        // #4: confirm the class immediately on accept. Matches the lazy derive
        // in upcoming-classes (trainer + learners → Confirmed) but without
        // waiting for an admin page load. Never overrides a Cancelled run.
        const confRes = await pool.query(
          `UPDATE course_run SET class_status = 'Confirmed', updated_at = NOW()
            WHERE id = $1 AND class_status <> 'Cancelled'
              AND EXISTS (SELECT 1 FROM enrollment e WHERE e.course_run_id = $1)
            RETURNING id`,
          [invitation.course_run_id]
        );
        if (confRes.rowCount && confRes.rowCount > 0) {
          console.log(`✅ [trainer-invitation/respond] class_status → Confirmed for course_run=${invitation.course_run_id}`);
        }
        // Auto-push to SSG TPG so admin doesn't need a separate "Bulk TPG
        // Assign" click. Isolated try/catch — TPG failure is recorded on
        // course_run.tpg_sync_status and never breaks the trainer's accept.
        try {
          const tpgResult = await pushTrainerToTpgForRun(invitation.course_run_id);
          console.log(
            `🎯 [trainer-invitation/respond] TPG push: status=${tpgResult.status} ` +
            `course_run=${invitation.course_run_id} trainer="${invitation.trainer_name}" ` +
            `msg="${tpgResult.message}"`
          );
        } catch (tpgErr) {
          console.error(
            `❌ [trainer-invitation/respond] TPG push threw for course_run=${invitation.course_run_id}:`,
            tpgErr
          );
        }
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

      // Calendar: ensure the class's events exist, stamp the Course Run ID into
      // their descriptions, add the trainer as an attendee (with a real Google
      // Calendar invite email so they can RSVP), and — for Virtual classes —
      // generate the Google Meet link. All in the shared helper so this stays
      // consistent with the rest of the calendar pipeline.
      try {
        const calResult = await confirmTrainerOnCalendar(invitation.course_run_id, invitation.trainer_email);
        console.log(
          `📅 [trainer-invitation/respond] calendar confirm: status=${calResult.status}` +
          `${calResult.reason ? ` (${calResult.reason})` : ''} events=${calResult.eventsFound} ` +
          `trainerOn=${calResult.trainerAddedTo} runIdStamped=${calResult.descriptionsStamped} ` +
          `meet=${calResult.meetLink || 'n/a'}`
        );
        if (calResult.meetLink) acceptMeetLink = calResult.meetLink;
      } catch (calErr) {
        console.error(`❌ [trainer-invitation/respond] Calendar add failed:`, calErr);
      }
    }

    // Get training provider config for sending follow-up emails
    const tpResult = await pool.query(
      `SELECT email_user, company_email, company_name, company_shortname,
              google_client_id, google_client_secret, google_refresh_token,
              trainer_accept_email_subject, trainer_accept_email_body, trainer_accept_email_cc,
              trainer_decline_email_subject, trainer_decline_email_body, trainer_decline_email_cc,
              trainer_invitation_email_subject, trainer_invitation_email_body, trainer_invitation_email_cc,
              trainer_invitation_reply_to
       FROM training_provider LIMIT 1`
    );
    const tp = tpResult.rows[0];

    // Send the accept/decline acknowledgement email (best-effort; depends on
    // Gmail OAuth being configured on the training provider).
    if (tp?.email_user && tp?.google_client_id && tp?.google_client_secret && tp?.google_refresh_token) {
      // Training Mode: Classroom or Virtual (Hybrid preserved as-is).
      const rawMode = String(invitation.class_type || invitation.mode_of_learning || '');
      const trainingMode = /virtual/i.test(rawMode)
        ? 'Virtual'
        : /hybrid/i.test(rawMode)
        ? 'Hybrid'
        : 'Classroom';

      const replacements: Record<string, string> = {
        COMPANY_SHORT_NAME: tp.company_shortname || tp.company_name || 'Training Provider',
        TRAINER_NAME: invitation.trainer_name,
        COURSE_TITLE: invitation.course_title || '',
        COURSE_CODE: invitation.course_code || '',
        COURSE_RUN_ID: invitation.external_course_run_id || '',
        START_DATE: formatDateLabel(invitation.start_date),
        END_DATE: formatDateLabel(invitation.end_date),
        TRAINING_MODE: trainingMode,
        MEET_LINK: acceptMeetLink || '',
        // Rendered directly after the Training Mode line (leading \n) only for
        // Virtual/Hybrid classes with a link — Classroom confirmations show no
        // empty "Google Meet Link:" row and no stray blank line.
        MEET_LINK_LINE: trainingMode !== 'Classroom' && acceptMeetLink
          ? `\nGoogle Meet Link: ${acceptMeetLink}`
          : '',
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
