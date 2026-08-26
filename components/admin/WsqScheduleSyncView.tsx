import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';

type SyncStatus = 'synced' | 'missing_in_ssg' | 'extra_in_ssg' | 'unparsed';

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
  wsq_support_from: string | null;
  wsq_support_to: string | null;
  rows: Row[];
};

type ApiResponse = {
  generated_at: string;
  magento_count: number;
  today?: string;              // server "today" in SGT — reference date for the past-classes toggle
  include_past?: boolean;
  counts: { synced: number; missing_in_ssg: number; extra_in_ssg: number; unparsed: number };
  courses: CourseGroup[];
  cached: string | null;
};

type ApiError = { error: string; message?: string; status?: number; body?: any };
type Filter = 'missing_in_ssg' | 'blocked' | 'synced' | 'extra_in_ssg' | 'unparsed';

const BLOCKED_PATTERNS = ['not eligible', 'support period', 'course start date has to be between'];
const isBlockedError = (msg: string) => {
  const l = msg.toLowerCase();
  return BLOCKED_PATTERNS.some((p) => l.includes(p));
};
const normalizeError = (msg: string): string => {
  if (/support period/i.test(msg) || /course start date has to be between/i.test(msg)) {
    return 'Outside Course Support Period';
  }
  return msg;
};

type ItemResult = {
  course_code: string;
  start_date: string;
  end_date: string;
  status: 'submitted' | 'exists' | 'no_course' | 'no_session_timing' | 'ssg_error' | 'error';
  ssg_run_id?: string;
  message?: string;
};

type SharedJob = {
  id: number;
  status: 'running' | 'completed' | 'failed';
  started_at: string;
  completed_at: string | null;
  total_items: number;
  items_done: number;
  submitted: number;
  already_exists: number;
  ssg_errors: number;
  skipped: number;
  failures: ItemResult[];
  summary: string | null;
  triggered_by: 'user' | 'cron';
};

type CronLog = {
  id: number;
  created_at: string;
  cron: 'daily_fresh' | 'weekly_blocked';
  status: 'started' | 'nothing_to_do' | 'already_running' | 'error';
  considered: number | null;
  skipped_previously_failed: number | null;
  mms_courses: number | null;
  job_id: number | null;
  message: string | null;
};

const STATUS_LABEL: Record<SyncStatus, string> = {
  synced: '✓ Synced',
  missing_in_ssg: '⚠ Missing in SSG',
  extra_in_ssg: 'ℹ Only in SSG',
  unparsed: '? Unparsed',
};

const STATUS_CLASS: Record<SyncStatus, string> = {
  synced: 'bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200',
  missing_in_ssg: 'bg-amber-100 text-amber-800 dark:bg-amber-900 dark:text-amber-200',
  extra_in_ssg: 'bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200',
  unparsed: 'bg-gray-200 text-gray-700 dark:bg-gray-700 dark:text-gray-200',
};

const WsqScheduleSyncView: React.FC = () => {
  const [data, setData] = useState<ApiResponse | null>(null);
  const [error, setError] = useState<ApiError | null>(null);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<Filter>('missing_in_ssg');
  const [search, setSearch] = useState('');
  // Show past-dated classes (yesterday & earlier). Off by default — hides failed
  // syncs for classes whose dates have passed AND prevents retrying them.
  const [showPast, setShowPast] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [syncing, setSyncing] = useState(false);
  const [refreshingSupport, setRefreshingSupport] = useState(false);
  const [allJobs, setAllJobs] = useState<SharedJob[]>([]);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [cronLogs, setCronLogs] = useState<CronLog[]>([]);
  const [cronLogOpen, setCronLogOpen] = useState(false);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const load = async (refresh = false) => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams();
      if (refresh) params.set('refresh', '1');
      if (showPast) params.set('include_past', '1');
      const qs = params.toString();
      const resp = await fetch(`/api/admin/wsq-schedule-sync${qs ? `?${qs}` : ''}`);
      const json = await resp.json();
      if (!resp.ok) {
        setError(json as ApiError);
        setData(null);
      } else {
        setData(json as ApiResponse);
      }
    } catch (e: any) {
      setError({ error: 'network_error', message: e?.message || 'Failed to load' });
    } finally {
      setLoading(false);
    }
  };

  // Reload on mount and whenever the past-classes toggle changes (server filters
  // by include_past). load() reads showPast from closure.
  useEffect(() => { void load(false); }, [showPast]); // eslint-disable-line react-hooks/exhaustive-deps

