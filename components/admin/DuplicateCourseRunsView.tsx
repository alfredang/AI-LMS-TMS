import React, { useMemo, useState } from 'react';

type RunAudit = {
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
  runs: RunAudit[];
  classification: 'both_have_enrolments' | 'one_has_enrolments' | 'no_enrolments' | 'mixed_unknown' | 'not_duplicate';
  keep_run_id: string | null;
  hide_candidates: string[];
  already_hidden_candidates?: string[];
  action: string;
};

type AuditResponse = {
  success: boolean;
  generated_at: string;
  course_code: string;
  course_reference_number?: string;
  filters?: {
    seed_course_run_id?: string | null;
    start_date?: string | null;
    end_date?: string | null;
    include_past_runs?: boolean;
    check_tpgateway_visibility?: boolean;
    upcoming_from?: string | null;
    course_run_ids?: string[];
    include_all_runs?: boolean;
    max_runs_to_audit?: number;
  };
  visibility_update_available: boolean;
  visibility_update_blocker: string;
  tpgateway_visibility_checked?: boolean;
  total_ssg_runs: number;
  checked_runs: number;
  duplicate_groups: DuplicateGroup[];
  summary: {
    duplicate_groups: number;
    both_have_enrolments: number;
    one_has_enrolments: number;
    no_enrolments: number;
    mixed_unknown: number;
    hide_candidates: number;
  };
  error?: string;
};

const CLASS_LABEL: Record<DuplicateGroup['classification'], string> = {
  both_have_enrolments: 'Both have enrolments',
  one_has_enrolments: 'One has enrolments',
  no_enrolments: 'No enrolments',
  mixed_unknown: 'Needs review',
  not_duplicate: 'Not duplicate',
};

const CLASS_STYLE: Record<DuplicateGroup['classification'], string> = {
  both_have_enrolments: 'bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-200',
  one_has_enrolments: 'bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-200',
  no_enrolments: 'bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-200',
  mixed_unknown: 'bg-purple-100 text-purple-700 dark:bg-purple-900/40 dark:text-purple-200',
  not_duplicate: 'bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-200',
};

