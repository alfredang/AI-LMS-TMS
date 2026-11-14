import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Card } from './ui/Card';
import { getApiUrl } from '@/lib/urlHelpers';
import {
  CHART_COLORS,
  DonutChart,
  HBarList,
  Option,
  Segmented,
  SelectBox,
  TrendChart,
} from './analytics/AnalyticsCharts';

// ---------------------------------------------------------------- types

type ForecastMethod = 'trend+seasonal' | 'trend' | 'weighted avg' | 'none';
type Period = 'all' | 'ytd' | '3m' | '6m' | '12m' | '24m' | '36m';
type TrendRange = '3m' | '6m' | '12m' | '24m' | '36m';
type Granularity = 'week' | 'month';
type Sponsorship = 'all' | 'employer' | 'individual';
type RankMetric = 'enrolments' | 'learners';
type RankPeriod = 'all' | '12m' | '6m' | '3m';

interface Breakdown {
  key: string;
  label: string;
  value: number;
  enrolments?: number;
}

interface AnalyticsData {
  totalLearners: number;
  totalEnrolments: number;
  totalGrants: number;
  grantsInPipeline: number;
  totalClaims: number;
  claimsInPipeline: number;
  enrollmentForecast: number;
  enrollmentForecastMethod: ForecastMethod;
  grantForecast: number;
  grantForecastMethod: ForecastMethod;
  claimForecast: number;
  claimForecastMethod: ForecastMethod;
  ageProfile: Breakdown[];
  enrolmentStatusBreakdown: Breakdown[];
  sponsorshipBreakdown: Breakdown[];
  courseTypeMix: Breakdown[];
}

interface CourseRank {
  key: string;
  label: string;
  courseType: string;
  enrolments: number;
  learners: number;
}

interface TrendData {
  range: TrendRange;
  granularity: Granularity;
  series: {
    key: string;
    learners: number;
    enrolments: number;
    grants: number;
    claims: number;
  }[];
}

interface Filters {
  period: Period;
  courseType: string; // 'all' or a course_type
  sponsorship: Sponsorship;
  course: { key: string; label: string } | null;
}

// ---------------------------------------------------------------- constants & formatters

const PERIOD_OPTIONS: Option<Period>[] = [
  { value: 'all', label: 'All time' },
  { value: 'ytd', label: 'This year' },
  { value: '3m', label: 'Last 3 months' },
  { value: '6m', label: 'Last 6 months' },
  { value: '12m', label: 'Last 12 months' },
  { value: '24m', label: 'Last 24 months' },
  { value: '36m', label: 'Last 36 months' },
];
const RANGE_OPTIONS = PERIOD_OPTIONS.filter((o) => o.value !== 'all' && o.value !== 'ytd') as Option<TrendRange>[];
const RANK_PERIOD_OPTIONS: Option<RankPeriod>[] = [
  { value: 'all', label: 'All time' },
  { value: '12m', label: 'Last 12 months' },
  { value: '6m', label: 'Last 6 months' },
  { value: '3m', label: 'Last 3 months' },
];
const isRankPeriod = (v: string): v is RankPeriod => RANK_PERIOD_OPTIONS.some((o) => o.value === v);
const SPONSORSHIP_OPTIONS: Option<Sponsorship>[] = [
  { value: 'all', label: 'All' },
  { value: 'employer', label: 'Employer' },
  { value: 'individual', label: 'Individual' },
];
const DEFAULT_FILTERS: Filters = {
  period: 'all',
  courseType: 'all',
  sponsorship: 'all',
  course: null,
};
const STORAGE_KEY = 'tp-analytics-filters-v1';

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const num = (n: number) => Math.round(n).toLocaleString();
const money = (n: number) => `$${Math.round(n).toLocaleString()}`;
const moneyAxis = (n: number) =>
  n >= 1_000_000 ? `$${+(n / 1_000_000).toFixed(1)}M` : n >= 1000 ? `$${+(n / 1000).toFixed(1)}k` : `$${n}`;
const methodLabel = (m: ForecastMethod) => (m === 'none' ? 'not enough data' : m);

