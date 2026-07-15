import type { NextApiRequest, NextApiResponse } from 'next';
import { ensureClassCalendarEvent } from '../../../lib/calendar/ensureClassCalendarEvent';
import pool from '../../../lib/db';

/**
 * POST /api/external/ensure-run-calendar
 *
 * Creates Google Calendar event(s) for a course run that has none yet.
 * Idempotent — safe to call even if events already exist (adopted, not duplicated).
 *
 * Use this when /api/external/reschedule-learner-readiness returns a calendar
 * warning about a missing target calendar event. Resolve the warning here, then
 * proceed with the reschedule.
 *
 * Body: { run_id: string }
 *   run_id — SSG course_run_id (e.g. "TGS-123456-01") or internal UUID
 *
 * Response (success):
 *   { success: true, status: 'ok'|'skipped', created: number, adopted: number, kept: number }
 *
 * Response (skipped):
 *   { success: true, status: 'skipped', reason: string }
 *   Skipped when ENABLE_CALENDAR_WRITES is not set, or Google Calendar is unconfigured.
 *
 * Headers: x-api-key: <EXTERNAL_API_KEY_FOR_CLAWDBOT>
 */
export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, x-api-key');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ success: false, error: 'Method not allowed' });

  const apiKey = req.headers['x-api-key'];
  const validKey = process.env.EXTERNAL_API_KEY_FOR_CLAWDBOT;
  if (!validKey) return res.status(500).json({ success: false, error: 'API key not configured on server' });
  if (!apiKey || apiKey !== validKey) return res.status(401).json({ success: false, error: 'Invalid or missing API key' });

  const { run_id } = (req.body || {}) as { run_id?: string };
  if (!run_id?.trim()) return res.status(400).json({ success: false, error: 'run_id is required' });

  try {
    const runRow = (await pool.query(
      `SELECT id FROM course_run WHERE course_run_id = $1 OR id::text = $1 LIMIT 1`,
      [run_id.trim()]
    )).rows[0];
    if (!runRow) return res.status(404).json({ success: false, error: `Run ${run_id} not found in LMS` });

    // Item 21: refuse to create a calendar event for a run with no sessions — the event would have no dates
    const sessionCount = (await pool.query(
      `SELECT COUNT(*)::int AS cnt FROM course_session WHERE course_run_id = $1 AND COALESCE(deleted, false) = false`,
      [runRow.id]
    )).rows[0]?.cnt ?? 0;
    if (sessionCount === 0) {
      return res.status(422).json({
        success: false,
        error: `Run ${run_id} has no active sessions — sync sessions from SSG first (POST /api/admin/sync-run-sessions or wait for the nightly cron), then call this endpoint again.`,
      });
    }

    const result = await ensureClassCalendarEvent(runRow.id);
    return res.status(200).json({ success: true, ...result });
  } catch (err: any) {
    console.error('[external/ensure-run-calendar] error:', err);
    return res.status(500).json({ success: false, error: err?.message || 'Failed to ensure calendar event' });
  }
}
