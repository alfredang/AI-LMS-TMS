import type { NextApiRequest, NextApiResponse } from 'next';
import pool from '../../../lib/db';
import {
  sanitiseNric,
  sanitisePhone,
  nricNeedsSanitising,
  phoneNeedsSanitising,
} from '../../../lib/sanitiseHelpers';

/**
 * External API — Auto Sanitise Data
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * SCHEDULE: Default Sunday 02:00 SGT (configurable from Task Scheduler).
 *           Honours `training_provider.auto_mask_sensitive_data` (off → skipped)
 *           and `training_provider.sanitise_after_months` (default 6).
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * FLOW:
 *   1. Read the master toggle and the retention window from training_provider.
 *      Toggle off → write a single 'skipped' log row + return.
 *   2. Compute cutoff = NOW() - INTERVAL 'N months'.
 *   3. For each target table, SELECT rows whose timestamp is older than the
 *      cutoff AND match the not-yet-sanitised regex predicate. Cap each
 *      table at SWEEP_LIMIT rows so a single sweep stays bounded.
 *   4. For every row, run sanitiseNric() / sanitisePhone() in JS, then UPDATE
 *      the row only if any value actually changed. One log row per table
 *      with rows_scanned / rows_updated / status.
 *
 * Idempotent — safe to run repeatedly. Already-sanitised rows are filtered
 * out by both the SQL predicate AND the in-memory `*NeedsSanitising` check.
 *
 * POST /api/external/auto-sanitise-data
 * Headers: x-api-key: <EXTERNAL_API_KEY_FOR_CLAWDBOT>
 */

const SWEEP_LIMIT_PER_TABLE = 5000;
const SGT_TZ = 'Asia/Singapore';

/**
 * Format a Date as a YYYY-MM-DD string in Singapore (GMT+8). Using
 * Intl.DateTimeFormat with timeZone is the only safe way — building the
 * string off `toISOString()` would give us the UTC date, which is one day
 * behind on the 7-hour boundary.
 */
function formatDateSgt(d: Date): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: SGT_TZ,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(d);
  const get = (t: string) => parts.find(p => p.type === t)?.value ?? '';
  return `${get('year')}-${get('month')}-${get('day')}`;
}

/** Format a Date as a human-readable SGT timestamp for API responses. */
function formatDateTimeSgt(d: Date): string {
  return new Intl.DateTimeFormat('en-GB', {
    timeZone: SGT_TZ,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  }).format(d).replace(',', '') + ' SGT';
}

interface TableResult {
  table: string;
  rowsScanned: number;
  rowsUpdated: number;
  status: 'success' | 'error' | 'skipped';
  message: string | null;
}

interface AutomationSummary {
  runId: string;
  startedAt: string;
  retentionMonths: number;
  cutoffDate: string;
  enabled: boolean;
  totalScanned: number;
  totalUpdated: number;
  results: TableResult[];
}

// ── Log table ────────────────────────────────────────────────────────────────

async function ensureLogTable() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS auto_sanitise_data_log (
      id           SERIAL PRIMARY KEY,
      run_id       TEXT NOT NULL,
      created_at   TIMESTAMPTZ DEFAULT NOW(),
      table_name   TEXT NOT NULL,
      rows_scanned INTEGER NOT NULL DEFAULT 0,
      rows_updated INTEGER NOT NULL DEFAULT 0,
      cutoff_date  DATE,
      status       TEXT NOT NULL,
      message      TEXT
    )
  `);
  await pool.query(
    `CREATE INDEX IF NOT EXISTS idx_auto_sanitise_data_log_run
     ON auto_sanitise_data_log(run_id, created_at DESC)`
  );
}

async function insertLogRow(
  runId: string,
  cutoffDate: string | null,
  result: TableResult
) {
  try {
    await pool.query(
      `INSERT INTO auto_sanitise_data_log
         (run_id, table_name, rows_scanned, rows_updated, cutoff_date, status, message)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [runId, result.table, result.rowsScanned, result.rowsUpdated, cutoffDate, result.status, result.message]
    );
  } catch (err) {
    // Logging never aborts the sweep.
    console.error('❌ [auto-sanitise-data] insertLogRow failed:', err);
  }
}

