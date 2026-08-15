import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Icon, IconName } from '../ui/Icon';
import { authHeader } from '@lib/auth/authHeader';
import { fmtDate } from '@lib/payroll/formatDate';
import { fmtCurrency, StatCard, LoadingRow, OPTION_CLASS } from './shared';
import { DeleteConfirmModal } from '../admin/DeleteConfirmModal';

// Billing invoices raised for confirmed trainer payouts. One class = one bill —
// this view is read-only apart from re-sending a bill that failed to reach
// QuickBooks; bills are created by confirming a payout, never from here.

export interface TrainerBill {
  id: string;
  source: 'wsq' | 'manual';
  /**
   * The class this bill came from. Both go null if that class is deleted —
   * the bill row deliberately survives (see the trainer_bill FKs) so a payable
   * that is still live in QuickBooks never loses its trail.
   */
  payout_id: string | null;
  manual_class_id: string | null;
  bill_no: string;
  bill_date: string;
  trainer_id: string | null;
  trainer_name: string;
  course_title: string;
  course_code: string | null;
  amount: string;
  vendor_name: string | null;
  qb_bill_id: string | null;
  /** Generated PDF in Google Drive; null until it has been filed. */
  drive_file_id: string | null;
  drive_view_link: string | null;
  status: 'pending' | 'posted' | 'failed' | 'voided';
  error: string | null;
  created_at: string;
}

type StatusFilter = 'all' | 'posted' | 'pending' | 'failed' | 'voided';
type WindowMode = 'month' | 'range' | 'all';

const PAGE_SIZE = 20;

const STATUS_META: Record<TrainerBill['status'], { label: string; cls: string; dot: string }> = {
  posted: {
    label: 'In QuickBooks',
    cls: 'bg-green-100 text-green-700 ring-green-600/20 dark:bg-green-900/40 dark:text-green-300',
    dot: 'bg-green-500',
  },
  pending: {
    label: 'Sending…',
    cls: 'bg-sky-100 text-sky-700 ring-sky-600/20 dark:bg-sky-900/40 dark:text-sky-300',
    dot: 'bg-sky-500 animate-pulse',
  },
  failed: {
    label: 'Failed',
    cls: 'bg-rose-100 text-rose-700 ring-rose-600/20 dark:bg-rose-900/40 dark:text-rose-300',
    dot: 'bg-rose-500',
  },
  voided: {
    label: 'Voided',
    cls: 'bg-gray-100 text-gray-600 ring-gray-500/20 dark:bg-slate-700 dark:text-gray-300',
    dot: 'bg-gray-400',
  },
};

