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
// All sweepers share the same shape: SELECT candidate rows older than the
// cutoff that still match the unsanitised regex, walk them in JS, and issue
// one targeted UPDATE per row that actually changes. We deliberately avoid
// `UPDATE ... FROM (SELECT ...)` because the regex predicate is in PG dialect
// and the test corpus is small enough that per-row UPDATE is fine — and it
// gives us individual error isolation.

const NRIC_PG_REGEX = '^[A-Za-z][0-9]{4}[0-9]{3}[A-Za-z]$';
// Phone is matched in two flavours: bare 8-digit and the messier free-form
// in DB. The SQL predicate is intentionally generous; the JS helpers do the
// real validation.
const PHONE_PG_REGEX = '[0-9]{8}';

async function sweepLearnerProfile(cutoffISO: string): Promise<TableResult> {
  // learner_profile has no own timestamp — join app_user.created_at via user_id.
  const candidates = await pool.query(
    `SELECT lp.user_id, lp.nric, lp.tel
     FROM learner_profile lp
     JOIN app_user au ON au.id = lp.user_id
     WHERE au.created_at < $1
       AND ((lp.nric IS NOT NULL AND lp.nric ~ $2)
            OR (lp.tel IS NOT NULL AND lp.tel ~ $3))
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

async function sweepTrainerProfile(cutoffISO: string): Promise<TableResult> {
  const candidates = await pool.query(
    `SELECT tp.user_id, tp.nric, tp.tel
     FROM trainer_profile tp
     JOIN app_user au ON au.id = tp.user_id
     WHERE au.created_at < $1
       AND ((tp.nric IS NOT NULL AND tp.nric ~ $2)
            OR (tp.tel IS NOT NULL AND tp.tel ~ $3))
     LIMIT $4`,
    [cutoffISO, NRIC_PG_REGEX, PHONE_PG_REGEX, SWEEP_LIMIT_PER_TABLE]
  );
  return await applyUpdates('trainer_profile', candidates.rows, async (row) => {
    const newNric = nricNeedsSanitising(row.nric) ? sanitiseNric(row.nric) : null;
    const newTel = phoneNeedsSanitising(row.tel) ? sanitisePhone(row.tel) : null;
    if (newNric == null && newTel == null) return false;
    await pool.query(
      `UPDATE trainer_profile
       SET nric = COALESCE($1, nric),
           tel  = COALESCE($2, tel)
       WHERE user_id = $3`,
      [newNric, newTel, row.user_id]
    );
    return true;
  });
}

async function sweepDaApplication(cutoffISO: string): Promise<TableResult> {
  const candidates = await pool.query(
    `SELECT id, trainee_id, trainee_phone
     FROM da_application
     WHERE created_at < $1
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

async function sweepCourseAttendance(cutoffISO: string): Promise<TableResult> {
  const candidates = await pool.query(
    `SELECT id, nric
     FROM course_attendance
     WHERE created_at < $1
       AND nric IS NOT NULL
       AND nric ~ $2
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

async function sweepEnrollment(cutoffISO: string): Promise<TableResult> {
  const candidates = await pool.query(
    `SELECT id, nric
     FROM enrollment
     WHERE created_at < $1
       AND nric IS NOT NULL
       AND nric ~ $2
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

async function sweepSsgEnrolments(cutoffISO: string): Promise<TableResult> {
  const candidates = await pool.query(
    `SELECT id, trainee_nric
     FROM ssg_enrolments
     WHERE imported_at < $1
       AND trainee_nric IS NOT NULL
       AND trainee_nric ~ $2
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
  const candidates = await pool.query(
    `SELECT id, individual_nric
     FROM ssg_claims
     WHERE imported_at < $1
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

  const sweepers: Array<(c: string) => Promise<TableResult>> = [
    sweepLearnerProfile,
    sweepTrainerProfile,
    sweepDaApplication,
    sweepCourseAttendance,
    sweepEnrollment,
    sweepSsgEnrolments,
    sweepSsgClaims,
  ];

  const results: TableResult[] = [];
  let totalScanned = 0;
  let totalUpdated = 0;

  for (const sweep of sweepers) {
    try {
      const r = await sweep(cutoffISO);
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
