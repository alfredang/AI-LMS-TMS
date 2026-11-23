import { withAuth, AuthedApiRequest } from '@lib/auth/withAuth';
import { requireCourseRunTrainer } from '@lib/auth/courseRunAccess';
import type { NextApiRequest, NextApiResponse } from 'next';
import { getSessionCheckinToken } from '../../../lib/attendance/checkin';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * GET ?sessionId=<course_session.id> → { path: '/checkin/<token>' }
 * The link behind the Take Attendance QR of one session (E-Attendance page). Only the class's
 * assigned trainers and staff may fetch it. The token is created on first use and then stays the
 * same, so a printed or projected QR keeps working.
 */
async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') return res.status(405).json({ success: false, error: 'Method not allowed' });
  const sessionId = String(req.query.sessionId || '').trim();
  if (!UUID_RE.test(sessionId)) return res.status(400).json({ success: false, error: 'sessionId is required' });
  try {
    const t = await getSessionCheckinToken(sessionId);
    if (!t) return res.status(404).json({ success: false, error: 'Session not found' });
    if (!(await requireCourseRunTrainer((req as AuthedApiRequest).authUser!, res, t.courseRunId))) return;
    return res.status(200).json({ success: true, path: `/checkin/${t.token}` });
  } catch (err: any) {
    console.error('[session-checkin-link] failed:', err?.message);
    return res.status(500).json({ success: false, error: 'Could not create the check-in link' });
  }
}

export default withAuth(handler, { roles: ['admin', 'trainingProvider', 'developer', 'trainer'] });
