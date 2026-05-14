import React, { useState, useEffect, useCallback, useRef } from 'react';
import ReactDOM from 'react-dom';
import { Checkbox } from '../ui/Checkbox';
import { getLocalYMD } from '@/lib/dateHelpers';
import { Card } from '../ui/Card';
import { Button } from '../ui/Button';
import { Icon, IconName } from '../ui/Icon';
import { ssgFetch } from '../../lib/ssgAppState';

interface CourseRunRow {
  enrolment_id: string | null;
  trainee_name: string | null;
  trainee_nric: string | null;
  course_title: string | null;
  course_reference: string | null;
  course_run_id: string | null;
  enrolment_status: string | null;
  sponsorship_type: string | null;
  course_run_number: string | null;
  start_date: string | null;
  end_date: string | null;
  trainee_email: string | null;
  trainee_contact: string | null;
  trainee_dob: string | null;
  employer_uen: string | null;
  employer_name: string | null;
  employer_contact_name: string | null;
  employer_contact_email: string | null;
  employer_phone_country: string | null;
  employer_phone: string | null;
  fee_collection_status: string | null;
  total_grant_expected?: number | null;
  total_grant_received?: number | null;
  total_grant_pending?: number | null;
  grant_payment_status?: 'NOT_RECEIVED' | 'PARTIAL' | 'FULLY_PAID' | string | null;
  last_grant_import_at?: string | null;
  bl_grant_id: string | null;
  bl_status: string | null;
  bl_amount: number | null;
  nbl_grant_id: string | null;
  nbl_status: string | null;
  nbl_amount: number | null;
  nbl_scheme: string | null;
  sfc_claim_id: string | null;
  sfc_amount: number | null;
  sfc_payment_date: string | null;
  sfc_status: string | null;
  sfc_claim_payment_status?: string | null;
  sfc_qb_payment_id?: string | null;
  qbo_sfc_status?: string | null;
  invoice_id?: string | null;
  invoice_no?: string | null;
  invoice_sent_at?: string | null;
  grn_doc_number?: string | null;
  invoice_drive_web_view_link?: string | null;
  grn_drive_web_view_link?: string | null;
  is_da?: boolean | null;
}

interface Stats {
  totalEnrolments: number;
  totalBL: number;
  totalNBL: number;
  totalSFC: number;
  byStatus: { status: string; count: number }[];
}

