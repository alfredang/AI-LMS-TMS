import type { NextApiRequest, NextApiResponse } from 'next';
import pool from '@lib/db';
import { addTrainerToCalendar } from '@lib/calendar/addTrainerToCalendar';

/**
 * Daily "Add Trainers to Google Calendar" job — LMS -> Calendar direction.
 *
 * The LMS is the source of truth. For every upcoming class (today .. today +
 * daysAhead, SGT) that has a trainer assigned IN THE LMS (course_run_trainer
 * junction, or the legacy assigned_trainer_email), this pushes that trainer onto
 * the matching Google Calendar event as an attendee — reusing the existing,
 * proven addTrainerToCalendar() (event matching + attendee patch + recurring
 * handling). It only ADDS; it never reads trainers back from the calendar and
 * never overwrites LMS data.
 *
 * This is the counterpart to the existing learner sync
 * (auto-add-today-enrolments-to-calendar) which already pushes learners — there
 * was no equivalent for trainers (trainer->calendar was manual, one class at a
 * time). This fills that gap.
 *
 * Invoked in-process by the scheduler (direct handler `sync_trainers_to_calendar`).
 * Also exposed over HTTP (guarded by x-api-key) for manual run + log reads.
 */

const DEFAULT_DAYS_AHEAD = 7;

