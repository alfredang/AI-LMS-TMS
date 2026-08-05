/**
 * POST /api/admin/tpg-confirm/report
 *
 * The office agent's only way to write progress back. Everything the panel
 * renders — phase, activity lines, the sign-in screen, per-application results,
 * and finally the scraped rows — arrives through here, so the UI keeps polling
 * /status exactly as it does for a local run and needs no idea where the
 * browser actually is.
 *
 * Body: { jobId, patch?, log?, app?, screen?, needsOperator? }
 *
 * Deliberately narrow: an agent may only report on a job that already exists
 * here, and may only set the fields below. It cannot create jobs, and it cannot
 * write arbitrary keys into one.
 */
import type { NextApiRequest, NextApiResponse } from 'next';
import { getAuthedUser } from '@lib/auth/requireRole';
import { getJob, patchJob, pushLog, upsertApp } from '@lib/tpg/jobStore';
import type { TpgJob } from '@lib/tpg/jobStore';

/** Only these may be set by an agent. */
const ALLOWED_PATCH_KEYS: (keyof TpgJob)[] = [
  'phase',
  'message',
  'total',
  'found',
  'rows',
  'error',
  'screenshot',
  'needsOperator',
  'screen',
];

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ success: false, error: 'Method Not Allowed' });
  }

  const user = await getAuthedUser(req);
  if (!user) return res.status(401).json({ success: false, error: 'Not authenticated' });

  const jobId = typeof req.body?.jobId === 'string' ? req.body.jobId : '';
  if (!jobId) return res.status(400).json({ success: false, error: 'jobId is required' });

  const job = getJob(jobId);
  if (!job) return res.status(404).json({ success: false, error: 'Unknown job' });

  const rawPatch = req.body?.patch;
  if (rawPatch && typeof rawPatch === 'object') {
    const patch: Record<string, unknown> = {};
    for (const key of ALLOWED_PATCH_KEYS) {
      if (key in rawPatch) patch[key] = (rawPatch as Record<string, unknown>)[key];
    }
    if (Object.keys(patch).length > 0) patchJob(jobId, patch as Partial<TpgJob>);
  }

  const line = req.body?.log;
  if (typeof line === 'string' && line.trim()) pushLog(jobId, line.slice(0, 300));

  const app = req.body?.app;
  if (app && typeof app === 'object' && typeof app.id === 'string') {
    upsertApp(jobId, {
      id: app.id,
      name: typeof app.name === 'string' ? app.name : undefined,
      status: app.status,
      reason: typeof app.reason === 'string' ? app.reason : undefined,
    });
  }

  // Hand back the control flags the agent needs so a stop or an approval
  // reaches it on its next report rather than waiting for a separate poll.
  return res.status(200).json({
    success: true,
    cancelRequested: job.cancelRequested,
    approved: job.approved,
  });
}
