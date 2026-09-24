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

function extractRuns(payload: any): any[] {
  const data = payload?.data ?? payload ?? {};
  return data?.course?.runs ?? data?.runs ?? [];
}

function runIdOf(run: any): string {
  const id = run?.id ?? run?.runId ?? run?.courseRunId ?? run?.course_run_id;
  return id == null ? '(unknown run id)' : String(id);
}

async function fetchExistingRunsByDate(
  api: SearchCourseRunsApi,
  courseReferenceNumber: string,
  uen?: string,
): Promise<Map<string, string>> {
  const pageSize = 100;
  const byDate = new Map<string, string>();

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
    for (const run of runs) {
      const start = normalizeDate(run?.courseStartDate ?? run?.courseDates?.start);
      const end = normalizeDate(run?.courseEndDate ?? run?.courseDates?.end);
      if (!start || !end) continue;

      const key = `${start}|${end}`;
      const existing = byDate.get(key);
      byDate.set(key, [existing, runIdOf(run)].filter(Boolean).join('/'));
    }

    if (runs.length < pageSize) break;
  }

  return byDate;
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
