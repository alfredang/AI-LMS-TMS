/**
 * Slicers shared by the Training Analytics endpoints
 * (/api/analytics/dashboard and /api/analytics/trend).
 *
 * Every value that reaches SQL goes through a $n parameter; the only
 * interpolated fragments are fixed strings defined in this file.
 */

export const PERIODS = ['all', 'ytd', '3m', '6m', '12m', '24m', '36m'] as const;
export type Period = (typeof PERIODS)[number];

export const TREND_RANGES = ['3m', '6m', '12m', '24m', '36m'] as const;
export type TrendRange = (typeof TREND_RANGES)[number];

export type Granularity = 'week' | 'month';
export type Sponsorship = 'employer' | 'individual';

export interface AnalyticsFilters {
  period: Period;
  /** course.course_type of the enrolment's course, or 'Other' when the course isn't in the LMS. */
  courseType: string | null;
  sponsorship: Sponsorship | null;
  /** ssg_enrolments.course_reference */
  course: string | null;
}

const one = (v: string | string[] | undefined): string | undefined =>
  Array.isArray(v) ? v[0] : v;

const clean = (v: string | undefined, max = 100): string | null => {
  const s = (v ?? '').trim();
  return s && s.toLowerCase() !== 'all' ? s.slice(0, max) : null;
};

export function parseFilters(query: Record<string, string | string[] | undefined>): AnalyticsFilters {
  const period = one(query.period) as Period;
  const sp = clean(one(query.sponsorship))?.toLowerCase();
  return {
    period: PERIODS.includes(period) ? period : 'all',
    courseType: clean(one(query.courseType), 40),
    sponsorship: sp === 'employer' || sp === 'individual' ? sp : null,
    course: clean(one(query.course)),
  };
}

export function parseTrend(query: Record<string, string | string[] | undefined>): {
  range: TrendRange;
  granularity: Granularity;
} {
  const range = one(query.range) as TrendRange;
  return {
    range: TREND_RANGES.includes(range) ? range : '12m',
    granularity: one(query.granularity) === 'week' ? 'week' : 'month',
  };
}

/** "Now" on the Singapore wall clock, expressed in UTC fields (date maths below read getUTC*). */
export const sgNow = (): Date => new Date(Date.now() + 8 * 3600 * 1000);

/** First day (UTC date) of the period, or null for all time. */
export function periodStart(period: Period, now: Date = sgNow()): Date | null {
  if (period === 'all') return null;
  if (period === 'ytd') return new Date(Date.UTC(now.getUTCFullYear(), 0, 1));
  const months = parseInt(period, 10);
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - (months - 1), 1));
}

export const hasSegmentFilter = (f: AnalyticsFilters) => !!(f.courseType || f.sponsorship || f.course);

/** Enrolment date used everywhere on the dashboard. */
export const ENROL_AT = 'COALESCE(se.enrolment_date, se.created_date)';

/** Date a claim counts in a period / month: when it was paid out, falling back to the course start. */
export const CLAIM_AT = `COALESCE(c.payment_date, c.disbursement_date, c.course_start_date,
  CASE WHEN c.raw_data->>'Course Start Date' ~ '^\\d{1,2}/\\d{1,2}/\\d{4}$'
       THEN TO_DATE(c.raw_data->>'Course Start Date', 'DD/MM/YYYY') END)`;

/** Claim statuses that mean the money has been paid out (SFC imports since Mar 2026 use 'Paid'). */
export const CLAIM_PAID_STATUSES = ['Disbursed', 'Paid'];

/** CTE `ct`: one course_type per course code. */
export const COURSE_TYPES_CTE = `
    ct AS (
      SELECT DISTINCT ON (course_code) course_code, course_type::text AS course_type
      FROM course
      WHERE course_code IS NOT NULL AND course_code <> '' AND course_type IS NOT NULL
      ORDER BY course_code, updated_at DESC
    )`;

/**
 * Segment slicers for ssg_claims (alias `c`). Only about half of claims link
 * to an enrolment row, but every claim carries course_reference, so course
 * type and course filter on that; sponsorship needs the linked enrolment.
 * Use after `WITH ${COURSE_TYPES_CTE}`; returns the joins and WHERE terms.
 */
