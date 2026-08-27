import type { NextApiRequest, NextApiResponse } from 'next';
import pool from '../../../lib/db';
import { fetchMagentoSchedules, sgtToday } from '../../../lib/wsqScheduleSync';

/**
 * External API — WSQ/CASL schedule gap, with the REASON each date is stuck.
 *
 * Intended caller: OpenClaw agents answering "what course runs are missing?"
 * on WhatsApp. It is the LOOK-BEFORE-YOU-ACT half of the schedule sync: the
 * agent can already trigger a sync via /api/external/auto-sync-wsq-schedule,
 * but until now had no way to see what it was about to do, or to explain the
 * outcome to a human.
 *
 * That distinction matters. On 26 Aug 2026 the storefront carried 1,815 future
 * dates with no local run, and a bare count of "1,815 missing" invites the agent
 * to submit all of them — but the overwhelming majority CANNOT be submitted:
 * SSG rejects a run whose start date falls outside the course's funding support
 * period, and a course with no session timing template never reaches SSG at all.
 * So this endpoint never returns a bare number; every date is bucketed by what
 * is actually blocking it, and each bucket carries an `action` telling the
 * caller what a human would have to do about it.
 *
 * Auth: header  x-api-key: <EXTERNAL_API_KEY_FOR_CLAWDBOT>  (same as all /api/external/*)
 *
 * GET /api/external/wsq-schedule-gap
 * GET /api/external/wsq-schedule-gap?detail=1          include per-course rows
 * GET /api/external/wsq-schedule-gap?course_code=TGS-… one course only (implies detail)
 * GET /api/external/wsq-schedule-gap?bucket=submittable_now   filter the detail list
 *
 * Reads only: the storefront schedule feed, plus course / course_run /
 * course_session_timing. It never writes and never contacts SSG.
 *
 * Responses:
 *   200 { success:true, generated_at, storefront_courses, totals, buckets, courses? }
 *   401 { success:false, error }   bad/missing API key
 *   502 { success:false, error }   storefront feed unreachable
 */

type Bucket =
  | 'submittable_now'
  | 'past_funding_end'
  | 'no_session_timing'
  | 'no_wsq_funding'
  | 'course_not_in_lms';

const ACTION: Record<Bucket, string> = {
  submittable_now:
    'Ready to submit. POST /api/external/wsq-submit-runs with course_code or an explicit items[] list. ' +
    'It previews unless you pass "confirm": true, so show a human the preview and get a yes first. ' +
    'Do NOT use auto-sync-wsq-schedule or auto-retry-wsq-blocked for this — those are scheduled jobs ' +
    'that filter on the failure log and would skip almost all of these dates.',
  past_funding_end:
    'CANNOT be submitted. The date falls after the course funding support period ends — SSG will reject it. Needs a funding renewal with SSG before these dates can exist.',
  no_session_timing:
    'CANNOT be submitted. The course has no session timing template, so no sessions can be built. Set it under Course Session Timing first.',
  no_wsq_funding:
    'UNKNOWN — do not report this as blocked. No WSQ funding window is on record, but the ' +
    'support-period lookup only reads the WSQ tag (taggingCode 1000), so CASL and IBF courses ' +
    'land here even when they are funded under their own scheme. SSG already holds published ' +
    'runs for many of these. Submit ONE date and read what SSG says rather than assuming.',
  course_not_in_lms:
    'CANNOT be submitted. The storefront code does not resolve to any course, even through course_code_history. The course needs creating in the LMS.',
};

