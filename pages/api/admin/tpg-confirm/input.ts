/**
 * POST /api/admin/tpg-confirm/input
 *
 * Forwards an operator gesture to the browser a server-side run is driving.
 * Singpass cannot be automated, so the person who started the run has to reach
 * the login screen themselves: the panel shows them frames of the page and
 * sends their clicks and keystrokes here.
 *
 * Body: { jobId: string, kind: 'click' | 'type' | 'key', x?, y?, text?, key? }
 *
 * Coordinates are in PAGE space — the panel scales them from the rendered
 * image before sending, so the driver can apply them without knowing how large
 * the picture was on screen.
 */
import type { NextApiRequest, NextApiResponse } from 'next';
import { requireRole } from '@lib/auth/requireRole';
import { pushInput, getJob } from '@lib/tpg/jobStore';

/** Matches the viewport the driver opens for server runs. */
const MAX_X = 4096;
const MAX_Y = 4096;
const MAX_TEXT = 200;

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ success: false, error: 'Method Not Allowed' });
  }

  const user = await requireRole(req, res, ['admin', 'developer', 'trainingProvider']);
  if (!user) return; // requireRole already sent 401/403

  const jobId = typeof req.body?.jobId === 'string' ? req.body.jobId : '';
  if (!jobId) return res.status(400).json({ success: false, error: 'jobId is required' });

  const job = getJob(jobId);
  if (!job) return res.status(404).json({ success: false, error: 'Unknown job' });

  // Only accept gestures while the driver is actually asking for a person.
  // Outside that window the browser is mid-automation and a stray click could
  // land on a confirmation button.
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
    queued = pushInput(jobId, { kind: 'click', x, y });
  } else if (kind === 'type') {
    const text = String(req.body?.text ?? '');
    if (!text || text.length > MAX_TEXT) {
      return res.status(400).json({ success: false, error: `text must be 1-${MAX_TEXT} characters` });
    }
    queued = pushInput(jobId, { kind: 'type', text });
  } else if (kind === 'key') {
    const key = String(req.body?.key ?? '');
    if (!key || key.length > 20) {
      return res.status(400).json({ success: false, error: 'key is required' });
    }
    queued = pushInput(jobId, { kind: 'key', key });
  } else {
    return res.status(400).json({ success: false, error: "kind must be 'click', 'type' or 'key'" });
  }

  if (!queued) {
    return res.status(429).json({ success: false, error: 'Too many queued gestures — wait a moment.' });
  }

  return res.status(200).json({ success: true });
}