function bucketLabels(keys: string[], g: Granularity) {
  return keys.map((k) => {
    const [y, m, d] = k.split('-').map(Number);
    return g === 'month'
      ? {
          short: `${MONTHS[m - 1]} ${String(y).slice(2)}`,
          long: `${MONTHS[m - 1]} ${y}`,
        }
      : {
          short: `${d} ${MONTHS[m - 1]}`,
          long: `Week of ${d} ${MONTHS[m - 1]} ${y}`,
        };
  });
}

function buildQuery(f: Filters, extra: Record<string, string> = {}) {
  const p = new URLSearchParams(extra);
  if (f.courseType !== 'all') p.set('courseType', f.courseType);
  if (f.sponsorship !== 'all') p.set('sponsorship', f.sponsorship);
  if (f.course) p.set('course', f.course.key);
  return p;
}

async function getJson<T>(path: string): Promise<T> {
  const response = await fetch(getApiUrl(path));
  const result = await response.json().catch(() => null);
  if (!response.ok || !result?.success) throw new Error(result?.error || 'Failed to fetch analytics data');
  return result.data as T;
}

// ---------------------------------------------------------------- small pieces

const StatCard: React.FC<{
  title: string;
  value: string | number;
  subtext?: string;
}> = ({ title, value, subtext }) => (
  <Card className="p-4 sm:p-6 text-center overflow-hidden">
    <p className="text-lg min-[420px]:text-2xl sm:text-4xl font-bold text-primary truncate tabular-nums">{value}</p>
    <p className="text-xs sm:text-base font-semibold text-on-surface dark:text-gray-100 mt-1">{title}</p>
    <p className="text-xs sm:text-sm text-subtle dark:text-gray-400 truncate">{subtext || ' '}</p>
  </Card>
);

const Panel: React.FC<{
  title: string;
  meta?: React.ReactNode;
  controls?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
}> = ({ title, meta, controls, children, className = '' }) => (
  <Card className={`p-5 sm:p-6 ${className}`}>
    <div className="mb-4 flex flex-col gap-3 xl:flex-row xl:items-center xl:justify-between">
      <h3 className="text-lg font-bold text-gray-900 dark:text-white">{title}</h3>
      <div className="flex flex-wrap items-center gap-3">
        {controls}
        {meta && <span className="text-sm text-gray-500 dark:text-gray-400">{meta}</span>}
      </div>
    </div>
    {children}
  </Card>
);

const FilterLabel: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <span className="text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">{children}</span>
);

// ---------------------------------------------------------------- main

