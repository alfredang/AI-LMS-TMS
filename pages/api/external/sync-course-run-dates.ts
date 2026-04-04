import type { NextApiRequest, NextApiResponse } from 'next';
import pool from '../../../lib/db';
import { getSSGCredentialsService } from '../../../lib/ssg/services/credentials-service';
import { createSSGCourseAPI } from '../../../lib/ssg/api/course-api';

/**
 * External API — Sync Course Run Dates
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * SCHEDULE: Run daily at 1:00 AM SGT
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * PURPOSE:
 *   Keeps course run start and end dates in the local database in sync with
 *   SSG. Runs in the early morning so any date changes made in SSG the
 *   previous day are reflected before the work day begins.
 *
 * POST /api/external/sync-course-run-dates
 *
 * Headers:
 *   x-api-key: <EXTERNAL_API_KEY_FOR_CLAWDBOT>
 *
 * Body: (empty — no body required)
 *
 * What it does:
 *   1. Validates the API key
 *   2. Finds all course runs where start_date = TODAY in the local database
 *   3. For each course run, fetches the latest course run data from SSG
 *   4. Compares SSG start/end dates against the local database dates
 *      - If dates differ → updates the local database and logs as "updated"
 *      - If dates are the same → logs as "no_change"
 *   5. Writes all results to course_run_date_sync_log (viewable in Admin panel)
 *
 * Notes:
 *   - A 2-second delay is applied between each course run to avoid SSG API rate limits
 *   - Results can be viewed in the Admin panel under "Course Run Date Sync"
 */

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
const RATE_LIMIT_MS = 2000;

// ── Ensure log table exists ───────────────────────────────────────────────────