const stopPolling = useCallback(() => {
    if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null; }
  }, []);

  const fetchJobs = useCallback(async () => {
    try {
      const resp = await fetch('/api/admin/wsq-schedule-sync/job-status');
      if (!resp.ok) return;
      const jobs: SharedJob[] = await resp.json();
      if (Array.isArray(jobs)) setAllJobs(jobs);
    } catch { /* ignore */ }
  }, []);

  const fetchCronLogs = useCallback(async () => {
    try {
      const resp = await fetch('/api/admin/wsq-sync-cron-logs?limit=30');
      if (!resp.ok) return;
      const json = await resp.json();
      if (json?.success && Array.isArray(json.data)) setCronLogs(json.data);
    } catch { /* ignore */ }
  }, []);

  const startPolling = useCallback(() => {
    if (pollRef.current) return;
    pollRef.current = setInterval(async () => {
      try {
        const resp = await fetch('/api/admin/wsq-schedule-sync/job-status');
        if (!resp.ok) return;
        const jobs: SharedJob[] = await resp.json();
        if (!Array.isArray(jobs)) return;
        setAllJobs(jobs);
        if (!jobs[0] || jobs[0].status !== 'running') stopPolling();
      } catch { /* ignore */ }
    }, 2000);
  }, [stopPolling]);

  // On mount: load job history; resume polling if a job is running
  useEffect(() => {
    const check = async () => {
      await fetchJobs();
      await fetchCronLogs();
      setAllJobs((prev) => {
        if (prev[0]?.status === 'running') startPolling();
        return prev;
      });
    };
    void check();
    return stopPolling;
  }, [fetchJobs, fetchCronLogs, startPolling, stopPolling]);

  // Most-recent error per "course_code|start_date" across all completed jobs.
  // Oldest jobs processed first so newer runs overwrite older ones.
  // Error messages are normalised (long support-period message shortened).
  const failedAttempts = useMemo(() => {
    const map = new Map<string, string>();
    for (const job of [...allJobs].reverse()) {
      const failures: ItemResult[] = Array.isArray(job.failures) ? job.failures : [];
      for (const f of failures) {
        if (f.course_code && f.start_date) {
          map.set(`${f.course_code}|${f.start_date}`, normalizeError(f.message || f.status));
        }
      }
    }
    return map;
  }, [allJobs]);

  // Reference "today" (SGT) from the server, and a filter that hides failure lines
  // for classes whose start date has already passed — unless "Show past" is on.
  const today = data?.today || '';
  const visibleFailures = (failures: ItemResult[]) =>
    (showPast || !today) ? failures : failures.filter((f) => !f.start_date || f.start_date >= today);

  const filtered = useMemo(() => {
    if (!data) return [];
    const q = search.trim().toLowerCase();
    return data.courses
      .map((g) => ({
        ...g,
        rows: g.rows.filter((r) => {
          if (filter === 'missing_in_ssg' || filter === 'blocked') {
            if (r.status !== 'missing_in_ssg') return false;
            const err = r.start_date ? failedAttempts.get(`${g.course_code}|${r.start_date}`) : undefined;
            const blocked = !!err && isBlockedError(err);
            return filter === 'blocked' ? blocked : !blocked;
          }
          return r.status === filter;
        }),
      }))
      .filter((g) => {
        if (g.rows.length === 0) return false;
        if (!q) return true;
        return g.course_code.toLowerCase().includes(q) || g.course_title.toLowerCase().includes(q);
      });
  }, [data, filter, search, failedAttempts]);

  // Count of syncable rows visible in the current filter (g.rows is already status-filtered)
  const totalSyncable = useMemo(
    () => filtered.reduce((acc, g) => acc + g.rows.filter((r) => r.start_date && r.end_date).length, 0),
    [filtered],
  );

  // Count of missing rows with blocked errors (not eligible / outside support period)
  const blockedCount = useMemo(() => {
    if (!data) return 0;
    return data.courses.reduce((sum, g) =>
      sum + g.rows.filter((r) => {
        if (r.status !== 'missing_in_ssg' || !r.start_date) return false;
        const err = failedAttempts.get(`${g.course_code}|${r.start_date}`);
        return !!err && isBlockedError(err);
      }).length, 0,
    );
  }, [data, failedAttempts]);

  const toggle = (code: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(code)) next.delete(code); else next.add(code);
      return next;
    });
  };

  const expandAll = () => setExpanded(new Set(filtered.map((g) => g.course_code)));
  const collapseAll = () => setExpanded(new Set());

  const syncToSSG = async (items: { course_code: string; start_date: string; end_date: string }[], label: string) => {
    // Only sync/retry past-dated classes when "Show past classes" is on. This gates
    // Retry-All + per-course + per-row retries at the action level — a safety net in
    // case stale (past-included) data is briefly present during a toggle reload.
    const eligible = (showPast || !today) ? items : items.filter((it) => it.start_date >= today);
    if (eligible.length === 0) {
      setNotice(items.length > 0 && !showPast
        ? 'Those are past-dated classes — enable "Show past classes" to sync/retry them.'
        : 'No missing schedules to sync.');
      return;
    }
    if (!confirm(`Submit ${eligible.length} missing course run(s) to SSG (${label})?\n\nRuns in SSG/TPGateway using session timing templates and default venue details. You can close this page — the sync continues on the server.`)) return;

    setSyncing(true);
    setNotice(null);
    try {
      const resp = await fetch('/api/admin/wsq-schedule-sync/run-sync', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ items: eligible, triggered_by: 'user' }),
      });
      const json = await resp.json();
      if (resp.status === 409) {
        setNotice('A sync is already running — tracking its progress.');
        startPolling();
        return;
      }
      if (!resp.ok) {
        setNotice(`Could not start sync: ${json.error || resp.status}`);
        return;
      }
      // Job created on server — poll for live progress
      startPolling();
      await fetchJobs();
    } catch (e: any) {
      setNotice(`Sync failed to start: ${e?.message || e}`);
    } finally {
      setSyncing(false);
    }
  };

  /**
   * Pull each course's WSQ funding support window from SSG into
   * course.ssg_wsq_support_from/to. SSG is only READ — nothing is submitted to
   * or changed there. Without this every group header reads "WSQ support: not
   * loaded", so a run blocked on "outside support period" looks unexplained.
   */
  const refreshSupportPeriods = async () => {
    if (!confirm(
      'Refresh WSQ funding support periods from SSG?\n\n' +
      'Reads every TGS course from SSG and stores its funding window locally. ' +
      'Nothing is submitted to or changed in SSG.\n\n' +
      'SSG throttles this, so it runs in paced batches and can take a few minutes. ' +
      'Keep this page open.'
    )) return;

    setRefreshingSupport(true);
    setNotice('Refreshing support periods from SSG…');

    // Stamped ONCE: every round is measured against the same instant, so clicking
    // the button re-checks every course however recently it last ran, while courses
    // written during this run drop out and the loop still finishes.
    const runStartedAt = new Date().toISOString();
    const tally = { updated: 0, no_support: 0, failed: 0 };
    let lastErr = '';
    try {
      // The endpoint is resumable and rate-limit paced, so it returns after a
      // batch with however many courses are still stale. Loop until it reports
      // nothing left — bounded, and we stop early if a round makes no progress
      // (otherwise a persistently failing batch would spin).
      for (let round = 0; round < 20; round++) {
        const resp = await fetch('/api/admin/wsq-schedule-sync/refresh-support-periods', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          // max_age_hours 1, not the endpoint default of 12: clicking a button
          // labelled "Refresh" should actually refresh, and after a code change
          // to how the funding window is looked up the stored dates are wrong
          // rather than merely old. Deliberately not 0 — with no age floor the
          // rows just written would still count as stale, so the same batch
          // would be re-fetched every round and the loop would never advance.
          body: JSON.stringify({ batch_size: 50, refreshed_before: runStartedAt }),
        });
        const json = await resp.json();
        if (!resp.ok) {
          setNotice(`Could not refresh support periods: ${json.error || json.message || resp.status}`);
          return;
        }
        const sum = json.summary || {};
        const progress = (sum.updated ?? 0) + (sum.no_wsq_support ?? 0);
        tally.updated += sum.updated ?? 0;
        tally.no_support += sum.no_wsq_support ?? 0;
        // Last round only: a course that failed earlier is retried in a later
        // round, so summing would double-count courses that eventually succeeded.
        tally.failed = sum.ssg_error ?? 0;

        if (Array.isArray(json.errors) && json.errors.length) {
          lastErr = `${json.errors[0].course_code}: ${json.errors[0].message}`;
          console.warn('[support-periods] SSG errors:', json.errors);
        }

        setNotice(`Refreshing support periods… ${tally.updated} done, ${json.remaining ?? 0} to go.`);
        if (!json.remaining || progress === 0) break;
      }

      setNotice(
        `Support periods refreshed — ${tally.updated} updated, ${tally.no_support} with no WSQ support, ` +
        `${tally.failed} still failing.` + (lastErr ? ` Last error — ${lastErr}` : ''),
      );
      await load(true);
    } catch (e: any) {
      setNotice(`Support period refresh failed: ${e?.message || e}`);
    } finally {
      setRefreshingSupport(false);
    }
  };

  const syncAll = () => {
    const items = filtered.flatMap((g) =>
      g.rows
        .filter((r) => r.start_date && r.end_date)
        .map((r) => ({ course_code: g.course_code, start_date: r.start_date!, end_date: r.end_date! })),
    );
    void syncToSSG(items, 'all courses, current filter');
  };

  const syncCourse = (g: CourseGroup) => {
    const items = g.rows
      .filter((r) => r.start_date && r.end_date)
      .map((r) => ({ course_code: g.course_code, start_date: r.start_date!, end_date: r.end_date! }));
    void syncToSSG(items, g.course_code);
  };

  const syncRow = (group: CourseGroup, row: Row) => {
    if (!row.start_date || !row.end_date) return;
    void syncToSSG(
      [{ course_code: group.course_code, start_date: row.start_date, end_date: row.end_date }],
      `${group.course_code} ${row.start_date}`,
    );
  };

  const isJobRunning = syncing || allJobs[0]?.status === 'running';

  return (
    <div className="p-6 space-y-4">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold text-on-surface">WSQ Schedule Sync</h1>
          <p className="text-sm text-on-surface-secondary mt-1 max-w-3xl">
            Compares upcoming course dates on the Tertiary Courses storefront against course runs in SSG/TPGateway. Past-dated schedules are hidden by default — enable &quot;Show past classes&quot; to review and retry them. Use &quot;Sync to SSG&quot; to submit missing runs directly to SSG using session timing templates and default venue details.
          </p>
        </div>
        <div className="flex gap-2">
          <button
            onClick={syncAll}
            disabled={isJobRunning || totalSyncable === 0}
            className={`px-3 py-2 text-sm rounded-md text-white hover:opacity-90 disabled:opacity-50 ${filter === 'blocked' ? 'bg-orange-600' : 'bg-primary'}`}
          >
            {isJobRunning ? 'Syncing…' : filter === 'blocked' ? `Retry All (${totalSyncable})` : `Sync All to SSG (${totalSyncable})`}
          </button>
          <button
            onClick={refreshSupportPeriods}
            disabled={refreshingSupport || isJobRunning}
            title="Load each course's WSQ funding window from SSG so blocked dates are explainable"
            className="px-3 py-2 text-sm rounded-md bg-surface-elevated text-on-surface border border-gray-300 dark:border-gray-700 hover:opacity-90 disabled:opacity-50"
          >
            {refreshingSupport ? 'Refreshing support…' : 'Refresh Support Periods'}
          </button>
          <button
            onClick={() => load(true)}
            disabled={loading}
            className="px-3 py-2 text-sm rounded-md bg-primary text-white hover:opacity-90 disabled:opacity-50"
          >
            {loading ? 'Loading…' : 'Refresh'}
          </button>
        </div>
      </div>

      {error && (
        <div className="p-3 rounded-md bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-100 text-sm">
          <div className="font-semibold">Failed to load schedule data</div>
          <div>{error.message || error.error}</div>
          {error.status && <div className="text-xs mt-1">Upstream status: {error.status}</div>}
          {error.body && <pre className="mt-2 text-xs overflow-auto max-h-32">{typeof error.body === 'string' ? error.body : JSON.stringify(error.body, null, 2)}</pre>}
        </div>
      )}

      {notice && (
        <div className="p-3 rounded-md bg-amber-100 text-amber-900 dark:bg-amber-900 dark:text-amber-100 text-sm flex items-start justify-between gap-3">
          <div>{notice}</div>
          <button onClick={() => setNotice(null)} className="text-xs underline">dismiss</button>
        </div>
      )}

      {/* ── Sync History (single fully-collapsible panel) ────────────────────── */}
      {allJobs.length > 0 && (
        <div className="rounded-md border border-default overflow-hidden">
          <button
            onClick={() => setHistoryOpen((o) => !o)}
            className="w-full px-4 py-2 flex items-center justify-between text-sm bg-surface-elevated hover:bg-surface text-on-surface"
          >
            <span className="font-medium flex items-center gap-2 flex-wrap">
              Sync History
              <span className="text-xs text-on-surface-secondary font-normal">({allJobs.length} run{allJobs.length !== 1 ? 's' : ''})</span>
              {allJobs[0].status === 'running' && (
                <span className="flex items-center gap-1.5 text-xs text-blue-600 dark:text-blue-400 font-normal">
                  <span className="inline-block w-2 h-2 rounded-full bg-blue-500 animate-pulse" />
                  Syncing {allJobs[0].items_done} / {allJobs[0].total_items}
                </span>
              )}
            </span>
            <span>{historyOpen ? '▾' : '▸'}</span>
          </button>

          {historyOpen && (
            <div className="divide-y divide-default max-h-[32rem] overflow-y-auto border-t border-default">
              {allJobs.map((job) => {
                const isRunning = job.status === 'running';
                const failures: ItemResult[] = visibleFailures(Array.isArray(job.failures) ? job.failures : []);
                const jobHasFailures = failures.length > 0;
                const statusCls = isRunning ? 'text-blue-600 dark:text-blue-400'
                  : (job.status === 'failed' || jobHasFailures) ? 'text-red-600 dark:text-red-400'
                  : 'text-green-600 dark:text-green-400';
                return (
                  <div key={job.id} className="px-4 py-2 text-xs space-y-1">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                        {isRunning && <span className="inline-block w-2 h-2 rounded-full bg-blue-500 animate-pulse shrink-0" />}
                        <span className="font-mono text-on-surface-secondary">
                          {new Date(job.started_at).toLocaleString()}
                          {job.completed_at && ` → ${new Date(job.completed_at).toLocaleTimeString()}`}
                        </span>
                        <span className={`px-1.5 py-0.5 rounded ${job.triggered_by === 'cron' ? 'bg-purple-100 text-purple-700 dark:bg-purple-900 dark:text-purple-300' : 'bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400'}`}>
                          {job.triggered_by === 'cron' ? 'Cron' : 'Manual'}
                        </span>
                        <span className={`font-medium ${statusCls}`}>
                          {isRunning
                            ? `Syncing… ${job.items_done} / ${job.total_items} runs`
                            : job.summary || (jobHasFailures ? `${failures.length} error${failures.length !== 1 ? 's' : ''}` : 'Completed')}
                        </span>
                      </div>
                      <div className="flex items-center gap-3 text-on-surface-secondary">
                        {job.submitted > 0 && <span className="text-green-600 dark:text-green-400">{job.submitted} submitted</span>}
                        {job.already_exists > 0 && <span>{job.already_exists} existed</span>}
                        {job.ssg_errors > 0 && <span className="text-red-500">{job.ssg_errors} SSG errors</span>}
                        {job.skipped > 0 && <span>{job.skipped} skipped</span>}
                        {isRunning && (
                          <button
                            onClick={async () => {
                              await fetch('/api/admin/wsq-schedule-sync/cancel-job', {
                                method: 'POST',
                                headers: { 'Content-Type': 'application/json' },
                                body: JSON.stringify({ job_id: job.id }),
                              });
                              stopPolling();
                              await fetchJobs();
                            }}
                            className="px-2 py-0.5 rounded border border-red-300 text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/30"
                          >
                            Cancel sync
                          </button>
                        )}
                      </div>
                    </div>
                    {isRunning && job.total_items > 0 && (
                      <div className="w-full bg-blue-100 dark:bg-blue-900 rounded-full h-1.5">
                        <div className="bg-blue-500 h-1.5 rounded-full transition-all duration-500"
                          style={{ width: `${Math.round((job.items_done / job.total_items) * 100)}%` }} />
                      </div>
                    )}
                    {jobHasFailures && (
                      <div className="mt-1 space-y-0.5 pl-2 border-l-2 border-red-200 dark:border-red-800 max-h-48 overflow-y-auto">
                        {failures.map((f, fi) => (
                          <div key={fi} className="text-on-surface-secondary font-mono">
                            {f.course_code} {f.start_date} → {f.end_date}
                            {f.message && <span className="text-red-500 ml-2">{normalizeError(f.message)}</span>}
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}


      {/* ── Cron Activity (daily-fresh + weekly-blocked run log) ──────────────── */}
      {cronLogs.length > 0 && (
        <div className="rounded-md border border-default overflow-hidden">
          <button
            onClick={() => setCronLogOpen((o) => !o)}
            className="w-full px-4 py-2 flex items-center justify-between text-sm bg-surface-elevated hover:bg-surface text-on-surface"
          >
            <span className="font-medium flex items-center gap-2">
              Cron Activity
              <span className="text-xs text-on-surface-secondary font-normal">({cronLogs.length} recent run{cronLogs.length !== 1 ? 's' : ''})</span>
            </span>
            <span>{cronLogOpen ? '▾' : '▸'}</span>
          </button>
          {cronLogOpen && (
            <div className="divide-y divide-default max-h-80 overflow-y-auto border-t border-default text-xs">
              {cronLogs.map((l) => (
                <div key={l.id} className="px-4 py-2 flex flex-wrap items-center gap-x-3 gap-y-1">
                  <span className="font-mono text-on-surface-secondary">{new Date(l.created_at).toLocaleString()}</span>
                  <span className={`px-1.5 py-0.5 rounded ${l.cron === 'weekly_blocked' ? 'bg-orange-100 text-orange-700 dark:bg-orange-900 dark:text-orange-300' : 'bg-blue-100 text-blue-700 dark:bg-blue-900 dark:text-blue-300'}`}>
                    {l.cron === 'weekly_blocked' ? 'Weekly retry' : 'Daily fresh'}
                  </span>
                  <span className={`font-medium ${l.status === 'error' ? 'text-red-600 dark:text-red-400' : l.status === 'started' ? 'text-green-600 dark:text-green-400' : 'text-on-surface-secondary'}`}>
                    {l.status}
                  </span>
                  {l.considered != null && <span className="text-on-surface-secondary">{l.considered} considered</span>}
                  {l.skipped_previously_failed ? <span className="text-on-surface-secondary">{l.skipped_previously_failed} skipped (prev-failed)</span> : null}
                  {l.job_id != null && <span className="text-on-surface-secondary">job #{l.job_id}</span>}
                  {l.message && <span className="text-on-surface-secondary italic truncate max-w-[320px]" title={l.message}>{l.message}</span>}
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {data && (
        <>
          <div className="flex flex-wrap items-center gap-3 text-sm">
            <span className="text-on-surface-secondary">Generated: <span className="text-on-surface">{new Date(data.generated_at).toLocaleString()}</span></span>
            <span className="text-on-surface-secondary">Magento courses: <span className="text-on-surface">{data.magento_count}</span></span>
            {data.cached && <span className="text-xs text-on-surface-secondary">(cached at {new Date(data.cached).toLocaleTimeString()})</span>}
            <label className="ml-auto flex items-center gap-1.5 text-xs text-on-surface-secondary cursor-pointer select-none whitespace-nowrap" title="Show classes whose dates are yesterday or earlier — enables reviewing and retrying past-dated failed syncs.">
              <input type="checkbox" checked={showPast} onChange={(e) => setShowPast(e.target.checked)} className="accent-primary" />
              Show past classes
            </label>
          </div>

          <div className="flex flex-wrap gap-2 items-center">
            {([
              ['missing_in_ssg', `Missing (${Math.max(0, data.counts.missing_in_ssg - blockedCount)})`],
              ['blocked',        `Not eligible / Outside support period (${blockedCount})`],
              ['synced',         `Synced (${data.counts.synced})`],
              ['extra_in_ssg',   `Only in SSG (${data.counts.extra_in_ssg})`],
              ['unparsed',       `Unparsed (${data.counts.unparsed})`],
            ] as [Filter, string][]).map(([f, label]) => (
              <button
                key={f}
                onClick={() => setFilter(f)}
                className={`px-3 py-1.5 text-xs rounded-full border ${
                  filter === f
                    ? (f === 'blocked' ? 'bg-orange-600 text-white border-orange-600' : 'bg-primary text-white border-primary')
                    : 'bg-surface text-on-surface border-default hover:bg-surface-elevated'
                }`}
              >
                {label}
              </button>
            ))}
            <input
              type="search"
              placeholder="Search course code or title…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="ml-auto px-3 py-1.5 text-sm rounded-md border border-default bg-surface text-on-surface min-w-[260px]"
            />
            <button onClick={expandAll} className="px-2 py-1 text-xs rounded-md border border-default text-on-surface hover:bg-surface-elevated">Expand all</button>
            <button onClick={collapseAll} className="px-2 py-1 text-xs rounded-md border border-default text-on-surface hover:bg-surface-elevated">Collapse all</button>
          </div>

          <div className="space-y-3">
            {filtered.length === 0 && !loading && (
              <div className="p-6 text-center text-sm text-on-surface-secondary bg-surface rounded-md border border-default">
                No rows match the current filter.
              </div>
            )}
            {filtered.map((g) => {
              const isOpen = expanded.has(g.course_code);
              const missingCount  = g.rows.filter((r) => r.status === 'missing_in_ssg').length;
              const syncedCount   = g.rows.filter((r) => r.status === 'synced').length;
              const syncableCount = g.rows.filter((r) => r.start_date && r.end_date).length;
              // "errored" = missing rows with a non-blocked error; "blocked" = not eligible / outside support period
              const erroredCount  = g.rows.filter((r) => {
                if (r.status !== 'missing_in_ssg' || !r.start_date) return false;
                const err = failedAttempts.get(`${g.course_code}|${r.start_date}`);
                return !!err && !isBlockedError(err);
              }).length;
              const groupBlockedCount = g.rows.filter((r) => {
                if (r.status !== 'missing_in_ssg' || !r.start_date) return false;
                const err = failedAttempts.get(`${g.course_code}|${r.start_date}`);
                return !!err && isBlockedError(err);
              }).length;
              return (
                <div key={g.course_code} className="bg-surface rounded-md border border-default overflow-hidden">
                  <div className="px-4 py-2 bg-surface-elevated border-b border-default flex items-center gap-3 flex-wrap">
                    <button onClick={() => toggle(g.course_code)} className="text-on-surface-secondary hover:text-on-surface" aria-label={isOpen ? 'Collapse' : 'Expand'}>
                      <span className="inline-block w-4 text-center">{isOpen ? '▾' : '▸'}</span>
                    </button>
                    <button onClick={() => toggle(g.course_code)} className="flex-1 text-left">
                      <div className="font-mono text-sm text-on-surface-secondary">{g.course_code}</div>
                      <div className="text-sm text-on-surface font-medium">{g.course_title}</div>
                      <div className="text-xs text-on-surface-secondary mt-0.5">
                        {g.wsq_support_from || g.wsq_support_to
                          ? `WSQ support: ${g.wsq_support_from ?? '?'} → ${g.wsq_support_to ?? '?'}`
                          : 'WSQ support: not loaded'}
                      </div>
                    </button>
                    <div className="flex items-center gap-2 text-xs">
                      {missingCount > 0 && <span className={`px-2 py-0.5 rounded-full ${STATUS_CLASS.missing_in_ssg}`}>{missingCount} missing</span>}
                      {erroredCount > 0 && <span className="px-2 py-0.5 rounded-full bg-red-100 text-red-700 dark:bg-red-900 dark:text-red-300">{erroredCount} errored</span>}
                      {groupBlockedCount > 0 && <span className="px-2 py-0.5 rounded-full bg-orange-100 text-orange-700 dark:bg-orange-900 dark:text-orange-300">{groupBlockedCount} blocked</span>}
                      {syncedCount > 0 && <span className={`px-2 py-0.5 rounded-full ${STATUS_CLASS.synced}`}>{syncedCount} synced</span>}
                      <span className="text-on-surface-secondary">· {g.rows.length} rows</span>
                      {syncableCount > 0 && (
                        <button
                          onClick={(e) => { e.stopPropagation(); syncCourse(g); }}
                          disabled={isJobRunning}
                          className={`ml-2 px-2 py-1 text-xs rounded-md text-white hover:opacity-90 disabled:opacity-50 ${filter === 'blocked' ? 'bg-orange-600' : 'bg-primary'}`}
                          title={filter === 'blocked' ? 'Retry — SSG previously rejected these as not eligible or outside the support period' : undefined}
                        >
                          {filter === 'blocked' ? `Retry (${syncableCount})` : `Sync to SSG (${syncableCount})`}
                        </button>
                      )}
                    </div>
                  </div>
                  {isOpen && (
                    <table className="w-full text-sm">
                      <thead className="bg-surface-elevated text-xs uppercase text-on-surface-secondary">
                        <tr>
                          <th className="text-left px-4 py-2">Source</th>
                          <th className="text-left px-4 py-2">Schedule</th>
                          <th className="text-left px-4 py-2">Start</th>
                          <th className="text-left px-4 py-2">End</th>
                          <th className="text-left px-4 py-2">Status</th>
                          <th className="text-left px-4 py-2">SSG Run ID</th>
                          <th className="text-left px-4 py-2">Action</th>
                        </tr>
                      </thead>
                      <tbody>
                        {g.rows.map((r, i) => {
                          const rowKey = `${g.course_code}|${r.start_date}`;
                          const lastError = r.status === 'missing_in_ssg'
                            ? failedAttempts.get(rowKey)
                            : undefined;
                          const rowBlocked = !!lastError && isBlockedError(lastError);
                          const rowTint = lastError
                            ? (rowBlocked ? ' bg-orange-50/40 dark:bg-orange-900/10' : ' bg-red-50/40 dark:bg-red-900/10')
                            : '';
                          return (
                          <tr key={i} className={`border-t border-default${rowTint}`}>
                            <td className="px-4 py-2 text-xs text-on-surface-secondary">{r.source === 'magento' ? 'Storefront' : 'SSG'}</td>
                            <td className="px-4 py-2 text-on-surface">{r.raw || '—'}</td>
                            <td className="px-4 py-2 font-mono text-xs">{r.start_date || '—'}</td>
                            <td className="px-4 py-2 font-mono text-xs">{r.end_date || '—'}</td>
                            <td className="px-4 py-2">
                              <span className={`inline-block px-2 py-0.5 rounded-full text-xs font-medium ${STATUS_CLASS[r.status]}`}>{STATUS_LABEL[r.status]}</span>
                            </td>
                            <td className="px-4 py-2 font-mono text-xs text-on-surface-secondary">
                              {r.ssg_run_id ? r.ssg_run_id : '—'}
                            </td>
                            <td className="px-4 py-2">
                              {(() => {
                                if (r.status === 'missing_in_ssg') {
                                  const blocked = !!lastError && isBlockedError(lastError);
                                  return (
                                    <div className="flex flex-col gap-1 items-start">
                                      <button
                                        onClick={() => syncRow(g, r)}
                                        disabled={isJobRunning}
                                        className={`px-2 py-1 text-xs rounded-md text-white hover:opacity-90 disabled:opacity-50 ${blocked ? 'bg-orange-600' : 'bg-primary'}`}
                                        title={blocked ? 'Retry — SSG previously rejected this as not eligible or outside the support period' : undefined}
                                      >
                                        {lastError ? 'Retry sync' : 'Sync to SSG'}
                                      </button>
                                      {lastError && (
                                        <span
                                          className={`text-xs cursor-help max-w-[220px] truncate ${blocked ? 'text-orange-600 dark:text-orange-400' : 'text-red-600 dark:text-red-400'}`}
                                          title={lastError}
                                        >
                                          ✗ {lastError}
                                        </span>
                                      )}
                                    </div>
                                  );
                                }
                                return null;
                              })()}
                            </td>
                          </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  )}
                </div>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
};

export default WsqScheduleSyncView;