// ── Per-table sweepers ───────────────────────────────────────────────────────
//
// Retention semantics: a row is in scope for sanitisation if the **class it
// belongs to has already ended more than N months ago** (i.e.
// `course_run.end_date < cutoff`, where cutoff = today - N months).
//
// `class_status` is intentionally NOT filtered — a class whose end_date is
// in the past is treated as terminal regardless of whether it was Confirmed,
// Pending, or Cancelled. A pending class that quietly passed its planned
// end date 8 months ago is just as much stale training data as a cancelled
// class from the same period, and in both cases the underlying PII should
// be redacted per the retention window.
//
// `trainer_profile.nric` / `trainer_profile.tel` are DELIBERATELY NOT
// sanitised. Trainers are long-lived contractual partners with recurring
// engagements — their contact details need to stay intact across
// arbitrary gaps between course runs. Only learner PII is subject to
// the retention window.
//
// Concretely:
//   - enrollment        → JOIN course_run, filter cr.end_date < cutoff
//   - course_attendance → JOIN course_session → course_run, filter end_date
//   - da_application    → course_end_date column is already on the row
//   - ssg_enrolments    → JOIN course_run on the text course_run_id
//   - ssg_claims        → no direct course link, fall back to imported_at
//   - learner_profile   → sanitise a learner whose MOST RECENT enrollment
//                         ended before the cutoff (i.e. zero recent activity)
//
// All sweepers walk candidate rows in JS, call the idempotent sanitiseNric /
// sanitisePhone helpers, and issue one targeted UPDATE per row that actually
// changes. Idempotency is belt-and-braces: both the SQL predicate and the
// helpers filter already-sanitised values out, so re-running a sweep is a no-op.

const NRIC_PG_REGEX = '^[A-Za-z][0-9]{4}[0-9]{3}[A-Za-z]$';
// Phone SQL predicate is intentionally loose — it matches any string with
// 8 consecutive digits somewhere in it, which covers all real shapes in
// the DB: bare `96983371`, `+65 9698 3371`, `9698-3371`, `+6596983371`, etc.
// The JS helper `sanitisePhone()` then does the real validation (strips
// +65 / spaces / hyphens, anchors the 8-digit match, and returns unchanged
// for already-sanitised values like `9xxxx371` which have only 3 contiguous
// digits). Idempotency still holds because a sanitised value has fewer
// than 8 contiguous digits so the SQL predicate skips it too.
const PHONE_PG_REGEX = '[0-9]{8}';

async function sweepEnrollment(cutoffISO: string): Promise<TableResult> {
  // Rows tied to a course_run whose end_date is older than the cutoff.
  const candidates = await pool.query(
    `SELECT e.id, e.nric
     FROM enrollment e
     JOIN course_run cr ON cr.id = e.course_run_id
     WHERE cr.end_date < $1::date
       AND e.nric IS NOT NULL
       AND e.nric ~ $2
     LIMIT $3`,
    [cutoffISO, NRIC_PG_REGEX, SWEEP_LIMIT_PER_TABLE]
  );
  return await applyUpdates('enrollment', candidates.rows, async (row) => {
    if (!nricNeedsSanitising(row.nric)) return false;
    const newNric = sanitiseNric(row.nric);
    await pool.query(`UPDATE enrollment SET nric = $1 WHERE id = $2`, [newNric, row.id]);
    return true;
  });
}

