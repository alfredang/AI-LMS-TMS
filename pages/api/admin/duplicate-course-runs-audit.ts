import { withAuth } from '@lib/auth/withAuth';
import type { NextApiRequest, NextApiResponse } from 'next';
import pool from '../../../lib/db';
import { createSSGCourseAPI } from '../../../lib/ssg/api/course-api';
import { createSSGEnrolmentAPI } from '../../../lib/ssg/api/enrolment-api';
import { getSSGCredentialsService } from '../../../lib/ssg/services/credentials-service';
import { getTrainingPartnerIdentifiers } from '../../../lib/trainingPartnerIdentifiers';

const ENROLMENT_PAGE_SIZE = 100;
const MAX_ENROLMENT_PAGES = 20;
const MAX_RUNS_TO_AUDIT = 20;
const MAX_FOCUS_RUN_IDS = 20;

type SsgRun = {
  course_run_id: string;
  start_date: string | null;
  end_date: string | null;
  mode_of_training: string | null;
  vacancy_code: string | null;
  vacancy_description: string | null;
  public_visibility: string | null;
  in_lms: boolean;
  local_enrolment_count: number;
  ssg_enrolment_count: number;
  active_ssg_enrolment_count: number;
  ssg_enrolment_error?: string;
};

type DuplicateGroup = {
  key: string;
  start_date: string;
  end_date: string;
  runs: SsgRun[];
  classification:
    | 'both_have_enrolments'
    | 'one_has_enrolments'
    | 'no_enrolments'
    | 'mixed_unknown'
    | 'not_duplicate';
  keep_run_id: string | null;
  hide_candidates: string[];
  already_hidden_candidates: string[];
  action: string;
};

function toIsoDate(value: unknown): string | null {
  const text = String(value ?? '').trim();
  if (!text) return null;
  if (/^\d{8}$/.test(text)) return `${text.slice(0, 4)}-${text.slice(4, 6)}-${text.slice(6, 8)}`;
  if (/^\d{4}-\d{2}-\d{2}/.test(text)) return text.slice(0, 10);
  return null;
}

function singaporeTodayIso(): string {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Singapore',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date());
  const byType = new Map(parts.map((part) => [part.type, part.value]));
  return `${byType.get('year')}-${byType.get('month')}-${byType.get('day')}`;
}

function isInactiveEnrolmentStatus(status: unknown): boolean {
  const value = String(status ?? '').trim().toLowerCase();
  return value === 'admin removed' || value === 'cancelled' || value === 'canceled' || value === 'withdrawn';
}

function unwrapEnrolment(row: any): any {
  return row?.enrolment ?? row;
}

function extractRunId(run: any): string {
  return String(run?.id ?? run?.runId ?? run?.courseRunId ?? '').trim();
}

function extractCourseCode(course: any, run: any): string {
  return String(
    course?.referenceNumber ??
      course?.courseReferenceNumber ??
      course?.externalReferenceNumber ??
      run?.courseReferenceNumber ??
      run?.course?.referenceNumber ??
      ''
  ).trim().toUpperCase();
}

function extractVisibility(run: any): string | null {
  const candidates = [
    run?.showToPublic,
    run?.shownToPublic,
    run?.isShownToPublic,
    run?.visibleToPublic,
    run?.isVisibleToPublic,
    run?.publishToPublic,
    run?.publishedToPublic,
    run?.mySkillsFuturePageStatus,
    run?.myskillsfuturePageStatus,
    run?.courseRunStatus,
    run?.status,
  ];
  for (const value of candidates) {
    if (value === undefined || value === null || value === '') continue;
    if (typeof value === 'object') {
      const nested = value.description ?? value.code ?? value.value;
      if (nested !== undefined && nested !== null && nested !== '') return String(nested);
    }
    return String(value);
  }
  return null;
}

function normalizeVisibility(value: unknown): string | null {
  const text = String(value ?? '').trim();
  if (!text) return null;
  const normalized = text.replace(/[_-]+/g, ' ').replace(/\s+/g, ' ').toUpperCase();
  if (normalized.includes('NOT SHOWN') || normalized.includes('DO NOT SHOW') || normalized.includes('DONOTSHOW')) {
    return 'NOT SHOWN TO PUBLIC';
  }
  if (normalized.includes('SHOWN TO PUBLIC') || normalized.includes('SHOW TO PUBLIC')) {
    return 'SHOWN TO PUBLIC';
  }
  return text;
}

