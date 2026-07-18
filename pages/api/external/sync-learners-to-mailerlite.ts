import type { NextApiRequest, NextApiResponse } from 'next';
import pool from '../../../lib/db';

/**
 * External API — Sync Learner Emails to MailerLite
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * SCHEDULE: Default daily 03:00 SGT (configurable from Task Scheduler).
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * FLOW:
 *   1. Tenant gate: requires MAILERLITE_API_KEY and MAILERLITE_GROUP_ID env
 *      vars. Either missing → single 'skipped' log row + return (other
 *      tenants without a MailerLite account are unaffected).
 *   2. Select active learner emails (role = Learner, account_status = active)
 *      that are NOT yet recorded in mailerlite_synced_email.
 *      Government addresses (*gov.sg) are ALWAYS excluded.
 *   3. Upsert each email into MailerLite via the batch endpoint
 *      (POST /api/batch, 50 subscribers per request) with the configured
 *      group id, retrying on 429 rate limits.
 *   4. Record each successfully submitted email in mailerlite_synced_email so
 *      subsequent runs only push NEW learners. One summary row per run in
 *      mailerlite_sync_log.
 *
 * Idempotent — MailerLite's POST /api/subscribers is an upsert, and the
 * mailerlite_synced_email tracking table keeps re-runs cheap.
 *
 * POST /api/external/sync-learners-to-mailerlite
 * Headers: x-api-key: <EXTERNAL_API_KEY_FOR_CLAWDBOT>
 */

const MAILERLITE_API_BASE = 'https://connect.mailerlite.com/api';
const BATCH_SIZE = 50;
const BATCH_PAUSE_MS = 1200;
const RATE_LIMIT_PAUSE_MS = 5000;
const MAX_RATE_LIMIT_RETRIES = 10;

interface SyncSummary {
  runId: string;
  enabled: boolean;
  totalCandidates: number;
  submitted: number;
  failed: number;
  status: 'success' | 'error' | 'skipped';
  message: string | null;
}

// ── Tables ───────────────────────────────────────────────────────────────────

async function ensureTables() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS mailerlite_sync_log (
      id               SERIAL PRIMARY KEY,
      run_id           TEXT NOT NULL,
      created_at       TIMESTAMPTZ DEFAULT NOW(),
      total_candidates INTEGER NOT NULL DEFAULT 0,
      submitted_count  INTEGER NOT NULL DEFAULT 0,
      error_count      INTEGER NOT NULL DEFAULT 0,
      status           TEXT NOT NULL,
      message          TEXT
    )
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS mailerlite_synced_email (
      email     TEXT PRIMARY KEY,
      user_id   UUID,
      run_id    TEXT,
      status    TEXT NOT NULL DEFAULT 'synced',
      synced_at TIMESTAMPTZ DEFAULT NOW()
    )
  `);
  await pool.query(`ALTER TABLE mailerlite_synced_email ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'synced'`);
  await pool.query(
    `CREATE INDEX IF NOT EXISTS idx_mailerlite_sync_log_run
     ON mailerlite_sync_log(run_id, created_at DESC)`
  );
}

async function insertLogRow(summary: SyncSummary) {
  try {
    await pool.query(
      `INSERT INTO mailerlite_sync_log
         (run_id, total_candidates, submitted_count, error_count, status, message)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [summary.runId, summary.totalCandidates, summary.submitted, summary.failed, summary.status, summary.message]
    );
  } catch (err) {
    // Logging never aborts the sync.
    console.error('❌ [mailerlite-sync] insertLogRow failed:', err);
  }
}

// ── MailerLite batch upsert ──────────────────────────────────────────────────

interface Candidate {
  email: string;
  user_id: string;
}

/**
 * Upserts one batch (≤50) of subscribers into the configured group.
 * Returns the emails that MailerLite accepted (2xx per-item response).
 */
async function pushBatch(
  apiKey: string,
  groupId: string,
  batch: Candidate[]
): Promise<{ accepted: Candidate[]; rejected: Array<{ email: string; code: number }> }> {
  const body = {
    requests: batch.map(c => ({
      method: 'POST',
      path: 'api/subscribers',
      body: { email: c.email, groups: [groupId] },
    })),
  };

  for (let attempt = 0; attempt <= MAX_RATE_LIMIT_RETRIES; attempt++) {
    const res = await fetch(`${MAILERLITE_API_BASE}/batch`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    });

    if (res.status === 429) {
      await new Promise(r => setTimeout(r, RATE_LIMIT_PAUSE_MS));
      continue;
    }

    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new Error(`MailerLite batch HTTP ${res.status}: ${text.slice(0, 200)}`);
    }

    const data = await res.json();
    const accepted: Candidate[] = [];
    const rejected: Array<{ email: string; code: number }> = [];
    (data.responses || []).forEach((resp: { code: number }, i: number) => {
      if (resp.code >= 200 && resp.code < 300) accepted.push(batch[i]);
      else rejected.push({ email: batch[i].email, code: resp.code });
    });
    return { accepted, rejected };
  }

  throw new Error('MailerLite rate limit: retries exhausted');
}