async function sweepCourseAttendance(cutoffISO: string): Promise<TableResult> {
  // course_attendance → course_session → course_run.
  const candidates = await pool.query(
    `SELECT ca.id, ca.nric
     FROM course_attendance ca
     JOIN course_session cs ON cs.id = ca.session_id
     JOIN course_run cr ON cr.id = cs.course_run_id
     WHERE cr.end_date < $1::date
       AND ca.nric IS NOT NULL
       AND ca.nric ~ $2
     LIMIT $3`,
    [cutoffISO, NRIC_PG_REGEX, SWEEP_LIMIT_PER_TABLE]
  );
  return await applyUpdates('course_attendance', candidates.rows, async (row) => {
    if (!nricNeedsSanitising(row.nric)) return false;
    const newNric = sanitiseNric(row.nric);
    await pool.query(`UPDATE course_attendance SET nric = $1 WHERE id = $2`, [newNric, row.id]);
    return true;
  });
}

async function sweepDaApplication(cutoffISO: string): Promise<TableResult> {
  // da_application already carries course_end_date on the row itself.
  const candidates = await pool.query(
    `SELECT id, trainee_id, trainee_phone
     FROM da_application
     WHERE course_end_date < $1::date
       AND ((trainee_id IS NOT NULL AND trainee_id ~ $2)
            OR (trainee_phone IS NOT NULL AND trainee_phone ~ $3))
     LIMIT $4`,
    [cutoffISO, NRIC_PG_REGEX, PHONE_PG_REGEX, SWEEP_LIMIT_PER_TABLE]
  );
  return await applyUpdates('da_application', candidates.rows, async (row) => {
    const newNric = nricNeedsSanitising(row.trainee_id) ? sanitiseNric(row.trainee_id) : null;
    const newPhone = phoneNeedsSanitising(row.trainee_phone) ? sanitisePhone(row.trainee_phone) : null;
    if (newNric == null && newPhone == null) return false;
    await pool.query(
      `UPDATE da_application
       SET trainee_id    = COALESCE($1, trainee_id),
           trainee_phone = COALESCE($2, trainee_phone)
       WHERE id = $3`,
      [newNric, newPhone, row.id]
    );
    return true;
  });
}

async function sweepSsgEnrolments(cutoffISO: string): Promise<TableResult> {
  // ssg_enrolments.course_run_id is the external TPG string id; join to
  // course_run.course_run_id (also varchar) — NOT to course_run.id uuid.
  const candidates = await pool.query(
    `SELECT se.id, se.trainee_nric
     FROM ssg_enrolments se
     JOIN course_run cr ON cr.course_run_id = se.course_run_id
     WHERE cr.end_date < $1::date
       AND se.trainee_nric IS NOT NULL
       AND se.trainee_nric ~ $2
     LIMIT $3`,
    [cutoffISO, NRIC_PG_REGEX, SWEEP_LIMIT_PER_TABLE]
  );
  return await applyUpdates('ssg_enrolments', candidates.rows, async (row) => {
    if (!nricNeedsSanitising(row.trainee_nric)) return false;
    const newNric = sanitiseNric(row.trainee_nric);
    await pool.query(`UPDATE ssg_enrolments SET trainee_nric = $1 WHERE id = $2`, [newNric, row.id]);
    return true;
  });
}

async function sweepSsgClaims(cutoffISO: string): Promise<TableResult> {
  // ssg_claims has no direct link to a specific course run, so we fall back
  // to imported_at as the retention driver. If a claim record was imported
  // more than N months ago, any class it refers to is also well past the
  // retention window.
  const candidates = await pool.query(
    `SELECT id, individual_nric
     FROM ssg_claims
     WHERE imported_at < $1::timestamptz
       AND individual_nric IS NOT NULL
       AND individual_nric ~ $2
     LIMIT $3`,
    [cutoffISO, NRIC_PG_REGEX, SWEEP_LIMIT_PER_TABLE]
  );
  return await applyUpdates('ssg_claims', candidates.rows, async (row) => {
    if (!nricNeedsSanitising(row.individual_nric)) return false;
    const newNric = sanitiseNric(row.individual_nric);
    await pool.query(`UPDATE ssg_claims SET individual_nric = $1 WHERE id = $2`, [newNric, row.id]);
    return true;
  });
}

