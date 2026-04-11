import type { NextApiRequest, NextApiResponse } from 'next';
import pool from '../../../lib/db';
import {
  loadTrainingProviderEmailConfig,
  sendNextTrainerInvitationForCourseRun,
  TrainerInvitationSendResult,
} from '../../../lib/trainerInvitationSender';

/**
 * External API — Auto Send Trainer Invitations
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * SCHEDULE: Runs on the schedule configured in the Task Scheduler (default
 *           10:00 AM SGT on Monday and Thursday). Window controlled by
 *           `days_in_advance` on the scheduler_config row (default 30 days).
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * FLOW:
 *   1. Find every upcoming course_run whose start_date is within the
 *      configured window (today → today + N days) AND has no row in
 *      `course_run_trainer` (i.e. no locally-assigned trainer yet).
 *   2. For each eligible run, delegate to `sendNextTrainerInvitationForCourseRun`
 *      which picks the next approved trainer who hasn't already been invited,
 *      declined, or assigned, and sends them an invitation email.
 *   3. Aggregate per-run results and return a summary.
 *
 * Safe to run repeatedly — idempotent via the pending/declined skip-sets
 * inside the shared helper.
 *
 * POST /api/external/auto-send-trainer-invitations
 * Headers: x-api-key: <EXTERNAL_API_KEY_FOR_CLAWDBOT>
 */

const DEFAULT_WINDOW_DAYS = 30;

interface AutomationSummary {
  runId: string;
  startedAt: string;
  windowDays: number;
  totalEligible: number;
  sent: number;
  skipped: number;
  errors: number;
  results: TrainerInvitationSendResult[];
}

// ── Per-row log table ────────────────────────────────────────────────────────
// Mirrors the pattern used by upcoming_course_runs_log / trainer_folder_logs:
// one row per course run processed in a single sweep, tagged by a shared
// run_id so the view can group batches.
async function ensureLogTable() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS auto_send_trainer_invitation_log (
      id               SERIAL PRIMARY KEY,
      run_id           TEXT NOT NULL,
      created_at       TIMESTAMPTZ DEFAULT NOW(),
      course_run_uuid  UUID,
      course_run_id    TEXT,
      course_title     TEXT,
      trainer_name     TEXT,
      trainer_email    TEXT,
      status           TEXT NOT NULL,
      message          TEXT
    )
  `);
  await pool.query(
    `CREATE INDEX IF NOT EXISTS idx_auto_send_trainer_invitation_log_run_id
     ON auto_send_trainer_invitation_log(run_id, created_at DESC)`
  );
}

async function insertLogRow(runId: string, result: TrainerInvitationSendResult) {
  try {
    await pool.query(
      `INSERT INTO auto_send_trainer_invitation_log
         (run_id, course_run_uuid, course_run_id, course_title,
          trainer_name, trainer_email, status, message)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
      [
        runId,
        result.courseRunUuid || null,
        result.courseRunId || null,
        result.courseTitle || null,
        result.trainerName || null,
        result.trainerEmail || null,
        result.status,
        result.message || null,
      ]
    );
  } catch (err) {
    // Never let logging kill the sweep.
    console.error('❌ [auto-send-trainer-invitations] insertLogRow failed:', err);
  }
}

/**
 * Read `days_in_advance` from scheduler_config so admins can tune the
 * lookahead window from the Task Scheduler UI without code changes.
 */
async function getWindowDays(): Promise<number> {
  try {
    const res = await pool.query<{ days_in_advance: number | null }>(
      `SELECT days_in_advance FROM scheduler_config WHERE id = 'auto_send_trainer_invitations' LIMIT 1`
    );
    const n = res.rows[0]?.days_in_advance;
    if (typeof n === 'number' && n > 0) return n;
  } catch {
    // Table may not exist yet on first boot — fall back to default.
  }
  return DEFAULT_WINDOW_DAYS;
}

export async function runAutomation(): Promise<AutomationSummary> {
  await ensureLogTable();

  const runId = `trainer_invite_${Date.now()}`;
  const startedAt = new Date().toISOString();
  const windowDays = await getWindowDays();

  console.log(`📨 [auto-send-trainer-invitations] starting ${runId} — window: next ${windowDays} days`);

  // Preload training provider config once so we don't refetch per row.
  const tp = await loadTrainingProviderEmailConfig();
  if (!tp) {
    throw new Error('Training provider Gmail OAuth is not configured');
  }

  // Eligible course runs: start_date in the lookahead window, no locally
  // assigned trainer. We intentionally do NOT filter on class_status here —
  // any upcoming run without a trainer should get one.
  const eligibleRes = await pool.query(
    `SELECT cr.id
     FROM course_run cr
     WHERE cr.start_date >= CURRENT_DATE
       AND cr.start_date <= CURRENT_DATE + ($1::int * INTERVAL '1 day')
       AND NOT EXISTS (
         SELECT 1 FROM course_run_trainer crt WHERE crt.course_run_id = cr.id
       )
     ORDER BY cr.start_date ASC`,
    [windowDays]
  );

  const results: TrainerInvitationSendResult[] = [];
  let sent = 0;
  let skipped = 0;
  let errors = 0;

  // If the eligibility query returned zero rows we still want a placeholder
  // log row so admins can see the sweep fired but had nothing to do.
  if (eligibleRes.rows.length === 0) {
    await insertLogRow(runId, {
      status: 'skipped_all_invited',
      courseRunUuid: '',
      message: 'No eligible upcoming course runs missing a local trainer in the window.',
    });
  }

  for (const row of eligibleRes.rows) {
    try {
      const result = await sendNextTrainerInvitationForCourseRun({
        courseRunUuid: row.id,
        tp,
      });
      results.push(result);
      await insertLogRow(runId, result);

      if (result.status === 'sent') {
        sent++;
      } else if (result.status === 'error') {
        errors++;
      } else {
        skipped++;
      }
    } catch (err) {
      errors++;
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`❌ [auto-send-trainer-invitations] course_run ${row.id} failed:`, msg);
      const errResult: TrainerInvitationSendResult = {
        status: 'error',
        courseRunUuid: row.id,
        message: msg,
      };
      results.push(errResult);
      await insertLogRow(runId, errResult);
    }
  }

  const summary: AutomationSummary = {
    runId,
    startedAt,
    windowDays,
    totalEligible: eligibleRes.rows.length,
    sent,
    skipped,
    errors,
    results,
  };

  console.log(
    `📨 [auto-send-trainer-invitations] done ${runId} — eligible=${summary.totalEligible} sent=${sent} skipped=${skipped} errors=${errors}`
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
    console.error('❌ auto-send-trainer-invitations error:', err);
    return res.status(500).json({
      success: false,
      error: err instanceof Error ? err.message : 'Internal server error',
    });
  }
}
