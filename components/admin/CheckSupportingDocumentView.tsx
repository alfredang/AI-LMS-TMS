/**
 * CheckSupportingDocumentView
 *
 * Dedicated triage page for company_application rows that still need
 * supporting-doc verification (status != 'verified'). Rows are grouped by
 * employer × course-run because the verify-and-send pipeline batches invoice
 * emails on that key — every learner in a group must be verified before the
 * employer's consolidated invoice email is released.
 *
 * UX layers:
 *   1. Stats strip — at-a-glance counts of verified / outstanding / pending / mismatch.
 *   2. Toolbar — search + status filter + refresh.
 *   3. Group cards — sorted by urgency (mismatch count desc, then size desc).
 *      Each card shows employer + course-run + a status-breakdown summary.
 *   4. Learner rows — status pill, name/NRIC, optional "Doc" link to Drive,
 *      per-row "Verify" CTA.
 *
 * The view was extracted out of CompanyApplicationViews.tsx to keep that file
 * (which still holds Upload + View) under control. Shared helpers stay in
 * CompanyApplicationViews and are imported here.
 */
import React, { useEffect, useMemo, useState } from 'react';
import { useLms } from '@contexts/LmsContext';
import { Card } from '../ui/Card';
import { Button } from '../ui/Button';
import { Icon, IconName } from '../ui/Icon';
import SupportingDocsModal from './SupportingDocsModal';
import {
  CompanyApplicationRow,
  fetchRows,
  maskNric,
  formatCourseDateLong,
} from './CompanyApplicationViews';

type RowEffectiveStatus = 'verified' | 'mismatch' | 'pending' | 'noDoc';

const getEffectiveStatus = (row: CompanyApplicationRow): RowEffectiveStatus => {
  const status = String(row['Supporting Doc Verification Status'] || '').trim().toLowerCase();
  if (status === 'verified') return 'verified';
  if (status === 'mismatch') return 'mismatch';
  const hasDoc = !!String(row['Supporting Doc Drive Link'] || '').trim();
  return hasDoc ? 'pending' : 'noDoc';
};

