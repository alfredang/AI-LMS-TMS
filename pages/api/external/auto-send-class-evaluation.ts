import { isServiceRequest } from '@lib/auth/serviceKey';
import type { NextApiRequest, NextApiResponse } from 'next';
import pool from '../../../lib/db';
import { sendViaGmailOAuth } from '../../../lib/gmailOauthSend';
import { postFeedbackReview } from '../../../lib/feedback/postReview';
import type { FeedbackFormSection, FeedbackFormField } from '../../../types';

// Fail closed: accept server-side secrets only. NEXT_PUBLIC_* values are baked
// into the public JS bundle and must never act as an API key; with no key
// configured, a per-boot random UUID makes every comparison fail.
const SCHEDULER_SECRET =
  process.env.SCHEDULER_SECRET ||
  process.env.EXTERNAL_API_KEY_FOR_CLAWDBOT ||
  globalThis.crypto.randomUUID();

// ── Global in-flight lock ─────────────────────────────────────────────────────
// Prevents two concurrent runAutomation() calls (cron + manual "Run Now", or
// two Turbopack module instances) from emailing the same responses twice.
const g = globalThis as unknown as { __classEvaluationEmailRunning?: boolean };
if (g.__classEvaluationEmailRunning === undefined) g.__classEvaluationEmailRunning = false;

/**
 * External API — Auto Send Class Evaluation to Trainers
 *
 * SCHEDULE: Run daily at 6:30 PM SGT.
 *
 * PURPOSE:
 *   Compiles the learner feedback (Course Feedback form responses) for every
 *   CONFIRMED course run that ENDED TODAY (SGT), and emails the compiled evaluation to
 *   the run's trainer(s) — one email per course run, learners anonymised as
 *   "Learner 1", "Learner 2", …:
 *
 *     Subject: [<shortname>] Class Evaluation - <Course Title> (<run id>)
 *
 *     Hello <Trainer Name>,
 *
 *     You have received evaluation feedback for the <Course Title> course
 *     (Code: <TGS code>).
 *
 *     1. <rating question>:
 *      Learner 1: 4/5
 *      Learner 2: 5/5
 *     ...
 *
 *   Each response is emailed once: after a successful send its
 *   trainer_emailed_at is stamped, so tomorrow's run only picks up new
 *   responses. Only classes that ended today are emailed (user rule
 *   2026-11-28): a class that ended on an earlier day is never emailed,
 *   including feedback that arrives after its 6:30 PM run.
 *
 * RECIPIENTS (user rule 2026-11-27): To = the class trainer(s); Cc = this
 *   task's CC list (scheduler_config.alert_recipients, edited in Scheduler),
 *   else the company Feedback Email CC. A class with no trainer on record
 *   goes to the CC list as To, flagged in the subject, so no feedback waits
 *   silently for a trainer that was never assigned.
 *
 * STOREFRONT REVIEWS: each response is also posted to the storefront as a
 *   product review (lib/feedback/postReview.ts, idempotent on the response
 *   id), once. storefront_review_status records the outcome; only 'error' is
 *   retried on later runs. Rows that existed before this step was added are
 *   stamped 'legacy' when the column is created, so history is never posted.
 */

const TASK_ID = 'auto_send_class_evaluation';

export function splitEmails(raw: string | null | undefined): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const part of String(raw ?? '').split(/[,;\s]+/)) {
    const e = part.trim();
    if (e && !seen.has(e.toLowerCase())) {
      seen.add(e.toLowerCase());
      out.push(e);
    }
  }
  return out;
}

/**
 * To = trainers; Cc = the CC list minus anyone already in To. With no trainer
 * the CC list becomes To (and Cc is empty). Null when there is nobody to send to.
 */
export function resolveEvaluationRecipients(
  trainerEmails: string[],
  ccList: string[],
): { to: string[]; cc: string[]; noTrainer: boolean } | null {
  const to = splitEmails(trainerEmails.join(','));
  const toSet = new Set(to.map(e => e.toLowerCase()));
  const cc = splitEmails(ccList.join(',')).filter(e => !toSet.has(e.toLowerCase()));
  if (to.length > 0) return { to, cc, noTrainer: false };
  if (cc.length > 0) return { to: cc, cc: [], noTrainer: true };
  return null;
}

