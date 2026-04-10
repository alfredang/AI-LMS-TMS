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
import {
  buildInvitationReplacements,
  createInvitationToken,
  DEFAULT_TRAINER_INVITATION_BODY,
  DEFAULT_TRAINER_INVITATION_SUBJECT,
  ensureTpgTrainerColumns,
  ensureTrainerInvitationTable,
  ensureTrainerInvitationTemplateColumns,
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
  google_client_id: string;
  google_client_secret: string;
  google_refresh_token: string;
  trainer_invitation_email_subject?: string | null;
  trainer_invitation_email_body?: string | null;
  trainer_invitation_email_cc?: string | null;
}

export type TrainerInvitationSendStatus =
  | 'sent'
  | 'skipped_no_approved_trainers'
  | 'skipped_all_invited'
  | 'skipped_no_email'
  | 'skipped_already_pending'
  | 'skipped_class_not_found'
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
  const res = await pool.query(
    `SELECT email_user, company_email, company_name, company_shortname,
            google_client_id, google_client_secret, google_refresh_token,
            trainer_invitation_email_subject, trainer_invitation_email_body,
            trainer_invitation_email_cc
     FROM training_provider
     LIMIT 1`
  );
  const row = res.rows[0];
  if (!row?.email_user || !row?.google_client_id || !row?.google_client_secret || !row?.google_refresh_token) {
    return null;
  }
  return row as TrainingProviderEmailConfig;
}

async function sendGmail(
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

  const headers = [
    `From: ${tp.company_shortname || tp.company_name || 'Training Provider'} <${tp.email_user}>`,
    `Reply-To: ${tp.company_email || tp.email_user}`,
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

  // 1. Load course_run + course details (all fields needed by placeholders)
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
        c.training_hours,
        c.trainers_list
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

  const baseResult: Partial<TrainerInvitationSendResult> = {
    courseRunUuid,
    courseRunId: classRow.course_run_id,
    courseTitle: classRow.course_title,
  };

  // 2. Build skip-sets: locally-assigned, declined, pending
  const [localResult, declinedResult, pendingResult] = await Promise.all([
    pool.query(`SELECT trainer_name FROM course_run_trainer WHERE course_run_id = $1`, [courseRunUuid]),
    pool.query(`SELECT trainer_name FROM trainer_invitation WHERE course_run_id = $1 AND status = 'declined'`, [courseRunUuid]),
    pool.query(`SELECT trainer_name FROM trainer_invitation WHERE course_run_id = $1 AND status = 'pending'`, [courseRunUuid]),
  ]);
  const localSet = new Set<string>(localResult.rows.map((r: any) => normalizeTrainerName(r.trainer_name)));
  const declinedSet = new Set<string>(declinedResult.rows.map((r: any) => normalizeTrainerName(r.trainer_name)));
  const pendingSet = new Set<string>(pendingResult.rows.map((r: any) => normalizeTrainerName(r.trainer_name)));

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
       ORDER BY COALESCE(responded_at, created_at) DESC, created_at DESC
       LIMIT 1`,
      [courseRunUuid]
    );
    const latestName = latestInvitedResult.rows[0]?.trainer_name;
    if (latestName) {
      const latestNormalized = normalizeTrainerName(latestName);
      const idx = approvedTrainers.findIndex(
        (n) => normalizeTrainerName(n) === latestNormalized
      );
      if (idx >= 0) {
        startIndex = idx + 1;
        console.log(
          `➡️  [trainerInvitationSender] resuming after "${latestName}" at index ${idx} — starting search at ${startIndex}`
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
  const siteUrl = process.env.NEXT_PUBLIC_APP_URL || 'https://ai-lms-tms.tertiaryinfo.tech';
  const acceptUrl = `${siteUrl}/api/public/trainer-invitation/respond?token=${token}&action=accept`;
  const declineUrl = `${siteUrl}/api/public/trainer-invitation/respond?token=${token}&action=decline`;

  const replacements = buildInvitationReplacements({
    classRow,
    trainerName: trainer.full_name || nextTrainerName,
    companyShortName: tp.company_shortname || tp.company_name || 'Training Provider',
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

  return {
    ...baseResult,
    status: 'sent',
    courseRunUuid,
    trainerName: nextTrainerName,
    trainerEmail: trainer.email,
    message: `Invitation sent to ${nextTrainerName}`,
  };
}
