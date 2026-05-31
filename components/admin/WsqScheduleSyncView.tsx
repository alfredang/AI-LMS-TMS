import React, { useEffect, useMemo, useState } from 'react';
import { AdminPage } from '../../types';
import { useLms } from '../../contexts/LmsContext';

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
  rows: Row[];
};

type ApiResponse = {
  generated_at: string;
  magento_count: number;
  counts: { synced: number; missing_in_ssg: number; extra_in_ssg: number; unparsed: number };
  courses: CourseGroup[];
  cached: string | null;
};

type ApiError = { error: string; message?: string; status?: number; body?: any };
type Filter = 'all' | 'missing_in_ssg' | 'extra_in_ssg' | 'unparsed' | 'synced';

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
  const { setAdminPage, setSelectedCourse } = useLms() as any;
  const [data, setData] = useState<ApiResponse | null>(null);
  const [error, setError] = useState<ApiError | null>(null);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<Filter>('all');
  const [search, setSearch] = useState('');
  const [notice, setNotice] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [staging, setStaging] = useState(false);

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

  const stage = async (items: { course_code: string; start_date: string; end_date: string }[], label: string) => {
    if (items.length === 0) {
      setNotice('No missing schedules to stage.');
      return;
    }
    if (!confirm(`Stage ${items.length} missing course run(s) locally (${label})?\n\nThis inserts course_run rows with the storefront dates. Push to SSG separately via the existing TPG flow.`)) return;
    setStaging(true);
    try {
      const resp = await fetch('/api/admin/wsq-schedule-sync/stage', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ items }),
      });
      const json = await resp.json();
      if (!resp.ok) {
        setNotice(`Stage failed: ${json.error || resp.status}`);
      } else {
        const s = json.summary || {};
        setNotice(`Staged ${s.created} new, ${s.exists} already existed, ${s.no_course} missing course, ${s.error} errors.`);
        void load(true);
      }
    } catch (e: any) {
      setNotice(`Stage failed: ${e?.message || e}`);
    } finally {
      setStaging(false);
    }
  };

  const stageAll = () => {
    const items = filtered.flatMap((g) =>
      g.rows
        .filter((r) => r.status === 'missing_in_ssg' && r.start_date && r.end_date)
        .map((r) => ({ course_code: g.course_code, start_date: r.start_date!, end_date: r.end_date! })),
    );
    void stage(items, 'all courses, current filter');
  };

  const stageCourse = (g: CourseGroup) => {
    const items = g.rows
      .filter((r) => r.status === 'missing_in_ssg' && r.start_date && r.end_date)
      .map((r) => ({ course_code: g.course_code, start_date: r.start_date!, end_date: r.end_date! }));
    void stage(items, g.course_code);
  };

  const handleSubmitToSsg = async (group: CourseGroup, row: Row) => {
    if (!group.course_id) {
      setNotice(`Course ${group.course_code} doesn't exist locally. Add it in Course Management first.`);
      return;
    }
    try {
      const resp = await fetch(`/api/courses/${group.course_id}`);
      if (resp.ok) {
        const course = await resp.json();
        setSelectedCourse(course.data || course);
      }
    } catch { /* non-fatal */ }
    setNotice(
      `Submit to SSG: course ${group.course_code}, dates ${row.start_date} → ${row.end_date}. ` +
      `Fill in venue, mode, registration dates and admin email in the form below.`
    );
    setAdminPage(AdminPage.CreateNewClass);
  };

  return (
    <div className="p-6 space-y-4">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold text-on-surface">WSQ Schedule Sync</h1>
          <p className="text-sm text-on-surface-secondary mt-1 max-w-3xl">
            Compares upcoming course dates on the Tertiary Courses storefront against the course runs in SSG/TPGateway. Past-dated schedules are hidden. Use bulk-stage to insert local course_run rows in one step; push them to SSG individually via the existing Create New Class flow.
          </p>
        </div>
        <div className="flex gap-2">
          <button
            onClick={stageAll}
            disabled={staging || totalMissing === 0}
            className="px-3 py-2 text-sm rounded-md bg-amber-600 text-white hover:bg-amber-700 disabled:opacity-50"
            title="Insert local course_run rows for every Missing-in-SSG schedule across the current filter"
          >
            {staging ? 'Staging…' : `Bulk Stage Missing (${totalMissing})`}
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

      {data && (
        <>
          <div className="flex flex-wrap items-center gap-3 text-sm">
            <span className="text-on-surface-secondary">Generated: <span className="text-on-surface">{new Date(data.generated_at).toLocaleString()}</span></span>
            <span className="text-on-surface-secondary">Magento courses: <span className="text-on-surface">{data.magento_count}</span></span>
            {data.cached && <span className="text-xs text-on-surface-secondary">(cached at {new Date(data.cached).toLocaleTimeString()})</span>}
          </div>

          <div className="flex flex-wrap gap-2 items-center">
            {([
              ['all', `All (${data.counts.synced + data.counts.missing_in_ssg + data.counts.extra_in_ssg + data.counts.unparsed})`],
              ['missing_in_ssg', `Missing in SSG (${data.counts.missing_in_ssg})`],
              ['synced', `Synced (${data.counts.synced})`],
              ['extra_in_ssg', `Only in SSG (${data.counts.extra_in_ssg})`],
              ['unparsed', `Unparsed (${data.counts.unparsed})`],
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
              const missingCount = g.rows.filter((r) => r.status === 'missing_in_ssg').length;
              const syncedCount = g.rows.filter((r) => r.status === 'synced').length;
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
                      {syncedCount > 0 && <span className={`px-2 py-0.5 rounded-full ${STATUS_CLASS.synced}`}>{syncedCount} synced</span>}
                      <span className="text-on-surface-secondary">· {g.rows.length} rows</span>
                      {missingCount > 0 && (
                        <button
                          onClick={(e) => { e.stopPropagation(); stageCourse(g); }}
                          disabled={staging}
                          className="ml-2 px-2 py-1 text-xs rounded-md bg-amber-600 text-white hover:bg-amber-700 disabled:opacity-50"
                          title={`Stage all ${missingCount} missing schedule(s) for ${g.course_code} as local course_run rows`}
                        >
                          Stage all ({missingCount})
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
                              {r.status === 'missing_in_ssg' && (
                                <button
                                  onClick={() => handleSubmitToSsg(g, r)}
                                  className="px-2 py-1 text-xs rounded-md bg-primary text-white hover:opacity-90"
                                >
                                  Submit to SSG
                                </button>
                              )}
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
