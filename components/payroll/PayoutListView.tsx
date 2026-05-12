import React, { useEffect, useMemo, useState, useCallback } from 'react';
import { Icon, IconName } from '../ui/Icon';
import PayoutEditDialog, { PayoutRow } from './PayoutEditDialog';
import { authHeader } from '@lib/auth/authHeader';
import { fmtDate } from '@lib/payroll/formatDate';

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
  tone?: 'amber' | 'green' | 'blue';
}> = ({ label, value, sub, iconName, tone = 'blue' }) => {
  const toneClasses =
    tone === 'amber'
      ? 'bg-amber-50 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300'
      : tone === 'green'
      ? 'bg-green-50 text-green-700 dark:bg-green-900/30 dark:text-green-300'
      : 'bg-blue-50 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300';
  return (
    <div className="bg-white dark:bg-slate-800 rounded-lg shadow-sm border border-default p-4 flex items-center gap-3">
      <div className={`w-10 h-10 rounded-lg flex items-center justify-center flex-shrink-0 ${toneClasses}`}>
        <Icon name={iconName} className="w-5 h-5" />
      </div>
      <div className="min-w-0">
        <div className="text-xs uppercase tracking-wider text-on-surface-secondary font-medium">{label}</div>
        <div className="text-lg font-bold leading-tight truncate" title={value}>{value}</div>
        {sub && <div className="text-[11px] text-on-surface-secondary">{sub}</div>}
      </div>
    </div>
  );
};

