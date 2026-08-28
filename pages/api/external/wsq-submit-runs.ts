import type { NextApiRequest, NextApiResponse } from 'next';
import pool from '../../../lib/db';
import { startWsqSyncJob, buildRunSessions, newSessionBuildCache, VENUE, modeOfTrainingName }
  from '../admin/wsq-schedule-sync/run-sync';
import { fetchMagentoSchedules, sgtToday } from '../../../lib/wsqScheduleSync';
import { getSSGCredentialsService } from '../../../lib/ssg/services/credentials-service';
import { createSSGCourseAPI } from '../../../lib/ssg/api/course-api';

/**
 * External API — submit a SPECIFIC set of course runs to SSG.
 *
 * Intended caller: OpenClaw agents, after showing a human the gap from
 * /api/external/wsq-schedule-gap and being told to go ahead.
 *
 * Why this exists when two sync endpoints already do:
 *   auto-sync-wsq-schedule  skips any date that has EVER failed
 *   auto-retry-wsq-blocked  retries only eligibility failures
 * Measured 26 Aug 2026: of 712 dates that are genuinely submittable, those two
 * endpoints between them would pick up 4. The other 708 last failed with
 * "Course not found in LMS" — a message left over from before renewal course
 * codes resolved, and one that neither cron will ever retry. They are stranded,
 * and the only thing that can submit them is an explicit list, which is what the
 * WSQ Schedule Sync screen's button passes and what this endpoint accepts.
 *
 * PUBLISHES REAL COURSE RUNS TO A GOVERNMENT SYSTEM. Two guards:
 *
 *  1. DRY RUN BY DEFAULT. Without `confirm: true` nothing is submitted; the
 *     response says exactly what would be. The agent contract is "ask a human
 *     first", and a rule that lives only in a skill file is a rule the model can
 *     talk itself out of — so it is enforced here instead.
 *  2. ELIGIBILITY IS RE-DERIVED SERVER-SIDE, never trusted from the caller. A
 *     date is submitted only if its course resolves, has a session timing
 *     template, has a funding window covering the start date, is actually sold
 *     on the storefront, and has no local run already. Anything else is returned
 *     as `rejected` with a reason and is NOT sent to SSG.
 *  3. SSG ITSELF IS ASKED before anything is submitted. The local course_run
 *     table is NOT a reliable mirror of SSG — verified 26 Aug 2026 on
 *     TGS-2026064861, where SSG held 9 published runs and the LMS knew about 1.
 *     A local-only duplicate check therefore passes dates SSG already has, and
 *     submitting one creates a duplicate run in a government system that has to
 *     be removed by hand. Every course is looked up in SSG first, and if that
 *     lookup fails the whole request is refused rather than submitted blind.
 *
 * Auth: header  x-api-key: <EXTERNAL_API_KEY_FOR_CLAWDBOT>
 *
 * POST /api/external/wsq-submit-runs
 * Body:
 *   { "course_code": "TGS-2026064861", "confirm": true }         all its submittable dates
 *   { "items": [{ "course_code": "...", "start_date": "2026-09-04",
 *                 "end_date": "2026-09-07" }], "confirm": true } specific dates
 *   omit `confirm` to preview.
 *
 * Responses:
 *   200 { success:true, dry_run:true,  would_submit:[…], rejected:[…] }
 *   200 { success:true, dry_run:false, job_id, submitting:N, rejected:[…] }
 *   400 { success:false, error }   nothing eligible / bad input
 *   401 { success:false, error }
 *   409 { success:false, error, job_id }   a sync is already running
 */

const MAX_ITEMS = 250;

// `raw` is the storefront's own label for the run ("5/12/13/19/26 Sep 2026
// (Sat/Sun)"). It is the ONLY thing that states the individual teaching days —
// start and end alone cannot express a run taught on five scattered Saturdays —
// and run-sync reads it when building sessions. Dropping it here would silently
// put three of that run's five classes on days nobody attends.
type Item = { course_code: string; start_date: string; end_date: string; raw?: string };
type Rejected = Item & { reason: string };

