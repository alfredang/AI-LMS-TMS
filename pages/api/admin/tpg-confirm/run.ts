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
import { startTpgConfirmJob } from '@lib/tpg/confirmApplications';
import { getActiveJob } from '@lib/tpg/jobStore';

export const config = { maxDuration: 300 };

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ success: false, error: 'Method Not Allowed' });
  }

  const user = await requireRole(req, res, ['admin', 'developer', 'trainingProvider']);
  if (!user) return; // requireRole already sent 401/403

  // A headed Singpass browser needs a display. On a dev machine that is the
  // operator's own desktop. On the server it requires the image to ship
  // Chromium + Xvfb + a way to view the screen, so it stays refused until that
  // image is deployed and TPG_SERVER_BROWSER is switched on.
  if (process.env.NODE_ENV === 'production' && process.env.TPG_SERVER_BROWSER !== 'true') {
    return res.status(400).json({
      success: false,
      error:
        'TPGateway confirmation runs a browser for Singpass, which this server ' +
        'is not yet set up to display. Run it from the LMS on your own computer, ' +
        'or ask an administrator to enable TPG_SERVER_BROWSER.',
    });
  }

  // One run at a time — a second would fight the first for the persistent
  // Chromium profile and Playwright would fail on the lock mid-run.
  const active = getActiveJob();
  if (active) {
    return res.status(409).json({
      success: false,
      jobId: active.id,
      error: 'A TPGateway run is already in progress. Wait for it to finish, or cancel it first.',
    });
  }

  try {
    const dryRun = req.body?.dryRun !== false; // default TRUE (safe)
    const rawMax = req.body?.max;
    const max =
      typeof rawMax === 'number' && Number.isFinite(rawMax) && rawMax > 0
        ? Math.floor(rawMax)
        : null;

    const jobId = startTpgConfirmJob({ dryRun, max });
    return res.status(200).json({ success: true, jobId, dryRun, max });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Failed to start job';
    return res.status(500).json({ success: false, error: msg });
  }
}
