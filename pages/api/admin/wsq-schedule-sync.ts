import { withAuth } from '@lib/auth/withAuth';
import type { NextApiRequest, NextApiResponse } from 'next';
import pool from '../../../lib/db';
import { sgtToday } from '../../../lib/wsqScheduleSync';

type MagentoSchedule = {
  raw: string;
  course_start_date: string | null;
  course_end_date: string | null;
};

type MagentoCourse = {
  course_code: string;
  course_title: string;
  schedules: MagentoSchedule[];
};

type MagentoResponse = {
  generated_at: string;
  store: string;
  count: number;
  courses: MagentoCourse[];
};

type SyncStatus = 'synced' | 'missing_in_ssg' | 'extra_in_ssg' | 'unparsed';

type LocalRun = {
  course_id: string;
  course_code: string;
  title: string;
  run_id: string | null;
  ssg_run_id: string | null;
  start_date: string | null;
  end_date: string | null;
  class_status: string | null;
  wsq_support_from: string | null;
  wsq_support_to: string | null;
};

type Row = {
  source: 'magento' | 'ssg';
  raw?: string;
  start_date: string | null;
  end_date: string | null;
  status: SyncStatus;
  local_run_id?: string | null;
  ssg_run_id?: string | null;
};

type CourseGroup = {
  course_code: string;
  course_title: string;
  course_id: string | null;
  wsq_support_from: string | null;
  wsq_support_to: string | null;
  rows: Row[];
};

let cache: { at: number; data: MagentoResponse } | null = null;
const CACHE_TTL_MS = 5 * 60 * 1000;


async function fetchMagento(baseUrl: string, apiKey: string, forceRefresh: boolean): Promise<MagentoResponse> {
  if (!forceRefresh && cache && Date.now() - cache.at < CACHE_TTL_MS) {
    return cache.data;
  }
  const url = baseUrl.replace(/\/+$/, '') + '/courses/api_schedule';
  const resp = await fetch(url, {
    headers: { 'X-API-Key': apiKey, Accept: 'application/json' },
    cache: 'no-store',
  });
  if (!resp.ok) {
    const raw = await resp.text();
    let body: any = raw;
    try { body = JSON.parse(raw); } catch { /* keep raw text */ }
    const err: any = new Error(`Magento API ${resp.status}: ${typeof body === 'string' ? body.slice(0, 200) : (body?.error || JSON.stringify(body).slice(0, 200))}`);
    err.status = resp.status;
    err.body = body;
    throw err;
  }
  const raw = await resp.text();
  let data: MagentoResponse;
  try {
    data = JSON.parse(raw) as MagentoResponse;
  } catch (e: any) {
    const err: any = new Error(`Magento returned non-JSON (${raw.slice(0, 120)}…)`);
    err.status = 502;
    err.body = raw.slice(0, 1000);
    throw err;
  }
  cache = { at: Date.now(), data };
  return data;
}

