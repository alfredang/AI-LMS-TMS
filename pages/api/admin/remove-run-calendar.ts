import type { NextApiRequest, NextApiResponse } from 'next';
import { removeClassCalendarEvents } from '../../../lib/calendar/ensureClassCalendarEvent';

/**
 * POST /api/admin/remove-run-calendar
 * Body: { courseRunId }  — course_run UUID or SSG run id.
 *
 * Removes ALL Google Calendar events for a run (mapped ids + live-matched by run id).
 * Manual, admin-initiated cleanup — used to clear a SOURCE run's now-orphaned events
 * after a move-to-run was done with calendar sync OFF (the "vacated run" case).
 * Gated by the calendar write guard; best-effort.
 */
export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') return res.status(405).json({ success: false, error: 'Method not allowed' });
  const courseRunId = String((req.body || {}).courseRunId || '').trim();
  if (!courseRunId) return res.status(400).json({ success: false, error: 'courseRunId is required' });
  try {
    const result = await removeClassCalendarEvents(courseRunId, { reason: 'manual source cleanup after move' });
    return res.status(200).json({ success: true, ...result });
  } catch (err: any) {
    console.error('❌ [remove-run-calendar]', err?.message || err);
    return res.status(500).json({ success: false, error: err?.message || 'Failed to remove calendar events' });
  }
}
