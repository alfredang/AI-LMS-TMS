import { withAuth } from '@lib/auth/withAuth';
import type { NextApiRequest, NextApiResponse } from 'next';
import { listRunAttendees, patchRunAttendee } from '../../../lib/calendar/runAttendees';

/**
 * Calendar attendees — view + adjust the Google Calendar attendees on a course run's event(s).
 *
 *   GET  ?courseRunId=<uuid|ssgId>        → { success, status, writesEnabled, events: [...] }
 *   POST { courseRunId, email, action }   → add/remove ONE attendee (action: 'add' | 'remove')
 *
 * Reads are always allowed (read-only client). Writes are env-guarded (calendarWritesAllowed):
 * blocked on local/dev unless ENABLE_CALENDAR_WRITES=true — the POST returns status:'skipped'
 * with a reason in that case so the UI can explain why. All writes use sendUpdates:'none'; the
 * confirmation step lives in the UI (no silent changes).
 */
async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method === 'GET') {
    const courseRunId = String(req.query.courseRunId || '').trim();
    if (!courseRunId) return res.status(400).json({ success: false, error: 'courseRunId is required' });
    try {
      const result = await listRunAttendees(courseRunId);
      return res.status(200).json({ success: true, ...result });
    } catch (err: any) {
      return res.status(500).json({ success: false, error: err?.message || 'Failed to load attendees' });
    }
  }

  if (req.method === 'POST') {
    const { courseRunId, email, action } = (req.body || {}) as { courseRunId?: string; email?: string; action?: string };
    if (!courseRunId) return res.status(400).json({ success: false, error: 'courseRunId is required' });
    if (!email || !email.trim()) return res.status(400).json({ success: false, error: 'email is required' });
    if (action !== 'add' && action !== 'remove') return res.status(400).json({ success: false, error: "action must be 'add' or 'remove'" });
    try {
      const result = await patchRunAttendee(String(courseRunId), String(email), action);
      return res.status(200).json({ success: true, ...result });
    } catch (err: any) {
      return res.status(500).json({ success: false, error: err?.message || 'Failed to update attendee' });
    }
  }

  return res.status(405).json({ success: false, error: 'Method not allowed' });
}

export default withAuth(handler, { roles: ['admin', 'trainingProvider', 'developer'] });