function sgtToday(): string {
  return new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Singapore' });
}
function addDays(ymd: string, n: number): string {
  const d = new Date(ymd + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

async function ensureLogTable() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS lms_to_calendar_trainer_sync_log (
      id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      run_at           timestamptz NOT NULL DEFAULT now(),
      window_start     date,
      window_end       date,
      runs_processed   integer DEFAULT 0,
      assignments      integer DEFAULT 0,
      pushed           integer DEFAULT 0,
      already_present  integer DEFAULT 0,
      event_not_found  integer DEFAULT 0,
      errors           integer DEFAULT 0,
      attention        jsonb,
      ok               boolean NOT NULL DEFAULT true,
      error            text,
      duration_ms      integer
    )
  `);
  await pool.query(
    `CREATE INDEX IF NOT EXISTS idx_lms_to_calendar_trainer_sync_log_run_at ON lms_to_calendar_trainer_sync_log (run_at DESC)`
  );
}

export interface RunOptions {
  daysAhead?: number;
}

/** Automation entry point. Called directly (no HTTP) by the scheduler. */
export async function runAutomation(opts: RunOptions = {}) {
  // ROLLBACK (calendar refactor): the automated trainer->calendar push is retired.
  // Its purpose ("an LMS-assigned trainer is missing from the event") becomes a
  // highlighted discrepancy (D3) the admin resolves in the review panel — see the
  // spec. Hard no-op unless ALLOW_LEGACY_CALENDAR_RECON=true.
  if (process.env.ALLOW_LEGACY_CALENDAR_RECON !== 'true') {
    return { success: true, skipped: true, message: 'trainer-sync retired (folded into discrepancy review panel)' };
  }
  const started = Date.now();
  await ensureLogTable();

  // Calendar sync must be enabled (addTrainerToCalendar also checks this per-call).
  const tp = (await pool.query('SELECT sync_google_calendar FROM training_provider LIMIT 1')).rows[0];
  if (!tp || tp.sync_google_calendar !== true) {
    const msg = 'Google Calendar sync is disabled (training_provider.sync_google_calendar) — nothing pushed';
    await pool.query(
      `INSERT INTO lms_to_calendar_trainer_sync_log (window_start, window_end, ok, error, duration_ms)
       VALUES (NULL, NULL, true, $1, $2)`,
      [msg, Date.now() - started]
    ).catch(() => {});
    return { success: true, skipped: true, message: msg };
  }

  let daysAhead = opts.daysAhead;
  if (daysAhead == null) {
    try {
      const r = await pool.query(`SELECT days_in_advance FROM scheduler_config WHERE id = 'sync_trainers_to_calendar' LIMIT 1`);
      daysAhead = r.rows[0]?.days_in_advance != null ? Number(r.rows[0].days_in_advance) : DEFAULT_DAYS_AHEAD;
    } catch { daysAhead = DEFAULT_DAYS_AHEAD; }
  }
  if (!Number.isFinite(daysAhead as number) || (daysAhead as number) < 0) daysAhead = DEFAULT_DAYS_AHEAD;

  const start = sgtToday();
  const end = addDays(start, daysAhead as number);

  try {
    // Upcoming/ongoing, non-cancelled runs that have a trainer assigned in the LMS.
    const runsRes = await pool.query(
      `SELECT cr.id, cr.course_run_id,
              COALESCE(
                (SELECT array_agg(DISTINCT lower(btrim(t.trainer_email)))
                   FROM course_run_trainer t
                  WHERE t.course_run_id = cr.id AND nullif(btrim(t.trainer_email), '') IS NOT NULL),
                ARRAY[]::text[]
              ) AS junction_emails,
              nullif(btrim(lower(cr.assigned_trainer_email)), '') AS scalar_email
         FROM course_run cr
         JOIN course c ON c.id = cr.course_id
        WHERE cr.class_status <> 'Cancelled'
          AND cr.end_date >= $1::date
          AND (cr.start_date AT TIME ZONE 'Asia/Singapore')::date <= $2::date
          AND (
            EXISTS (SELECT 1 FROM course_run_trainer t WHERE t.course_run_id = cr.id AND nullif(btrim(t.trainer_email), '') IS NOT NULL)
            OR nullif(btrim(cr.assigned_trainer_email), '') IS NOT NULL
          )
        ORDER BY cr.start_date`,
      [start, end]
    );

    let runsProcessed = 0, assignments = 0, pushed = 0, alreadyPresent = 0, eventNotFound = 0, errors = 0;
    const attention: Array<{ courseRunId: string; trainerEmail: string; message: string }> = [];

    for (const run of runsRes.rows) {
      const emails: string[] = (run.junction_emails && run.junction_emails.length > 0)
        ? run.junction_emails
        : (run.scalar_email ? [run.scalar_email] : []);
      if (emails.length === 0) continue;
      runsProcessed++;

      for (const email of emails) {
        assignments++;
        try {
          const res = await addTrainerToCalendar(String(run.id), email);
          if (res.success && res.addedCount > 0) pushed++;
          else if (res.success) alreadyPresent++;
          else if (/not found/i.test(res.message)) { eventNotFound++; if (attention.length < 100) attention.push({ courseRunId: run.course_run_id, trainerEmail: email, message: res.message }); }
          else { errors++; if (attention.length < 100) attention.push({ courseRunId: run.course_run_id, trainerEmail: email, message: res.message }); }
        } catch (e: any) {
          errors++;
          if (attention.length < 100) attention.push({ courseRunId: run.course_run_id, trainerEmail: email, message: e?.message || String(e) });
        }
      }
    }

    const duration = Date.now() - started;
    await pool.query(
      `INSERT INTO lms_to_calendar_trainer_sync_log
        (window_start, window_end, runs_processed, assignments, pushed, already_present, event_not_found, errors, attention, ok, error, duration_ms)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,true,NULL,$10)`,
      [start, end, runsProcessed, assignments, pushed, alreadyPresent, eventNotFound, errors, JSON.stringify(attention), duration]
    ).catch(() => {});

    return { success: true, window_start: start, window_end: end, runsProcessed, assignments, pushed, alreadyPresent, eventNotFound, errors, attention, durationMs: duration };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    await pool.query(
      `INSERT INTO lms_to_calendar_trainer_sync_log (window_start, window_end, ok, error, duration_ms) VALUES ($1,$2,false,$3,$4)`,
      [start, end, msg.slice(0, 500), Date.now() - started]
    ).catch(() => {});
    return { success: false, error: msg, window_start: start, window_end: end };
  }
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const key = req.headers['x-api-key'];
  const expected = process.env.EXTERNAL_API_KEY_FOR_CLAWDBOT;
  if (!expected || key !== expected) {
    return res.status(401).json({ success: false, error: 'unauthorized' });
  }

  if (req.method === 'GET') {
    await ensureLogTable();
    const limit = Math.min(parseInt(String(req.query.limit || '20'), 10) || 20, 100);
    const rows = (await pool.query(`SELECT * FROM lms_to_calendar_trainer_sync_log ORDER BY run_at DESC LIMIT $1`, [limit])).rows;
    return res.status(200).json({ success: true, count: rows.length, logs: rows });
  }

  if (req.method === 'POST') {
    const daysAhead = req.body?.daysAhead != null ? Number(req.body.daysAhead) : undefined;
    const result = await runAutomation({ daysAhead });
    return res.status(result.success ? 200 : 500).json(result);
  }

  return res.status(405).json({ success: false, error: 'Method not allowed' });
}
