import type { NextApiRequest, NextApiResponse } from 'next';
import pool from '../../../lib/db';
import { fetchAndSyncRunSessions } from '../../../lib/ssg/syncRunSessions';

/**
 * Daily GAP-FILL session sync (cron). Pulls SSG sessions into local `course_session` for
 * active/upcoming runs that currently have NO local sessions but DO have people (≥1 learner
 * or a trainer) — i.e. real classes missing from the local-session-based calendar. Scoped this
 * way to keep SSG call volume small and self-limiting (empty/people-less stubs are skipped).
 *
 * Per-run viewing already syncs on demand (class-sessions); this catches runs nobody opened.
 * Auth: x-api-key == EXTERNAL_API_KEY_FOR_CLAWDBOT.
 */
const CONCURRENCY = 5;
const MAX_RUNS = 500;

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST' && req.method !== 'GET') return res.status(405).json({ success: false, error: 'Method not allowed' });
  const apiKey = req.headers['x-api-key'];
  if (!apiKey || apiKey !== process.env.EXTERNAL_API_KEY_FOR_CLAWDBOT) {
    return res.status(401).json({ success: false, error: 'Invalid or missing API key' });
  }

  // Optional bound for manual/test runs (e.g. ?limit=3). Defaults to the full cap.
  const limit = Math.min(MAX_RUNS, Math.max(1, parseInt(String(req.query.limit ?? ''), 10) || MAX_RUNS));

  try {
    const targets = (await pool.query<{ id: string; course_run_id: string }>(
      `SELECT cr.id, cr.course_run_id
         FROM course_run cr
        WHERE cr.end_date >= CURRENT_DATE AND cr.class_status::text <> 'Cancelled'
          AND NOT EXISTS (SELECT 1 FROM course_session cs WHERE cs.course_run_id = cr.id AND COALESCE(cs.deleted, false) = false)
          AND (
            EXISTS (SELECT 1 FROM enrollment e WHERE e.course_run_id = cr.id
                      AND LOWER(COALESCE(e.enrolment_status, '')) NOT IN ('admin removed', 'cancelled', 'withdrawn'))
            OR NULLIF(BTRIM(COALESCE(cr.tpg_assigned_trainer_name, '')), '') IS NOT NULL
            OR NULLIF(BTRIM(COALESCE(cr.assigned_trainer_name, '')), '') IS NOT NULL
            OR EXISTS (SELECT 1 FROM course_run_trainer crt WHERE crt.course_run_id = cr.id)
            OR EXISTS (SELECT 1 FROM trainer_invitation ti WHERE ti.course_run_id = cr.id AND ti.status = 'accepted')
          )
        ORDER BY cr.start_date ASC
        LIMIT ${limit}`
    )).rows;

    let synced = 0, withSessions = 0, empty = 0, failed = 0;
    const errors: Array<{ runId: string; error: string }> = [];
    for (let i = 0; i < targets.length; i += CONCURRENCY) {
      const batch = targets.slice(i, i + CONCURRENCY);
      const results = await Promise.all(batch.map((t) => fetchAndSyncRunSessions(t.id).then((r) => ({ t, r }))));
      for (const { t, r } of results) {
        if (!r.ok) { failed++; if (errors.length < 25) errors.push({ runId: t.course_run_id, error: r.error || 'unknown' }); continue; }
        synced++;
        if (r.upserted > 0) withSessions++; else empty++;
      }
    }

    return res.status(200).json({
      success: true,
      targets: targets.length,
      synced, withSessions, empty, failed,
      capped: targets.length >= limit,
      errors,
    });
  } catch (err: any) {
    console.error('❌ [sync-course-run-sessions]', err?.message || err);
    return res.status(500).json({ success: false, error: err?.message || 'Failed to sync sessions' });
  }
}