export function claimSegmentSql(f: AnalyticsFilters, params: unknown[]): { joins: string; where: string[] } {
  const where: string[] = [];
  const add = (sql: (p: string) => string, value: unknown) => {
    params.push(value);
    where.push(sql(`$${params.length}`));
  };
  if (f.courseType) add((p) => `COALESCE(ct.course_type, 'Other') = ${p}`, f.courseType);
  if (f.sponsorship) add((p) => `LOWER(cse.sponsorship_type) = ${p}`, f.sponsorship);
  if (f.course) add((p) => `c.course_reference = ${p}`, f.course);
  return {
    joins: `LEFT JOIN ct ON ct.course_code = c.course_reference
       LEFT JOIN ssg_enrolments cse ON cse.enrolment_id = c.enrollment_id`,
    where,
  };
}

export interface FeOptions {
  /** Apply the period slicer to the enrolment date. */
  period?: boolean;
  /** Slicers to leave out, so a breakdown chart can show the alternatives to the current selection. */
  ignore?: Array<'courseType' | 'sponsorship' | 'course'>;
}

/**
 * CTEs `ct` (one course_type per course code) and `fe` (the filtered
 * enrolments, one row per ssg_enrolments row). Appends its parameters to
 * `params`; use the returned SQL after `WITH`.
 */
export function filteredEnrolmentsCte(f: AnalyticsFilters, params: unknown[], opts: FeOptions = {}): string {
  const ignore = new Set(opts.ignore || []);
  const where: string[] = [];
  const add = (sql: (p: string) => string, value: unknown) => {
    params.push(value);
    where.push(sql(`$${params.length}`));
  };

  if (opts.period) {
    const start = periodStart(f.period);
    if (start) add((p) => `${ENROL_AT} >= ${p}::date`, start.toISOString().slice(0, 10));
  }
  if (f.courseType && !ignore.has('courseType')) add((p) => `COALESCE(ct.course_type, 'Other') = ${p}`, f.courseType);
  if (f.sponsorship && !ignore.has('sponsorship')) add((p) => `LOWER(se.sponsorship_type) = ${p}`, f.sponsorship);
  if (f.course && !ignore.has('course')) add((p) => `se.course_reference = ${p}`, f.course);

  return `
    ${COURSE_TYPES_CTE},
    fe AS (
      SELECT
        se.enrolment_id,
        se.trainee_nric,
        se.course_reference,
        se.course_title,
        se.enrolment_status,
        se.sponsorship_type,
        ${ENROL_AT} AS enrol_at,
        COALESCE(ct.course_type, 'Other') AS course_type,
        (se.enrolment_status IS NULL OR LOWER(se.enrolment_status) <> 'cancelled') AS is_active,
        CASE WHEN se.raw_data->'trainee'->>'dateOfBirth' ~ '^\\d{4}-\\d{2}-\\d{2}'
             THEN (se.raw_data->'trainee'->>'dateOfBirth')::date END AS dob
      FROM ssg_enrolments se
      LEFT JOIN ct ON ct.course_code = se.course_reference
      ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
    )`;
}

const pad = (n: number) => String(n).padStart(2, '0');
const ymd = (d: Date) => `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;

/** Bucket start dates (UTC, YYYY-MM-DD) from the start of the range up to the current bucket. */
export function buildBuckets(range: TrendRange, granularity: Granularity, now: Date = sgNow()): string[] {
  const months = parseInt(range, 10);
  const first = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - (months - 1), 1));
  const out: string[] = [];
  if (granularity === 'month') {
    for (let i = 0; i < months; i++) {
      out.push(ymd(new Date(Date.UTC(first.getUTCFullYear(), first.getUTCMonth() + i, 1))));
    }
    return out;
  }
  // ISO weeks start on Monday (Postgres date_trunc('week')).
  const d = new Date(first);
  d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7));
  while (d <= now) {
    out.push(ymd(d));
    d.setUTCDate(d.getUTCDate() + 7);
  }
  return out;
}
