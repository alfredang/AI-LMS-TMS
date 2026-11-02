import { withServiceAuth } from '@lib/auth/withAuth';
import type { NextApiRequest, NextApiResponse } from 'next';
import { runDuplicateCourseRunCheck } from '../../../lib/ssg/duplicateRunDetector';

/**
 * External API — Nightly duplicate course-run check (READ ONLY on SSG)
 *
 * POST /api/external/detect-duplicate-course-runs
 * Headers: x-api-key: <EXTERNAL_API_KEY_FOR_CLAWDBOT>
 *
 * Lists every upcoming class date that SSG holds more than one run for, across
 * every TGS course code the LMS knows, and emails the list. Changes nothing on
 * SSG. Scheduled daily at 04:30 SGT (task detect_duplicate_course_runs); takes
 * ~10-15 minutes because SSG is paced to stay under its rate limit.
 */
async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') return res.status(405).json({ success: false, error: 'Method not allowed' });
  try {
    const result = await runDuplicateCourseRunCheck();
    return res.status(200).json({ success: true, ...result });
  } catch (err: any) {
    console.error('[external/detect-duplicate-course-runs]', err?.message || err);
    return res.status(500).json({ success: false, error: err?.message || 'Internal server error' });
  }
}

export default withServiceAuth(handler);