const LoadingRow: React.FC = () => (
  <tr>
    <td colSpan={10} className="px-3 py-16">
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

const PayoutListView: React.FC = () => {
  const [rows, setRows] = useState<PayoutRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<PayoutRow | null>(null);
  const [months, setMonths] = useState(2);
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');
  const [search, setSearch] = useState('');
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
    } catch (e: any) {
      setError(e?.message || 'Failed to load');
    } finally {
      setLoading(false);
    }
  }, [months]);

  useEffect(() => {
    load();
  }, [load]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return rows.filter((r) => {
      if (statusFilter !== 'all' && r.status !== statusFilter) return false;
      if (!q) return true;
      return [r.trainer_name, r.course_title, r.course_code, r.course_run_code]
        .filter(Boolean)
        .some((v) => String(v).toLowerCase().includes(q));
    });
  }, [rows, statusFilter, search]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const safePage = Math.min(page, totalPages - 1);
  const pageRows = useMemo(
    () => filtered.slice(safePage * PAGE_SIZE, safePage * PAGE_SIZE + PAGE_SIZE),
    [filtered, safePage]
  );
  const rangeStart = filtered.length === 0 ? 0 : safePage * PAGE_SIZE + 1;
  const rangeEnd = Math.min(filtered.length, safePage * PAGE_SIZE + PAGE_SIZE);

  useEffect(() => {
    setPage(0);
  }, [statusFilter, search, months]);

  const stats = useMemo(() => {
    const sum = (xs: PayoutRow[], key: 'actual_payout' | 'estimated_payout') =>
      xs.reduce((acc, r) => {
        const v = Number(r[key] ?? 0);
        return acc + (Number.isFinite(v) ? v : 0);
      }, 0);
    const pending = rows.filter((r) => r.status === 'pending');
    const completed = rows.filter((r) => r.status === 'completed');
    return {
      pendingCount: pending.length,
      pendingAmount: sum(pending, 'estimated_payout'),
      completedCount: completed.length,
      completedAmount: sum(completed, 'actual_payout'),
      total: rows.length,
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
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <Icon name={IconName.DollarSign} className="w-6 h-6 text-primary" />
            Trainer Payouts
          </h1>
          <p className="text-sm text-on-surface-secondary mt-1">
            Completed classes in the last {months} month{months === 1 ? '' : 's'}. Edit a row to set the actual payout and mark it paid.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <label className="text-sm text-on-surface-secondary">Window:</label>
          <select
            value={months}
            onChange={(e) => setMonths(Number(e.target.value))}
            className="border border-default rounded-md px-2 py-1 text-sm bg-white dark:bg-slate-800"
          >
            <option value={1}>1 month</option>
            <option value={2}>2 months</option>
            <option value={3}>3 months</option>
            <option value={6}>6 months</option>
            <option value={12}>12 months</option>
          </select>
          <button
            onClick={load}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm bg-primary text-white rounded-md hover:opacity-90"
          >
            <Icon name={IconName.Sync} className="w-4 h-4" />
            Refresh
          </button>
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <StatCard
          label="Pending"
          value={String(stats.pendingCount)}
          sub={`Est. ${fmtCurrency(stats.pendingAmount)}`}
          iconName={IconName.Clock}
          tone="amber"
        />
        <StatCard
          label="Total Paid"
          value={fmtCurrency(stats.completedAmount)}
          sub={`${stats.completedCount} payout${stats.completedCount === 1 ? '' : 's'} in last ${months} month${months === 1 ? '' : 's'}`}
          iconName={IconName.CheckCircle}
          tone="green"
        />
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <FilterPill value="all" label="All" />
          <FilterPill value="pending" label="Pending" />
          <FilterPill value="completed" label="Completed" />
          <FilterPill value="cancelled" label="Cancelled" />
        </div>
        <div className="relative flex-1 min-w-[16rem] max-w-md sm:max-w-lg">
          <Icon
            name={IconName.Search}
            className="w-4 h-4 absolute left-2.5 top-1/2 -translate-y-1/2 text-on-surface-secondary pointer-events-none"
          />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search trainer / course / run…"
            className="w-full border border-default rounded-md pl-8 pr-2 py-1.5 text-sm bg-white dark:bg-slate-800"
          />
        </div>
      </div>

      {error && (
        <div className="rounded-md border border-red-300 bg-red-50 dark:bg-red-900/20 text-red-800 dark:text-red-300 px-3 py-2 text-sm">
          {error}
        </div>
      )}

      <div className="overflow-x-auto bg-white dark:bg-slate-800 rounded-lg shadow-sm border border-default">
        <table className="min-w-full text-sm">
          <thead className="bg-gray-50 dark:bg-slate-700/50 text-left text-xs uppercase tracking-wider text-on-surface-secondary">
            <tr>
              <th className="px-3 py-2 whitespace-nowrap">Course</th>
              <th className="px-3 py-2 whitespace-nowrap">Trainer</th>
              <th className="px-3 py-2 whitespace-nowrap text-right"># Learners</th>
              <th className="px-3 py-2 whitespace-nowrap text-right">Course Fee</th>
              <th className="px-3 py-2 whitespace-nowrap text-right">Est. Payout</th>
              <th className="px-3 py-2 whitespace-nowrap text-right">Actual Payout</th>
              <th className="px-3 py-2 whitespace-nowrap">Status</th>
              <th className="px-3 py-2 whitespace-nowrap">Payment Date</th>
              <th className="px-3 py-2 whitespace-nowrap">Remark</th>
              <th className="px-3 py-2 whitespace-nowrap text-right"></th>
            </tr>
          </thead>
          <tbody>
            {loading && <LoadingRow />}
            {!loading && filtered.length === 0 && (
              <tr>
                <td colSpan={10} className="px-3 py-12 text-center">
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
            {!loading &&
              pageRows.map((r) => (
                <tr
                  key={r.id}
                  onClick={() => setEditing(r)}
                  title="Click to edit this payout"
                  className="border-t border-default hover:bg-primary/5 dark:hover:bg-primary/10 transition-colors cursor-pointer"
                >
                  <td className="px-3 py-2 max-w-[20rem]">
                    <div className="font-medium truncate" title={r.course_title || ''}>{r.course_title || '-'}</div>
                    <div className="text-[11px] text-on-surface-secondary font-mono truncate">
                      {r.course_code || '-'} · {r.course_run_code || '-'}
                    </div>
                  </td>
                  <td className="px-3 py-2 max-w-[14rem] truncate" title={r.trainer_name || ''}>
                    {r.trainer_name || '-'}
                  </td>
                  <td className="px-3 py-2 text-right">{r.num_learners}</td>
                  <td className="px-3 py-2 text-right">{fmtCurrency(r.course_fee)}</td>
                  <td className="px-3 py-2 text-right">{fmtCurrency(r.estimated_payout)}</td>
                  <td className="px-3 py-2 text-right font-medium">{fmtCurrency(r.actual_payout)}</td>
                  <td className="px-3 py-2"><StatusBadge status={r.status} /></td>
                  <td className="px-3 py-2 whitespace-nowrap">{fmtDate(r.payment_date)}</td>
                  <td className="px-3 py-2 max-w-[14rem] truncate" title={r.remark || ''}>
                    {r.remark || '-'}
                  </td>
                  <td className="px-3 py-2 text-right">
                    <button
                      onClick={(e) => { e.stopPropagation(); setEditing(r); }}
                      title="Edit payout"
                      className="inline-flex items-center gap-1 px-2 py-1 text-xs border border-default rounded-md hover:bg-gray-100 dark:hover:bg-slate-700 text-on-surface"
                    >
                      <Icon name={IconName.Edit} className="w-3.5 h-3.5" />
                      Edit
                    </button>
                  </td>
                </tr>
              ))}
          </tbody>
        </table>

        {!loading && filtered.length > 0 && (
          <div className="flex flex-wrap items-center justify-between gap-3 px-3 py-2 border-t border-default bg-gray-50 dark:bg-slate-700/30 text-xs text-on-surface-secondary">
            <div>
              Showing <span className="font-medium text-on-surface">{rangeStart}</span>–
              <span className="font-medium text-on-surface">{rangeEnd}</span> of{' '}
              <span className="font-medium text-on-surface">{filtered.length}</span>
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