const BillStatusBadge: React.FC<{ status: TrainerBill['status'] }> = ({ status }) => {
  const m = STATUS_META[status];
  return (
    <span className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-xs font-medium ring-1 ring-inset ${m.cls}`}>
      <span className={`w-1.5 h-1.5 rounded-full ${m.dot}`} />
      {m.label}
    </span>
  );
};

const csvEscape = (v: unknown): string => {
  const s = v === null || v === undefined ? '' : String(v);
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

/** Reconciliation export: the rows currently on screen, in QuickBooks' terms. */
const toCsv = (rows: TrainerBill[]): string => {
  const header = ['Bill No', 'Bill Date', 'Supplier', 'Trainer', 'Course', 'Course Code', 'Amount', 'Status', 'QuickBooks ID', 'PDF'];
  const lines = rows.map((r) =>
    [
      r.bill_no,
      r.bill_date,
      r.vendor_name || '',
      r.trainer_name,
      r.course_title,
      r.course_code || '',
      Number(r.amount).toFixed(2),
      STATUS_META[r.status].label,
      r.qb_bill_id || '',
      r.drive_view_link || '',
    ].map(csvEscape).join(',')
  );
  return [header.join(','), ...lines].join('\r\n');
};

const BillListView: React.FC = () => {
  const [bills, setBills] = useState<TrainerBill[]>([]);
  const [summary, setSummary] = useState({
    total: 0,
    posted: 0,
    pending: 0,
    failed: 0,
    voided: 0,
    totalAmount: 0,
  });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [retrying, setRetrying] = useState<string | null>(null);
  const [retryError, setRetryError] = useState<string | null>(null);
  // Bill number most recently copied, for the transient "Copied" tick.
  const [copied, setCopied] = useState<string | null>(null);
  // Bulk delete: chosen bill ids, the confirm step, and progress/errors.
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [deleteProgress, setDeleteProgress] = useState(0);

  const [windowMode, setWindowMode] = useState<WindowMode>('month');
  const [month, setMonth] = useState<string>(() => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
  });
  const [months, setMonths] = useState(12);
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(0);

  const load = useCallback(async (silent = false) => {
    if (!silent) setLoading(true);
    setError(null);
    try {
      const q =
        windowMode === 'all' ? 'all=1' : windowMode === 'month' ? `month=${month}` : `months=${months}`;
      const r = await fetch(`/api/payroll/bills?${q}`, { headers: { ...authHeader() } });
      const j = await r.json();
      if (!j.success) throw new Error(j.error || 'Failed to load billing invoices');
      setBills(j.data.bills || []);
      if (j.data.summary) setSummary(j.data.summary);
    } catch (e: any) {
      setError(e?.message || 'Failed to load');
    } finally {
      if (!silent) setLoading(false);
    }
  }, [windowMode, month, months]);

  useEffect(() => {
    load();
  }, [load]);

  // A just-confirmed payout leaves its bill in 'pending' while the QuickBooks
  // push runs in the background, so poll quietly until nothing is in flight.
  useEffect(() => {
    if (!bills.some((b) => b.status === 'pending')) return;
    const t = setTimeout(() => load(true), 4000);
    return () => clearTimeout(t);
  }, [bills, load]);

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

  const retry = useCallback(async (bill: TrainerBill) => {
    setRetrying(bill.id);
    setRetryError(null);
    try {
      const r = await fetch(`/api/payroll/bills/${bill.id}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeader() },
        body: JSON.stringify({ action: 'retry' }),
      });
      const j = await r.json();
      if (j.data) setBills((bs) => bs.map((b) => (b.id === j.data.id ? j.data : b)));
      if (!j.success) throw new Error(j.error || 'QuickBooks rejected the bill');
      load(true); // re-sync the summary cards
    } catch (e: any) {
      setRetryError(`${bill.bill_no}: ${e?.message || 'Could not send to QuickBooks'}`);
    } finally {
      setRetrying(null);
    }
  }, [load]);

  /**
   * "View Bill" — open the bill's PDF in Google Drive.
   *
   * A bill can be posted to QuickBooks without a document yet (Drive was
   * unreachable at the time, or the file was deleted since), so rather than
   * showing a second button for that case, the first click files the PDF and
   * then opens it. The window is opened up-front and pointed at the link once
   * we have it — opening it inside the async callback would be swallowed by the
   * browser's popup blocker, since the user gesture is long gone by then.
   */
  const viewBill = useCallback(async (bill: TrainerBill) => {
    if (bill.drive_view_link) {
      window.open(bill.drive_view_link, '_blank', 'noopener,noreferrer');
      return;
    }
    const pending = window.open('', '_blank');
    setRetrying(bill.id);
    setRetryError(null);
    try {
      const r = await fetch(`/api/payroll/bills/${bill.id}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeader() },
        body: JSON.stringify({ action: 'retry' }),
      });
      const j = await r.json();
      if (j.data) setBills((bs) => bs.map((b) => (b.id === j.data.id ? j.data : b)));
      if (!j.success) throw new Error(j.error || 'Could not prepare the bill PDF');
      const link = j.data?.drive_view_link;
      if (!link) throw new Error('The bill PDF could not be saved to Google Drive');
      if (pending) pending.location.href = link;
      else window.open(link, '_blank', 'noopener,noreferrer');
      load(true);
    } catch (e: any) {
      pending?.close();
      setRetryError(`${bill.bill_no}: ${e?.message || 'Could not open the bill PDF'}`);
    } finally {
      setRetrying(null);
    }
  }, [load]);

  /** Copy a bill number — Finance pastes these into QuickBooks' search. */
  const copyBillNo = useCallback(async (billNo: string) => {
    try {
      await navigator.clipboard.writeText(billNo);
      setCopied(billNo);
      window.setTimeout(() => setCopied((c) => (c === billNo ? null : c)), 1500);
    } catch {
      /* clipboard blocked (insecure origin / permissions) — not worth an error */
    }
  }, []);

  const searched = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return bills;
    return bills.filter((b) =>
      [b.bill_no, b.trainer_name, b.course_title, b.course_code, b.vendor_name]
        .filter(Boolean)
        .some((v) => String(v).toLowerCase().includes(q))
    );
  }, [bills, search]);

  const counts = useMemo(() => {
    const c: Record<StatusFilter, number> = { all: 0, posted: 0, pending: 0, failed: 0, voided: 0 };
    searched.forEach((b) => { c[b.status] += 1; });
    // "All" counts what All actually shows — voided rows are excluded there.
    c.all = searched.length - c.voided;
    return c;
  }, [searched]);

  // "All" means all LIVE bills. A voided row is the counterpart to a bill that
  // was deleted in QuickBooks — worth keeping for reconciliation, but it is not
  // an invoice anyone can act on, and leaving it inline means the same bill
  // number appears several times after an un-confirm/re-confirm cycle. The
  // Voided pill still shows them on demand.
  const filtered = useMemo(
    () =>
      statusFilter === 'all'
        ? searched.filter((b) => b.status !== 'voided')
        : searched.filter((b) => b.status === statusFilter),
    [searched, statusFilter]
  );

  // Sum of what is actually on screen. The Total Billed card covers the whole
  // window; this follows the search box and status pill, so a filtered view
  // still adds up to something you can reconcile against.
  const filteredTotal = useMemo(
    () => filtered.reduce((sum, b) => sum + (Number(b.amount) || 0), 0),
    [filtered]
  );

  const exportCsv = useCallback(() => {
    if (filtered.length === 0) return;
    const scope = windowMode === 'all' ? 'all-time' : windowMode === 'month' ? month : `last-${months}m`;
    const blob = new Blob([toCsv(filtered)], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `trainer-bills-${scope}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }, [filtered, windowMode, month, months]);

  const toggleOne = useCallback((id: string) => {
    setSelected((s) => {
      const next = new Set(s);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  /**
   * Delete the selected billing invoices — the QuickBooks bill and its Drive
   * PDF. The class and its payout are NOT touched: the payout stays marked as
   * paid, it just no longer has a bill.
   *
   * Sequential on purpose. Each delete is a QuickBooks round trip, and firing
   * them in parallel would both hammer Intuit's rate limit and make a partial
   * failure impossible to report precisely.
   */
  const deleteSelected = useCallback(async () => {
    if (deleting || selected.size === 0) return;
    setDeleting(true);
    setDeleteProgress(0);
    setRetryError(null);
    const ids = Array.from(selected);
    const failedRefs: string[] = [];
    let done = 0;

    for (const id of ids) {
      const ref = bills.find((b) => b.id === id)?.bill_no || id;
      try {
        const r = await fetch(`/api/payroll/bills/${id}`, {
          method: 'DELETE',
          headers: { ...authHeader() },
        });
        const j = await r.json();
        if (!j.success) throw new Error(j.error || 'delete failed');
        setBills((bs) => bs.filter((b) => b.id !== id));
      } catch (e: any) {
        failedRefs.push(`${ref}${e?.message ? ` (${e.message})` : ''}`);
      }
      done += 1;
      setDeleteProgress(done);
    }

    setSelected(new Set());
    setConfirmDelete(false);
    setDeleting(false);
    if (failedRefs.length > 0) {
      setRetryError(`Could not delete ${failedRefs.length} of ${ids.length}: ${failedRefs.join('; ')}`);
    }
    load(true);
  }, [deleting, selected, bills, load]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const safePage = Math.min(page, totalPages - 1);
  const pageRows = useMemo(
    () => filtered.slice(safePage * PAGE_SIZE, safePage * PAGE_SIZE + PAGE_SIZE),
    [filtered, safePage]
  );

  // Header checkbox state, scoped to the visible page.
  const allOnPageSelected = pageRows.length > 0 && pageRows.every((b) => selected.has(b.id));
  const someOnPageSelected = pageRows.some((b) => selected.has(b.id));

  const toggleAllOnPage = useCallback(() => {
    setSelected((s) => {
      const next = new Set(s);
      const all = pageRows.length > 0 && pageRows.every((b) => next.has(b.id));
      pageRows.forEach((b) => (all ? next.delete(b.id) : next.add(b.id)));
      return next;
    });
  }, [pageRows]);

  useEffect(() => {
    setPage(0);
  }, [statusFilter, search, windowMode, month, months]);

  // Changing the window or filters changes what "selected" could even mean —
  // clear it rather than silently holding rows that are no longer on screen.
  useEffect(() => {
    setSelected(new Set());
    setConfirmDelete(false);
  }, [statusFilter, search, windowMode, month, months]);

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
      <div className="flex items-center gap-3">
        <div className="w-11 h-11 rounded-xl bg-gradient-to-br from-primary to-primary/60 flex items-center justify-center text-white shadow-lg shadow-primary/20 flex-shrink-0">
          <Icon name={IconName.FileText} className="w-6 h-6" />
        </div>
        <div>
          <h1 className="text-2xl font-bold leading-tight">Billing Invoices</h1>
          <p className="text-sm text-on-surface-secondary mt-0.5">
            One QuickBooks supplier bill per confirmed class. Bills are raised automatically when a
            payout is marked as paid — mark it back to pending to void one.
          </p>
        </div>
      </div>

      {/* Window + refresh controls */}
      <div className="flex items-center gap-2 flex-wrap">
        <div className="flex h-9 rounded-lg border border-default overflow-hidden">
          {(['month', 'range', 'all'] as const).map((m) => (
            <button
              key={m}
              onClick={() => setWindowMode(m)}
              className={`px-3 text-sm font-medium transition ${
                windowMode === m
                  ? 'bg-primary text-white'
                  : 'bg-white dark:bg-slate-800 text-on-surface-secondary hover:bg-gray-50 dark:hover:bg-slate-700'
              }`}
            >
              {m === 'month' ? 'Month' : m === 'range' ? 'Range' : 'All time'}
            </button>
          ))}
        </div>

        {windowMode === 'month' && (
          <div className="flex items-center h-9 border border-default rounded-lg bg-white dark:bg-slate-800 overflow-hidden">
            <button onClick={() => shiftMonth(-1)} aria-label="Previous month" className="w-8 h-full flex items-center justify-center text-on-surface-secondary hover:bg-gray-50 dark:hover:bg-slate-700 text-lg leading-none">‹</button>
            <span className="text-sm font-semibold min-w-[8rem] text-center px-1">{monthLabel}</span>
            <button
              onClick={() => shiftMonth(1)}
              disabled={month >= currentMonthStr}
              aria-label="Next month"
              className="w-8 h-full flex items-center justify-center text-on-surface-secondary hover:bg-gray-50 dark:hover:bg-slate-700 text-lg leading-none disabled:opacity-30 disabled:cursor-not-allowed"
            >›</button>
          </div>
        )}

        {windowMode === 'range' && (
          <div className="flex items-center gap-1.5 h-9 pl-3 pr-1.5 border border-default rounded-lg bg-white dark:bg-slate-800">
            <span className="text-[11px] uppercase tracking-wider text-on-surface-secondary font-medium whitespace-nowrap">Last</span>
            <select
              value={months}
              onChange={(e) => setMonths(Number(e.target.value))}
              aria-label="Window: within the last"
              className="h-8 bg-transparent pr-1 text-sm font-medium focus:outline-none cursor-pointer"
            >
              <option className={OPTION_CLASS} value={1}>1 month</option>
              <option className={OPTION_CLASS} value={3}>3 months</option>
              <option className={OPTION_CLASS} value={6}>6 months</option>
              <option className={OPTION_CLASS} value={12}>12 months</option>
              <option className={OPTION_CLASS} value={24}>24 months</option>
            </select>
          </div>
        )}

        <button
          onClick={() => load()}
          title="Refresh"
          className="inline-flex items-center justify-center gap-1.5 h-9 px-3 text-sm font-medium border border-default rounded-lg hover:bg-gray-50 dark:hover:bg-slate-700 text-on-surface-secondary transition"
        >
          <Icon name={IconName.Sync} className="w-4 h-4" />
          <span className="hidden md:inline">Refresh</span>
        </button>

        <button
          onClick={exportCsv}
          disabled={filtered.length === 0}
          title="Download the bills currently shown, for reconciling against QuickBooks"
          className="inline-flex items-center justify-center gap-1.5 h-9 px-3 text-sm font-medium border border-default rounded-lg hover:bg-gray-50 dark:hover:bg-slate-700 text-on-surface-secondary transition disabled:opacity-40 disabled:cursor-not-allowed"
        >
          <Icon name={IconName.Download} className="w-4 h-4" />
          <span className="hidden md:inline">Export</span>
        </button>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
        <StatCard
          label="Total Billed"
          value={fmtCurrency(summary.totalAmount)}
          sub="Excludes voided bills"
          iconName={IconName.DollarSign}
          tone="violet"
        />
        <StatCard
          label="Bills"
          value={String(summary.total)}
          sub={windowMode === 'all' ? 'All time' : windowMode === 'month' ? monthLabel : `Last ${months} months`}
          iconName={IconName.FileText}
          tone="blue"
        />
        <StatCard
          label="In QuickBooks"
          value={String(summary.posted)}
          sub={summary.pending > 0 ? `${summary.pending} still sending` : 'All sent'}
          iconName={IconName.CheckCircle}
          tone="green"
        />
        <StatCard
          label="Failed"
          value={String(summary.failed)}
          sub={summary.failed > 0 ? 'Needs a re-send' : 'None'}
          iconName={IconName.Warning}
          tone={summary.failed > 0 ? 'rose' : 'gray'}
        />
      </div>

      <div className="bg-white dark:bg-slate-800 rounded-lg border border-default shadow-sm p-3 space-y-3">
        <div className="flex flex-wrap items-center gap-2">
          <FilterPill value="all" label="All" />
          <FilterPill value="posted" label="In QuickBooks" />
          <FilterPill value="pending" label="Sending" />
          <FilterPill value="failed" label="Failed" />
          <FilterPill value="voided" label="Voided" />
        </div>
        <div className="relative">
          <Icon
            name={IconName.Search}
            className="w-4 h-4 absolute left-2.5 top-1/2 -translate-y-1/2 text-on-surface-secondary pointer-events-none"
          />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search bill no., trainer or course…"
            className="w-full h-9 border border-default rounded-md pl-8 pr-2 text-sm bg-white dark:bg-slate-700/40 focus:outline-none focus:ring-2 focus:ring-primary/30"
          />
        </div>
      </div>

      {error && (
        <div className="rounded-md border border-red-300 bg-red-50 dark:bg-red-900/20 text-red-800 dark:text-red-300 px-3 py-2 text-sm">
          {error}
        </div>
      )}
      {retryError && (
        <div className="rounded-md border border-red-300 bg-red-50 dark:bg-red-900/20 text-red-800 dark:text-red-300 px-3 py-2 text-sm">
          {retryError}
        </div>
      )}

      {selected.size > 0 && (
        /* Count reads left-to-right with the table; actions sit hard right,
           where the eye lands last and where destructive buttons are least
           likely to be hit by accident on the way to something else. */
        <div className="rounded-lg border border-primary/40 bg-primary/5 px-3 py-2.5 flex flex-wrap items-center gap-x-3 gap-y-2">
          <span className="text-sm font-medium whitespace-nowrap" aria-live="polite">
            {selected.size} bill{selected.size === 1 ? '' : 's'} selected
          </span>

          {/* Icon-only actions. Both carry title + aria-label because an icon
              alone is ambiguous to anyone who has not used the page before, and
              one of the two destroys a QuickBooks document. */}
          <div className="flex items-center gap-1 ml-auto">
            <button
              type="button"
              onClick={() => setSelected(new Set())}
              title="Clear selection"
              aria-label="Clear selection"
              className="inline-flex items-center justify-center w-8 h-8 rounded-md text-on-surface-secondary hover:text-on-surface hover:bg-black/5 dark:hover:bg-white/10 transition-colors"
            >
              <Icon name={IconName.Close} className="w-4 h-4" />
            </button>
            <button
              type="button"
              onClick={() => setConfirmDelete(true)}
              title={`Delete billing invoice${selected.size === 1 ? '' : 's'}`}
              aria-label={`Delete ${selected.size} billing invoice${selected.size === 1 ? '' : 's'}`}
              className="inline-flex items-center justify-center w-8 h-8 rounded-md text-rose-600 dark:text-rose-400 hover:bg-rose-50 dark:hover:bg-rose-900/25 transition-colors"
            >
              <Icon name={IconName.Delete} className="w-4 h-4" />
            </button>
          </div>
        </div>
      )}

      {confirmDelete && (
        /* Shared destructive-delete dialog, same one the Company Application and
           Direct Application lists use — it lists exactly which rows go, which
           an inline "are you sure?" strip could not do. */
        <DeleteConfirmModal
          rows={bills.filter((b) => selected.has(b.id))}
          entityLabel="billing invoice"
          isDeleting={deleting}
          onConfirm={deleteSelected}
          onClose={() => { if (!deleting) setConfirmDelete(false); }}
          description={
            <>
              Deletes the bill in QuickBooks and its PDF in Drive.
              <strong className="text-on-surface"> The class and its payout are not changed</strong> — the payout
              stays marked as paid.
              {deleting && ` · Deleting ${deleteProgress}/${selected.size}…`}
            </>
          }
          columns={[
            { header: 'Bill No', render: (b) => b.bill_no },
            { header: 'Trainer', render: (b) => b.vendor_name || b.trainer_name },
            { header: 'Course', render: (b) => b.course_title },
            { header: 'Amount', className: 'text-right', render: (b) => `$${Number(b.amount || 0).toFixed(2)}` },
          ]}
        />
      )}

      <div className="overflow-x-auto bg-white dark:bg-slate-800 rounded-xl shadow-sm border border-default">
        <table className="min-w-full text-sm">
          <thead className="bg-gray-50 dark:bg-slate-900/40 text-left text-[11px] uppercase tracking-wider text-on-surface-secondary font-semibold border-b border-default">
            <tr>
              <th className="pl-3 pr-1 py-2 w-9">
                <input
                  type="checkbox"
                  aria-label="Select all bills on this page"
                  checked={allOnPageSelected}
                  ref={(el) => { if (el) el.indeterminate = someOnPageSelected && !allOnPageSelected; }}
                  onChange={toggleAllOnPage}
                  className="w-4 h-4 rounded border-default accent-primary cursor-pointer"
                />
              </th>
              <th className="px-3 py-2 whitespace-nowrap">Bill No.</th>
              <th className="px-3 py-2 whitespace-nowrap">Bill Date</th>
              <th className="px-3 py-2 whitespace-nowrap">Supplier / Trainer</th>
              <th className="px-3 py-2 whitespace-nowrap">Course</th>
              <th className="px-3 py-2 whitespace-nowrap text-right">Amount</th>
              <th className="px-3 py-2 whitespace-nowrap">Status</th>
              <th className="px-3 py-2 whitespace-nowrap"></th>
            </tr>
          </thead>
          <tbody>
            {loading && <LoadingRow colSpan={8} label="Loading billing invoices…" />}
            {!loading && filtered.length === 0 && (
              <tr>
                <td colSpan={8} className="px-3 py-12 text-center">
                  <div className="flex flex-col items-center gap-2 text-on-surface-secondary">
                    <Icon name={IconName.FileText} className="w-10 h-10 opacity-30" />
                    {bills.length === 0 ? (
                      <>
                        <p className="text-sm font-medium">No bills in this window</p>
                        <p className="text-xs">
                          Confirm a payout in the Payout List — marking it as paid raises its bill automatically.
                        </p>
                      </>
                    ) : (
                      <>
                        <p className="text-sm font-medium">No bills match your filters</p>
                        <p className="text-xs">Try a different status or clear the search.</p>
                      </>
                    )}
                  </div>
                </td>
              </tr>
            )}

            {!loading && pageRows.map((b) => (
              <tr
                key={b.id}
                className={`border-t border-default transition-colors even:bg-gray-50/40 dark:even:bg-slate-900/20 hover:bg-primary/5 dark:hover:bg-primary/10 ${
                  b.status === 'voided' ? 'opacity-60' : ''
                }`}
              >
                <td className="pl-3 pr-1 py-2.5">
                  <input
                    type="checkbox"
                    aria-label={`Select bill ${b.bill_no}`}
                    checked={selected.has(b.id)}
                    onChange={() => toggleOne(b.id)}
                    className="w-4 h-4 rounded border-default accent-primary cursor-pointer"
                  />
                </td>
                <td className="px-3 py-2.5 whitespace-nowrap">
                  {/* Click to copy — this is the string Finance pastes into
                      QuickBooks' search to find the matching bill. */}
                  <button
                    type="button"
                    onClick={() => copyBillNo(b.bill_no)}
                    title={copied === b.bill_no ? 'Copied' : `Copy ${b.bill_no}`}
                    className="group/copy inline-flex items-center gap-1.5 text-left"
                  >
                    <span className={`font-mono font-semibold ${b.status === 'voided' ? 'line-through' : ''}`}>
                      {b.bill_no}
                    </span>
                    <Icon
                      name={copied === b.bill_no ? IconName.Check : IconName.ClipboardCheck}
                      className={`w-3.5 h-3.5 flex-shrink-0 transition ${
                        copied === b.bill_no
                          ? 'text-green-500 opacity-100'
                          : 'text-on-surface-secondary opacity-0 group-hover/copy:opacity-60'
                      }`}
                    />
                  </button>
                </td>
                <td className="px-3 py-2.5 whitespace-nowrap text-on-surface-secondary">{fmtDate(b.bill_date)}</td>
                <td className="px-3 py-2.5 max-w-[14rem]">
                  <div className="truncate uppercase" title={b.vendor_name || b.trainer_name}>
                    {b.vendor_name || b.trainer_name}
                  </div>
                  {b.vendor_name && b.vendor_name.toLowerCase() !== b.trainer_name.toLowerCase() && (
                    <div className="text-[11px] text-on-surface-secondary truncate">{b.trainer_name}</div>
                  )}
                </td>
                <td className="px-3 py-2.5 max-w-[22rem]">
                  <div className="font-medium truncate" title={b.course_title}>{b.course_title}</div>
                  {b.course_code && (
                    <div className="text-[11px] text-on-surface-secondary font-mono truncate">{b.course_code}</div>
                  )}
                  {/* The class was deleted after this bill was raised. The bill
                      itself may still be live in QuickBooks, so it is surfaced
                      rather than quietly left parentless. */}
                  {!b.payout_id && !b.manual_class_id && (
                    <div
                      className="mt-1 inline-flex items-center gap-1 text-[11px] text-amber-700 dark:text-amber-400"
                      title="The class this bill was raised for has since been deleted. The bill may still exist in QuickBooks."
                    >
                      <Icon name={IconName.Warning} className="w-3 h-3" />
                      Class deleted
                    </div>
                  )}
                </td>
                <td className="px-3 py-2.5 text-right font-semibold tabular-nums">{fmtCurrency(b.amount)}</td>
                <td className="px-3 py-2.5">
                  <BillStatusBadge status={b.status} />
                  {b.status === 'failed' && b.error && (
                    <div className="text-[11px] text-rose-600 dark:text-rose-400 mt-1 max-w-[20rem]" title={b.error}>
                      {b.error.length > 120 ? `${b.error.slice(0, 120)}…` : b.error}
                    </div>
                  )}
                </td>
                <td className="px-3 py-2.5 whitespace-nowrap text-right">
                  <div className="inline-flex items-center gap-1.5">
                    {/* One action in the normal case: open this bill's PDF in
                        Drive. If it has no document yet, the click files it
                        first, so there is never a second button to reason about. */}
                    {b.status === 'posted' && (
                      <button
                        type="button"
                        onClick={() => viewBill(b)}
                        disabled={retrying !== null}
                        title={
                          b.drive_view_link
                            ? `Open the ${b.bill_no} bill PDF in Google Drive`
                            : `Save the ${b.bill_no} bill to Google Drive and open it`
                        }
                        className="inline-flex items-center gap-1.5 px-2.5 py-1 text-xs border border-primary/40 rounded-md bg-primary/5 hover:bg-primary/10 text-primary font-medium disabled:opacity-50"
                      >
                        <Icon
                          name={retrying === b.id ? IconName.Spinner : IconName.FileText}
                          className={`w-3.5 h-3.5 ${retrying === b.id ? 'animate-spin' : ''}`}
                        />
                        {retrying === b.id ? 'Preparing…' : 'View Bill'}
                      </button>
                    )}
                    {/* Error recovery only — a failed bill never reached
                        QuickBooks, so there is no document to view yet. */}
                    {b.status === 'failed' && (
                      <button
                        type="button"
                        onClick={() => retry(b)}
                        disabled={retrying !== null}
                        className="inline-flex items-center gap-1.5 px-2.5 py-1 text-xs border border-default rounded-md bg-white dark:bg-slate-800 hover:bg-gray-50 dark:hover:bg-slate-700 text-on-surface disabled:opacity-50"
                      >
                        <Icon
                          name={retrying === b.id ? IconName.Spinner : IconName.Sync}
                          className={`w-3.5 h-3.5 ${retrying === b.id ? 'animate-spin' : ''}`}
                        />
                        {retrying === b.id ? 'Sending…' : 'Re-send'}
                      </button>
                    )}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>

        {!loading && filtered.length > 0 && (
          <div className="flex flex-wrap items-center justify-between gap-3 px-3 py-2 border-t border-default bg-gray-50 dark:bg-slate-700/30 text-xs text-on-surface-secondary">
            <div>
              Showing <span className="font-medium text-on-surface">{safePage * PAGE_SIZE + 1}</span>–
              <span className="font-medium text-on-surface">
                {Math.min(filtered.length, safePage * PAGE_SIZE + PAGE_SIZE)}
              </span>{' '}
              of <span className="font-medium text-on-surface">{filtered.length}</span>
              {/* Total for what the filters actually select, so a search or
                  status pill still gives a figure you can reconcile. */}
              <span className="mx-2 opacity-40">·</span>
              <span className="text-on-surface-secondary">Total </span>
              <span className="font-semibold text-on-surface tabular-nums">{fmtCurrency(filteredTotal)}</span>
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
    </div>
  );
};

export default BillListView;
