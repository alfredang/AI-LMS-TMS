import { isServiceRequest } from '@lib/auth/serviceKey';
import type { NextApiRequest, NextApiResponse } from 'next';
import pool from '../../../lib/db';
import { sendViaGmailOAuth } from '../../../lib/gmailOauthSend';
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
 *   CONFIRMED course run that has ENDED, and emails the compiled evaluation to
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
 *   responses. Runs whose class has not ended yet are left for a later day.
 */

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
    const ccList: string[] = (tp.feedback_email_cc || '')
      .split(',')
      .map((e: string) => e.trim())
      .filter(Boolean);

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

    // Un-emailed responses for CONFIRMED runs whose class has ended (SGT).
    const responsesResult = await pool.query(`
      SELECT fr.id, fr.answers, fr.submitted_at,
             cr.id AS run_uuid, cr.course_run_id AS run_code,
             c.title AS course_title, c.course_code
      FROM feedback_form_response fr
      JOIN course_run cr ON cr.id = fr.course_run_id
      JOIN course c ON c.id = cr.course_id
      WHERE fr.trainer_emailed_at IS NULL
        AND cr.class_status = 'Confirmed'
        AND cr.end_date <= (NOW() AT TIME ZONE 'Asia/Singapore')::date
      ORDER BY cr.id, fr.submitted_at ASC
    `);

    const byRun = new Map<string, ResponseRow[]>();
    for (const row of responsesResult.rows as ResponseRow[]) {
      const list = byRun.get(row.run_uuid) || [];
      list.push(row);
      byRun.set(row.run_uuid, list);
    }

    console.log(`[auto-send-class-evaluation] ${responsesResult.rows.length} pending response(s) across ${byRun.size} ended run(s)`);

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
        if (trainers.length === 0) {
          // Leave responses unstamped: they will send once a trainer email is set.
          console.warn(`[auto-send-class-evaluation] Run ${run_code} (${course_title}): no trainer email on record — skipping`);
          runsSkipped++;
          continue;
        }

        const text = buildEvaluationEmailText({
          trainerNames: trainers.map(t => t.name),
          courseTitle: course_title,
          courseCode: course_code,
          ratingFields,
          commentFields,
          responses,
          companyName,
        });

        const result = await sendViaGmailOAuth({
          to: [...trainers.map(t => t.email), ...ccList].join(', '),
          subject: `[${subjectTag}] Class Evaluation - ${course_title} (${run_code})`,
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
        console.log(`[auto-send-class-evaluation] Run ${run_code} (${course_title}): emailed ${responses.length} response(s) to ${trainers.map(t => t.email).join(', ')}`);
      } catch (err) {
        errors++;
        console.error(`[auto-send-class-evaluation] Run ${run_code} (${course_title}): error —`, err);
      }
    }

    const stats = { runsEmailed, responsesEmailed, runsSkipped, errors };
    console.log(`[auto-send-class-evaluation] Done`, stats);
    return { success: errors === 0, stats };
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