const isDate = (s: unknown) => /^\d{4}-\d{2}-\d{2}$/.test(String(s ?? ''));

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

  const body = req.body ?? {};
  const confirm = body.confirm === true;
  const onlyCourse = String(body.course_code ?? '').trim().toUpperCase();
  const rawItems: any[] = Array.isArray(body.items) ? body.items : [];

  if (!onlyCourse && rawItems.length === 0) {
    return res.status(400).json({ success: false, error: 'Provide either course_code or items[].' });
  }
  if (rawItems.length > MAX_ITEMS) {
    return res.status(400).json({ success: false, error: `Too many items (${rawItems.length}). Maximum ${MAX_ITEMS} per call.` });
  }

  try {
    const today = sgtToday();

    // ── Reference data ────────────────────────────────────────────────────────
    const courses = new Map((await pool.query<{
      id: string; course_code: string; title: string | null; funding_to: string | null; has_timing: boolean;
    }>(
      `SELECT c.id, c.course_code, c.title,
              to_char(c.ssg_wsq_support_to, 'YYYY-MM-DD') AS funding_to,
              EXISTS (SELECT 1 FROM course_session_timing t WHERE t.course_code = c.course_code) AS has_timing
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

    const existingRuns = new Map<string, Set<string>>();
    for (const r of (await pool.query<{ course_code: string; s: string; e: string }>(
      `SELECT c.course_code,
              to_char(cr.start_date, 'YYYY-MM-DD') AS s,
              to_char(cr.end_date,   'YYYY-MM-DD') AS e
         FROM course c JOIN course_run cr ON cr.course_id = c.id
        WHERE c.course_code LIKE 'TGS-%'
          AND COALESCE(cr.is_deleted, false) = false
          AND cr.course_run_id NOT LIKE 'STAGED-%'
          AND cr.end_date >= CURRENT_DATE`,
    )).rows) {
      if (!existingRuns.has(r.course_code)) existingRuns.set(r.course_code, new Set());
      existingRuns.get(r.course_code)!.add(`${r.s}|${r.e}`);
    }

    // The storefront is the authority on what we actually sell. Submitting a date
    // that is not on it would publish a class nobody can book.
    let magento;
    try {
      magento = await fetchMagentoSchedules();
    } catch (e) {
      return res.status(502).json({
        success: false,
        error: `Could not read the storefront schedule: ${e instanceof Error ? e.message : String(e)}`,
      });
    }
    // date-pair -> the label describing it, so an explicit items[] request can
    // recover the label the caller had no way of supplying.
    const soldDates = new Map<string, Map<string, string>>();
    for (const m of magento.courses || []) {
      const code = (m.course_code ?? '').trim();
      if (!code) continue;
      const byDates = soldDates.get(code) ?? new Map<string, string>();
      for (const s of m.schedules || []) {
        const st = s.course_start_date?.slice(0, 10);
        const en = s.course_end_date?.slice(0, 10);
        if (st && en) byDates.set(`${st}|${en}`, String(s.raw ?? ''));
      }
      soldDates.set(code, byDates);
    }

    // ── Build the candidate list ──────────────────────────────────────────────
    let candidates: Item[];
    if (rawItems.length > 0) {
      candidates = rawItems.map((i) => {
        const course_code = String(i?.course_code ?? '').trim();
        const start_date = String(i?.start_date ?? '').trim();
        const end_date = String(i?.end_date ?? '').trim();
        return {
          course_code,
          start_date,
          end_date,
          raw: soldDates.get(course_code)?.get(`${start_date}|${end_date}`),
        };
      });
    } else {
      candidates = [];
      for (const [code, byDates] of soldDates.entries()) {
        if (code.toUpperCase() !== onlyCourse) continue;
        for (const [d, raw] of byDates.entries()) {
          const [start_date, end_date] = d.split('|');
          candidates.push({ course_code: code, start_date, end_date, raw });
        }
      }
      if (candidates.length === 0) {
        return res.status(400).json({ success: false, error: `${onlyCourse} is not on the storefront schedule.` });
      }
    }

    // ── Re-derive eligibility for every candidate ─────────────────────────────
    const accepted: Item[] = [];
    const rejected: Rejected[] = [];
    const seen = new Set<string>();

    for (const it of candidates) {
      const reject = (reason: string) => rejected.push({ ...it, reason });

      if (!it.course_code) { reject('course_code missing'); continue; }
      if (!isDate(it.start_date) || !isDate(it.end_date)) { reject('start_date/end_date must be YYYY-MM-DD'); continue; }
      if (it.end_date < it.start_date) { reject('end_date is before start_date'); continue; }
      if (it.start_date < today) { reject('start date is in the past — SSG rejects past-dated runs'); continue; }

      const key = `${it.course_code}|${it.start_date}|${it.end_date}`;
      if (seen.has(key)) { reject('duplicate entry in this request'); continue; }
      seen.add(key);

      if (!soldDates.get(it.course_code)?.has(`${it.start_date}|${it.end_date}`)) {
        reject('not sold on the storefront for these exact dates'); continue;
      }
      // Prefer the storefront's label over anything the caller supplied.
      it.raw = soldDates.get(it.course_code)!.get(`${it.start_date}|${it.end_date}`) || it.raw;

      const canonical = canonicalByAlias.get(it.course_code) ?? it.course_code;
      const course = courses.get(canonical);
      if (!course) { reject('course does not resolve to any LMS course, even via course_code_history'); continue; }
      if (!course.has_timing) { reject('course has no session timing template — no sessions could be built'); continue; }
      if (!course.funding_to) { reject('no funding window on record (CASL/IBF funding may not be readable yet)'); continue; }
      if (it.start_date > course.funding_to) {
        reject(`start date is after the funding support period ends (${course.funding_to}) — SSG will reject it`); continue;
      }
      if (existingRuns.get(canonical)?.has(`${it.start_date}|${it.end_date}`)) {
        reject('a run already exists locally for these dates'); continue;
      }

      accepted.push(it);
    }

    if (accepted.length === 0) {
      return res.status(400).json({
        success: false,
        error: 'Nothing eligible to submit.',
        rejected,
      });
    }

    // ── Guard 3: ask SSG what it already has ──────────────────────────────────
    // One lookup per distinct storefront code, using the code the storefront
    // sells under — that is the reference number SSG holds the runs against.
    const ssgCreds = await getSSGCredentialsService().getSSGCredentials(
      undefined, (req.headers['x-ssg-app'] as string) || undefined,
    );
    if (!ssgCreds) {
      return res.status(503).json({ success: false, error: 'SSG credentials not configured — cannot check for duplicates, so nothing was submitted.' });
    }
    const ssgApi = createSSGCourseAPI(ssgCreds.ssgApiBaseUrl || process.env.SSG_API_URL || 'https://api.ssg-wsg.sg', ssgCreds);

    const toISO = (d: unknown): string | null => {
      const v = String(d ?? '').trim();
      if (/^\d{8}$/.test(v)) return v.slice(0, 4) + '-' + v.slice(4, 6) + '-' + v.slice(6, 8);
      if (/^\d{4}-\d{2}-\d{2}/.test(v)) return v.slice(0, 10);
      return null;
    };

    const ssgDates = new Map<string, Set<string>>();
    for (const code of new Set(accepted.map((a) => a.course_code))) {
      const r = await ssgApi.searchCourseRunsByCode(code, { pageSize: 100, includeExpired: true });
      if (r.error?.code || r.error?.message) {
        // Refusing beats guessing: without SSG's answer we cannot rule out duplicates.
        return res.status(502).json({
          success: false,
          error: `Could not ask SSG what runs already exist for ${code}: ${r.error.message || r.error.code}. Nothing was submitted.`,
        });
      }
      const data: any = (r.data as any)?.data ?? r.data;
      const runs: any[] = data?.course?.runs ?? data?.runs ?? [];
      const set = new Set<string>();
      for (const run of runs) {
        const st = toISO(run?.courseStartDate ?? run?.courseDates?.start);
        const en = toISO(run?.courseEndDate ?? run?.courseDates?.end);
        if (st && en) set.add(st + '|' + en);
      }
      ssgDates.set(code, set);
    }

    const confirmed: Item[] = [];
    for (const it of accepted) {
      if (ssgDates.get(it.course_code)?.has(it.start_date + '|' + it.end_date)) {
        rejected.push({ ...it, reason: 'SSG already has a published run for these dates — submitting would create a duplicate' });
      } else {
        confirmed.push(it);
      }
    }

    // Build each run's ACTUAL sessions now, using the same function the real
    // submission uses. Two reasons this belongs in the preview and not only at
    // submit time:
    //   1. A person approving a run is accountable for what reaches a government
    //      system. Approving bare dates and taking the times on trust is not an
    //      informed approval - they need to see that "1/4 Jan (Fri/Mon)" produces
    //      sessions on the 1st and the 4th, and at what times.
    //   2. It makes the preview honest. Anything whose sessions cannot be built
    //      is refused HERE with its reason, rather than being previewed as ready
    //      and then failing silently inside the background job.
    const sessionCache = newSessionBuildCache();
    const previewed: (Item & {
      venue: typeof VENUE;
      teaching_days: number;
      sessions: { date: string; start_time: string; end_time: string; mode_of_training: string; mode: string }[];
    })[] = [];
    for (const it of confirmed) {
      const canonical = canonicalByAlias.get(it.course_code) ?? it.course_code;
      const course = courses.get(canonical);
      if (!course) { rejected.push({ ...it, reason: 'course not found in LMS' }); continue; }
      const built = await buildRunSessions(
        course.id, it.course_code, it.start_date, it.end_date, it.raw, sessionCache,
      );
      if (!built.ok) { rejected.push({ ...it, reason: built.reason }); continue; }
      previewed.push({
        ...it,
        venue: VENUE,
        teaching_days: new Set(built.sessions.map((x) => x.startDate)).size,
        sessions: built.sessions.map((x) => ({
          date: x.startDate,
          start_time: x.startTime,
          end_time: x.endTime,
          mode_of_training: x.modeOfTraining,
          mode: modeOfTrainingName(x.modeOfTraining),
        })),
      });
    }

    if (previewed.length === 0) {
      return res.status(400).json({
        success: false,
        error: confirmed.length === 0
          ? 'Nothing left to submit — SSG already has a run for every date requested.'
          : 'Nothing left to submit — no run could have its sessions built. See rejected for the reason on each.',
        rejected,
      });
    }

    // ── Guard 1: dry run unless explicitly confirmed ──────────────────────────
    if (!confirm) {
      return res.status(200).json({
        success: true,
        dry_run: true,
        message:
          `${previewed.length} run(s) would be submitted to SSG. Nothing has been sent. ` +
          `Each entry lists the exact teaching dates, session times and venue that would be created — ` +
          `show those to a human, and re-send the same request with "confirm": true only if they agree.`,
        would_submit: previewed,
        rejected,
      });
    }

    // Positive branch first so the discriminated union narrows cleanly.
    const result = await startWsqSyncJob(
      previewed.map(({ course_code, start_date, end_date, raw }) => ({ course_code, start_date, end_date, raw })),
      'user',
    );

    if (result.started) {
      return res.status(200).json({
        success: true,
        dry_run: false,
        job_id: result.jobId,
        submitting: previewed.length,
        rejected,
        message:
          `Submitting ${previewed.length} run(s) to SSG in the background. ` +
          `Poll GET /api/external/wsq-sync-status?job_id=${result.jobId} for the outcome — ` +
          `do not report success until that says the job completed.`,
      });
    }

    if (result.reason === 'already_running') {
      return res.status(409).json({
        success: false,
        error: 'A WSQ sync is already running. Wait for it to finish, then check /api/external/wsq-sync-status.',
        job_id: result.jobId,
      });
    }

    return res.status(500).json({ success: false, error: result.message || 'Could not start the sync job.' });
  } catch (err) {
    console.error('external/wsq-submit-runs error:', err);
    return res.status(500).json({
      success: false,
      error: err instanceof Error ? err.message : 'Internal server error',
    });
  }
}
