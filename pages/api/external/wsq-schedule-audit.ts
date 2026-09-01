import type { NextApiRequest, NextApiResponse } from 'next';
import pool from '../../../lib/db';
import { fetchMagentoSchedules, sgtToday } from '../../../lib/wsqScheduleSync';
import { getSSGCredentialsService } from '../../../lib/ssg/services/credentials-service';
import { createSSGCourseAPI } from '../../../lib/ssg/api/course-api';

/**
 * External API — Schedule Audit (READ ONLY)
 *
 * GET /api/external/wsq-schedule-audit?offset=0&limit=25
 *
 * Headers:
 *   x-api-key: <EXTERNAL_API_KEY_FOR_CLAWDBOT>
 *
 * Answers the one question nothing else can: for every course, which dates does
 * the storefront sell that SSG does not hold, and which runs does SSG hold that
 * the storefront does not sell?
 *
 * `wsq-schedule-gap` cannot answer it. That compares the storefront against the
 * LOCAL course_run table and never contacts SSG, so it both over-reports missing
 * dates (SSG may already hold them) and is blind to SSG runs the LMS never
 * recorded. Only the submit preview asks SSG, and only for the one course being
 * submitted — and only when that course has candidate dates, so a course whose
 * storefront is fully in step is never checked at all even if SSG holds extra
 * runs for it.
 *
 * Measured 1 Sep 2026 across 18 courses looked at by hand: 215 storefront dates
 * with no SSG run, and 46 SSG runs absent from the storefront. Extrapolating from
 * 18 of 306 courses is guesswork, hence this.
 *
 * CHUNKED because it costs one SSG call per course and SSG rate-limits at roughly
 * 20 rapid calls. Walk it with offset/limit until `next_offset` is null. Pacing
 * mirrors refresh-support-periods, which was tuned against the same API.
 *
 * Writes nothing. Submits nothing. Touches no course, run or session.
 */

const CONCURRENCY = 2;
const ROUND_GAP_MS = 300;
const MAX_RETRIES = 3;
const BACKOFF_BASE_MS = 1500;   // 1.5s, 3s, 6s
const TIME_BUDGET_MS = 50_000;
const DEFAULT_LIMIT = 25;
const MAX_LIMIT = 50;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const toISO = (d: unknown): string | null => {
  const v = String(d ?? '').trim();
  if (/^\d{8}$/.test(v)) return v.slice(0, 4) + '-' + v.slice(4, 6) + '-' + v.slice(6, 8);
  if (/^\d{4}-\d{2}-\d{2}/.test(v)) return v.slice(0, 10);
  return null;
};

const isRateLimited = (msg: string) =>
  /too many requests|rate limit|429/i.test(msg || '');