const formatCurrency = (amount: number | null): string => {
  if (amount === null || amount === undefined) return '-';
  return `$${amount.toLocaleString('en-SG', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
};

const formatDate = (dateStr: string | null): string => {
  if (!dateStr) return '-';
  const s = String(dateStr).trim();
  if (!s) return '-';

  // Handle SSG-style dates like "20260418" (YYYYMMDD)
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
  if (s.includes('completed') || s.includes('disbursed') || s.includes('confirmed'))
    return 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300';
  if (s.includes('cancelled'))
    return 'bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-300';
  if (s.includes('rejected') || s.includes('refunded'))
    return 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400';
  if (s.includes('pending') || s.includes('ready'))
    return 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-300';
  if (s.includes('processing') || s.includes('approved') || s.includes('grant processing'))
    return 'bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-300';
  return 'bg-gray-100 text-gray-800 dark:bg-gray-700 dark:text-gray-300';
};

const grantPaymentBadge = (status: string | null | undefined): string => {
  const s = String(status || '').trim().toUpperCase();
  if (s === 'FULLY_PAID') return 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-300';
  if (s === 'PARTIAL') return 'bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-300';
  if (s === 'NOT_RECEIVED') return 'bg-gray-100 text-gray-800 dark:bg-gray-700 dark:text-gray-300';
  return 'bg-gray-100 text-gray-800 dark:bg-gray-700 dark:text-gray-300';
};

const PAGE_SIZE = 20;

const fmtInvDuration = (s: number) =>
  s < 60 ? `${Math.ceil(s)}s` : `${Math.floor(s / 60)}m ${Math.ceil(s % 60)}s`;

/** Poll until QB job finishes (async runner may take several seconds after enqueue). */
async function pollInvoiceJobSettled(
  enrolmentId: string,
  timeoutMs: number
): Promise<{ outcome: 'done' | 'failed' | 'timeout'; jobRow?: Record<string, unknown> }> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const res = await fetch(
      `/api/finance/invoice-jobs/status?enrolmentId=${encodeURIComponent(enrolmentId)}`
    );
    const json = await res.json();
    const row = json?.data as Record<string, unknown> | null | undefined;
    if (row?.status === 'done') return { outcome: 'done', jobRow: row };
    if (row?.status === 'failed') return { outcome: 'failed', jobRow: row };
    await new Promise((r) => setTimeout(r, 1500));
  }
  return { outcome: 'timeout' };
}

// Column group header styling
const groupHeaderColors: Record<string, string> = {
  course: 'bg-blue-50 dark:bg-blue-950 text-blue-700 dark:text-blue-300',
  trainee: 'bg-green-50 dark:bg-green-950 text-green-700 dark:text-green-300',
  sponsor: 'bg-purple-50 dark:bg-purple-950 text-purple-700 dark:text-purple-300',
  enrolment: 'bg-amber-50 dark:bg-amber-950 text-amber-700 dark:text-amber-300',
  bl: 'bg-indigo-50 dark:bg-indigo-950 text-indigo-700 dark:text-indigo-300',
  nbl: 'bg-teal-50 dark:bg-teal-950 text-teal-700 dark:text-teal-300',
  tg: 'bg-orange-50 dark:bg-orange-950 text-orange-700 dark:text-orange-300',
  sfc: 'bg-pink-50 dark:bg-pink-950 text-pink-700 dark:text-pink-300',
  grant_pay: 'bg-emerald-50 dark:bg-emerald-950 text-emerald-700 dark:text-emerald-300',
  fees: 'bg-gray-50 dark:bg-gray-900 text-gray-700 dark:text-gray-300',
};

/**
 * Fixed horizontal scrollbar pinned to the bottom of the viewport.
 * Rendered via portal to escape any overflow:hidden ancestors.
 * Syncs scroll position bidirectionally with the table container.
 */
const StickyScrollbar: React.FC<{ tableRef: React.RefObject<HTMLDivElement | null> }> = ({ tableRef }) => {
  const scrollbarRef = useRef<HTMLDivElement>(null);
  const innerRef = useRef<HTMLDivElement>(null);
  const syncing = useRef(false);
  const [portalTarget, setPortalTarget] = useState<HTMLElement | null>(null);
  const [style, setStyle] = useState<React.CSSProperties>({ display: 'none' });

  // Create portal container on mount
  useEffect(() => {
    const el = document.createElement('div');
    el.id = 'sticky-scrollbar-portal';
    document.body.appendChild(el);
    setPortalTarget(el);
    return () => { if (document.body.contains(el)) document.body.removeChild(el); };
  }, []);

  useEffect(() => {
    const table = tableRef.current;
    const scrollbar = scrollbarRef.current;
    const inner = innerRef.current;
    if (!table || !scrollbar || !inner) return;

    const update = () => {
      const rect = table.getBoundingClientRect();
      const scrollW = table.scrollWidth;
      const clientW = table.clientWidth;
      inner.style.width = `${scrollW}px`;

      const overflows = scrollW > clientW;
      // Hide when table bottom scrollbar is already visible in viewport
      const nativeScrollbarVisible = rect.bottom <= window.innerHeight;

      if (overflows && !nativeScrollbarVisible) {
        setStyle({
          position: 'fixed',
          bottom: 0,
          left: rect.left,
          width: rect.width,
          height: 18,
          zIndex: 9999,
          overflowX: 'auto',
          overflowY: 'hidden',
          background: '#0f172a',
        });
      } else {
        setStyle({ display: 'none' });
      }
    };

    const syncToScrollbar = () => {
      if (syncing.current) return;
      syncing.current = true;
      scrollbar.scrollLeft = table.scrollLeft;
      requestAnimationFrame(() => { syncing.current = false; });
    };

    const syncToTable = () => {
      if (syncing.current) return;
      syncing.current = true;
      table.scrollLeft = scrollbar.scrollLeft;
      requestAnimationFrame(() => { syncing.current = false; });
    };

    table.addEventListener('scroll', syncToScrollbar);
    scrollbar.addEventListener('scroll', syncToTable);
    window.addEventListener('scroll', update, { passive: true });
    window.addEventListener('resize', update);
    update();

    return () => {
      table.removeEventListener('scroll', syncToScrollbar);
      scrollbar.removeEventListener('scroll', syncToTable);
      window.removeEventListener('scroll', update);
      window.removeEventListener('resize', update);
    };
  }, [tableRef, portalTarget]);

  if (!portalTarget) return null;

  return ReactDOM.createPortal(
    <div ref={scrollbarRef} style={style}>
      <div ref={innerRef} style={{ height: 1 }} />
    </div>,
    portalTarget
  );
};

/**
 * Fixed header clone pinned below the site nav (64px).
 * Clones the real thead's HTML into a fixed container via portal.
 * Syncs horizontal scroll with the table body.
 */
const StickyHeader: React.FC<{
  tableRef: React.RefObject<HTMLDivElement | null>;
  theadRef: React.RefObject<HTMLTableSectionElement | null>;
}> = ({ tableRef, theadRef }) => {
  const cloneRef = useRef<HTMLDivElement>(null);
  const [portalTarget, setPortalTarget] = useState<HTMLElement | null>(null);
  const [visible, setVisible] = useState(false);
  const [style, setStyle] = useState<React.CSSProperties>({});

  useEffect(() => {
    const el = document.createElement('div');
    el.id = 'sticky-header-portal';
    document.body.appendChild(el);
    setPortalTarget(el);
    return () => { if (document.body.contains(el)) document.body.removeChild(el); };
  }, []);

  useEffect(() => {
    const table = tableRef.current;
    const thead = theadRef.current;
    const clone = cloneRef.current;
    if (!table || !thead || !clone || !portalTarget) return;

    const SITE_HEADER_HEIGHT = 64;

    const update = () => {
      const tableRect = table.getBoundingClientRect();
      const theadRect = thead.getBoundingClientRect();

      // Show when real header scrolls behind site nav
      const shouldShow = theadRect.top < SITE_HEADER_HEIGHT && tableRect.bottom > SITE_HEADER_HEIGHT + 100;

      setVisible(shouldShow);
      if (shouldShow) {
        setStyle({
          position: 'fixed',
          top: SITE_HEADER_HEIGHT,
          left: tableRect.left,
          width: tableRect.width,
          zIndex: 25,
          overflow: 'hidden',
        });

        // Clone thead content and sync column widths
        const realCells = thead.querySelectorAll('th');
        clone.innerHTML = '';
        const cloneTable = document.createElement('table');
        cloneTable.className = 'w-full text-sm border-collapse';
        cloneTable.style.width = `${table.scrollWidth}px`;
        cloneTable.style.marginLeft = `-${table.scrollLeft}px`;
        const cloneThead = thead.cloneNode(true) as HTMLTableSectionElement;
        cloneTable.appendChild(cloneThead);
        clone.appendChild(cloneTable);

        // Match widths from real header
        const cloneCells = cloneThead.querySelectorAll('th');
        realCells.forEach((cell, i) => {
          if (cloneCells[i]) {
            (cloneCells[i] as HTMLElement).style.width = `${cell.getBoundingClientRect().width}px`;
            (cloneCells[i] as HTMLElement).style.minWidth = `${cell.getBoundingClientRect().width}px`;
          }
        });
      }
    };

    const syncScroll = () => {
      if (!cloneRef.current) return;
      const innerTable = cloneRef.current.querySelector('table');
      if (innerTable) {
        innerTable.style.marginLeft = `-${table.scrollLeft}px`;
      }
    };

    table.addEventListener('scroll', syncScroll);
    window.addEventListener('scroll', update, { passive: true });
    window.addEventListener('resize', update);
    update();

    return () => {
      table.removeEventListener('scroll', syncScroll);
      window.removeEventListener('scroll', update);
      window.removeEventListener('resize', update);
    };
  }, [tableRef, theadRef, portalTarget]);

  if (!portalTarget) return null;

  return ReactDOM.createPortal(
    <div
      ref={cloneRef}
      style={{
        ...style,
        display: visible ? 'block' : 'none',
        boxShadow: '0 2px 8px rgba(0,0,0,0.3)',
      }}
    />,
    portalTarget
  );
};

const TOTAL_COLS = 42; // update if headers change

const AllCourseRunsView: React.FC = () => {
  const [search, setSearch] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  /** When false (default), list + KPIs only include course runs with start date on or before today (Singapore). */
  const [includeFutureCourseRuns, setIncludeFutureCourseRuns] = useState(false);
  const [viewFrom, setViewFrom] = useState(''); // start date (course run)
  const [viewTo, setViewTo] = useState(''); // start date (course run)
  const [sortOrder, setSortOrder] = useState<'newest' | 'oldest'>('newest');
  const [page, setPage] = useState(0);
  const [rows, setRows] = useState<CourseRunRow[]>([]);
  const [total, setTotal] = useState(0);
  const [stats, setStats] = useState<Stats | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [syncing, setSyncing] = useState(false);
  const [syncingGrnPdfs, setSyncingGrnPdfs] = useState(false);
  const [syncToast, setSyncToast] = useState<string | null>(null);
  // Import Course Run modal (Finance)
  const [showImportModal, setShowImportModal] = useState(false);
  const [importRunId, setImportRunId] = useState('');
  const [importLoading, setImportLoading] = useState(false);
  const [importResult, setImportResult] = useState<{ success: boolean; message: string; detail?: string } | null>(null);
  const [selectedEnrolmentIds, setSelectedEnrolmentIds] = useState<string[]>([]);
  const [queueing, setQueueing] = useState(false);
  const [sending, setSending] = useState(false);
  const [showFmsInvProgress, setShowFmsInvProgress] = useState(false);
  const [fmsInvProgressDone, setFmsInvProgressDone] = useState(false);
  const [fmsInvProgressSucceeded, setFmsInvProgressSucceeded] = useState(0);
  const [fmsInvProgressFailed, setFmsInvProgressFailed] = useState(0);
  const [fmsInvProgressTotal, setFmsInvProgressTotal] = useState(0);
  const [fmsInvProgressStartTime, setFmsInvProgressStartTime] = useState(0);
  const [showFmsSendProgress, setShowFmsSendProgress] = useState(false);
  const [fmsSendDone, setFmsSendDone] = useState(false);
  const [fmsSendSucceeded, setFmsSendSucceeded] = useState(0);
  const [fmsSendFailed, setFmsSendFailed] = useState(0);
  const [fmsSendTotal, setFmsSendTotal] = useState(0);
  const [fmsSendStartTime, setFmsSendStartTime] = useState(0);
  const lastVerifiedIdsRef = useRef<string>('');
  const backfillRanRef = useRef(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout>>();
  const tableScrollRef = useRef<HTMLDivElement>(null);
  const theadRef = useRef<HTMLTableSectionElement>(null);

  // Debounce search
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
      const params = new URLSearchParams({ page: String(page), limit: String(PAGE_SIZE), sort: sortOrder });
      if (debouncedSearch) params.set('search', debouncedSearch);
      if (statusFilter) params.set('status', statusFilter);
      if (includeFutureCourseRuns) params.set('includeFuture', '1');
      if (viewFrom) params.set('startFrom', viewFrom);
      if (viewTo) params.set('startTo', viewTo);
      const res = await fetch(`/api/finance/all-course-runs?${params}`);
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || 'Failed to fetch data');
      setRows(json.data.rows);
      setTotal(json.data.total);
      setStats(json.data.stats);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to fetch data');
    } finally {
      setLoading(false);
    }
  }, [page, debouncedSearch, statusFilter, sortOrder, includeFutureCourseRuns, viewFrom, viewTo]);

  useEffect(() => { fetchData(); }, [fetchData]);

  // On first mount: silently backfill QB invoice IDs for all enrolments missing one.
  // Pass 1 fixes local status issues; Pass 2 searches by DocNumber; Pass 3 bulk-scans QB.
  // Refreshes the table automatically when any IDs are linked.
  useEffect(() => {
    if (backfillRanRef.current) return;
    backfillRanRef.current = true;
    void (async () => {
      try {
        const res = await fetch('/api/finance/invoice-jobs/backfill-from-qb', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
        });
        const json = await res.json();
        if (!res.ok || !json?.success) return;
        const d = json.data as { localFixed: number; pass2Resolved: number; pass3Resolved: number; total: number };
        if ((d.total ?? 0) > 0) await fetchData();
      } catch {
        // silent — never blocks the UI
      }

      // Also backfill GRN invoice PDFs (NON-DA_GRANT_QB_invoice_{grnRef}.pdf) to Drive.
      try {
        const grnRes = await fetch('/api/finance/invoice-jobs/backfill-grn-drive', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
        });
        const grnJson = await grnRes.json();
        if (grnRes.ok && grnJson?.data?.resolved > 0) await fetchData();
      } catch {
        // silent
      }
    })();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // After each data load, silently verify that recorded QB invoices still exist.
  // Uses lastVerifiedIdsRef to avoid re-checking the same set of invoices twice
  // (prevents infinite loops when a cleared invoice triggers a re-fetch).
  useEffect(() => {
    if (loading) return;

    const invoicedIds = rows
      .filter((r) => r.invoice_id && r.enrolment_id)
      .map((r) => r.enrolment_id as string)
      .slice(0, 30);

    const idsKey = invoicedIds.slice().sort().join(',');

    // Skip if this exact set of invoice IDs was already checked
    if (!idsKey || idsKey === lastVerifiedIdsRef.current) return;
    lastVerifiedIdsRef.current = idsKey;

    void (async () => {
      try {
        const res = await fetch('/api/finance/invoice-jobs/verify-qb', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ enrolmentIds: invoicedIds }),
        });
        const json = await res.json();
        if (res.ok && json?.data?.cleared > 0) {
          await fetchData();
        }
      } catch {
        // Silent — verification is best-effort, never blocks the UI
      }
    })();
  }, [rows, loading, fetchData]);

  useEffect(() => {
    if (!syncToast) return;
    const t = setTimeout(() => setSyncToast(null), 8000);
    return () => clearTimeout(t);
  }, [syncToast]);

  const handleImportRun = async () => {
    const runId = importRunId.trim();
    if (!runId) return;
    setImportLoading(true);
    setImportResult(null);
    try {
      const response = await ssgFetch('/api/finance/import-course-run', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ course_run_id: runId }),
      });
      const result = await response.json();
      if (result.success) {
        const { courseTitle, courseRunId: savedRunId, startDate, endDate, action } = result.data;
        setImportResult({
          success: true,
          message: `Course run ${action === 'created' ? 'added' : 'updated'} successfully.`,
          detail: `${courseTitle} (Run ID: ${savedRunId}, ${startDate ?? 'N/A'} → ${endDate ?? 'N/A'})`,
        });
        await fetchData();
      } else {
        setImportResult({ success: false, message: result.error || 'Import failed.' });
      }
    } catch {
      setImportResult({ success: false, message: 'Network error. Please try again.' });
    } finally {
      setImportLoading(false);
    }
  };

  const runSync = async () => {
    setSyncing(true);
    setSyncToast(null);
    lastVerifiedIdsRef.current = ''; // allow re-verification after SSG sync
    try {
      const todayIso = getLocalYMD(new Date());
      const defaultFromIso = getLocalYMD(new Date(Date.now() - 30 * 86400_000));
      const oneYearAheadIso = getLocalYMD(new Date(Date.now() + 365 * 86400_000));

      const rawFrom = viewFrom || defaultFromIso;
      const rawTo = viewTo || (includeFutureCourseRuns ? oneYearAheadIso : todayIso);
      const from = rawFrom <= rawTo ? rawFrom : rawTo;
      const to = rawFrom <= rawTo ? rawTo : rawFrom;

      if (viewFrom && viewTo && (from !== viewFrom || to !== viewTo)) {
        setViewFrom(from);
        setViewTo(to);
      }
      const enrolmentIds = rows.map((r) => r.enrolment_id).filter((id): id is string => !!id);
      const res = await ssgFetch('/api/finance/sync-all-course-runs-from-ssg', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ from, to, enrolmentIds }),
      });
      const json = await res.json();
      if (!res.ok) {
        const issues = Array.isArray(json.credentialIssues) ? json.credentialIssues.join(' · ') : '';
        throw new Error([json.error || 'Sync failed', issues].filter(Boolean).join(' — '));
      }
      const up = json?.totals?.upsertedEnrolments ?? 0;
      const byId = json?.totals?.refreshedByEnrolmentId ?? 0;
      const gr = json?.totals?.enrolmentsForGrantRefresh ?? 0;
      const cb = json?.totals?.claimsEnrollmentIdBackfilled ?? 0;
      const errList = Array.isArray(json.errors) ? json.errors : [];
      const errTail =
        errList.length > 0
          ? ` — ${errList.length} SSG warning(s); first: ${errList[0]?.error ?? JSON.stringify(errList[0])}`
          : '';
      const extraLocal = Number(json?.extraLocalEnrolmentIdsMerged ?? 0);
      const modeHint =
        json?.syncMode === 'viewOnly'
          ? ` Fast mode: skipped slow per–course-run SSG search.${extraLocal > 0 ? ` Also refreshed ${extraLocal} recent local enrolment(s) not on this page.` : ''}`
          : '';
      setSyncToast(
        `Synced ${up} enrolment row(s) (${byId} from visible list via SSG view), refreshed grants for ${gr}, backfilled ${cb} claim link(s).${modeHint}${errTail}`
      );
      await fetchData();
    } catch (e) {
      setSyncToast(e instanceof Error ? e.message : 'Sync failed');
    } finally {
      setSyncing(false);
    }
  };

  const syncGrnPdfs = async () => {
    setSyncingGrnPdfs(true);
    setSyncToast(null);
    try {
      const res = await fetch('/api/finance/invoice-jobs/backfill-grn-drive', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || 'Sync failed');
      const d = json.data as { resolved: number; failed: number; total: number; failedRefs?: string[] };
      if (d.total === 0) {
        setSyncToast('GRN PDFs: all up to date — no pending rows found.');
      } else if (d.resolved > 0) {
        setSyncToast(`GRN PDFs: ${d.resolved} uploaded to Drive.${d.failed > 0 ? ` ${d.failed} could not be found in QuickBooks.` : ''}`);
        await fetchData();
      } else {
        const hint = d.failedRefs && d.failedRefs.length > 0 ? ` (${d.failedRefs.slice(0, 3).join(', ')})` : '';
        setSyncToast(`GRN PDFs: ${d.failed} invoice(s) not found in QuickBooks${hint}. Check that GRN invoices exist in QB.`);
      }
    } catch (e) {
      setSyncToast(e instanceof Error ? e.message : 'GRN PDF sync failed');
    } finally {
      setSyncingGrnPdfs(false);
    }
  };

  const pageEnrolmentIds = rows.map((r) => r.enrolment_id).filter((id): id is string => !!id?.trim());
  const allPageSelected =
    pageEnrolmentIds.length > 0 && pageEnrolmentIds.every((id) => selectedEnrolmentIds.includes(id));

  const toggleSelectEnrolment = (enrolmentId: string | null) => {
    if (!enrolmentId?.trim()) return;
    const id = enrolmentId.trim();
    setSelectedEnrolmentIds((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]
    );
  };

  const toggleSelectAllOnPage = () => {
    if (pageEnrolmentIds.length === 0) return;
    if (allPageSelected) {
      setSelectedEnrolmentIds((prev) => prev.filter((id) => !pageEnrolmentIds.includes(id)));
    } else {
      setSelectedEnrolmentIds((prev) => [...new Set([...prev, ...pageEnrolmentIds])]);
    }
  };

  const queueQboInvoices = async () => {
    if (selectedEnrolmentIds.length === 0) return;

    setQueueing(true);
    setSyncToast(null);
    setShowFmsInvProgress(true);
    setFmsInvProgressDone(false);
    setFmsInvProgressSucceeded(0);
    setFmsInvProgressFailed(0);
    setFmsInvProgressTotal(selectedEnrolmentIds.length);
    setFmsInvProgressStartTime(Date.now());

    try {
      const res = await fetch('/api/finance/invoice-jobs/enqueue', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ enrolmentIds: selectedEnrolmentIds }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || 'Queue failed');

      const results = Array.isArray(json.results)
        ? (json.results as { enrolmentId: string; ok: boolean; reason?: string }[])
        : [];
      const queuedIds = results.filter((r) => r.ok).map((r) => r.enrolmentId);
      const skippedAtEnqueue = results.filter((r) => !r.ok).length;

      if (queuedIds.length === 0) {
        setFmsInvProgressFailed(skippedAtEnqueue || selectedEnrolmentIds.length);
        setFmsInvProgressSucceeded(0);
        setFmsInvProgressDone(true);
        const detail = results
          .filter((r) => !r.ok)
          .slice(0, 4)
          .map((r) => `${r.enrolmentId}: ${r.reason || 'skipped'}`)
          .join(' · ');
        setSyncToast(detail || 'No invoice jobs were queued for the selected enrolments.');
        await fetchData();
        return;
      }

      setFmsInvProgressTotal(queuedIds.length);

      const s = (v: unknown) => v != null ? String(v).trim() : '';
      let done = 0;
      let pollFailed = 0;
      for (const eid of queuedIds) {
        const { outcome, jobRow } = await pollInvoiceJobSettled(eid, 180_000);
        if (outcome === 'done') {
          done += 1;
          setFmsInvProgressSucceeded(done);
          if (jobRow) {
            setRows(prev => prev.map(r =>
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
          setFmsInvProgressFailed(pollFailed + skippedAtEnqueue);
        }
      }
      const totalFailed = pollFailed + skippedAtEnqueue;

      setFmsInvProgressSucceeded(done);
      setFmsInvProgressFailed(totalFailed);
      setFmsInvProgressDone(true);
      await fetchData();

      const detail =
        skippedAtEnqueue > 0 ? ` ${skippedAtEnqueue} not queued (ineligible or already invoiced).` : '';
      setSyncToast(`QB invoices: ${done} completed.${totalFailed ? ` ${totalFailed} issue(s).` : ''}${detail}`);
    } catch (e) {
      setFmsInvProgressFailed(selectedEnrolmentIds.length);
      setFmsInvProgressDone(true);
      setSyncToast(e instanceof Error ? e.message : 'Queue failed');
    } finally {
      setQueueing(false);
    }
  };

  const sendQbInvoices = async () => {
    if (selectedEnrolmentIds.length === 0) return;
    if (!window.confirm(`Send QuickBooks invoice email(s) for ${selectedEnrolmentIds.length} enrolment(s)?`)) return;

    setSending(true);
    setSyncToast(null);
    setShowFmsSendProgress(true);
    setFmsSendDone(false);
    setFmsSendSucceeded(0);
    setFmsSendFailed(0);
    setFmsSendTotal(selectedEnrolmentIds.length);
    setFmsSendStartTime(Date.now());

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
      setFmsSendSucceeded(sent);
      setFmsSendFailed(failed);
      setFmsSendTotal(Number(summary?.total ?? selectedEnrolmentIds.length));
      setFmsSendDone(true);

      const detail = Array.isArray(json.results)
        ? (json.results as { enrolmentId: string; ok: boolean; error?: string }[])
            .filter((r) => !r.ok)
            .slice(0, 4)
            .map((r) => `${r.enrolmentId}: ${r.error || 'failed'}`)
            .join(' · ')
        : '';
      setSyncToast(`QB emails sent: ${sent}.${failed ? ` ${failed} failed.` : ''}${detail ? ` ${detail}` : ''}`);

      await fetchData();
    } catch (e) {
      setFmsSendFailed(selectedEnrolmentIds.length);
      setFmsSendDone(true);
      setSyncToast(e instanceof Error ? e.message : 'Send failed');
    } finally {
      setSending(false);
    }
  };

  const totalPages = Math.ceil(total / PAGE_SIZE);
  const statusOptions = stats?.byStatus.map(s => s.status) ?? [];
  const searchedCrId = debouncedSearch.trim();
  const looksLikeCourseRunId = /^\d{6,12}$/.test(searchedCrId);
  const shouldSuggestImport = !loading && rows.length === 0 && looksLikeCourseRunId;

  const cell = 'px-3 py-2.5 text-xs whitespace-nowrap';
  const headerCell = 'px-3 py-2 font-medium text-on-surface-secondary text-xs whitespace-nowrap';

  return (
    <div className="space-y-6 relative">
      {/* Header */}
      <div className="flex flex-col gap-1 sm:flex-row sm:items-baseline sm:justify-between">
        <h2 className="text-2xl font-bold text-on-surface">Consolidated Finance Data</h2>
        {!includeFutureCourseRuns && (
          <p className="text-xs text-on-surface-secondary">
            Showing enrolments through today (Singapore time). Tick “Include future course runs” for all dates.
          </p>
        )}
      </div>

      {/* KPI Cards */}
      {stats && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <Card className="p-4 text-center">
            <p className="text-3xl font-bold text-blue-600">{stats.totalEnrolments.toLocaleString()}</p>
            <p className="text-xs text-gray-600 dark:text-gray-300 mt-1">Total Enrolments</p>
          </Card>
          <Card className="p-4 text-center">
            <p className="text-3xl font-bold text-indigo-600">{formatCurrency(stats.totalBL)}</p>
            <p className="text-xs text-gray-600 dark:text-gray-300 mt-1">Total BL Grants</p>
          </Card>
          <Card className="p-4 text-center">
            <p className="text-3xl font-bold text-teal-600">{formatCurrency(stats.totalNBL)}</p>
            <p className="text-xs text-gray-600 dark:text-gray-300 mt-1">Total Non-BL Grants</p>
          </Card>
          <Card className="p-4 text-center">
            <p className="text-3xl font-bold text-pink-600">{formatCurrency(stats.totalSFC)}</p>
            <p className="text-xs text-gray-600 dark:text-gray-300 mt-1">Total SFC Claims</p>
          </Card>
        </div>
      )}

      {/* Search + Filter */}
      <Card className="p-5">
        <div className="flex flex-col gap-5">

          {/* Row 1: Search + dropdowns */}
          <div className="flex flex-col sm:flex-row gap-3">
            <div className="relative flex-1">
              <Icon name={IconName.Search} className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-on-surface-secondary pointer-events-none" />
              <input
                type="text"
                placeholder="Search by trainee name, NRIC, enrolment ID, course title, course code…"
                value={search}
                onChange={e => setSearch(e.target.value)}
                className="w-full pl-10 pr-3 py-2.5 text-sm bg-surface border border-default rounded-lg focus:outline-none focus:ring-2 focus:ring-primary focus:border-transparent text-on-surface placeholder-gray-400"
              />
            </div>
            <select
              value={statusFilter}
              onChange={e => { setStatusFilter(e.target.value); setPage(0); }}
              className="px-3 py-2.5 text-sm bg-surface border border-default rounded-lg focus:outline-none focus:ring-2 focus:ring-primary text-on-surface min-w-[140px]"
            >
              <option value="">All Statuses</option>
              {statusOptions.map(s => (
                <option key={s} value={s}>{s}</option>
              ))}
            </select>
            <select
              value={sortOrder}
              onChange={e => { setSortOrder(e.target.value as 'newest' | 'oldest'); setPage(0); }}
              className="px-3 py-2.5 text-sm bg-surface border border-default rounded-lg focus:outline-none focus:ring-2 focus:ring-primary text-on-surface min-w-[140px]"
            >
              <option value="newest">Newest First</option>
              <option value="oldest">Oldest First</option>
            </select>
          </div>

          {/* Divider */}
          <div className="border-t border-default" />

          {/* Row 2: Date range + quick shortcuts + Include future */}
          <div className="flex flex-col sm:flex-row sm:items-end gap-4">
            <div className="flex gap-3 flex-1">
              <div className="flex-1 min-w-0">
                <label className="block text-xs font-semibold text-on-surface-secondary mb-1.5 uppercase tracking-wide">Start from</label>
                <input
                  type="date"
                  value={viewFrom}
                  onChange={(e) => { setViewFrom(e.target.value); setPage(0); }}
                  className="w-full px-3 py-2.5 text-sm bg-surface border border-default rounded-lg focus:outline-none focus:ring-2 focus:ring-primary text-on-surface"
                />
              </div>
              <div className="flex items-end pb-2.5 text-on-surface-secondary text-sm">→</div>
              <div className="flex-1 min-w-0">
                <label className="block text-xs font-semibold text-on-surface-secondary mb-1.5 uppercase tracking-wide">Start to</label>
                <input
                  type="date"
                  value={viewTo}
                  onChange={(e) => { setViewTo(e.target.value); setPage(0); }}
                  className="w-full px-3 py-2.5 text-sm bg-surface border border-default rounded-lg focus:outline-none focus:ring-2 focus:ring-primary text-on-surface"
                />
              </div>
            </div>

            <div className="flex items-center gap-2 flex-wrap">
              <button
                type="button"
                onClick={() => {
                  setViewFrom(getLocalYMD(new Date(Date.now() - 30 * 86400_000)));
                  setViewTo(getLocalYMD(new Date()));
                  setPage(0);
                }}
                disabled={syncing || loading || queueing}
                className="px-3 py-2 text-xs font-medium rounded-md border border-default bg-surface hover:bg-surface-hover text-on-surface disabled:opacity-40 transition-colors"
              >
                Last 30 days
              </button>
              <button
                type="button"
                onClick={() => { setViewFrom(''); setViewTo(''); setPage(0); }}
                disabled={syncing || loading || queueing}
                className="px-3 py-2 text-xs font-medium rounded-md border border-default bg-surface hover:bg-surface-hover text-on-surface disabled:opacity-40 transition-colors"
              >
                Clear
              </button>
              <label className="flex items-center gap-2 text-sm text-on-surface cursor-pointer select-none ml-1">
                <input
                  type="checkbox"
                  checked={includeFutureCourseRuns}
                  onChange={(e) => { setIncludeFutureCourseRuns(e.target.checked); setPage(0); }}
                  className="rounded border-default w-4 h-4"
                />
                <span className="whitespace-nowrap">Include future</span>
              </label>
            </div>
          </div>

          {/* Divider */}
          <div className="border-t border-default" />

          {/* Row 3: Actions */}
          <div className="flex flex-col sm:flex-row sm:items-center gap-3">
            {/* Left: data actions */}
            <div className="flex items-center gap-2 flex-wrap">
              <Button onClick={() => void runSync()} disabled={syncing || queueing} className="gap-1.5">
                {syncing
                  ? <><span className="inline-block w-3.5 h-3.5 border-2 border-white/40 border-t-white rounded-full animate-spin" />Refreshing…</>
                  : 'Refresh from SSG'
                }
              </Button>
              <Button
                variant="outline"
                onClick={() => {
                  setShowImportModal(true);
                  setImportResult(null);
                  setImportRunId(searchedCrId || '');
                }}
                disabled={syncing || loading || queueing || sending}
              >
                Import course run
              </Button>
              <Button
                variant="outline"
                onClick={() => void syncGrnPdfs()}
                disabled={syncingGrnPdfs || syncing || loading || queueing}
              >
                {syncingGrnPdfs ? 'Syncing GRN PDFs…' : 'Sync GRN PDFs'}
              </Button>
            </div>

            {/* Vertical separator */}
            <div className="hidden sm:block h-8 w-px bg-default mx-1" />

            {/* Right: invoice actions */}
            <div className="flex items-center gap-2 flex-wrap sm:ml-auto">
              {selectedEnrolmentIds.length > 0 && (
                <span className="text-xs text-on-surface-secondary px-2 py-1 rounded-full bg-surface border border-default font-medium">
                  {selectedEnrolmentIds.length} selected
                </span>
              )}
              <Button
                onClick={() => void queueQboInvoices()}
                disabled={queueing || sending || selectedEnrolmentIds.length === 0 || loading}
                className="gap-1.5"
              >
                {queueing
                  ? <><span className="inline-block w-3.5 h-3.5 border-2 border-white/40 border-t-white rounded-full animate-spin" />Queueing…</>
                  : `Queue QB invoices (${selectedEnrolmentIds.length})`
                }
              </Button>
              <Button
                variant="outline"
                onClick={() => void sendQbInvoices()}
                disabled={sending || queueing || selectedEnrolmentIds.length === 0 || loading}
              >
                {sending ? 'Sending…' : `Send invoice (${selectedEnrolmentIds.length})`}
              </Button>
            </div>
          </div>

          {/* Helper text */}
          <p className="text-[11px] text-on-surface-secondary -mt-2">
            Select enrolments from the table below, then use "Queue QB invoices" to generate invoices. Rows already invoiced or ineligible are automatically skipped.
          </p>

        </div>
      </Card>

      {syncToast && (
        <div className={`p-3 rounded-lg text-sm ${syncToast.toLowerCase().includes('failed') ? 'bg-red-50 dark:bg-red-900/20 text-red-700 dark:text-red-300' : 'bg-green-50 dark:bg-green-900/20 text-green-700 dark:text-green-300'}`}>
          {syncToast}
        </div>
      )}

      {shouldSuggestImport && (
        <div className="p-3 rounded-lg text-sm bg-amber-50 dark:bg-amber-900/20 text-amber-800 dark:text-amber-200 border border-amber-200 dark:border-amber-800">
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
            <div>
              <div className="font-medium">No results for Course Run ID {searchedCrId}.</div>
              <div className="text-[11px] opacity-80">You can import it from SSG into the local database, then retry the search.</div>
            </div>
            <button
              type="button"
              className="px-3 py-1.5 rounded-md bg-amber-600 hover:bg-amber-700 text-white text-sm font-medium disabled:opacity-50"
              onClick={() => {
                setShowImportModal(true);
                setImportResult(null);
                setImportRunId(searchedCrId);
              }}
              disabled={syncing || loading || queueing || sending}
            >
              Import {searchedCrId}
            </button>
          </div>
        </div>
      )}


      {/* Error */}
      {error && (
        <div className="p-3 bg-red-50 dark:bg-red-900/20 text-red-700 dark:text-red-300 rounded-lg text-sm">
          {error}
        </div>
      )}

      {/* Sticky header + scrollbar — fixed via portals */}
      <StickyHeader tableRef={tableScrollRef} theadRef={theadRef} />
      <StickyScrollbar tableRef={tableScrollRef} />

      {/* Table */}
      <Card className="!overflow-visible">
        <div ref={tableScrollRef} className="overflow-x-auto">
          <table className="w-full text-sm border-collapse">
            {/* Group Headers */}
            <thead ref={theadRef}>
              <tr className="bg-surface dark:bg-slate-900">
                <th colSpan={1} className={`text-center text-[10px] uppercase tracking-wider px-2 py-1.5 border-b-2 border-slate-300 dark:border-slate-600 ${groupHeaderColors.fees}`}>QB</th>
                <th colSpan={5} className={`text-center text-[10px] uppercase tracking-wider px-2 py-1.5 border-b-2 border-blue-300 dark:border-blue-600 ${groupHeaderColors.course}`}>Course</th>
                <th colSpan={5} className={`text-center text-[10px] uppercase tracking-wider px-2 py-1.5 border-b-2 border-green-300 dark:border-green-600 ${groupHeaderColors.trainee}`}>Trainee</th>
                <th colSpan={4} className={`text-center text-[10px] uppercase tracking-wider px-2 py-1.5 border-b-2 border-purple-300 dark:border-purple-600 ${groupHeaderColors.sponsor}`}>Employer</th>
                <th colSpan={8} className={`text-center text-[10px] uppercase tracking-wider px-2 py-1.5 border-b-2 border-amber-300 dark:border-amber-600 ${groupHeaderColors.enrolment}`}>Enrolment</th>
                <th colSpan={3} className={`text-center text-[10px] uppercase tracking-wider px-2 py-1.5 border-b-2 border-indigo-300 dark:border-indigo-600 ${groupHeaderColors.bl}`}>BL Grant</th>
                <th colSpan={4} className={`text-center text-[10px] uppercase tracking-wider px-2 py-1.5 border-b-2 border-teal-300 dark:border-teal-600 ${groupHeaderColors.nbl}`}>Non-BL Grant</th>
                <th colSpan={1} className={`text-center text-[10px] uppercase tracking-wider px-2 py-1.5 border-b-2 border-orange-300 dark:border-orange-600 ${groupHeaderColors.tg}`}>TG</th>
                <th colSpan={7} className={`text-center text-[10px] uppercase tracking-wider px-2 py-1.5 border-b-2 border-pink-300 dark:border-pink-600 ${groupHeaderColors.sfc}`}>SFC Claims</th>
                <th colSpan={3} className={`text-center text-[10px] uppercase tracking-wider px-2 py-1.5 border-b-2 border-emerald-300 dark:border-emerald-600 ${groupHeaderColors.grant_pay}`}>Grant Payment</th>
                <th colSpan={1} className={`text-center text-[10px] uppercase tracking-wider px-2 py-1.5 border-b-2 border-gray-300 dark:border-gray-600 ${groupHeaderColors.fees}`}>Fees</th>
              </tr>
              {/* Column Headers */}
              <tr className="border-b border-default bg-surface-elevated">
                <th className={`${headerCell} w-10 text-center`} title="Select enrolments, then Queue QB invoices">
                  <input
                    type="checkbox"
                    className="rounded border-default"
                    checked={allPageSelected}
                    onChange={() => toggleSelectAllOnPage()}
                    disabled={pageEnrolmentIds.length === 0 || loading}
                    aria-label="Select all enrolments on this page"
                  />
                </th>
                {/* Course (5) */}
                <th className={headerCell}>Course Run</th>
                <th className={headerCell}>Course Code</th>
                <th className={headerCell}>Course Title</th>
                <th className={headerCell}>Start Date</th>
                <th className={headerCell}>End Date</th>
                {/* Trainee (5) */}
                <th className={headerCell}>Trainee</th>
                <th className={headerCell}>Email</th>
                <th className={headerCell}>Contact</th>
                <th className={headerCell}>ID</th>
                <th className={headerCell}>DOB</th>
                {/* Employer (4) */}
                <th className={headerCell}>Sponsorship</th>
                <th className={headerCell}>UEN</th>
                <th className={headerCell}>Employer</th>
                <th className={headerCell}>Employer Contact</th>
                {/* Enrolment (5) */}
                <th className={headerCell}>Status</th>
                <th className={headerCell}>Enrolment ID</th>
                <th className={headerCell}>DA</th>
                <th className={headerCell}>Invoice ID</th>
                <th className={headerCell}>Invoice No</th>
                <th className={headerCell}>GRN Ref</th>
                <th className={headerCell}>Sent</th>
                <th className={headerCell}>Cust Inv</th>
                <th className={headerCell}>GRN Inv</th>
                {/* BL Grant (3) */}
                <th className={headerCell}>Status</th>
                <th className={headerCell}>Grant ID</th>
                <th className={`${headerCell} text-right`}>Amount</th>
                {/* Non-BL Grant (4) */}
                <th className={headerCell}>Status</th>
                <th className={headerCell}>Grant ID</th>
                <th className={headerCell}>Scheme</th>
                <th className={`${headerCell} text-right`}>Amount</th>
                {/* TG Total (1) */}
                <th className={`${headerCell} text-right`}>Total TG</th>
                {/* SFC Claims (7) */}
                <th className={headerCell}>Claim ID</th>
                <th className={`${headerCell} text-right`}>Amount</th>
                <th className={headerCell}>Payment Date</th>
                <th className={headerCell}>Claim Status</th>
                <th className={headerCell}>FMS Payment</th>
                <th className={headerCell}>QB SFC</th>
                <th className={headerCell}>QB Payment ID</th>
                {/* Grant Payment (3) */}
                <th className={`${headerCell} text-right`}>Pending</th>
                <th className={headerCell}>Status</th>
                <th className={headerCell}>Last Import</th>
                {/* Fees (1) */}
                <th className={headerCell}>Fee Collection</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td colSpan={TOTAL_COLS} className="px-4 py-12 text-center text-on-surface-secondary">
                  <div className="flex items-center justify-center gap-2">
                    <div className="animate-spin rounded-full h-5 w-5 border-b-2 border-primary" />
                    Loading enrolments...
                  </div>
                </td></tr>
              ) : rows.length === 0 ? (
                <tr><td colSpan={TOTAL_COLS} className="px-4 py-12 text-center text-on-surface-secondary">No enrolments found.</td></tr>
              ) : rows.map((r, i) => {
                const totalTG = (Number(r.bl_amount) || 0) + (Number(r.nbl_amount) || 0);
                const enrolmentKey = r.enrolment_id ?? `row-${i}`;
                const enrId = r.enrolment_id?.trim() || null;
                const isSelected = enrId ? selectedEnrolmentIds.includes(enrId) : false;
                const isSent = !!(r.invoice_sent_at && String(r.invoice_sent_at).trim());
                const fullyPaid = String(r.grant_payment_status || '').toUpperCase() === 'FULLY_PAID';
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
                  <tr
                    key={enrolmentKey}
                    className={`border-b border-default transition-colors ${hoverTint} ${rowTint}`}
                  >
                    <td className={`${cell} text-center align-middle`}>
                      <input
                        type="checkbox"
                        className="rounded border-default"
                        checked={isSelected}
                        onChange={() => toggleSelectEnrolment(enrId)}
                        disabled={!enrId || loading || isSent}
                        aria-label={enrId ? `Select ${enrId}` : 'No enrolment id'}
                      />
                    </td>
                    {/* Course */}
                    <td className={`${cell} text-on-surface-secondary font-mono`}>{r.course_run_number || '-'}</td>
                    <td className={`${cell} text-on-surface-secondary font-mono`}>{r.course_reference || '-'}</td>
                    <td className={`${cell} text-on-surface max-w-[200px] truncate`} title={r.course_title || ''}>{r.course_title || '-'}</td>
                    <td className={`${cell} text-on-surface-secondary`}>{formatDate(r.start_date)}</td>
                    <td className={`${cell} text-on-surface-secondary`}>{formatDate(r.end_date)}</td>
                    {/* Trainee */}
                    <td className={`${cell} text-on-surface`}>{r.trainee_name || '-'}</td>
                    <td className={`${cell} text-on-surface-secondary`}>{r.trainee_email || '-'}</td>
                    <td className={`${cell} text-on-surface-secondary`}>{r.trainee_contact || '-'}</td>
                    <td className={`${cell} text-on-surface-secondary font-mono`}>{maskNric(r.trainee_nric)}</td>
                    <td className={`${cell} text-on-surface-secondary`}>{formatDate(r.trainee_dob)}</td>
                    {/* Employer */}
                    <td className={`${cell} text-on-surface-secondary`}>{r.sponsorship_type || '-'}</td>
                    <td className={`${cell} text-on-surface-secondary font-mono`}>{r.employer_uen || '-'}</td>
                    <td className={`${cell} text-on-surface-secondary max-w-[150px] truncate`} title={r.employer_name || ''}>{r.employer_name || '-'}</td>
                    <td className={`${cell} text-on-surface-secondary`}>{r.employer_contact_name || '-'}</td>
                    {/* Enrolment */}
                    <td className={cell}>
                      <span className={`inline-block px-2 py-0.5 rounded-full text-xs font-medium ${statusColor(r.enrolment_status)}`}>
                        {r.enrolment_status || '-'}
                      </span>
                    </td>
                    <td className={`${cell} text-on-surface-secondary font-mono`}>{r.enrolment_id || '-'}</td>
                    <td className={cell}>
                      {r.is_da ? (
                        <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-semibold bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-300">DA</span>
                      ) : null}
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
                    {/* BL Grant */}
                    <td className={cell}>
                      {fullyPaid ? (
                        <span className={`inline-block px-2 py-0.5 rounded-full text-xs font-medium ${statusColor('Completed')}`}>
                          Completed
                        </span>
                      ) : r.bl_status ? (
                          <span className={`inline-block px-2 py-0.5 rounded-full text-xs font-medium ${statusColor(r.bl_status)}`}>
                            {r.bl_status}
                          </span>
                        ) : '-'}
                    </td>
                    <td className={`${cell} text-on-surface-secondary font-mono`}>{r.bl_grant_id || '-'}</td>
                    <td className={`${cell} text-right tabular-nums`}>{r.bl_amount ? formatCurrency(r.bl_amount) : '-'}</td>
                    {/* Non-BL Grant */}
                    <td className={cell}>
                      {fullyPaid ? (
                        <span className={`inline-block px-2 py-0.5 rounded-full text-xs font-medium ${statusColor('Completed')}`}>
                          Completed
                        </span>
                      ) : r.nbl_status ? (
                          <span className={`inline-block px-2 py-0.5 rounded-full text-xs font-medium ${statusColor(r.nbl_status)}`}>
                            {r.nbl_status}
                          </span>
                        ) : '-'}
                    </td>
                    <td className={`${cell} text-on-surface-secondary font-mono`}>{r.nbl_grant_id || '-'}</td>
                    <td className={`${cell} text-on-surface-secondary`}>{r.nbl_scheme || '-'}</td>
                    <td className={`${cell} text-right tabular-nums`}>{r.nbl_amount ? formatCurrency(r.nbl_amount) : '-'}</td>
                    {/* TG Total */}
                    <td className={`${cell} text-right tabular-nums font-medium`}>{totalTG > 0 ? formatCurrency(totalTG) : '-'}</td>
                    {/* SFC Claims */}
                    <td className={`${cell} text-on-surface-secondary font-mono`}>{r.sfc_claim_id || '-'}</td>
                    <td className={`${cell} text-right tabular-nums`}>{r.sfc_amount ? formatCurrency(r.sfc_amount) : '-'}</td>
                    <td className={`${cell} text-on-surface-secondary`}>{formatDate(r.sfc_payment_date)}</td>
                    <td className={cell}>
                      {r.sfc_status ? (
                        <span className={`inline-block px-2 py-0.5 rounded-full text-xs font-medium ${statusColor(r.sfc_status)}`}>
                          {r.sfc_status}
                        </span>
                      ) : '-'}
                    </td>
                    <td className={cell}>
                      {r.sfc_claim_payment_status ? (
                        <span className={`inline-block px-2 py-0.5 rounded-full text-xs font-medium ${r.sfc_claim_payment_status === 'PAID' ? 'bg-emerald-50 text-emerald-700 dark:bg-emerald-900/20 dark:text-emerald-400' : 'bg-gray-100 text-gray-600 dark:bg-gray-700/30 dark:text-gray-300'}`}>
                          {r.sfc_claim_payment_status}
                        </span>
                      ) : '-'}
                    </td>
                    <td className={cell}>
                      {r.qbo_sfc_status ? (
                        <span className={`inline-block px-2 py-0.5 rounded-full text-xs font-medium ${r.qbo_sfc_status === 'Paid' ? 'bg-emerald-50 text-emerald-700 dark:bg-emerald-900/20 dark:text-emerald-400' : 'bg-amber-50 text-amber-700 dark:bg-amber-900/20 dark:text-amber-300'}`}>
                          {r.qbo_sfc_status}
                        </span>
                      ) : '-'}
                    </td>
                    <td className={`${cell} text-on-surface-secondary font-mono text-xs max-w-[100px] truncate`} title={r.sfc_qb_payment_id || ''}>
                      {r.sfc_qb_payment_id || '-'}
                    </td>
                    {/* Grant Payment */}
                    <td className={`${cell} text-right tabular-nums`}>{r.total_grant_pending != null ? formatCurrency(Number(r.total_grant_pending)) : '-'}</td>
                    <td className={cell}>
                      {r.grant_payment_status ? (
                        <span className={`inline-block px-2 py-0.5 rounded-full text-xs font-medium ${grantPaymentBadge(r.grant_payment_status)}`}>
                          {String(r.grant_payment_status)}
                        </span>
                      ) : '-'}
                    </td>
                    <td className={`${cell} text-on-surface-secondary`}>{r.last_grant_import_at ? formatDate(String(r.last_grant_import_at).slice(0, 10)) : '-'}</td>
                    {/* Fees */}
                    <td className={`${cell} text-on-surface-secondary`}>{r.fee_collection_status || '-'}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        {/* Pagination */}
        <div className="flex items-center justify-between px-4 py-3 border-t border-default bg-surface-elevated">
          <div className="text-sm text-on-surface-secondary">
            Showing {total === 0 ? 0 : page * PAGE_SIZE + 1}–{Math.min((page + 1) * PAGE_SIZE, total)} of {total.toLocaleString()}
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => setPage(p => Math.max(0, p - 1))}
              disabled={page === 0}
              className="px-3 py-1.5 text-sm rounded-md border border-default bg-surface hover:bg-surface-hover disabled:opacity-50 disabled:cursor-not-allowed text-on-surface transition-colors"
            >
              Previous
            </button>
            <span className="text-sm text-on-surface-secondary">
              Page {page + 1} of {totalPages || 1}
            </span>
            <button
              onClick={() => setPage(p => p + 1)}
              disabled={page >= totalPages - 1}
              className="px-3 py-1.5 text-sm rounded-md border border-default bg-surface hover:bg-surface-hover disabled:opacity-50 disabled:cursor-not-allowed text-on-surface transition-colors"
            >
              Next
            </button>
          </div>
        </div>
      </Card>

      {/* Progress modal — same visual pattern as the enrolment “generate invoice” flow */}
      {showFmsInvProgress && (() => {
        const elapsed = (Date.now() - fmsInvProgressStartTime) / 1000;
        const allFailed =
          fmsInvProgressDone && fmsInvProgressSucceeded === 0 && fmsInvProgressFailed > 0;
        return (
          <div
            className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/60"
            style={{ backdropFilter: 'blur(8px)' }}
          >
            <div className="w-full max-w-md mx-4 rounded-2xl bg-white dark:bg-gray-800 shadow-2xl overflow-hidden border border-gray-200 dark:border-gray-700">
              <div
                className={`h-1 ${fmsInvProgressDone ? (allFailed ? 'bg-red-500' : 'bg-emerald-500') : 'bg-amber-500'}`}
              />
              <div className="flex flex-col items-center pt-7 pb-2 px-6">
                <div
                  className={`w-14 h-14 rounded-full flex items-center justify-center mb-4 ${
                    fmsInvProgressDone
                      ? allFailed
                        ? 'bg-red-100 dark:bg-red-900/30'
                        : 'bg-emerald-100 dark:bg-emerald-900/30'
                      : 'bg-amber-100 dark:bg-amber-900/30'
                  }`}
                >
                  {fmsInvProgressDone ? (
                    allFailed ? (
                      <svg className="w-7 h-7 text-red-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                      </svg>
                    ) : (
                      <svg className="w-7 h-7 text-emerald-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                      </svg>
                    )
                  ) : (
                    <div className="animate-spin rounded-full h-7 w-7 border-[3px] border-amber-200 border-t-amber-500" />
                  )}
                </div>
                <h3 className="text-base font-semibold text-gray-900 dark:text-white">
                  {fmsInvProgressDone
                    ? allFailed
                      ? 'Generation failed'
                      : 'Invoices generated!'
                    : 'Generating invoices…'}
                </h3>
                <p className="text-xs text-gray-500 dark:text-gray-400 mt-1 text-center">
                  {fmsInvProgressDone
                    ? `Completed in ${fmtInvDuration(elapsed)}`
                    : `Processing ${fmsInvProgressTotal} invoice(s) in QuickBooks, please wait…`}
                </p>
              </div>

              <div className="px-6 pt-4 pb-2">
                <div className="w-full h-2 bg-gray-200 dark:bg-gray-700 rounded-full overflow-hidden">
                  {fmsInvProgressDone ? (
                    <div className={`h-full rounded-full w-full ${allFailed ? 'bg-red-500' : 'bg-emerald-500'}`} />
                  ) : (
                    <div className="h-full w-full rounded-full overflow-hidden relative">
                      <div className="absolute inset-0 bg-amber-200 dark:bg-amber-900/40" />
                      <div
                        className="absolute inset-0 bg-gradient-to-r from-transparent via-amber-400 to-transparent animate-pulse"
                        style={{ backgroundSize: '200% 100%' }}
                      />
                    </div>
                  )}
                </div>
              </div>

              {fmsInvProgressDone && (
                <div className="px-6 pt-3 pb-1">
                  <div className="flex rounded-lg border border-gray-200 dark:border-gray-600 divide-x divide-gray-200 dark:divide-gray-600 overflow-hidden">
                    <div className="flex-1 py-3 text-center">
                      <div className="text-base font-bold text-emerald-500">{fmsInvProgressSucceeded}</div>
                      <div className="text-[10px] text-gray-500 dark:text-gray-400 font-medium mt-0.5">Completed</div>
                    </div>
                    <div className="flex-1 py-3 text-center">
                      <div
                        className={`text-base font-bold ${fmsInvProgressFailed > 0 ? 'text-red-400' : 'text-gray-400'}`}
                      >
                        {fmsInvProgressFailed}
                      </div>
                      <div className="text-[10px] text-gray-500 dark:text-gray-400 font-medium mt-0.5">Issues</div>
                    </div>
                    <div className="flex-1 py-3 text-center">
                      <div className="text-base font-bold text-gray-700 dark:text-gray-300">
                        {fmtInvDuration(elapsed)}
                      </div>
                      <div className="text-[10px] text-gray-500 dark:text-gray-400 font-medium mt-0.5">Duration</div>
                    </div>
                  </div>
                </div>
              )}

              <div className="px-6 pt-4 pb-5">
                {fmsInvProgressDone ? (
                  <button
                    type="button"
                    onClick={() => setShowFmsInvProgress(false)}
                    className={`w-full py-2.5 rounded-lg text-white text-sm font-medium transition-colors ${
                      allFailed ? 'bg-red-500 hover:bg-red-600' : 'bg-emerald-500 hover:bg-emerald-600'
                    }`}
                  >
                    Done
                  </button>
                ) : (
                  <p className="text-center text-[11px] text-gray-500 dark:text-gray-400">
                    Invoice ID and number appear in the table when each job finishes.
                  </p>
                )}
              </div>
            </div>
          </div>
        );
      })()}

      {showFmsSendProgress && (() => {
        const elapsed = (Date.now() - fmsSendStartTime) / 1000;
        const allFailed = fmsSendDone && fmsSendSucceeded === 0 && fmsSendFailed > 0;
        return (
          <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/60" style={{ backdropFilter: 'blur(8px)' }}>
            <div className="w-full max-w-md mx-4 rounded-2xl bg-white dark:bg-gray-800 shadow-2xl overflow-hidden border border-gray-200 dark:border-gray-700">
              <div className={`h-1 ${fmsSendDone ? (allFailed ? 'bg-red-500' : 'bg-emerald-500') : 'bg-amber-500'}`} />
              <div className="flex flex-col items-center pt-7 pb-2 px-6">
                <div className={`w-14 h-14 rounded-full flex items-center justify-center mb-4 ${fmsSendDone ? (allFailed ? 'bg-red-100 dark:bg-red-900/30' : 'bg-emerald-100 dark:bg-emerald-900/30') : 'bg-amber-100 dark:bg-amber-900/30'}`}>
                  {fmsSendDone ? (
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
                  {fmsSendDone ? (allFailed ? 'Send failed' : 'Invoices sent!') : 'Sending invoices…'}
                </h3>
                <p className="text-xs text-gray-500 dark:text-gray-400 mt-1 text-center">
                  {fmsSendDone ? `Completed in ${fmtInvDuration(elapsed)}` : `Sending ${fmsSendTotal} email(s) from QuickBooks, please wait…`}
                </p>
              </div>

              <div className="px-6 pt-4 pb-2">
                <div className="w-full h-2 bg-gray-200 dark:bg-gray-700 rounded-full overflow-hidden">
                  {fmsSendDone ? (
                    <div className={`h-full rounded-full w-full ${allFailed ? 'bg-red-500' : 'bg-emerald-500'}`} />
                  ) : (
                    <div className="h-full w-full rounded-full overflow-hidden relative">
                      <div className="absolute inset-0 bg-amber-200 dark:bg-amber-900/40" />
                      <div className="absolute inset-0 bg-gradient-to-r from-transparent via-amber-400 to-transparent animate-pulse" style={{ backgroundSize: '200% 100%' }} />
                    </div>
                  )}
                </div>
              </div>

              {fmsSendDone && (
                <div className="px-6 pt-3 pb-1">
                  <div className="flex rounded-lg border border-gray-200 dark:border-gray-600 divide-x divide-gray-200 dark:divide-gray-600 overflow-hidden">
                    <div className="flex-1 py-3 text-center">
                      <div className="text-base font-bold text-emerald-500">{fmsSendSucceeded}</div>
                      <div className="text-[10px] text-gray-500 dark:text-gray-400 font-medium mt-0.5">Sent</div>
                    </div>
                    <div className="flex-1 py-3 text-center">
                      <div className={`text-base font-bold ${fmsSendFailed > 0 ? 'text-red-400' : 'text-gray-400'}`}>{fmsSendFailed}</div>
                      <div className="text-[10px] text-gray-500 dark:text-gray-400 font-medium mt-0.5">Failed</div>
                    </div>
                    <div className="flex-1 py-3 text-center">
                      <div className="text-base font-bold text-gray-700 dark:text-gray-300">{fmtInvDuration(elapsed)}</div>
                      <div className="text-[10px] text-gray-500 dark:text-gray-400 font-medium mt-0.5">Duration</div>
                    </div>
                  </div>
                </div>
              )}

              <div className="px-6 pt-4 pb-5">
                {fmsSendDone ? (
                  <button
                    type="button"
                    onClick={() => setShowFmsSendProgress(false)}
                    className={`w-full py-2.5 rounded-lg text-white text-sm font-medium transition-colors ${allFailed ? 'bg-red-500 hover:bg-red-600' : 'bg-emerald-500 hover:bg-emerald-600'}`}
                  >
                    Done
                  </button>
                ) : (
                  <p className="text-center text-[11px] text-gray-500 dark:text-gray-400">
                    QuickBooks will email the invoice to each learner.
                  </p>
                )}
              </div>
            </div>
          </div>
        );
      })()}

      {/* Import Course Run Modal */}
      {showImportModal && (
        <div className="fixed inset-0 bg-black/50 z-[9999] flex items-center justify-center p-4">
          <div className="bg-white dark:bg-gray-800 rounded-lg shadow-xl w-full max-w-md border border-gray-200 dark:border-gray-700">
            <div className="p-6">
              <h3 className="text-lg font-semibold text-gray-900 dark:text-white mb-1">Import Course Run</h3>
              <p className="text-sm text-gray-500 dark:text-gray-400 mb-4">
                Enter a Course Run ID to fetch its details from SSG and save it to the database.
              </p>

              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                Course Run ID
              </label>
              <input
                type="text"
                value={importRunId}
                onChange={(e) => {
                  setImportRunId(e.target.value);
                  setImportResult(null);
                }}
                onKeyDown={(e) => e.key === 'Enter' && !importLoading && void handleImportRun()}
                placeholder="e.g. 1067907"
                className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 dark:bg-gray-700 dark:border-gray-600 dark:text-white dark:placeholder-gray-400 mb-4"
                autoFocus
              />

              {importResult && (
                <div
                  className={`rounded-md p-3 mb-4 text-sm ${
                    importResult.success
                      ? 'bg-green-50 border border-green-200 text-green-800 dark:bg-green-900/20 dark:border-green-700 dark:text-green-300'
                      : 'bg-red-50 border border-red-200 text-red-800 dark:bg-red-900/20 dark:border-red-700 dark:text-red-300'
                  }`}
                >
                  <p className="font-medium">{importResult.message}</p>
                  {importResult.detail && <p className="mt-1 text-xs opacity-80">{importResult.detail}</p>}
                </div>
              )}

              <div className="flex gap-3 justify-end">
                <Button
                  variant="outline"
                  onClick={() => {
                    setShowImportModal(false);
                    setImportRunId('');
                    setImportResult(null);
                  }}
                  disabled={importLoading}
                >
                  {importResult?.success ? 'Close' : 'Cancel'}
                </Button>
                <Button
                  onClick={() => void handleImportRun()}
                  disabled={importLoading || !importRunId.trim()}
                >
                  {importLoading ? (
                    <>
                      <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white mr-2" />
                      Fetching...
                    </>
                  ) : 'Import'}
                </Button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default AllCourseRunsView;
