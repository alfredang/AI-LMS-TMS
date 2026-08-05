/**
 * POST /api/admin/tpg-confirm/run
 *
 * Starts a TPGateway "confirm & fetch" job. Opens a headed Chromium on the
 * HOST running this server (local dev only — Singpass needs a display + human),
 * returns a jobId immediately; poll /api/admin/tpg-confirm/status for progress.
 *
 * Body: { dryRun?: boolean, max?: number }
 *   dryRun (default true) — find & check pending applications but DON'T confirm.
 *   max — cap how many applications to process (useful for a first test).
 */
import type { NextApiRequest, NextApiResponse } from 'next';
import { requireRole } from '@lib/auth/requireRole';
import { startTpgConfirmJob, queueTpgConfirmJob } from '@lib/tpg/confirmApplications';
import { getActiveJob } from '@lib/tpg/jobStore';

export const config = { maxDuration: 300 };

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ success: false, error: 'Method Not Allowed' });
  }

  const user = await requireRole(req, res, ['admin', 'developer', 'trainingProvider']);
  if (!user) return; // requireRole already sent 401/403

  // One run at a time — a second would fight the first for the Chromium profile
  // and Playwright would fail on the lock mid-run.
  const active = getActiveJob();
  if (active) {
    return res.status(409).json({
      success: false,
      jobId: active.id,
      error: 'A TPGateway run is already in progress. Wait for it to finish, or cancel it first.',
    });
  }

  const dryRun = req.body?.dryRun !== false; // default TRUE (safe)
  const rawMax = req.body?.max;
  const max =
    typeof rawMax === 'number' && Number.isFinite(rawMax) && rawMax > 0
      ? Math.floor(rawMax)
      : null;

  try {
    // Where the browser runs depends on where the request can reach TPGateway
    // from. This server drives Chromium fine, but the portal sits behind
    // CloudFront, which blocks datacentre IP ranges — the request is refused
    // before TPGateway ever sees it. So the deployed site QUEUES the run and an
    // agent on the office network drives it from an address the portal accepts,
    // reporting progress back into this same job. Locally we just run it here.
    const runsHere =
      process.env.NODE_ENV !== 'production' || process.env.TPG_SERVER_BROWSER === 'true';

    if (!runsHere) {
      const jobId = queueTpgConfirmJob({ dryRun, max });
      return res.status(200).json({
        success: true,
        jobId,
        dryRun,
        max,
        queued: true,
        message:
          'Queued — waiting for the office machine to pick it up. Progress appears here.',
      });
    }

    const jobId = startTpgConfirmJob({ dryRun, max });
    return res.status(200).json({ success: true, jobId, dryRun, max });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Failed to start job';
    return res.status(500).json({ success: false, error: msg });
  }
}