export const CheckSupportingDocumentView: React.FC = () => {
  const { currentUser } = useLms();
  const [rows, setRows] = useState<CompanyApplicationRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [targetIds, setTargetIds] = useState<string[] | null>(null);
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | 'outstanding' | RowEffectiveStatus>('all');

  const reload = async () => {
    setLoading(true);
    setError(null);
    try {
      const all = await fetchRows();
      setRows(all);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load company applications.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void reload();
  }, []);

  // Stats are computed from all rows (not filtered) so the strip shows the
  // system-wide picture rather than what's currently on-screen.
  const stats = useMemo(() => {
    let mismatch = 0, pending = 0, noDoc = 0, verified = 0;
    for (const row of rows) {
      const status = String(row['Supporting Doc Verification Status'] || '').trim().toLowerCase();
      if (status === 'verified') {
        verified++;
        continue;
      }
      const s = getEffectiveStatus(row);
      if (s === 'mismatch') mismatch++;
      else if (s === 'pending') pending++;
      else noDoc++;
    }
    const outstanding = mismatch + pending + noDoc;
    return {
      mismatch,
      pending,
      noDoc,
      verified,
      outstanding,
      total: outstanding + verified,
    };
  }, [rows]);

  // Apply search + status filter for the visible row set.
  // 'all' shows every row (verified + outstanding). Specific status filters
  // slice down to that bucket only.
  const filteredRows = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return rows.filter(row => {
      if (statusFilter !== 'all') {
        const eff = getEffectiveStatus(row);
        if (statusFilter === 'outstanding') {
          if (eff === 'verified') return false;
        } else if (eff !== statusFilter) {
          return false;
        }
      }
      if (!q) return true;
      const haystack = [
        row['Trainee FULL Name as on government ID*'],
        row['Trainee NRIC/FIN Number*'],
        row['Employer Organization Name*'],
        row['Employer UEN*'],
        row['Course Title*'],
        row['Course Run ID'],
      ].map(v => String(v || '').toLowerCase()).join(' | ');
      return haystack.includes(q);
    });
  }, [rows, searchQuery, statusFilter]);

  // Two-level tree: Employer → CourseRunGroups → rows.
  //   - Employer = the entity the invoice email is addressed to.
  //   - CourseRunGroup = (employer × course-run) — the invoice-firing boundary.
  // Why nest: a company that uploaded one Excel covering multiple courses
  // wants to see "all of NUP's work" together, then drill into each course
  // for the actual verification batch.
  type CourseRunGroup = {
    key: string;
    courseTitle: string;
    courseStartDate: string;
    courseRunId: string;
    rows: CompanyApplicationRow[];
    verifiedCount: number;
    mismatchCount: number;
    pendingCount: number;
    noDocCount: number;
  };
  type EmployerGroup = {
    key: string;
    employerName: string;
    employerUen: string;
    courseRuns: CourseRunGroup[];
    totalRows: number;
    verifiedCount: number;
    mismatchCount: number;
    pendingCount: number;
    noDocCount: number;
  };

  const employerGroups = useMemo<EmployerGroup[]>(() => {
    // First pass — build the flat (employer × course-run) groups.
    const courseRunMap = new Map<string, { employerKey: string; employerName: string; employerUen: string; group: CourseRunGroup }>();
    for (const row of filteredRows) {
      const uen = String(row['Employer UEN*'] || '').trim();
      const runId = String(row['Course Run ID'] || '').trim();
      const employerName = String(row['Employer Organization Name*'] || '').trim();
      const courseTitle = String(row['Course Title*'] || '').trim();
      const employerKey = uen || employerName || 'unknown-employer';
      const crKey = `${employerKey}::${runId || courseTitle || 'unknown-run'}`;
      let entry = courseRunMap.get(crKey);
      if (!entry) {
        entry = {
          employerKey,
          employerName: employerName || '(no employer)',
          employerUen: uen,
          group: {
            key: crKey,
            courseTitle: courseTitle || '(no course)',
            courseStartDate: String(row['Course Start Date (DD-MM-YYYY)*'] || ''),
            courseRunId: runId,
            rows: [],
            verifiedCount: 0,
            mismatchCount: 0,
            pendingCount: 0,
            noDocCount: 0,
          },
        };
        courseRunMap.set(crKey, entry);
      }
      entry.group.rows.push(row);
      const s = getEffectiveStatus(row);
      if (s === 'verified') entry.group.verifiedCount++;
      else if (s === 'mismatch') entry.group.mismatchCount++;
      else if (s === 'pending') entry.group.pendingCount++;
      else entry.group.noDocCount++;
    }

    // Second pass — fold course-runs under their employer.
    const employerMap = new Map<string, EmployerGroup>();
    for (const { employerKey, employerName, employerUen, group } of courseRunMap.values()) {
      let e = employerMap.get(employerKey);
      if (!e) {
        e = {
          key: employerKey,
          employerName,
          employerUen,
          courseRuns: [],
          totalRows: 0,
          verifiedCount: 0,
          mismatchCount: 0,
          pendingCount: 0,
          noDocCount: 0,
        };
        employerMap.set(employerKey, e);
      }
      e.courseRuns.push(group);
      e.totalRows += group.rows.length;
      e.verifiedCount += group.verifiedCount;
      e.mismatchCount += group.mismatchCount;
      e.pendingCount += group.pendingCount;
      e.noDocCount += group.noDocCount;
    }

    // Sort course-runs within each employer (mismatch first, then biggest).
    for (const e of employerMap.values()) {
      e.courseRuns.sort((a, b) => {
        if (b.mismatchCount !== a.mismatchCount) return b.mismatchCount - a.mismatchCount;
        if (b.rows.length !== a.rows.length) return b.rows.length - a.rows.length;
        return a.courseTitle.localeCompare(b.courseTitle);
      });
    }

    // Sort employers — same urgency-first rule, then by name.
    return Array.from(employerMap.values()).sort((a, b) => {
      if (b.mismatchCount !== a.mismatchCount) return b.mismatchCount - a.mismatchCount;
      if (b.totalRows !== a.totalRows) return b.totalRows - a.totalRows;
      return a.employerName.localeCompare(b.employerName);
    });
  }, [filteredRows]);

  const openModalForRow = (id: string) => setTargetIds([id]);
  const openModalForGroup = (groupRows: CompanyApplicationRow[]) => {
    const ids = groupRows.map(r => String(r.id || '')).filter(Boolean);
    if (ids.length) setTargetIds(ids);
  };

  const toggleGroup = (key: string) => setCollapsed(prev => ({ ...prev, [key]: !prev[key] }));

  const filterPills: Array<{ value: typeof statusFilter; label: string; count: number; activeClass: string }> = [
    { value: 'all', label: 'Total', count: stats.total, activeClass: 'bg-gray-700 text-white' },
    { value: 'outstanding', label: 'Outstanding', count: stats.outstanding, activeClass: 'bg-blue-600 text-white' },
    { value: 'verified', label: 'Verified', count: stats.verified, activeClass: 'bg-emerald-600 text-white' },
    { value: 'pending', label: 'Pending', count: stats.pending, activeClass: 'bg-amber-500 text-white' },
    { value: 'mismatch', label: 'Mismatch', count: stats.mismatch, activeClass: 'bg-red-600 text-white' },
  ];

  return (
    <div className="space-y-5">
      {/* Hero header */}
      <div className="flex items-start gap-4 flex-wrap">
        <div className="w-12 h-12 rounded-xl bg-blue-100 dark:bg-blue-900/30 flex items-center justify-center flex-shrink-0">
          <Icon name={IconName.Shield} className="w-6 h-6 text-blue-600 dark:text-blue-400" />
        </div>
        <div className="flex-1 min-w-0">
          <h2 className="text-2xl font-bold dark:text-white">Check Supporting Document</h2>
          <p className="text-sm text-gray-500 dark:text-gray-400 mt-1 max-w-3xl">
            Outstanding supporting documents block invoice emails to employers. Verify each learner&apos;s
            doc against name, NRIC, employer and UEN — once an employer&apos;s entire batch is cleared,
            the consolidated tax invoice is released automatically.
          </p>
        </div>
      </div>

      {/* Stats strip */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
        <StatTile
          icon={IconName.FileText}
          label="Total"
          value={stats.total}
          tone="gray"
        />
        <StatTile
          icon={IconName.Users}
          label="Outstanding"
          value={stats.outstanding}
          tone="blue"
        />
        <StatTile
          icon={IconName.CheckCircle}
          label="Verified"
          value={stats.verified}
          tone="emerald"
        />
        <StatTile
          icon={IconName.Eye}
          label="Pending"
          value={stats.pending}
          tone="amber"
        />
        <StatTile
          icon={IconName.Warning}
          label="Mismatch"
          value={stats.mismatch}
          tone="red"
        />
      </div>

      {/* Toolbar */}
      <div className="flex items-center gap-3 flex-wrap">
        <div className="relative flex-1 min-w-[240px]">
          <Icon name={IconName.Search} className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400 pointer-events-none" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search learner, NRIC, employer, UEN, course…"
            className="w-full pl-9 pr-9 py-2 text-sm bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-700 rounded-lg shadow-sm placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent dark:text-white"
          />
          {searchQuery && (
            <button
              type="button"
              onClick={() => setSearchQuery('')}
              className="absolute right-2 top-1/2 -translate-y-1/2 p-1 rounded hover:bg-gray-100 dark:hover:bg-gray-700"
              aria-label="Clear search"
            >
              <Icon name={IconName.Close} className="w-3.5 h-3.5 text-gray-400" />
            </button>
          )}
        </div>
        <div className="inline-flex items-center gap-1 p-1 bg-gray-100 dark:bg-gray-800 rounded-lg">
          {filterPills.map(pill => {
            const isActive = statusFilter === pill.value;
            return (
              <button
                key={pill.value}
                type="button"
                onClick={() => setStatusFilter(pill.value)}
                className={`text-xs font-semibold px-3 py-1.5 rounded-md transition-colors inline-flex items-center gap-1.5 ${
                  isActive
                    ? pill.activeClass
                    : 'text-gray-600 dark:text-gray-300 hover:bg-white dark:hover:bg-gray-700'
                }`}
              >
                {pill.label}
                <span className={`inline-flex items-center justify-center min-w-[18px] h-[18px] px-1 rounded-full text-[10px] font-bold ${
                  isActive ? 'bg-white/20' : 'bg-white dark:bg-gray-700 text-gray-700 dark:text-gray-200'
                }`}>
                  {pill.count}
                </span>
              </button>
            );
          })}
        </div>
        <Button variant="outline" onClick={() => void reload()} disabled={loading}>
          {loading ? 'Refreshing…' : 'Refresh'}
        </Button>
      </div>

      {error && (
        <Card>
          <div className="p-3 text-sm text-red-700 dark:text-red-300 flex items-center gap-2">
            <Icon name={IconName.Warning} className="w-4 h-4 flex-shrink-0" />
            <span>{error}</span>
          </div>
        </Card>
      )}

      {loading && rows.length === 0 ? (
        <Card>
          <div className="p-12 flex items-center justify-center text-gray-500 dark:text-gray-400 gap-3">
            <div className="animate-spin rounded-full h-6 w-6 border-2 border-gray-300 border-t-blue-500" />
            <span className="text-sm">Loading company applications…</span>
          </div>
        </Card>
      ) : stats.outstanding === 0 ? (
        <Card>
          <div className="p-12 text-center">
            <div className="inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-emerald-100 dark:bg-emerald-900/30 ring-1 ring-emerald-200 dark:ring-emerald-800/60 mb-4">
              <Icon name={IconName.CheckCircle} className="w-8 h-8 text-emerald-600 dark:text-emerald-400" />
            </div>
            <p className="text-lg font-bold text-gray-900 dark:text-white">All caught up</p>
            <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
              Every company application row has a verified supporting document.
            </p>
          </div>
        </Card>
      ) : employerGroups.length === 0 ? (
        <Card>
          <div className="p-12 text-center text-gray-500 dark:text-gray-400">
            <Icon name={IconName.Search} className="w-10 h-10 mx-auto mb-3 opacity-50" />
            <p className="text-sm font-semibold text-gray-700 dark:text-gray-200">No matches</p>
            <p className="text-xs mt-1">Try clearing the search or switching to a different status filter.</p>
          </div>
        </Card>
      ) : (
        <div className="space-y-3">
          {employerGroups.map(emp => {
            // When an employer only has ONE course-run, the extra nesting is
            // just clicks for no information — render the course-run flat with
            // a combined "Employer · Course" header instead.
            if (emp.courseRuns.length === 1) {
              const cr = emp.courseRuns[0];
              const crCollapseKey = `cr:${cr.key}`;
              const isCollapsed = !!collapsed[crCollapseKey];
              const hasMismatch = cr.mismatchCount > 0;
              const allVerified = cr.rows.length > 0 && cr.verifiedCount === cr.rows.length;
              const borderClass = hasMismatch
                ? 'border-red-500'
                : allVerified
                  ? 'border-emerald-500'
                  : 'border-blue-500';
              return (
                <Card key={emp.key}>
                  <div className={`border-l-4 ${borderClass}`}>
                    <button
                      type="button"
                      onClick={() => toggleGroup(crCollapseKey)}
                      className="w-full px-4 py-3 flex items-center justify-between gap-3 hover:bg-gray-50 dark:hover:bg-gray-800/50 transition-colors text-left"
                    >
                      <div className="flex items-center gap-3 min-w-0 flex-1">
                        <Icon
                          name={IconName.ChevronDown}
                          className={`w-4 h-4 text-gray-400 transition-transform flex-shrink-0 ${isCollapsed ? '-rotate-90' : ''}`}
                        />
                        <div className="w-10 h-10 rounded-lg bg-gray-100 dark:bg-gray-800 flex items-center justify-center flex-shrink-0">
                          <Icon name={IconName.Building} className="w-5 h-5 text-gray-500 dark:text-gray-400" />
                        </div>
                        <div className="min-w-0 flex-1">
                          <p className="text-sm dark:text-white truncate">
                            <span className="font-bold">{emp.employerName}</span>
                            <span className="mx-2 text-gray-400 dark:text-gray-500">·</span>
                            <span className="font-semibold text-gray-700 dark:text-gray-200">{cr.courseTitle}</span>
                          </p>
                          <div className="mt-1 flex items-center gap-x-3 gap-y-0.5 flex-wrap text-[11px] text-gray-500 dark:text-gray-400">
                            {cr.courseStartDate && (
                              <span
                                className="inline-flex items-center gap-1"
                                title={`Course start date: ${formatCourseDateLong(cr.courseStartDate)}`}
                              >
                                <span className="text-gray-400 dark:text-gray-500">Start date</span>
                                {formatCourseDateLong(cr.courseStartDate)}
                              </span>
                            )}
                            {cr.courseRunId && (
                              <span
                                className="inline-flex items-center gap-1 font-mono"
                                title={`Course Run ID: ${cr.courseRunId}`}
                              >
                                <span className="text-gray-400 dark:text-gray-500 font-sans">Course run</span>
                                {cr.courseRunId}
                              </span>
                            )}
                            {emp.employerUen && (
                              <span
                                className="inline-flex items-center gap-1 font-mono"
                                title={`Employer UEN: ${emp.employerUen}`}
                              >
                                <span className="text-gray-400 dark:text-gray-500 font-sans">UEN</span>
                                {emp.employerUen}
                              </span>
                            )}
                          </div>
                        </div>
                      </div>
                      <div className="flex items-center gap-1.5 flex-shrink-0">
                        {cr.verifiedCount > 0 && <StatusChip kind="verified" count={cr.verifiedCount} />}
                        {cr.mismatchCount > 0 && <StatusChip kind="mismatch" count={cr.mismatchCount} />}
                        {cr.pendingCount > 0 && <StatusChip kind="pending" count={cr.pendingCount} />}
                        {cr.noDocCount > 0 && <StatusChip kind="noDoc" count={cr.noDocCount} />}
                      </div>
                    </button>
                    {!isCollapsed && (
                      <div className="border-t dark:border-gray-700">
                        {cr.rows.map((row, idx) => {
                          const id = String(row.id || '');
                          const name = String(row['Trainee FULL Name as on government ID*'] || '').trim() || '(unnamed)';
                          const nric = String(row['Trainee NRIC/FIN Number*'] || '').trim();
                          const docLink = String(row['Supporting Doc Drive Link'] || '').trim();
                          const effective = getEffectiveStatus(row);
                          return (
                            <div
                              key={id || `${cr.key}-${idx}`}
                              className={`flex items-center justify-between gap-3 px-4 py-2.5 hover:bg-gray-50 dark:hover:bg-gray-800/40 transition-colors ${
                                idx > 0 ? 'border-t dark:border-gray-800' : ''
                              }`}
                            >
                              <div className="min-w-0 flex items-center gap-3 flex-1">
                                <StatusDot kind={effective} />
                                <div className="min-w-0 flex-1">
                                  <p className="text-sm font-medium dark:text-white truncate">{name}</p>
                                  <div className="flex items-center gap-2 mt-0.5">
                                    {nric && (
                                      <span
                                        className="text-[11px] font-mono text-gray-500 dark:text-gray-400"
                                        title="NRIC masked for privacy"
                                      >
                                        {maskNric(nric)}
                                      </span>
                                    )}
                                    {docLink && (
                                      <a
                                        href={docLink}
                                        target="_blank"
                                        rel="noopener noreferrer"
                                        onClick={(e) => e.stopPropagation()}
                                        className="inline-flex items-center gap-1 text-[11px] text-blue-600 dark:text-blue-400 hover:underline"
                                        title="Open uploaded doc in Drive"
                                      >
                                        <Icon name={IconName.ExternalLink} className="w-3 h-3" />
                                        Open doc
                                      </a>
                                    )}
                                  </div>
                                </div>
                              </div>
                              <div className="flex items-center gap-2 flex-shrink-0">
                                <RowStatusLabel kind={effective} />
                                <button
                                  type="button"
                                  onClick={() => openModalForRow(id)}
                                  disabled={!id}
                                  className={`text-xs font-semibold px-3 py-1.5 rounded-lg text-white disabled:opacity-50 disabled:cursor-not-allowed inline-flex items-center gap-1.5 shadow-sm ${
                                    effective === 'verified'
                                      ? 'bg-gray-600 hover:bg-gray-700'
                                      : 'bg-blue-600 hover:bg-blue-700'
                                  }`}
                                >
                                  <Icon name={effective === 'verified' ? IconName.Eye : IconName.Shield} className="w-3.5 h-3.5" />
                                  {effective === 'verified' ? 'View' : 'Verify'}
                                </button>
                              </div>
                            </div>
                          );
                        })}
                        {cr.rows.length > 1 && !allVerified && (
                          <div className="px-4 py-2.5 bg-gray-50 dark:bg-gray-800/40 border-t dark:border-gray-800 flex items-center justify-between">
                            <p className="text-[11px] text-gray-500 dark:text-gray-400">
                              Verify the entire batch in one pass — opens all {cr.rows.length} learners in the modal.
                            </p>
                            <Button onClick={() => openModalForGroup(cr.rows)}>
                              <Icon name={IconName.Shield} className="w-3.5 h-3.5 mr-1.5" />
                              Verify all {cr.rows.length}
                            </Button>
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                </Card>
              );
            }

            // Multi-course employer: show the employer wrapper with nested
            // course-run sub-cards so admin can see "all of X Company's work"
            // at a glance, then drill into each course.
            const empCollapseKey = `emp:${emp.key}`;
            const isEmpCollapsed = !!collapsed[empCollapseKey];
            const empHasMismatch = emp.mismatchCount > 0;
            const empAllVerified = emp.totalRows > 0 && emp.verifiedCount === emp.totalRows;
            const empBorder = empHasMismatch
              ? 'border-red-500'
              : empAllVerified
                ? 'border-emerald-500'
                : 'border-blue-500';
            return (
              <Card key={emp.key}>
                <div className={`border-l-4 ${empBorder}`}>
                  {/* Employer header */}
                  <button
                    type="button"
                    onClick={() => toggleGroup(empCollapseKey)}
                    className="w-full px-4 py-3 flex items-center justify-between gap-3 hover:bg-gray-50 dark:hover:bg-gray-800/50 transition-colors text-left"
                  >
                    <div className="flex items-center gap-3 min-w-0 flex-1">
                      <Icon
                        name={IconName.ChevronDown}
                        className={`w-4 h-4 text-gray-400 transition-transform flex-shrink-0 ${isEmpCollapsed ? '-rotate-90' : ''}`}
                      />
                      <div className="w-10 h-10 rounded-lg bg-gray-100 dark:bg-gray-800 flex items-center justify-center flex-shrink-0">
                        <Icon name={IconName.Building} className="w-5 h-5 text-gray-500 dark:text-gray-400" />
                      </div>
                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-bold dark:text-white truncate">{emp.employerName}</p>
                        <div className="mt-1 flex items-center gap-x-3 gap-y-0.5 flex-wrap text-[11px] text-gray-500 dark:text-gray-400">
                          {emp.employerUen && (
                            <span
                              className="inline-flex items-center gap-1 font-mono"
                              title={`Employer UEN: ${emp.employerUen}`}
                            >
                              <span className="text-gray-400 dark:text-gray-500 font-sans">UEN</span>
                              {emp.employerUen}
                            </span>
                          )}
                          <span>
                            {emp.courseRuns.length} course-run{emp.courseRuns.length === 1 ? '' : 's'} · {emp.totalRows} learner{emp.totalRows === 1 ? '' : 's'}
                          </span>
                        </div>
                      </div>
                    </div>
                    <div className="flex items-center gap-1.5 flex-shrink-0">
                      {emp.verifiedCount > 0 && (
                        <StatusChip kind="verified" count={emp.verifiedCount} />
                      )}
                      {emp.mismatchCount > 0 && (
                        <StatusChip kind="mismatch" count={emp.mismatchCount} />
                      )}
                      {emp.pendingCount > 0 && (
                        <StatusChip kind="pending" count={emp.pendingCount} />
                      )}
                      {emp.noDocCount > 0 && (
                        <StatusChip kind="noDoc" count={emp.noDocCount} />
                      )}
                    </div>
                  </button>

                  {/* Course-run sub-cards */}
                  {!isEmpCollapsed && (
                    <div className="border-t dark:border-gray-700 p-3 space-y-2 bg-gray-50/50 dark:bg-gray-900/30">
                      {emp.courseRuns.map(cr => {
                        const crCollapseKey = `cr:${cr.key}`;
                        // Course-run defaults: single course-run for the employer → expanded;
                        // multiple → collapsed (admin picks which to drill into).
                        const defaultCollapsed = emp.courseRuns.length > 1;
                        const isCrCollapsed = collapsed[crCollapseKey] === undefined
                          ? defaultCollapsed
                          : !!collapsed[crCollapseKey];
                        const crHasMismatch = cr.mismatchCount > 0;
                        const crAllVerified = cr.rows.length > 0 && cr.verifiedCount === cr.rows.length;
                        const crBorder = crHasMismatch
                          ? 'border-red-500'
                          : crAllVerified
                            ? 'border-emerald-500'
                            : 'border-blue-400';
                        return (
                          <div
                            key={cr.key}
                            className={`rounded-lg border-l-4 ${crBorder} bg-white dark:bg-gray-800/60 ring-1 ring-gray-200 dark:ring-gray-700/60 overflow-hidden`}
                          >
                            {/* Course-run header */}
                            <button
                              type="button"
                              onClick={() => toggleGroup(crCollapseKey)}
                              className="w-full px-3 py-2.5 flex items-center justify-between gap-3 hover:bg-gray-50 dark:hover:bg-gray-800/40 transition-colors text-left"
                            >
                              <div className="flex items-center gap-2 min-w-0 flex-1">
                                <Icon
                                  name={IconName.ChevronDown}
                                  className={`w-3.5 h-3.5 text-gray-400 transition-transform flex-shrink-0 ${isCrCollapsed ? '-rotate-90' : ''}`}
                                />
                                <Icon name={IconName.BookOpen} className="w-4 h-4 text-gray-400 dark:text-gray-500 flex-shrink-0" />
                                <div className="min-w-0 flex-1">
                                  <p className="text-sm font-semibold text-gray-800 dark:text-gray-100 truncate">{cr.courseTitle}</p>
                                  <div className="mt-0.5 flex items-center gap-x-3 gap-y-0.5 flex-wrap text-[11px] text-gray-500 dark:text-gray-400">
                                    {cr.courseStartDate && (
                                      <span
                                        className="inline-flex items-center gap-1"
                                        title={`Course start date: ${formatCourseDateLong(cr.courseStartDate)}`}
                                      >
                                        <span className="text-gray-400 dark:text-gray-500">Start date</span>
                                        {formatCourseDateLong(cr.courseStartDate)}
                                      </span>
                                    )}
                                    {cr.courseRunId && (
                                      <span
                                        className="inline-flex items-center gap-1 font-mono"
                                        title={`Course Run ID: ${cr.courseRunId}`}
                                      >
                                        <span className="text-gray-400 dark:text-gray-500 font-sans">Course run</span>
                                        {cr.courseRunId}
                                      </span>
                                    )}
                                    <span>{cr.rows.length} learner{cr.rows.length === 1 ? '' : 's'}</span>
                                  </div>
                                </div>
                              </div>
                              <div className="flex items-center gap-1.5 flex-shrink-0">
                                {cr.verifiedCount > 0 && (
                                  <StatusChip kind="verified" count={cr.verifiedCount} />
                                )}
                                {cr.mismatchCount > 0 && (
                                  <StatusChip kind="mismatch" count={cr.mismatchCount} />
                                )}
                                {cr.pendingCount > 0 && (
                                  <StatusChip kind="pending" count={cr.pendingCount} />
                                )}
                                {cr.noDocCount > 0 && (
                                  <StatusChip kind="noDoc" count={cr.noDocCount} />
                                )}
                              </div>
                            </button>

                            {/* Learner rows */}
                            {!isCrCollapsed && (
                              <div className="border-t dark:border-gray-700">
                                {cr.rows.map((row, idx) => {
                                  const id = String(row.id || '');
                                  const name = String(row['Trainee FULL Name as on government ID*'] || '').trim() || '(unnamed)';
                                  const nric = String(row['Trainee NRIC/FIN Number*'] || '').trim();
                                  const docLink = String(row['Supporting Doc Drive Link'] || '').trim();
                                  const effective = getEffectiveStatus(row);
                                  return (
                                    <div
                                      key={id || `${cr.key}-${idx}`}
                                      className={`flex items-center justify-between gap-3 px-4 py-2.5 hover:bg-gray-50 dark:hover:bg-gray-800/40 transition-colors ${
                                        idx > 0 ? 'border-t dark:border-gray-800' : ''
                                      }`}
                                    >
                                      <div className="min-w-0 flex items-center gap-3 flex-1">
                                        <StatusDot kind={effective} />
                                        <div className="min-w-0 flex-1">
                                          <p className="text-sm font-medium dark:text-white truncate">{name}</p>
                                          <div className="flex items-center gap-2 mt-0.5">
                                            {nric && (
                                              <span
                                                className="text-[11px] font-mono text-gray-500 dark:text-gray-400"
                                                title="NRIC masked for privacy"
                                              >
                                                {maskNric(nric)}
                                              </span>
                                            )}
                                            {docLink && (
                                              <a
                                                href={docLink}
                                                target="_blank"
                                                rel="noopener noreferrer"
                                                onClick={(e) => e.stopPropagation()}
                                                className="inline-flex items-center gap-1 text-[11px] text-blue-600 dark:text-blue-400 hover:underline"
                                                title="Open uploaded doc in Drive"
                                              >
                                                <Icon name={IconName.ExternalLink} className="w-3 h-3" />
                                                Open doc
                                              </a>
                                            )}
                                          </div>
                                        </div>
                                      </div>
                                      <div className="flex items-center gap-2 flex-shrink-0">
                                        <RowStatusLabel kind={effective} />
                                        <button
                                          type="button"
                                          onClick={() => openModalForRow(id)}
                                          disabled={!id}
                                          className={`text-xs font-semibold px-3 py-1.5 rounded-lg text-white disabled:opacity-50 disabled:cursor-not-allowed inline-flex items-center gap-1.5 shadow-sm ${
                                            effective === 'verified'
                                              ? 'bg-gray-600 hover:bg-gray-700'
                                              : 'bg-blue-600 hover:bg-blue-700'
                                          }`}
                                        >
                                          <Icon name={effective === 'verified' ? IconName.Eye : IconName.Shield} className="w-3.5 h-3.5" />
                                          {effective === 'verified' ? 'View' : 'Verify'}
                                        </button>
                                      </div>
                                    </div>
                                  );
                                })}
                                {cr.rows.length > 1 && !crAllVerified && (
                                  <div className="px-4 py-2.5 bg-gray-50 dark:bg-gray-800/40 border-t dark:border-gray-800 flex items-center justify-between">
                                    <p className="text-[11px] text-gray-500 dark:text-gray-400">
                                      Verify the entire batch in one pass — opens all {cr.rows.length} learners in the modal.
                                    </p>
                                    <Button onClick={() => openModalForGroup(cr.rows)}>
                                      <Icon name={IconName.Shield} className="w-3.5 h-3.5 mr-1.5" />
                                      Verify all {cr.rows.length}
                                    </Button>
                                  </div>
                                )}
                              </div>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              </Card>
            );
          })}
        </div>
      )}

      {targetIds && targetIds.length > 0 && (
        <SupportingDocsModal
          applicationIds={targetIds}
          initialStep="verify"
          verifiedBy={currentUser?.email || currentUser?.fullName || undefined}
          onClose={() => {
            setTargetIds(null);
            void reload();
          }}
        />
      )}
    </div>
  );
};

// ── Sub-components ────────────────────────────────────────────────────────

type StatTone = 'emerald' | 'blue' | 'red' | 'amber' | 'gray';
const STAT_TONES: Record<StatTone, { bg: string; iconBg: string; iconColor: string; value: string }> = {
  emerald: {
    bg: 'bg-white dark:bg-gray-800 border-emerald-200 dark:border-emerald-800/60',
    iconBg: 'bg-emerald-100 dark:bg-emerald-900/30',
    iconColor: 'text-emerald-600 dark:text-emerald-400',
    value: 'text-emerald-700 dark:text-emerald-300',
  },
  blue: {
    bg: 'bg-white dark:bg-gray-800 border-blue-200 dark:border-blue-800/60',
    iconBg: 'bg-blue-100 dark:bg-blue-900/30',
    iconColor: 'text-blue-600 dark:text-blue-400',
    value: 'text-blue-700 dark:text-blue-300',
  },
  red: {
    bg: 'bg-white dark:bg-gray-800 border-red-200 dark:border-red-800/60',
    iconBg: 'bg-red-100 dark:bg-red-900/30',
    iconColor: 'text-red-600 dark:text-red-400',
    value: 'text-red-700 dark:text-red-300',
  },
  amber: {
    bg: 'bg-white dark:bg-gray-800 border-amber-200 dark:border-amber-800/60',
    iconBg: 'bg-amber-100 dark:bg-amber-900/30',
    iconColor: 'text-amber-600 dark:text-amber-400',
    value: 'text-amber-700 dark:text-amber-300',
  },
  gray: {
    bg: 'bg-white dark:bg-gray-800 border-gray-200 dark:border-gray-700',
    iconBg: 'bg-gray-100 dark:bg-gray-800',
    iconColor: 'text-gray-500 dark:text-gray-400',
    value: 'text-gray-700 dark:text-gray-200',
  },
};

const StatTile: React.FC<{
  icon: IconName;
  label: string;
  value: number;
  subtitle?: string;
  tone: StatTone;
}> = ({ icon, label, value, subtitle, tone }) => {
  const t = STAT_TONES[tone];
  return (
    <div className={`rounded-xl border ${t.bg} p-4 flex items-start gap-3 shadow-sm`}>
      <div className={`w-10 h-10 rounded-lg ${t.iconBg} flex items-center justify-center flex-shrink-0`}>
        <Icon name={icon} className={`w-5 h-5 ${t.iconColor}`} />
      </div>
      <div className="min-w-0">
        <p className="text-[11px] font-bold uppercase tracking-wider text-gray-500 dark:text-gray-400">{label}</p>
        <p className={`text-2xl font-bold leading-tight mt-0.5 ${t.value}`}>{value}</p>
        {subtitle && (
          <p className="text-[11px] text-gray-500 dark:text-gray-400 mt-0.5 truncate">{subtitle}</p>
        )}
      </div>
    </div>
  );
};

const STATUS_KIND_META: Record<RowEffectiveStatus, { label: string; icon: IconName; chipClass: string; dotClass: string }> = {
  verified: {
    label: 'Verified',
    icon: IconName.CheckCircle,
    chipClass: 'bg-emerald-100 dark:bg-emerald-900/30 text-emerald-700 dark:text-emerald-300 ring-1 ring-emerald-300/60',
    dotClass: 'bg-emerald-500',
  },
  mismatch: {
    label: 'Mismatch',
    icon: IconName.Warning,
    chipClass: 'bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-300 ring-1 ring-red-300/60',
    dotClass: 'bg-red-500',
  },
  pending: {
    label: 'Pending',
    icon: IconName.Eye,
    chipClass: 'bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-300 ring-1 ring-amber-300/60',
    dotClass: 'bg-amber-400',
  },
  noDoc: {
    label: 'No Doc',
    icon: IconName.Upload,
    chipClass: 'bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-300 ring-1 ring-gray-300/60',
    dotClass: 'bg-gray-400',
  },
};

const StatusChip: React.FC<{ kind: RowEffectiveStatus; count: number }> = ({ kind, count }) => {
  const m = STATUS_KIND_META[kind];
  return (
    <span
      className={`inline-flex items-center gap-1 text-[10px] font-bold uppercase tracking-wide px-2 py-0.5 rounded-full ${m.chipClass}`}
      title={`${count} ${m.label.toLowerCase()}`}
    >
      <Icon name={m.icon} className="w-3 h-3" />
      {m.label}
    </span>
  );
};

const StatusDot: React.FC<{ kind: RowEffectiveStatus }> = ({ kind }) => {
  const m = STATUS_KIND_META[kind];
  return (
    <span
      className={`w-2 h-2 rounded-full ${m.dotClass} flex-shrink-0`}
      title={m.label}
    />
  );
};

const RowStatusLabel: React.FC<{ kind: RowEffectiveStatus }> = ({ kind }) => {
  const m = STATUS_KIND_META[kind];
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-semibold ${m.chipClass}`}>
      <Icon name={m.icon} className="w-3 h-3 mr-1" />
      {m.label}
    </span>
  );
};
