import React, { useEffect, useMemo, useState } from 'react';
import { Icon, IconName } from '../ui/Icon';
import { authHeader } from '@lib/auth/authHeader';
import { fmtDate, fmtDateRange } from '@lib/payroll/formatDate';

export interface TrainerPayoutRow {
  id: string;
  course_run_id: string;
  course_run_code: string | null;
  course_title: string | null;
  course_code: string | null;
  num_learners: number;
  actual_payout: string | number | null;
  payment_date: string | null;
  remark?: string | null;
  start_date?: string | null;
  end_date?: string | null;
  /** Which payout table the row came from — non-WSQ classes are tagged. */
  source?: 'wsq' | 'manual';
}

interface Props {
  trainerUserId: string;
}

const fmtCurrency = (n: number | string | null | undefined) => {
  if (n === null || n === undefined || n === '') return '-';
  const v = typeof n === 'string' ? Number(n) : n;
  if (Number.isNaN(v)) return '-';
  return v.toLocaleString('en-SG', { style: 'currency', currency: 'SGD' });
};

const fmtCurrencyCompact = (n: number) =>
  n.toLocaleString('en-SG', { style: 'currency', currency: 'SGD', minimumFractionDigits: 2 });

const yearOf = (iso: string | null | undefined): string | null => {
  if (!iso) return null;
  const m = /^(\d{4})/.exec(iso);
  return m ? m[1] : null;
};

