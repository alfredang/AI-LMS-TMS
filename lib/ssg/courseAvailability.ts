import pool from '../db';
import { sgtToday } from '../wsqScheduleSync';
import { createSSGCourseAPI } from './api/course-api';
import { classifyCourseAvailability, parseSsgDate } from './courseAvailabilityRules';
import { getSSGCredentialsService } from './services/credentials-service';

export { classifyCourseAvailability, parseSsgDate } from './courseAvailabilityRules';

export interface RefreshOptions {
  batchSize?: number;
  maxAgeHours?: number;
  refreshedBefore?: string;
  ssgApp?: string;
  timeBudgetMs?: number;
}

export interface RefreshResult {
  summary: Record<string, number> & {
    updated: number;
    unchanged: number;
    no_wsq_support: number;
    ssg_error: number;
  };
  processed: number;
  remaining: number;
  total: number;
  stopped_early: boolean;
  errors: Array<{ course_code: string; message: string }>;
}

const CONCURRENCY = 2;
const ROUND_GAP_MS = 300;
const MAX_RETRIES = 4;
const BACKOFF_BASE_MS = 1_500;
const DEFAULT_TIME_BUDGET_MS = 45_000;
const SUPPORT_TAGS = new Set(['1000', '1001']);

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

function isThrottled(error: any): boolean {
  const text = [error?.code, error?.message, error?.status].join(' ').toLowerCase();
  return text.includes('too many requests') || text.includes('429') || text.includes('rate limit');
}

function latestSupport(supports: any[]): { from: string; to: string } | null {
  const candidates = supports
    .filter((support) => SUPPORT_TAGS.has(String(support?.period?.taggingCode)))
    .map((support) => ({
      from: parseSsgDate(support?.period?.from),
      to: parseSsgDate(support?.period?.to),
    }))
    .filter((support): support is { from: string; to: string } => Boolean(support.from && support.to))
    .sort((a, b) => b.to.localeCompare(a.to));
  return candidates[0] ?? null;
}

const STALE_WHERE = `course_code LIKE 'TGS-%'
  AND (ssg_wsq_support_refreshed_at IS NULL
       OR ssg_wsq_support_refreshed_at < $1::timestamptz)`;

