/**
 * Shared trainer-invitation sender.
 *
 * Used by three call sites:
 *   1. Admin manual "Send Invitation" (pages/api/admin/send-trainer-invitation.ts)
 *   2. Auto-escalation on decline (pages/api/public/trainer-invitation/respond.ts)
 *   3. Weekly auto-sweep for classes missing a trainer
 *      (pages/api/external/auto-send-trainer-invitations.ts)
 *
 * Centralising the logic here guarantees all three paths:
 *   - use the same placeholder map (including {COURSE_TYPE}, {DURATION},
 *     {COURSE_HOURS}, {CONFIRM_BY})
 *   - honour the same "skip if already invited / declined / locally assigned"
 *     rules
 *   - write an audit row in `trainer_invitation`
 */

import { google } from 'googleapis';
import pool from './db';
import { queueTrainerWhatsAppNotification } from './trainerWhatsapp';
import {
  buildInvitationReplacements,
  createInvitationToken,
  DEFAULT_TRAINER_INVITATION_BODY,
  DEFAULT_TRAINER_INVITATION_SUBJECT,
  ensureTpgTrainerColumns,
  ensureExhaustedAlertColumn,
  ensureTrainerInvitationTable,
  ensureTrainerInvitationTemplateColumns,
  formatDateLabel,
  normalizeTrainerName,
  parseCcList,
  renderInvitationHtmlEmail,
  renderInvitationTemplate,
  splitTrainerList,
} from './trainerInvitations';

export interface TrainingProviderEmailConfig {
  email_user: string;
  company_email?: string | null;
  company_name?: string | null;
  company_shortname?: string | null;
  support_email?: string | null;
  contact_tel?: string | null;
  company_tel?: string | null;
  google_client_id: string;
  google_client_secret: string;
  google_refresh_token: string;
  trainer_invitation_email_subject?: string | null;
  trainer_invitation_email_body?: string | null;
  trainer_invitation_email_cc?: string | null;
  trainer_invitation_reply_to?: string | null;
  trainer_exhausted_alert_recipients?: string | null;
}

export type TrainerInvitationSendStatus =
  | 'sent'
  | 'skipped_no_approved_trainers'
  | 'skipped_all_invited'
  | 'skipped_already_assigned'
  | 'skipped_no_email'
  | 'skipped_already_pending'
  | 'skipped_class_not_found'
  | 'skipped_paused'
  | 'skipped_no_learners'
  | 'exhausted_alert_sent'
  | 'error';

export interface TrainerInvitationSendResult {
  status: TrainerInvitationSendStatus;
  courseRunUuid: string;
  courseRunId?: string;
  courseTitle?: string;
  trainerName?: string;
  trainerEmail?: string;
  message?: string;
}

/**
 * Load the training provider row used for sending invitation emails. Returns
 * null if OAuth is not yet configured.
 */
export async function loadTrainingProviderEmailConfig(): Promise<TrainingProviderEmailConfig | null> {
  // Idempotent — guarantees the reply-to / exhausted-alert columns exist before
  // they're SELECTed (the sweep calls this before any other ensure).
  await ensureTrainerInvitationTemplateColumns((sql) => pool.query(sql));
  const res = await pool.query(
    `SELECT email_user, company_email, company_name, company_shortname,
            support_email, contact_tel, company_tel,
            google_client_id, google_client_secret, google_refresh_token,
            trainer_invitation_email_subject, trainer_invitation_email_body,
            trainer_invitation_email_cc, trainer_invitation_reply_to,
            trainer_exhausted_alert_recipients
     FROM training_provider
     LIMIT 1`
  );
  const row = res.rows[0];
  if (!row?.email_user || !row?.google_client_id || !row?.google_client_secret || !row?.google_refresh_token) {
    return null;
  }
  return row as TrainingProviderEmailConfig;
}

export async function sendGmail(
  tp: TrainingProviderEmailConfig,
  to: string,
  subject: string,
  htmlBody: string,
  ccList?: string[]
): Promise<void> {
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
    `To: ${to}`,
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
}

