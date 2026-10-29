import { withAuth } from '@lib/auth/withAuth';
import type { NextApiRequest, NextApiResponse } from 'next';

/**
 * POST /api/admin/wsq-schedule-sync/submit-to-ssg — RETIRED (28 Oct 2026).
 *
 * This was the browser-driven batch publisher, replaced by run-sync (server-side
 * jobs) in June 2026; nothing in the LMS calls it any more. It kept its own copy
 * of the publish + duplicate-check code, so every guard fix had to be made twice
 * and a missed copy is exactly how duplicates get through. It now publishes
 * nothing. Use POST /api/admin/wsq-schedule-sync/run-sync instead, which publishes
 * under the shared per-course lock and fresh SSG duplicate check.
 */
async function handler(req: NextApiRequest, res: NextApiResponse) {
  res.setHeader('Allow', ['POST']);
  return res.status(410).json({
    error: 'This endpoint is retired and publishes nothing.',
    use_instead: 'POST /api/admin/wsq-schedule-sync/run-sync',
  });
}

export default withAuth(handler, { roles: ['admin', 'trainingProvider', 'developer'] });