function isHiddenFromPublic(value: unknown): boolean {
  return normalizeVisibility(value) === 'NOT SHOWN TO PUBLIC';
}

function isShownToPublic(value: unknown): boolean {
  return normalizeVisibility(value) === 'SHOWN TO PUBLIC';
}

function detectVisibilityNearRun(row: any): string | null {
  const candidates: unknown[] = [
    row?.showToPublic,
    row?.shownToPublic,
    row?.isShownToPublic,
    row?.visibleToPublic,
    row?.isVisibleToPublic,
    row?.publishToPublic,
    row?.publishedToPublic,
    row?.mySkillsFuturePageStatus,
    row?.myskillsfuturePageStatus,
    row?.courseRunStatus,
    row?.displayStatus,
    row?.publicDisplayStatus,
    row?.visibility,
    row?.status,
    row?.updateType,
  ];
  for (const candidate of candidates) {
    const normalized = normalizeVisibility(typeof candidate === 'object' && candidate !== null
      ? (candidate as any).description ?? (candidate as any).code ?? (candidate as any).value
      : candidate);
    if (normalized === 'SHOWN TO PUBLIC' || normalized === 'NOT SHOWN TO PUBLIC') return normalized;
  }

  const text = JSON.stringify(row);
  if (/NOT\s+SHOWN\s+TO\s+PUBLIC|DO\s*NOT\s*SHOW|DoNotShow/i.test(text)) return 'NOT SHOWN TO PUBLIC';
  if (/SHOWN\s+TO\s+PUBLIC|Show/i.test(text)) return 'SHOWN TO PUBLIC';
  return null;
}

function collectTpgVisibilityFromJson(payload: any, runIds: string[]): Map<string, string> {
  const targets = new Set(runIds);
  const candidates = new Map<string, Array<{ visibility: string; size: number }>>();

  function visit(node: any) {
    if (!node || typeof node !== 'object') return;
    const text = JSON.stringify(node);
    const visibility = detectVisibilityNearRun(node);
    if (visibility) {
      for (const runId of targets) {
        if (text.includes(runId)) {
          if (!candidates.has(runId)) candidates.set(runId, []);
          candidates.get(runId)!.push({ visibility, size: text.length });
        }
      }
    }
    if (Array.isArray(node)) {
      for (const child of node) visit(child);
    } else {
      for (const child of Object.values(node)) visit(child);
    }
  }

  visit(payload);
  const result = new Map<string, string>();
  for (const [runId, matches] of candidates.entries()) {
    matches.sort((a, b) => a.size - b.size);
    result.set(runId, matches[0].visibility);
  }
  return result;
}

async function fetchTpgatewayVisibility(courseReferenceNumber: string, runIds: string[]): Promise<Map<string, string>> {
  const cookie = String(process.env.TPGATEWAY_COOKIE || '').trim();
  const xsrfToken = String(process.env.TPGATEWAY_XSRF_TOKEN || '').trim();
  if (!cookie.trim() || runIds.length === 0) return new Map();

  const baseUrl = process.env.TPGATEWAY_BASE_URL || 'https://ds.tpgateway.gov.sg';
  const response = await fetch(`${baseUrl}/services/tex/tp/course-runs`, {
    method: 'POST',
    headers: {
      accept: 'application/json, text/plain, */*',
      'content-type': 'application/json',
      cookie,
      ...(xsrfToken ? { 'x-xsrf-token': xsrfToken } : {}),
      origin: baseUrl,
      referer: `${baseUrl}/`,
    },
    body: JSON.stringify({
      action: 'list',
      data: {
        courseReferenceNumber,
        limit: 100,
        offset: 0,
        ssecEQAExcludes: ['X', 'XX', 'XXX', 'XXXX', '0', 'N'],
      },
    }),
  });

  if (!response.ok) return new Map();
  const json = await response.json().catch(() => null);
  return collectTpgVisibilityFromJson(json, runIds);
}