const csvEscape = (v: unknown): string => {
  const s = v === null || v === undefined ? '' : String(v);
  if (/[",\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
};

const toCsv = (rows: TrainerPayoutRow[]): string => {
  const header = [
    'Course Date',
    'Course Code',
    'Course Title',
    'Run ID',
    'No of Pax',
    'Date Received',
    'Trainer Fee (SGD)',
    'Remark',
  ];
  const lines = rows.map((r) =>
    [
      fmtDateRange(r.start_date, r.end_date),
      r.course_code || '',
      r.course_title || '',
      r.course_run_code || '',
      r.num_learners ?? '',
      r.payment_date || '',
      r.actual_payout === null || r.actual_payout === undefined ? '' : Number(r.actual_payout).toFixed(2),
      r.remark || '',
    ]
      .map(csvEscape)
      .join(',')
  );
  return [header.join(','), ...lines].join('\n');
};

const SkeletonRow: React.FC = () => (
  <tr className="border-t border-default">
    {Array.from({ length: 7 }).map((_, i) => (
      <td key={i} className="px-3 py-2.5">
        <div className="h-3 bg-gray-200 dark:bg-slate-700 rounded animate-pulse" />
      </td>
    ))}
  </tr>
);

const TrainerPayoutTable: React.FC<Props> = ({ trainerUserId }) => {
  const [rows, setRows] = useState<TrainerPayoutRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [yearFilter, setYearFilter] = useState<string>('all');

  useEffect(() => {
    if (!trainerUserId) return;
    let cancelled = false;
    (async () => {
      try {
        setLoading(true);
        const r = await fetch(`/api/trainer/${trainerUserId}/payout-history`, {
          headers: { ...authHeader() },
        });
        const j = await r.json();
        if (cancelled) return;
        if (!j.success) throw new Error(j.error || 'Failed');
        setRows(j.data || []);
      } catch (e: any) {
        if (!cancelled) setError(e?.message || 'Failed to load');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [trainerUserId]);

  const years = useMemo(() => {
    const set = new Set<string>();
    rows.forEach((r) => {
      const y = yearOf(r.payment_date) || yearOf(r.end_date) || yearOf(r.start_date);
      if (y) set.add(y);
    });
    return Array.from(set).sort().reverse();
  }, [rows]);

  const filtered = useMemo(() => {
    if (yearFilter === 'all') return rows;
    return rows.filter((r) => {
      const y = yearOf(r.payment_date) || yearOf(r.end_date) || yearOf(r.start_date);
      return y === yearFilter;
    });
  }, [rows, yearFilter]);

  const total = useMemo(
    () =>
      filtered.reduce((acc, r) => {
        const v = Number(r.actual_payout ?? 0);
        return acc + (Number.isFinite(v) ? v : 0);
      }, 0),
    [filtered]
  );

  const downloadCsv = () => {
    const csv = toCsv(filtered);
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    const yLabel = yearFilter === 'all' ? 'all' : yearFilter;
    a.download = `trainer-payouts-${yLabel}.csv`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  if (error) {
    return (
      <div className="rounded-md border border-red-300 bg-red-50 dark:bg-red-900/20 text-red-800 dark:text-red-300 px-3 py-2 text-sm">
        {error}
      </div>
    );
  }

  const yearLabel = yearFilter === 'all' ? 'All time' : yearFilter;

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div className="bg-white dark:bg-slate-800 rounded-lg shadow-sm border border-default p-4 flex items-center gap-3">
          <div className="w-10 h-10 rounded-lg flex items-center justify-center flex-shrink-0 bg-green-50 text-green-700 dark:bg-green-900/30 dark:text-green-300">
            <Icon name={IconName.DollarSign} className="w-5 h-5" />
          </div>
          <div className="min-w-0">
            <div className="text-xs uppercase tracking-wider text-on-surface-secondary font-medium">
              Total earned · {yearLabel}
            </div>
            <div className="text-lg font-bold leading-tight">{fmtCurrencyCompact(total)}</div>
          </div>
        </div>
        <div className="bg-white dark:bg-slate-800 rounded-lg shadow-sm border border-default p-4 flex items-center gap-3">
          <div className="w-10 h-10 rounded-lg flex items-center justify-center flex-shrink-0 bg-blue-50 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300">
            <Icon name={IconName.ClipboardCheck} className="w-5 h-5" />
          </div>
          <div className="min-w-0">
            <div className="text-xs uppercase tracking-wider text-on-surface-secondary font-medium">
              Payouts received
            </div>
            <div className="text-lg font-bold leading-tight">{filtered.length}</div>
          </div>
        </div>
      </div>

      {(years.length > 0 || rows.length > 0) && (
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => setYearFilter('all')}
              className={`px-3 py-1 text-xs font-medium rounded-full border transition-colors ${
                yearFilter === 'all'
                  ? 'bg-primary text-white border-primary'
                  : 'bg-white dark:bg-slate-800 border-default text-on-surface-secondary hover:bg-gray-50 dark:hover:bg-slate-700'
              }`}
            >
              All ({rows.length})
            </button>
            {years.map((y) => {
              const count = rows.filter((r) => {
                const ry = yearOf(r.payment_date) || yearOf(r.end_date) || yearOf(r.start_date);
                return ry === y;
              }).length;
              return (
                <button
                  key={y}
                  type="button"
                  onClick={() => setYearFilter(y)}
                  className={`px-3 py-1 text-xs font-medium rounded-full border transition-colors ${
                    yearFilter === y
                      ? 'bg-primary text-white border-primary'
                      : 'bg-white dark:bg-slate-800 border-default text-on-surface-secondary hover:bg-gray-50 dark:hover:bg-slate-700'
                  }`}
                >
                  {y} ({count})
                </button>
              );
            })}
          </div>
          {filtered.length > 0 && (
            <button
              type="button"
              onClick={downloadCsv}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs border border-default rounded-md hover:bg-gray-50 dark:hover:bg-slate-700"
              title="Download as CSV"
            >
              <Icon name={IconName.Download} className="w-4 h-4" />
              Export CSV
            </button>
          )}
        </div>
      )}

      <div className="overflow-x-auto rounded-lg border border-default bg-white dark:bg-slate-800">
        <table className="min-w-full text-sm">
          <thead className="bg-gray-50 dark:bg-slate-700/50 text-left text-xs uppercase tracking-wider text-on-surface-secondary">
            <tr>
              <th className="px-3 py-2 whitespace-nowrap">Course Date</th>
              <th className="px-3 py-2 whitespace-nowrap">Course Code</th>
              <th className="px-3 py-2">Course Title</th>
              <th className="px-3 py-2 whitespace-nowrap">Run ID</th>
              <th className="px-3 py-2 text-right whitespace-nowrap">No of Pax</th>
              <th className="px-3 py-2 whitespace-nowrap">Date Received</th>
              <th className="px-3 py-2 text-right whitespace-nowrap">Trainer Fee</th>
            </tr>
          </thead>
          <tbody>
            {loading && (
              <>
                <SkeletonRow />
                <SkeletonRow />
                <SkeletonRow />
              </>
            )}
            {!loading && filtered.length === 0 && (
              <tr>
                <td colSpan={7} className="px-3 py-10 text-center">
                  <div className="flex flex-col items-center gap-2 text-on-surface-secondary">
                    <Icon name={IconName.DollarSign} className="w-10 h-10 opacity-30" />
                    {rows.length === 0 ? (
                      <>
                        <p className="text-sm font-medium">No completed payouts yet</p>
                        <p className="text-xs">Payments will appear here after Payroll marks them completed.</p>
                      </>
                    ) : (
                      <>
                        <p className="text-sm font-medium">No payouts in {yearLabel}</p>
                        <p className="text-xs">Pick a different year above.</p>
                      </>
                    )}
                  </div>
                </td>
              </tr>
            )}
            {!loading &&
              filtered.map((r) => (
                <tr key={r.id} className="border-t border-default hover:bg-gray-50 dark:hover:bg-slate-700/40">
                  <td className="px-3 py-2 whitespace-nowrap">{fmtDateRange(r.start_date, r.end_date)}</td>
                  <td className="px-3 py-2 font-mono text-xs whitespace-nowrap">{r.course_code || '-'}</td>
                  <td className="px-3 py-2">
                    {r.course_title || '-'}
                    {/* Non-WSQ classes have no run code, so without a marker they
                        just look like a row with missing data. */}
                    {r.source === 'manual' && (
                      <span
                        title="Non-WSQ class, entered manually in Payroll"
                        className="ml-2 align-middle inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-semibold bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-200"
                      >
                        Non-WSQ
                      </span>
                    )}
                  </td>
                  <td className="px-3 py-2 font-mono text-xs whitespace-nowrap">{r.course_run_code || '-'}</td>
                  <td className="px-3 py-2 text-right">{r.num_learners ?? '-'}</td>
                  <td className="px-3 py-2 whitespace-nowrap">{fmtDate(r.payment_date)}</td>
                  <td className="px-3 py-2 text-right font-medium">{fmtCurrency(r.actual_payout)}</td>
                </tr>
              ))}
          </tbody>
        </table>
      </div>
    </div>
  );
};

export default TrainerPayoutTable;
