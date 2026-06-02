import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';

type SyncStatus = 'synced' | 'missing_in_ssg' | 'extra_in_ssg' | 'unparsed' | 'outside_support_period';

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
  counts: { synced: number; missing_in_ssg: number; extra_in_ssg: number; unparsed: number; outside_support_period: number };
  support_periods_loaded: boolean;
  courses: CourseGroup[];
  cached: string | null;
};

type ApiError = { error: string; message?: string; status?: number; body?: any };
type Filter = 'all' | 'missing_in_ssg' | 'extra_in_ssg' | 'unparsed' | 'synced' | 'outside_support_period';

type ItemResult = {
  course_code: string;
  start_date: string;
  end_date: string;
  status: 'submitted' | 'exists' | 'no_course' | 'no_session_timing' | 'ssg_error' | 'error';
  ssg_run_id?: string;
  message?: string;
};

type SyncProgress = {
  currentBatch: number;
  totalBatches: number;
  itemsDone: number;
  totalItems: number;
  submitted: number;
  errors: number;
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

const STATUS_LABEL: Record<SyncStatus, string> = {
  synced: '✓ Synced',
  missing_in_ssg: '⚠ Missing in SSG',
  extra_in_ssg: 'ℹ Only in SSG',
  unparsed: '? Unparsed',
  outside_support_period: '⛔ Outside support period',
};

const STATUS_CLASS: Record<SyncStatus, string> = {
  synced: 'bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200',
  missing_in_ssg: 'bg-amber-100 text-amber-800 dark:bg-amber-900 dark:text-amber-200',
  extra_in_ssg: 'bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200',
  unparsed: 'bg-gray-200 text-gray-700 dark:bg-gray-700 dark:text-gray-200',
  outside_support_period: 'bg-orange-100 text-orange-800 dark:bg-orange-900 dark:text-orange-200',
};

const WsqScheduleSyncView: React.FC = () => {
  const [data, setData] = useState<ApiResponse | null>(null);
  const [error, setError] = useState<ApiError | null>(null);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<Filter>('all');
  const [search, setSearch] = useState('');
  const [notice, setNotice] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [syncing, setSyncing] = useState(false);
  const [syncProgress, setSyncProgress] = useState<SyncProgress | null>(null);
  const [syncResults, setSyncResults] = useState<ItemResult[]>([]);
  const [rowResults, setRowResults] = useState<Map<string, ItemResult>>(new Map());
  const [allJobs, setAllJobs] = useState<SharedJob[]>([]);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [refreshingPeriods, setRefreshingPeriods] = useState(false);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const load = async (refresh = false) => {
    setLoading(true);
    setError(null);
    try {
      const resp = await fetch(`/api/admin/wsq-schedule-sync${refresh ? '?refresh=1' : ''}`);
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

  useEffect(() => { void load(false); }, []);

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
      setAllJobs((prev) => {
        if (prev[0]?.status === 'running') startPolling();
        return prev;
      });
    };
    void check();
    return stopPolling;
  }, [fetchJobs, startPolling, stopPolling]);

  const filtered = useMemo(() => {
    if (!data) return [];
    const q = search.trim().toLowerCase();
    return data.courses
      .map((g) => {
        const rows = g.rows.filter((r) => filter === 'all' || r.status === filter);
        return { ...g, rows };
      })
      .filter((g) => {
        if (g.rows.length === 0) return false;
        if (!q) return true;
        return g.course_code.toLowerCase().includes(q) || g.course_title.toLowerCase().includes(q);
      });
  }, [data, filter, search]);

  const totalMissing = useMemo(
    () => filtered.reduce((acc, g) => acc + g.rows.filter((r) => r.status === 'missing_in_ssg').length, 0),
    [filtered],
  );

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
    if (items.length === 0) {
      setNotice('No missing schedules to sync.');
      return;
    }
    if (!confirm(`Submit ${items.length} missing course run(s) directly to SSG (${label})?\n\nThis will create course runs in SSG/TPGateway using session timing templates and default venue details.`)) return;

    setSyncing(true);
    setSyncResults([]);
    setNotice(null);

    const BATCH = 100;
    const totalBatches = Math.ceil(items.length / BATCH);
    let submitted = 0, exists = 0, ssgError = 0, skipped = 0;
    const allResults: ItemResult[] = [];

    // Create the shared job row — all users can see progress via polling
    let jobId: number | null = null;
    try {
      const startResp = await fetch('/api/admin/wsq-schedule-sync/start-job', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ total_items: items.length, triggered_by: 'user' }),
      });
      const startJson = await startResp.json();
      if (startResp.status === 409) {
        // A job is already running — attach to it instead of blocking
        jobId = startJson.job_id ?? null;
      } else if (!startResp.ok) {
        setNotice(`Could not start sync job: ${startJson.error || startResp.status}`);
        setSyncing(false);
        return;
      } else {
        jobId = startJson.job_id;
      }
    } catch { /* non-fatal — proceed without DB job tracking */ }

    // Start polling so other users see live updates
    startPolling();

    setSyncProgress({ currentBatch: 0, totalBatches, itemsDone: 0, totalItems: items.length, submitted: 0, errors: 0 });

    try {
      for (let i = 0; i < items.length; i += BATCH) {
        const batchNum = Math.floor(i / BATCH) + 1;
        const batch = items.slice(i, i + BATCH);
        const isLastBatch = i + BATCH >= items.length;

        const resp = await fetch('/api/admin/wsq-schedule-sync/submit-to-ssg', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ items: batch, job_id: jobId, is_last_batch: isLastBatch }),
        });
        const json = await resp.json();

        if (!resp.ok) {
          setNotice(`Sync failed on batch ${batchNum}: ${json.error || resp.status}`);
          return;
        }

        const s = json.summary || {};
        submitted += s.submitted ?? 0;
        exists    += s.exists    ?? 0;
        ssgError  += s.ssg_error ?? 0;
        skipped   += s.error     ?? 0;

        const batchResults: ItemResult[] = json.results || [];
        allResults.push(...batchResults);

        // Per-row inline feedback (local — fast, no round-trip)
        setRowResults((prev) => {
          const next = new Map(prev);
          for (const r of batchResults) next.set(`${r.course_code}|${r.start_date}`, r);
          return next;
        });

        setSyncProgress({
          currentBatch: batchNum,
          totalBatches,
          itemsDone: Math.min(i + BATCH, items.length),
          totalItems: items.length,
          submitted,
          errors: ssgError + skipped,
        });
      }

      setSyncResults(allResults);
      const parts: string[] = [];
      if (submitted) parts.push(`${submitted} submitted to SSG`);
      if (exists)    parts.push(`${exists} already existed`);
      if (ssgError)  parts.push(`${ssgError} SSG errors`);
      if (skipped)   parts.push(`${skipped} skipped`);
      setNotice(parts.join(' · ') + '.');
      void load(true);
    } catch (e: any) {
      setNotice(`Sync failed: ${e?.message || e}`);
    } finally {
      setSyncing(false);
      setSyncProgress(null);
      // Final poll so sharedJob reflects completed state
      stopPolling();
      await fetchJobs();
    }
  };

  const syncAll = () => {
    const items = filtered.flatMap((g) =>
      g.rows
        .filter((r) => r.status === 'missing_in_ssg' && r.start_date && r.end_date)
        .map((r) => ({ course_code: g.course_code, start_date: r.start_date!, end_date: r.end_date! })),
    );
    void syncToSSG(items, 'all courses, current filter');
  };

  const syncCourse = (g: CourseGroup) => {
    const items = g.rows
      .filter((r) => r.status === 'missing_in_ssg' && r.start_date && r.end_date)
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

  const refreshSupportPeriods = async () => {
    setRefreshingPeriods(true);
    try {
      const resp = await fetch('/api/admin/wsq-schedule-sync/refresh-support-periods', { method: 'POST' });
      const json = await resp.json();
      if (!resp.ok) {
        setNotice(`Failed to refresh support periods: ${json.error || resp.status}`);
      } else {
        const s = json.summary || {};
        setNotice(`Support periods refreshed — ${s.updated ?? 0} updated, ${s.no_wsq_support ?? 0} no WSQ support, ${s.ssg_error ?? 0} errors.`);
        void load(false);
      }
    } catch (e: any) {
      setNotice(`Failed to refresh support periods: ${e?.message}`);
    } finally {
      setRefreshingPeriods(false);
    }
  };

  return (
    <div className="p-6 space-y-4">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold text-on-surface">WSQ Schedule Sync</h1>
          <p className="text-sm text-on-surface-secondary mt-1 max-w-3xl">
            Compares upcoming course dates on the Tertiary Courses storefront against course runs in SSG/TPGateway. Past-dated schedules are hidden. Use &quot;Sync to SSG&quot; to submit missing runs directly to SSG using session timing templates and default venue details.
          </p>
        </div>
        <div className="flex gap-2">
          <button
            onClick={syncAll}
            disabled={syncing || totalMissing === 0}
            className="px-3 py-2 text-sm rounded-md bg-primary text-white hover:opacity-90 disabled:opacity-50"
            title="Submit all Missing-in-SSG schedules directly to SSG using session timing templates and default venue"
          >
            {syncing ? 'Syncing…' : `Sync All to SSG (${totalMissing})`}
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

      {/* ── Current / most-recent job panel ─────────────────────────────────── */}
      {allJobs.length > 0 && (() => {
        const job = allJobs[0];
        const isRunning = job.status === 'running';
        const failures: ItemResult[] = Array.isArray(job.failures) ? job.failures : [];
        const hasFailures = failures.length > 0;
        const ERROR_LABEL: Record<string, string> = {
          ssg_error: 'SSG Error', no_course: 'Course Not Found',
          no_session_timing: 'No Session Timing', error: 'Error',
        };
        const borderCls = isRunning ? 'border-blue-200 dark:border-blue-800'
          : hasFailures ? 'border-red-200 dark:border-red-800'
          : 'border-green-200 dark:border-green-800';
        const headerCls = isRunning ? 'bg-blue-50 dark:bg-blue-900/30 border-blue-200 dark:border-blue-800'
          : hasFailures ? 'bg-red-50 dark:bg-red-900/30 border-red-200 dark:border-red-800'
          : 'bg-green-50 dark:bg-green-900/30 border-green-200 dark:border-green-800';
        const titleCls = isRunning ? 'text-blue-800 dark:text-blue-200'
          : hasFailures ? 'text-red-800 dark:text-red-200'
          : 'text-green-800 dark:text-green-200';
        return (
          <div className={`rounded-md border overflow-hidden ${borderCls}`}>
            <div className={`px-4 py-2 border-b flex justify-between items-center flex-wrap gap-2 ${headerCls}`}>
              <div className="flex items-center gap-3 text-sm">
                {isRunning && <span className="inline-block w-2 h-2 rounded-full bg-blue-500 animate-pulse" />}
                <span className={`font-medium ${titleCls}`}>
                  {isRunning
                    ? `Syncing… ${job.items_done} / ${job.total_items} runs`
                    : job.summary || (hasFailures ? `Completed with ${failures.length} error${failures.length !== 1 ? 's' : ''}` : 'Sync completed')}
                </span>
                <span className="text-xs text-on-surface-secondary">
                  {new Date(job.started_at).toLocaleString()}
                  {job.completed_at && ` → ${new Date(job.completed_at).toLocaleTimeString()}`}
                </span>
                <span className={`text-xs px-1.5 py-0.5 rounded ${job.triggered_by === 'cron' ? 'bg-purple-100 text-purple-700 dark:bg-purple-900 dark:text-purple-300' : 'bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400'}`}>
                  {job.triggered_by === 'cron' ? 'Cron' : 'Manual'}
                </span>
              </div>
              <div className="flex items-center gap-3 text-xs text-on-surface-secondary">
                {job.submitted > 0 && <span className="text-green-600 dark:text-green-400">{job.submitted} submitted</span>}
                {job.already_exists > 0 && <span>{job.already_exists} existed</span>}
                {(job.ssg_errors + job.skipped) > 0 && <span className="text-red-500 dark:text-red-400">{job.ssg_errors + job.skipped} errors</span>}
              </div>
            </div>
            {isRunning && job.total_items > 0 && (
              <div className="px-4 py-2 bg-blue-50 dark:bg-blue-900/20">
                <div className="w-full bg-blue-100 dark:bg-blue-900 rounded-full h-1.5">
                  <div className="bg-blue-500 h-1.5 rounded-full transition-all duration-500"
                    style={{ width: `${Math.round((job.items_done / job.total_items) * 100)}%` }} />
                </div>
              </div>
            )}
            {hasFailures && (
              <div className="divide-y divide-red-100 dark:divide-red-900 max-h-48 overflow-y-auto">
                {failures.map((r, i) => (
                  <div key={i} className="px-4 py-2 flex flex-wrap items-start gap-x-3 gap-y-1 text-xs">
                    <span className="font-mono font-medium text-on-surface">{r.course_code}</span>
                    <span className="font-mono text-on-surface-secondary">{r.start_date} → {r.end_date}</span>
                    <span className={`px-1.5 py-0.5 rounded font-medium ${r.status === 'ssg_error' ? 'bg-red-100 text-red-700 dark:bg-red-900 dark:text-red-300' : 'bg-amber-100 text-amber-700 dark:bg-amber-900 dark:text-amber-300'}`}>
                      {ERROR_LABEL[r.status] ?? r.status}
                    </span>
                    {r.message && <span className="text-on-surface-secondary">{r.message}</span>}
                  </div>
                ))}
              </div>
            )}
          </div>
        );
      })()}

      {/* ── Collapsible sync history ──────────────────────────────────────────── */}
      {allJobs.length > 1 && (
        <div className="rounded-md border border-default overflow-hidden">
          <button
            onClick={() => setHistoryOpen((o) => !o)}
            className="w-full px-4 py-2 flex items-center justify-between text-sm bg-surface-elevated hover:bg-surface text-on-surface"
          >
            <span className="font-medium">Sync History ({allJobs.length - 1} previous run{allJobs.length - 1 !== 1 ? 's' : ''})</span>
            <span>{historyOpen ? '▾' : '▸'}</span>
          </button>
          {historyOpen && (
            <div className="divide-y divide-default max-h-96 overflow-y-auto">
              {allJobs.slice(1).map((job) => {
                const failures: ItemResult[] = Array.isArray(job.failures) ? job.failures : [];
                const hasFailures = failures.length > 0;
                const statusCls = job.status === 'failed' || hasFailures
                  ? 'text-red-600 dark:text-red-400'
                  : 'text-green-600 dark:text-green-400';
                return (
                  <div key={job.id} className="px-4 py-2 text-xs space-y-1">
                    <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                      <span className="font-mono text-on-surface-secondary">
                        {new Date(job.started_at).toLocaleString()}
                        {job.completed_at && ` → ${new Date(job.completed_at).toLocaleTimeString()}`}
                      </span>
                      <span className={`px-1.5 py-0.5 rounded ${job.triggered_by === 'cron' ? 'bg-purple-100 text-purple-700 dark:bg-purple-900 dark:text-purple-300' : 'bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400'}`}>
                        {job.triggered_by === 'cron' ? 'Cron' : 'Manual'}
                      </span>
                      <span className={`font-medium ${statusCls}`}>
                        {job.summary || (hasFailures ? `${failures.length} error${failures.length !== 1 ? 's' : ''}` : 'Completed')}
                      </span>
                    </div>
                    <div className="flex flex-wrap gap-x-3 gap-y-0.5 text-on-surface-secondary">
                      {job.submitted > 0 && <span className="text-green-600 dark:text-green-400">{job.submitted} submitted</span>}
                      {job.already_exists > 0 && <span>{job.already_exists} existed</span>}
                      {job.ssg_errors > 0 && <span className="text-red-500">{job.ssg_errors} SSG errors</span>}
                      {job.skipped > 0 && <span>{job.skipped} skipped</span>}
                    </div>
                    {hasFailures && (
                      <div className="mt-1 space-y-0.5 pl-2 border-l-2 border-red-200 dark:border-red-800">
                        {failures.map((f, fi) => (
                          <div key={fi} className="text-on-surface-secondary font-mono">
                            {f.course_code} {f.start_date} → {f.end_date}
                            {f.message && <span className="text-red-500 ml-2">{f.message}</span>}
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

      {/* Submitted-runs summary — shows SSG run IDs so admins can verify */}
      {syncResults.length > 0 && (() => {
        const submitted = syncResults.filter((r) => r.status === 'submitted' && r.ssg_run_id);
        const existed   = syncResults.filter((r) => r.status === 'exists'    && r.ssg_run_id);
        if (submitted.length === 0 && existed.length === 0) return null;
        return (
          <div className="rounded-md border border-green-200 dark:border-green-800 overflow-hidden">
            <div className="px-4 py-2 bg-green-50 dark:bg-green-900/30 border-b border-green-200 dark:border-green-800 flex justify-between items-center">
              <span className="text-sm font-medium text-green-800 dark:text-green-200">
                Submitted run IDs
              </span>
              <button onClick={() => setSyncResults([])} className="text-xs underline text-on-surface-secondary">dismiss</button>
            </div>
            <div className="divide-y divide-green-100 dark:divide-green-900/40 max-h-64 overflow-y-auto">
              {submitted.map((r, i) => (
                <div key={i} className="px-4 py-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs">
                  <span className="font-mono font-medium text-on-surface">{r.course_code}</span>
                  <span className="font-mono text-on-surface-secondary">{r.start_date} → {r.end_date}</span>
                  <span className="text-green-600 dark:text-green-400 font-mono font-semibold">✓ {r.ssg_run_id}</span>
                </div>
              ))}
              {existed.map((r, i) => (
                <div key={`e${i}`} className="px-4 py-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs">
                  <span className="font-mono font-medium text-on-surface">{r.course_code}</span>
                  <span className="font-mono text-on-surface-secondary">{r.start_date} → {r.end_date}</span>
                  <span className="text-blue-600 dark:text-blue-400 font-mono">○ {r.ssg_run_id} (already existed)</span>
                </div>
              ))}
            </div>
          </div>
        );
      })()}

      {data && (
        <>
          <div className="flex flex-wrap items-center gap-3 text-sm">
            <span className="text-on-surface-secondary">Generated: <span className="text-on-surface">{new Date(data.generated_at).toLocaleString()}</span></span>
            <span className="text-on-surface-secondary">Magento courses: <span className="text-on-surface">{data.magento_count}</span></span>
            {data.cached && <span className="text-xs text-on-surface-secondary">(cached at {new Date(data.cached).toLocaleTimeString()})</span>}
          </div>

          {/* Support period notice ───────────────────────────────────── */}
          {!data.support_periods_loaded && (
            <div className="p-3 rounded-md bg-orange-50 dark:bg-orange-900/30 border border-orange-200 dark:border-orange-800 text-sm flex items-center justify-between gap-4">
              <span className="text-orange-800 dark:text-orange-200">
                WSQ support periods not loaded — sync will not filter out out-of-period runs until you load them.
              </span>
              <button
                onClick={refreshSupportPeriods}
                disabled={refreshingPeriods}
                className="shrink-0 px-3 py-1.5 text-xs rounded-md bg-orange-600 text-white hover:opacity-90 disabled:opacity-50"
              >
                {refreshingPeriods ? 'Loading…' : 'Load support periods'}
              </button>
            </div>
          )}
          {data.support_periods_loaded && (
            <div className="flex justify-end">
              <button
                onClick={refreshSupportPeriods}
                disabled={refreshingPeriods}
                className="px-2 py-1 text-xs rounded-md border border-default text-on-surface-secondary hover:bg-surface-elevated disabled:opacity-50"
              >
                {refreshingPeriods ? 'Refreshing…' : 'Refresh support periods'}
              </button>
            </div>
          )}

          <div className="flex flex-wrap gap-2 items-center">
            {([
              ['all', `All (${data.counts.synced + data.counts.missing_in_ssg + data.counts.extra_in_ssg + data.counts.unparsed + (data.counts.outside_support_period ?? 0)})`],
              ['missing_in_ssg', `Missing in SSG (${data.counts.missing_in_ssg})`],
              ['synced', `Synced (${data.counts.synced})`],
              ['extra_in_ssg', `Only in SSG (${data.counts.extra_in_ssg})`],
              ['unparsed', `Unparsed (${data.counts.unparsed})`],
              ...(data.counts.outside_support_period > 0
                ? [['outside_support_period', `Outside support period (${data.counts.outside_support_period})`] as [Filter, string]]
                : []),
            ] as [Filter, string][]).map(([f, label]) => (
              <button
                key={f}
                onClick={() => setFilter(f)}
                className={`px-3 py-1.5 text-xs rounded-full border ${filter === f ? 'bg-primary text-white border-primary' : 'bg-surface text-on-surface border-default hover:bg-surface-elevated'}`}
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
              const outsideCount  = g.rows.filter((r) => r.status === 'outside_support_period').length;
              const syncedCount   = g.rows.filter((r) => r.status === 'synced').length;
              return (
                <div key={g.course_code} className="bg-surface rounded-md border border-default overflow-hidden">
                  <div className="px-4 py-2 bg-surface-elevated border-b border-default flex items-center gap-3 flex-wrap">
                    <button onClick={() => toggle(g.course_code)} className="text-on-surface-secondary hover:text-on-surface" aria-label={isOpen ? 'Collapse' : 'Expand'}>
                      <span className="inline-block w-4 text-center">{isOpen ? '▾' : '▸'}</span>
                    </button>
                    <button onClick={() => toggle(g.course_code)} className="flex-1 text-left">
                      <div className="font-mono text-sm text-on-surface-secondary">{g.course_code}</div>
                      <div className="text-sm text-on-surface font-medium">{g.course_title}</div>
                    </button>
                    <div className="flex items-center gap-2 text-xs">
                      {missingCount > 0 && <span className={`px-2 py-0.5 rounded-full ${STATUS_CLASS.missing_in_ssg}`}>{missingCount} missing</span>}
                      {outsideCount > 0 && <span className={`px-2 py-0.5 rounded-full ${STATUS_CLASS.outside_support_period}`}>{outsideCount} outside period</span>}
                      {syncedCount > 0 && <span className={`px-2 py-0.5 rounded-full ${STATUS_CLASS.synced}`}>{syncedCount} synced</span>}
                      <span className="text-on-surface-secondary">· {g.rows.length} rows</span>
                      {missingCount > 0 && (
                        <button
                          onClick={(e) => { e.stopPropagation(); syncCourse(g); }}
                          disabled={syncing}
                          className="ml-2 px-2 py-1 text-xs rounded-md bg-primary text-white hover:opacity-90 disabled:opacity-50"
                          title={`Submit all ${missingCount} missing schedule(s) for ${g.course_code} directly to SSG`}
                        >
                          Sync to SSG ({missingCount})
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
                        {g.rows.map((r, i) => (
                          <tr key={i} className="border-t border-default">
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
                                const rowKey = `${g.course_code}|${r.start_date}`;
                                const rowResult = rowResults.get(rowKey);
                                if (rowResult) {
                                  if (rowResult.status === 'submitted') {
                                    return (
                                      <span className="text-xs text-green-600 dark:text-green-400 font-mono" title="Submitted to SSG">
                                        ✓ {rowResult.ssg_run_id}
                                      </span>
                                    );
                                  }
                                  if (rowResult.status === 'exists') {
                                    return (
                                      <span className="text-xs text-blue-600 dark:text-blue-400 font-mono">
                                        ○ {rowResult.ssg_run_id || 'Already exists'}
                                      </span>
                                    );
                                  }
                                  return (
                                    <span
                                      className="text-xs text-red-600 dark:text-red-400 cursor-help"
                                      title={rowResult.message || rowResult.status}
                                    >
                                      ✗ {rowResult.status.replace(/_/g, ' ')}
                                    </span>
                                  );
                                }
                                if (r.status === 'missing_in_ssg') {
                                  return (
                                    <button
                                      onClick={() => syncRow(g, r)}
                                      disabled={syncing}
                                      className="px-2 py-1 text-xs rounded-md bg-primary text-white hover:opacity-90 disabled:opacity-50"
                                    >
                                      Sync to SSG
                                    </button>
                                  );
                                }
                                if (r.status === 'outside_support_period') {
                                  return (
                                    <div className="flex flex-col gap-1 items-start">
                                      <span className="text-xs text-orange-600 dark:text-orange-400">
                                        Outside WSQ support period
                                        {g.wsq_support_from && g.wsq_support_to && ` (${g.wsq_support_from} → ${g.wsq_support_to})`}
                                      </span>
                                      <button
                                        onClick={() => syncRow(g, r)}
                                        disabled={syncing}
                                        className="px-2 py-1 text-xs rounded-md border border-orange-400 text-orange-700 dark:text-orange-300 hover:bg-orange-50 dark:hover:bg-orange-900/30 disabled:opacity-50"
                                        title="SSG will likely reject this — the course start date is outside the approved WSQ support window"
                                      >
                                        Attempt sync anyway
                                      </button>
                                    </div>
                                  );
                                }
                                return null;
                              })()}
                            </td>
                          </tr>
                        ))}
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
