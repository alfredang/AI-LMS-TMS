type SearchCourseRunsApi = {
  searchCourseRunsByCode: (
    courseReferenceNumber: string,
    options?: { page?: number; pageSize?: number; includeExpired?: boolean; uen?: string },
  ) => Promise<{ data?: any; error?: any; status?: number }>;
};

type ProposedRun = {
  courseStartDate?: unknown;
  courseEndDate?: unknown;
  courseDates?: {
    start?: unknown;
    end?: unknown;
  };
  sequenceNumber?: unknown;
};

export class DuplicateCourseRunDateError extends Error {
  status = 409;
  courseReferenceNumber: string;
  startDate: string;
  endDate: string;
  existingRunId: string;

  constructor(input: {
    courseReferenceNumber: string;
    startDate: string;
    endDate: string;
    existingRunId: string;
  }) {
    super(
      `SSG already has course run ${input.existingRunId} for ${input.courseReferenceNumber} on ${input.startDate} to ${input.endDate}.`,
    );
    this.name = 'DuplicateCourseRunDateError';
    this.courseReferenceNumber = input.courseReferenceNumber;
    this.startDate = input.startDate;
    this.endDate = input.endDate;
    this.existingRunId = input.existingRunId;
  }
}

function normalizeDate(value: unknown): string | null {
  if (value == null) return null;
  const s = String(value).trim();
  if (/^\d{8}$/.test(s)) return `${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)}`;
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10);
  return null;
}

// Fail closed: a 200 whose body holds no run list is not "no runs". Treating it
// as empty would wave every date through and publish duplicates.
function extractRuns(payload: any): any[] {
  const data = payload?.data ?? payload ?? {};
  const runs = data?.course?.runs ?? data?.runs;
  if (!Array.isArray(runs)) {
    throw new Error('SSG course-run search returned no run list - cannot rule out duplicates');
  }
  return runs;
}

function runIdOf(run: any): string {
  const id = run?.id ?? run?.runId ?? run?.courseRunId ?? run?.course_run_id;
  return id == null ? '(unknown run id)' : String(id);
}

/** Every run SSG holds for a course, keyed "start|end" -> run id(s) joined by "/". */
export async function fetchExistingRunsByDate(
  api: SearchCourseRunsApi,
  courseReferenceNumber: string,
  uen?: string,
): Promise<Map<string, string>> {
  const pageSize = 100;
  const byDate = new Map<string, string>();
  const seen = new Set<string>();

  for (let page = 0; page < 10; page++) {
    const result = await api.searchCourseRunsByCode(courseReferenceNumber, {
      page,
      pageSize,
      includeExpired: true,
      uen,
    });

    if (result.error?.code || result.error?.message || (result.status && result.status !== 200)) {
      throw new Error(result.error?.message || result.error?.code || `SSG returned status ${result.status}`);
    }

    const runs = extractRuns(result.data);
    let fresh = 0;
    for (const run of runs) {
      const id = runIdOf(run);
      const known = id !== '(unknown run id)';
      if (known && seen.has(id)) continue;
      if (known) seen.add(id);
      fresh++;
      const start = normalizeDate(run?.courseStartDate ?? run?.courseDates?.start);
      const end = normalizeDate(run?.courseEndDate ?? run?.courseDates?.end);
      if (!start || !end) continue;

      const key = `${start}|${end}`;
      const existing = byDate.get(key);
      byDate.set(key, [existing, id].filter(Boolean).join('/'));
    }

    // A short page ends the list. So does a page of runs already seen, in case
    // SSG ever ignores `page` and hands back page 0 again.
    if (runs.length < pageSize || fresh === 0) break;
  }

  return byDate;
}

/**
 * After a publish: how many runs SSG now holds on these exact dates. More than one
 * means a duplicate got through despite the guard (e.g. a run created at the same
 * moment in the TPGateway portal) - callers log it so the nightly detector is not
 * the first to notice.
 */
export async function countRunsOnDates(
  api: SearchCourseRunsApi,
  courseReferenceNumber: string,
  startDate: string,
  endDate: string,
  uen?: string,
): Promise<{ count: number; runIds: string[] }> {
  const byDate = await fetchExistingRunsByDate(api, courseReferenceNumber.trim(), uen);
  const ids = (byDate.get(`${startDate}|${endDate}`) ?? '').split('/').filter(Boolean);
  return { count: ids.length, runIds: ids };
}

export async function assertNoDuplicateCourseRunDates(input: {
  api: SearchCourseRunsApi;
  courseReferenceNumber: string;
  runs: ProposedRun[];
  uen?: string;
}): Promise<void> {
  const courseReferenceNumber = String(input.courseReferenceNumber || '').trim();
  if (!courseReferenceNumber || input.runs.length === 0) return;

  const requestedDates = input.runs
    .map((run) => ({
      startDate: normalizeDate(run.courseStartDate ?? run.courseDates?.start),
      endDate: normalizeDate(run.courseEndDate ?? run.courseDates?.end),
    }))
    .filter((run): run is { startDate: string; endDate: string } => !!run.startDate && !!run.endDate);

  if (requestedDates.length === 0) return;

  const existingRunsByDate = await fetchExistingRunsByDate(
    input.api,
    courseReferenceNumber,
    input.uen,
  );

  for (const run of requestedDates) {
    const existingRunId = existingRunsByDate.get(`${run.startDate}|${run.endDate}`);
    if (existingRunId) {
      throw new DuplicateCourseRunDateError({
        courseReferenceNumber,
        startDate: run.startDate,
        endDate: run.endDate,
        existingRunId,
      });
    }
  }
}