/** Adds the review-tracking columns; on first creation every existing row is marked 'legacy'. */
async function ensureReviewColumns(): Promise<void> {
  const { rows } = await pool.query(
    `SELECT 1 FROM information_schema.columns
      WHERE table_name = 'feedback_form_response' AND column_name = 'storefront_review_status'`
  );
  if (rows.length > 0) return;
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(`ALTER TABLE feedback_form_response ADD COLUMN IF NOT EXISTS storefront_review_status TEXT`);
    await client.query(`ALTER TABLE feedback_form_response ADD COLUMN IF NOT EXISTS storefront_review_id INTEGER`);
    await client.query(`ALTER TABLE feedback_form_response ADD COLUMN IF NOT EXISTS storefront_review_at TIMESTAMPTZ`);
    await client.query(`UPDATE feedback_form_response SET storefront_review_status = 'legacy' WHERE storefront_review_status IS NULL`);
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw err;
  } finally {
    client.release();
  }
}

/** Posts each not-yet-posted response of an ended, confirmed class to the storefront as a review. */
async function postPendingReviews(): Promise<{ posted: number; held: number; skipped: number; failed: number }> {
  const stats = { posted: 0, held: 0, skipped: 0, failed: 0 };
  const { rows } = await pool.query(`
    SELECT fr.id, fr.answers, fr.learner_name, fr.course_run_id
    FROM feedback_form_response fr
    JOIN course_run cr ON cr.id = fr.course_run_id
    WHERE (fr.storefront_review_status IS NULL OR fr.storefront_review_status = 'error')
      AND cr.class_status = 'Confirmed'
      AND cr.end_date <= (NOW() AT TIME ZONE 'Asia/Singapore')::date
    ORDER BY fr.submitted_at ASC
  `);
  for (const r of rows) {
    const result = await postFeedbackReview({
      responseId: r.id,
      courseRunId: r.course_run_id,
      learnerName: r.learner_name,
      answers: r.answers || {},
    }).catch(err => ({ posted: false, error: String(err) } as const));

    let status: string;
    if (result.posted) {
      status = result.status === 'pending' ? 'pending' : 'approved';
      if (status === 'pending') stats.held++; else stats.posted++;
    } else if ('skipped' in result && result.skipped) {
      status = `skipped:${result.skipped}`;
      stats.skipped++;
    } else {
      status = 'error';
      stats.failed++;
      console.error(`[auto-send-class-evaluation] storefront review for response ${r.id} failed — ${'error' in result ? result.error : 'unknown'}`);
    }
    await pool.query(
      `UPDATE feedback_form_response
          SET storefront_review_status = $2,
              storefront_review_id = COALESCE($3, storefront_review_id),
              storefront_review_at = CASE WHEN $4 THEN NOW() ELSE storefront_review_at END
        WHERE id = $1`,
      [r.id, status, result.posted ? (result as any).reviewId ?? null : null, result.posted]
    );
  }
  return stats;
}

interface ResponseRow {
  id: string;
  answers: Record<string, any>;
  submitted_at: string;
  run_uuid: string;
  run_code: string; // course_run.course_run_id (numeric SSG run id)
  course_title: string;
  course_code: string; // TGS code
}

interface TrainerRecipient {
  name: string;
  email: string;
}

function formatRatingValue(v: any): string {
  if (v === null || v === undefined || v === '') return 'No answer';
  const n = Number(v);
  return Number.isFinite(n) ? `${n}/5` : String(v);
}

export function buildEvaluationEmailText(params: {
  trainerNames: string[];
  courseTitle: string;
  courseCode: string;
  ratingFields: FeedbackFormField[];
  commentFields: FeedbackFormField[];
  responses: Array<{ answers: Record<string, any> }>;
  companyName: string;
}): string {
  const { trainerNames, courseTitle, courseCode, ratingFields, commentFields, responses, companyName } = params;

  const lines: string[] = [];
  lines.push(`Hello ${trainerNames.join(', ')},`);
  lines.push('');
  lines.push(`You have received evaluation feedback for the ${courseTitle} course (Code: ${courseCode}).`);

  ratingFields.forEach((field, idx) => {
    lines.push('');
    lines.push(`${idx + 1}. ${field.label.replace(/:\s*$/, '')}:`);
    responses.forEach((r, i) => {
      lines.push(` Learner ${i + 1}: ${formatRatingValue(r.answers?.[field.id])}`);
    });
  });

  // Free-text comments — only learners who actually wrote something.
  for (const field of commentFields) {
    const comments = responses
      .map((r, i) => ({ i, text: String(r.answers?.[field.id] ?? '').trim() }))
      .filter(c => c.text.length > 0);
    if (comments.length === 0) continue;
    lines.push('');
    lines.push(`${field.label.replace(/:\s*$/, '')}:`);
    comments.forEach(c => lines.push(` Learner ${c.i + 1}: ${c.text}`));
  }

  lines.push('');
  lines.push('Best regards,');
  lines.push(companyName);
  return lines.join('\n');
}

