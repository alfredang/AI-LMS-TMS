import type { NextApiRequest, NextApiResponse } from 'next';
import { reconcileEnrolmentIdsForUpcomingRuns } from '../../../lib/ssg/reconcileEnrolmentIds';

/**
 * SSG → LMS enrolment PULL (nightly backstop).
 * Reconciles local `enrollment.enrolment_id` against SSG's authoritative state for current/
 * upcoming runs — linking the live ref, clearing stale ones. enrolment_id ONLY: never adds or
 * removes learners, never changes roster status. See lib/ssg/reconcileEnrolmentIds.ts.
 *
 * POST  header x-api-key: <EXTERNAL_API_KEY_FOR_CLAWDBOT>  (scheduler calls pass x-internal-scheduler)
 */
export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ success: false, error: 'Method not allowed' });
  }
  const apiKey = req.headers['x-api-key'] || req.query.apiKey;
  const validKey = process.env.EXTERNAL_API_KEY_FOR_CLAWDBOT;
  if (!validKey) return res.status(500).json({ success: false, error: 'API key not configured on server' });
  if (apiKey !== validKey && !req.headers['x-internal-scheduler']) {
    return res.status(401).json({ success: false, error: 'Invalid or missing API key' });
  }

  try {
    const result = await reconcileEnrolmentIdsForUpcomingRuns();
    return res.status(200).json({ success: true, ...result });
  } catch (err) {
    console.error('❌ sync-enrolment-ids error:', err);
    return res.status(500).json({ success: false, error: err instanceof Error ? err.message : 'Internal server error' });
  }
}
