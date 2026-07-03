import type { NextApiRequest, NextApiResponse } from 'next';
import { startWsqSyncJob } from '../admin/wsq-schedule-sync/run-sync';
import {
  fetchMagentoSchedules,
  futureScheduleItems,
  getPriorFailureMap,
  sgtToday,
  logWsqSyncCronRun,
} from '../../../lib/wsqScheduleSync';

/**
 * External API — Auto Sync WSQ Schedule to SSG (DAILY cron)
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * SCHEDULE: Daily (default 02:00 SGT). DISABLED by default — enable from the
 * Task Scheduler UI once the MMS feed is verified. PUBLISHES REAL COURSE RUNS.
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * Publishes FRESH missing course runs immediately from the MMS schedule. It does
 * NOT retry schedules that have failed before — a schedule that previously failed
 * on eligibility (not eligible / outside support period) is retried only by the
 * weekly cron (auto-retry-wsq-blocked); one that failed on any OTHER error is left
 * for a developer to investigate (retrying would just spam SSG and re-fail). Every
 * future schedule that has NOT failed is passed to the shared run-sync job, whose
 * per-item processor additionally skips runs that already exist.
 *
 * POST /api/external/auto-sync-wsq-schedule
 * Headers: x-api-key: <EXTERNAL_API_KEY_FOR_CLAWDBOT>
 */

export async function runAutoSyncWsqSchedule() {
  try {
    const today = sgtToday();
    const magento = await fetchMagentoSchedules();
    const mmsCourses = magento.courses?.length ?? 0;
    const all = futureScheduleItems(magento, today);

    // Skip any schedule that has failed before — daily is FRESH-only.
    const priorFailures = await getPriorFailureMap();
    const items = all.filter((it) => !priorFailures.has(`${it.course_code}|${it.start_date}`));
    const skippedPreviouslyFailed = all.length - items.length;

    if (items.length === 0) {
      await logWsqSyncCronRun({ cron: 'daily_fresh', status: 'nothing_to_do', considered: 0, skippedPreviouslyFailed, mmsCourses, message: 'No fresh schedules to sync.' });
      return { ok: true, started: false, message: 'No fresh schedules to sync.', considered: 0, skippedPreviouslyFailed };
    }

    const result = await startWsqSyncJob(items, 'cron');
    if (result.started) {
      console.log(`📅 [auto-sync-wsq-schedule] job ${result.jobId} — ${items.length} fresh schedules (skipped ${skippedPreviouslyFailed} previously-failed)`);
      await logWsqSyncCronRun({ cron: 'daily_fresh', status: 'started', considered: items.length, skippedPreviouslyFailed, mmsCourses, jobId: result.jobId });
      return { ok: true, started: true, jobId: result.jobId, considered: items.length, skippedPreviouslyFailed };
    }
    if (result.reason === 'already_running') {
      await logWsqSyncCronRun({ cron: 'daily_fresh', status: 'already_running', considered: items.length, skippedPreviouslyFailed, mmsCourses, jobId: result.jobId, message: 'A WSQ sync is already running.' });
      return { ok: true, started: false, message: 'A WSQ sync is already running — skipping this cron tick.', jobId: result.jobId, considered: items.length, skippedPreviouslyFailed };
    }
    throw new Error(result.message); // not_configured → caught & logged below; scheduler records failure
  } catch (err: any) {
    await logWsqSyncCronRun({ cron: 'daily_fresh', status: 'error', message: err?.message || String(err) });
    throw err;
  }
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ success: false, error: 'Method not allowed' });
  }

  const apiKey = req.headers['x-api-key'];
  const validKey = process.env.EXTERNAL_API_KEY_FOR_CLAWDBOT;
  if (!validKey) return res.status(500).json({ success: false, error: 'API key not configured on server' });
  if (!apiKey || apiKey !== validKey) return res.status(401).json({ success: false, error: 'Invalid or missing API key' });

  try {
    const result = await runAutoSyncWsqSchedule();
    return res.status(result.ok ? 200 : 500).json({ success: result.ok, ...result });
  } catch (err: any) {
    console.error('[external/auto-sync-wsq-schedule]', err?.message || err);
    return res.status(500).json({ success: false, error: err?.message || 'Internal server error' });
  }
}