/**
 * Core logic: for a given course_run, pick the next eligible trainer from the
 * approved trainers_list and send them an invitation email.
 *
 * Trainers are skipped if they:
 *   - are already locally assigned (course_run_trainer row exists)
 *   - have declined a previous invitation for this course_run
 *   - already have a pending invitation for this course_run (unless
 *     `allowResend` is true — see below)
 *
 * Pass `overrideTrainerName` to force a specific trainer (used by the admin UI
 * when picking a trainer explicitly from the dropdown).
 *
 * Pass `allowResend: true` for admin-initiated manual sends. When set, any
 * pre-existing pending invitations for the target trainer are marked as
 * 'resent' (stale) and a fresh invitation is issued. This invalidates the old
 * accept/decline links so the recipient can't respond to a superseded email.
 * Auto-escalation (on-decline) and the weekly sweep do NOT set this flag so
 * they remain idempotent.
 */
export async function sendNextTrainerInvitationForCourseRun(opts: {
  courseRunUuid: string;
  overrideTrainerName?: string;
  tp?: TrainingProviderEmailConfig;
  allowResend?: boolean;
}): Promise<TrainerInvitationSendResult> {
  const { courseRunUuid, overrideTrainerName, allowResend = false } = opts;

  // Ensure schema
  await ensureTrainerInvitationTable((sql, params) => pool.query(sql, params));
  await ensureTrainerInvitationTemplateColumns((sql) => pool.query(sql));
  await ensureTpgTrainerColumns((sql, params) => pool.query(sql, params));

  // 1. Load course_run + course details (all fields needed by placeholders).
  // session_days = distinct class days actually scheduled, used as the most
  // accurate duration source; num_of_days is the course-level fallback.
  const classResult = await pool.query(
    `SELECT
        cr.id,
        cr.course_run_id,
        cr.start_date,
        cr.end_date,
        cr.mode_of_learning AS course_mode,
        cr.tpg_assigned_trainer_name,
        c.title AS course_title,
        c.course_code,
        c.course_type,
        c.training_hours,
        c.assessment_hours,
        c.num_of_days,
        c.trainers_list,
        cr.invitation_paused,
        (
          SELECT COUNT(DISTINCT cs.start_date)::int
          FROM course_session cs
          WHERE cs.course_run_id = cr.id
            AND COALESCE(cs.deleted, false) = false
            AND cs.start_date IS NOT NULL
        ) AS session_days
      FROM course_run cr
      JOIN course c ON c.id = cr.course_id
      WHERE cr.id = $1
      LIMIT 1`,
    [courseRunUuid]
  );
  const classRow = classResult.rows[0];
  if (!classRow) {
    return {
      status: 'skipped_class_not_found',
      courseRunUuid,
      message: 'Course run not found',
    };
  }

  // Block both scheduled and cascade invitations when paused
  if (classRow.invitation_paused) {
    return {
      status: 'skipped_paused',
      courseRunUuid,
      courseRunId: classRow.course_run_id,
      courseTitle: classRow.course_title,
      message: 'Invitations paused for this course run',
    };
  }

  // Block invitations when there are no learners enrolled
  const learnerCountRes = await pool.query(
    `SELECT COUNT(*) AS cnt FROM enrollment WHERE course_run_id = $1`,
    [courseRunUuid]
  );
  if (Number(learnerCountRes.rows[0]?.cnt) === 0) {
    return {
      status: 'skipped_no_learners',
      courseRunUuid,
      courseRunId: classRow.course_run_id,
      courseTitle: classRow.course_title,
      message: 'No learners enrolled — trainer invitation not sent',
    };
  }

  const baseResult: Partial<TrainerInvitationSendResult> = {
    courseRunUuid,
    courseRunId: classRow.course_run_id,
    courseTitle: classRow.course_title,
  };

  // 2. Build skip-sets: locally-assigned, declined, pending
  const [localResult, declinedResult, pendingResult] = await Promise.all([
    pool.query(`SELECT trainer_name FROM course_run_trainer WHERE course_run_id = $1`, [courseRunUuid]),
    pool.query(`SELECT trainer_name FROM trainer_invitation WHERE course_run_id = $1 AND status IN ('declined', 'blocked')`, [courseRunUuid]),
    pool.query(`SELECT trainer_name FROM trainer_invitation WHERE course_run_id = $1 AND status = 'pending'`, [courseRunUuid]),
  ]);
  const localSet = new Set<string>(localResult.rows.map((r: any) => normalizeTrainerName(r.trainer_name)));
  const declinedSet = new Set<string>(declinedResult.rows.map((r: any) => normalizeTrainerName(r.trainer_name)));
  const pendingSet = new Set<string>(pendingResult.rows.map((r: any) => normalizeTrainerName(r.trainer_name)));

  // If ANY trainer is already locally assigned to this course run, stop immediately.
  // The course is covered, so we shouldn't send invitations to the next person.
  if (localSet.size > 0) {
    return {
      ...baseResult,
      status: 'skipped_already_assigned',
      courseRunUuid,
      message: 'A trainer is already locally assigned to this course run',
    };
  }

  // 3. Pick next trainer
  const approvedTrainers = splitTrainerList(classRow.trainers_list);
  if (approvedTrainers.length === 0) {
    return {
      ...baseResult,
      status: 'skipped_no_approved_trainers',
      courseRunUuid,
      message: 'No approved trainers configured on the course',
    };
  }

  // 3a. Resolve emails for ALL approved trainers in one query so the
  // eligibility loop can skip entries with no app_user / email on file
  // instead of terminating on the first dead name. This is what makes
  // auto-escalation walk past stale approved-list entries (names that
  // were removed from the user table, trainers without a profile, etc.)
  // and actually reach the next real trainer.
  interface ResolvedTrainer {
    id: string;
    full_name: string;
    email: string;
  }
  const emailByNormalizedName = new Map<string, ResolvedTrainer>();
  if (approvedTrainers.length > 0) {
    const approvedRes = await pool.query(
      `SELECT DISTINCT ON (LOWER(au.full_name))
              au.id, au.full_name,
              COALESCE(NULLIF(au.email, ''), NULLIF(au.secondary_email, '')) AS email
       FROM app_user au
       JOIN user_role_map urm ON urm.user_id = au.id
       WHERE urm.role = 'Trainer'
         AND LOWER(au.full_name) = ANY ($1::text[])
       ORDER BY LOWER(au.full_name), au.created_at ASC`,
      [approvedTrainers.map(n => n.toLowerCase())]
    );
    for (const row of approvedRes.rows) {
      if (row.email) {
        emailByNormalizedName.set(normalizeTrainerName(row.full_name), {
          id: row.id,
          full_name: row.full_name,
          email: row.email,
        });
      }
    }
  }

  let nextTrainerName: string | null = null;
  let trainer: ResolvedTrainer | null = null;
  if (overrideTrainerName?.trim()) {
    const overrideNormalized = normalizeTrainerName(overrideTrainerName);
    // Respect the "already pending" guard only when the caller did NOT opt
    // into resend semantics. Admin UI sets allowResend so the manual
    // "SEND INVITE" / "RESEND" button always goes through.
    if (!allowResend && pendingSet.has(overrideNormalized)) {
      return {
        ...baseResult,
        status: 'skipped_already_pending',
        courseRunUuid,
        trainerName: overrideTrainerName.trim(),
        message: `Invitation already pending for ${overrideTrainerName.trim()}`,
      };
    }
    nextTrainerName = overrideTrainerName.trim();
    trainer = emailByNormalizedName.get(overrideNormalized) || null;
  } else {
    // Auto-escalation must walk the approved-trainers dropdown strictly
    // forward from whoever was invited most recently. Previously the loop
    // started at index 0 every call, so after e.g. "Tan Yong Huat" (mid
    // list) declined, the next pick was always the first uninvited trainer
    // at the top instead of the trainer immediately after him. Anchoring on
    // the latest invitation row keeps decline -> next trainer sequential.
    let startIndex = 0;
    const latestInvitedResult = await pool.query(
      `SELECT trainer_name FROM trainer_invitation
       WHERE course_run_id = $1
         AND status <> 'reset'
       ORDER BY COALESCE(responded_at, created_at) DESC, created_at DESC
       LIMIT 1`,
      [courseRunUuid]
    );
    const latestName = latestInvitedResult.rows[0]?.trainer_name;
    if (latestName) {
      const latestNormalized = normalizeTrainerName(latestName);
      // Try exact normalized match first
      let idx = approvedTrainers.findIndex(
        (n) => normalizeTrainerName(n) === latestNormalized
      );
      // Fallback: partial match (handles "Dr Smita" vs "Dr Smita Ramakrishna",
      // or override names that don't exactly match the comma-string entry)
      if (idx < 0) {
        idx = approvedTrainers.findIndex((n) => {
          const norm = normalizeTrainerName(n);
          return norm.includes(latestNormalized) || latestNormalized.includes(norm);
        });
      }
      if (idx >= 0) {
        startIndex = idx + 1;
        console.log(
          `➡️  [trainerInvitationSender] resuming after "${latestName}" at index ${idx} — starting search at ${startIndex}`
        );
      } else {
        console.log(
          `⚠️  [trainerInvitationSender] "${latestName}" not found in approved list — starting from 0, relying on skip-sets`
        );
      }
    }

    for (let i = startIndex; i < approvedTrainers.length; i++) {
      const name = approvedTrainers[i];
      const normalized = normalizeTrainerName(name);
      if (!normalized) continue;
      if (localSet.has(normalized)) continue;
      if (declinedSet.has(normalized)) continue;
      // With allowResend, pending trainers are still eligible (we'll
      // invalidate their old invitation row below before inserting a new one).
      if (!allowResend && pendingSet.has(normalized)) continue;
      // Skip approved-list entries that don't resolve to a real trainer
      // account — auto-escalation must walk past dead names rather than
      // get stuck on one.
      const resolved = emailByNormalizedName.get(normalized);
      if (!resolved) {
        console.log(`ℹ️ [trainerInvitationSender] skipping "${name}" — no app_user/email on file`);
        continue;
      }
      nextTrainerName = name;
      trainer = resolved;
      break;
    }
  }

  if (!nextTrainerName) {
    return {
      ...baseResult,
      status: 'skipped_all_invited',
      courseRunUuid,
      message: 'All approved trainers already invited, declined, assigned, or missing from user table',
    };
  }

  if (!trainer?.email) {
    return {
      ...baseResult,
      status: 'skipped_no_email',
      courseRunUuid,
      trainerName: nextTrainerName,
      message: `No email on file for ${nextTrainerName}`,
    };
  }

  // 5. Load training provider config if not provided
  const tp = opts.tp || (await loadTrainingProviderEmailConfig());
  if (!tp) {
    return {
      ...baseResult,
      status: 'error',
      courseRunUuid,
      trainerName: nextTrainerName,
      trainerEmail: trainer.email,
      message: 'Training provider Gmail OAuth is not configured',
    };
  }

  // 6. Build message
  const token = createInvitationToken();
  const siteUrl = process.env.NEXT_PUBLIC_BASE_URL || process.env.NEXT_PUBLIC_APP_URL || '';
  const acceptUrl = `${siteUrl}/api/public/trainer-invitation/respond?token=${token}&action=accept`;
  const declineUrl = `${siteUrl}/api/public/trainer-invitation/respond?token=${token}&action=decline`;

  const replacements = buildInvitationReplacements({
    classRow,
    trainerName: trainer.full_name || nextTrainerName,
    companyShortName: tp.company_shortname || tp.company_name || 'Training Provider',
    companyPhone: tp.contact_tel || tp.company_tel || '',
    companyEmail: tp.support_email || tp.company_email || '',
    acceptUrl,
    declineUrl,
  });

  const subject = renderInvitationTemplate(
    tp.trainer_invitation_email_subject || DEFAULT_TRAINER_INVITATION_SUBJECT,
    replacements
  );
  const textBody = renderInvitationTemplate(
    tp.trainer_invitation_email_body || DEFAULT_TRAINER_INVITATION_BODY,
    replacements
  );
  const htmlBody = renderInvitationHtmlEmail(
    tp.trainer_invitation_email_body || DEFAULT_TRAINER_INVITATION_BODY,
    replacements,
    acceptUrl,
    declineUrl
  );

  // 7. Send + persist (with optional CC list from training_provider config)
  const ccList = parseCcList(tp.trainer_invitation_email_cc);
  try {
    await sendGmail(tp, trainer.email, subject, htmlBody, ccList);
  } catch (err) {
    return {
      ...baseResult,
      status: 'error',
      courseRunUuid,
      trainerName: nextTrainerName,
      trainerEmail: trainer.email,
      message: err instanceof Error ? err.message : 'Gmail send failed',
    };
  }

  // On resend, invalidate any existing pending invitation for the same
  // trainer on this course run. This turns their previous accept/decline
  // links into no-ops so a stale email can't resurrect an outdated flow.
  if (allowResend && pendingSet.has(normalizeTrainerName(nextTrainerName))) {
    await pool.query(
      `UPDATE trainer_invitation
       SET status = 'resent', updated_at = NOW()
       WHERE course_run_id = $1
         AND LOWER(trainer_name) = LOWER($2)
         AND status = 'pending'`,
      [courseRunUuid, nextTrainerName]
    );
  }

  await pool.query(
    `INSERT INTO trainer_invitation (course_run_id, trainer_name, trainer_email, token, status, email_subject, email_body)
     VALUES ($1, $2, $3, $4, 'pending', $5, $6)`,
    [courseRunUuid, nextTrainerName, trainer.email, token, subject, textBody]
  );

  console.log(`📨 Trainer invitation ${allowResend ? '(resend) ' : ''}sent to ${nextTrainerName} (${trainer.email}) for course run ${classRow.course_run_id}`);

  // Queue the WhatsApp nudge ("check your email to Accept/Decline") for the
  // OpenClaw agent to deliver from the WhatsApp Business number. Fire-and-forget.
  queueTrainerWhatsAppNotification({
    courseRunUuid,
    trainerName: trainer.full_name || nextTrainerName,
    trainerEmail: trainer.email,
    kind: 'invitation',
  }).catch(() => { /* logged inside; never blocks the invitation */ });

  // Re-arm the exhausted-list alert: a fresh invitation means the run is no
  // longer exhausted, so a future exhaustion is allowed to alert again.
  try {
    await ensureExhaustedAlertColumn((sql) => pool.query(sql));
    await pool.query(`UPDATE course_run SET exhausted_alert_sent_at = NULL WHERE id = $1`, [courseRunUuid]);
  } catch (e) {
    console.error('⚠️ [trainerInvitationSender] failed to re-arm exhausted alert:', e);
  }

  // A reset (Unconfirmed) class re-enters the invite pipeline: flip it back to
  // Pending once an invitation actually goes out. Central here so every caller
  // (admin manual send, auto-sweep, on-decline escalation) gets it.
  await pool.query(
    `UPDATE course_run SET class_status = 'Pending', updated_at = NOW()
      WHERE id = $1 AND class_status = 'Unconfirmed'`,
    [courseRunUuid]
  );

  return {
    ...baseResult,
    status: 'sent',
    courseRunUuid,
    trainerName: nextTrainerName,
    trainerEmail: trainer.email,
    message: `Invitation sent to ${nextTrainerName}`,
  };
}

