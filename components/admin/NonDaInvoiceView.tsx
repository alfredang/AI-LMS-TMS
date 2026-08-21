import React, { useState, useEffect, useCallback, useRef } from 'react';
import { Card } from '../ui/Card';
import { Button } from '../ui/Button';
import { Icon, IconName } from '../ui/Icon';

/**
 * Individual Application > Non-DA Invoice.
 *
 * Lists ssg_enrolments rows that are neither a Direct Application
 * (public.da_application) nor a Company Application (public.company_application),
 * and whose SSG sponsorshipType is "Individual" (self-sponsored) — Employer-sponsored
 * rows never appear here even if untracked by company_application. See
 * `scope=individualNonDa` in pages/api/finance/all-course-runs.ts.
 * Generate/Send Invoice call the exact same non-DA endpoints Consolidated
 * Finance's generateInvoices() calls for its non-DA rows
 * (/api/finance/invoice-jobs/enqueue + poll, /api/finance/invoice-jobs/send)
 * — since every row here is already guaranteed non-DA, there's no DA branching needed.
 */
interface NonDaRow {
  enrolment_id: string | null;
  trainee_name: string | null;
  trainee_nric: string | null;
  course_title: string | null;
  course_reference: string | null;
  course_run_number: string | null;
  enrolment_status: string | null;
  sponsorship_type: string | null;
  start_date: string | null;
  end_date: string | null;
  invoice_id?: string | null;
  invoice_no?: string | null;
  invoice_sent_at?: string | null;
  invoice_drive_web_view_link?: string | null;
  grn_doc_number?: string | null;
  grn_drive_web_view_link?: string | null;
}

const formatDate = (dateStr: string | null): string => {
  if (!dateStr) return '-';
  const s = String(dateStr).trim();
  if (!s) return '-';
  if (/^\d{8}$/.test(s)) {
    const iso = `${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)}`;
    const d = new Date(iso);
    if (!isNaN(d.getTime())) {
      return d.toLocaleDateString('en-GB', { day: '2-digit', month: '2-digit', year: 'numeric' });
    }
  }
  const date = new Date(s);
  if (isNaN(date.getTime())) return s;
  return date.toLocaleDateString('en-GB', { day: '2-digit', month: '2-digit', year: 'numeric' });
};

const maskNric = (nric: string | null): string => {
  if (!nric) return '-';
  if (nric.length <= 4) return nric;
  return '****' + nric.slice(-4);
};

const statusColor = (status: string | null): string => {
  if (!status) return 'bg-gray-100 text-gray-800 dark:bg-gray-700 dark:text-gray-300';
  const s = status.toLowerCase();
  if (s.includes('completed') || s.includes('confirmed')) return 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300';
  if (s.includes('cancelled')) return 'bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-300';
  if (s.includes('rejected') || s.includes('refunded')) return 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400';
  if (s.includes('pending') || s.includes('ready')) return 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-300';
  if (s.includes('processing') || s.includes('approved')) return 'bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-300';
  return 'bg-gray-100 text-gray-800 dark:bg-gray-700 dark:text-gray-300';
};

const PAGE_SIZE = 20;

const fmtDuration = (s: number) => (s < 60 ? `${Math.ceil(s)}s` : `${Math.floor(s / 60)}m ${Math.ceil(s % 60)}s`);

async function pollInvoiceJobSettled(
  enrolmentId: string,
  timeoutMs: number
): Promise<{ outcome: 'done' | 'failed' | 'timeout'; jobRow?: Record<string, unknown> }> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const res = await fetch(`/api/finance/invoice-jobs/status?enrolmentId=${encodeURIComponent(enrolmentId)}`);
    const json = await res.json();
    const row = json?.data as Record<string, unknown> | null | undefined;
    if (row?.status === 'done') return { outcome: 'done', jobRow: row };
    if (row?.status === 'failed') return { outcome: 'failed', jobRow: row };
    await new Promise((r) => setTimeout(r, 1500));
  }
  return { outcome: 'timeout' };
}