function splitRunIds(value: string): string[] {
  return value
    .split(/[\s,;/]+/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function formatDateRange(group: DuplicateGroup): string {
  const formatDate = (value: string) => {
    const match = value.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (!match) return value;
    const [, year, month, day] = match;
    const date = new Date(Number(year), Number(month) - 1, Number(day));
    return date.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
  };
  return group.start_date === group.end_date
    ? formatDate(group.start_date)
    : `${formatDate(group.start_date)} - ${formatDate(group.end_date)}`;
}

function groupBadge(group: DuplicateGroup): { label: string; className: string } {
  if (group.classification === 'mixed_unknown') {
    return { label: 'Needs review', className: CLASS_STYLE.mixed_unknown };
  }
  if (group.classification === 'both_have_enrolments') {
    return { label: 'Both have enrolments', className: CLASS_STYLE.both_have_enrolments };
  }
  if (group.hide_candidates.length > 0) {
    return { label: 'Needs hide', className: CLASS_STYLE.no_enrolments };
  }
  if (group.already_hidden_candidates?.length) {
    return { label: 'Already hidden', className: 'bg-sky-100 text-sky-700 dark:bg-sky-900/40 dark:text-sky-200' };
  }
  return { label: CLASS_LABEL[group.classification], className: CLASS_STYLE[group.classification] };
}

const DuplicateCourseRunsView: React.FC = () => {
  const [seedCourseRunId, setSeedCourseRunId] = useState('');
  const [courseCode, setCourseCode] = useState('');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [courseRunIds, setCourseRunIds] = useState('');
  const [includeAllRuns, setIncludeAllRuns] = useState(false);
  const [includePastRuns, setIncludePastRuns] = useState(false);
  const [checkTpgatewayVisibility, setCheckTpgatewayVisibility] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [data, setData] = useState<AuditResponse | null>(null);

  const parsedRunIds = useMemo(() => splitRunIds(courseRunIds), [courseRunIds]);

  const runAudit = async () => {
    const code = courseCode.trim().toUpperCase();
    const seedId = seedCourseRunId.trim();
    if (!seedId && !code) {
      setError('Enter a course run ID or course code.');
      return;
    }

    setLoading(true);
    setError(null);
    setData(null);
    try {
      const res = await fetch('/api/admin/duplicate-course-runs-audit', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          seed_course_run_id: seedId || undefined,
          course_reference_number: code,
          start_date: startDate || undefined,
          end_date: endDate || undefined,
          include_past_runs: includePastRuns,
          check_tpgateway_visibility: checkTpgatewayVisibility,
          course_run_ids: parsedRunIds,
          include_all_runs: includeAllRuns,
        }),
      });
      const json = await res.json();
      if (!res.ok || !json.success) {
        setError(json.error || `Audit failed with HTTP ${res.status}`);
        return;
      }
      setData(json);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Audit failed.');
    } finally {
      setLoading(false);
    }
  };

  const useSample = () => {
    setSeedCourseRunId('1362665');
    setCourseCode('TGS-2023036661');
    setStartDate('2026-12-19');
    setEndDate('2026-12-27');
    setCourseRunIds('1329585 1362665');
    setIncludeAllRuns(false);
    setIncludePastRuns(false);
    setCheckTpgatewayVisibility(false);
  };

  return (
    <div className="p-6 space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-on-surface">Duplicate Course Runs</h1>
          <p className="text-sm text-on-surface-secondary mt-1 max-w-3xl">
            Search by course reference number to find same-date duplicate runs, compare enrolments on each run, and decide what should be hidden from public view.
          </p>
        </div>
        <button
          type="button"
          onClick={useSample}
          className="px-3 py-2 rounded-md border border-default bg-surface text-sm text-on-surface hover:bg-surface-elevated"
        >
          Fill example
        </button>
      </div>

      <div className="rounded-md border border-default bg-surface p-4 space-y-4">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <label className="space-y-1">
            <span className="text-xs font-medium text-on-surface-secondary">Course reference number</span>
            <input
              value={courseCode}
              onChange={(event) => setCourseCode(event.target.value.toUpperCase())}
              placeholder="TGS-2023036661"
              className="w-full rounded-md border border-default bg-background px-3 py-2 text-sm text-on-surface"
            />
          </label>
          <label className="space-y-1">
            <span className="text-xs font-medium text-on-surface-secondary">Course run ID optional</span>
            <input
              value={seedCourseRunId}
              onChange={(event) => setSeedCourseRunId(event.target.value)}
              placeholder="1362665"
              className="w-full rounded-md border border-default bg-background px-3 py-2 text-sm text-on-surface"
            />
          </label>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-5 gap-3">
          <label className="space-y-1">
            <span className="text-xs font-medium text-on-surface-secondary">Start date optional</span>
            <input
              type="date"
              value={startDate}
              onChange={(event) => setStartDate(event.target.value)}
              className="w-full rounded-md border border-default bg-background px-3 py-2 text-sm text-on-surface"
            />
          </label>
          <label className="space-y-1">
            <span className="text-xs font-medium text-on-surface-secondary">End date optional</span>
            <input
              type="date"
              value={endDate}
              onChange={(event) => setEndDate(event.target.value)}
              className="w-full rounded-md border border-default bg-background px-3 py-2 text-sm text-on-surface"
            />
          </label>
          <label className="flex items-end gap-2 text-sm text-on-surface-secondary pb-2">
            <input
              type="checkbox"
              checked={includeAllRuns}
              onChange={(event) => setIncludeAllRuns(event.target.checked)}
              className="accent-primary"
            />
            Show non-duplicate rows
          </label>
          <label className="flex items-end gap-2 text-sm text-on-surface-secondary pb-2">
            <input
              type="checkbox"
              checked={includePastRuns}
              onChange={(event) => setIncludePastRuns(event.target.checked)}
              className="accent-primary"
            />
            Include past runs
          </label>
          <label className="flex items-end gap-2 text-sm text-on-surface-secondary pb-2">
            <input
              type="checkbox"
              checked={checkTpgatewayVisibility}
              onChange={(event) => setCheckTpgatewayVisibility(event.target.checked)}
              className="accent-primary"
            />
            Check TPG visibility
          </label>
        </div>

        <label className="block space-y-1">
          <span className="text-xs font-medium text-on-surface-secondary">Course run IDs to focus on</span>
          <input
            value={courseRunIds}
            onChange={(event) => setCourseRunIds(event.target.value)}
            placeholder="Optional: 1329585 1362665"
            className="w-full rounded-md border border-default bg-background px-3 py-2 text-sm text-on-surface"
          />
        </label>

        <div className="flex flex-wrap items-center gap-3">
          <button
            type="button"
            onClick={runAudit}
            disabled={loading || (!seedCourseRunId.trim() && !courseCode.trim())}
            className="px-4 py-2 rounded-md bg-primary text-white text-sm font-medium hover:opacity-90 disabled:opacity-50"
          >
            {loading ? 'Checking SSG...' : 'Find duplicates'}
          </button>
          <span className="text-xs text-on-surface-secondary">
            Defaults to upcoming runs only. TPG visibility uses server cookie only; this page never changes, hides, or deletes anything.
          </span>
        </div>
      </div>

      {error && (
        <div className="rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-900 dark:bg-red-900/20 dark:text-red-200">
          {error}
        </div>
      )}

      {data && (
        <div className="space-y-4">
          <div className="rounded-md border border-default bg-surface px-4 py-3 text-sm text-on-surface-secondary">
            Resolved course: <span className="font-mono text-on-surface">{data.course_code}</span>
            {data.filters?.seed_course_run_id && (
              <>
                {' '}from run <span className="font-mono text-on-surface">{data.filters.seed_course_run_id}</span>
              </>
            )}
            {data.filters?.start_date && data.filters?.end_date && (
              <>
                {' '}for <span className="font-medium text-on-surface">{data.filters.start_date} to {data.filters.end_date}</span>
              </>
            )}
            {!data.filters?.include_past_runs && data.filters?.upcoming_from && (
              <>
                {' '}| showing upcoming runs from <span className="font-medium text-on-surface">{data.filters.upcoming_from}</span>
              </>
            )}
            {' '}| public visibility {data.tpgateway_visibility_checked ? 'checked from TPGateway cookie' : 'not confirmed'}
            {data.filters?.max_runs_to_audit ? <> | max audit size <span className="font-medium text-on-surface">{data.filters.max_runs_to_audit}</span></> : null}
          </div>

          <div className="grid grid-cols-2 md:grid-cols-6 gap-3">
            {[
              ['SSG total', data.total_ssg_runs],
              [data.filters?.include_past_runs ? 'Checked' : 'Upcoming checked', data.checked_runs],
              [data.filters?.include_past_runs ? 'Backend duplicates' : 'Upcoming backend duplicates', data.summary.duplicate_groups],
              ['One enrolled', data.summary.one_has_enrolments],
              ['Both enrolled', data.summary.both_have_enrolments],
              ['Hide candidates', data.summary.hide_candidates],
            ].map(([label, value]) => (
              <div key={label} className="rounded-md border border-default bg-surface px-3 py-2">
                <div className="text-xs text-on-surface-secondary">{label}</div>
                <div className="text-xl font-semibold text-on-surface">{value}</div>
              </div>
            ))}
          </div>

          {!data.visibility_update_available && (
            <div className="rounded-md border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900 dark:border-amber-900 dark:bg-amber-900/20 dark:text-amber-100">
              {data.visibility_update_blocker}
            </div>
          )}

          <div className="rounded-md border border-default bg-surface px-4 py-3 text-sm text-on-surface-secondary">
            This page is read-only. Only confirmed public, zero-active-enrolment candidates are labelled Hide; all unknown cases need manual review in TPGateway.
          </div>

          {data.duplicate_groups.length === 0 ? (
            <div className="rounded-md border border-default bg-surface p-6 text-center text-sm text-on-surface-secondary">
              No duplicate groups matched the current filters.
            </div>
          ) : (
            <div className="space-y-3">
              {data.duplicate_groups.map((group) => {
                const badge = groupBadge(group);
                return (
                <div key={group.key} className="rounded-md border border-default bg-surface overflow-hidden">
                  <div className="px-4 py-3 bg-surface-elevated border-b border-default flex flex-wrap items-center gap-3">
                    <div className="flex-1 min-w-[220px]">
                      <div className="font-semibold text-on-surface">{formatDateRange(group)}</div>
                      <div className="text-xs text-on-surface-secondary">
                        Keep: {group.keep_run_id || '-'} | Confirmed hide candidates: {group.hide_candidates.length ? group.hide_candidates.join(', ') : '-'}
                        {group.already_hidden_candidates?.length ? ` | Already hidden: ${group.already_hidden_candidates.join(', ')}` : ''}
                      </div>
                    </div>
                    <span className={`px-2 py-1 rounded-full text-xs font-medium ${badge.className}`}>
                      {badge.label}
                    </span>
                  </div>

                  <div className="px-4 py-2 text-xs text-on-surface-secondary border-b border-default">
                    {group.action}
                  </div>

                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead className="bg-surface-elevated text-xs uppercase text-on-surface-secondary">
                        <tr>
                          <th className="text-left px-4 py-2">Run ID</th>
                          <th className="text-left px-4 py-2">TPG visibility</th>
                          <th className="text-left px-4 py-2">In LMS</th>
                          <th className="text-left px-4 py-2">SSG active enrolments</th>
                          <th className="text-left px-4 py-2">SSG total</th>
                          <th className="text-left px-4 py-2">LMS active</th>
                          <th className="text-left px-4 py-2">Recommendation</th>
                        </tr>
                      </thead>
                      <tbody>
                        {group.runs.map((run) => {
                          const isKeep = run.course_run_id === group.keep_run_id;
                          const isHide = group.hide_candidates.includes(run.course_run_id);
                          const isAlreadyHidden = !!group.already_hidden_candidates?.includes(run.course_run_id);
                          const needsManualReview = !isKeep && !isHide && !isAlreadyHidden;
                          return (
                            <tr key={run.course_run_id} className="border-t border-default">
                              <td className="px-4 py-2 font-mono text-xs text-on-surface">{run.course_run_id}</td>
                              <td className="px-4 py-2 text-on-surface-secondary">{run.public_visibility || 'Unknown from SSG'}</td>
                              <td className="px-4 py-2">{run.in_lms ? 'Yes' : 'No'}</td>
                              <td className="px-4 py-2 font-semibold text-on-surface">
                                {run.ssg_enrolment_error ? (
                                  <span className="text-red-600 dark:text-red-300" title={run.ssg_enrolment_error}>
                                    Error
                                    <span className="block max-w-[260px] truncate text-[11px] font-normal">{run.ssg_enrolment_error}</span>
                                  </span>
                                ) : run.active_ssg_enrolment_count}
                              </td>
                              <td className="px-4 py-2">{run.ssg_enrolment_count}</td>
                              <td className="px-4 py-2">{run.local_enrolment_count}</td>
                              <td className="px-4 py-2">
                                {isKeep && <span className="text-green-700 dark:text-green-300 font-medium">Keep visible</span>}
                                {isHide && <span className="text-amber-700 dark:text-amber-300 font-medium">Hide</span>}
                                {isAlreadyHidden && <span className="text-sky-700 dark:text-sky-300 font-medium">Already hidden</span>}
                                {needsManualReview && <span className="text-on-surface-secondary">Review manually</span>}
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>

                  <div className="px-4 py-3 bg-surface-elevated border-t border-default text-xs text-on-surface-secondary">
                    Manual action only. No automated database, SSG, or TPGateway changes are made here.
                  </div>
                </div>
                );
              })}
            </div>
          )}
        </div>
      )}
    </div>
  );
};

export default DuplicateCourseRunsView;