export type ExhaustedAlertResult =
  | 'sent'
  | 'skipped_not_exhausted'
  | 'skipped_already_alerted'
  | 'skipped_no_recipients'
  | 'skipped_no_oauth'
  | 'skipped_run_not_found'
  | 'error';

/**
 * Alert the trainer-assignment owners (Ms Tan + See Shiang, per config) when a
 * course run's approved-trainer list is **exhausted** — every approved trainer
 * who maps to an account has DECLINED and none accepted, with no trainer
 * assigned. The course now needs manual intervention.
 *
 * Safe / idempotent by design:
 *   - Sends only when the run is genuinely exhausted (all declined, none
 *     pending/accepted, no assignment) — NOT merely "everyone currently invited".
 *   - Sends **once** per exhaustion (course_run.exhausted_alert_sent_at), and
 *     re-arms when a fresh invitation later goes out (see sender above).
 *   - No-ops when no recipients are configured (trainer_exhausted_alert_recipients).
 *
 * Call it at every exhaustion point (decline-cascade + Mon/Thu sweep) whenever
 * the cascade returns `skipped_all_invited`; this function decides whether to act.
 */
export async function sendExhaustedListAlert(
  courseRunUuid: string,
  tpIn?: TrainingProviderEmailConfig | null
): Promise<{ status: ExhaustedAlertResult; message?: string; recipients?: string[] }> {
  try {
    await ensureExhaustedAlertColumn((sql) => pool.query(sql));

    const tp = tpIn || (await loadTrainingProviderEmailConfig());
    if (!tp) return { status: 'skipped_no_oauth', message: 'Gmail OAuth not configured' };

    const recipients = parseCcList(tp.trainer_exhausted_alert_recipients);
    if (recipients.length === 0) {
      return { status: 'skipped_no_recipients', message: 'No exhausted-alert recipients configured' };
    }

    // Load run + course + assignment + invitation tallies in one go.
    const r = await pool.query(
      `SELECT cr.id, cr.course_run_id, cr.start_date, cr.end_date,
              cr.exhausted_alert_sent_at,
              c.title AS course_title, c.course_code, c.trainers_list,
              (SELECT COUNT(*) FROM course_run_trainer crt WHERE crt.course_run_id = cr.id) AS local_cnt,
              (SELECT COUNT(*) FROM trainer_invitation ti WHERE ti.course_run_id = cr.id) AS inv_total,
              (SELECT COUNT(*) FROM trainer_invitation ti WHERE ti.course_run_id = cr.id AND ti.status IN ('pending','accepted')) AS inv_open,
              (SELECT COUNT(*) FROM trainer_invitation ti WHERE ti.course_run_id = cr.id AND ti.status IN ('declined','blocked')) AS inv_declined
         FROM course_run cr JOIN course c ON c.id = cr.course_id
        WHERE cr.id = $1 LIMIT 1`,
      [courseRunUuid]
    );
    const run = r.rows[0];
    if (!run) return { status: 'skipped_run_not_found' };

    // Dedupe: already alerted for this exhaustion episode.
    if (run.exhausted_alert_sent_at) {
      return { status: 'skipped_already_alerted' };
    }

    // True exhaustion: no trainer assigned, at least one invitation sent, and
    // none of them are still pending/accepted (i.e. all declined/blocked).
    const exhausted =
      Number(run.local_cnt) === 0 &&
      Number(run.inv_total) > 0 &&
      Number(run.inv_open) === 0 &&
      Number(run.inv_declined) > 0;
    if (!exhausted) return { status: 'skipped_not_exhausted' };

    const fmt = (v: any) => formatDateLabel(v);
    const subject = `⚠ Trainer needed — invite list exhausted: ${run.course_title} (${run.course_run_id})`;
    const declinedList = splitTrainerList(run.trainers_list).map((n) => `&bull; ${n}`).join('<br/>');
    const htmlBody = `
<div style="font-family:Arial,sans-serif;font-size:14px;color:#1f2937;line-height:1.6;">
  <p><strong>Action needed:</strong> every approved trainer for this course run has declined the invitation, and no trainer is assigned. The automatic cascade has no one left to invite.</p>
  <table style="border-collapse:collapse;margin:12px 0;">
    <tr><td style="padding:2px 12px 2px 0;color:#6b7280;">Course</td><td style="padding:2px 0;"><strong>${run.course_title}</strong></td></tr>
    <tr><td style="padding:2px 12px 2px 0;color:#6b7280;">Course code</td><td style="padding:2px 0;">${run.course_code || 'N/A'}</td></tr>
    <tr><td style="padding:2px 12px 2px 0;color:#6b7280;">Course run ID</td><td style="padding:2px 0;">${run.course_run_id || 'N/A'}</td></tr>
    <tr><td style="padding:2px 12px 2px 0;color:#6b7280;">Dates</td><td style="padding:2px 0;">${fmt(run.start_date)} &rarr; ${fmt(run.end_date)}</td></tr>
  </table>
  <p style="color:#6b7280;margin:8px 0 2px;">Approved trainers (all invited / declined):</p>
  <p style="margin:0 0 12px;">${declinedList || '<em>none configured</em>'}</p>
  <p><strong>Next step:</strong> add or reorder approved trainers for this course, assign a trainer manually, or reschedule/cancel the run.</p>
  <div style="border-top:1px solid #e5e7eb;padding-top:12px;margin-top:20px;">
    <p style="margin:0;font-size:12px;color:#94a3b8;font-style:italic;">Automated alert from the TMS trainer-assignment workflow.</p>
  </div>
</div>`;

    try {
      // Reuse the same Gmail sender; recipients go in the To line.
      await sendGmail(tp, recipients[0], subject, htmlBody, recipients.slice(1));
    } catch (err) {
      return { status: 'error', message: err instanceof Error ? err.message : 'Gmail send failed', recipients };
    }

    await pool.query(`UPDATE course_run SET exhausted_alert_sent_at = NOW() WHERE id = $1`, [courseRunUuid]);
    console.log(`🚨 [exhausted-alert] sent for course_run=${courseRunUuid} (${run.course_run_id}) to ${recipients.join(', ')}`);
    return { status: 'sent', recipients };
  } catch (err) {
    console.error('❌ [exhausted-alert] failed:', err);
    return { status: 'error', message: err instanceof Error ? err.message : String(err) };
  }
}