async function fetchSsgEnrolmentsForRun(
  api: ReturnType<typeof createSSGEnrolmentAPI>,
  tpUen: string,
  tpCode: string,
  runId: string
): Promise<{ total: number; active: number; error?: string }> {
  let total = 0;
  let active = 0;

  for (let page = 0; page < MAX_ENROLMENT_PAGES; page++) {
    const result = await api.searchEnrolment({
      meta: { pageSize: ENROLMENT_PAGE_SIZE, pageIndex: page },
      enrolment: {
        course: { run: { id: runId } },
        trainingPartner: { uen: tpUen, code: tpCode },
      },
      parameters: { page, pageSize: ENROLMENT_PAGE_SIZE },
    } as any);

    if (result.error) {
      const status = Number(result.status) || 0;
      if (status === 404) return { total, active };
      return {
        total,
        active,
        error: `SSG enrolment search failed (${status || 'unknown'}): ${result.error.message || result.error.code || 'Unknown error'}`,
      };
    }

    const rows: any[] = Array.isArray(result.data)
      ? result.data
      : Array.isArray((result.data as any)?.enrolment)
        ? (result.data as any).enrolment
        : [];

    if (rows.length === 0) return { total, active };
    for (const row of rows) {
      const enrolment = unwrapEnrolment(row);
      total++;
      if (!isInactiveEnrolmentStatus(enrolment?.status)) active++;
    }
    if (rows.length < ENROLMENT_PAGE_SIZE) return { total, active };
    await new Promise((resolve) => setTimeout(resolve, 250));
  }

  return { total, active, error: `Stopped after ${MAX_ENROLMENT_PAGES} enrolment pages; counts may be partial.` };
}

function chooseKeepRun(runs: SsgRun[]): string | null {
  const sorted = [...runs].sort((a, b) => {
    const activeDiff = b.active_ssg_enrolment_count - a.active_ssg_enrolment_count;
    if (activeDiff !== 0) return activeDiff;
    const localDiff = Number(b.in_lms) - Number(a.in_lms);
    if (localDiff !== 0) return localDiff;
    const localCountDiff = b.local_enrolment_count - a.local_enrolment_count;
    if (localCountDiff !== 0) return localCountDiff;
    return Number(b.course_run_id) - Number(a.course_run_id);
  });
  return sorted[0]?.course_run_id ?? null;
}

function classifyGroup(key: string, runs: SsgRun[]): DuplicateGroup {
  const [start_date, end_date] = key.split('|');
  const withActive = runs.filter((run) => run.active_ssg_enrolment_count > 0);
  const errored = runs.some((run) => run.ssg_enrolment_error);
  const keepRunId = chooseKeepRun(runs);
  let classification: DuplicateGroup['classification'];
  let action: string;

  if (runs.length < 2) {
    classification = 'not_duplicate';
    action = 'No duplicate action needed.';
  } else if (errored) {
    classification = 'mixed_unknown';
    action = 'Review manually because at least one live SSG enrolment check failed.';
  } else if (withActive.length > 1) {
    classification = 'both_have_enrolments';
    action = 'Do not hide from this audit. More than one duplicate run has active SSG enrolments.';
  } else if (withActive.length === 1) {
    classification = 'one_has_enrolments';
    action = 'Only runs with zero active SSG enrolments and confirmed public visibility are listed as hide candidates.';
  } else {
    classification = 'no_enrolments';
    action = 'No active SSG enrolments found. Only confirmed public duplicates are listed as hide candidates.';
  }

  const canSuggestHide =
    classification === 'one_has_enrolments' || classification === 'no_enrolments';

  return {
    key,
    start_date,
    end_date,
    runs,
    classification,
    keep_run_id: keepRunId,
    hide_candidates: keepRunId && canSuggestHide
      ? runs.filter((run) => run.course_run_id !== keepRunId && run.active_ssg_enrolment_count === 0 && isShownToPublic(run.public_visibility)).map((run) => run.course_run_id)
      : [],
    already_hidden_candidates: keepRunId
      ? runs.filter((run) => run.course_run_id !== keepRunId && isHiddenFromPublic(run.public_visibility)).map((run) => run.course_run_id)
      : [],
    action,
  };
}