async function ensureLogTable() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS course_run_date_sync_log (
      id              SERIAL PRIMARY KEY,
      run_id          TEXT NOT NULL,
      created_at      TIMESTAMPTZ DEFAULT NOW(),
      course_run_id   TEXT,
      course_title    TEXT,
      course_code     TEXT,
      db_start_date   TEXT,
      db_end_date     TEXT,
      ssg_start_date  TEXT,
      ssg_end_date    TEXT,
      status          TEXT NOT NULL DEFAULT 'pending',
      updated         BOOLEAN DEFAULT false,
      error_message   TEXT
    )
  `);
}

// ── Parse SSG 8-digit date or ISO to YYYY-MM-DD ───────────────────────────────

function parseSsgDate(d: number | string | undefined): string | null {
  if (!d) return null;
  const s = String(d).trim();
  if (/^\d{8}$/.test(s)) return `${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)}`;
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  return null;
}

// ── Main sync runner ──────────────────────────────────────────────────────────

export async function runDateSync() {
  await ensureLogTable();

  // De-duplication guard: skip if already ran 3 or more times today (SGT)
  const recent = await pool.query(
    `SELECT COUNT(DISTINCT run_id) AS run_count
     FROM course_run_date_sync_log
     WHERE (created_at AT TIME ZONE 'Asia/Singapore')::date = (CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Singapore')::date`
  );
  if (Number(recent.rows[0]?.run_count) >= 3) {
    console.log(`⏭️ sync-course-run-dates: skipping — already ran 3 times today (SGT)`);
    return { runId: `skipped_${Date.now()}`, startedAt: new Date().toISOString(), processed: 0, updated: 0, noChange: 0, errors: 0, results: [], skipped: true };
  }

  const runId = `sync_${Date.now()}`;
  const startedAt = new Date().toISOString();

  // Fetch all course runs starting today
  const runsResult = await pool.query<{
    db_id: string;
    course_run_id: string;
    course_title: string;
    course_code: string;
    db_start_date: string | null;
    db_end_date: string | null;
  }>(
    `SELECT
       cr.id                                    AS db_id,
       cr.course_run_id,
       c.title                                  AS course_title,
       c.course_code,
       TO_CHAR(cr.start_date, 'YYYY-MM-DD')    AS db_start_date,
       TO_CHAR(cr.end_date,   'YYYY-MM-DD')    AS db_end_date
     FROM course_run cr
     JOIN course c ON c.id = cr.course_id
     WHERE DATE(cr.start_date) = CURRENT_DATE
       AND cr.course_run_id IS NOT NULL
       AND cr.course_run_id <> ''
     ORDER BY cr.start_date ASC`
  );

  const runs = runsResult.rows;
  console.log(`📋 sync-course-run-dates: ${runs.length} course run(s) starting today`);

  if (runs.length === 0) {
    return { runId, startedAt, processed: 0, updated: 0, noChange: 0, errors: 0, results: [] };
  }

  const credentials = await getSSGCredentialsService().getSSGCredentials();
  if (!credentials) throw new Error('SSG credentials not found');

  const ssgBaseUrl = process.env.SSG_API_URL || 'https://api.ssg-wsg.sg';
  const api = createSSGCourseAPI(ssgBaseUrl, credentials);

  let updated = 0, noChange = 0, errors = 0;
  const results: any[] = [];

  for (const run of runs) {
    const logEntry: any = {
      runId,
      courseRunId:  run.course_run_id,
      courseTitle:  run.course_title,
      courseCode:   run.course_code,
      dbStartDate:  run.db_start_date,
      dbEndDate:    run.db_end_date,
      ssgStartDate: null,
      ssgEndDate:   null,
      status:       'pending',
      updatedDates: false,
      errorMessage: null,
    };

    try {
      const ssgResult = await api.viewCourseRun(run.course_run_id);

      const hasError = ssgResult.error && (
        ssgResult.error.code || ssgResult.error.message ||
        (ssgResult.error.details && ssgResult.error.details.length > 0)
      );

      if (hasError) {
        logEntry.status = 'error';
        logEntry.errorMessage = ssgResult.error?.message ?? `SSG error ${ssgResult.status}`;
        errors++;
        console.warn(`  ⚠️ SSG error for ${run.course_run_id}: ${logEntry.errorMessage}`);
      } else {
        const ssgCourse = (ssgResult.data as any)?.course;
        const runData = ssgCourse?.run;
        if (!runData) {
          logEntry.status = 'error';
          logEntry.errorMessage = 'No run data returned from SSG';
          errors++;
        } else {
          const ssgStart = parseSsgDate(runData.courseStartDate ?? runData.courseDates?.start);
          const ssgEnd   = parseSsgDate(runData.courseEndDate   ?? runData.courseDates?.end);

          logEntry.ssgStartDate = ssgStart;
          logEntry.ssgEndDate   = ssgEnd;

          const startMismatch = ssgStart && ssgStart !== run.db_start_date;
          const endMismatch   = ssgEnd   && ssgEnd   !== run.db_end_date;

          if (startMismatch || endMismatch) {
            await pool.query(
              `UPDATE course_run
               SET start_date = COALESCE($1::date, start_date),
                   end_date   = COALESCE($2::date, end_date),
                   updated_at = NOW()
               WHERE id = $3`,
              [ssgStart, ssgEnd, run.db_id]
            );
            logEntry.status = 'updated';
            logEntry.updatedDates = true;
            updated++;
            console.log(
              `  ✅ Updated ${run.course_run_id} — ` +
              `start: ${run.db_start_date} → ${ssgStart}, ` +
              `end: ${run.db_end_date} → ${ssgEnd}`
            );
          } else {
            logEntry.status = 'no_change';
            noChange++;
            console.log(`  ✔️  No change for ${run.course_run_id}`);
          }
        }
      }
    } catch (err) {
      logEntry.status = 'error';
      logEntry.errorMessage = err instanceof Error ? err.message : String(err);
      errors++;
      console.error(`  ❌ Exception for ${run.course_run_id}:`, err);
    }

    await pool.query(
      `INSERT INTO course_run_date_sync_log
         (run_id, course_run_id, course_title, course_code,
          db_start_date, db_end_date, ssg_start_date, ssg_end_date,
          status, updated, error_message)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
      [
        runId,
        logEntry.courseRunId,
        logEntry.courseTitle,
        logEntry.courseCode,
        logEntry.dbStartDate,
        logEntry.dbEndDate,
        logEntry.ssgStartDate,
        logEntry.ssgEndDate,
        logEntry.status,
        logEntry.updatedDates,
        logEntry.errorMessage,
      ]
    );

    results.push(logEntry);

    if (runs.indexOf(run) < runs.length - 1) {
      await sleep(RATE_LIMIT_MS);
    }
  }

  console.log(`✅ sync-course-run-dates done. runId=${runId}, processed=${runs.length}, updated=${updated}, noChange=${noChange}, errors=${errors}`);
  return { runId, startedAt, processed: runs.length, updated, noChange, errors, results };
}

// ── API Handler ───────────────────────────────────────────────────────────────

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ success: false, error: 'Method not allowed' });
  }

  const apiKey   = req.headers['x-api-key'];
  const validKey = process.env.EXTERNAL_API_KEY_FOR_CLAWDBOT;

  if (!validKey) {
    return res.status(500).json({ success: false, error: 'API key not configured on server' });
  }
  if (!apiKey || apiKey !== validKey) {
    return res.status(401).json({ success: false, error: 'Invalid or missing API key' });
  }

  try {
    const result = await runDateSync();
    if (result.skipped) {
      return res.status(429).json({ success: false, error: 'Daily run limit reached (3 runs/day SGT). Try again tomorrow.' });
    }
    return res.status(200).json({ success: true, ...result });
  } catch (err) {
    console.error('❌ sync-course-run-dates error:', err);
    return res.status(500).json({
      success: false,
      error: err instanceof Error ? err.message : 'Internal server error',
    });
  }
}