const TrainingProviderDashboard: React.FC = () => {
  const [filters, setFilters] = useState<Filters>(DEFAULT_FILTERS);
  const [restored, setRestored] = useState(false);
  const [granularity, setGranularity] = useState<Granularity>('month');
  const [trendRange, setTrendRange] = useState<TrendRange>('12m');
  const [topN, setTopN] = useState(10);
  const [rankMetric, setRankMetric] = useState<RankMetric>('enrolments');
  const [rankPeriod, setRankPeriod] = useState<RankPeriod>('all');

  const [data, setData] = useState<AnalyticsData | null>(null);
  const [trend, setTrend] = useState<TrendData | null>(null);
  const [courses, setCourses] = useState<CourseRank[] | null>(null);
  const [rankLoading, setRankLoading] = useState(false);
  const [loading, setLoading] = useState(false);
  const [trendLoading, setTrendLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [reloadTick, setReloadTick] = useState(0);
  const dashReq = useRef(0);
  const trendReq = useRef(0);
  const rankReq = useRef(0);

  // Restore the last-used slicers for this browser session.
  useEffect(() => {
    try {
      const saved = sessionStorage.getItem(STORAGE_KEY);
      if (saved) {
        const s = JSON.parse(saved);
        setFilters({ ...DEFAULT_FILTERS, ...s.filters });
        if (s.granularity) setGranularity(s.granularity);
        if (s.trendRange) setTrendRange(s.trendRange);
        if (s.topN) setTopN(s.topN);
        if (s.rankMetric) setRankMetric(s.rankMetric);
        if (s.rankPeriod && isRankPeriod(s.rankPeriod)) setRankPeriod(s.rankPeriod);
      }
    } catch {
      /* ignore */
    }
    setRestored(true);
  }, []);

  useEffect(() => {
    if (!restored) return;
    try {
      sessionStorage.setItem(
        STORAGE_KEY,
        JSON.stringify({
          filters,
          granularity,
          trendRange,
          topN,
          rankMetric,
          rankPeriod,
        }),
      );
    } catch {
      /* ignore */
    }
  }, [restored, filters, granularity, trendRange, topN, rankMetric, rankPeriod]);

  // KPIs and breakdowns
  useEffect(() => {
    if (!restored) return;
    const id = ++dashReq.current;
    setLoading(true);
    const q = buildQuery(filters, { period: filters.period });
    getJson<AnalyticsData>(`/api/analytics/dashboard?${q}`)
      .then((d) => {
        if (id !== dashReq.current) return;
        setData(d);
        setError(null);
      })
      .catch((e) => id === dashReq.current && setError(e instanceof Error ? e.message : 'Unknown error'))
      .finally(() => id === dashReq.current && setLoading(false));
  }, [restored, filters, reloadTick]);

  // Trend series
  useEffect(() => {
    if (!restored) return;
    const id = ++trendReq.current;
    setTrendLoading(true);
    const q = buildQuery(filters, { range: trendRange, granularity });
    getJson<TrendData>(`/api/analytics/trend?${q}`)
      .then((d) => id === trendReq.current && setTrend(d))
      .catch((e) => id === trendReq.current && setError(e instanceof Error ? e.message : 'Unknown error'))
      .finally(() => id === trendReq.current && setTrendLoading(false));
    // period does not drive the trend chart (it has its own range)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [restored, filters.courseType, filters.sponsorship, filters.course, trendRange, granularity, reloadTick]);

  // Popular Courses: its own period select, so only this card refreshes.
  useEffect(() => {
    if (!restored) return;
    const id = ++rankReq.current;
    setRankLoading(true);
    const q = buildQuery(filters, { period: rankPeriod });
    q.delete('course'); // the ranking is the course slicer, so it ignores it
    getJson<{ courses: CourseRank[] }>(`/api/analytics/course-ranking?${q}`)
      .then((d) => id === rankReq.current && setCourses(d.courses))
      .catch((e) => id === rankReq.current && setError(e instanceof Error ? e.message : 'Unknown error'))
      .finally(() => id === rankReq.current && setRankLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [restored, filters.courseType, filters.sponsorship, rankPeriod, reloadTick]);

  const update = useCallback((patch: Partial<Filters>) => setFilters((f) => ({ ...f, ...patch })), []);
  // The page Period carries into Popular Courses when the card offers it; the card can then be changed on its own.
  const setPeriod = useCallback(
    (v: Period) => {
      update({ period: v });
      if (isRankPeriod(v)) setRankPeriod(v);
    },
    [update],
  );
  const isFiltered =
    filters.period !== 'all' || filters.courseType !== 'all' || filters.sponsorship !== 'all' || !!filters.course;

  // Course-type chips come from the data so every tenant sees only its own types.
  const typeOptions = useMemo<Option<string>[]>(() => {
    const keys = (data?.courseTypeMix || []).map((t) => t.key);
    if (filters.courseType !== 'all' && !keys.includes(filters.courseType)) keys.push(filters.courseType);
    const order = ['WSQ', 'IBF', 'CASL', 'Non-WSQ'];
    const rank = (k: string) => (k === 'Other' ? 999 : order.indexOf(k) < 0 ? 500 : order.indexOf(k));
    keys.sort((a, b) => rank(a) - rank(b) || a.localeCompare(b));
    return [{ value: 'all', label: 'All courses' }, ...keys.map((k) => ({ value: k, label: k }))];
  }, [data?.courseTypeMix, filters.courseType]);

  const trendView = useMemo(() => {
    if (!trend) return null;
    const labels = bucketLabels(
      trend.series.map((s) => s.key),
      trend.granularity,
    );
    const sum = (k: 'learners' | 'enrolments' | 'grants' | 'claims') => trend.series.reduce((a, s) => a + s[k], 0);
    return {
      short: labels.map((l) => l.short),
      long: labels.map((l) => l.long),
      learners: trend.series.map((s) => s.learners),
      enrolments: trend.series.map((s) => s.enrolments),
      grants: trend.series.map((s) => s.grants),
      claims: trend.series.map((s) => s.claims),
      totals: {
        enrolments: sum('enrolments'),
        grants: sum('grants'),
        claims: sum('claims'),
      },
    };
  }, [trend]);

  const periodLabel = PERIOD_OPTIONS.find((o) => o.value === filters.period)?.label || 'All time';
  const rangeLabel = RANGE_OPTIONS.find((o) => o.value === trendRange)?.label || '';
  const rankPeriodLabel = RANK_PERIOD_OPTIONS.find((o) => o.value === rankPeriod)?.label || 'All time';
  const ranking = (courses || [])
    .slice()
    .sort((a, b) => b[rankMetric] - a[rankMetric])
    .slice(0, topN);

  if (!data && error) {
    return (
      <div className="flex h-64 flex-col items-center justify-center gap-3">
        <div className="text-lg text-red-600">Error: {error}</div>
        <button
          onClick={() => setReloadTick((t) => t + 1)}
          className="rounded-lg border border-gray-300 px-4 py-2 text-sm font-medium hover:bg-gray-100 dark:border-gray-600 dark:hover:bg-gray-700"
        >
          Retry
        </button>
      </div>
    );
  }

  if (!data) {
    return (
      <div className="flex h-64 items-center justify-center">
        <div className="text-lg">Loading analytics data...</div>
      </div>
    );
  }

  const summary = [
    periodLabel,
    filters.courseType !== 'all' ? filters.courseType : null,
    filters.sponsorship !== 'all'
      ? `${filters.sponsorship === 'employer' ? 'Employer' : 'Individual'}-sponsored`
      : null,
    filters.course?.label || null,
  ]
    .filter(Boolean)
    .join(' · ');

  return (
    <div>
      {/* Header */}
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-3xl font-bold">Training Analytics Dashboard</h2>
          <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
            Showing: <span className="font-medium text-gray-700 dark:text-gray-200">{summary}</span>
            {(loading || trendLoading || rankLoading) && (
              <span className="ml-2 animate-pulse text-primary">Updating…</span>
            )}
          </p>
        </div>
        <button
          onClick={() => setReloadTick((t) => t + 1)}
          disabled={loading || trendLoading || rankLoading}
          className="rounded-lg border border-gray-300 px-4 py-2 text-sm font-medium transition-colors hover:bg-gray-100 disabled:opacity-50 dark:border-gray-600 dark:hover:bg-gray-700"
        >
          {loading || trendLoading || rankLoading ? 'Refreshing...' : 'Refresh'}
        </button>
      </div>

      {/* Slicers */}
      <Card className="mb-6 p-4 sm:p-5 lg:sticky lg:top-0 lg:z-20">
        <div className="flex flex-wrap items-center gap-x-6 gap-y-3">
          <div className="flex items-center gap-2">
            <FilterLabel>Period</FilterLabel>
            <SelectBox ariaLabel="Period" options={PERIOD_OPTIONS} value={filters.period} onChange={setPeriod} />
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <FilterLabel>Course type</FilterLabel>
            <Segmented
              ariaLabel="Course type"
              size="sm"
              options={typeOptions}
              value={filters.courseType}
              onChange={(v) => update({ courseType: v })}
            />
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <FilterLabel>Sponsorship</FilterLabel>
            <Segmented
              ariaLabel="Sponsorship"
              size="sm"
              options={SPONSORSHIP_OPTIONS}
              value={filters.sponsorship}
              onChange={(v) => update({ sponsorship: v })}
            />
          </div>
          {filters.course && (
            <div className="flex items-center gap-2">
              <FilterLabel>Course</FilterLabel>
              <span className="inline-flex max-w-xs items-center gap-1 rounded-full bg-primary-50 py-1 pl-3 pr-1 text-xs font-semibold text-primary-700 dark:bg-primary-700/30 dark:text-blue-200">
                <span className="truncate" title={`${filters.course.label} (${filters.course.key})`}>
                  {filters.course.label}
                </span>
                <button
                  type="button"
                  aria-label="Clear course filter"
                  onClick={() => update({ course: null })}
                  className="rounded-full px-1.5 text-base leading-none hover:bg-primary-100 dark:hover:bg-primary-700/50"
                >
                  ×
                </button>
              </span>
            </div>
          )}
          {isFiltered && (
            <button
              type="button"
              onClick={() => {
                setFilters(DEFAULT_FILTERS);
                setRankPeriod('all');
              }}
              className="ml-auto text-sm font-semibold text-primary-600 hover:underline dark:text-blue-300"
            >
              Reset filters
            </button>
          )}
        </div>
      </Card>

      <div className={`transition-opacity ${loading ? 'opacity-60' : ''}`}>
        {/* KPIs — mobile: 2 cols (actuals left, forecasts right), desktop: 3 cols */}
        <div className="mb-8 grid grid-cols-2 gap-4 sm:gap-6 lg:grid-cols-3">
          <div className="lg:contents">
            <StatCard
              title="Total Learners Enrolled"
              value={num(data.totalLearners)}
              subtext={`${num(data.totalEnrolments)} enrolments · ${periodLabel}`}
            />
          </div>
          <div className="lg:hidden">
            <StatCard title="Enrollment Forecast" value={`~${num(data.enrollmentForecast)}`} subtext="Next 3 Months" />
          </div>
          <div className="lg:contents">
            <StatCard
              title="Total Grants Applied"
              value={money(data.totalGrants)}
              subtext={`${money(data.grantsInPipeline)} in pipeline`}
            />
          </div>
          <div className="lg:hidden">
            <StatCard title="Grant Forecast" value={`~${money(data.grantForecast)}`} subtext="Next 3 Months" />
          </div>
          <div className="lg:contents">
            <StatCard
              title="Total Claims Disbursed"
              value={money(data.totalClaims)}
              subtext={`${money(data.claimsInPipeline)} in pipeline`}
            />
          </div>
          <div className="lg:hidden">
            <StatCard title="Claim Forecast" value={`~${money(data.claimForecast)}`} subtext="Next 3 Months" />
          </div>
          <div className="hidden lg:block">
            <StatCard
              title="Enrollment Forecast"
              value={`~${num(data.enrollmentForecast)}`}
              subtext={`Next 3 Months · ${methodLabel(data.enrollmentForecastMethod)}`}
            />
          </div>
          <div className="hidden lg:block">
            <StatCard
              title="Grant Forecast"
              value={`~${money(data.grantForecast)}`}
              subtext={`Next 3 Months · ${methodLabel(data.grantForecastMethod)}`}
            />
          </div>
          <div className="hidden lg:block">
            <StatCard
              title="Claim Forecast"
              value={`~${money(data.claimForecast)}`}
              subtext={`Next 3 Months · ${methodLabel(data.claimForecastMethod)}`}
            />
          </div>
        </div>
      </div>

      {/* Trend: learners + enrolments */}
      <div className={`space-y-6 transition-opacity ${trendLoading ? 'opacity-60' : ''}`}>
        <Panel
          title="Learners enrolled"
          controls={
            <>
              <Segmented
                ariaLabel="Granularity"
                size="sm"
                options={[
                  { value: 'week', label: 'Week' },
                  { value: 'month', label: 'Month' },
                ]}
                value={granularity}
                onChange={setGranularity}
              />
              <SelectBox ariaLabel="Trend range" options={RANGE_OPTIONS} value={trendRange} onChange={setTrendRange} />
            </>
          }
          meta={trendView && `${num(trendView.totals.enrolments)} enrolments · by ${granularity}`}
        >
          {trendView ? (
            <TrendChart
              labels={trendView.short}
              tooltipTitles={trendView.long}
              series={[
                {
                  key: 'learners',
                  label: 'Learners',
                  color: CHART_COLORS.blue,
                  type: 'bar',
                },
                {
                  key: 'enrolments',
                  label: 'Enrolments',
                  color: CHART_COLORS.green,
                  type: 'line',
                },
              ]}
              data={{
                learners: trendView.learners,
                enrolments: trendView.enrolments,
              }}
              format={num}
            />
          ) : (
            <div className="h-[300px]" />
          )}
        </Panel>

        <Panel
          title={`Grants & claims by ${granularity}`}
          meta={
            trendView &&
            `${money(trendView.totals.grants)} grants · ${money(trendView.totals.claims)} claims · ${rangeLabel}`
          }
        >
          {trendView ? (
            <TrendChart
              labels={trendView.short}
              tooltipTitles={trendView.long}
              series={[
                {
                  key: 'grants',
                  label: 'Grants (by enrolment date)',
                  color: CHART_COLORS.blue,
                  type: 'bar',
                },
                {
                  key: 'claims',
                  label: 'Claims paid out (by payout date)',
                  color: CHART_COLORS.green,
                  type: 'bar',
                },
              ]}
              data={{ grants: trendView.grants, claims: trendView.claims }}
              format={money}
              axisFormat={moneyAxis}
            />
          ) : (
            <div className="h-[300px]" />
          )}
        </Panel>
      </div>

      <div className={`mt-6 space-y-6 transition-opacity ${loading ? 'opacity-60' : ''}`}>
        {/* Popular courses */}
        <Panel
          title="Popular Courses"
          className={`transition-opacity ${rankLoading ? 'opacity-60' : ''}`}
          controls={
            <>
              <SelectBox
                ariaLabel="Popular courses period"
                options={RANK_PERIOD_OPTIONS}
                value={rankPeriod}
                onChange={setRankPeriod}
              />
              <Segmented
                ariaLabel="Rank by"
                size="sm"
                options={[
                  { value: 'enrolments', label: 'Enrolments' },
                  { value: 'learners', label: 'Learners' },
                ]}
                value={rankMetric}
                onChange={setRankMetric}
              />
              <label className="flex items-center gap-2 text-sm text-gray-600 dark:text-gray-300">
                Top <span className="w-6 font-bold text-gray-900 dark:text-white tabular-nums">{topN}</span>
                <input
                  type="range"
                  min={5}
                  max={30}
                  step={1}
                  value={topN}
                  onChange={(e) => setTopN(Number(e.target.value))}
                  aria-label="Number of courses"
                  className="w-36 accent-blue-600"
                />
              </label>
            </>
          }
          meta={`${ranking.length} of top ${courses?.length ?? 0} by ${rankMetric} · ${rankPeriodLabel} · click a course to filter`}
        >
          {courses && courses.length === 0 ? (
            <p className="py-10 text-center text-sm text-gray-500 dark:text-gray-400">
              No enrolments in {rankPeriodLabel.toLowerCase()} for these filters.
            </p>
          ) : (
            <HBarList
              items={ranking.map((c) => ({
                key: c.key,
                label: c.label,
                value: c[rankMetric],
                hint: `${c.key} · ${c.courseType} · ${num(c.enrolments)} enrolments, ${num(c.learners)} learners`,
              }))}
              color={CHART_COLORS.green}
              format={num}
              labelWidth="38%"
              showAxis
              selectedKey={filters.course?.key ?? null}
              onSelect={(key) => {
                const c = courses?.find((r) => r.key === key);
                update({
                  course: filters.course?.key === key ? null : { key, label: c?.label || key },
                });
              }}
            />
          )}
        </Panel>

        {/* Breakdowns */}
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
          <Panel title="Learner Sponsorship Type" meta="Unique learners · click to filter">
            <DonutChart
              items={data.sponsorshipBreakdown}
              colors={{
                employer: CHART_COLORS.violet,
                individual: CHART_COLORS.blue,
              }}
              format={num}
              centerLabel="Learners"
              selectedKey={filters.sponsorship !== 'all' ? filters.sponsorship : null}
              onSelect={(key) =>
                update({
                  sponsorship: filters.sponsorship === key ? 'all' : (key as Sponsorship),
                })
              }
            />
          </Panel>
          <Panel title="Enrolment Status" meta="Unique learners">
            <DonutChart
              items={data.enrolmentStatusBreakdown}
              colors={{
                Confirmed: CHART_COLORS.green,
                Cancelled: CHART_COLORS.rose,
                Other: CHART_COLORS.slate,
              }}
              format={num}
              centerLabel="Learners"
            />
          </Panel>
          <Panel title="Course Type Mix" meta="Unique learners · click to filter">
            <HBarList
              items={data.courseTypeMix.map((t) => ({
                key: t.key,
                label: t.label,
                value: t.value,
                hint: `${num(t.enrolments || 0)} enrolments`,
              }))}
              color={CHART_COLORS.blue}
              selectedKey={filters.courseType !== 'all' ? filters.courseType : null}
              onSelect={(key) => update({ courseType: filters.courseType === key ? 'all' : key })}
            />
          </Panel>
          <Panel title="Learner Age Profile" meta="Unique learners, age today">
            <HBarList items={data.ageProfile} color={CHART_COLORS.blue} />
          </Panel>
        </div>
      </div>
    </div>
  );
};

export default TrainingProviderDashboard;