type CourseAgg = {
  course_code: string;
  resolved_course_code: string | null;
  title: string | null;
  course_type: string | null;
  funding_ends: string | null;
  buckets: Partial<Record<Bucket, string[]>>;
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

  const onlyCode = String(req.query.course_code ?? '').trim().toUpperCase();
  const bucketFilter = String(req.query.bucket ?? '').trim() as Bucket | '';
  const wantDetail = req.query.detail === '1' || req.query.detail === 'true' || !!onlyCode;

  try {
    const today = sgtToday();

    let magento;
    try {
      magento = await fetchMagentoSchedules();
    } catch (e) {
      return res.status(502).json({
        success: false,
        error: `Could not read the Tertiary Courses storefront schedule: ${e instanceof Error ? e.message : String(e)}`,
      });
    }

    // Course facts, keyed by canonical course_code.
    const courseRows = (await pool.query<{
      course_code: string; title: string | null; course_type: string | null;
      funding_to: string | null; has_timing: boolean;
    }>(
      `SELECT c.course_code,
              c.title,
              c.course_type::text AS course_type,
              to_char(c.ssg_wsq_support_to, 'YYYY-MM-DD') AS funding_to,
              EXISTS (SELECT 1 FROM course_session_timing t WHERE t.course_code = c.course_code) AS has_timing
         FROM course c
        WHERE c.course_code LIKE 'TGS-%'`,
    )).rows;
    const courseByCode = new Map(courseRows.map((r) => [r.course_code, r]));

    // Renewal codes -> canonical course_code. SSG issues a new reference number on
    // funding renewal and the storefront switches to it immediately, so a storefront
    // code is frequently NOT the course's course_code.
    const canonicalByAlias = new Map<string, string>();
    for (const row of (await pool.query<{ canonical: string; alias: string }>(
      `SELECT c.course_code AS canonical, h.code AS alias
         FROM public.course c
         JOIN public.course_code_history h ON h.course_id = c.id
        WHERE c.course_code LIKE 'TGS-%' AND h.code <> c.course_code
        UNION
       SELECT c.course_code, NULLIF(c.new_course_code, '')
         FROM public.course c
        WHERE c.course_code LIKE 'TGS-%'
          AND NULLIF(c.new_course_code, '') IS NOT NULL
          AND c.new_course_code <> c.course_code`,
    )).rows) {
      if (row.alias) canonicalByAlias.set(row.alias, row.canonical);
    }

    // Future local runs, keyed canonical course_code -> "start|end".
    const runsByCode = new Map<string, Set<string>>();
    for (const r of (await pool.query<{ course_code: string; s: string; e: string }>(
      `SELECT c.course_code,
              to_char(cr.start_date, 'YYYY-MM-DD') AS s,
              to_char(cr.end_date,   'YYYY-MM-DD') AS e
         FROM course c
         JOIN course_run cr ON cr.course_id = c.id
        WHERE c.course_code LIKE 'TGS-%'
          AND COALESCE(cr.is_deleted, false) = false
          AND cr.course_run_id NOT LIKE 'STAGED-%'
          AND cr.end_date >= CURRENT_DATE`,
    )).rows) {
      if (!runsByCode.has(r.course_code)) runsByCode.set(r.course_code, new Set());
      runsByCode.get(r.course_code)!.add(`${r.s}|${r.e}`);
    }

    const counts: Record<Bucket, { dates: number; courses: Set<string> }> = {
      submittable_now:   { dates: 0, courses: new Set() },
      past_funding_end:  { dates: 0, courses: new Set() },
      no_session_timing: { dates: 0, courses: new Set() },
      no_wsq_funding:    { dates: 0, courses: new Set() },
      course_not_in_lms: { dates: 0, courses: new Set() },
    };
    let synced = 0;
    let unparsed = 0;
    const byCourse = new Map<string, CourseAgg>();

    for (const m of magento.courses || []) {
      const storefrontCode = (m.course_code ?? '').trim();
      if (!storefrontCode) continue;
      if (onlyCode && storefrontCode.toUpperCase() !== onlyCode) continue;

      const canonical = canonicalByAlias.get(storefrontCode) ?? storefrontCode;
      const course = courseByCode.get(canonical);
      const runs = runsByCode.get(canonical);

      for (const s of m.schedules || []) {
        const start = s.course_start_date?.slice(0, 10);
        const end = s.course_end_date?.slice(0, 10);
        if (!start || !end) { unparsed++; continue; }
        // SSG rejects a past start date, so a past-dated schedule is not a gap.
        if (end < today || start < today) continue;
        if (runs?.has(`${start}|${end}`)) { synced++; continue; }

        let bucket: Bucket;
        if (!course) bucket = 'course_not_in_lms';
        else if (!course.has_timing) bucket = 'no_session_timing';
        else if (!course.funding_to) bucket = 'no_wsq_funding';
        else if (start > course.funding_to) bucket = 'past_funding_end';
        else bucket = 'submittable_now';

        counts[bucket].dates++;
        counts[bucket].courses.add(storefrontCode);

        if (wantDetail && (!bucketFilter || bucketFilter === bucket)) {
          let agg = byCourse.get(storefrontCode);
          if (!agg) {
            agg = {
              course_code: storefrontCode,
              resolved_course_code: course ? canonical : null,
              title: course?.title ?? m.course_title ?? null,
              course_type: course?.course_type ?? null,
              funding_ends: course?.funding_to ?? null,
              buckets: {},
            };
            byCourse.set(storefrontCode, agg);
          }
          (agg.buckets[bucket] ??= []).push(start === end ? start : `${start}..${end}`);
        }
      }
    }

    const buckets = Object.fromEntries(
      (Object.keys(counts) as Bucket[]).map((k) => [k, {
        dates: counts[k].dates,
        courses: counts[k].courses.size,
        action: ACTION[k],
      }]),
    );

    const gap = (Object.keys(counts) as Bucket[]).reduce((n, k) => n + counts[k].dates, 0);

    return res.status(200).json({
      success: true,
      generated_at: new Date().toISOString(),
      today,
      storefront_courses: magento.courses?.length ?? 0,
      totals: {
        synced,
        gap,
        submittable_now: counts.submittable_now.dates,
        blocked: counts.past_funding_end.dates + counts.no_session_timing.dates + counts.course_not_in_lms.dates,
        unknown: counts.no_wsq_funding.dates,
        unparsed,
      },
      buckets,
      // Do not lead a human with the raw gap: most of it is not actionable.
      headline:
        `${counts.submittable_now.dates} of ${gap} missing course dates are confirmed submittable. ` +
        `${counts.past_funding_end.dates + counts.no_session_timing.dates + counts.course_not_in_lms.dates} ` +
        `are blocked and need a person to act first. ` +
        `${counts.no_wsq_funding.dates} are unknown — CASL/IBF courses whose funding this check cannot read.`,
      ...(wantDetail ? { courses: [...byCourse.values()] } : {}),
    });
  } catch (err) {
    console.error('external/wsq-schedule-gap error:', err);
    return res.status(500).json({
      success: false,
      error: err instanceof Error ? err.message : 'Internal server error',
    });
  }
}