async function sweepLearnerProfile(cutoffISO: string): Promise<TableResult> {
  // Target: learners whose MOST RECENT enrollment ended before the cutoff,
  // i.e. their last class has already aged out of the retention window.
  // Learners with zero enrollments are skipped — they have no class history
  // so there is no training-data retention concern to drive sanitisation.
  //
  // PERF: we filter learner_profile down to just the rows that still have
  // unsanitised NRIC or phone BEFORE computing the MAX(end_date) aggregate.
  // On steady-state weekly runs after the first sweep cleans everything,
  // the candidate_profiles CTE will be empty, so the expensive enrollment
  // aggregation never runs at all.
  const candidates = await pool.query(
    `WITH candidate_profiles AS (
       SELECT user_id, nric, tel
       FROM learner_profile
       WHERE (nric IS NOT NULL AND nric ~ $2)
          OR (tel  IS NOT NULL AND tel  ~ $3)
     ),
     last_class AS (
       SELECT e.user_id, MAX(cr.end_date) AS last_end_date
       FROM enrollment e
       JOIN course_run cr ON cr.id = e.course_run_id
       WHERE cr.end_date IS NOT NULL
         AND e.user_id IN (SELECT user_id FROM candidate_profiles)
       GROUP BY e.user_id
     )
     SELECT cp.user_id, cp.nric, cp.tel
     FROM candidate_profiles cp
     JOIN last_class lc ON lc.user_id = cp.user_id
     WHERE lc.last_end_date < $1::date
     LIMIT $4`,
    [cutoffISO, NRIC_PG_REGEX, PHONE_PG_REGEX, SWEEP_LIMIT_PER_TABLE]
  );
  return await applyUpdates('learner_profile', candidates.rows, async (row) => {
    const newNric = nricNeedsSanitising(row.nric) ? sanitiseNric(row.nric) : null;
    const newTel = phoneNeedsSanitising(row.tel) ? sanitisePhone(row.tel) : null;
    if (newNric == null && newTel == null) return false;
    await pool.query(
      `UPDATE learner_profile
       SET nric = COALESCE($1, nric),
           tel  = COALESCE($2, tel)
       WHERE user_id = $3`,
      [newNric, newTel, row.user_id]
    );
    return true;
  });
}

// NOTE: trainer_profile is intentionally NOT swept. Trainers are long-lived
// contractual partners whose contact details need to stay intact across
// arbitrary gaps between engagements. Only learner PII is subject to the
// retention window. See the file-level comment above for full rationale.

/**
 * Walks a candidate set, calling the per-row updater. Each row is wrapped in
 * its own try/catch so one bad row never aborts the whole table sweep — a
 * single error gets recorded in the result message but the loop continues.
 */
async function applyUpdates(
  table: string,
  rows: any[],
  updater: (row: any) => Promise<boolean>
): Promise<TableResult> {
  let updated = 0;
  let firstError: string | null = null;
  for (const row of rows) {
    try {
      const didUpdate = await updater(row);
      if (didUpdate) updated++;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`❌ [auto-sanitise-data] ${table} row failed:`, msg);
      if (!firstError) firstError = msg;
    }
  }
  return {
    table,
    rowsScanned: rows.length,
    rowsUpdated: updated,
    status: firstError ? 'error' : 'success',
    message: firstError,
  };
}

// ── Main runner ──────────────────────────────────────────────────────────────

