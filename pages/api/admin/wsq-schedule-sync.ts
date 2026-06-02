import type { NextApiRequest, NextApiResponse } from 'next';
import pool from '../../../lib/db';

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
  rows: Row[];
};

let cache: { at: number; data: MagentoResponse } | null = null;
const CACHE_TTL_MS = 5 * 60 * 1000;

function ymd(d: string | null | Date): string | null {
  if (!d) return null;
  if (d instanceof Date) return d.toISOString().slice(0, 10);
  // pg returns date as 'YYYY-MM-DD' or full ISO depending on driver settings
  return String(d).slice(0, 10);
}

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

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
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

  // Today (Singapore calendar — but ymd diff is harmless either way)
  const today = new Date().toISOString().slice(0, 10);

  // Load local WSQ runs (only those ending today or in the future)
  const localResult = await pool.query<LocalRun>(
    `SELECT c.id AS course_id, c.course_code, c.title,
            cr.id AS run_id, cr.course_run_id AS ssg_run_id,
            cr.start_date, cr.end_date, cr.class_status::text AS class_status
       FROM course c
       LEFT JOIN course_run cr ON cr.course_id = c.id
            AND cr.is_deleted = false
            AND cr.end_date >= $1::date
            AND cr.course_run_id NOT LIKE 'STAGED-%'
      WHERE c.course_code LIKE 'TGS-%'
      ORDER BY c.course_code, cr.start_date NULLS LAST`,
    [today],
  );

  // Index local rows by course_code
  const localByCode = new Map<string, { course_id: string; title: string; runs: LocalRun[] }>();
  for (const row of localResult.rows) {
    const entry = localByCode.get(row.course_code) || { course_id: row.course_id, title: row.title, runs: [] };
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
    const local = localByCode.get(m.course_code);
    seenLocalCodes.add(m.course_code);

    // Match Magento schedules against local runs by (start, end)
    const localRuns = local?.runs ?? [];
    const matchedLocalRunIds = new Set<string>();

    const rows: Row[] = m.schedules.flatMap((s) => {
      if (!s.course_start_date || !s.course_end_date) {
        // Unparsed rows can't be date-filtered — keep them so admins still see them.
        countUnparsed++;
        return [{ source: 'magento' as const, raw: s.raw, start_date: s.course_start_date, end_date: s.course_end_date, status: 'unparsed' as const }];
      }
      // Hide schedules that have already ended.
      if (s.course_end_date < today) return [];
      const hit = localRuns.find((r) =>
        !matchedLocalRunIds.has(r.run_id!) &&
        ymd(r.start_date) === s.course_start_date &&
        ymd(r.end_date) === s.course_end_date,
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
        start_date: ymd(r.start_date),
        end_date: ymd(r.end_date),
        status: 'extra_in_ssg',
        local_run_id: r.run_id,
        ssg_run_id: r.ssg_run_id,
      });
    }

    groups.push({
      course_code: m.course_code,
      course_title: m.course_title,
      course_id: local?.course_id || null,
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
        start_date: ymd(r.start_date),
        end_date: ymd(r.end_date),
        status: 'extra_in_ssg',
        local_run_id: r.run_id,
        ssg_run_id: r.ssg_run_id,
      };
    });
    localOnly.push({ course_code: code, course_title: entry.title, course_id: entry.course_id, rows });
  }

  return res.status(200).json({
    generated_at: magento.generated_at,
    magento_count: magento.count,
    counts: { synced: countSynced, missing_in_ssg: countMissing, extra_in_ssg: countExtra, unparsed: countUnparsed },
    courses: [...groups, ...localOnly],
    cached: !forceRefresh && cache ? new Date(cache.at).toISOString() : null,
  });
}
