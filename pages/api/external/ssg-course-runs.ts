import type { NextApiRequest, NextApiResponse } from 'next';
import pool from '../../../lib/db';
import { getSSGCredentialsService } from '../../../lib/ssg/services/credentials-service';
import { createSSGCourseAPI } from '../../../lib/ssg/api/course-api';
import { getTrainingPartnerIdentifiers } from '../../../lib/trainingPartnerIdentifiers';

/**
 * External API — SSG Course Runs (live, tallies with MySkillsFuture)
 *
 * GET /api/external/ssg-course-runs?course_code=TGS-2025052468
 *
 * Headers:
 *   x-api-key: <EXTERNAL_API_KEY_FOR_CLAWDBOT>
 *
 * This is the SSG-truth counterpart to /api/external/course-runs:
 *
 *   /api/external/course-runs      → "upcoming course runs": local course_run
 *                                     rows, i.e. runs that HAVE enrolments.
 *   /api/external/ssg-course-runs  → "SSG course runs": every run SSG publishes
 *                                     for the code, with AND without enrolments.
 *                                     Tallies with the MySkillsFuture course-dates tab.
 *
 * It reads live from SSG's /courses/courseRuns/reference rather than the local
 * course_run table, because the nightly sync in upcoming-course-runs.ts skips
 * any run with zero enrolments — those runs are never written to the DB.
 *
 * Each run is annotated with `in_lms` / `enrolled_count` so callers can see at a
 * glance which SSG runs have made it into the local operational data.
 *
 * Query params:
 *   course_code      (required) e.g. TGS-2025052468
 *   from             only runs starting on/after this date (YYYY-MM-DD).
 *                    Defaults to today, matching "upcoming". Pass from=all for every run.
 *   to               only runs starting on/before this date (YYYY-MM-DD)
 *   include_expired  "true" to ask SSG for expired courses too (default false)
 *   page_size        SSG page size (default 100, max 100)
 */

/** Parse SSG's 8-digit date integer (YYYYMMDD) to YYYY-MM-DD. */
function parseSsgDate(d: number | string | undefined | null): string | null {
  if (!d) return null;
  const s = String(d).trim();
  if (/^\d{8}$/.test(s)) return `${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)}`;
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  return null;
}

/** Map SSG modeOfTraining code to the local mode_of_learning label. */
function parseModeOfLearning(code: string | number | undefined): string {
  switch (String(code ?? '')) {
    case '1': return 'Physical';
    case '2': return 'Online';
    case '3': return 'On the Job';
    case '4': return 'Hybrid';
    case '5': return 'Practical';
    default:  return 'Physical';
  }
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, x-api-key');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET') {
    return res.status(405).json({ success: false, error: 'Method not allowed' });
  }

  const apiKey = req.headers['x-api-key'];
  const validKey = process.env.EXTERNAL_API_KEY_FOR_CLAWDBOT;
  if (!validKey) return res.status(500).json({ success: false, error: 'API key not configured on server' });
  if (!apiKey || apiKey !== validKey) {
    return res.status(401).json({ success: false, error: 'Invalid or missing API key' });
  }

  const courseCode = (req.query.course_code as string | undefined)?.trim() || '';
  if (!courseCode) {
    return res.status(400).json({ success: false, error: 'course_code is required' });
  }

  const fromRaw = (req.query.from as string | undefined)?.trim() || '';
  const toRaw = (req.query.to as string | undefined)?.trim() || '';
  const includeExpired = String(req.query.include_expired ?? '') === 'true';
  const pageSize = Math.min(Number(req.query.page_size) || 100, 100);

  // Default to "upcoming" (today onwards); from=all lifts the lower bound.
  const today = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Singapore' });
  const fromDate = fromRaw === 'all' ? null : (fromRaw || today);
  const toDate = toRaw || null;

  try {
    const credentials = await getSSGCredentialsService().getSSGCredentials();
    if (!credentials) {
      return res.status(502).json({ success: false, error: 'SSG credentials not configured' });
    }

    const ssgBaseUrl = process.env.SSG_API_URL || 'https://api.ssg-wsg.sg';
    const tp = await getTrainingPartnerIdentifiers();
    const courseApi = createSSGCourseAPI(ssgBaseUrl, credentials);

    const searchResult = await courseApi.searchCourseRunsByCode(courseCode, {
      pageSize,
      includeExpired,
      uen: credentials.uen || tp.uen,
    });

    if (searchResult.error?.code || searchResult.error?.message) {
      return res.status(502).json({
        success: false,
        error: `SSG error: ${searchResult.error?.message || searchResult.error?.code}`,
      });
    }
    if (searchResult.status !== 200) {
      return res.status(502).json({ success: false, error: `SSG returned status ${searchResult.status}` });
    }

    const ssgData = (searchResult.data as any)?.data ?? searchResult.data ?? {};
    const rawRuns: any[] = ssgData?.course?.runs ?? ssgData?.runs ?? [];

    // Which of these runs exist locally, and with how many enrolments?
    const localRows = await pool.query(
      // Same active-enrolment definition as /api/external/course-runs, so the
      // two endpoints can never disagree about which runs "have enrolments".
      `SELECT cr.course_run_id,
              (SELECT COUNT(*)::int FROM enrollment e
                WHERE e.course_run_id = cr.id
                  AND LOWER(COALESCE(e.enrolment_status, ''))
                      NOT IN ('admin removed', 'cancelled', 'withdrawn')) AS enrolled_count
         FROM course_run cr
        WHERE cr.course_run_id = ANY($1::text[])
          AND cr.is_deleted IS NOT TRUE`,
      [rawRuns.map(r => String(r.id ?? r.courseRunId ?? '')).filter(Boolean)]
    );
    const localByRunId = new Map<string, number>(
      localRows.rows.map((r: any) => [String(r.course_run_id), Number(r.enrolled_count) || 0])
    );

    const runs = rawRuns
      .map(run => {
        const runId = String(run.id ?? run.courseRunId ?? '');
        const startDate = parseSsgDate(run.courseStartDate ?? run.courseDates?.start);
        const endDate = parseSsgDate(run.courseEndDate ?? run.courseDates?.end);
        const inLms = localByRunId.has(runId);
        return {
          course_run_id: runId,
          course_code: courseCode,
          start_date: startDate,
          end_date: endDate,
          mode_of_learning: parseModeOfLearning(run.modeOfTraining),
          registration_opening_date: parseSsgDate(run.registrationDates?.opening),
          registration_closing_date: parseSsgDate(run.registrationDates?.closing),
          vacancy_code: run.courseVacancy?.code ?? null,
          vacancy_description: run.courseVacancy?.description ?? null,
          venue: run.venue ?? null,
          in_lms: inLms,
          enrolled_count: inLms ? localByRunId.get(runId)! : 0,
        };
      })
      .filter(r => {
        if (!r.start_date) return false;
        if (fromDate && r.start_date < fromDate) return false;
        if (toDate && r.start_date > toDate) return false;
        return true;
      })
      .sort((a, b) => (a.start_date! < b.start_date! ? 1 : -1));

    return res.status(200).json({
      success: true,
      course_code: courseCode,
      total: runs.length,
      ssg_total_returned: rawRuns.length,
      with_enrolments: runs.filter(r => r.enrolled_count > 0).length,
      without_enrolments: runs.filter(r => r.enrolled_count === 0).length,
      data: runs,
    });
  } catch (error) {
    console.error('ssg-course-runs error:', error);
    return res.status(500).json({ success: false, error: 'Internal server error' });
  }
}
