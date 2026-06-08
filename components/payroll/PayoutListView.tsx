import React, { useEffect, useMemo, useState, useCallback } from 'react';
import { Icon, IconName } from '../ui/Icon';
import PayoutEditDialog, { PayoutRow } from './PayoutEditDialog';
import TrainerPayoutDialog from './TrainerPayoutDialog';
import { PayoutTier } from '@lib/payroll/calculate';
import { authHeader } from '@lib/auth/authHeader';
import { fmtDate } from '@lib/payroll/formatDate';
import DateRangeCell from '../ui/DateRangeCell';

const fmtCurrency = (n: number | string | null | undefined) => {
  if (n === null || n === undefined || n === '') return '-';
  const v = typeof n === 'string' ? Number(n) : n;
  if (Number.isNaN(v)) return '-';
  return v.toLocaleString('en-SG', { style: 'currency', currency: 'SGD' });
};

const STATUS_LABEL: Record<string, string> = {
  pending: 'Pending',
  completed: 'Completed',
  cancelled: 'Cancelled',
};

const StatusBadge: React.FC<{ status: string }> = ({ status }) => {
  const cls =
    status === 'completed'
      ? 'bg-green-100 text-green-700 ring-green-600/20 dark:bg-green-900/40 dark:text-green-300'
      : status === 'cancelled'
      ? 'bg-gray-100 text-gray-600 ring-gray-500/20 dark:bg-slate-700 dark:text-gray-300'
      : 'bg-amber-100 text-amber-700 ring-amber-600/20 dark:bg-amber-900/40 dark:text-amber-300';
  const dot =
    status === 'completed' ? 'bg-green-500' : status === 'cancelled' ? 'bg-gray-400' : 'bg-amber-500';
  return (
    <span className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-xs font-medium ring-1 ring-inset ${cls}`}>
      <span className={`w-1.5 h-1.5 rounded-full ${dot}`} />
      {STATUS_LABEL[status] || status}
    </span>
  );
};

type StatusFilter = 'all' | 'pending' | 'completed' | 'cancelled';

const StatCard: React.FC<{
  label: string;
  value: string;
  sub?: string;
  iconName: IconName;
  tone?: 'amber' | 'green' | 'blue' | 'gray' | 'rose' | 'violet';
}> = ({ label, value, sub, iconName, tone = 'blue' }) => {
  const tones = {
    amber: {
      icon: 'bg-amber-100 text-amber-600 ring-amber-500/20 dark:bg-amber-500/15 dark:text-amber-400',
      value: 'text-amber-700 dark:text-amber-300',
      glow: 'from-amber-500/[0.10]',
    },
    green: {
      icon: 'bg-green-100 text-green-600 ring-green-500/20 dark:bg-green-500/15 dark:text-green-400',
      value: 'text-green-700 dark:text-green-300',
      glow: 'from-green-500/[0.10]',
    },
    blue: {
      icon: 'bg-sky-100 text-sky-600 ring-sky-500/20 dark:bg-sky-500/15 dark:text-sky-400',
      value: 'text-sky-700 dark:text-sky-300',
      glow: 'from-sky-500/[0.10]',
    },
    rose: {
      icon: 'bg-rose-100 text-rose-600 ring-rose-500/20 dark:bg-rose-500/15 dark:text-rose-400',
      value: 'text-rose-700 dark:text-rose-300',
      glow: 'from-rose-500/[0.10]',
    },
    violet: {
      icon: 'bg-violet-100 text-violet-600 ring-violet-500/20 dark:bg-violet-500/15 dark:text-violet-400',
      value: 'text-violet-700 dark:text-violet-300',
      glow: 'from-violet-500/[0.12]',
    },
    gray: {
      icon: 'bg-gray-100 text-gray-500 ring-gray-400/20 dark:bg-slate-600/30 dark:text-gray-400',
      value: 'text-gray-600 dark:text-gray-300',
      glow: 'from-gray-500/[0.06]',
    },
  }[tone];
  return (
    <div className={`relative overflow-hidden rounded-xl border border-default bg-gradient-to-br ${tones.glow} to-transparent bg-white dark:bg-slate-800/80 p-4 shadow-sm transition-shadow hover:shadow-md`}>
      <div className="flex items-center gap-3">
        <div className={`w-11 h-11 rounded-xl flex items-center justify-center flex-shrink-0 ring-1 ring-inset ${tones.icon}`}>
          <Icon name={iconName} className="w-5 h-5" />
        </div>
        <div className="min-w-0">
          <div className="text-[11px] uppercase tracking-wider text-on-surface-secondary font-semibold">{label}</div>
          <div className={`text-2xl font-bold leading-tight truncate tabular-nums ${tones.value}`} title={value}>{value}</div>
          {sub && <div className="text-[11px] text-on-surface-secondary mt-0.5">{sub}</div>}
        </div>
      </div>
      <Icon name={iconName} className="absolute -right-3 -bottom-3 w-20 h-20 opacity-[0.04] pointer-events-none" />
    </div>
  );
};

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

const LoadingRow: React.FC<{ colSpan: number }> = ({ colSpan }) => (
  <tr>
    <td colSpan={colSpan} className="px-3 py-16">
      <div className="flex flex-col items-center justify-center gap-3 text-on-surface-secondary">
        <div className="relative">
          <div className="w-10 h-10 rounded-full border-2 border-primary/20" />
          <div className="absolute inset-0 w-10 h-10 rounded-full border-2 border-transparent border-t-primary animate-spin" />
        </div>
        <p className="text-sm font-medium">Loading payouts…</p>
      </div>
    </td>
  </tr>
);

const PAGE_SIZE = 20;

// Native <option> elements ignore the parent's theme, so set an explicit
// background/text so the open dropdown popup matches the dark UI (no grey).
const OPTION_CLASS = 'bg-white text-gray-900 dark:bg-slate-800 dark:text-white';

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
  const [months, setMonths] = useState(2);
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');
  const [search, setSearch] = useState('');
  const [trainerFilter, setTrainerFilter] = useState<string>('all');
  const [classFilter, setClassFilter] = useState<string>('all');
  const [startFrom, setStartFrom] = useState<string>('');
  const [startTo, setStartTo] = useState<string>('');
  const [groupByTrainer, setGroupByTrainer] = useState(false);
  const [trainerModal, setTrainerModal] = useState<{ name: string; ids: Set<string> } | null>(null);
  const [page, setPage] = useState(0);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const r = await fetch(`/api/payroll/payouts?months=${months}`, {
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
      setLoading(false);
    }
  }, [months]);

  useEffect(() => {
    load();
  }, [load]);

  // Dropdown option lists, built from all loaded rows so they stay stable across filtering.
  const trainerOptions = useMemo(() => {
    const map = new Map<string, string>();
    rows.forEach((r) => {
      const id = r.trainer_id || `name:${r.trainer_name || ''}`;
      if (!map.has(id)) map.set(id, r.trainer_name || '(Unnamed trainer)');
    });
    return Array.from(map.entries())
      .map(([id, name]) => ({ id, name }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [rows]);

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

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    const from = startFrom || null;
    const to = startTo || null;
    return rows.filter((r) => {
      if (statusFilter !== 'all' && r.status !== statusFilter) return false;
      if (trainerFilter !== 'all') {
        const id = r.trainer_id || `name:${r.trainer_name || ''}`;
        if (id !== trainerFilter) return false;
      }
      if (classFilter !== 'all' && r.course_run_id !== classFilter) return false;
      if (from || to) {
        const sd = r.start_date ? r.start_date.slice(0, 10) : null;
        if (!sd) return false;
        if (from && sd < from) return false;
        if (to && sd > to) return false;
      }
      if (!q) return true;
      return [r.trainer_name, r.course_title, r.course_code, r.course_run_code]
        .filter(Boolean)
        .some((v) => String(v).toLowerCase().includes(q));
    });
  }, [rows, statusFilter, search, trainerFilter, classFilter, startFrom, startTo]);

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
      const key = r.trainer_id || `name:${r.trainer_name || ''}`;
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
  }, [filtered]);

  // Rows for the open trainer modal. Membership is fixed to the ids captured at open
  // time (so changing a class's status mid-edit can't make it vanish), but the data is
  // pulled live from `rows` so edits/totals stay current.
  const trainerModalRows = useMemo(
    () => (trainerModal ? rows.filter((r) => trainerModal.ids.has(r.id)) : []),
    [trainerModal, rows]
  );

  const hasExtraFilters =
    trainerFilter !== 'all' ||
    classFilter !== 'all' ||
    startFrom !== '' ||
    startTo !== '' ||
    search.trim() !== '';

  const clearFilters = useCallback(() => {
    setTrainerFilter('all');
    setClassFilter('all');
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
  }, [statusFilter, search, months, trainerFilter, classFilter, startFrom, startTo, groupByTrainer]);

  // Close the trainer modal if none of its classes remain (e.g. after a data reload).
  useEffect(() => {
    if (trainerModal && trainerModalRows.length === 0) setTrainerModal(null);
  }, [trainerModal, trainerModalRows.length]);

  // Windowed stats for the "Selected window" card row — derived from the loaded rows
  // (which the server already scoped to the chosen month window).
  const windowStats = useMemo(() => {
    const sum = (xs: PayoutRow[], key: 'actual_payout' | 'estimated_payout') =>
      xs.reduce((acc, r) => {
        const v = Number(r[key] ?? 0);
        return acc + (Number.isFinite(v) ? v : 0);
      }, 0);
    const pending = rows.filter((r) => r.status === 'pending');
    const completed = rows.filter((r) => r.status === 'completed');
    const cancelled = rows.filter((r) => r.status === 'cancelled');
    const pendingAmount = sum(pending, 'estimated_payout');
    return {
      totalAmount: pendingAmount, // outstanding still owed, within the window
      totalClasses: rows.length,
      pendingCount: pending.length,
      pendingAmount,
      completedCount: completed.length,
      completedAmount: sum(completed, 'actual_payout'),
      cancelledCount: cancelled.length,
    };
  }, [rows]);

  const counts = useMemo(() => {
    const c = { all: rows.length, pending: 0, completed: 0, cancelled: 0 } as Record<StatusFilter, number>;
    rows.forEach((r) => {
      if (r.status === 'pending') c.pending++;
      else if (r.status === 'completed') c.completed++;
      else if (r.status === 'cancelled') c.cancelled++;
    });
    return c;
  }, [rows]);

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
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="w-11 h-11 rounded-xl bg-gradient-to-br from-primary to-primary/60 flex items-center justify-center text-white shadow-lg shadow-primary/20 flex-shrink-0">
            <Icon name={IconName.DollarSign} className="w-6 h-6" />
          </div>
          <div>
            <h1 className="text-2xl font-bold leading-tight">Trainer Payouts</h1>
            <p className="text-sm text-on-surface-secondary mt-0.5">
              Set each trainer&apos;s actual payout and mark it as paid.
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <label className="text-xs uppercase tracking-wider text-on-surface-secondary font-medium">Within the last</label>
          <select
            value={months}
            onChange={(e) => setMonths(Number(e.target.value))}
            className="h-9 border border-default rounded-lg px-2.5 text-sm bg-white dark:bg-slate-800 focus:outline-none focus:ring-2 focus:ring-primary/30"
          >
            <option className={OPTION_CLASS} value={1}>1 month</option>
            <option className={OPTION_CLASS} value={2}>2 months</option>
            <option className={OPTION_CLASS} value={3}>3 months</option>
            <option className={OPTION_CLASS} value={6}>6 months</option>
            <option className={OPTION_CLASS} value={12}>12 months</option>
          </select>
          <button
            onClick={load}
            className="inline-flex items-center gap-1.5 h-9 px-3.5 text-sm font-medium bg-primary text-white rounded-lg shadow-sm shadow-primary/20 hover:opacity-90 active:scale-[0.98] transition"
          >
            <Icon name={IconName.Sync} className="w-4 h-4" />
            Refresh
          </button>
        </div>
      </div>

      {/* Summary: prominent all-time overview + compact selected-window detail */}
      <div className="space-y-3">
      {/* All-time overview — independent of the window filter */}
      <div className="space-y-2.5">
        <div className="flex items-baseline gap-2">
          <h2 className="text-sm font-semibold text-on-surface">Overview</h2>
          <span className="text-xs text-on-surface-secondary">All-time · not affected by the window filter</span>
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
            Last {months} month{months === 1 ? '' : 's'} · matches the list below
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
          <div className="inline-flex rounded-md border border-default overflow-hidden text-xs font-medium">
            <button
              type="button"
              onClick={() => { setGroupByTrainer(false); setTrainerModal(null); }}
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
              placeholder="Search trainer, course or run code…"
              className="w-full h-9 border border-default rounded-md pl-8 pr-2 text-sm bg-white dark:bg-slate-700/40 focus:outline-none focus:ring-2 focus:ring-primary/30"
            />
          </div>

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
        <table className="min-w-full text-sm">
          <thead className="bg-gray-50 dark:bg-slate-900/40 text-left text-[11px] uppercase tracking-wider text-on-surface-secondary font-semibold border-b border-default">
            {groupByTrainer ? (
              <tr>
                <th className="px-3 py-2 whitespace-nowrap">Trainer</th>
                <th className="px-3 py-2 whitespace-nowrap text-right"># Classes</th>
                <th className="px-3 py-2 whitespace-nowrap text-right"># Learners</th>
                <th className="px-3 py-2 whitespace-nowrap text-right">Est. Payout</th>
                <th className="px-3 py-2 whitespace-nowrap text-right">Actual Payout</th>
              </tr>
            ) : (
              <tr>
                <th className="px-3 py-2 whitespace-nowrap">Course</th>
                <th className="px-3 py-2 whitespace-nowrap">Trainer</th>
                <th className="px-3 py-2 whitespace-nowrap">Start Date</th>
                <th className="px-3 py-2 whitespace-nowrap text-right"># Learners</th>
                <th className="px-3 py-2 whitespace-nowrap text-right">Course Fee</th>
                <th className="px-3 py-2 whitespace-nowrap text-right">Est. Payout</th>
                <th className="px-3 py-2 whitespace-nowrap text-right">Actual Payout</th>
                <th className="px-3 py-2 whitespace-nowrap">Status</th>
                <th className="px-3 py-2 whitespace-nowrap">Payment Date</th>
                <th className="px-3 py-2 whitespace-nowrap">Remark</th>
              </tr>
            )}
          </thead>
          <tbody>
            {loading && <LoadingRow colSpan={groupByTrainer ? 5 : 10} />}
            {!loading && totalItems === 0 && (
              <tr>
                <td colSpan={groupByTrainer ? 5 : 10} className="px-3 py-12 text-center">
                  <div className="flex flex-col items-center gap-2 text-on-surface-secondary">
                    <Icon name={IconName.DollarSign} className="w-10 h-10 opacity-30" />
                    {rows.length === 0 ? (
                      <>
                        <p className="text-sm font-medium">No completed classes in this window</p>
                        <p className="text-xs">Payouts appear automatically once a class ends.</p>
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
              pageRows.map((r) => (
                <tr
                  key={r.id}
                  onClick={() => setEditing(r)}
                  title="Click to edit this payout"
                  className="group border-t border-default even:bg-gray-50/40 dark:even:bg-slate-900/20 hover:bg-primary/5 dark:hover:bg-primary/10 transition-colors cursor-pointer"
                >
                  <td className="px-3 py-2.5 max-w-[20rem] border-l-2 border-transparent group-hover:border-primary">
                    <div className="font-medium truncate" title={r.course_title || ''}>{r.course_title || '-'}</div>
                    <div className="text-[11px] text-on-surface-secondary font-mono truncate">
                      {r.course_code || '-'} · {r.course_run_code || '-'}
                    </div>
                  </td>
                  <td className="px-3 py-2.5 max-w-[14rem] truncate uppercase" title={r.trainer_name || ''}>
                    {r.trainer_name || '-'}
                  </td>
                  <td className="px-3 py-2.5 whitespace-nowrap text-on-surface-secondary">{fmtDate(r.start_date)}</td>
                  <td className="px-3 py-2.5 text-right tabular-nums">{r.num_learners}</td>
                  <td className="px-3 py-2.5 text-right tabular-nums">{fmtCurrency(r.course_fee)}</td>
                  <td className="px-3 py-2.5 text-right tabular-nums">{fmtCurrency(r.estimated_payout)}</td>
                  <td className={`px-3 py-2.5 text-right font-semibold tabular-nums ${r.actual_payout != null && r.actual_payout !== '' ? 'text-green-600 dark:text-green-400' : ''}`}>{fmtCurrency(r.actual_payout)}</td>
                  <td className="px-3 py-2.5"><StatusBadge status={r.status} /></td>
                  <td className="px-3 py-2.5 whitespace-nowrap text-on-surface-secondary">{fmtDate(r.payment_date)}</td>
                  <td className="px-3 py-2.5 max-w-[14rem] truncate text-on-surface-secondary" title={r.remark || ''}>
                    {r.remark || '-'}
                  </td>
                </tr>
              ))}

            {!loading && groupByTrainer &&
              pageGroups.map((g) => (
                <tr
                  key={g.key}
                  onClick={() => setTrainerModal({ name: g.trainer_name, ids: new Set(g.rows.map((r) => r.id)) })}
                  title="View consolidated payouts & edit"
                  className="group border-t border-default even:bg-gray-50/40 dark:even:bg-slate-900/20 hover:bg-primary/5 dark:hover:bg-primary/10 transition-colors cursor-pointer"
                >
                  <td className="px-3 py-2.5 font-medium max-w-[18rem] border-l-2 border-transparent group-hover:border-primary">
                    <div className="flex items-center gap-2">
                      <Icon
                        name={IconName.ChevronDown}
                        className="w-4 h-4 flex-shrink-0 -rotate-90 text-on-surface-secondary transition-colors group-hover:text-primary"
                      />
                      <span className="truncate uppercase" title={g.trainer_name}>{g.trainer_name}</span>
                    </div>
                  </td>
                  <td className="px-3 py-2.5 text-right tabular-nums">{g.rows.length}</td>
                  <td className="px-3 py-2.5 text-right tabular-nums">{g.learners}</td>
                  <td className="px-3 py-2.5 text-right tabular-nums">{fmtCurrency(g.estimated)}</td>
                  <td className="px-3 py-2.5 text-right font-semibold text-primary tabular-nums">{fmtCurrency(g.actual)}</td>
                </tr>
              ))}
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

      {trainerModal && trainerModalRows.length > 0 && (
        <TrainerPayoutDialog
          trainerName={trainerModal.name}
          rows={trainerModalRows}
          onClose={() => setTrainerModal(null)}
          onSaved={(updated) =>
            setRows((rs) => rs.map((r) => (r.id === updated.id ? { ...r, ...updated } : r)))
          }
        />
      )}

      {editing && (
        <PayoutEditDialog
          row={editing}
          tiers={tiers}
          onClose={() => setEditing(null)}
          onSaved={(updated) => {
            setRows((rs) => rs.map((r) => (r.id === updated.id ? { ...r, ...updated } : r)));
            setEditing(null);
          }}
        />
      )}

    </div>
  );
};

export default PayoutListView;