export async function runAutomation(): Promise<AutomationSummary> {
  await ensureLogTable();

  const now = new Date();
  const runId = `sanitise_${Date.now()}`;
  // startedAt is what the API response shows the admin; use SGT for display.
  const startedAt = formatDateTimeSgt(now);

  console.log(`🧹 [auto-sanitise-data] starting ${runId} at ${startedAt}`);

  // Read toggle + retention window
  const tpRes = await pool.query(
    `SELECT auto_mask_sensitive_data, sanitise_after_months
     FROM training_provider LIMIT 1`
  );
  const tp = tpRes.rows[0] || {};
  const enabled = !!tp.auto_mask_sensitive_data;
  const retentionMonths = Number(tp.sanitise_after_months ?? 6) || 6;

  // Compute cutoff as an instant N months before now, then render the
  // displayed cutoffDate in SGT (GMT+8) so what the admin sees matches the
  // rest of the app. The cutoffISO passed into SQL predicates stays as a
  // UTC-anchored ISO string — TIMESTAMPTZ columns compare correctly against
  // any ISO instant regardless of offset, so it's equivalent semantically.
  const cutoffInstant = new Date(now);
  cutoffInstant.setMonth(cutoffInstant.getMonth() - retentionMonths);
  const cutoffISO = cutoffInstant.toISOString();
  const cutoffDate = formatDateSgt(cutoffInstant);

  if (!enabled) {
    const skipped: TableResult = {
      table: '(toggle off)',
      rowsScanned: 0,
      rowsUpdated: 0,
      status: 'skipped',
      message: 'auto_mask_sensitive_data is disabled',
    };
    await insertLogRow(runId, cutoffDate, skipped);
    console.log(`🧹 [auto-sanitise-data] ${runId} skipped — toggle off`);
    return {
      runId,
      startedAt,
      retentionMonths,
      cutoffDate,
      enabled,
      totalScanned: 0,
      totalUpdated: 0,
      results: [skipped],
    };
  }

  console.log(`🧹 [auto-sanitise-data] ${runId} cutoff = ${cutoffDate} (retention ${retentionMonths} months)`);

  // Order: direct per-class rows first (the bulk of the work), then the
  // per-user aggregate sweep (learner profile) which depends on enrollment
  // already being accounted for. trainer_profile is intentionally omitted —
  // trainer PII is exempt from the retention window.
  const sweepers: Array<(c: string) => Promise<TableResult>> = [
    sweepEnrollment,
    sweepCourseAttendance,
    sweepDaApplication,
    sweepSsgEnrolments,
    sweepSsgClaims,
    sweepLearnerProfile,
  ];

  const results: TableResult[] = [];
  let totalScanned = 0;
  let totalUpdated = 0;

  // Pass the SGT-computed YYYY-MM-DD date string directly — every sweeper
  // casts it with ::date (or ::timestamptz for ssg_claims) so this is the
  // least-ambiguous shape. Avoids any chance of the UTC→SGT day-boundary
  // shifting the cutoff by one day.
  for (const sweep of sweepers) {
    try {
      const r = await sweep(cutoffDate);
      results.push(r);
      totalScanned += r.rowsScanned;
      totalUpdated += r.rowsUpdated;
      await insertLogRow(runId, cutoffDate, r);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`❌ [auto-sanitise-data] sweeper ${sweep.name} failed:`, msg);
      const fail: TableResult = {
        table: sweep.name.replace(/^sweep/, '').replace(/([A-Z])/g, '_$1').slice(1).toLowerCase(),
        rowsScanned: 0,
        rowsUpdated: 0,
        status: 'error',
        message: msg,
      };
      results.push(fail);
      await insertLogRow(runId, cutoffDate, fail);
    }
  }

  console.log(
    `🧹 [auto-sanitise-data] ${runId} done — scanned=${totalScanned} updated=${totalUpdated}`
  );

  return {
    runId,
    startedAt,
    retentionMonths,
    cutoffDate,
    enabled,
    totalScanned,
    totalUpdated,
    results,
  };
}

// ── HTTP handler (external) ──────────────────────────────────────────────────

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
    console.error('❌ auto-sanitise-data error:', err);
    return res.status(500).json({
      success: false,
      error: err instanceof Error ? err.message : 'Internal server error',
    });
  }
}