export async function runAutomation() {
  if (g.__classEvaluationEmailRunning) {
    console.warn('[auto-send-class-evaluation] Another run is already in progress — skipping this invocation to prevent duplicate emails.');
    return { success: false, message: 'Skipped — another run is already in progress' };
  }
  g.__classEvaluationEmailRunning = true;
  try {
    return await _runAutomationInner();
  } finally {
    g.__classEvaluationEmailRunning = false;
  }
}

async function _runAutomationInner() {
  console.log(`[auto-send-class-evaluation] Starting run at ${new Date().toISOString()}`);
  try {
    // Existing installations may pre-date the migration.
    await pool.query(`ALTER TABLE feedback_form_response ADD COLUMN IF NOT EXISTS trainer_emailed_at TIMESTAMPTZ`);

    const tpResult = await pool.query(`
      SELECT company_name, company_shortname, feedback_email_cc
      FROM training_provider ORDER BY created_at ASC LIMIT 1
    `);
    if (tpResult.rows.length === 0) {
      return { success: false, error: 'No training provider configured' };
    }
    const tp = tpResult.rows[0];
    const shortname: string = tp.company_shortname || tp.company_name || 'LMS';
    const companyName: string = tp.company_name || shortname;
    // Subject tag: initials of a multi-word name ("Tertiary Infotech Academy" → "TIA"),
    // otherwise the shortname as-is.
    const initials = shortname.split(/\s+/).map((w: string) => w[0]).join('').toUpperCase();
    const subjectTag = initials.length >= 2 ? initials : shortname;
    const taskCc = await pool.query(`SELECT alert_recipients FROM scheduler_config WHERE id = $1`, [TASK_ID])
      .then(r => splitEmails(r.rows[0]?.alert_recipients))
      .catch(() => [] as string[]);
    const ccList: string[] = taskCc.length > 0 ? taskCc : splitEmails(tp.feedback_email_cc);

    await ensureReviewColumns();

    // Feedback form template → ordered question labels.
    const tmplResult = await pool.query(
      `SELECT sections FROM feedback_form_template ORDER BY created_at ASC LIMIT 1`
    );
    const sections: FeedbackFormSection[] = tmplResult.rows[0]?.sections || [];
    const allFields = sections.flatMap(s => s.fields || []);
    const ratingFields = allFields.filter(f => f.type === 'rating1to5');
    const commentFields = allFields.filter(f => f.type === 'textarea');

    if (ratingFields.length === 0 && commentFields.length === 0) {
      console.warn('[auto-send-class-evaluation] Feedback form template has no rating/comment questions — nothing to compile');
      return { success: true, stats: { runsEmailed: 0, responsesEmailed: 0, runsSkipped: 0, errors: 0 } };
    }

    // Un-emailed responses for CONFIRMED runs whose class ended TODAY (SGT).
    // Classes that ended on an earlier day are never emailed (user rule 2026-11-28).
    const responsesResult = await pool.query(`
      SELECT fr.id, fr.answers, fr.submitted_at,
             cr.id AS run_uuid, cr.course_run_id AS run_code,
             c.title AS course_title, c.course_code
      FROM feedback_form_response fr
      JOIN course_run cr ON cr.id = fr.course_run_id
      JOIN course c ON c.id = cr.course_id
      WHERE fr.trainer_emailed_at IS NULL
        AND cr.class_status = 'Confirmed'
        AND cr.end_date = (NOW() AT TIME ZONE 'Asia/Singapore')::date
      ORDER BY cr.id, fr.submitted_at ASC
    `);

    const byRun = new Map<string, ResponseRow[]>();
    for (const row of responsesResult.rows as ResponseRow[]) {
      const list = byRun.get(row.run_uuid) || [];
      list.push(row);
      byRun.set(row.run_uuid, list);
    }

    console.log(`[auto-send-class-evaluation] ${responsesResult.rows.length} pending response(s) across ${byRun.size} run(s) that ended today`);

    let runsEmailed = 0;
    let responsesEmailed = 0;
    let runsSkipped = 0;
    let errors = 0;

    for (const [runUuid, responses] of byRun) {
      const { course_title, course_code, run_code } = responses[0];
      try {
        // Trainer recipients: canonical junction first, legacy scalars as fallback.
        const trainersResult = await pool.query(
          `SELECT crt.trainer_name, crt.trainer_email
           FROM course_run_trainer crt
           WHERE crt.course_run_id = $1 AND crt.trainer_email IS NOT NULL AND crt.trainer_email <> ''
           ORDER BY crt.trainer_name`,
          [runUuid]
        );
        let trainers: TrainerRecipient[] = trainersResult.rows.map((t: any) => ({
          name: t.trainer_name,
          email: t.trainer_email,
        }));
        if (trainers.length === 0) {
          const legacy = await pool.query(
            `SELECT tpg_assigned_trainer_name AS name, tpg_assigned_trainer_email AS email
             FROM course_run WHERE id = $1 AND tpg_assigned_trainer_email IS NOT NULL AND tpg_assigned_trainer_email <> ''`,
            [runUuid]
          );
          trainers = legacy.rows.map((t: any) => ({ name: t.name || 'Trainer', email: t.email }));
        }
        const recipients = resolveEvaluationRecipients(trainers.map(t => t.email), ccList);
        if (!recipients) {
          // Nobody at all to send to: leave unstamped until a trainer or CC list is set.
          console.warn(`[auto-send-class-evaluation] Run ${run_code} (${course_title}): no trainer email and no CC list — skipping`);
          runsSkipped++;
          continue;
        }

        let text = buildEvaluationEmailText({
          trainerNames: recipients.noTrainer ? ['Team'] : trainers.map(t => t.name),
          courseTitle: course_title,
          courseCode: course_code,
          ratingFields,
          commentFields,
          responses,
          companyName,
        });

        if (recipients.noTrainer) {
          text = `No trainer is recorded for this class in the LMS, so this evaluation was not sent to a trainer. Assign the trainer on the class and forward this email to them.\n\n${text}`;
        }

        const result = await sendViaGmailOAuth({
          to: recipients.to.join(', '),
          cc: recipients.cc.length > 0 ? recipients.cc : undefined,
          subject: `[${subjectTag}] Class Evaluation - ${course_title} (${run_code})${recipients.noTrainer ? ' - no trainer on record' : ''}`,
          text,
        });

        if (!result.ok) {
          console.error(`[auto-send-class-evaluation] Run ${run_code} (${course_title}): send failed — ${result.error}`);
          errors++;
          continue;
        }

        await pool.query(
          `UPDATE feedback_form_response SET trainer_emailed_at = NOW()
           WHERE id = ANY($1::uuid[]) AND trainer_emailed_at IS NULL`,
          [responses.map(r => r.id)]
        );
        runsEmailed++;
        responsesEmailed += responses.length;
        console.log(`[auto-send-class-evaluation] Run ${run_code} (${course_title}): emailed ${responses.length} response(s) to ${recipients.to.join(', ')}${recipients.cc.length ? ` cc ${recipients.cc.join(', ')}` : ''}${recipients.noTrainer ? ' (no trainer on record)' : ''}`);
      } catch (err) {
        errors++;
        console.error(`[auto-send-class-evaluation] Run ${run_code} (${course_title}): error —`, err);
      }
    }

    // Storefront reviews: independent of the email, so a mail failure never blocks them.
    let reviews = { posted: 0, held: 0, skipped: 0, failed: 0 };
    try {
      reviews = await postPendingReviews();
    } catch (err) {
      console.error('[auto-send-class-evaluation] storefront review step failed:', err);
      reviews.failed++;
    }

    const stats = { runsEmailed, responsesEmailed, runsSkipped, errors, reviews };
    console.log(`[auto-send-class-evaluation] Done`, stats);
    return { success: errors === 0 && reviews.failed === 0, stats };
  } catch (error) {
    console.error('[auto-send-class-evaluation] Fatal error:', error);
    return { success: false, error: error instanceof Error ? error.message : 'Internal error' };
  }
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ success: false, message: 'Method not allowed' });
  }

  const { authKey } = req.body || {};
  if (authKey !== SCHEDULER_SECRET && !isServiceRequest(req)) {
    return res.status(401).json({ success: false, message: 'Unauthorized' });
  }

  const result = await runAutomation();
  if (result.success) {
    return res.status(200).json(result);
  } else {
    return res.status(500).json(result);
  }
}