const ProgressModal: React.FC<{
  show: boolean;
  done: boolean;
  succeeded: number;
  failed: number;
  total: number;
  startTime: number;
  verb: string;
  onClose: () => void;
}> = ({ show, done, succeeded, failed, total, startTime, verb, onClose }) => {
  if (!show) return null;
  const elapsed = (Date.now() - startTime) / 1000;
  const allFailed = done && succeeded === 0 && failed > 0;
  return (
    <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/60" style={{ backdropFilter: 'blur(8px)' }}>
      <div className="w-full max-w-md mx-4 rounded-2xl bg-white dark:bg-gray-800 shadow-2xl overflow-hidden border border-gray-200 dark:border-gray-700">
        <div className={`h-1 ${done ? (allFailed ? 'bg-red-500' : 'bg-emerald-500') : 'bg-amber-500'}`} />
        <div className="flex flex-col items-center pt-7 pb-2 px-6">
          <div className={`w-14 h-14 rounded-full flex items-center justify-center mb-4 ${done ? (allFailed ? 'bg-red-100 dark:bg-red-900/30' : 'bg-emerald-100 dark:bg-emerald-900/30') : 'bg-amber-100 dark:bg-amber-900/30'}`}>
            {done ? (
              allFailed ? (
                <svg className="w-7 h-7 text-red-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}><path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" /></svg>
              ) : (
                <svg className="w-7 h-7 text-emerald-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}><path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" /></svg>
              )
            ) : (
              <div className="animate-spin rounded-full h-7 w-7 border-[3px] border-amber-200 border-t-amber-500" />
            )}
          </div>
          <h3 className="text-base font-semibold text-gray-900 dark:text-white">
            {done ? (allFailed ? `${verb} failed` : `${verb} complete!`) : `${verb}…`}
          </h3>
          <p className="text-xs text-gray-500 dark:text-gray-400 mt-1 text-center">
            {done ? `Completed in ${fmtDuration(elapsed)}` : `Processing ${total} enrolment(s), please wait…`}
          </p>
        </div>
        <div className="px-6 pt-4 pb-2">
          <div className="w-full h-2 bg-gray-200 dark:bg-gray-700 rounded-full overflow-hidden">
            {done ? (
              <div className={`h-full rounded-full w-full ${allFailed ? 'bg-red-500' : 'bg-emerald-500'}`} />
            ) : (
              <div className="h-full w-full rounded-full overflow-hidden relative">
                <div className="absolute inset-0 bg-amber-200 dark:bg-amber-900/40" />
                <div className="absolute inset-0 bg-gradient-to-r from-transparent via-amber-400 to-transparent animate-pulse" style={{ backgroundSize: '200% 100%' }} />
              </div>
            )}
          </div>
        </div>
        {done && (
          <div className="px-6 pt-3 pb-1">
            <div className="flex rounded-lg border border-gray-200 dark:border-gray-600 divide-x divide-gray-200 dark:divide-gray-600 overflow-hidden">
              <div className="flex-1 py-3 text-center">
                <div className="text-base font-bold text-emerald-500">{succeeded}</div>
                <div className="text-[10px] text-gray-500 dark:text-gray-400 font-medium mt-0.5">Completed</div>
              </div>
              <div className="flex-1 py-3 text-center">
                <div className={`text-base font-bold ${failed > 0 ? 'text-red-400' : 'text-gray-400'}`}>{failed}</div>
                <div className="text-[10px] text-gray-500 dark:text-gray-400 font-medium mt-0.5">Issues</div>
              </div>
              <div className="flex-1 py-3 text-center">
                <div className="text-base font-bold text-gray-700 dark:text-gray-300">{fmtDuration(elapsed)}</div>
                <div className="text-[10px] text-gray-500 dark:text-gray-400 font-medium mt-0.5">Duration</div>
              </div>
            </div>
          </div>
        )}
        <div className="px-6 pt-4 pb-5">
          {done ? (
            <button
              type="button"
              onClick={onClose}
              className={`w-full py-2.5 rounded-lg text-white text-sm font-medium transition-colors ${allFailed ? 'bg-red-500 hover:bg-red-600' : 'bg-emerald-500 hover:bg-emerald-600'}`}
            >
              Done
            </button>
          ) : (
            <p className="text-center text-[11px] text-gray-500 dark:text-gray-400">Invoice details appear in the table when each job finishes.</p>
          )}
        </div>
      </div>
    </div>
  );
};