// ── Global in-flight lock ─────────────────────────────────────────────────────
const g = globalThis as unknown as { __mailerliteSyncRunning?: boolean };
if (g.__mailerliteSyncRunning === undefined) g.__mailerliteSyncRunning = false;

// ── Main runner ──────────────────────────────────────────────────────────────

export async function runAutomation(): Promise<SyncSummary> {
  if (g.__mailerliteSyncRunning) {
    console.warn('[mailerlite-sync] Another run is already in progress — skipping');
    return { runId: '', enabled: false, totalCandidates: 0, submitted: 0, failed: 0, status: 'skipped', message: 'already running' };
  }
  g.__mailerliteSyncRunning = true;
  try {
    return await _runInner();
  } finally {
    g.__mailerliteSyncRunning = false;
  }
}

async function _runInner(): Promise<SyncSummary> {
  await ensureTables();

  const runId = `mailerlite_${Date.now()}`;
  const apiKey = process.env.MAILERLITE_API_KEY;
  const groupId = process.env.MAILERLITE_GROUP_ID;

  if (!apiKey || !groupId) {
    const summary: SyncSummary = {
      runId,
      enabled: false,
      totalCandidates: 0,
      submitted: 0,
      failed: 0,
      status: 'skipped',
      message: 'MAILERLITE_API_KEY / MAILERLITE_GROUP_ID not configured for this tenant',
    };
    await insertLogRow(summary);
    console.log(`📧 [mailerlite-sync] ${runId} skipped — MailerLite not configured`);
    return summary;
  }

  // New learner emails only: active learner accounts, never *gov.sg,
  // and not already recorded as synced.
  const candidatesRes = await pool.query<Candidate>(
    `SELECT DISTINCT lower(u.email) AS email, u.id AS user_id
     FROM app_user u
     JOIN user_role_map r ON r.user_id = u.id AND r.role = 'Learner'
     WHERE u.account_status = 'active'
       AND u.email NOT ILIKE '%gov.sg'
       AND lower(u.email) NOT IN (SELECT email FROM mailerlite_synced_email)
     ORDER BY email`
  );
  const candidates = candidatesRes.rows;

  console.log(`📧 [mailerlite-sync] ${runId} starting — ${candidates.length} new learner email(s)`);

  let submitted = 0;
  let failed = 0;
  let firstError: string | null = null;

  for (let i = 0; i < candidates.length; i += BATCH_SIZE) {
    const batch = candidates.slice(i, i + BATCH_SIZE);
    try {
      const { accepted, rejected } = await pushBatch(apiKey, groupId, batch);
      submitted += accepted.length;
      failed += rejected.length;
      if (rejected.length > 0 && !firstError) {
        firstError = `MailerLite rejected ${rejected[0].email} (HTTP ${rejected[0].code})`;
      }
      for (const c of accepted) {
        await pool.query(
          `INSERT INTO mailerlite_synced_email (email, user_id, run_id, status)
           VALUES ($1, $2, $3, 'synced')
           ON CONFLICT (email) DO NOTHING`,
          [c.email, c.user_id, runId]
        );
      }
      // Per-item 4xx rejects (e.g. malformed address) are permanent — record
      // them so they are not retried and re-flagged on every daily run.
      // 5xx / transport errors are NOT recorded and retry next run.
      for (const r of rejected) {
        if (r.code >= 400 && r.code < 500) {
          await pool.query(
            `INSERT INTO mailerlite_synced_email (email, run_id, status)
             VALUES ($1, $2, $3)
             ON CONFLICT (email) DO NOTHING`,
            [r.email, runId, `rejected:${r.code}`]
          );
        }
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`❌ [mailerlite-sync] batch ${i / BATCH_SIZE + 1} failed:`, msg);
      failed += batch.length;
      if (!firstError) firstError = msg;
    }
    if (i + BATCH_SIZE < candidates.length) {
      await new Promise(r => setTimeout(r, BATCH_PAUSE_MS));
    }
  }

  const summary: SyncSummary = {
    runId,
    enabled: true,
    totalCandidates: candidates.length,
    submitted,
    failed,
    status: firstError ? 'error' : 'success',
    message: firstError,
  };
  await insertLogRow(summary);

  console.log(`📧 [mailerlite-sync] ${runId} done — submitted=${submitted} failed=${failed}`);
  return summary;
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
    console.error('❌ sync-learners-to-mailerlite error:', err);
    return res.status(500).json({
      success: false,
      error: err instanceof Error ? err.message : 'Internal server error',
    });
  }
}
