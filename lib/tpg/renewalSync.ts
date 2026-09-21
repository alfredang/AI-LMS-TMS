import { createHash } from 'node:crypto';

export const RENEWAL_PLAN_SCHEMA_VERSION = 1;
export const NOT_FOUND = 'NOT Found';

export type SourceTab = 'Submissions' | 'Rejected Applications';

export interface CourseSnapshot {
  id: string;
  title: string;
  course_code: string | null;
  new_course_code: string | null;
  course_type: string;
  funding_validity: string;
  actual_renew_date: string | null;
  renewal_application_no: string | null;
  renewed_status: string | null;
}

export interface CanonicalTpgRow {
  sourceTab: SourceTab;
  applicationNo: string;
  courseRef: string;
  courseTitle: string;
  normalizedTitle: string;
  dateSubmitted: string;
  rawStatus: string;
  submissionType: string;
  courseType: string;
  raw: Record<string, unknown>;
}

export interface RenewalState {
  actualRenewDate: string | null;
  renewalApplicationNo: string | null;
  renewedStatus: string | null;
}

export interface RenewalPlanRow {
  id: string;
  courseTitle: string;
  courseRefs: string[];
  courseType: string;
  fundingValidity: string;
  priorApplicationFound: boolean;
  operation:
    | 'already-current'
    | 'status-refresh'
    | 'resolved-unresolved'
    | 'superseded-by-newer'
    | 'missing-prior-recovered'
    | 'not-found';
  matchEvidence: string[];
  sourceTab: SourceTab | null;
  rawStatus: string | null;
  selectedApplication: CanonicalTpgRow | null;
  before: RenewalState;
  desired: RenewalState;
  changed: boolean;
}

export interface BuildPlanResult {
  rows: RenewalPlanRow[];
  summary: {
    selectedCourses: number;
    wouldUpdate: number;
    alreadyCorrect: number;
    supersededByNewer: number;
    missingPriorRecovered: number;
    missingPriorToNotFound: number;
    resolvedUnresolved: number;
    notFound: number;
    statusUnset: number;
    foundInSubmissions: number;
    foundInRejectedApplications: number;
  };
}

export interface CaptureInspection {
  rows: Record<string, unknown>[];
  complete: boolean;
  reportedTotal: number | null;
  scrapedAt: string | null;
  sourceUrl: string | null;
  completenessEvidence: string;
}

export class RenewalPlanError extends Error {
  readonly issues: string[];

  constructor(message: string, issues: string[] = []) {
    super(issues.length ? `${message}\n- ${issues.join('\n- ')}` : message);
    this.name = 'RenewalPlanError';
    this.issues = issues;
  }
}

const clean = (value: unknown): string => String(value ?? '').trim();

export function decodeHtmlEntities(value: string): string {
  const named: Record<string, string> = {
    amp: '&',
    apos: "'",
    gt: '>',
    lt: '<',
    nbsp: ' ',
    quot: '"',
  };
  return value.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (whole, entity: string) => {
    const lower = entity.toLowerCase();
    if (lower.startsWith('#x')) {
      const codePoint = Number.parseInt(lower.slice(2), 16);
      return Number.isFinite(codePoint) ? String.fromCodePoint(codePoint) : whole;
    }
    if (lower.startsWith('#')) {
      const codePoint = Number.parseInt(lower.slice(1), 10);
      return Number.isFinite(codePoint) ? String.fromCodePoint(codePoint) : whole;
    }
    return named[lower] ?? whole;
  });
}

export function normalizeTitle(value: unknown): string {
  return decodeHtmlEntities(clean(value)).replace(/\s+/g, ' ').toLocaleLowerCase('en-SG');
}

export function normalizeCourseRef(value: unknown): string {
  return clean(value).replace(/\s+/g, '').toUpperCase();
}

export function normalizeApplicationNo(value: unknown): string | null {
  const normalized = clean(value);
  return normalized ? normalized.toUpperCase() : null;
}

export function isRealApplicationNo(value: unknown): boolean {
  const normalized = normalizeApplicationNo(value);
  return Boolean(normalized && normalized !== NOT_FOUND.toUpperCase() && /^TPG-[A-Z0-9-]+$/.test(normalized));
}