async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', ['GET']);
    return res.status(405).json({ error: 'Method not allowed' });
  }

  // Load credentials from training_provider (single-row tenant pattern)
  let baseUrl = '';
  let apiKey = '';
  try {
    const r = await pool.query(
      `SELECT tertiary_courses_sg_url, tertiary_courses_sg_api_key, magento_backend_url
         FROM training_provider LIMIT 1`,
    );
    baseUrl = r.rows[0]?.tertiary_courses_sg_url || r.rows[0]?.magento_backend_url || '';
    apiKey = r.rows[0]?.tertiary_courses_sg_api_key || '';
  } catch (e) {
    return res.status(500).json({ error: 'db_error', message: (e as Error).message });
  }

  if (!baseUrl || !apiKey) {
    return res.status(503).json({
      error: 'not_configured',
      message: 'Tertiary Courses SG URL or API key is not configured. Set it in Company Settings → Integrations → Tertiary Courses SG.',
    });
  }

  const forceRefresh = req.query.refresh === '1';
  // include_past: also show past-dated schedules/runs (the "Show past classes"
  // toggle) so failed syncs for yesterday-and-earlier can be reviewed / retried.
  const includePast = req.query.include_past === '1' || req.query.include_past === 'true';

  let magento: MagentoResponse;
  try {
    magento = await fetchMagento(baseUrl, apiKey, forceRefresh);
  } catch (e: any) {
    return res.status(e.status && e.status >= 400 && e.status < 600 ? e.status : 502).json({
      error: 'upstream_error',
      status: e.status || null,
      body: e.body || null,
      message: e.message,
    });
  }

  // "Today" in Asia/Singapore — the single reference date for hiding past-dated
  // schedules (matches the crons + the UI toggle). include_past shows them anyway.
  const today = sgtToday();

  // Load local WSQ runs (only those ending today or in the future, unless include_past)
  const localResult = await pool.query<LocalRun>(
    `SELECT c.id AS course_id, c.course_code, c.title,
            to_char(c.ssg_wsq_support_from, 'YYYY-MM-DD') AS wsq_support_from,
            to_char(c.ssg_wsq_support_to,   'YYYY-MM-DD') AS wsq_support_to,
            cr.id AS run_id, cr.course_run_id AS ssg_run_id,
            to_char(cr.start_date, 'YYYY-MM-DD') AS start_date,
            to_char(cr.end_date,   'YYYY-MM-DD') AS end_date,
            cr.class_status::text AS class_status
       FROM course c
       LEFT JOIN course_run cr ON cr.course_id = c.id
            AND cr.is_deleted = false
            AND ($2 OR cr.end_date >= $1::date)
            AND cr.course_run_id NOT LIKE 'STAGED-%'
      WHERE c.course_code LIKE 'TGS-%'
      ORDER BY c.course_code, cr.start_date NULLS LAST`,
    [today, includePast],
  );

  // Index local rows by course_code, carrying the support period from the course row
  const localByCode = new Map<string, { course_id: string; title: string; runs: LocalRun[]; wsq_support_from: string | null; wsq_support_to: string | null }>();
  for (const row of localResult.rows) {
    const existing = localByCode.get(row.course_code);
    const entry = existing || {
      course_id: row.course_id,
      title: row.title,
      runs: [],
      wsq_support_from: row.wsq_support_from ?? null,
      wsq_support_to: row.wsq_support_to ?? null,
    };
    if (row.run_id) entry.runs.push(row);
    localByCode.set(row.course_code, entry);
  }

  let countSynced = 0;
  let countMissing = 0;
  let countExtra = 0;
  let countUnparsed = 0;

  const groups: CourseGroup[] = [];
  const seenLocalCodes = new Set<string>();

  for (const m of magento.courses) {
    // MMS occasionally sends course codes with stray whitespace (e.g. a trailing
    // tab), which breaks exact-match lookups against the local course table.
    const courseCode = (m.course_code ?? '').trim();
    const local = localByCode.get(courseCode);
    seenLocalCodes.add(courseCode);

    // Match Magento schedules against local runs by (start, end)
    const localRuns = local?.runs ?? [];
    const matchedLocalRunIds = new Set<string>();

    const rows: Row[] = m.schedules.flatMap((s) => {
      if (!s.course_start_date || !s.course_end_date) {
        // Unparsed rows can't be date-filtered — keep them so admins still see them.
        countUnparsed++;
        return [{ source: 'magento' as const, raw: s.raw, start_date: s.course_start_date, end_date: s.course_end_date, status: 'unparsed' as const }];
      }
      // Hide schedules that have already ended or already started (SSG rejects a
      // past start date) — unless include_past is set (to review/retry past ones).
      if (!includePast) {
        if (s.course_end_date < today) return [];
        if (s.course_start_date && s.course_start_date < today) return [];
      }
      // Normalise Magento dates to YYYY-MM-DD (strip any trailing time component).
      // DB dates come from to_char() so are already clean strings.
      const mStart = s.course_start_date?.slice(0, 10) ?? null;
      const mEnd   = s.course_end_date?.slice(0, 10)   ?? null;

      // Prefer an unmatched run first; fall back to any run with matching dates
      // so duplicate Magento schedule entries for the same dates still resolve
      // to synced rather than missing.
      const hit =
        localRuns.find((r) =>
          !matchedLocalRunIds.has(r.run_id!) &&
          r.start_date === mStart &&
          r.end_date   === mEnd,
        ) ??
        localRuns.find((r) =>
          r.start_date === mStart &&
          r.end_date   === mEnd,
        );
      if (hit) {
        matchedLocalRunIds.add(hit.run_id!);
        countSynced++;
        return [{
          source: 'magento' as const,
          raw: s.raw,
          start_date: s.course_start_date,
          end_date: s.course_end_date,
          status: 'synced' as const,
          local_run_id: hit.run_id,
          ssg_run_id: hit.ssg_run_id,
        }];
      }
      countMissing++;
      return [{
        source: 'magento' as const,
        raw: s.raw,
        start_date: s.course_start_date,
        end_date: s.course_end_date,
        status: 'missing_in_ssg' as const,
      }];
    });

    // Local runs that didn't match any Magento schedule → extra
    for (const r of localRuns) {
      if (matchedLocalRunIds.has(r.run_id!)) continue;
      countExtra++;
      rows.push({
        source: 'ssg',
        start_date: r.start_date,
        end_date: r.end_date,
        status: 'extra_in_ssg',
        local_run_id: r.run_id,
        ssg_run_id: r.ssg_run_id,
      });
    }

    groups.push({
      course_code: courseCode,
      course_title: m.course_title,
      course_id: local?.course_id || null,
      wsq_support_from: local?.wsq_support_from || null,
      wsq_support_to: local?.wsq_support_to || null,
      rows,
    });
  }

  // Courses present locally but not in Magento (informational — small section)
  const localOnly: CourseGroup[] = [];
  for (const [code, entry] of localByCode.entries()) {
    if (seenLocalCodes.has(code)) continue;
    if (entry.runs.length === 0) continue;
    const rows: Row[] = entry.runs.map((r) => {
      countExtra++;
      return {
        source: 'ssg',
        start_date: r.start_date,
        end_date: r.end_date,
        status: 'extra_in_ssg',
        local_run_id: r.run_id,
        ssg_run_id: r.ssg_run_id,
      };
    });
    localOnly.push({
      course_code: code, course_title: entry.title, course_id: entry.course_id,
      wsq_support_from: entry.wsq_support_from, wsq_support_to: entry.wsq_support_to,
      rows,
    });
  }

  return res.status(200).json({
    generated_at: magento.generated_at,
    magento_count: magento.count,
    today,
    include_past: includePast,
    counts: {
      synced: countSynced,
      missing_in_ssg: countMissing,
      extra_in_ssg: countExtra,
      unparsed: countUnparsed,
    },
    courses: [...groups, ...localOnly],
    cached: !forceRefresh && cache ? new Date(cache.at).toISOString() : null,
  });
}

export default withAuth(handler, { roles: ['admin', 'trainingProvider', 'developer'] });
