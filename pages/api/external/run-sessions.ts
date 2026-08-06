import type { NextApiRequest, NextApiResponse } from 'next';
import pool from '../../../lib/db';
import { fetchAndSyncRunSessions } from '../../../lib/ssg/syncRunSessions';

/**
 * GET /api/external/run-sessions?run_id=<id>&refresh=false
 *
 * Returns the session list for a course run from the local DB mirror of SSG.
 * Use the returned `session_id` values when calling reschedule-session / cancel-session.
 *
 * Query params:
 *   run_id    — required — SSG course_run_id (e.g. "TGS-2026-TIA-ABC01-01") or internal UUID
 *   refresh   — optional — "true" to pull latest from SSG before returning (default: false)
 *
 * Response (success):
 * {
 *   success: true,
 *   run_id: string,        // SSG run ID
 *   synced_from_ssg?: boolean,
 *   sessions: [
 *     {
 *       session_id: string,     // SSG session ID — use this in reschedule/cancel calls
 *       session_number: string,
 *       start_date: string,     // YYYY-MM-DD
 *       end_date: string,
 *       start_time: string,     // HH:mm
 *       end_time: string,
 *       mode_of_training: string,
 *       venue: object | null
 *     }
 *   ],
 *   total: number
 * }
 *
 * Headers: x-api-key: <EXTERNAL_API_KEY_FOR_CLAWDBOT>
 */
export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, x-api-key');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET') return res.status(405).json({ success: false, error: 'Method not allowed' });

  const apiKey = req.headers['x-api-key'];
  const validKey = process.env.EXTERNAL_API_KEY_FOR_CLAWDBOT;
  if (!validKey) return res.status(500).json({ success: false, error: 'API key not configured on server' });
  if (!apiKey || apiKey !== validKey) return res.status(401).json({ success: false, error: 'Invalid or missing API key' });

  const run_id = String(req.query.run_id || '').trim();
  const doRefresh = String(req.query.refresh || '').toLowerCase() === 'true';

  if (!run_id) return res.status(400).json({ success: false, error: 'run_id is required' });

  try {
    const runRow = (await pool.query<{ id: string; course_run_id: string }>(
      `SELECT id, course_run_id FROM course_run WHERE course_run_id = $1 OR id::text = $1 LIMIT 1`,
      [run_id]
    )).rows[0];
    if (!runRow) return res.status(404).json({ success: false, error: `Run ${run_id} not found in LMS` });

    let syncedFromSsg: boolean | undefined;
    if (doRefresh) {
      const syncResult = await fetchAndSyncRunSessions(runRow.id);
      syncedFromSsg = syncResult.ok;
    }

    const sessions = (await pool.query<{
      ssg_session_id: string;
      session_number: string | null;
      start_date: string | null;
      end_date: string | null;
      start_time: string | null;
      end_time: string | null;
      mode_of_training: string | null;
      venue: any;
    }>(
      `SELECT ssg_session_id, session_number, start_date::text, end_date::text,
              start_time, end_time, mode_of_training, venue
         FROM course_session
        WHERE course_run_id = $1 AND COALESCE(deleted, false) = false
        ORDER BY start_date ASC, start_time ASC`,
      [runRow.id]
    )).rows;

    return res.status(200).json({
      success: true,
      run_id: runRow.course_run_id,
      ...(doRefresh ? { synced_from_ssg: syncedFromSsg } : {}),
      sessions: sessions.map((s) => ({
        session_id: s.ssg_session_id,
        session_number: s.session_number || '',
        start_date: s.start_date ? String(s.start_date).slice(0, 10) : '',
        end_date: s.end_date ? String(s.end_date).slice(0, 10) : '',
        start_time: s.start_time || '',
        end_time: s.end_time || '',
        mode_of_training: s.mode_of_training || '',
        venue: s.venue || null,
      })),
      total: sessions.length,
    });
  } catch (err: any) {
    console.error('[external/run-sessions] error:', err);
    return res.status(500).json({ success: false, error: err?.message || 'Unexpected error' });
  }
}
