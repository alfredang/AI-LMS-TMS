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
import { getGoogleCredentials } from '@/lib/google-auth/googleAuth';
import { pushTrainerToTpgForRun } from '@/lib/ssg/pushTrainerToTpgForRun';

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
              cr.start_date, cr.end_date,
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

      // #77: Add trainer to Google Calendar event on accept.
      // Uses robust multi-strategy matching similar to DA calendar add:
      //   1. courseRunId in event description/location (most reliable)
      //   2. Title substring match + date match
      //   3. Word-overlap title match + date match (fuzzy fallback)
      try {
        const tpCalRes = await pool.query(
          `SELECT sync_google_calendar, google_calendar_url FROM training_provider LIMIT 1`
        );
        const tpCalRow = tpCalRes.rows[0];
        if (!tpCalRow?.sync_google_calendar) {
          console.log(`📅 [trainer-invitation/respond] sync_google_calendar is off — skipping`);
        } else {
          const calCredentials = await getGoogleCredentials(pool);
          let calendarId = 'primary';
          const calUrl = tpCalRow.google_calendar_url || '';
          if (calUrl) {
            const cidMatch = calUrl.match(/[?&]cid=([^&]+)/);
            if (cidMatch) {
              try { calendarId = Buffer.from(cidMatch[1], 'base64').toString('utf-8'); }
              catch { calendarId = cidMatch[1]; }
            } else if (calUrl.includes('@')) { calendarId = calUrl; }
          }

          const calOAuth = new google.auth.OAuth2(
            calCredentials.clientId,
            calCredentials.clientSecret,
            'https://developers.google.com/oauthplayground'
          );
          calOAuth.setCredentials({ refresh_token: calCredentials.refreshToken });
          const calendar = google.calendar({ version: 'v3', auth: calOAuth });

          const startDateIso = invitation.start_date
            ? (invitation.start_date instanceof Date
              ? invitation.start_date.toISOString().slice(0, 10)
              : String(invitation.start_date).slice(0, 10))
            : '';

          if (!startDateIso) {
            console.log(`📅 [trainer-invitation/respond] No start_date — skipping calendar add`);
          } else {
            // Search window: use end_date if available for multi-day classes
            const dayBefore = new Date(startDateIso);
            dayBefore.setDate(dayBefore.getDate() - 1);
            const dayAfter = new Date(startDateIso);
            if (invitation.end_date) {
              const endIso = invitation.end_date instanceof Date
                ? invitation.end_date.toISOString().slice(0, 10)
                : String(invitation.end_date).slice(0, 10);
              const endD = new Date(endIso);
              dayAfter.setTime(Math.max(dayAfter.getTime(), endD.getTime()));
            }
            dayAfter.setDate(dayAfter.getDate() + 2);

            const eventsRes = await calendar.events.list({
              calendarId,
              timeMin: dayBefore.toISOString(),
              timeMax: dayAfter.toISOString(),
              singleEvents: true,
              maxResults: 200,
            });
            const allEvents = eventsRes.data.items || [];
            const courseRunIdStr = invitation.external_course_run_id || '';
            const stripPrefixes = (t: string) =>
              (t || '').replace(/^\s*\[?(WSQ|VIRTUAL|EXTERNAL|HYBRID)\]?\s*/gi, '')
                       .replace(/^\s*\[?(WSQ|VIRTUAL|EXTERNAL|HYBRID)\]?\s*/gi, '').trim();
            const strippedTitle = stripPrefixes(invitation.course_title || '').toLowerCase();
            const titleWords = new Set(strippedTitle.split(/\s+/).filter((w: string) => w.length > 2));

            // Strategy 1: Match by courseRunId in event description/location
            let matchedEvent = courseRunIdStr
              ? allEvents.find(evt => {
                  const desc = ((evt.description || '') + ' ' + (evt.location || '')).toLowerCase();
                  return desc.includes(courseRunIdStr.toLowerCase());
                })
              : undefined;

            // Strategy 2: Exact title substring match + date match
            if (!matchedEvent) {
              matchedEvent = allEvents.find(evt => {
                const evtSummary = stripPrefixes(evt.summary || '').toLowerCase();
                const titleMatch = evtSummary.includes(strippedTitle) || strippedTitle.includes(evtSummary);
                if (!titleMatch) return false;
                const evtDate = (evt.start?.dateTime?.slice(0, 10) || evt.start?.date || '');
                return evtDate === startDateIso;
              });
            }

            // Strategy 3: Word-overlap title match + date match (fuzzy)
            if (!matchedEvent && titleWords.size > 0) {
              matchedEvent = allEvents.find(evt => {
                const evtSummary = stripPrefixes(evt.summary || '').toLowerCase();
                const evtWords = evtSummary.split(/\s+/).filter((w: string) => w.length > 2);
                const overlap = evtWords.filter((w: string) => titleWords.has(w));
                if (overlap.length < Math.ceil(titleWords.size * 0.6)) return false;
                const evtDate = (evt.start?.dateTime?.slice(0, 10) || evt.start?.date || '');
                return evtDate === startDateIso;
              });
              if (matchedEvent) {
                console.log(`📅 [trainer-invitation/respond] Fuzzy word-overlap match: "${matchedEvent.summary}"`);
              }
            }

            if (!matchedEvent || !matchedEvent.id) {
              console.log(`📅 [trainer-invitation/respond] No matching calendar event for "${invitation.course_title}" on ${startDateIso}`);
            } else {
              // Check for recurring events and patch all siblings
              const baseId = matchedEvent.id.includes('_') ? matchedEvent.id.split('_')[0] : null;
              let eventsToUpdate: Array<{ id: string; attendees: any[] }> = [];

              if (baseId) {
                const wideStart = new Date(startDateIso);
                wideStart.setDate(wideStart.getDate() - 7);
                const wideEnd = new Date(startDateIso);
                wideEnd.setDate(wideEnd.getDate() + 60);
                const recurringRes = await calendar.events.list({
                  calendarId,
                  timeMin: wideStart.toISOString(),
                  timeMax: wideEnd.toISOString(),
                  singleEvents: true,
                  maxResults: 2500,
                });
                eventsToUpdate = (recurringRes.data.items || [])
                  .filter(evt => evt.id && evt.id.startsWith(baseId + '_'))
                  .map(evt => ({ id: evt.id!, attendees: evt.attendees || [] }));
              }
              if (eventsToUpdate.length === 0) {
                eventsToUpdate = [{ id: matchedEvent.id, attendees: matchedEvent.attendees || [] }];
              }

              const emailLower = invitation.trainer_email.trim().toLowerCase();
              let addedCount = 0;
              for (const evt of eventsToUpdate) {
                if (evt.attendees.some((a: any) => (a.email || '').toLowerCase() === emailLower)) {
                  addedCount++;
                  continue;
                }
                await calendar.events.patch({
                  calendarId,
                  eventId: evt.id,
                  requestBody: {
                    attendees: [...evt.attendees, { email: invitation.trainer_email, responseStatus: 'needsAction' }],
                  },
                  sendUpdates: 'none',
                });
                addedCount++;
              }
              console.log(
                `📅 [trainer-invitation/respond] Added ${invitation.trainer_email} to ${addedCount}/${eventsToUpdate.length} calendar events for "${invitation.course_title}"`
              );
            }
          }
        }
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
