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
 * External API — Retry Blocked WSQ Schedules (WEEKLY cron)
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * SCHEDULE: Weekly, Sunday off-peak (default 04:00 SGT). DISABLED by default.
 * PUBLISHES REAL COURSE RUNS.
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * Retries ONLY future schedules whose last failure was an ELIGIBILITY block
 * ("not eligible" / "outside support period" / "course start date has to be
 * between …") — these get resolved by an external course-approval process, so a
 * once-a-week retry (off-peak, to be gentle on the SSG endpoint) is worthwhile.
 *
 * It deliberately does NOT retry schedules that failed on any other error — those
 * are likely submission bugs on our side and need a developer to fix first;
 * retrying would just re-fail and spam SSG. (Those are re-tried manually from the
 * WSQ Schedule Sync view after a fix.) run-sync additionally skips runs that were
 * created in the meantime.
 *
 * POST /api/external/auto-retry-wsq-blocked
 * Headers: x-api-key: <EXTERNAL_API_KEY_FOR_CLAWDBOT>
 */

export async function runAutoRetryWsqBlocked() {
  try {
    const today = sgtToday();
    const magento = await fetchMagentoSchedules();
    const mmsCourses = magento.courses?.length ?? 0;
    const all = futureScheduleItems(magento, today);

    const priorFailures = await getPriorFailureMap();
    const items = all.filter((it) => {
      const f = priorFailures.get(`${it.course_code}|${it.start_date}`);
      return !!f && f.blocked; // only eligibility-blocked failures
    });

    if (items.length === 0) {
      await logWsqSyncCronRun({ cron: 'weekly_blocked', status: 'nothing_to_do', considered: 0, mmsCourses, message: 'No eligibility-blocked schedules to retry.' });
      return { ok: true, started: false, message: 'No eligibility-blocked schedules to retry.', considered: 0 };
    }

    const result = await startWsqSyncJob(items, 'cron');
    if (result.started) {
      console.log(`📅 [auto-retry-wsq-blocked] job ${result.jobId} — retrying ${items.length} eligibility-blocked schedules`);
      await logWsqSyncCronRun({ cron: 'weekly_blocked', status: 'started', considered: items.length, mmsCourses, jobId: result.jobId });
      return { ok: true, started: true, jobId: result.jobId, considered: items.length };
    }
    if (result.reason === 'already_running') {
      await logWsqSyncCronRun({ cron: 'weekly_blocked', status: 'already_running', considered: items.length, mmsCourses, jobId: result.jobId, message: 'A WSQ sync is already running.' });
      return { ok: true, started: false, message: 'A WSQ sync is already running — skipping this cron tick.', jobId: result.jobId, considered: items.length };
    }
    throw new Error(result.message); // not_configured → caught & logged below; scheduler records failure
  } catch (err: any) {
    await logWsqSyncCronRun({ cron: 'weekly_blocked', status: 'error', message: err?.message || String(err) });
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
    const result = await runAutoRetryWsqBlocked();
    return res.status(result.ok ? 200 : 500).json({ success: result.ok, ...result });
  } catch (err: any) {
    console.error('[external/auto-retry-wsq-blocked]', err?.message || err);
    return res.status(500).json({ success: false, error: err?.message || 'Internal server error' });
  }
}