async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ success: false, error: 'Method not allowed' });
  }

  let courseCode = String(req.body?.course_reference_number ?? req.body?.course_code ?? '').trim().toUpperCase();
  let startFilter = toIsoDate(req.body?.start_date);
  let endFilter = toIsoDate(req.body?.end_date);
  const seedCourseRunId = String(req.body?.seed_course_run_id ?? req.body?.course_run_id ?? '').trim();
  const includePastRuns = req.body?.include_past_runs === true;
  const checkTpgatewayVisibility = req.body?.check_tpgateway_visibility === true;
  const runIdFilter = Array.isArray(req.body?.course_run_ids)
    ? new Set(req.body.course_run_ids.map((id: unknown) => String(id).trim()).filter(Boolean))
    : new Set<string>();
  const includeAllRuns = req.body?.include_all_runs === true;

  if (!courseCode && !seedCourseRunId) {
    return res.status(400).json({ success: false, error: 'Enter a course run ID or course code.' });
  }
  if (startFilter && endFilter && endFilter < startFilter) {
    return res.status(400).json({ success: false, error: 'End date cannot be before start date.' });
  }
  if (runIdFilter.size > MAX_FOCUS_RUN_IDS) {
    return res.status(400).json({
      success: false,
      error: `Please focus on ${MAX_FOCUS_RUN_IDS} or fewer course run IDs per audit.`,
    });
  }

  try {
    const credentials = await getSSGCredentialsService().getSSGCredentials(undefined, (req.headers['x-ssg-app'] as string) || undefined);
    if (!credentials) {
      return res.status(500).json({ success: false, error: 'SSG credentials not found' });
    }

    const ssgBaseUrl = credentials.ssgApiBaseUrl || process.env.SSG_API_URL || 'https://api.ssg-wsg.sg';
    const tp = await getTrainingPartnerIdentifiers();
    const tpUen = tp.uen || credentials.uen;
    const tpCode = tp.code;
    const courseApi = createSSGCourseAPI(ssgBaseUrl, credentials);
    const enrolmentApi = createSSGEnrolmentAPI(ssgBaseUrl, credentials);
    const todayIso = singaporeTodayIso();

    let seedRun: any = null;
    if (seedCourseRunId) {
      const seedResult = await courseApi.viewCourseRun(seedCourseRunId, 'Y' as any);
      if (seedResult.error?.code || seedResult.error?.message) {
        return res.status(502).json({
          success: false,
          error: `SSG course-run lookup failed for ${seedCourseRunId}: ${seedResult.error.message || seedResult.error.code}`,
        });
      }

      const seedCourse = (seedResult.data as any)?.course ?? {};
      seedRun = seedCourse?.run ?? (seedResult.data as any)?.run ?? {};
      courseCode = courseCode || extractCourseCode(seedCourse, seedRun);
      startFilter = startFilter || toIsoDate(seedRun?.courseStartDate ?? seedRun?.courseDates?.start);
      endFilter = endFilter || toIsoDate(seedRun?.courseEndDate ?? seedRun?.courseDates?.end);

      if (!courseCode) {
        return res.status(502).json({
          success: false,
          error: `SSG returned run ${seedCourseRunId}, but no course reference number was found.`,
        });
      }
    }

    const searchResult = await courseApi.searchCourseRunsByCode(courseCode, {
      pageSize: 100,
      includeExpired: true,
      uen: tpUen,
    });

    if (searchResult.error?.code || searchResult.error?.message) {
      return res.status(502).json({
        success: false,
        error: `SSG course-run search failed: ${searchResult.error.message || searchResult.error.code}`,
      });
    }

    const ssgData = (searchResult.data as any)?.data ?? searchResult.data ?? {};
    const rawRuns: any[] = ssgData?.course?.runs ?? ssgData?.runs ?? [];
    const runsToAudit = rawRuns.filter((raw) => {
      const runId = extractRunId(raw);
      if (!runId) return false;
      const start = toIsoDate(raw?.courseStartDate ?? raw?.courseDates?.start);
      const end = toIsoDate(raw?.courseEndDate ?? raw?.courseDates?.end);
      if (!start || !end) return false;
      if (startFilter && start !== startFilter) return false;
      if (endFilter && end !== endFilter) return false;
      if (!includePastRuns && start < todayIso) return false;
      if (runIdFilter.size > 0 && !runIdFilter.has(runId)) return false;
      return true;
    });

    if (runsToAudit.length > MAX_RUNS_TO_AUDIT) {
      return res.status(400).json({
        success: false,
        error: `This audit would check ${runsToAudit.length} runs. Narrow the dates or focus run IDs to ${MAX_RUNS_TO_AUDIT} or fewer runs.`,
      });
    }

    const runIds = runsToAudit.map(extractRunId).filter(Boolean);
    const tpgVisibility = checkTpgatewayVisibility
      ? await fetchTpgatewayVisibility(courseCode, runIds)
      : new Map<string, string>();

    const localCounts = new Map<string, { inLms: boolean; count: number }>();
    if (runIds.length > 0) {
      const localRes = await pool.query(
        `SELECT cr.course_run_id,
                (SELECT COUNT(*)::int
                   FROM enrollment e
                  WHERE e.course_run_id = cr.id
                    AND LOWER(COALESCE(e.enrolment_status, ''))
                        NOT IN ('admin removed', 'cancelled', 'withdrawn')) AS enrolled_count
           FROM course_run cr
          WHERE cr.course_run_id = ANY($1::text[])
            AND cr.is_deleted IS NOT TRUE`,
        [runIds]
      );
      for (const row of localRes.rows) {
        localCounts.set(String(row.course_run_id), { inLms: true, count: Number(row.enrolled_count) || 0 });
      }
    }

    const normalizedRuns: SsgRun[] = [];
    for (const raw of runsToAudit) {
      const runId = extractRunId(raw);
      if (!runId) continue;
      const start = toIsoDate(raw?.courseStartDate ?? raw?.courseDates?.start);
      const end = toIsoDate(raw?.courseEndDate ?? raw?.courseDates?.end);
      if (!start || !end) continue;

      const liveEnrolments = await fetchSsgEnrolmentsForRun(enrolmentApi, tpUen, tpCode, runId);
      const local = localCounts.get(runId);
      normalizedRuns.push({
        course_run_id: runId,
        start_date: start,
        end_date: end,
        mode_of_training: raw?.modeOfTraining ? String(raw.modeOfTraining?.code ?? raw.modeOfTraining) : null,
        vacancy_code: raw?.courseVacancy?.code ?? null,
        vacancy_description: raw?.courseVacancy?.description ?? null,
        public_visibility: tpgVisibility.get(runId) ?? normalizeVisibility(extractVisibility(raw)),
        in_lms: !!local,
        local_enrolment_count: local?.count ?? 0,
        ssg_enrolment_count: liveEnrolments.total,
        active_ssg_enrolment_count: liveEnrolments.active,
        ...(liveEnrolments.error ? { ssg_enrolment_error: liveEnrolments.error } : {}),
      });
    }

    const byDate = new Map<string, SsgRun[]>();
    for (const run of normalizedRuns) {
      const key = `${run.start_date}|${run.end_date}`;
      if (!byDate.has(key)) byDate.set(key, []);
      byDate.get(key)!.push(run);
    }

    const groups = [...byDate.entries()]
      .filter(([, runs]) => includeAllRuns || runs.length > 1)
      .map(([key, runs]) => classifyGroup(key, runs.sort((a, b) => Number(a.course_run_id) - Number(b.course_run_id))))
      .sort((a, b) => a.start_date.localeCompare(b.start_date));
    return res.status(200).json({
      success: true,
      generated_at: new Date().toISOString(),
      course_code: courseCode,
      course_reference_number: courseCode,
      filters: {
        seed_course_run_id: seedCourseRunId || null,
        start_date: startFilter,
        end_date: endFilter,
        include_past_runs: includePastRuns,
        check_tpgateway_visibility: checkTpgatewayVisibility,
        upcoming_from: includePastRuns ? null : todayIso,
        course_run_ids: [...runIdFilter],
        include_all_runs: includeAllRuns,
        max_runs_to_audit: MAX_RUNS_TO_AUDIT,
      },
      visibility_update_available: false,
      visibility_update_blocker:
        process.env.TPGATEWAY_COOKIE
          ? 'TPGateway visibility was checked where available. This audit is read-only and does not hide or delete runs.'
          : 'TPGateway visibility requires TPGATEWAY_COOKIE. Visibility-unknown runs are not listed as hide candidates.',
      tpgateway_visibility_checked: checkTpgatewayVisibility && tpgVisibility.size > 0,
      total_ssg_runs: rawRuns.length,
      checked_runs: normalizedRuns.length,
      duplicate_groups: groups,
      summary: {
        duplicate_groups: groups.filter((group) => group.runs.length > 1).length,
        both_have_enrolments: groups.filter((group) => group.classification === 'both_have_enrolments').length,
        one_has_enrolments: groups.filter((group) => group.classification === 'one_has_enrolments').length,
        no_enrolments: groups.filter((group) => group.classification === 'no_enrolments').length,
        mixed_unknown: groups.filter((group) => group.classification === 'mixed_unknown').length,
        hide_candidates: groups.reduce((sum, group) => sum + group.hide_candidates.length, 0),
      },
    });
  } catch (error) {
    console.error('[duplicate-course-runs-audit] Error:', error);
    return res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Internal server error',
    });
  }
}

export default withAuth(handler, { roles: ['admin', 'trainingProvider', 'developer'] });