export const NonDaInvoiceView: React.FC = () => {
  const [rows, setRows] = useState<NonDaRow[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [selectedEnrolmentIds, setSelectedEnrolmentIds] = useState<string[]>([]);
  const [queueing, setQueueing] = useState(false);
  const [sending, setSending] = useState(false);
  const [syncToast, setSyncToast] = useState<string | null>(null);

  const [showGenProgress, setShowGenProgress] = useState(false);
  const [genDone, setGenDone] = useState(false);
  const [genSucceeded, setGenSucceeded] = useState(0);
  const [genFailed, setGenFailed] = useState(0);
  const [genTotal, setGenTotal] = useState(0);
  const [genStartTime, setGenStartTime] = useState(0);

  const [showSendProgress, setShowSendProgress] = useState(false);
  const [sendDone, setSendDone] = useState(false);
  const [sendSucceeded, setSendSucceeded] = useState(0);
  const [sendFailed, setSendFailed] = useState(0);
  const [sendTotal, setSendTotal] = useState(0);
  const [sendStartTime, setSendStartTime] = useState(0);

  const debounceRef = useRef<ReturnType<typeof setTimeout>>();

  useEffect(() => {
    debounceRef.current = setTimeout(() => {
      setDebouncedSearch(search);
      setPage(0);
    }, 300);
    return () => clearTimeout(debounceRef.current);
  }, [search]);

  const fetchData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({
        page: String(page),
        limit: String(PAGE_SIZE),
        sort: 'newest',
        scope: 'individualNonDa',
        includeFuture: '1',
      });
      if (debouncedSearch) params.set('search', debouncedSearch);
      if (statusFilter) params.set('status', statusFilter);
      const res = await fetch(`/api/finance/all-course-runs?${params}`);
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || 'Failed to fetch data');
      setRows(json.data.rows);
      setTotal(json.data.total);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to fetch data');
    } finally {
      setLoading(false);
    }
  }, [page, debouncedSearch, statusFilter]);

  useEffect(() => { fetchData(); }, [fetchData]);

  const statusOptions = Array.from(new Set(rows.map((r) => r.enrolment_status).filter((s): s is string => !!s))).sort();

  const pageEnrolmentIds = rows
    .filter((r) => !String(r.enrolment_status || '').toLowerCase().includes('cancelled'))
    .map((r) => r.enrolment_id)
    .filter((id): id is string => !!id?.trim());
  const allPageSelected = pageEnrolmentIds.length > 0 && pageEnrolmentIds.every((id) => selectedEnrolmentIds.includes(id));

  const toggleSelect = (enrolmentId: string | null) => {
    if (!enrolmentId?.trim()) return;
    const id = enrolmentId.trim();
    setSelectedEnrolmentIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  };

  const toggleSelectAll = () => {
    if (pageEnrolmentIds.length === 0) return;
    if (allPageSelected) {
      setSelectedEnrolmentIds((prev) => prev.filter((id) => !pageEnrolmentIds.includes(id)));
    } else {
      setSelectedEnrolmentIds((prev) => [...new Set([...prev, ...pageEnrolmentIds])]);
    }
  };

  // Every row on this page is guaranteed non-DA (server-side scope filter), so
  // this always calls the standard QuickBooks invoice-jobs pipeline directly —
  // never the DA pipeline.
  const generateInvoices = async () => {
    if (selectedEnrolmentIds.length === 0) return;

    setQueueing(true);
    setSyncToast(null);
    setShowGenProgress(true);
    setGenDone(false);
    setGenSucceeded(0);
    setGenFailed(0);
    setGenTotal(selectedEnrolmentIds.length);
    setGenStartTime(Date.now());

    try {
      const res = await fetch('/api/finance/invoice-jobs/enqueue', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ enrolmentIds: selectedEnrolmentIds }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || 'Queue failed');

      const results = Array.isArray(json.results) ? (json.results as { enrolmentId: string; ok: boolean; reason?: string }[]) : [];
      const queuedIds = results.filter((r) => r.ok).map((r) => r.enrolmentId);
      const skippedAtEnqueue = results.filter((r) => !r.ok).length;

      if (queuedIds.length === 0) {
        setGenFailed(skippedAtEnqueue || selectedEnrolmentIds.length);
        setGenDone(true);
        const detail = results.filter((r) => !r.ok).slice(0, 4).map((r) => `${r.enrolmentId}: ${r.reason || 'skipped'}`).join(' · ');
        setSyncToast(detail || 'No invoice jobs were queued for the selected enrolments.');
        await fetchData();
        return;
      }

      setGenTotal(queuedIds.length);
      const s = (v: unknown) => (v != null ? String(v).trim() : '');
      let done = 0;
      let pollFailed = 0;
      for (const eid of queuedIds) {
        const { outcome, jobRow } = await pollInvoiceJobSettled(eid, 180_000);
        if (outcome === 'done') {
          done += 1;
          setGenSucceeded(done);
          if (jobRow) {
            setRows((prev) => prev.map((r) =>
              r.enrolment_id?.toLowerCase().trim() === eid.toLowerCase().trim()
                ? {
                    ...r,
                    invoice_id: s(jobRow.qbo_invoice_id) || r.invoice_id,
                    invoice_no: s(jobRow.invoice_no) || s(jobRow.qbo_doc_number) || r.invoice_no,
                    grn_doc_number: s(jobRow.grn_doc_number) || r.grn_doc_number,
                    invoice_drive_web_view_link: s(jobRow.drive_web_view_link) || r.invoice_drive_web_view_link,
                    grn_drive_web_view_link: s(jobRow.grn_drive_web_view_link) || r.grn_drive_web_view_link,
                    invoice_sent_at: s(jobRow.invoice_sent_at) || r.invoice_sent_at,
                  }
                : r
            ));
          }
        } else {
          pollFailed += 1;
          setGenFailed(pollFailed + skippedAtEnqueue);
        }
      }
      const totalFailed = pollFailed + skippedAtEnqueue;
      setGenSucceeded(done);
      setGenFailed(totalFailed);
      setGenDone(true);
      await fetchData();
      const detail = skippedAtEnqueue > 0 ? ` ${skippedAtEnqueue} not queued (ineligible or already invoiced).` : '';
      setSyncToast(`Invoices: ${done} completed.${totalFailed ? ` ${totalFailed} issue(s).` : ''}${detail}`);
    } catch (e) {
      setGenFailed(selectedEnrolmentIds.length);
      setGenDone(true);
      setSyncToast(e instanceof Error ? e.message : 'Queue failed');
    } finally {
      setQueueing(false);
    }
  };

  const sendInvoices = async () => {
    if (selectedEnrolmentIds.length === 0) return;
    if (!window.confirm(`Send QuickBooks invoice email(s) for ${selectedEnrolmentIds.length} enrolment(s)?`)) return;

    setSending(true);
    setSyncToast(null);
    setShowSendProgress(true);
    setSendDone(false);
    setSendSucceeded(0);
    setSendFailed(0);
    setSendTotal(selectedEnrolmentIds.length);
    setSendStartTime(Date.now());

    try {
      const res = await fetch('/api/finance/invoice-jobs/send', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ enrolmentIds: selectedEnrolmentIds }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || 'Send failed');

      const summary = json.summary as { sent?: number; failed?: number; total?: number } | undefined;
      const sent = Number(summary?.sent ?? 0);
      const failed = Number(summary?.failed ?? 0);
      setSendSucceeded(sent);
      setSendFailed(failed);
      setSendTotal(Number(summary?.total ?? selectedEnrolmentIds.length));
      setSendDone(true);

      const detail = Array.isArray(json.results)
        ? (json.results as { enrolmentId: string; ok: boolean; error?: string }[])
            .filter((r) => !r.ok)
            .slice(0, 4)
            .map((r) => `${r.enrolmentId}: ${r.error || 'failed'}`)
            .join(' · ')
        : '';
      setSyncToast(`Emails sent: ${sent}.${failed ? ` ${failed} failed.` : ''}${detail ? ` ${detail}` : ''}`);
      await fetchData();
    } catch (e) {
      setSendFailed(selectedEnrolmentIds.length);
      setSendDone(true);
      setSyncToast(e instanceof Error ? e.message : 'Send failed');
    } finally {
      setSending(false);
    }
  };

  const totalPages = Math.ceil(total / PAGE_SIZE);
  const cell = 'px-3 py-2.5 text-xs whitespace-nowrap';
  const headerCell = 'px-3 py-2 font-medium text-on-surface-secondary text-xs whitespace-nowrap';

  return (
    <div className="space-y-6 relative">
      <div className="flex flex-col gap-1">
        <h2 className="text-2xl font-bold text-on-surface">Non-DA Invoice</h2>
        <p className="text-xs text-on-surface-secondary">
          Individual enrolments only — excludes Direct Application and Company Application rows. Generate / Send Invoice use the same non-DA QuickBooks pipeline as Consolidated Finance.
        </p>
      </div>

      <Card className="p-5">
        <div className="flex flex-col gap-4">
          <div className="flex flex-col sm:flex-row gap-3">
            <div className="relative flex-1">
              <Icon name={IconName.Search} className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-on-surface-secondary pointer-events-none" />
              <input
                type="text"
                placeholder="Search by trainee name, NRIC, enrolment ID, course title, course code…"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="w-full pl-10 pr-3 py-2.5 text-sm bg-surface border border-default rounded-lg focus:outline-none focus:ring-2 focus:ring-primary focus:border-transparent text-on-surface placeholder-gray-400"
              />
            </div>
            <select
              value={statusFilter}
              onChange={(e) => { setStatusFilter(e.target.value); setPage(0); }}
              className="px-3 py-2.5 text-sm bg-surface border border-default rounded-lg focus:outline-none focus:ring-2 focus:ring-primary text-on-surface min-w-[160px]"
            >
              <option value="">All Statuses</option>
              {statusOptions.map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
          </div>

          <div className="border-t border-default" />

          <div className="flex flex-col sm:flex-row sm:items-center gap-3">
            <div className="flex items-center gap-2 flex-wrap sm:ml-auto">
              {selectedEnrolmentIds.length > 0 && (
                <span className="text-xs text-on-surface-secondary px-2 py-1 rounded-full bg-surface border border-default font-medium">
                  {selectedEnrolmentIds.length} selected
                </span>
              )}
              <Button
                onClick={() => void generateInvoices()}
                disabled={queueing || sending || selectedEnrolmentIds.length === 0 || loading}
                className="gap-1.5"
              >
                {queueing
                  ? <><span className="inline-block w-3.5 h-3.5 border-2 border-white/40 border-t-white rounded-full animate-spin" />Generating…</>
                  : `Generate Invoice (${selectedEnrolmentIds.length})`}
              </Button>
              <Button
                variant="outline"
                onClick={() => void sendInvoices()}
                disabled={sending || queueing || selectedEnrolmentIds.length === 0 || loading}
              >
                {sending ? 'Sending…' : `Send invoice (${selectedEnrolmentIds.length})`}
              </Button>
            </div>
          </div>

          <p className="text-[11px] text-on-surface-secondary -mt-1">
            Select enrolments below, then Generate Invoice / Send invoice. Rows already invoiced or ineligible are skipped automatically.
          </p>
        </div>
      </Card>

      {syncToast && (
        <div className={`p-3 rounded-lg text-sm ${syncToast.toLowerCase().includes('failed') ? 'bg-red-50 dark:bg-red-900/20 text-red-700 dark:text-red-300' : 'bg-green-50 dark:bg-green-900/20 text-green-700 dark:text-green-300'}`}>
          {syncToast}
        </div>
      )}

      {error && (
        <div className="p-3 bg-red-50 dark:bg-red-900/20 text-red-700 dark:text-red-300 rounded-lg text-sm">{error}</div>
      )}

      <Card className="!overflow-visible">
        <div className="overflow-x-auto">
          <table className="w-full text-sm border-collapse">
            <thead>
              <tr className="border-b border-default bg-surface-elevated">
                <th className={`${headerCell} w-10 text-center`} title="Select enrolments, then Generate Invoice">
                  <input
                    type="checkbox"
                    className="rounded border-default"
                    checked={allPageSelected}
                    onChange={toggleSelectAll}
                    disabled={pageEnrolmentIds.length === 0 || loading}
                    aria-label="Select all enrolments on this page"
                  />
                </th>
                <th className={headerCell}>Enrolment ID</th>
                <th className={headerCell}>Trainee</th>
                <th className={headerCell}>ID</th>
                <th className={headerCell}>Course Title</th>
                <th className={headerCell}>Course Code</th>
                <th className={headerCell}>Start Date</th>
                <th className={headerCell}>Status</th>
                <th className={headerCell}>Invoice ID</th>
                <th className={headerCell}>Invoice No</th>
                <th className={headerCell}>GRN Ref</th>
                <th className={headerCell}>Sent</th>
                <th className={headerCell}>Cust Inv</th>
                <th className={headerCell}>GRN Inv</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td colSpan={13} className="px-4 py-12 text-center text-on-surface-secondary">
                  <div className="flex items-center justify-center gap-2">
                    <div className="animate-spin rounded-full h-5 w-5 border-b-2 border-primary" />
                    Loading enrolments...
                  </div>
                </td></tr>
              ) : rows.length === 0 ? (
                <tr><td colSpan={13} className="px-4 py-12 text-center text-on-surface-secondary">No individual non-DA enrolments found.</td></tr>
              ) : rows.map((r, i) => {
                const enrolmentKey = r.enrolment_id ?? `row-${i}`;
                const enrId = r.enrolment_id?.trim() || null;
                const isSelected = enrId ? selectedEnrolmentIds.includes(enrId) : false;
                const isSent = !!(r.invoice_sent_at && String(r.invoice_sent_at).trim());
                const isCancelled = String(r.enrolment_status || '').toLowerCase().includes('cancelled');
                const rowTint = isSent
                  ? 'bg-emerald-50/60 dark:bg-emerald-950/25'
                  : isSelected
                    ? 'bg-amber-50/90 dark:bg-amber-950/35'
                    : '';
                const hoverTint = isSent
                  ? 'hover:bg-emerald-50/70 dark:hover:bg-emerald-950/30'
                  : isSelected
                    ? 'hover:bg-amber-100/80 dark:hover:bg-amber-950/45'
                    : 'hover:bg-surface-hover';
                return (
                  <tr key={enrolmentKey} className={`border-b border-default transition-colors ${hoverTint} ${rowTint}`}>
                    <td className={`${cell} text-center align-middle`}>
                      <input
                        type="checkbox"
                        className="rounded border-default"
                        checked={isSelected}
                        onChange={() => toggleSelect(enrId)}
                        disabled={!enrId || loading || isSent || isCancelled}
                        aria-label={enrId ? `Select ${enrId}` : 'No enrolment id'}
                      />
                    </td>
                    <td className={`${cell} text-on-surface-secondary font-mono`}>{r.enrolment_id || '-'}</td>
                    <td className={`${cell} text-on-surface`}>{r.trainee_name || '-'}</td>
                    <td className={`${cell} text-on-surface-secondary font-mono`}>{maskNric(r.trainee_nric)}</td>
                    <td className={`${cell} text-on-surface max-w-[220px] truncate`} title={r.course_title || ''}>{r.course_title || '-'}</td>
                    <td className={`${cell} text-on-surface-secondary font-mono`}>{r.course_reference || '-'}</td>
                    <td className={`${cell} text-on-surface-secondary`}>{formatDate(r.start_date)}</td>
                    <td className={cell}>
                      <span className={`inline-block px-2 py-0.5 rounded-full text-xs font-medium ${statusColor(r.enrolment_status)}`}>
                        {r.enrolment_status || '-'}
                      </span>
                    </td>
                    <td className={`${cell} text-on-surface-secondary font-mono`}>{r.invoice_id || '-'}</td>
                    <td className={`${cell} text-on-surface-secondary font-mono`}>{r.invoice_no || '-'}</td>
                    <td className={`${cell} text-on-surface-secondary font-mono`}>{r.grn_doc_number || '-'}</td>
                    <td className={`${cell} text-on-surface-secondary`}>{r.invoice_sent_at ? formatDate(String(r.invoice_sent_at).slice(0, 10)) : '-'}</td>
                    <td className={cell}>
                      {r.invoice_drive_web_view_link ? (
                        <button
                          onClick={() => window.open(r.invoice_drive_web_view_link!, '_blank', 'noreferrer')}
                          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-semibold transition-colors bg-green-50 text-green-700 hover:bg-green-100 dark:bg-green-900/20 dark:text-green-400 dark:hover:bg-green-900/40"
                        >
                          <Icon name={IconName.ExternalLink} className="w-3.5 h-3.5" />
                          View
                        </button>
                      ) : <span className="text-on-surface-secondary">-</span>}
                    </td>
                    <td className={cell}>
                      {r.grn_drive_web_view_link ? (
                        <button
                          onClick={() => window.open(r.grn_drive_web_view_link!, '_blank', 'noreferrer')}
                          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-semibold transition-colors bg-blue-50 text-blue-700 hover:bg-blue-100 dark:bg-blue-900/20 dark:text-blue-400 dark:hover:bg-blue-900/40"
                        >
                          <Icon name={IconName.ExternalLink} className="w-3.5 h-3.5" />
                          View
                        </button>
                      ) : <span className="text-on-surface-secondary">-</span>}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        <div className="flex items-center justify-between px-4 py-3 border-t border-default bg-surface-elevated">
          <div className="text-sm text-on-surface-secondary">
            Showing {total === 0 ? 0 : page * PAGE_SIZE + 1}–{Math.min((page + 1) * PAGE_SIZE, total)} of {total.toLocaleString()}
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => setPage((p) => Math.max(0, p - 1))}
              disabled={page === 0}
              className="px-3 py-1.5 text-sm rounded-md border border-default bg-surface hover:bg-surface-hover disabled:opacity-50 disabled:cursor-not-allowed text-on-surface transition-colors"
            >
              Previous
            </button>
            <span className="text-sm text-on-surface-secondary">Page {page + 1} of {totalPages || 1}</span>
            <button
              onClick={() => setPage((p) => p + 1)}
              disabled={page >= totalPages - 1}
              className="px-3 py-1.5 text-sm rounded-md border border-default bg-surface hover:bg-surface-hover disabled:opacity-50 disabled:cursor-not-allowed text-on-surface transition-colors"
            >
              Next
            </button>
          </div>
        </div>
      </Card>

      <ProgressModal
        show={showGenProgress}
        done={genDone}
        succeeded={genSucceeded}
        failed={genFailed}
        total={genTotal}
        startTime={genStartTime}
        verb="Generating invoices"
        onClose={() => setShowGenProgress(false)}
      />
      <ProgressModal
        show={showSendProgress}
        done={sendDone}
        succeeded={sendSucceeded}
        failed={sendFailed}
        total={sendTotal}
        startTime={sendStartTime}
        verb="Sending invoices"
        onClose={() => setShowSendProgress(false)}
      />
    </div>
  );
};

export default NonDaInvoiceView;