function isoDate(year: number, month: number, day: number, label: string): string {
  const date = new Date(Date.UTC(year, month - 1, day));
  if (
    date.getUTCFullYear() !== year
    || date.getUTCMonth() !== month - 1
    || date.getUTCDate() !== day
  ) {
    throw new RenewalPlanError(`Invalid date for ${label}: ${year}-${month}-${day}`);
  }
  return `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

export function normalizeDate(value: unknown, label = 'date'): string | null {
  const text = clean(value);
  if (!text) return null;

  let match = text.match(/^(\d{4})-(\d{2})-(\d{2})(?:T.*)?$/);
  if (match) return isoDate(Number(match[1]), Number(match[2]), Number(match[3]), label);

  match = text.match(/^(\d{2})[-/](\d{2})[-/](\d{4})$/);
  if (match) return isoDate(Number(match[3]), Number(match[2]), Number(match[1]), label);

  match = text.match(/^([A-Za-z]{3,9})\s+(\d{1,2}),\s*(\d{4})$/);
  if (match) {
    const months: Record<string, number> = {
      jan: 1, january: 1, feb: 2, february: 2, mar: 3, march: 3,
      apr: 4, april: 4, may: 5, jun: 6, june: 6, jul: 7, july: 7,
      aug: 8, august: 8, sep: 9, sept: 9, september: 9, oct: 10,
      october: 10, nov: 11, november: 11, dec: 12, december: 12,
    };
    const month = months[match[1].toLowerCase()];
    if (month) return isoDate(Number(match[3]), month, Number(match[2]), label);
  }

  throw new RenewalPlanError(`Unrecognized ${label}: ${text}`);
}

export function addCalendarMonths(dateIso: string, months: number): string {
  const normalized = normalizeDate(dateIso, 'as-of date');
  if (!normalized) throw new RenewalPlanError('As-of date is required.');
  const [year, month, day] = normalized.split('-').map(Number);
  const monthIndex = month - 1 + months;
  const targetYear = year + Math.floor(monthIndex / 12);
  const targetMonthIndex = ((monthIndex % 12) + 12) % 12;
  const lastDay = new Date(Date.UTC(targetYear, targetMonthIndex + 1, 0)).getUTCDate();
  return isoDate(targetYear, targetMonthIndex + 1, Math.min(day, lastDay), 'through date');
}

export function mapTpgStatus(value: unknown): string {
  const raw = clean(value);
  const mapped: Record<string, string> = {
    approved: 'Approved / Renewed',
    'approved / renewed': 'Approved / Renewed',
    rejected: 'Rejected/Expired',
    'rejected/expired': 'Rejected/Expired',
    'rejected / expired': 'Rejected/Expired',
    others: 'Others',
    'pending payment': 'Pending Payment',
    processing: 'Processing',
    'action required': 'Action Required',
    draft: 'Draft',
    'pending acknowledgement': 'Pending Ack.',
    'pending ack.': 'Pending Ack.',
    'pending submission': 'Pending Sub.',
    'pending sub.': 'Pending Sub.',
  };
  const result = mapped[raw.toLowerCase()];
  if (!result) throw new RenewalPlanError(`Unsupported or blank TPG status: ${raw || '(blank)'}`);
  return result;
}

function pick(row: Record<string, unknown>, keys: string[]): unknown {
  for (const key of keys) {
    if (row[key] !== undefined && row[key] !== null) return row[key];
  }
  return undefined;
}

export function canonicalizeTpgRows(
  rows: Record<string, unknown>[],
  sourceTab: SourceTab,
): CanonicalTpgRow[] {
  return rows.map((raw, index) => {
    const applicationNo = normalizeApplicationNo(pick(raw, [
      'Application Ref. No.', 'applicationNo', 'application_no', 'applicationRef',
    ]));
    if (!applicationNo || !isRealApplicationNo(applicationNo)) {
      throw new RenewalPlanError(`${sourceTab} row ${index + 1} has an invalid application number.`);
    }
    const courseTitle = clean(pick(raw, ['Course Title', 'courseTitle', 'course_title', 'title']));
    if (!courseTitle) throw new RenewalPlanError(`${sourceTab} row ${index + 1} has no course title.`);
    const dateSubmitted = normalizeDate(
      pick(raw, ['Date Submitted', 'dateSubmitted', 'date_submitted', 'submittedDate']),
      `${sourceTab} ${applicationNo} Date Submitted`,
    );
    if (!dateSubmitted) throw new RenewalPlanError(`${sourceTab} ${applicationNo} has no submitted date.`);
    return {
      sourceTab,
      applicationNo,
      courseRef: normalizeCourseRef(pick(raw, ['Course Ref. No.', 'courseRef', 'course_ref', 'courseCode'])),
      courseTitle,
      normalizedTitle: normalizeTitle(courseTitle),
      dateSubmitted,
      rawStatus: clean(pick(raw, ['Status', 'status', 'rawStatus'])),
      submissionType: clean(pick(raw, ['Submission Type', 'submissionType', 'submission_type'])),
      courseType: clean(pick(raw, ['Course Type', 'courseType', 'course_type'])),
      raw,
    };
  });
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

export function inspectCaptureDocument(
  document: unknown,
  sourceTab: SourceTab,
): CaptureInspection {
  const root = asRecord(document);
  if (!root) throw new RenewalPlanError(`${sourceTab} capture must be a JSON object.`);
  const preferredKey = sourceTab === 'Submissions' ? 'submissions' : 'rejectedApplications';
  const nested = asRecord(root[preferredKey]);
  const container = nested ?? root;
  const rowsValue = container.rows ?? root.rows;
  if (!Array.isArray(rowsValue)) {
    throw new RenewalPlanError(`${sourceTab} capture does not contain a rows array.`);
  }
  const rows = rowsValue.map((row, index) => {
    const record = asRecord(row);
    if (!record) throw new RenewalPlanError(`${sourceTab} capture row ${index + 1} is not an object.`);
    return record;
  });

  const coverage = asRecord(container.coverage) ?? asRecord(root.coverage);
  const totalValue = coverage?.total ?? container.count ?? container.total ?? root.count ?? root.total;
  const reportedTotal = Number.isInteger(Number(totalValue)) ? Number(totalValue) : null;
  const explicitClaim = coverage?.complete === true;
  if (explicitClaim && reportedTotal !== null && reportedTotal !== rows.length) {
    throw new RenewalPlanError(
      `${sourceTab} capture claims complete coverage but contains ${rows.length} of ${reportedTotal} reported rows.`,
    );
  }
  const explicitComplete = explicitClaim && (reportedTotal === null || reportedTotal === rows.length);
  const pageAudit = container.pageAudit ?? root.pageAudit;
  const paginationComplete = Array.isArray(pageAudit)
    && pageAudit.length > 0
    && reportedTotal !== null
    && reportedTotal === rows.length;
  const complete = explicitComplete || paginationComplete;
  const completenessEvidence = explicitComplete
    ? 'coverage.complete=true'
    : paginationComplete
      ? 'paginated row count equals reported total'
      : 'no complete-coverage proof';

  return {
    rows,
    complete,
    reportedTotal,
    scrapedAt: clean(root.scrapedAt ?? container.scrapedAt) || null,
    sourceUrl: clean(root.sourceUrl ?? container.sourceUrl) || null,
    completenessEvidence,
  };
}

function compareApplicationsDescending(a: CanonicalTpgRow, b: CanonicalTpgRow): number {
  if (a.dateSubmitted !== b.dateSubmitted) return b.dateSubmitted.localeCompare(a.dateSubmitted);
  if (a.sourceTab !== b.sourceTab) return a.sourceTab === 'Submissions' ? -1 : 1;
  return b.applicationNo.localeCompare(a.applicationNo, 'en', { numeric: true, sensitivity: 'base' });
}

export function statesEqual(a: RenewalState, b: RenewalState): boolean {
  return a.actualRenewDate === b.actualRenewDate
    && a.renewalApplicationNo === b.renewalApplicationNo
    && a.renewedStatus === b.renewedStatus;
}

function databaseState(course: CourseSnapshot): RenewalState {
  const app = clean(course.renewal_application_no) || null;
  return {
    actualRenewDate: normalizeDate(course.actual_renew_date, `${course.title} actual renewal date`),
    renewalApplicationNo: app,
    renewedStatus: clean(course.renewed_status) || null,
  };
}

export function buildRenewalPlan(
  courses: CourseSnapshot[],
  sourceRows: CanonicalTpgRow[],
): BuildPlanResult {
  const issues: string[] = [];
  const ids = new Set<string>();
  const titleOwners = new Map<string, Set<string>>();
  const refOwners = new Map<string, Set<string>>();
  const priorApplicationOwners = new Map<string, Set<string>>();

  for (const course of courses) {
    if (ids.has(course.id)) issues.push(`Database course id ${course.id} appears more than once.`);
    ids.add(course.id);
    const titleKey = normalizeTitle(course.title);
    if (!titleKey) issues.push(`Database course ${course.id} has a blank title.`);
    if (!titleOwners.has(titleKey)) titleOwners.set(titleKey, new Set());
    titleOwners.get(titleKey)!.add(course.id);
    for (const ref of [course.new_course_code, course.course_code].map(normalizeCourseRef).filter(Boolean)) {
      if (!refOwners.has(ref)) refOwners.set(ref, new Set());
      refOwners.get(ref)!.add(course.id);
    }
    const priorApplication = normalizeApplicationNo(course.renewal_application_no);
    if (isRealApplicationNo(priorApplication)) {
      if (!priorApplicationOwners.has(priorApplication!)) priorApplicationOwners.set(priorApplication!, new Set());
      priorApplicationOwners.get(priorApplication!)!.add(course.id);
    }
  }

  for (const [ref, owners] of refOwners) {
    if (owners.size > 1) issues.push(`Course reference ${ref} belongs to multiple selected database courses.`);
  }
  for (const [applicationNo, owners] of priorApplicationOwners) {
    if (owners.size > 1) issues.push(`Renewal application ${applicationNo} is stored on multiple selected database courses.`);
  }
  if (issues.length) throw new RenewalPlanError('Cannot build a safe renewal plan.', issues);

  const rows: RenewalPlanRow[] = [];
  for (const course of courses) {
    const before = databaseState(course);
    const currentApplication = normalizeApplicationNo(before.renewalApplicationNo);
    const priorIsReal = isRealApplicationNo(currentApplication);
    const refs = [...new Set([course.new_course_code, course.course_code]
      .map(normalizeCourseRef)
      .filter(Boolean))];
    const titleKey = normalizeTitle(course.title);
    const titleIsAmbiguous = (titleOwners.get(titleKey)?.size ?? 0) > 1;
    const evidenceByCandidate = new Map<CanonicalTpgRow, Set<string>>();
    let priorApplicationFound = false;

    for (const candidate of sourceRows) {
      const evidence = new Set<string>();
      const exactApplication = priorIsReal && candidate.applicationNo === currentApplication;
      const exactRef = Boolean(candidate.courseRef && refs.includes(candidate.courseRef));
      const exactTitle = candidate.normalizedTitle === titleKey;
      const candidateRefOwners = candidate.courseRef ? refOwners.get(candidate.courseRef) : undefined;
      const refDisambiguatesAnotherCourse = Boolean(
        candidateRefOwners
        && candidateRefOwners.size === 1
        && !candidateRefOwners.has(course.id),
      );

      if (exactApplication) {
        evidence.add('exact-application');
        priorApplicationFound = true;
      }
      if (exactRef) evidence.add('exact-course-ref');
      if (exactTitle) {
        if (refDisambiguatesAnotherCourse) {
          // The exact ref is stronger evidence for the other same-title course.
        } else if (titleIsAmbiguous && !exactRef && !exactApplication) {
          issues.push(
            `${candidate.applicationNo} title matches multiple selected courses and has no disambiguating exact ref/application.`,
          );
        } else {
          evidence.add('exact-title');
        }
      }
      if (evidence.size) evidenceByCandidate.set(candidate, evidence);
    }

    const candidates = [...evidenceByCandidate.keys()].sort(compareApplicationsDescending);
    const selected = candidates[0] ?? null;
    let desired: RenewalState;
    let operation: RenewalPlanRow['operation'];
    let matchEvidence: string[] = [];

    if (!selected) {
      desired = {
        actualRenewDate: null,
        renewalApplicationNo: NOT_FOUND,
        renewedStatus: null,
      };
      operation = 'not-found';
    } else {
      const currentDate = before.actualRenewDate;
      if (
        currentDate
        && selected.applicationNo !== currentApplication
        && selected.dateSubmitted < currentDate
      ) {
        issues.push(
          `${course.title}: selected ${selected.applicationNo} (${selected.dateSubmitted}) is older than the stored pair (${currentDate}).`,
        );
      }
      desired = {
        actualRenewDate: selected.dateSubmitted,
        renewalApplicationNo: selected.applicationNo,
        renewedStatus: mapTpgStatus(selected.rawStatus),
      };
      matchEvidence = [...(evidenceByCandidate.get(selected) ?? [])].sort();
      if (!priorIsReal) operation = 'resolved-unresolved';
      else if (!priorApplicationFound) operation = 'missing-prior-recovered';
      else if (selected.applicationNo !== currentApplication) operation = 'superseded-by-newer';
      else if (before.renewedStatus !== desired.renewedStatus) operation = 'status-refresh';
      else operation = 'already-current';
    }

    const changed = !statesEqual(before, desired);
    rows.push({
      id: course.id,
      courseTitle: course.title,
      courseRefs: refs,
      courseType: course.course_type,
      fundingValidity: normalizeDate(course.funding_validity, `${course.title} funding validity`)!,
      priorApplicationFound,
      operation,
      matchEvidence,
      sourceTab: selected?.sourceTab ?? null,
      rawStatus: selected?.rawStatus ?? null,
      selectedApplication: selected,
      before,
      desired,
      changed,
    });
  }

  if (issues.length) throw new RenewalPlanError('Cannot build a safe renewal plan.', [...new Set(issues)]);

  const desiredApplicationOwners = new Map<string, string[]>();
  for (const row of rows) {
    if (!isRealApplicationNo(row.desired.renewalApplicationNo)) continue;
    const applicationNo = normalizeApplicationNo(row.desired.renewalApplicationNo)!;
    if (!desiredApplicationOwners.has(applicationNo)) desiredApplicationOwners.set(applicationNo, []);
    desiredApplicationOwners.get(applicationNo)!.push(row.courseTitle);
  }
  const duplicateDesired = [...desiredApplicationOwners]
    .filter(([, owners]) => owners.length > 1)
    .map(([applicationNo, owners]) => `${applicationNo} would be assigned to multiple courses: ${owners.join(', ')}`);
  if (duplicateDesired.length) {
    throw new RenewalPlanError('Cannot build a safe renewal plan.', duplicateDesired);
  }

  rows.sort((a, b) => a.fundingValidity.localeCompare(b.fundingValidity)
    || a.courseTitle.localeCompare(b.courseTitle)
    || a.id.localeCompare(b.id));

  return {
    rows,
    summary: {
      selectedCourses: rows.length,
      wouldUpdate: rows.filter((row) => row.changed).length,
      alreadyCorrect: rows.filter((row) => !row.changed).length,
      supersededByNewer: rows.filter((row) => row.operation === 'superseded-by-newer').length,
      missingPriorRecovered: rows.filter((row) => row.operation === 'missing-prior-recovered').length,
      missingPriorToNotFound: rows.filter((row) => row.operation === 'not-found' && isRealApplicationNo(row.before.renewalApplicationNo)).length,
      resolvedUnresolved: rows.filter((row) => row.operation === 'resolved-unresolved').length,
      notFound: rows.filter((row) => row.desired.renewalApplicationNo === NOT_FOUND).length,
      statusUnset: rows.filter((row) => row.desired.renewedStatus === null).length,
      foundInSubmissions: rows.filter((row) => row.sourceTab === 'Submissions').length,
      foundInRejectedApplications: rows.filter((row) => row.sourceTab === 'Rejected Applications').length,
    },
  };
}

export function stableStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${stableStringify(record[key])}`).join(',')}}`;
}

export function computePlanHash(unsignedPlan: unknown): string {
  return `sha256:${createHash('sha256').update(stableStringify(unsignedPlan)).digest('hex')}`;
}

export function verifyPlanHash(plan: Record<string, unknown>): boolean {
  const { planHash, ...unsigned } = plan;
  return typeof planHash === 'string' && planHash === computePlanHash(unsigned);
}
