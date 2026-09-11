import { withAuth } from '@lib/auth/withAuth';
import type { NextApiRequest, NextApiResponse } from 'next';
import { reconcileRunCalendar } from '../../../lib/calendar/reconcileRunCalendar';

/**
 * POST /api/admin/bulk-reconcile-calendar
 *
 * Bulk counterpart to /api/admin/reconcile-run-calendar — runs the same
 * per-class reconcile (create missing events + sync attendees, sendUpdates:'none')
 * across every course run UUID passed in, instead of one at a time.
 *
 * Intended caller: the "⚠ N not on GCal" control on the in-app Calendar tab —
 * the client already knows which runs are unmatched in the visible range
 * (via /api/admin/calendar-match) and passes that list here. Deliberately NOT a
 * "sweep everything ever" endpoint: scope is whatever the caller sends.
 *
 * Runs sequentially (not parallel) to stay gentle on the Google Calendar API
 * and keep per-run errors isolated — one failing run never stops the rest.
 * Guarded the same as the single-run path: reconcileRunCalendar no-ops with
 * status:'skipped' when this environment's ENABLE_CALENDAR_WRITES guard is off
 * (see lib/calendar/calendarGuard.ts) or the tenant's sync toggle is off.
 *
 * Body: { courseRunUuids: string[] }   (course_run UUIDs, not the SSG run id)
 *
 * Capped small on purpose: this is meant to be called with small chunks from a
 * client-side loop (see the date-range "Sync all to Google Calendar" control on
 * the Calendar tab), not one giant request for an entire backlog — a single
 * request processing hundreds of classes sequentially against the Google
 * Calendar API is exactly the shape a reverse proxy / serverless timeout kills
 * mid-flight, which surfaces to the browser as a bare "Failed to fetch" with no
 * useful error. Small chunks keep each call fast and let the caller show
 * progress across many calls instead of guessing why one huge one died.
 */
const MAX_RUNS_PER_CALL = 20;

interface RunOutcome {
  courseRunUuid: string;
  status: 'ok' | 'skipped' | 'error';
  reason?: string;
  created: number;
  attendeesAdded: number;
  errors: number;
}

async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') return res.status(405).json({ success: false, error: 'Method not allowed' });

  const { courseRunUuids } = (req.body || {}) as { courseRunUuids?: unknown };
  if (!Array.isArray(courseRunUuids) || courseRunUuids.length === 0) {
    return res.status(400).json({ success: false, error: 'courseRunUuids (non-empty array) is required' });
  }
  const uuids = [...new Set(courseRunUuids.filter((v): v is string => typeof v === 'string' && v.length > 0))];
  if (uuids.length === 0) {
    return res.status(400).json({ success: false, error: 'courseRunUuids contained no valid entries' });
  }
  if (uuids.length > MAX_RUNS_PER_CALL) {
    return res.status(400).json({
      success: false,
      error: `Too many runs in one call (${uuids.length}) — max is ${MAX_RUNS_PER_CALL}. Narrow the visible range and retry.`,
    });
  }

  const results: RunOutcome[] = [];
  let totalCreated = 0;
  let totalAttendeesAdded = 0;
  let succeeded = 0;
  let skipped = 0;
  let failed = 0;

  for (const uuid of uuids) {
    try {
      const r = await reconcileRunCalendar(uuid);
      const outcome: RunOutcome = {
        courseRunUuid: uuid,
        status: r.status === 'ok' ? 'ok' : 'skipped',
        reason: r.reason,
        created: r.created,
        attendeesAdded: r.attendeesAdded,
        errors: r.errors,
      };
      results.push(outcome);
      totalCreated += r.created;
      totalAttendeesAdded += r.attendeesAdded;
      if (r.status === 'ok') succeeded++; else skipped++;
    } catch (err) {
      failed++;
      results.push({
        courseRunUuid: uuid,
        status: 'error',
        reason: err instanceof Error ? err.message : 'Reconcile failed',
        created: 0,
        attendeesAdded: 0,
        errors: 1,
      });
    }
  }

  return res.status(200).json({
    success: true,
    totalRuns: uuids.length,
    succeeded,
    skipped,
    failed,
    totalEventsCreated: totalCreated,
    totalAttendeesAdded,
    results,
  });
}

export default withAuth(handler, { roles: ['admin', 'trainingProvider', 'developer'] });
