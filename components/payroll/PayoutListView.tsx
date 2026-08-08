import React, { useEffect, useMemo, useRef, useState, useCallback } from 'react';
import { Icon, IconName } from '../ui/Icon';
import PayoutEditDialog, { PayoutRow } from './PayoutEditDialog';
import ManualClassDialog, { ManualClass } from './ManualClassDialog';
import { PayoutTier } from '@lib/payroll/calculate';
import { authHeader } from '@lib/auth/authHeader';
import { fmtDate } from '@lib/payroll/formatDate';
import DateRangeCell, { parseMultiDates, collapseMultiDates } from '../ui/DateRangeCell';
import {
  fmtCurrency,
  StatusBadge,
  BillNo,
  StatCard,
  LoadingRow,
  OPTION_CLASS,
  NonWsqTag,
  NON_WSQ_ROW,
  NON_WSQ_ROW_HOVER,
  NON_WSQ_ACCENT,
} from './shared';

type StatusFilter = 'all' | 'pending' | 'completed' | 'cancelled';
type SourceFilter = 'all' | 'wsq' | 'manual';

const isManual = (r: PayoutRow) => r.source === 'manual';

// Map a merged (manual) payout row back to the ManualClass shape the dialog edits.
const toManualClass = (r: PayoutRow): ManualClass => ({
  id: r.id,
  class_title: r.course_title || '',
  course_code: r.course_code ?? null,
  trainer_id: r.trainer_id || null,
  trainer_name: r.trainer_name || '',
  start_date: r.start_date ?? null,
  end_date: r.end_date ?? null,
  class_dates: r.class_dates ?? null,
  num_learners: Number(r.num_learners) || 0,
  course_fee: r.course_fee,
  tier_percent: r.tier_percent,
  estimated_payout: r.estimated_payout,
  actual_payout: r.actual_payout,
  status: r.status,
  payment_date: r.payment_date,
  remark: r.remark,
  bill_no: r.bill_no ?? null,
});