export async function refreshCourseAvailabilityBatch(options: RefreshOptions = {}): Promise<RefreshResult> {
  const startedAt = Date.now();
  const timeBudgetMs = options.timeBudgetMs ?? DEFAULT_TIME_BUDGET_MS;
  const msLeft = () => timeBudgetMs - (Date.now() - startedAt);
  const batchSize = Math.min(Math.max(Number(options.batchSize) || 50, 1), 150);
  const maxAgeHours = Math.max(Number(options.maxAgeHours) || 12, 0);
  const explicit = Date.parse(String(options.refreshedBefore ?? ''));
  const cutoff = Number.isFinite(explicit)
    ? new Date(explicit).toISOString()
    : new Date(Date.now() - maxAgeHours * 3_600_000).toISOString();

  const credentials = await getSSGCredentialsService().getSSGCredentials(undefined, options.ssgApp);
  if (!credentials) throw new Error('SSG credentials not configured');
  const ssgApi = createSSGCourseAPI(credentials.ssgApiBaseUrl || 'https://api.ssg-wsg.sg', credentials);

  const counts = await pool.query<{ total: string; stale: string }>(
    `SELECT (SELECT count(*) FROM course WHERE course_code LIKE 'TGS-%') AS total,
            (SELECT count(*) FROM course WHERE ${STALE_WHERE}) AS stale`,
    [cutoff],
  );
  const total = Number(counts.rows[0]?.total ?? 0);
  const staleCount = Number(counts.rows[0]?.stale ?? 0);

  const coursesResult = await pool.query<{
    id: string;
    course_code: string;
    lookup_code: string;
    renewed_status: string | null;
  }>(
    `SELECT id, course_code, renewed_status,
            COALESCE(
              (SELECT h.code FROM public.course_code_history h
                WHERE h.course_id = course.id AND h.is_current LIMIT 1),
              NULLIF(new_course_code, ''),
              course_code
            ) AS lookup_code
       FROM course WHERE ${STALE_WHERE} ORDER BY course_code LIMIT $2`,
    [cutoff, batchSize],
  );

  const summary: RefreshResult['summary'] = {
    updated: 0,
    unchanged: 0,
    no_wsq_support: 0,
    ssg_error: 0,
    active: 0,
    renewal_processing: 0,
    expired: 0,
    no_public_run: 0,
    rejected: 0,
    no_support: 0,
  };
  const errors: RefreshResult['errors'] = [];

  async function fetchFacts(courseCode: string): Promise<{ support: { from: string; to: string } | null; hasFutureRun: boolean }> {
    let lastError: any = null;
    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
      const result = await ssgApi.searchCourseRunsByCode(courseCode, {
        page: 0,
        pageSize: 100,
        includeExpired: true,
        uen: credentials!.uen,
      });
      if (result.error?.code || result.error?.message || (result.status && result.status !== 200)) {
        lastError = result.error || { status: result.status, message: `SSG returned status ${result.status}` };
        if (isThrottled(lastError) && attempt < MAX_RETRIES) {
          const wait = BACKOFF_BASE_MS * Math.pow(2, attempt);
          if (wait >= msLeft()) throw new Error(lastError?.message || 'SSG rate limit');
          await sleep(wait);
          continue;
        }
        throw new Error(lastError?.message || 'SSG error');
      }

      const payload: any = (result.data as any)?.data ?? result.data ?? {};
      const course = payload?.course ?? payload;
      const runs: any[] = course?.runs ?? payload?.runs ?? [];
      const today = sgtToday();
      return {
        support: latestSupport(course?.supports ?? payload?.supports ?? []),
        hasFutureRun: runs.some((run) => {
          const start = parseSsgDate(run?.courseStartDate ?? run?.courseDates?.start);
          return Boolean(start && start >= today);
        }),
      };
    }
    throw new Error(lastError?.message || 'SSG error');
  }

  let attempted = 0;
  let stoppedEarly = false;
  for (let index = 0; index < coursesResult.rows.length; index += CONCURRENCY) {
    if (msLeft() <= 0) {
      stoppedEarly = true;
      break;
    }
    const round = coursesResult.rows.slice(index, index + CONCURRENCY);
    attempted += round.length;
    await Promise.all(round.map(async (course) => {
      try {
        const facts = await fetchFacts(course.lookup_code || course.course_code);
        const decision = classifyCourseAvailability({
          today: sgtToday(),
          supportFrom: facts.support?.from ?? null,
          supportTo: facts.support?.to ?? null,
          hasFutureRun: facts.hasFutureRun,
          renewedStatus: course.renewed_status,
        });
        await pool.query(
          `UPDATE course
              SET ssg_wsq_support_from = $1::date,
                  ssg_wsq_support_to = $2::date,
                  ssg_wsq_support_refreshed_at = NOW(),
                  course_availability_status = $3,
                  course_availability_reason = $4,
                  course_availability_checked_at = NOW(),
                  ssg_has_future_run = $5
            WHERE id = $6`,
          [facts.support?.from ?? null, facts.support?.to ?? null, decision.status, decision.reason, facts.hasFutureRun, course.id],
        );
        summary[decision.status] = (summary[decision.status] ?? 0) + 1;
        if (facts.support) summary.updated++;
        else summary.no_wsq_support++;
      } catch (error) {
        // Do not overwrite the last known state during an SSG outage. Because
        // refreshed_at is untouched this row is retried by the next batch/run.
        summary.ssg_error++;
        errors.push({
          course_code: course.course_code,
          message: error instanceof Error ? error.message : String(error),
        });
      }
    }));
    if (index + CONCURRENCY < coursesResult.rows.length) await sleep(ROUND_GAP_MS);
  }

  return {
    summary,
    processed: attempted,
    remaining: Math.max(staleCount - summary.updated - summary.no_wsq_support, 0),
    total,
    stopped_early: stoppedEarly,
    errors: errors.slice(0, 20),
  };
}