type CourseAudit = {
  course_code: string;
  resolved_course_code: string | null;
  title: string | null;
  funding_to: string | null;
  storefront_dates: number;
  ssg_runs: number;
  lms_upcoming: number;
  matched: number;
  storefront_only: { start_date: string; end_date: string; raw: string }[];
  ssg_only: { ssg_run_id: string | null; start_date: string; end_date: string }[];
  error?: string;
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

  const offset = Math.max(0, parseInt(String(req.query.offset ?? '0'), 10) || 0);
  const limit = Math.min(MAX_LIMIT, Math.max(1, parseInt(String(req.query.limit ?? DEFAULT_LIMIT), 10) || DEFAULT_LIMIT));
  const startedAt = Date.now();

  try {
    const today = sgtToday();

    // ── The storefront, once ─────────────────────────────────────────────────
    let magento;
    try {
      magento = await fetchMagentoSchedules();
    } catch (e) {
      return res.status(502).json({
        success: false,
        error: `Could not read the storefront schedule: ${e instanceof Error ? e.message : String(e)}`,
      });
    }

    // Future dates the storefront sells, per code, with the label.
    const sold = new Map<string, Map<string, string>>();
    for (const m of magento.courses || []) {
      const code = (m.course_code ?? '').trim();
      if (!code) continue;
      const byDates = sold.get(code) ?? new Map<string, string>();
      for (const s of m.schedules || []) {
        const st = s.course_start_date?.slice(0, 10);
        const en = s.course_end_date?.slice(0, 10);
        if (st && en && st >= today) byDates.set(`${st}|${en}`, String(s.raw ?? ''));
      }
      if (byDates.size > 0) sold.set(code, byDates);
    }

    // ── Reference data ───────────────────────────────────────────────────────
    const courses = new Map((await pool.query<{
      id: string; course_code: string; title: string | null; funding_to: string | null;
    }>(
      `SELECT c.id, c.course_code, c.title,
              to_char(c.ssg_wsq_support_to, 'YYYY-MM-DD') AS funding_to
         FROM course c WHERE c.course_code LIKE 'TGS-%'`,
    )).rows.map((r) => [r.course_code, r]));

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

    const lmsUpcoming = new Map<string, number>();
    for (const r of (await pool.query<{ course_code: string; n: string }>(
      `SELECT c.course_code, count(*)::text AS n
         FROM course c JOIN course_run cr ON cr.course_id = c.id
        WHERE c.course_code LIKE 'TGS-%'
          AND COALESCE(cr.is_deleted, false) = false
          AND cr.course_run_id NOT LIKE 'STAGED-%'
          AND cr.start_date >= CURRENT_DATE
        GROUP BY c.course_code`,
    )).rows) lmsUpcoming.set(r.course_code, Number(r.n));

    // Every storefront code with future dates, in a stable order so paging is safe.
    const allCodes = [...sold.keys()].sort();
    const slice = allCodes.slice(offset, offset + limit);

    if (slice.length === 0) {
      return res.status(200).json({
        success: true, offset, limit, total_courses: allCodes.length,
        checked: 0, next_offset: null, courses: [],
        message: 'Nothing left to audit at this offset.',
      });
    }

    // ── SSG credentials ──────────────────────────────────────────────────────
    const ssgCreds = await getSSGCredentialsService().getSSGCredentials(
      undefined, (req.headers['x-ssg-app'] as string) || undefined,
    );
    if (!ssgCreds) {
      return res.status(503).json({ success: false, error: 'SSG credentials not configured — cannot audit.' });
    }
    const ssgApi = createSSGCourseAPI(
      ssgCreds.ssgApiBaseUrl || process.env.SSG_API_URL || 'https://api.ssg-wsg.sg', ssgCreds,
    );

    // ── One paced SSG lookup per course ──────────────────────────────────────
    async function auditOne(code: string): Promise<CourseAudit> {
      const canonical = canonicalByAlias.get(code) ?? code;
      const course = courses.get(canonical);
      const soldFor = sold.get(code) ?? new Map<string, string>();

      const base: CourseAudit = {
        course_code: code,
        resolved_course_code: course ? course.course_code : null,
        title: course?.title ?? null,
        funding_to: course?.funding_to ?? null,
        storefront_dates: soldFor.size,
        ssg_runs: 0,
        lms_upcoming: lmsUpcoming.get(canonical) ?? 0,
        matched: 0,
        storefront_only: [],
        ssg_only: [],
      };

      let runs: any[] | null = null;
      for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
        const r = await ssgApi.searchCourseRunsByCode(code, { pageSize: 100, includeExpired: true })
          .catch((e: any) => ({ error: { message: e?.message || String(e) } } as any));
        const errMsg = r?.error?.message || r?.error?.code || '';
        if (errMsg) {
          if (isRateLimited(String(errMsg)) && attempt < MAX_RETRIES) {
            await sleep(BACKOFF_BASE_MS * Math.pow(2, attempt));
            continue;
          }
          return { ...base, error: String(errMsg).slice(0, 160) };
        }
        const data: any = (r.data as any)?.data ?? r.data;
        runs = data?.course?.runs ?? data?.runs ?? [];
        break;
      }
      if (runs === null) return { ...base, error: 'SSG did not answer' };

      const ssgFuture = new Map<string, string | null>();
      for (const run of runs) {
        const st = toISO(run?.courseStartDate ?? run?.courseDates?.start);
        const en = toISO(run?.courseEndDate ?? run?.courseDates?.end);
        if (!st || !en || st < today) continue;
        const id = run?.runId ?? run?.id ?? null;
        ssgFuture.set(`${st}|${en}`, id == null ? null : String(id));
      }
      base.ssg_runs = ssgFuture.size;

      for (const [key, raw] of soldFor) {
        if (ssgFuture.has(key)) { base.matched++; continue; }
        const [start_date, end_date] = key.split('|');
        base.storefront_only.push({ start_date, end_date, raw });
      }
      for (const [key, id] of ssgFuture) {
        if (soldFor.has(key)) continue;
        const [start_date, end_date] = key.split('|');
        base.ssg_only.push({ ssg_run_id: id, start_date, end_date });
      }
      base.storefront_only.sort((a, b) => a.start_date.localeCompare(b.start_date));
      base.ssg_only.sort((a, b) => a.start_date.localeCompare(b.start_date));
      return base;
    }

    const results: CourseAudit[] = [];
    let stoppedEarlyAt: number | null = null;
    for (let i = 0; i < slice.length; i += CONCURRENCY) {
      if (Date.now() - startedAt > TIME_BUDGET_MS) { stoppedEarlyAt = i; break; }
      const round = slice.slice(i, i + CONCURRENCY);
      results.push(...await Promise.all(round.map(auditOne)));
      if (i + CONCURRENCY < slice.length) await sleep(ROUND_GAP_MS);
    }

    const done = stoppedEarlyAt === null ? slice.length : stoppedEarlyAt;
    const nextOffset = offset + done >= allCodes.length ? null : offset + done;

    return res.status(200).json({
      success: true,
      generated_at: new Date().toISOString(),
      today,
      offset, limit,
      total_courses: allCodes.length,
      checked: results.length,
      next_offset: nextOffset,
      truncated_by_time_budget: stoppedEarlyAt !== null,
      totals: {
        storefront_only: results.reduce((s, r) => s + r.storefront_only.length, 0),
        ssg_only: results.reduce((s, r) => s + r.ssg_only.length, 0),
        matched: results.reduce((s, r) => s + r.matched, 0),
        errored: results.filter((r) => r.error).length,
      },
      courses: results,
    });
  } catch (err) {
    console.error('external/wsq-schedule-audit error:', err);
    return res.status(500).json({
      success: false,
      error: err instanceof Error ? err.message : 'Internal server error',
    });
  }
}
