/**
 * Shared helpers for the WSQ schedule sync (diff view + daily/weekly crons), so
 * they agree on: the MMS fetch, "today" in SGT, blocked-error detection, prior
 * failures, and flattening future schedules into sync items.
 */
import pool from './db';

export type MagentoSchedule = { raw?: string; course_start_date: string | null; course_end_date: string | null };
export type MagentoCourse = { course_code: string; course_title?: string; schedules: MagentoSchedule[] };
export type MagentoResponse = { courses: MagentoCourse[]; generated_at?: string; count?: number; store?: string };

// `raw` is the storefront's human label ("5/12/13/19/26 Sep 2026 (Sat/Sun)").
// It is the only source that states the individual teaching days — start/end
// alone cannot express a run taught on five scattered Saturdays.
export type SyncItem = { course_code: string; start_date: string; end_date: string; raw?: string };

/** Current date (YYYY-MM-DD) in Asia/Singapore — the single "today" for UI + crons. */
export function sgtToday(): string {
  return new Date(new Date().toLocaleString('en-US', { timeZone: 'Asia/Singapore' }))
    .toISOString().split('T')[0];
}

// A "blocked" failure = SSG rejected the run on eligibility grounds (course not
// approved for those dates / outside the support window). These are resolvable by
// an EXTERNAL approval process, so they're worth an occasional (weekly) retry.
// Any OTHER error is likely a submission bug on our side → needs dev debugging, not
// an automated retry. Mirrors BLOCKED_PATTERNS in WsqScheduleSyncView.tsx.
const BLOCKED_PATTERNS = ['not eligible', 'support period', 'course start date has to be between'];
export function isBlockedSyncError(msg: string | null | undefined): boolean {
  if (!msg) return false;
  const l = msg.toLowerCase();
  return BLOCKED_PATTERNS.some((p) => l.includes(p));
}

/** Fetch the WSQ course schedule from MMS (Tertiary Courses SG / Magento). */
export async function fetchMagentoSchedules(): Promise<MagentoResponse> {
  const r = await pool.query(
    `SELECT tertiary_courses_sg_url, tertiary_courses_sg_api_key, magento_backend_url
       FROM training_provider LIMIT 1`,
  );
  const baseUrl = r.rows[0]?.tertiary_courses_sg_url || r.rows[0]?.magento_backend_url || '';
  const apiKey = r.rows[0]?.tertiary_courses_sg_api_key || '';
  if (!baseUrl || !apiKey) {
    throw new Error('Tertiary Courses SG URL or API key is not configured (Company Settings → Integrations).');
  }
  const url = baseUrl.replace(/\/+$/, '') + '/courses/api_schedule';
  const resp = await fetch(url, { headers: { 'X-API-Key': apiKey, Accept: 'application/json' }, cache: 'no-store' });
  if (!resp.ok) {
    throw new Error(`Magento API ${resp.status}: ${(await resp.text()).slice(0, 200)}`);
  }
  return (await resp.json()) as MagentoResponse;
}

/** Flatten every FUTURE, parseable MMS schedule into a sync item (drops past-dated
 * — SSG rejects a past start date). */
export function futureScheduleItems(magento: MagentoResponse, today: string): SyncItem[] {
  const items: SyncItem[] = [];
  for (const c of magento.courses || []) {
    const code = (c.course_code ?? '').trim();
    if (!code) continue;
    for (const s of c.schedules || []) {
      const start = s.course_start_date?.slice(0, 10);
      const end = s.course_end_date?.slice(0, 10);
      if (!start || !end) continue;      // unparsed
      if (end < today) continue;          // already ended
      if (start < today) continue;        // already started (SSG rejects past start)
      items.push({ course_code: code, start_date: start, end_date: end, raw: s.raw });
    }
  }
  return items;
}

export type PriorFailure = { status: string; message: string; blocked: boolean };

/**
 * Most-recent failure per `${course_code}|${start_date}`, from wsq_sync_job.failures
 * across all jobs (oldest first so newer attempts overwrite older). Used to decide
 * which schedules the daily cron should SKIP and which the weekly cron should RETRY.
 */
export async function getPriorFailureMap(): Promise<Map<string, PriorFailure>> {
  const map = new Map<string, PriorFailure>();
  const r = await pool.query<{ failures: any }>(
    `SELECT failures FROM wsq_sync_job
      WHERE failures IS NOT NULL AND jsonb_array_length(failures) > 0
      ORDER BY started_at ASC`,
  ).catch(() => ({ rows: [] as { failures: any }[] }));
  for (const row of r.rows) {
    const failures = Array.isArray(row.failures) ? row.failures : [];
    for (const f of failures) {
      if (f?.course_code && f?.start_date) {
        const message = f.message || f.status || '';
        map.set(`${String(f.course_code).trim()}|${f.start_date}`, {
          status: f.status || 'error',
          message,
          blocked: isBlockedSyncError(message),
        });
      }
    }
  }
  return map;
}

// ── Cron run log ────────────────────────────────────────────────────────────
// One row per cron invocation (daily-fresh / weekly-blocked), so we can see when
// each ran and what it decided — including runs that DON'T start a wsq_sync_job
// (nothing to do / already running / MMS fetch error). Complements wsq_sync_job,
// which only records the per-item sync execution. Mirrors the trainer-invite log.

export interface WsqSyncCronLogEntry {
  cron: 'daily_fresh' | 'weekly_blocked';
  status: 'started' | 'nothing_to_do' | 'already_running' | 'error';
  considered?: number;
  skippedPreviouslyFailed?: number;
  mmsCourses?: number;
  jobId?: number | null;
  message?: string | null;
}

export async function ensureWsqSyncCronLogTable(): Promise<void> {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS wsq_sync_cron_log (
      id                        SERIAL PRIMARY KEY,
      created_at                TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      cron                      TEXT NOT NULL,
      status                    TEXT NOT NULL,
      considered                INTEGER,
      skipped_previously_failed INTEGER,
      mms_courses               INTEGER,
      job_id                    INTEGER,
      message                   TEXT
    )
  `);
  await pool.query(`CREATE INDEX IF NOT EXISTS wsq_sync_cron_log_created_idx ON wsq_sync_cron_log (created_at DESC)`);
  await pool.query(`CREATE INDEX IF NOT EXISTS wsq_sync_cron_log_cron_idx ON wsq_sync_cron_log (cron, created_at DESC)`);
}

/** Record a cron run. Never throws — logging must not break the cron. */
export async function logWsqSyncCronRun(entry: WsqSyncCronLogEntry): Promise<void> {
  try {
    await ensureWsqSyncCronLogTable();
    await pool.query(
      `INSERT INTO wsq_sync_cron_log
         (cron, status, considered, skipped_previously_failed, mms_courses, job_id, message)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [
        entry.cron, entry.status,
        entry.considered ?? null, entry.skippedPreviouslyFailed ?? null,
        entry.mmsCourses ?? null, entry.jobId ?? null, entry.message ?? null,
      ],
    );
  } catch (e) {
    console.error('[wsq-sync-cron-log] failed to write log row:', (e as Error)?.message);
  }
}
