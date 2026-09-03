import type { NextApiRequest, NextApiResponse } from 'next';
import pool from '../../../lib/db';
import {
  loadTrainingProviderEmailConfig,
  sendGmail,
  TrainingProviderEmailConfig,
} from '../../../lib/trainerInvitationSender';
import { queueTrainerWhatsAppNotification } from '../../../lib/trainerWhatsapp';
import {
  buildInvitationReplacements,
  DEFAULT_TRAINER_INVITATION_BODY,
  DEFAULT_TRAINER_INVITATION_SUBJECT,
  ensureTrainerInvitationTable,
  ensureTrainerInvitationTemplateColumns,
  renderInvitationHtmlEmail,
  renderInvitationTemplate,
  parseCcList,
} from '../../../lib/trainerInvitations';

/**
 * External API — Remind Pending Trainer Invitations
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * SCHEDULE: Thursday 10:00 AM SGT (scheduler task `auto_remind_trainer_invitations`)
 *           — the follow-up to the Monday invitation sweep.
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * FLOW:
 *   1. Find every trainer_invitation still 'pending' whose course run:
 *        - starts today or later (SGT)
 *        - has no locally-assigned trainer yet
 *        - is not invitation-paused
 *   2. Re-send the invitation email to the SAME trainer, re-using the SAME
 *      token — the accept/decline links in the reminder are identical to the
 *      original email, so either message works.
 *   3. Stamp reminder_sent_at / reminder_count on the invitation row and log
 *      into auto_send_trainer_invitation_log (status 'reminder_sent') so the
 *      admin log view shows the batch.
 *
 * Idempotent per day: an invitation reminded in the last 24h is skipped, so a
 * manual re-run right after the cron doesn't double-email trainers.
 *
 * POST /api/external/auto-remind-trainer-invitations
 * Headers: x-api-key: <EXTERNAL_API_KEY_FOR_CLAWDBOT>
 */

interface ReminderResult {
  invitationId: string;
  courseRunUuid: string;
  courseRunId?: string;
  courseTitle?: string;
  trainerName?: string;
  trainerEmail?: string;
  status: 'reminder_sent' | 'skipped_recently_reminded' | 'error';
  message?: string;
}

interface ReminderSummary {
  runId: string;
  startedAt: string;
  totalPending: number;
  sent: number;
  skipped: number;
  errors: number;
  results: ReminderResult[];
}

async function ensureReminderColumns() {
  await pool.query(`ALTER TABLE trainer_invitation ADD COLUMN IF NOT EXISTS reminder_sent_at TIMESTAMPTZ`);
  await pool.query(`ALTER TABLE trainer_invitation ADD COLUMN IF NOT EXISTS reminder_count INTEGER DEFAULT 0`);
  // Referenced in the eligibility query — idempotent guards for older tenants.
  await pool.query(`ALTER TABLE course_run ADD COLUMN IF NOT EXISTS invitation_paused BOOLEAN DEFAULT false`);
  await pool.query(`ALTER TABLE course_run ADD COLUMN IF NOT EXISTS invitation_replies_blocked BOOLEAN DEFAULT false`);
}

