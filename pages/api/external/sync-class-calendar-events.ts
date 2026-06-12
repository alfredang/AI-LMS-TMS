import type { NextApiRequest, NextApiResponse } from 'next';
import pool from '@lib/db';
import { ensureClassCalendarEvent, removeClassCalendarEvents, syncClassAttendees } from '@lib/calendar/ensureClassCalendarEvent';

/**
 * Daily reconciliation: make the calendar mirror the classes.
 *   - upcoming non-cancelled class WITH >=1 confirmed learner  -> ensure event + sync attendees
 *   - class Cancelled, OR 0 confirmed learners, but has mapping -> remove its events
 * Idempotent, advisory-locked per run. DISABLED by default (enable in Task Scheduler).
 *
 * Invoked in-process by the scheduler (sync_class_calendar_events). Also exposed
 * over HTTP (x-api-key) for manual run + log reads.
 */
const DEFAULT_DAYS_AHEAD = 14;

async function ensureLogTable() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS class_calendar_sync_log (
      id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      run_at        timestamptz NOT NULL DEFAULT now(),
      ensured       integer DEFAULT 0,
      attendees_add integer DEFAULT 0,
      attendees_rem integer DEFAULT 0,
      removed_runs  integer DEFAULT 0,
      errors        integer DEFAULT 0,
      ok            boolean NOT NULL DEFAULT true,
      error         text,
      duration_ms   integer
    )`).catch(() => {});
}

export async function runAutomation(opts: { daysAhead?: number } = {}) {
  // ROLLBACK (calendar refactor): reconciliation no longer creates / syncs / removes
  // calendar events or attendees. It will be rebuilt as a READ-ONLY discrepancy
  // detector (highlighter) — see markdown/calendar-cancellation-fix-spec.md. Until
  // then it is a hard no-op (even if toggled on in the Task Scheduler) so it can
  // never recreate the cancelled-class incident. Set ALLOW_LEGACY_CALENDAR_RECON=true
  // only to deliberately run the old write behaviour.
  if (process.env.ALLOW_LEGACY_CALENDAR_RECON !== 'true') {
    return { success: true, skipped: true, message: 'reconciliation disabled pending highlighter rebuild' };
  }
  const started = Date.now();
  await ensureLogTable();

  const tp = (await pool.query('SELECT sync_google_calendar FROM training_provider LIMIT 1')).rows[0];
  if (!tp || tp.sync_google_calendar !== true) {
    return { success: true, skipped: true, message: 'Google Calendar sync disabled' };
  }

  let daysAhead = opts.daysAhead;
  if (daysAhead == null) {
    try { daysAhead = Number((await pool.query(`SELECT days_in_advance FROM scheduler_config WHERE id='sync_class_calendar_events' LIMIT 1`)).rows[0]?.days_in_advance ?? DEFAULT_DAYS_AHEAD); }
    catch { daysAhead = DEFAULT_DAYS_AHEAD; }
  }
  if (!Number.isFinite(daysAhead as number) || (daysAhead as number) < 0) daysAhead = DEFAULT_DAYS_AHEAD;

  let ensured = 0, attendeesAdd = 0, attendeesRem = 0, removedRuns = 0, errors = 0;

  try {
    // (A) upcoming non-cancelled classes WITH confirmed learners -> ensure + attendees
    const toEnsure = (await pool.query(
      `SELECT cr.id FROM course_run cr
        WHERE cr.is_deleted = false AND cr.class_status <> 'Cancelled'
          AND cr.end_date >= (NOW() AT TIME ZONE 'Asia/Singapore')::date
          AND cr.start_date <= (NOW() AT TIME ZONE 'Asia/Singapore')::date + ($1::int * INTERVAL '1 day')
          AND EXISTS (SELECT 1 FROM enrollment e WHERE e.course_run_id = cr.id AND e.enrolment_status = 'Confirmed')`,
      [daysAhead]
    )).rows;
    for (const r of toEnsure) {
      try {
        const e = await ensureClassCalendarEvent(r.id);
        if (e.status === 'ok') ensured++;
        const a = await syncClassAttendees(r.id);
        attendeesAdd += a.added; attendeesRem += a.removed;
        if (e.errors || a.errors) errors += (e.errors + a.errors);
      } catch { errors++; }
    }

    // (B) classes that should have NO events (cancelled or no confirmed learners) but still do -> remove
    const toRemove = (await pool.query(
      `SELECT DISTINCT cr.id FROM course_run cr
        JOIN course_run_calendar_event m ON m.course_run_id = cr.id
        WHERE cr.class_status = 'Cancelled'
           OR NOT EXISTS (SELECT 1 FROM enrollment e WHERE e.course_run_id = cr.id AND e.enrolment_status = 'Confirmed')`
    )).rows;
    for (const r of toRemove) {
      try { const rm = await removeClassCalendarEvents(r.id, { reason: 'reconcile' }); if (rm.removed > 0) removedRuns++; if (rm.errors) errors += rm.errors; }
      catch { errors++; }
    }

    const duration = Date.now() - started;
    await pool.query(
      `INSERT INTO class_calendar_sync_log (ensured, attendees_add, attendees_rem, removed_runs, errors, ok, duration_ms)
       VALUES ($1,$2,$3,$4,$5,true,$6)`,
      [ensured, attendeesAdd, attendeesRem, removedRuns, errors, duration]
    ).catch(() => {});
    return { success: true, ensured, attendeesAdded: attendeesAdd, attendeesRemoved: attendeesRem, removedRuns, errors, durationMs: duration };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    await pool.query(`INSERT INTO class_calendar_sync_log (ok, error, duration_ms) VALUES (false,$1,$2)`, [msg.slice(0, 500), Date.now() - started]).catch(() => {});
    return { success: false, error: msg };
  }
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const key = req.headers['x-api-key'];
  if (!process.env.EXTERNAL_API_KEY_FOR_CLAWDBOT || key !== process.env.EXTERNAL_API_KEY_FOR_CLAWDBOT) {
    return res.status(401).json({ success: false, error: 'unauthorized' });
  }
  if (req.method === 'GET') {
    await ensureLogTable();
    const rows = (await pool.query(`SELECT * FROM class_calendar_sync_log ORDER BY run_at DESC LIMIT 20`)).rows;
    return res.status(200).json({ success: true, logs: rows });
  }
  if (req.method === 'POST') {
    const daysAhead = req.body?.daysAhead != null ? Number(req.body.daysAhead) : undefined;
    const out = await runAutomation({ daysAhead });
    return res.status(out.success ? 200 : 500).json(out);
  }
  return res.status(405).json({ success: false, error: 'Method not allowed' });
}