// Compact, low-emphasis stat used for the secondary "Selected window" strip.
const CompactStat: React.FC<{
  label: string;
  value: string;
  sub?: string;
  dot: string;
}> = ({ label, value, sub, dot }) => (
  <div className="px-4 py-2.5 bg-white dark:bg-slate-800/60">
    <div className="flex items-center gap-1.5">
      <span className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${dot}`} />
      <span className="text-[10px] uppercase tracking-wider text-on-surface-secondary font-semibold truncate">{label}</span>
    </div>
    <div className="text-lg font-bold leading-tight tabular-nums mt-0.5 truncate" title={value}>{value}</div>
    {sub && <div className="text-[10px] text-on-surface-secondary truncate mt-0.5">{sub}</div>}
  </div>
);

const PAGE_SIZE = 20;

const todayIso = () => {
  const d = new Date();
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
};

// The two endpoints answer with their own row shapes (payroll_manual_class calls
// the title class_title), so fold either back onto the merged PayoutRow shape.
const mergeSaved = (prev: PayoutRow, saved: any): PayoutRow => ({
  ...prev,
  ...saved,
  ...(saved?.class_title !== undefined ? { course_title: saved.class_title } : {}),
});

const PayoutListView: React.FC = () => {
  const [rows, setRows] = useState<PayoutRow[]>([]);
  const [tiers, setTiers] = useState<PayoutTier[]>([]);
  // All-time overview totals for the summary cards (independent of the window).
  const [overview, setOverview] = useState({
    totalAmount: 0,
    totalClasses: 0,
    pendingCount: 0,
    pendingAmount: 0,
    completedCount: 0,
    completedAmount: 0,
    cancelledCount: 0,
  });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<PayoutRow | null>(null);
  const [editingManual, setEditingManual] = useState<ManualClass | null>(null);
  const [creatingManual, setCreatingManual] = useState(false);
  const [months, setMonths] = useState(2);
  // Window mode: 'month' shows a single calendar month (default, matches monthly
  // payroll cycles); 'range' is the rolling "last N months".
  const [windowMode, setWindowMode] = useState<'month' | 'range'>('month');
  const [month, setMonth] = useState<string>(() => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
  });
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');
  const [sourceFilter, setSourceFilter] = useState<SourceFilter>('all');
  const [search, setSearch] = useState('');
  const [trainerFilter, setTrainerFilter] = useState<string>('all');
  const [classFilter, setClassFilter] = useState<string>('all');
  const [startFrom, setStartFrom] = useState<string>('');
  const [startTo, setStartTo] = useState<string>('');
  const [groupByTrainer, setGroupByTrainer] = useState(false);
  // Accordion: at most one trainer's classes open at a time (holds the group key).
  const [expandedTrainer, setExpandedTrainer] = useState<string | null>(null);
  // Group key currently running a bulk mark/unmark, plus its failure message.
  const [bulkSaving, setBulkSaving] = useState<string | null>(null);
  const [bulkError, setBulkError] = useState<string | null>(null);
  // Mirrors bulkSaving synchronously — state updates are async, so the click
  // handler can't rely on them to reject a second concurrent run.
  const bulkRunning = useRef(false);
  const [page, setPage] = useState(0);

  // silent = refresh data (incl. the server-computed overview totals) without the
  // full-table loading spinner. Used after an inline edit so the Overview cards
  // re-sync without a jarring flash over the list.
  const load = useCallback(async (silent = false) => {
    if (!silent) setLoading(true);
    setError(null);
    try {
      const windowQuery = windowMode === 'month' ? `month=${month}` : `months=${months}`;
      const r = await fetch(`/api/payroll/payouts?${windowQuery}`, {
        headers: { ...authHeader() },
      });
      const j = await r.json();
      if (!j.success) throw new Error(j.error || 'Failed to load payouts');
      setRows(j.data.payouts || []);
      setTiers(j.data.tiers || []);
      if (j.data.overview) setOverview(j.data.overview);
    } catch (e: any) {
      setError(e?.message || 'Failed to load');
    } finally {
      if (!silent) setLoading(false);
    }
  }, [months, month, windowMode]);

  useEffect(() => {
    load();
  }, [load]);

  // Month-picker helpers (used when windowMode === 'month').
  const currentMonthStr = (() => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
  })();
  const monthLabel = (() => {
    const [y, m] = month.split('-').map(Number);
    return new Date(y, m - 1, 1).toLocaleDateString('en-SG', { month: 'long', year: 'numeric' });
  })();
  const shiftMonth = (delta: number) => {
    const [y, m] = month.split('-').map(Number);
    const d = new Date(y, m - 1 + delta, 1);
    setMonth(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`);
  };

  // Dropdown option lists, built from all loaded rows so they stay stable across filtering.
  // Resolve a stable per-trainer key. WSQ rows carry a real trainer_id; manually
  // added non-WSQ rows don't (free-text name), so they'd split into their own
  // group. Map name→id from rows that DO have an id, so a manual row for the same
  // person merges into that trainer's group instead of forming a duplicate.
  const nameToId = useMemo(() => {
    const m = new Map<string, string>();
    rows.forEach((r) => {
      if (r.trainer_id && r.trainer_name) {
        const n = r.trainer_name.trim().toLowerCase();
        if (n && !m.has(n)) m.set(n, r.trainer_id);
      }
    });
    return m;
  }, [rows]);

  const trainerKey = useCallback(
    (r: PayoutRow) => {
      if (r.trainer_id) return `id:${r.trainer_id}`;
      const n = (r.trainer_name || '').trim().toLowerCase();
      const mapped = n ? nameToId.get(n) : undefined;
      return mapped ? `id:${mapped}` : `name:${n}`;
    },
    [nameToId]
  );

  const trainerOptions = useMemo(() => {
    const map = new Map<string, string>();
    rows.forEach((r) => {
      const id = trainerKey(r);
      if (!map.has(id)) map.set(id, r.trainer_name || '(Unnamed trainer)');
    });
    return Array.from(map.entries())
      .map(([id, name]) => ({ id, name }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [rows, trainerKey]);

  const classOptions = useMemo(() => {
    const map = new Map<string, string>();
    rows.forEach((r) => {
      if (!map.has(r.course_run_id)) {
        const label = `${r.course_title || r.course_code || 'Class'}${
          r.course_run_code ? ` (${r.course_run_code})` : ''
        }`;
        map.set(r.course_run_id, label);
      }
    });
    return Array.from(map.entries())
      .map(([id, label]) => ({ id, label }))
      .sort((a, b) => a.label.localeCompare(b.label));
  }, [rows]);

  // Rows matching every filter EXCEPT the status pill. The status-pill counts are
  // derived from this set (so each pill shows how many of that status match the
  // other active filters), and the final `filtered` just applies the status pill
  // on top — so the pill counts stay sensible instead of collapsing to the picked one.
  const baseFiltered = useMemo(() => {
    const q = search.trim().toLowerCase();
    const from = startFrom || null;
    const to = startTo || null;
    return rows.filter((r) => {
      if (sourceFilter !== 'all' && (r.source || 'wsq') !== sourceFilter) return false;
      if (trainerFilter !== 'all' && trainerKey(r) !== trainerFilter) return false;
      if (classFilter !== 'all' && r.course_run_id !== classFilter) return false;
      if (from || to) {
        const sd = r.start_date ? r.start_date.slice(0, 10) : null;
        if (!sd) return false;
        if (from && sd < from) return false;
        if (to && sd > to) return false;
      }
      if (!q) return true;
      return [r.trainer_name, r.course_title, r.course_code, r.course_run_code, r.bill_no]
        .filter(Boolean)
        .some((v) => String(v).toLowerCase().includes(q));
    });
  }, [rows, sourceFilter, search, trainerFilter, classFilter, startFrom, startTo, trainerKey]);

  const filtered = useMemo(
    () => (statusFilter === 'all' ? baseFiltered : baseFiltered.filter((r) => r.status === statusFilter)),
    [baseFiltered, statusFilter]
  );

  // Consolidated totals per trainer (across all of that trainer's filtered classes).
  const grouped = useMemo(() => {
    const map = new Map<
      string,
      {
        key: string;
        trainer_id: string;
        trainer_name: string;
        rows: PayoutRow[];
        learners: number;
        estimated: number;
        actual: number;
      }
    >();
    filtered.forEach((r) => {
      const key = trainerKey(r);
      let g = map.get(key);
      if (!g) {
        g = {
          key,
          trainer_id: r.trainer_id,
          trainer_name: r.trainer_name || '(Unnamed trainer)',
          rows: [],
          learners: 0,
          estimated: 0,
          actual: 0,
        };
        map.set(key, g);
      }
      g.rows.push(r);
      g.learners += Number(r.num_learners) || 0;
      g.estimated += Number(r.estimated_payout) || 0;
      g.actual += Number(r.actual_payout) || 0;
    });
    // Sort alphabetically by trainer name so a specific person is easy to find.
    return Array.from(map.values()).sort((a, b) => a.trainer_name.localeCompare(b.trainer_name));
  }, [filtered, trainerKey]);

  const hasExtraFilters =
    trainerFilter !== 'all' ||
    classFilter !== 'all' ||
    sourceFilter !== 'all' ||
    startFrom !== '' ||
    startTo !== '' ||
    search.trim() !== '';

  const clearFilters = useCallback(() => {
    setTrainerFilter('all');
    setClassFilter('all');
    setSourceFilter('all');
    setStartFrom('');
    setStartTo('');
    setSearch('');
  }, []);

  const totalItems = groupByTrainer ? grouped.length : filtered.length;
  const totalPages = Math.max(1, Math.ceil(totalItems / PAGE_SIZE));
  const safePage = Math.min(page, totalPages - 1);
  const pageRows = useMemo(
    () => filtered.slice(safePage * PAGE_SIZE, safePage * PAGE_SIZE + PAGE_SIZE),
    [filtered, safePage]
  );
  const pageGroups = useMemo(
    () => grouped.slice(safePage * PAGE_SIZE, safePage * PAGE_SIZE + PAGE_SIZE),
    [grouped, safePage]
  );
  const rangeStart = totalItems === 0 ? 0 : safePage * PAGE_SIZE + 1;
  const rangeEnd = Math.min(totalItems, safePage * PAGE_SIZE + PAGE_SIZE);

  useEffect(() => {
    setPage(0);
    // Collapse on any filter change — the open trainer may not even be in the new list.
    setExpandedTrainer(null);
  }, [statusFilter, sourceFilter, search, months, month, windowMode, trainerFilter, classFilter, startFrom, startTo, groupByTrainer]);

  // Collapse if the open trainer scrolled off the current page.
  useEffect(() => {
    if (expandedTrainer && !pageGroups.some((g) => g.key === expandedTrainer)) setExpandedTrainer(null);
  }, [expandedTrainer, pageGroups]);

  // Bulk mark/unmark every class under one trainer. Sequential on purpose — one
  // request in flight at a time, so a trainer with many classes can't stampede
  // the API or the connection pool.
  const bulkSetPaid = useCallback(async (groupKey: string, groupRows: PayoutRow[], paid: boolean) => {
    // Hard re-entry guard. The button's disabled state alone isn't enough: collapsing
    // mid-save and opening another trainer unmounts it, so a second loop could start
    // and then have its "saving" flag cleared by the first one finishing.
    if (bulkRunning.current) return;
    bulkRunning.current = true;
    setBulkError(null);
    setBulkSaving(groupKey);
    const failed: string[] = [];
    for (const r of groupRows) {
      if (paid ? r.status === 'completed' : r.status !== 'completed') continue; // already there
      const est = Number(r.estimated_payout) || 0;
      const hasActual = r.actual_payout !== null && r.actual_payout !== undefined && r.actual_payout !== '';
      const body = paid
        ? {
            status: 'completed',
            actual_payout: hasActual ? r.actual_payout : est > 0 ? est.toFixed(2) : null,
            payment_date: r.payment_date || todayIso(),
          }
        : { status: 'pending' }; // amounts and dates are kept
      try {
        // Route to the right table: non-WSQ rows live in payroll_manual_class.
        const endpoint = isManual(r)
          ? `/api/payroll/manual-classes/${r.id}`
          : `/api/payroll/payouts/${r.id}`;
        const res = await fetch(endpoint, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json', ...authHeader() },
          body: JSON.stringify(body),
        });
        const j = await res.json();
        if (!j.success) throw new Error(j.error || 'save failed');
        const updated = mergeSaved(r, j.data);
        setRows((rs) => rs.map((x) => (x.id === updated.id ? updated : x)));
      } catch {
        failed.push(r.course_title || r.course_code || 'a class');
      }
    }
    bulkRunning.current = false;
    setBulkSaving(null);
    if (failed.length > 0) {
      setBulkError(
        `${failed.length} class${failed.length === 1 ? '' : 'es'} failed to update: ${failed.join(', ')}. Please try again.`
      );
    }
    load(true); // re-sync the Overview cards
  }, [load]);

  // "Selected window" card row + status-pill counts — both derived from baseFiltered
  // (the current filters minus the status pill) so they agree with each other and
  // with the table, and don't collapse to zero when a single status is selected.
  const windowStats = useMemo(() => {
    const sum = (xs: PayoutRow[], key: 'actual_payout' | 'estimated_payout') =>
      xs.reduce((acc, r) => {
        const v = Number(r[key] ?? 0);
        return acc + (Number.isFinite(v) ? v : 0);
      }, 0);
    const pending = baseFiltered.filter((r) => r.status === 'pending');
    const completed = baseFiltered.filter((r) => r.status === 'completed');
    const cancelled = baseFiltered.filter((r) => r.status === 'cancelled');
    const pendingAmount = sum(pending, 'estimated_payout');
    return {
      totalAmount: pendingAmount, // outstanding still owed, within the current filters
      totalClasses: baseFiltered.length,
      pendingCount: pending.length,
      pendingAmount,
      completedCount: completed.length,
      completedAmount: sum(completed, 'actual_payout'),
      cancelledCount: cancelled.length,
    };
  }, [baseFiltered]);

  const counts = useMemo(() => {
    const c = { all: baseFiltered.length, pending: 0, completed: 0, cancelled: 0 } as Record<StatusFilter, number>;
    baseFiltered.forEach((r) => {
      if (r.status === 'pending') c.pending++;
      else if (r.status === 'completed') c.completed++;
      else if (r.status === 'cancelled') c.cancelled++;
    });
    return c;
  }, [baseFiltered]);

  const FilterPill: React.FC<{ value: StatusFilter; label: string }> = ({ value, label }) => {
    const active = statusFilter === value;
    return (
      <button
        type="button"
        onClick={() => setStatusFilter(value)}
        className={`px-3 py-1 text-xs font-medium rounded-full border transition-colors ${
          active
            ? 'bg-primary text-white border-primary'
            : 'bg-white dark:bg-slate-800 border-default text-on-surface-secondary hover:bg-gray-50 dark:hover:bg-slate-700'
        }`}
      >
        {label} <span className={active ? 'opacity-80' : 'opacity-60'}>({counts[value] ?? 0})</span>
      </button>
    );
  };

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="w-11 h-11 rounded-xl bg-gradient-to-br from-primary to-primary/60 flex items-center justify-center text-white shadow-lg shadow-primary/20 flex-shrink-0">
            <Icon name={IconName.DollarSign} className="w-6 h-6" />
          </div>
          <div>
            <h1 className="text-2xl font-bold leading-tight">Trainer Payouts</h1>
            <p className="text-sm text-on-surface-secondary mt-0.5">
              Set each trainer&apos;s actual payout and mark it as paid. WSQ classes appear
              automatically; non-WSQ classes are added by hand and tagged.
            </p>
          </div>
        </div>
        {/* Primary action — pinned top-right */}
        <button
          onClick={() => setCreatingManual(true)}
          className="inline-flex items-center gap-1.5 h-9 pl-3 pr-4 text-sm font-semibold bg-primary text-white rounded-lg shadow-sm shadow-primary/30 ring-1 ring-inset ring-white/10 hover:opacity-90 active:scale-[0.98] transition flex-shrink-0"
        >
          <Icon name={IconName.Plus} className="w-4 h-4" />
          Add Non-WSQ class
        </button>
      </div>

      {/* Summary: prominent all-time overview + compact selected-window detail */}
      <div className="space-y-3">
      {/* Year-to-date overview — independent of the window filter */}
      <div className="space-y-2.5">
        <div className="flex items-baseline gap-2">
          <h2 className="text-sm font-semibold text-on-surface">Overview</h2>
          <span className="text-xs text-on-surface-secondary">WSQ since 1 Jan {new Date().getFullYear()} + all non-WSQ · not affected by the window filter</span>
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
          <StatCard
            label="Total Amount"
            value={fmtCurrency(overview.totalAmount)}
            sub="Still to be paid"
            iconName={IconName.DollarSign}
            tone="violet"
          />
          <StatCard
            label="Total"
            value={String(overview.totalClasses)}
            sub="All classes"
            iconName={IconName.Analytics}
            tone="blue"
          />
          <StatCard
            label="Pending"
            value={String(overview.pendingCount)}
            sub={`Est. ${fmtCurrency(overview.pendingAmount)}`}
            iconName={IconName.Clock}
            tone="amber"
          />
          <StatCard
            label="Completed"
            value={String(overview.completedCount)}
            sub={`${fmtCurrency(overview.completedAmount)} paid`}
            iconName={IconName.CheckCircle}
            tone="green"
          />
          <StatCard
            label="Cancelled"
            value={String(overview.cancelledCount)}
            iconName={IconName.X}
            tone="rose"
          />
        </div>
      </div>

      {/* Selected-window stats — follow the month dropdown (compact, secondary) */}
      <div className="space-y-2.5">
        <div className="flex items-baseline gap-2">
          <h2 className="text-sm font-semibold text-on-surface">Selected window</h2>
          <span className="text-xs text-on-surface-secondary">
            {windowMode === 'month' ? `${monthLabel} (WSQ)` : `Last ${months} month${months === 1 ? '' : 's'} (WSQ)`} + all non-WSQ, within your active filters
          </span>
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-px rounded-xl border border-default bg-gray-200 dark:bg-slate-700 overflow-hidden shadow-sm">
          <CompactStat
            label="Total Amount"
            value={fmtCurrency(windowStats.totalAmount)}
            sub="Still to be paid"
            dot="bg-violet-500"
          />
          <CompactStat
            label="Total"
            value={String(windowStats.totalClasses)}
            sub="Classes in window"
            dot="bg-sky-500"
          />
          <CompactStat
            label="Pending"
            value={String(windowStats.pendingCount)}
            sub={`Est. ${fmtCurrency(windowStats.pendingAmount)}`}
            dot="bg-amber-500"
          />
          <CompactStat
            label="Completed"
            value={String(windowStats.completedCount)}
            sub={`${fmtCurrency(windowStats.completedAmount)} paid`}
            dot="bg-emerald-500"
          />
          <CompactStat
            label="Cancelled"
            value={String(windowStats.cancelledCount)}
            dot="bg-rose-500"
          />
        </div>
      </div>
      </div>

      <div className="bg-white dark:bg-slate-800 rounded-lg border border-default shadow-sm p-3 space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-wrap items-center gap-2">
            <FilterPill value="all" label="All" />
            <FilterPill value="pending" label="Pending" />
            <FilterPill value="completed" label="Completed" />
            <FilterPill value="cancelled" label="Cancelled" />
          </div>
          {/* Window (Month/Range) + refresh + view toggle — one control strip */}
          <div className="flex flex-wrap items-center gap-2">
          {/* Month vs rolling-range mode */}
          <div className="inline-flex h-8 rounded-md border border-default overflow-hidden text-xs font-medium">
            {(['month', 'range'] as const).map((m) => (
              <button
                key={m}
                onClick={() => setWindowMode(m)}
                className={`px-2.5 transition ${
                  windowMode === m
                    ? 'bg-primary text-white'
                    : 'bg-white dark:bg-slate-800 text-on-surface-secondary hover:bg-gray-50 dark:hover:bg-slate-700'
                }`}
              >
                {m === 'month' ? 'Month' : 'Range'}
              </button>
            ))}
          </div>

          {windowMode === 'month' ? (
            <div className="flex items-center h-8 border border-default rounded-md bg-white dark:bg-slate-800 overflow-hidden text-xs">
              <button onClick={() => shiftMonth(-1)} aria-label="Previous month" className="w-7 h-full flex items-center justify-center text-on-surface-secondary hover:bg-gray-50 dark:hover:bg-slate-700 text-base leading-none">‹</button>
              <span className="font-semibold min-w-[7rem] text-center px-1">{monthLabel}</span>
              <button
                onClick={() => shiftMonth(1)}
                disabled={month >= currentMonthStr}
                aria-label="Next month"
                className="w-7 h-full flex items-center justify-center text-on-surface-secondary hover:bg-gray-50 dark:hover:bg-slate-700 text-base leading-none disabled:opacity-30 disabled:cursor-not-allowed"
              >›</button>
            </div>
          ) : (
            <div className="flex items-center gap-1 h-8 pl-2.5 pr-1 border border-default rounded-md bg-white dark:bg-slate-800">
              <span className="text-[10px] uppercase tracking-wider text-on-surface-secondary font-medium whitespace-nowrap">Last</span>
              <select
                value={months}
                onChange={(e) => setMonths(Number(e.target.value))}
                aria-label="Window: within the last"
                className="h-7 bg-transparent pr-1 text-xs font-medium focus:outline-none cursor-pointer"
              >
                <option className={OPTION_CLASS} value={1}>1 month</option>
                <option className={OPTION_CLASS} value={2}>2 months</option>
                <option className={OPTION_CLASS} value={3}>3 months</option>
                <option className={OPTION_CLASS} value={6}>6 months</option>
                <option className={OPTION_CLASS} value={12}>12 months</option>
              </select>
            </div>
          )}
          {windowMode === 'month' && month !== currentMonthStr && (
            <button
              onClick={() => setMonth(currentMonthStr)}
              className="h-8 px-2.5 text-xs font-medium border border-default rounded-md hover:bg-gray-50 dark:hover:bg-slate-700 text-on-surface-secondary transition"
            >
              This month
            </button>
          )}
          <button
            onClick={() => load()}
            title="Refresh"
            aria-label="Refresh"
            className="inline-flex items-center justify-center h-8 w-8 border border-default rounded-md hover:bg-gray-50 dark:hover:bg-slate-700 text-on-surface-secondary transition"
          >
            <Icon name={IconName.Sync} className="w-4 h-4" />
          </button>

          <div className="inline-flex rounded-md border border-default overflow-hidden text-xs font-medium">
            <button
              type="button"
              onClick={() => { setGroupByTrainer(false); setExpandedTrainer(null); }}
              className={`inline-flex items-center gap-1.5 px-3 h-8 transition-colors ${
                !groupByTrainer
                  ? 'bg-primary text-white'
                  : 'bg-white dark:bg-slate-800 text-on-surface-secondary hover:bg-gray-50 dark:hover:bg-slate-700'
              }`}
            >
              <Icon name={IconName.Courses} className="w-3.5 h-3.5" />
              By Class
            </button>
            <button
              type="button"
              onClick={() => setGroupByTrainer(true)}
              className={`inline-flex items-center gap-1.5 px-3 h-8 border-l border-default transition-colors ${
                groupByTrainer
                  ? 'bg-primary text-white'
                  : 'bg-white dark:bg-slate-800 text-on-surface-secondary hover:bg-gray-50 dark:hover:bg-slate-700'
              }`}
            >
              <Icon name={IconName.Users} className="w-3.5 h-3.5" />
              By Trainer
            </button>
          </div>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <div className="relative flex-1 min-w-[15rem]">
            <Icon
              name={IconName.Search}
              className="w-4 h-4 absolute left-2.5 top-1/2 -translate-y-1/2 text-on-surface-secondary pointer-events-none"
            />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search trainer, course, run code or bill no…"
              className="w-full h-9 border border-default rounded-md pl-8 pr-2 text-sm bg-white dark:bg-slate-700/40 focus:outline-none focus:ring-2 focus:ring-primary/30"
            />
          </div>

          <select
            value={sourceFilter}
            onChange={(e) => setSourceFilter(e.target.value as SourceFilter)}
            aria-label="Filter by course type"
            className="h-9 border border-default rounded-md px-2 text-sm bg-white dark:bg-slate-700/40 focus:outline-none focus:ring-2 focus:ring-primary/30"
          >
            <option className={OPTION_CLASS} value="all">All types</option>
            <option className={OPTION_CLASS} value="wsq">WSQ only</option>
            <option className={OPTION_CLASS} value="manual">Non-WSQ only</option>
          </select>

          <select
            value={trainerFilter}
            onChange={(e) => setTrainerFilter(e.target.value)}
            aria-label="Filter by trainer"
            className="h-9 min-w-[11rem] max-w-[15rem] border border-default rounded-md px-2 text-sm bg-white dark:bg-slate-700/40 focus:outline-none focus:ring-2 focus:ring-primary/30"
          >
            <option className={OPTION_CLASS} value="all">All trainers</option>
            {trainerOptions.map((t) => (
              <option className={OPTION_CLASS} key={t.id} value={t.id}>{t.name}</option>
            ))}
          </select>

          <select
            value={classFilter}
            onChange={(e) => setClassFilter(e.target.value)}
            aria-label="Filter by class"
            className="h-9 min-w-[11rem] max-w-[18rem] border border-default rounded-md px-2 text-sm bg-white dark:bg-slate-700/40 focus:outline-none focus:ring-2 focus:ring-primary/30"
          >
            <option className={OPTION_CLASS} value="all">All classes</option>
            {classOptions.map((c) => (
              <option className={OPTION_CLASS} key={c.id} value={c.id}>{c.label}</option>
            ))}
          </select>

          <div
            className="flex items-center gap-1 h-9 border border-default rounded-md pl-2.5 pr-1 bg-white dark:bg-slate-700/40 text-sm"
            title="Filter by course start date — pick a start and end day to set a range"
          >
            <span className="text-on-surface-secondary text-xs whitespace-nowrap">Start date</span>
            <DateRangeCell
              compact
              value={startFrom && startTo ? `${startFrom}~${startTo}` : (startFrom || '')}
              onChange={(v) => {
                if (!v) { setStartFrom(''); setStartTo(''); }
                else if (v.includes('~')) { const [s, e] = v.split('~'); setStartFrom(s); setStartTo(e); }
                else { setStartFrom(v); setStartTo(v); }
              }}
              placeholder="Any date"
              emptyAsIcon
            />
          </div>

          {hasExtraFilters && (
            <button
              type="button"
              onClick={clearFilters}
              className="inline-flex items-center gap-1.5 h-9 px-3 text-sm border border-default rounded-md hover:bg-gray-50 dark:hover:bg-slate-700 text-on-surface-secondary"
            >
              <Icon name={IconName.X} className="w-3.5 h-3.5" />
              Clear
            </button>
          )}
        </div>
      </div>

      {error && (
        <div className="rounded-md border border-red-300 bg-red-50 dark:bg-red-900/20 text-red-800 dark:text-red-300 px-3 py-2 text-sm">
          {error}
        </div>
      )}

      <div className="overflow-x-auto bg-white dark:bg-slate-800 rounded-xl shadow-sm border border-default">
        <table className="min-w-full text-[11px]">
          <thead className="bg-gray-50 dark:bg-slate-900/40 text-left text-[11px] uppercase tracking-wider text-on-surface-secondary font-semibold border-b border-default">
            {groupByTrainer ? (
              <tr>
                <th className="px-3 py-2 whitespace-nowrap">Trainer</th>
                <th className="px-3 py-2 whitespace-nowrap text-right"># Classes</th>
                <th className="px-2 py-2 whitespace-nowrap text-right w-14"># Pax</th>
                <th className="px-2 py-2 whitespace-nowrap text-right">Est. Pay</th>
                <th className="px-2 py-2 whitespace-nowrap text-right">Act. Pay</th>
              </tr>
            ) : (
              <tr>
                <th className="px-3 py-2 whitespace-nowrap">Course</th>
                <th className="px-3 py-2 whitespace-nowrap">Course Code</th>
                <th className="px-3 py-2 whitespace-nowrap">Run ID</th>
                <th className="px-3 py-2 whitespace-nowrap">Trainer</th>
                <th className="px-3 py-2 whitespace-nowrap">Start Date</th>
                <th className="px-2 py-2 whitespace-nowrap text-right w-14"># Pax</th>
                <th className="px-3 py-2 whitespace-nowrap text-right">Course Fee</th>
                <th className="px-2 py-2 whitespace-nowrap text-right">Est. Pay</th>
                <th className="px-2 py-2 whitespace-nowrap text-right">Act. Pay</th>
                <th className="px-3 py-2 whitespace-nowrap">Status</th>
                <th className="px-3 py-2 whitespace-nowrap">Bill No</th>
                <th className="px-3 py-2 whitespace-nowrap">Payment Date</th>
                <th className="px-3 py-2 whitespace-nowrap">Remark</th>
              </tr>
            )}
          </thead>
          <tbody>
            {loading && <LoadingRow colSpan={groupByTrainer ? 5 : 13} label="Loading payouts…" />}
            {!loading && totalItems === 0 && (
              <tr>
                <td colSpan={groupByTrainer ? 5 : 13} className="px-3 py-12 text-center">
                  <div className="flex flex-col items-center gap-2 text-on-surface-secondary">
                    <Icon name={IconName.DollarSign} className="w-10 h-10 opacity-30" />
                    {rows.length === 0 ? (
                      <>
                        <p className="text-sm font-medium">No classes in this window</p>
                        <p className="text-xs">WSQ payouts appear automatically once a class is confirmed and has ended. Use “Add non-WSQ class” to add a non-funded class.</p>
                      </>
                    ) : (
                      <>
                        <p className="text-sm font-medium">No payouts match your filters</p>
                        <p className="text-xs">Try a different status or clear the search.</p>
                      </>
                    )}
                  </div>
                </td>
              </tr>
            )}

            {!loading && !groupByTrainer &&
              pageRows.map((r) => {
                const manual = isManual(r);
                return (
                <tr
                  key={r.id}
                  onClick={() => (manual ? setEditingManual(toManualClass(r)) : setEditing(r))}
                  title={manual ? 'Click to edit this non-WSQ class' : 'Click to edit this payout'}
                  className={`group border-t border-default transition-colors cursor-pointer ${
                    manual
                      ? `${NON_WSQ_ROW} ${NON_WSQ_ROW_HOVER}`
                      : 'even:bg-gray-50/40 dark:even:bg-slate-900/20 hover:bg-primary/5 dark:hover:bg-primary/10'
                  }`}
                >
                  <td
                    className={`px-3 py-2.5 max-w-[17rem] border-l-2 ${manual ? NON_WSQ_ACCENT : 'border-transparent group-hover:border-primary'}`}
                    title={r.course_title || ''}
                  >
                    <div className="flex items-center gap-1.5 min-w-0">
                      <span className="font-medium truncate" title={r.course_title || ''}>{r.course_title || '-'}</span>
                      {manual && <NonWsqTag />}
                    </div>
                  </td>
                  <td className="px-3 py-2.5 whitespace-nowrap font-mono text-on-surface-secondary">
                    {r.course_code || '-'}
                  </td>
                  <td className="px-3 py-2.5 whitespace-nowrap font-mono text-on-surface-secondary">
                    {r.course_run_code || '-'}
                  </td>
                  <td className="px-3 py-2.5 max-w-[9rem] truncate uppercase" title={r.trainer_name || ''}>
                    {r.trainer_name || '-'}
                  </td>
                  {(() => {
                    const label = r.class_dates
                      ? collapseMultiDates(parseMultiDates(r.class_dates))
                      : fmtDate(r.start_date);
                    return (
                      <td
                        className="px-3 py-2.5 max-w-[12rem] truncate text-on-surface-secondary"
                        title={label}
                      >
                        {label}
                      </td>
                    );
                  })()}
                  <td className="px-2 py-2.5 text-right tabular-nums">{r.num_learners}</td>
                  <td className="px-3 py-2.5 text-right tabular-nums">{fmtCurrency(r.course_fee)}</td>
                  <td className="px-2 py-2.5 text-right tabular-nums">{fmtCurrency(r.estimated_payout)}</td>
                  <td className={`px-2 py-2.5 text-right font-semibold tabular-nums ${r.actual_payout != null && r.actual_payout !== '' ? 'text-green-600 dark:text-green-400' : ''}`}>{fmtCurrency(r.actual_payout)}</td>
                  <td className="px-3 py-2.5"><StatusBadge status={r.status} /></td>
                  <td className="px-3 py-2.5 whitespace-nowrap"><BillNo value={r.bill_no} /></td>
                  <td className="px-3 py-2.5 whitespace-nowrap text-on-surface-secondary">{fmtDate(r.payment_date)}</td>
                  <td className="px-3 py-2.5 max-w-[14rem] truncate text-on-surface-secondary" title={r.remark || ''}>
                    {r.remark || '-'}
                  </td>
                </tr>
                );
              })}

            {!loading && groupByTrainer &&
              pageGroups.map((g) => {
                const manualCount = g.rows.filter(isManual).length;
                const wsqCount = g.rows.length - manualCount;
                const open = expandedTrainer === g.key;
                const busy = bulkSaving === g.key;
                const allCompleted = g.rows.length > 0 && g.rows.every((r) => r.status === 'completed');
                return (
                <React.Fragment key={g.key}>
                <tr
                  // Single-open accordion: picking another trainer collapses this one.
                  onClick={() => setExpandedTrainer(open ? null : g.key)}
                  title={open ? 'Hide classes' : 'Show classes'}
                  className={`group border-t border-default transition-colors cursor-pointer ${
                    open
                      ? 'bg-primary/5 dark:bg-primary/10'
                      : 'even:bg-gray-50/40 dark:even:bg-slate-900/20 hover:bg-primary/5 dark:hover:bg-primary/10'
                  }`}
                >
                  <td className={`px-3 py-2.5 font-medium max-w-[18rem] border-l-2 ${open ? 'border-primary' : 'border-transparent group-hover:border-primary'}`}>
                    <div className="flex items-center gap-2">
                      <Icon
                        name={IconName.ChevronDown}
                        className={`w-4 h-4 flex-shrink-0 transition-transform ${
                          open ? 'text-primary' : '-rotate-90 text-on-surface-secondary group-hover:text-primary'
                        }`}
                      />
                      <span className="truncate uppercase" title={g.trainer_name}>{g.trainer_name}</span>
                      {manualCount > 0 && (
                        <NonWsqTag title={`${manualCount} non-WSQ class${manualCount === 1 ? '' : 'es'}`}>
                          {manualCount} Non-WSQ
                        </NonWsqTag>
                      )}
                    </div>
                  </td>
                  <td className="px-3 py-2.5 text-right tabular-nums">
                    {g.rows.length}
                    {manualCount > 0 && (
                      <div className="text-[10px] font-normal text-on-surface-secondary">
                        {wsqCount} WSQ · {manualCount} non-WSQ
                      </div>
                    )}
                  </td>
                  <td className="px-2 py-2.5 text-right tabular-nums">{g.learners}</td>
                  <td className="px-2 py-2.5 text-right tabular-nums">{fmtCurrency(g.estimated)}</td>
                  <td className="px-2 py-2.5 text-right font-semibold text-primary tabular-nums">{fmtCurrency(g.actual)}</td>
                </tr>

                {open && (
                  <tr className="bg-gray-50/60 dark:bg-slate-900/40">
                    <td colSpan={5} className="p-0 border-l-2 border-primary">
                      <div className="px-4 py-3">
                        <div className="flex items-center justify-between gap-2 mb-2">
                          <p className="text-xs text-on-surface-secondary">
                            Click a class to edit its payout.
                          </p>
                          <button
                            type="button"
                            onClick={(e) => { e.stopPropagation(); bulkSetPaid(g.key, g.rows, !allCompleted); }}
                            disabled={bulkSaving !== null}
                            className="inline-flex items-center gap-1.5 px-2.5 py-1 text-xs border border-default rounded-md bg-white dark:bg-slate-800 hover:bg-gray-50 dark:hover:bg-slate-700 text-on-surface disabled:opacity-50"
                          >
                            {busy ? (
                              <>
                                <Icon name={IconName.Spinner} className="w-3.5 h-3.5 animate-spin" />
                                Saving…
                              </>
                            ) : allCompleted ? (
                              <>
                                <Icon name={IconName.Clock} className="w-3.5 h-3.5 text-amber-600 dark:text-amber-400" />
                                Unmark all as paid
                              </>
                            ) : (
                              <>
                                <Icon name={IconName.CheckCircle} className="w-3.5 h-3.5 text-green-600 dark:text-green-400" />
                                Mark all as paid
                              </>
                            )}
                          </button>
                        </div>

                        {bulkError && !busy && (
                          <div className="mb-2 text-xs text-red-700 dark:text-red-300 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800/50 rounded-md px-2.5 py-1.5">
                            {bulkError}
                          </div>
                        )}

                        <div className="overflow-x-auto rounded-lg border border-default bg-white dark:bg-slate-800">
                          <table className="min-w-full text-[11px]">
                            <thead className="bg-gray-100 dark:bg-slate-700 text-left text-[11px] uppercase tracking-wider text-on-surface-secondary">
                              <tr>
                                <th className="px-3 py-2 whitespace-nowrap">Course</th>
                                <th className="px-2 py-2 whitespace-nowrap">Course Code</th>
                                <th className="px-2 py-2 whitespace-nowrap">Run ID</th>
                                <th className="px-2 py-2 whitespace-nowrap">Dates</th>
                                <th className="px-2 py-2 whitespace-nowrap text-right">Pax</th>
                                <th className="px-2 py-2 whitespace-nowrap text-right">Course Fee</th>
                                <th className="px-2 py-2 whitespace-nowrap text-right">Est. Pay</th>
                                <th className="px-2 py-2 whitespace-nowrap text-right">Act. Pay</th>
                                <th className="px-2 py-2 whitespace-nowrap">Status</th>
                                <th className="px-2 py-2 whitespace-nowrap">Bill No</th>
                                <th className="px-2 py-2 whitespace-nowrap">Payment Date</th>
                                <th className="px-2 py-2 whitespace-nowrap">Remark</th>
                              </tr>
                            </thead>
                            <tbody>
                              {g.rows.map((r) => {
                                const manual = isManual(r);
                                const dateLabel = r.class_dates
                                  ? collapseMultiDates(parseMultiDates(r.class_dates))
                                  : fmtDate(r.start_date);
                                const hasActual =
                                  r.actual_payout !== null && r.actual_payout !== undefined && r.actual_payout !== '';
                                return (
                                  <tr
                                    key={r.id}
                                    // Inert mid-bulk-save: opening the editor then would let it
                                    // write the same row the loop is still working through.
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      if (busy) return;
                                      if (manual) setEditingManual(toManualClass(r));
                                      else setEditing(r);
                                    }}
                                    title={
                                      busy
                                        ? 'Saving…'
                                        : manual
                                        ? 'Click to edit this non-WSQ class'
                                        : 'Click to edit this payout'
                                    }
                                    className={`group/row border-t border-default transition-colors ${
                                      busy ? 'cursor-wait opacity-60' : 'cursor-pointer'
                                    } ${
                                      manual
                                        ? `${NON_WSQ_ROW} ${!busy ? NON_WSQ_ROW_HOVER : ''}`
                                        : `even:bg-gray-50/50 dark:even:bg-slate-700/20 ${
                                            !busy ? 'hover:bg-primary/5 dark:hover:bg-primary/10' : ''
                                          }`
                                    }`}
                                  >
                                    <td
                                      className={`px-3 py-2.5 max-w-[18rem] border-l-2 ${
                                        manual ? NON_WSQ_ACCENT : 'border-transparent group-hover/row:border-primary'
                                      }`}
                                      title={r.course_title || ''}
                                    >
                                      <div className="flex items-center gap-1.5 min-w-0">
                                        <span className="font-medium truncate">{r.course_title || '-'}</span>
                                        {manual && <NonWsqTag />}
                                        <Icon
                                          name={IconName.Edit}
                                          className="w-3.5 h-3.5 flex-shrink-0 text-primary opacity-0 group-hover/row:opacity-100 transition-opacity"
                                        />
                                      </div>
                                    </td>
                                    <td className="px-2 py-2.5 whitespace-nowrap font-mono text-on-surface-secondary">
                                      {r.course_code || '-'}
                                    </td>
                                    <td className="px-2 py-2.5 whitespace-nowrap font-mono text-on-surface-secondary">
                                      {r.course_run_code || '-'}
                                    </td>
                                    <td className="px-2 py-2.5 max-w-[12rem] truncate text-on-surface-secondary" title={dateLabel}>
                                      {dateLabel}
                                    </td>
                                    <td className="px-2 py-2.5 text-right tabular-nums">{r.num_learners}</td>
                                    <td className="px-2 py-2.5 text-right tabular-nums">{fmtCurrency(r.course_fee)}</td>
                                    <td className="px-2 py-2.5 text-right tabular-nums">{fmtCurrency(r.estimated_payout)}</td>
                                    <td className={`px-2 py-2.5 text-right font-semibold tabular-nums ${hasActual ? 'text-green-600 dark:text-green-400' : ''}`}>
                                      {fmtCurrency(r.actual_payout)}
                                    </td>
                                    <td className="px-2 py-2.5"><StatusBadge status={r.status} /></td>
                                    <td className="px-2 py-2.5 whitespace-nowrap"><BillNo value={r.bill_no} /></td>
                                    <td className="px-2 py-2.5 whitespace-nowrap text-on-surface-secondary">{fmtDate(r.payment_date)}</td>
                                    <td className="px-2 py-2.5 max-w-[12rem] truncate text-on-surface-secondary" title={r.remark || ''}>
                                      {r.remark || '-'}
                                    </td>
                                  </tr>
                                );
                              })}
                            </tbody>
                          </table>
                        </div>
                      </div>
                    </td>
                  </tr>
                )}
                </React.Fragment>
                );
              })}
          </tbody>
        </table>

        {!loading && totalItems > 0 && (
          <div className="flex flex-wrap items-center justify-between gap-3 px-3 py-2 border-t border-default bg-gray-50 dark:bg-slate-700/30 text-xs text-on-surface-secondary">
            <div>
              Showing <span className="font-medium text-on-surface">{rangeStart}</span>–
              <span className="font-medium text-on-surface">{rangeEnd}</span> of{' '}
              <span className="font-medium text-on-surface">{totalItems}</span>
              {groupByTrainer ? ' trainers' : ''}
            </div>
            <div className="flex items-center gap-1">
              <button
                type="button"
                onClick={() => setPage((p) => Math.max(0, p - 1))}
                disabled={safePage === 0}
                className="inline-flex items-center gap-1 px-2 py-1 border border-default rounded-md hover:bg-white dark:hover:bg-slate-700 disabled:opacity-40 disabled:cursor-not-allowed"
              >
                <Icon name={IconName.Back} className="w-3.5 h-3.5" />
                Previous
              </button>
              <span className="px-2">
                Page <span className="font-medium text-on-surface">{safePage + 1}</span> of{' '}
                <span className="font-medium text-on-surface">{totalPages}</span>
              </span>
              <button
                type="button"
                onClick={() => setPage((p) => Math.min(totalPages - 1, p + 1))}
                disabled={safePage >= totalPages - 1}
                className="inline-flex items-center gap-1 px-2 py-1 border border-default rounded-md hover:bg-white dark:hover:bg-slate-700 disabled:opacity-40 disabled:cursor-not-allowed"
              >
                Next
                <Icon name={IconName.Back} className="w-3.5 h-3.5 rotate-180" />
              </button>
            </div>
          </div>
        )}
      </div>

      {editing && (
        <PayoutEditDialog
          row={editing}
          tiers={tiers}
          onClose={() => setEditing(null)}
          onSaved={(updated) => {
            setRows((rs) => rs.map((r) => (r.id === updated.id ? { ...r, ...updated } : r)));
            setEditing(null);
            load(true); // re-sync Overview cards after the edit (silent, no flash)
          }}
        />
      )}

      {(creatingManual || editingManual) && (
        <ManualClassDialog
          initial={editingManual}
          tiers={tiers}
          onClose={() => {
            setCreatingManual(false);
            setEditingManual(null);
          }}
          onSaved={() => {
            setCreatingManual(false);
            setEditingManual(null);
            load(true); // re-fetch so the merged list + overview reflect the change
          }}
          onDeleted={() => {
            setEditingManual(null);
            load(true);
          }}
        />
      )}

    </div>
  );
};

export default PayoutListView;
