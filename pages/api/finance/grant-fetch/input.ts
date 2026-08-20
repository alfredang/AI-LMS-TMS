/**
 * POST /api/finance/grant-fetch/input
 *
 * Forwards an operator gesture to the headless browser a "Fetch from
 * TPGateway" run is driving. Singpass cannot be automated, so the person who
 * started the run reaches the login screen themselves: the panel shows them
 * live frames of the page and sends their clicks/keystrokes here.
 *
 * Body: { jobId: string, kind: 'click' | 'type' | 'key', x?, y?, text?, key? }
 *
 * Coordinates are in PAGE space — the panel scales them from the rendered
 * image before sending, so the driver can apply them without knowing how
 * large the picture was on screen.
 */
import { withAuth } from '@lib/auth/withAuth';
import type { NextApiRequest, NextApiResponse } from 'next';
import { requireFinanceOrAdmin } from '@/lib/services/grantImport/requireFinanceOrAdmin';
import { pushGrantFetchInput, getGrantFetchJob } from '@/lib/tpg/grantFetchJobStore';

/** Matches the viewport the driver opens (SCREEN_W/SCREEN_H in fetchGrantDisbursements.ts). */
const MAX_X = 4096;
const MAX_Y = 4096;
const MAX_TEXT = 200;

async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', ['POST']);
    return res.status(405).json({ success: false, error: 'Method not allowed' });
  }

  try {
    await requireFinanceOrAdmin(req);

    const jobId = typeof req.body?.jobId === 'string' ? req.body.jobId : '';
    if (!jobId) return res.status(400).json({ success: false, error: 'jobId is required' });

    const job = getGrantFetchJob(jobId);
    if (!job) return res.status(404).json({ success: false, error: 'Unknown job' });

    // Only accept gestures while the driver is actually asking for a person —
    // outside that window the browser is mid-automation and a stray click
    // could land somewhere unintended.
    if (!job.needsOperator) {
      return res.status(409).json({ success: false, error: 'This run is not waiting for input right now.' });
    }

    const kind = req.body?.kind;
    let queued = false;

    if (kind === 'click') {
      const x = Number(req.body?.x);
      const y = Number(req.body?.y);
      if (!Number.isFinite(x) || !Number.isFinite(y) || x < 0 || y < 0 || x > MAX_X || y > MAX_Y) {
        return res.status(400).json({ success: false, error: 'x and y must be sane page coordinates' });
      }
      queued = pushGrantFetchInput(jobId, { kind: 'click', x, y });
    } else if (kind === 'type') {
      const text = String(req.body?.text ?? '');
      if (!text || text.length > MAX_TEXT) {
        return res.status(400).json({ success: false, error: `text must be 1-${MAX_TEXT} characters` });
      }
      queued = pushGrantFetchInput(jobId, { kind: 'type', text });
    } else if (kind === 'key') {
      const key = String(req.body?.key ?? '');
      if (!key || key.length > 20) {
        return res.status(400).json({ success: false, error: 'key is required' });
      }
      queued = pushGrantFetchInput(jobId, { kind: 'key', key });
    } else {
      return res.status(400).json({ success: false, error: "kind must be 'click', 'type' or 'key'" });
    }

    if (!queued) {
      return res.status(429).json({ success: false, error: 'Too many queued gestures — wait a moment.' });
    }

    return res.status(200).json({ success: true });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : 'Internal server error';
    return res.status(500).json({ success: false, error: msg });
  }
}

export default withAuth(handler, { roles: ['admin', 'trainingProvider', 'finance'] });