async function insertLogRow(runId: string, r: ReminderResult) {
  try {
    await pool.query(
      `INSERT INTO auto_send_trainer_invitation_log
         (run_id, course_run_uuid, course_run_id, course_title,
          trainer_name, trainer_email, status, message)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
      [
        runId,
        r.courseRunUuid || null,
        r.courseRunId || null,
        r.courseTitle || null,
        r.trainerName || null,
        r.trainerEmail || null,
        r.status,
        r.message || null,
      ]
    );
  } catch (err) {
    console.error('❌ [auto-remind-trainer-invitations] insertLogRow failed:', err);
  }
}

async function sendReminderForInvitation(
  inv: any,
  tp: TrainingProviderEmailConfig
): Promise<ReminderResult> {
  const base: ReminderResult = {
    invitationId: inv.id,
    courseRunUuid: inv.course_run_id,
    courseRunId: inv.external_course_run_id,
    courseTitle: inv.course_title,
    trainerName: inv.trainer_name,
    trainerEmail: inv.trainer_email,
    status: 'reminder_sent',
  };

  const siteUrl = process.env.NEXT_PUBLIC_BASE_URL || process.env.NEXT_PUBLIC_APP_URL || '';
  // Same token as the original invitation — both emails' links stay valid.
  const acceptUrl = `${siteUrl}/api/public/trainer-invitation/respond?token=${inv.token}&action=accept`;
  const declineUrl = `${siteUrl}/api/public/trainer-invitation/respond?token=${inv.token}&action=decline`;

  const replacements = buildInvitationReplacements({
    classRow: inv,
    trainerName: inv.trainer_name,
    companyShortName: tp.company_shortname || tp.company_name || 'Training Provider',
    companyPhone: tp.contact_tel || tp.company_tel || '',
    companyEmail: tp.support_email || tp.company_email || '',
    acceptUrl,
    declineUrl,
  });

  // The reminder is an exact duplicate of the Monday invitation email — same
  // body, same Accept/Decline buttons and links — with only the subject
  // prefixed "Reminder:".
  const subject = 'Reminder: ' + renderInvitationTemplate(
    tp.trainer_invitation_email_subject || DEFAULT_TRAINER_INVITATION_SUBJECT,
    replacements
  );
  const bodyTemplate = tp.trainer_invitation_email_body || DEFAULT_TRAINER_INVITATION_BODY;
  const htmlBody = renderInvitationHtmlEmail(bodyTemplate, replacements, acceptUrl, declineUrl);

  try {
    const ccList = parseCcList(tp.trainer_invitation_email_cc);
    await sendGmail(tp, inv.trainer_email, subject, htmlBody, ccList);
  } catch (err) {
    return {
      ...base,
      status: 'error',
      message: err instanceof Error ? err.message : 'Gmail send failed',
    };
  }

  await pool.query(
    `UPDATE trainer_invitation
     SET reminder_sent_at = NOW(),
         reminder_count = COALESCE(reminder_count, 0) + 1,
         updated_at = NOW()
     WHERE id = $1`,
    [inv.id]
  );

  console.log(
    `🔔 [auto-remind-trainer-invitations] reminder sent to ${inv.trainer_name} (${inv.trainer_email}) for course run ${inv.external_course_run_id}`
  );

  // WhatsApp nudge for the same reminder — delivered by the OpenClaw agent
  // from the WhatsApp Business number. Fire-and-forget.
  queueTrainerWhatsAppNotification({
    courseRunUuid: inv.course_run_id,
    trainerName: inv.trainer_name,
    trainerEmail: inv.trainer_email,
    kind: 'reminder',
  }).catch(() => { /* logged inside; never blocks the reminder */ });

  return { ...base, message: `Reminder sent to ${inv.trainer_name}` };
}

// ── Global in-flight lock ─────────────────────────────────────────────────────
const g = globalThis as unknown as { __trainerReminderRunning?: boolean };
if (g.__trainerReminderRunning === undefined) g.__trainerReminderRunning = false;

export async function runAutomation(): Promise<ReminderSummary> {
  if (g.__trainerReminderRunning) {
    console.warn('[auto-remind-trainer-invitations] Another run is already in progress — skipping');
    return { runId: '', startedAt: '', totalPending: 0, sent: 0, skipped: 0, errors: 0, results: [] };
  }
  g.__trainerReminderRunning = true;
  try {
    return await _runInner();
  } finally {
    g.__trainerReminderRunning = false;
  }
}

async function _runInner(): Promise<ReminderSummary> {
  await ensureTrainerInvitationTable((sql, params) => pool.query(sql, params));
  await ensureTrainerInvitationTemplateColumns((sql) => pool.query(sql));
  await ensureReminderColumns();

  const runId = `trainer_remind_${Date.now()}`;
  const startedAt = new Date().toISOString();

  const tp = await loadTrainingProviderEmailConfig();
  if (!tp) {
    throw new Error('Training provider Gmail OAuth is not configured');
  }

  // Pending invitations for upcoming runs that still have no local trainer.
  // DISTINCT ON: only the LATEST pending invitation per course run is reminded
  // — that's the trainer invited in the most recent Monday sweep. Older
  // invitations can pile up pending (each weekly sweep invites the next
  // trainer without superseding earlier ones); those trainers already received
  // their own reminder in their week, so re-blasting all of them every
  // Thursday would spam the approved list.
  // Carries every field buildInvitationReplacements needs (same aliases as the
  // sender's classRow query) so the reminder renders identically.
  const pendingRes = await pool.query(
    `SELECT DISTINCT ON (ti.course_run_id)
        ti.id, ti.course_run_id, ti.trainer_name, ti.trainer_email, ti.token,
        ti.reminder_sent_at,
        cr.course_run_id AS external_course_run_id,
        cr.start_date, cr.end_date,
        cr.mode_of_learning AS course_mode,
        cr.tpg_assigned_trainer_name,
        c.title AS course_title,
        c.course_code,
        c.course_type,
        c.training_hours,
        c.assessment_hours,
        c.num_of_days,
        (
          SELECT COUNT(DISTINCT cs.start_date)::int
          FROM course_session cs
          WHERE cs.course_run_id = cr.id
            AND COALESCE(cs.deleted, false) = false
            AND cs.start_date IS NOT NULL
        ) AS session_days
     FROM trainer_invitation ti
     JOIN course_run cr ON cr.id = ti.course_run_id
     JOIN course c ON c.id = cr.course_id
     WHERE ti.status = 'pending'
       AND cr.start_date >= (NOW() AT TIME ZONE 'Asia/Singapore')::date
       AND COALESCE(cr.invitation_paused, false) = false
       AND COALESCE(cr.invitation_replies_blocked, false) = false
       AND NOT EXISTS (
         SELECT 1 FROM course_run_trainer crt WHERE crt.course_run_id = cr.id
       )
     ORDER BY ti.course_run_id, ti.created_at DESC`
  );
  // (DISTINCT ON requires its expression to lead ORDER BY; re-sort for humans.)
  pendingRes.rows.sort((a: any, b: any) =>
    String(a.start_date).localeCompare(String(b.start_date))
  );

  console.log(
    `🔔 [auto-remind-trainer-invitations] starting ${runId} — ${pendingRes.rows.length} pending invitation(s)`
  );

  const results: ReminderResult[] = [];
  let sent = 0;
  let skipped = 0;
  let errors = 0;

  if (pendingRes.rows.length === 0) {
    await insertLogRow(runId, {
      invitationId: '',
      courseRunUuid: '',
      status: 'skipped_no_pending',
      message: 'No pending trainer invitations to remind.',
    } as unknown as ReminderResult);
  }

  for (const inv of pendingRes.rows) {
    // Skip anything reminded in the last 24h (manual re-run protection).
    if (inv.reminder_sent_at && Date.now() - new Date(inv.reminder_sent_at).getTime() < 24 * 60 * 60 * 1000) {
      const r: ReminderResult = {
        invitationId: inv.id,
        courseRunUuid: inv.course_run_id,
        courseRunId: inv.external_course_run_id,
        courseTitle: inv.course_title,
        trainerName: inv.trainer_name,
        trainerEmail: inv.trainer_email,
        status: 'skipped_recently_reminded',
        message: 'Already reminded within the last 24 hours',
      };
      results.push(r);
      skipped++;
      continue;
    }

    try {
      const r = await sendReminderForInvitation(inv, tp);
      results.push(r);
      await insertLogRow(runId, r);
      if (r.status === 'reminder_sent') sent++;
      else errors++;
    } catch (err) {
      errors++;
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`❌ [auto-remind-trainer-invitations] invitation ${inv.id} failed:`, msg);
      const r: ReminderResult = {
        invitationId: inv.id,
        courseRunUuid: inv.course_run_id,
        courseRunId: inv.external_course_run_id,
        courseTitle: inv.course_title,
        trainerName: inv.trainer_name,
        trainerEmail: inv.trainer_email,
        status: 'error',
        message: msg,
      };
      results.push(r);
      await insertLogRow(runId, r);
    }
  }

  const summary: ReminderSummary = {
    runId,
    startedAt,
    totalPending: pendingRes.rows.length,
    sent,
    skipped,
    errors,
    results,
  };

  console.log(
    `🔔 [auto-remind-trainer-invitations] done ${runId} — pending=${summary.totalPending} sent=${sent} skipped=${skipped} errors=${errors}`
  );

  return summary;
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ success: false, error: 'Method not allowed' });
  }

  const apiKey = req.headers['x-api-key'];
  const validKey = process.env.EXTERNAL_API_KEY_FOR_CLAWDBOT;
  if (!validKey) {
    console.error('❌ EXTERNAL_API_KEY_FOR_CLAWDBOT is not configured');
    return res.status(500).json({ success: false, error: 'API key not configured on server' });
  }
  if (!apiKey || apiKey !== validKey) {
    return res.status(401).json({ success: false, error: 'Invalid or missing API key' });
  }

  try {
    const summary = await runAutomation();
    return res.status(200).json({ success: true, ...summary });
  } catch (err) {
    console.error('❌ auto-remind-trainer-invitations error:', err);
    return res.status(500).json({
      success: false,
      error: err instanceof Error ? err.message : 'Internal server error',
    });
  }
}
