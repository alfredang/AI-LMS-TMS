import type { NextApiRequest, NextApiResponse } from 'next';
import pool from '../../../lib/db';
import { isBlockedSyncError } from '../../../lib/wsqScheduleSync';

/**
 * External API — outcome of the WSQ schedule sync job.
 *
 * Intended caller: OpenClaw agents reporting back after triggering
 * /api/external/auto-sync-wsq-schedule. That endpoint starts a BACKGROUND job
 * and returns immediately with a job id, so without this the agent can say it
 * started the work but never what happened — which is the "send a summary of
 * the work to the user" half of the workflow.
 *
 * Failures are grouped by message rather than listed one per date: a single
 * blocked course produces one failure row per date it sells, so a raw list runs
 * to hundreds of identical lines and is useless in a chat message. Each group
 * also carries `blocked`, which distinguishes "SSG refused this on eligibility
 * grounds, a human must renew the funding" from "this failed for some other
 * reason and needs a developer".
 *
 * Auth: header  x-api-key: <EXTERNAL_API_KEY_FOR_CLAWDBOT>  (same as all /api/external/*)
 *
 * GET /api/external/wsq-sync-status            most recent job
 * GET /api/external/wsq-sync-status?job_id=42  one specific job
 * GET /api/external/wsq-sync-status?history=1  add the last 10 jobs, summary only
 *
 * Read-only. Never writes and never contacts SSG.
 *
 * Responses:
 *   200 { success:true, job:null }  no sync has ever run
 *   200 { success:true, job:{…}, failure_groups:[…], history? }
 *   401 { success:false, error }
 *   404 { success:false, error }    job_id not found
 */

type JobRow = {
  id: number;
  status: string;
  started_at: string;
  completed_at: string | null;
  total_items: number;
  items_done: number;
  submitted: number;
  already_exists: number;
  ssg_errors: number;
  skipped: number;
  failures: unknown;
  summary: string | null;
  triggered_by: string;
};

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

  const jobId = Number(req.query.job_id);
  const wantHistory = req.query.history === '1' || req.query.history === 'true';

  try {
    const jobRes = await pool.query<JobRow>(
      Number.isFinite(jobId) && jobId > 0
        ? `SELECT * FROM wsq_sync_job WHERE id = $1`
        : `SELECT * FROM wsq_sync_job ORDER BY started_at DESC LIMIT 1`,
      Number.isFinite(jobId) && jobId > 0 ? [jobId] : [],
    ).catch(() => ({ rows: [] as JobRow[] }));

    const job = jobRes.rows[0];
    if (!job) {
      return res.status(Number.isFinite(jobId) && jobId > 0 ? 404 : 200).json(
        Number.isFinite(jobId) && jobId > 0
          ? { success: false, error: `No sync job with id ${jobId}` }
          : { success: true, job: null, message: 'No WSQ schedule sync has run yet.' },
      );
    }

    // Collapse per-date failures into one row per distinct message.
    const failures = Array.isArray(job.failures) ? (job.failures as any[]) : [];
    const grouped = new Map<string, { message: string; dates: number; courses: Set<string>; blocked: boolean; example: string | null }>();
    for (const f of failures) {
      const message = String(f?.message ?? f?.status ?? 'Unknown error');
      let g = grouped.get(message);
      if (!g) {
        g = { message, dates: 0, courses: new Set(), blocked: isBlockedSyncError(message), example: null };
        grouped.set(message, g);
      }
      g.dates++;
      if (f?.course_code) g.courses.add(String(f.course_code).trim());
      if (!g.example && f?.course_code && f?.start_date) g.example = `${f.course_code} on ${f.start_date}`;
    }
    const failure_groups = [...grouped.values()]
      .sort((a, b) => b.dates - a.dates)
      .map((g) => ({
        message: g.message,
        dates: g.dates,
        courses: g.courses.size,
        example: g.example,
        blocked: g.blocked,
        action: g.blocked
          ? 'SSG refused this on eligibility grounds. A person must renew the course funding with SSG — retrying will not help.'
          : 'Not an eligibility problem. Needs a developer to look at it before retrying.',
      }));

    const running = job.status === 'running';
    const pct = job.total_items > 0 ? Math.round((job.items_done / job.total_items) * 100) : 0;

    const history = wantHistory
      ? (await pool.query(
          `SELECT id, status, triggered_by, started_at, completed_at,
                  total_items, submitted, ssg_errors, skipped
             FROM wsq_sync_job ORDER BY started_at DESC LIMIT 10`,
        ).catch(() => ({ rows: [] }))).rows
      : undefined;

    return res.status(200).json({
      success: true,
      job: {
        id: job.id,
        status: job.status,
        triggered_by: job.triggered_by,
        started_at: job.started_at,
        completed_at: job.completed_at,
        progress: { done: job.items_done, total: job.total_items, percent: pct },
        submitted: job.submitted,
        already_existed: job.already_exists,
        ssg_errors: job.ssg_errors,
        skipped: job.skipped,
        summary: job.summary,
      },
      failure_groups,
      headline: running
        ? `Sync in progress — ${job.items_done} of ${job.total_items} dates processed (${pct}%).`
        : `Sync ${job.status}. ${job.submitted} run(s) submitted, ${job.already_exists} already existed, ` +
          `${job.ssg_errors} rejected by SSG, ${job.skipped} skipped.`,
      ...(history ? { history } : {}),
    });
  } catch (err) {
    console.error('external/wsq-sync-status error:', err);
    return res.status(500).json({
      success: false,
      error: err instanceof Error ? err.message : 'Internal server error',
    });
  }
}
