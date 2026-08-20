/**
 * GET /api/finance/grant-fetch/next
 *
 * Polled by the office agent (scripts/tpg-grant-fetch-agent.mjs). Returns the
 * oldest run waiting to be driven, claiming it in the same call so two agents
 * cannot pick up the same one.
 *
 * Why an agent at all: TPGateway sits behind CloudFront, which blocks
 * datacentre IP ranges — the server can drive Chromium perfectly well, but its
 * requests are refused before the portal sees them, so the browser has to run
 * from the office network instead. The live site still owns the job; the agent
 * only borrows it. Mirrors pages/api/admin/tpg-confirm/next.ts exactly, kept as
 * its own route since this is a deliberately separate job store/feature.
 *
 * Also returns any gestures the operator has clicked in the panel since the
 * last poll, so the agent can apply them to its browser.
 *
 * Auth: service key (the agent is a machine, not a signed-in person). Falls
 * back to the normal role check so it can be exercised by an admin while
 * debugging.
 */
import type { NextApiRequest, NextApiResponse } from 'next';
import { getAuthedUser } from '@lib/auth/requireRole';
import { claimQueuedGrantFetchJob, getGrantFetchJob, drainGrantFetchInput, markGrantFetchAgentSeen } from '@lib/tpg/grantFetchJobStore';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') {
    return res.status(405).json({ success: false, error: 'Method Not Allowed' });
  }

  const user = await getAuthedUser(req);
  if (!user) return res.status(401).json({ success: false, error: 'Not authenticated' });

  // Every poll is proof the agent is alive — that is what the live site shows
  // staff so they know whether clicking will actually do anything.
  markGrantFetchAgentSeen();

  // An agent that is mid-run asks about its own job rather than claiming a new
  // one — that is how it collects the operator's clicks and any cancel request.
  const activeId = typeof req.query.jobId === 'string' ? req.query.jobId : '';
  if (activeId) {
    const job = getGrantFetchJob(activeId);
    if (!job) return res.status(404).json({ success: false, error: 'Unknown job' });
    return res.status(200).json({
      success: true,
      job: { id: job.id, phase: job.phase, cancelRequested: job.cancelRequested },
      input: drainGrantFetchInput(activeId),
    });
  }

  const claimed = claimQueuedGrantFetchJob();
  if (!claimed) return res.status(200).json({ success: true, job: null });

  return res.status(200).json({
    success: true,
    job: { id: claimed.id, startDate: claimed.startDate, actorUserId: claimed.actorUserId },
  });
}
