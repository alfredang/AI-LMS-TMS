import React, { useState, useEffect, useCallback, useRef } from 'react';
import ReactDOM from 'react-dom';
import { Card } from '../ui/Card';
import { Button } from '../ui/Button';
import { Icon, IconName } from '../ui/Icon';

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
}

interface Stats {
  totalEnrolments: number;
  totalBL: number;
  totalNBL: number;
  totalSFC: number;
  byStatus: { status: string; count: number }[];
}

interface AutomationActionMeta {
  id: string;
  menuLabel: string;
  kind: string;
  description: string;
  configured: boolean;
}

const formatCurrency = (amount: number | null): string => {
  if (amount === null || amount === undefined) return '-';
  return `$${amount.toLocaleString('en-SG', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
};

const formatDate = (dateStr: string | null): string => {
  if (!dateStr) return '-';
  const date = new Date(dateStr);
  if (isNaN(date.getTime())) return dateStr;
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

const PAGE_SIZE = 20;

// Column group header styling
const groupHeaderColors: Record<string, string> = {
  select: 'bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300',
  course: 'bg-blue-50 dark:bg-blue-950 text-blue-700 dark:text-blue-300',
  trainee: 'bg-green-50 dark:bg-green-950 text-green-700 dark:text-green-300',
  sponsor: 'bg-purple-50 dark:bg-purple-950 text-purple-700 dark:text-purple-300',
  enrolment: 'bg-amber-50 dark:bg-amber-950 text-amber-700 dark:text-amber-300',
  bl: 'bg-indigo-50 dark:bg-indigo-950 text-indigo-700 dark:text-indigo-300',
  nbl: 'bg-teal-50 dark:bg-teal-950 text-teal-700 dark:text-teal-300',
  tg: 'bg-orange-50 dark:bg-orange-950 text-orange-700 dark:text-orange-300',
  sfc: 'bg-pink-50 dark:bg-pink-950 text-pink-700 dark:text-pink-300',
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
  const syncing = useRef(false);
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

const AllCourseRunsView: React.FC = () => {
  const [search, setSearch] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [sortOrder, setSortOrder] = useState<'newest' | 'oldest'>('newest');
  const [page, setPage] = useState(0);
  const [rows, setRows] = useState<CourseRunRow[]>([]);
  const [total, setTotal] = useState(0);
  const [stats, setStats] = useState<Stats | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selectedEnrolmentIds, setSelectedEnrolmentIds] = useState<string[]>([]);
  const [showGrantsConfirm, setShowGrantsConfirm] = useState(false);
  const [grantsProcessing, setGrantsProcessing] = useState(false);
  const [automationActions, setAutomationActions] = useState<AutomationActionMeta[]>([]);
  const [automationActionsLoading, setAutomationActionsLoading] = useState(true);
  const [selectedWebhookId, setSelectedWebhookId] = useState('');
  const [webhookRunning, setWebhookRunning] = useState(false);
  const [toast, setToast] = useState<{ message: string; variant: 'success' | 'error' } | null>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout>>();
  const tableScrollRef = useRef<HTMLDivElement>(null);
  const theadRef = useRef<HTMLTableSectionElement>(null);
  const selectAllRef = useRef<HTMLInputElement>(null);

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
  }, [page, debouncedSearch, statusFilter, sortOrder]);

  useEffect(() => { fetchData(); }, [fetchData]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setAutomationActionsLoading(true);
      try {
        const res = await fetch('/api/finance/automation/list');
        const json = await res.json();
        if (!cancelled && res.ok && Array.isArray(json.actions)) {
          setAutomationActions(json.actions);
        }
      } catch {
        if (!cancelled) setAutomationActions([]);
      } finally {
        if (!cancelled) setAutomationActionsLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  const n8nWorkflowOptions = automationActions.filter((a) => a.kind === 'n8n_webhook');

  const pageEnrolmentIds = rows
    .map((r) => r.enrolment_id)
    .filter((id): id is string => Boolean(id));
  const selectedOnPage = pageEnrolmentIds.filter((id) => selectedEnrolmentIds.includes(id));
  const allPageSelected =
    pageEnrolmentIds.length > 0 && selectedOnPage.length === pageEnrolmentIds.length;

  useEffect(() => {
    const el = selectAllRef.current;
    if (!el) return;
    el.indeterminate =
      selectedOnPage.length > 0 && selectedOnPage.length < pageEnrolmentIds.length;
  }, [selectedOnPage.length, pageEnrolmentIds.length]);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 6000);
    return () => clearTimeout(t);
  }, [toast]);

  const toggleSelectAllPage = () => {
    if (allPageSelected) {
      setSelectedEnrolmentIds((prev) => prev.filter((id) => !pageEnrolmentIds.includes(id)));
    } else {
      setSelectedEnrolmentIds((prev) => Array.from(new Set([...prev, ...pageEnrolmentIds])));
    }
  };

  const toggleRowSelected = (enrolmentId: string) => {
    setSelectedEnrolmentIds((prev) =>
      prev.includes(enrolmentId) ? prev.filter((id) => id !== enrolmentId) : [...prev, enrolmentId]
    );
  };

  const openProcessGrants = () => {
    if (selectedEnrolmentIds.length === 0) {
      setToast({
        variant: 'error',
        message: 'Select one or more table rows before processing grants.',
      });
      return;
    }
    const needsConfirm = selectedEnrolmentIds.length > 1;
    if (needsConfirm) setShowGrantsConfirm(true);
    else void runProcessGrants();
  };

  const runProcessGrants = async () => {
    setShowGrantsConfirm(false);
    setGrantsProcessing(true);
    try {
      const res = await fetch('/api/finance/automation/process-grants', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ enrolmentIds: selectedEnrolmentIds }),
      });
      const json = await res.json();
      if (!res.ok) {
        throw new Error(json.error || 'Request failed');
      }
      const { summary, results } = json as {
        summary?: { succeeded?: number; failed?: number; total?: number };
        results?: Array<{ enrolmentId: string; success: boolean; error?: string; grantsUpserted?: number }>;
      };
      const s = summary?.succeeded ?? 0;
      const f = summary?.failed ?? 0;

      if (f === 0) {
        setToast({
          variant: 'success',
          message:
            s === 0
              ? 'No enrolments processed.'
              : `Grants refreshed for ${s} enrolment(s).`,
        });
        setSelectedEnrolmentIds([]);
      } else {
        const failedRows = (results ?? []).filter((r) => !r.success);
        const detail = failedRows
          .map((r) => `${r.enrolmentId}: ${r.error?.trim() || 'Unknown error'}`)
          .join(' · ');
        setToast({
          variant: 'error',
          message:
            detail.length > 0
              ? `${s} ok, ${f} failed — ${detail}`
              : `${s} ok, ${f} failed.`,
        });
      }

      await fetchData();
    } catch (e) {
      setToast({
        variant: 'error',
        message: e instanceof Error ? e.message : 'Failed to process grants',
      });
    } finally {
      setGrantsProcessing(false);
    }
  };

  const runN8nWorkflow = async () => {
    if (!selectedWebhookId) return;
    const meta = n8nWorkflowOptions.find((a) => a.id === selectedWebhookId);
    if (!meta?.configured) {
      setToast({
        variant: 'error',
        message: 'This workflow has no webhook URL in server environment variables.',
      });
      return;
    }
    setWebhookRunning(true);
    try {
      const res = await fetch(
        `/api/finance/automation/${encodeURIComponent(selectedWebhookId)}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({}),
        }
      );
      const json = await res.json();
      if (!res.ok) {
        throw new Error(json.error || 'Request failed');
      }
      setToast({
        variant: 'success',
        message: `${meta.menuLabel}: triggered successfully.`,
      });
    } catch (e) {
      setToast({
        variant: 'error',
        message: e instanceof Error ? e.message : 'Workflow failed',
      });
    } finally {
      setWebhookRunning(false);
    }
  };

  const totalPages = Math.ceil(total / PAGE_SIZE);
  const statusOptions = stats?.byStatus.map(s => s.status) ?? [];

  const cell = 'px-3 py-2.5 text-xs whitespace-nowrap';
  const headerCell = 'px-3 py-2 font-medium text-on-surface-secondary text-xs whitespace-nowrap';

  return (
    <div className="space-y-6 relative">
      {toast && (
        <div
          className={`fixed bottom-6 right-6 z-[60] max-w-md px-4 py-3 rounded-lg shadow-lg text-sm ${
            toast.variant === 'success'
              ? 'bg-green-800 text-white'
              : 'bg-red-800 text-white'
          }`}
          role="status"
        >
          {toast.message}
        </div>
      )}

      {/* Header */}
      <div className="flex items-center justify-between">
        <h2 className="text-2xl font-bold text-on-surface">All Course Runs</h2>
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
      <Card className="p-4">
        <div className="flex flex-col sm:flex-row gap-3">
          <div className="relative flex-1">
            <Icon name={IconName.Search} className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-on-surface-secondary" />
            <input
              type="text"
              placeholder="Search by trainee name, NRIC, enrolment ID, course title, course code..."
              value={search}
              onChange={e => setSearch(e.target.value)}
              className="w-full pl-10 pr-3 py-2 text-sm bg-surface border border-default rounded-lg focus:outline-none focus:ring-2 focus:ring-primary focus:border-transparent text-on-surface placeholder-gray-400"
            />
          </div>
          <select
            value={statusFilter}
            onChange={e => { setStatusFilter(e.target.value); setPage(0); }}
            className="px-3 py-2 text-sm bg-surface border border-default rounded-lg focus:outline-none focus:ring-2 focus:ring-primary text-on-surface"
          >
            <option value="">All Statuses</option>
            {statusOptions.map(s => (
              <option key={s} value={s}>{s}</option>
            ))}
          </select>
          <select
            value={sortOrder}
            onChange={e => { setSortOrder(e.target.value as 'newest' | 'oldest'); setPage(0); }}
            className="px-3 py-2 text-sm bg-surface border border-default rounded-lg focus:outline-none focus:ring-2 focus:ring-primary text-on-surface"
          >
            <option value="newest">Newest First</option>
            <option value="oldest">Oldest First</option>
          </select>
        </div>
      </Card>

      {/* Automation: SSG row action + n8n workflows */}
      <Card className="p-3 sm:p-4">
        <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between md:gap-6">
          <div className="flex items-center gap-3 min-w-0">
            <div
              className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-primary/15 text-primary"
              aria-hidden
            >
              <Icon name={IconName.Cloud} className="w-5 h-5 opacity-90" />
            </div>
            <div className="min-w-0">
              <p className="text-sm font-semibold text-on-surface tracking-tight">Finance automation</p>
              {selectedEnrolmentIds.length > 0 ? (
                <p className="text-xs text-on-surface-secondary mt-0.5">
                  {selectedEnrolmentIds.length} row{selectedEnrolmentIds.length === 1 ? '' : 's'} selected
                </p>
              ) : (
                <p className="text-xs text-on-surface-secondary mt-0.5">SSG grants · n8n workflows</p>
              )}
            </div>
          </div>

          <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-stretch sm:justify-end sm:gap-2 md:flex-nowrap md:max-w-3xl md:ml-auto">
            <div className="flex flex-wrap items-center gap-2 sm:justify-end">
              {selectedEnrolmentIds.length > 0 && (
                <Button variant="ghost" size="sm" onClick={() => setSelectedEnrolmentIds([])}>
                  Clear
                </Button>
              )}
              <Button
                size="sm"
                disabled={grantsProcessing || loading}
                onClick={openProcessGrants}
                className="gap-1.5"
              >
                {grantsProcessing ? (
                  <>
                    <span className="inline-block h-3.5 w-3.5 border-2 border-white/40 border-t-white rounded-full animate-spin" />
                    Grants…
                  </>
                ) : (
                  <>
                    <Icon name={IconName.ClipboardCheck} className="w-4 h-4" />
                    Process grants (SSG)
                  </>
                )}
              </Button>
            </div>

            <div
              className="hidden sm:block w-px self-stretch min-h-[2.25rem] bg-gray-200 dark:bg-gray-600 shrink-0 sm:mx-1"
              aria-hidden
            />

            <div className="flex flex-1 flex-col gap-2 sm:flex-row sm:items-stretch sm:min-w-[min(100%,18rem)] sm:max-w-xl">
              <select
                value={selectedWebhookId}
                onChange={(e) => setSelectedWebhookId(e.target.value)}
                disabled={automationActionsLoading || n8nWorkflowOptions.length === 0}
                title={
                  automationActionsLoading
                    ? 'Loading workflows…'
                    : 'Choose a workflow, then Run'
                }
                className="w-full flex-1 px-3 py-2 text-sm bg-surface border border-default rounded-lg focus:outline-none focus:ring-2 focus:ring-primary text-on-surface disabled:opacity-60 min-h-[2.25rem]"
              >
                <option value="">
                  {automationActionsLoading ? 'Loading workflows…' : 'Choose workflow…'}
                </option>
                {n8nWorkflowOptions.map((a) => (
                  <option key={a.id} value={a.id} disabled={!a.configured}>
                    {a.menuLabel}
                    {!a.configured ? ' — not configured' : ''}
                  </option>
                ))}
              </select>
              <Button
                variant="outline"
                size="sm"
                className="shrink-0 w-full sm:w-auto sm:min-w-[4.5rem] min-h-[2.25rem]"
                disabled={
                  !selectedWebhookId ||
                  webhookRunning ||
                  automationActionsLoading ||
                  !n8nWorkflowOptions.find((a) => a.id === selectedWebhookId)?.configured
                }
                onClick={() => void runN8nWorkflow()}
              >
                {webhookRunning ? (
                  <>
                    <span className="inline-block h-3.5 w-3.5 border-2 border-current/30 border-t-current rounded-full animate-spin mr-2" />
                    Running…
                  </>
                ) : (
                  'Run'
                )}
              </Button>
            </div>
          </div>
        </div>
      </Card>

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
                <th colSpan={1} className={`text-center text-[10px] uppercase tracking-wider px-2 py-1.5 border-b-2 border-slate-300 dark:border-slate-600 ${groupHeaderColors.select}`}>Select</th>
                <th colSpan={5} className={`text-center text-[10px] uppercase tracking-wider px-2 py-1.5 border-b-2 border-blue-300 dark:border-blue-600 ${groupHeaderColors.course}`}>Course</th>
                <th colSpan={5} className={`text-center text-[10px] uppercase tracking-wider px-2 py-1.5 border-b-2 border-green-300 dark:border-green-600 ${groupHeaderColors.trainee}`}>Trainee</th>
                <th colSpan={4} className={`text-center text-[10px] uppercase tracking-wider px-2 py-1.5 border-b-2 border-purple-300 dark:border-purple-600 ${groupHeaderColors.sponsor}`}>Employer</th>
                <th colSpan={2} className={`text-center text-[10px] uppercase tracking-wider px-2 py-1.5 border-b-2 border-amber-300 dark:border-amber-600 ${groupHeaderColors.enrolment}`}>Enrolment</th>
                <th colSpan={3} className={`text-center text-[10px] uppercase tracking-wider px-2 py-1.5 border-b-2 border-indigo-300 dark:border-indigo-600 ${groupHeaderColors.bl}`}>BL Grant</th>
                <th colSpan={4} className={`text-center text-[10px] uppercase tracking-wider px-2 py-1.5 border-b-2 border-teal-300 dark:border-teal-600 ${groupHeaderColors.nbl}`}>Non-BL Grant</th>
                <th colSpan={1} className={`text-center text-[10px] uppercase tracking-wider px-2 py-1.5 border-b-2 border-orange-300 dark:border-orange-600 ${groupHeaderColors.tg}`}>TG</th>
                <th colSpan={4} className={`text-center text-[10px] uppercase tracking-wider px-2 py-1.5 border-b-2 border-pink-300 dark:border-pink-600 ${groupHeaderColors.sfc}`}>SFC Claims</th>
                <th colSpan={1} className={`text-center text-[10px] uppercase tracking-wider px-2 py-1.5 border-b-2 border-gray-300 dark:border-gray-600 ${groupHeaderColors.fees}`}>Fees</th>
              </tr>
              {/* Column Headers */}
              <tr className="border-b border-default bg-surface-elevated">
                <th className={`${headerCell} w-10 text-center`}>
                  <input
                    ref={selectAllRef}
                    type="checkbox"
                    className="rounded border-default"
                    checked={allPageSelected}
                    onChange={toggleSelectAllPage}
                    disabled={pageEnrolmentIds.length === 0 || loading}
                    title="Select all on this page"
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
                {/* Enrolment (2) */}
                <th className={headerCell}>Status</th>
                <th className={headerCell}>Enrolment ID</th>
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
                {/* SFC Claims (4) */}
                <th className={headerCell}>Claim ID</th>
                <th className={`${headerCell} text-right`}>Amount</th>
                <th className={headerCell}>Payment Date</th>
                <th className={headerCell}>Status</th>
                {/* Fees (1) */}
                <th className={headerCell}>Fee Collection</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td colSpan={30} className="px-4 py-12 text-center text-on-surface-secondary">
                  <div className="flex items-center justify-center gap-2">
                    <div className="animate-spin rounded-full h-5 w-5 border-b-2 border-primary" />
                    Loading enrolments...
                  </div>
                </td></tr>
              ) : rows.length === 0 ? (
                <tr><td colSpan={30} className="px-4 py-12 text-center text-on-surface-secondary">No enrolments found.</td></tr>
              ) : rows.map((r, i) => {
                const totalTG = (Number(r.bl_amount) || 0) + (Number(r.nbl_amount) || 0);
                const eid = r.enrolment_id;
                const rowSelectable = Boolean(eid);
                const enrolmentKey = eid ?? `row-${i}`;
                return (
                  <tr key={enrolmentKey} className="border-b border-default hover:bg-surface-hover transition-colors">
                    <td className={`${cell} text-center`}>
                      {rowSelectable && eid ? (
                        <input
                          type="checkbox"
                          className="rounded border-default"
                          checked={selectedEnrolmentIds.includes(eid)}
                          onChange={() => toggleRowSelected(eid)}
                        />
                      ) : (
                        <span className="text-on-surface-secondary">—</span>
                      )}
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
                    {/* BL Grant */}
                    <td className={cell}>
                      {r.bl_status ? (
                        <span className={`inline-block px-2 py-0.5 rounded-full text-xs font-medium ${statusColor(r.bl_status)}`}>
                          {r.bl_status}
                        </span>
                      ) : '-'}
                    </td>
                    <td className={`${cell} text-on-surface-secondary font-mono`}>{r.bl_grant_id || '-'}</td>
                    <td className={`${cell} text-right tabular-nums`}>{r.bl_amount ? formatCurrency(r.bl_amount) : '-'}</td>
                    {/* Non-BL Grant */}
                    <td className={cell}>
                      {r.nbl_status ? (
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

      {showGrantsConfirm && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
          <div className="bg-white dark:bg-gray-800 rounded-lg shadow-xl max-w-md w-full mx-auto">
            <div className="p-6">
              <div className="flex items-center gap-4 mb-4">
                <div className="w-12 h-12 rounded-full flex items-center justify-center flex-shrink-0 bg-amber-100 dark:bg-amber-900/30">
                  <Icon name={IconName.InfoCircle} className="w-6 h-6 text-amber-700 dark:text-amber-300" />
                </div>
                <h3 className="text-lg font-semibold text-gray-900 dark:text-white">Process grants</h3>
              </div>
              <p className="text-gray-700 dark:text-gray-300 mb-6">
                Refresh grant data from SSG for{' '}
                <strong>{selectedEnrolmentIds.length}</strong> selected enrolment(s)? This calls SSG and
                updates <code className="text-xs bg-gray-100 dark:bg-gray-900 px-1 rounded">ssg_grants</code>.
              </p>
              <div className="flex gap-3 justify-end">
                <Button variant="ghost" onClick={() => setShowGrantsConfirm(false)} disabled={grantsProcessing}>
                  Cancel
                </Button>
                <Button onClick={() => void runProcessGrants()} disabled={grantsProcessing}>
                  {grantsProcessing ? 'Processing…' : 'Confirm'}
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
