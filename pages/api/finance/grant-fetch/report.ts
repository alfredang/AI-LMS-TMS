/**
 * POST /api/finance/grant-fetch/report
 *
 * The office agent's only way to write progress back. Everything the panel
 * renders — phase, activity lines, the sign-in screen, and finally the parsed
 * result — arrives through here, so the UI keeps polling /status exactly as it
 * does for a local run and needs no idea where the browser actually is.
 * Mirrors pages/api/admin/tpg-confirm/report.ts.
 *
 * Body: { jobId, patch?, log? }
 *
 * Deliberately narrow: an agent may only report on a job that already exists
 * here, and may only set the fields below. It cannot create jobs, and it cannot
 * write arbitrary keys into one.
 */
import type { NextApiRequest, NextApiResponse } from 'next';
import { getAuthedUser } from '@lib/auth/requireRole';
import { getGrantFetchJob, patchGrantFetchJob, pushGrantFetchLog } from '@lib/tpg/grantFetchJobStore';
import type { GrantFetchJob } from '@lib/tpg/grantFetchJobStore';

// The final patch carries the whole parsed/matched result (every disbursement row,
// including its raw source JSON, plus per-enrolment impact) — for a real TPGateway
// export this routinely exceeds Next's default 1mb API body limit, which silently
// 413s the request. The agent then retries the same oversized payload forever and
// the job never reaches the browser, even though parsing succeeded locally.
export const config = { api: { bodyParser: { sizeLimit: '20mb' } } };

/** Only these may be set by an agent. */
const ALLOWED_PATCH_KEYS: (keyof GrantFetchJob)[] = [
  'phase',
  'message',
  'rowsFound',
  'result',
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

  const job = getGrantFetchJob(jobId);
  if (!job) return res.status(404).json({ success: false, error: 'Unknown job' });

  const rawPatch = req.body?.patch;
  if (rawPatch && typeof rawPatch === 'object') {
    const patch: Record<string, unknown> = {};
    for (const key of ALLOWED_PATCH_KEYS) {
      if (key in rawPatch) patch[key] = (rawPatch as Record<string, unknown>)[key];
    }
    if (Object.keys(patch).length > 0) patchGrantFetchJob(jobId, patch as Partial<GrantFetchJob>);
  }

  const line = req.body?.log;
  if (typeof line === 'string' && line.trim()) pushGrantFetchLog(jobId, line.slice(0, 300));

  // Hand back the control flag the agent needs so a stop reaches it on its next
  // report rather than waiting for a separate poll.
  return res.status(200).json({ success: true, cancelRequested: job.cancelRequested });
}
