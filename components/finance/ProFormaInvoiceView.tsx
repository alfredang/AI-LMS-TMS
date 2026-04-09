import React, { useState, useEffect, useCallback, useRef } from 'react';
import { Card } from '../ui/Card';
import { Button } from '../ui/Button';
import { Icon, IconName } from '../ui/Icon';

interface ProFormaRecord {
  id: string;
  enrolment_id: string | null;
  full_name: string;
  course_title: string;
  course_code: string | null;
  course_run_id: string | null;
  start_date: string | null;
  end_date: string | null;
  enrolment_status: string | null;
  enrolment_date: string | null;
  payment_status: string | null;
  course_fees_exclude_gst: string | null;
  course_fees_include_gst: string | null;
  pro_forma_url: string | null;
}

const formatDate = (dateStr: string | null): string => {
  if (!dateStr) return '-';
  return new Date(dateStr).toLocaleDateString('en-SG', { day: '2-digit', month: 'short', year: 'numeric' });
};

const formatCurrency = (amount: string | null): string => {
  if (!amount) return '-';
  return `$${parseFloat(amount).toFixed(2)}`;
};

const statusBadge = (status: string | null) => {
  switch (status) {
    case 'Paid':
      return 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400';
    case 'Unpaid':
      return 'bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-400';
    default:
      return 'bg-gray-100 text-gray-800 dark:bg-gray-700 dark:text-gray-400';
  }
};

const PAGE_SIZE = 20;

// FIX: use inline style instead of Tailwind backdrop-blur class so blur covers
// the full viewport including fixed navbars in any stacking context
const BACKDROP_STYLE: React.CSSProperties = {
  backdropFilter: 'blur(8px)',
  WebkitBackdropFilter: 'blur(8px)',
};

const ProFormaInvoiceView: React.FC = () => {
  const [records, setRecords] = useState<ProFormaRecord[]>([]);
  const [loading, setLoading] = useState(false);
  const [fetched, setFetched] = useState(false);

  const [syncing, setSyncing] = useState(false);
  const [syncResult, setSyncResult] = useState<string | null>(null);
  const [syncIsError, setSyncIsError] = useState(false);
  const [toastVisible, setToastVisible] = useState(false);
  const toastTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const showToast = (message: string, isError = false) => {
    setSyncResult(message);
    setSyncIsError(isError);
  };

  // Generate popup filters
  const [showGeneratePopup, setShowGeneratePopup] = useState(false);
  const [genCourseRun, setGenCourseRun] = useState('');
  const [genCourseCode, setGenCourseCode] = useState('');
  const [genCourseTitle, setGenCourseTitle] = useState('');
  const [genStartDate, setGenStartDate] = useState('');
  const [genEndDate, setGenEndDate] = useState('');
  const [genName, setGenName] = useState('');

  // Generate popup preview
  const [previewRecords, setPreviewRecords] = useState<ProFormaRecord[]>([]);
  const [previewCount, setPreviewCount] = useState(0);
  const [previewLoading, setPreviewLoading] = useState(false);
  const previewTimer = useRef<NodeJS.Timeout | null>(null);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

  // Drive verify + regenerate popup
  const [verifyingId, setVerifyingId] = useState<string | null>(null);
  const [popupRecord, setPopupRecord] = useState<ProFormaRecord | null>(null);
  const [regenerating, setRegenerating] = useState(false);

  // Pagination
  const [currentPage, setCurrentPage] = useState(1);
  const [totalCount, setTotalCount] = useState(0);
  const [totalPages, setTotalPages] = useState(0);

  // Filters
  const [courseTitle, setCourseTitle] = useState('');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [searchQuery, setSearchQuery] = useState('');
  const searchDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Auto-dismiss toast
  useEffect(() => {
    if (syncResult) {
      setToastVisible(true);
      if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
      toastTimerRef.current = setTimeout(() => {
        setToastVisible(false);
        setTimeout(() => setSyncResult(null), 300);
      }, 5000);
    }
    return () => { if (toastTimerRef.current) clearTimeout(toastTimerRef.current); };
  }, [syncResult]);

  // FIX: accept optional `search` override so callers can pass the fresh input value
  // directly, bypassing the stale searchQuery state captured in the useCallback closure.
  // This fixes both the clear button and backspace-to-empty not resetting the table.
  const fetchData = useCallback(async (
    page = 1,
    overrideFilters?: { courseTitle?: string; startDate?: string; endDate?: string; search?: string }
  ) => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      params.set('page', String(page));
      params.set('limit', String(PAGE_SIZE));
      const ct = overrideFilters?.courseTitle ?? courseTitle;
      const sd = overrideFilters?.startDate ?? startDate;
      const ed = overrideFilters?.endDate ?? endDate;
      const sq = overrideFilters?.search !== undefined ? overrideFilters.search : searchQuery;
      if (ct.trim()) params.set('courseTitle', ct.trim());
      if (sd) params.set('startDate', sd);
      if (ed) params.set('endDate', ed);
      if (sq.trim()) params.set('search', sq.trim());

      const res = await fetch(`/api/finance/invoice/invoice-list?${params.toString()}`);
      const json = await res.json();
      if (json.success) {
        setRecords(json.data);
        setTotalCount(json.total);
        setTotalPages(json.totalPages);
        setCurrentPage(json.page);
      }
    } catch (err) {
      console.error('[ProFormaInvoiceView] Fetch error:', err);
    } finally {
      setLoading(false);
      setFetched(true);
    }
  }, [courseTitle, startDate, endDate, searchQuery]);

  useEffect(() => {
    fetchData(1);
  }, []);

  const handleSearch = () => {
    fetchData(1);
  };

  const handleClear = () => {
    setCourseTitle('');
    setStartDate('');
    setEndDate('');
    fetchData(1, { courseTitle: '', startDate: '', endDate: '' });
  };

  const handleDriveLink = async (record: ProFormaRecord) => {
    const url = record.pro_forma_url!;
    setVerifyingId(record.id);
    try {
      const res = await fetch(`/api/billing/verify-drive?url=${encodeURIComponent(url)}&enrollmentId=${record.id}`);
      const json = await res.json();
      if (json.valid) {
        window.open(url, '_blank');
      } else {
        setPopupRecord(record);
        setRecords(prev => prev.map(r => r.id === record.id ? { ...r, pro_forma_url: null } : r));
      }
    } catch (err) {
      console.error('[ProFormaInvoiceView] Verify error:', err);
      window.open(url, '_blank');
    } finally {
      setVerifyingId(null);
    }
  };

  const handleRegenerate = async () => {
    if (!popupRecord) return;
    setRegenerating(true);
    try {
      const res = await fetch('/api/billing/proforma', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ enrollment_id: popupRecord.id }),
      });
      if (res.ok) {
        showToast('Invoice regenerated successfully.', false);
        setPopupRecord(null);
        fetchData(currentPage);
      } else {
        const json = await res.json().catch(() => ({}));
        showToast(json.error || 'Regeneration failed. Please try again.', true);
        setPopupRecord(null);
      }
    } catch (err) {
      console.error('[ProFormaInvoiceView] Regenerate error:', err);
      showToast('Regeneration failed. Please try again.', true);
      setPopupRecord(null);
    } finally {
      setRegenerating(false);
    }
  };

  const openGeneratePopup = () => {
    setGenCourseRun('');
    setGenCourseCode('');
    setGenCourseTitle('');
    setGenStartDate('');
    setGenEndDate('');
    setGenName('');
    setPreviewRecords([]);
    setPreviewCount(0);
    setSelectedIds(new Set());
    setShowGeneratePopup(true);
  };

  // Debounced preview fetch when generate popup filters change
  useEffect(() => {
    if (!showGeneratePopup) return;
    if (previewTimer.current) clearTimeout(previewTimer.current);

    const hasInput = genCourseRun.trim() || genCourseCode.trim() || genCourseTitle.trim() || genStartDate || genEndDate || genName.trim();
    if (!hasInput) {
      setPreviewRecords([]);
      setPreviewCount(0);
      setSelectedIds(new Set());
      return;
    }

    previewTimer.current = setTimeout(async () => {
      setPreviewLoading(true);
      try {
        const params = new URLSearchParams();
        params.set('page', '1');
        params.set('limit', '10');
        params.set('notGeneratedOnly', 'true');
        if (genCourseRun.trim()) params.set('courseRun', genCourseRun.trim());
        if (genCourseCode.trim()) params.set('courseCode', genCourseCode.trim());
        if (genCourseTitle.trim()) params.set('courseTitle', genCourseTitle.trim());
        if (genStartDate) params.set('startDate', genStartDate);
        if (genEndDate) params.set('endDate', genEndDate);
        if (genName.trim()) params.set('name', genName.trim());
        const res = await fetch(`/api/finance/invoice/invoice-list?${params.toString()}`);
        const json = await res.json();
        if (json.success) {
          setPreviewRecords(json.data);
          setPreviewCount(json.total);
          setSelectedIds(new Set(json.data.map((r: ProFormaRecord) => r.id)));
        }
      } catch (err) {
        console.error('[ProFormaInvoiceView] Preview error:', err);
      } finally {
        setPreviewLoading(false);
      }
    }, 400);
    return () => { if (previewTimer.current) clearTimeout(previewTimer.current); };
  }, [showGeneratePopup, genCourseRun, genCourseCode, genCourseTitle, genStartDate, genEndDate, genName]);

  const [showConfirmAll, setShowConfirmAll] = useState(false);

  // Progress tracking
  const [progressTotal, setProgressTotal] = useState(0);
  const [progressCurrent, setProgressCurrent] = useState(0);
  const [progressGenerated, setProgressGenerated] = useState(0);
  const [progressErrors, setProgressErrors] = useState(0);
  const [progressName, setProgressName] = useState('');
  const [progressStartTime, setProgressStartTime] = useState(0);

  const handleGenerateClick = () => {
    const hasFilters = genCourseRun.trim() || genCourseCode.trim() || genCourseTitle.trim() || genStartDate || genEndDate || genName.trim();
    if (!hasFilters && selectedIds.size === 0) {
      setShowConfirmAll(true);
      return;
    }
    handleSync();
  };

  const handleSync = async () => {
    setShowConfirmAll(false);
    setSyncing(true);
    setSyncResult(null);
    setShowGeneratePopup(false);
    setProgressTotal(0);
    setProgressCurrent(0);
    setProgressGenerated(0);
    setProgressErrors(0);
    setProgressName('');
    setProgressStartTime(Date.now());

    try {
      const body = JSON.stringify({
        enrollmentIds: selectedIds.size > 0 ? Array.from(selectedIds) : undefined,
        courseRun: genCourseRun.trim() || undefined,
        courseCode: genCourseCode.trim() || undefined,
        courseTitle: genCourseTitle.trim() || undefined,
        startDate: genStartDate || undefined,
        endDate: genEndDate || undefined,
        name: genName.trim() || undefined,
      });

      const response = await fetch('/api/finance/invoice/generate-proforma?stream=true', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body,
      });

      const reader = response.body?.getReader();
      const decoder = new TextDecoder();
      let buffer = '';

      if (reader) {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split('\n');
          buffer = lines.pop() || '';
          for (const line of lines) {
            if (line.startsWith('data: ')) {
              try {
                const event = JSON.parse(line.slice(6));
                if (event.type === 'start') {
                  setProgressTotal(event.total);
                } else if (event.type === 'progress') {
                  setProgressCurrent(event.current);
                  setProgressGenerated(event.generated);
                  setProgressErrors(event.errors);
                  setProgressName(event.name || '');
                } else if (event.type === 'complete') {
                  showToast(event.message, false);
                  fetchData(currentPage);
                } else if (event.type === 'error') {
                  showToast(event.message || 'Generation failed.', true);
                }
              } catch (_) {}
            }
          }
        }
      }
    } catch (err) {
      console.error('[ProFormaInvoiceView] Sync error:', err);
      showToast('Generation failed. Please try again.', true);
      setSyncing(false);
    }
  };

  const cell = 'px-4 py-3 text-xs whitespace-nowrap';
  const headerCell = 'px-4 py-3 font-bold text-[#f4f6fa] bg-[#434c5e] text-[13px] uppercase tracking-wide whitespace-nowrap border-b border-[#232c3b] font-sans';

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <h2 className="text-2xl font-bold text-on-surface">ProForma Invoice</h2>
        <Button onClick={openGeneratePopup} disabled={syncing} className="px-4 py-2 text-sm">
          <Icon name={syncing ? IconName.Spinner : IconName.Sync} className={`w-4 h-4 mr-1.5 ${syncing ? 'animate-spin' : ''}`} />
          {syncing ? 'Generating...' : 'Generate'}
        </Button>
      </div>

      {/* Search bar */}
      <div className="relative">
        <Icon name={IconName.Search} className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-on-surface-secondary" />
        <input
          type="text"
          placeholder="Search by name, course title, course code, or course run..."
          value={searchQuery}
          onChange={(e) => {
            const val = e.target.value;
            setSearchQuery(val);
            // FIX: pass `val` directly so the debounced fetch never reads stale
            // searchQuery state — handles typing, backspace, and clearing to empty
            if (searchDebounceRef.current) clearTimeout(searchDebounceRef.current);
            searchDebounceRef.current = setTimeout(() => fetchData(1, { search: val }), 400);
          }}
          className="w-full pl-9 pr-9 py-2.5 text-sm rounded-lg border border-default bg-surface text-on-surface placeholder:text-on-surface-secondary/50 focus:outline-none focus:ring-2 focus:ring-primary/40 focus:border-primary transition-colors"
        />
        {searchQuery && (
          <button
            onClick={() => {
              setSearchQuery('');
              // FIX: cancel any pending debounce then immediately fetch with
              // search: '' so the table resets to all rows without delay
              if (searchDebounceRef.current) clearTimeout(searchDebounceRef.current);
              fetchData(1, { courseTitle: '', startDate: '', endDate: '', search: '' });
            }}
            className="absolute right-3 top-1/2 -translate-y-1/2 text-on-surface-secondary hover:text-on-surface"
          >
            <Icon name={IconName.Close} className="w-4 h-4" />
          </button>
        )}
      </div>

      {/* Toast notification */}
      {syncResult && (
        <div className={`fixed top-5 right-5 z-[9999] max-w-sm w-full transition-all duration-300 ${
          toastVisible ? 'translate-x-0 opacity-100' : 'translate-x-4 opacity-0'
        }`}>
          <div className={`flex items-start gap-3 px-4 py-3.5 rounded-xl shadow-lg border backdrop-blur-sm ${
            syncIsError
              ? 'bg-red-950/90 border-red-800/40 text-red-200'
              : 'bg-emerald-950/90 border-emerald-800/40 text-emerald-200'
          }`}>
            <div className={`flex-shrink-0 mt-0.5 w-5 h-5 rounded-full flex items-center justify-center ${
              syncIsError ? 'bg-red-500/20' : 'bg-emerald-500/20'
            }`}>
              {syncIsError ? (
                <Icon name={IconName.Close} className="w-3 h-3 text-red-400" />
              ) : (
                <svg className="w-3 h-3 text-emerald-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                </svg>
              )}
            </div>
            <div className="flex-1 min-w-0">
              <p className={`text-xs font-semibold ${syncIsError ? 'text-red-100' : 'text-emerald-100'}`}>
                {syncIsError ? 'Error' : 'Success'}
              </p>
              <p className="text-xs mt-0.5 opacity-80">{syncResult}</p>
            </div>
            <button
              onClick={() => { setToastVisible(false); setTimeout(() => setSyncResult(null), 300); }}
              className="flex-shrink-0 mt-0.5 opacity-60 hover:opacity-100 transition-opacity"
            >
              <Icon name={IconName.Close} className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>
      )}

      {/* Progress popup */}
      {syncing && (() => {
        const pct = progressTotal > 0 ? Math.round((progressCurrent / progressTotal) * 100) : 0;
        const elapsed = (Date.now() - progressStartTime) / 1000;
        const avgPerItem = progressCurrent > 0 ? elapsed / progressCurrent : 0;
        const remaining = progressCurrent > 0 ? Math.max(0, (progressTotal - progressCurrent) * avgPerItem) : 0;
        const fmt = (s: number) => {
          if (s < 60) return `${Math.ceil(s)}s`;
          return `${Math.floor(s / 60)}m ${Math.ceil(s % 60)}s`;
        };
        const isComplete = progressTotal > 0 && progressCurrent >= progressTotal;

        return (
          <div
            className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/60"
            style={BACKDROP_STYLE}
          >
            <div className="w-full max-w-md mx-4 rounded-2xl bg-surface-elevated shadow-2xl overflow-hidden border border-default/20">

              {/* Top accent bar */}
              <div className={`h-1 ${isComplete ? 'bg-emerald-500' : 'bg-primary'}`} />

              {/* Icon + Title */}
              <div className="flex flex-col items-center pt-7 pb-2 px-6">
                <div className={`w-14 h-14 rounded-full flex items-center justify-center mb-4 ${isComplete ? 'bg-emerald-500/10' : 'bg-primary/10'}`}>
                  {isComplete ? (
                    <svg className="w-7 h-7 text-emerald-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                    </svg>
                  ) : progressTotal === 0 ? (
                    <svg className="w-7 h-7 text-primary animate-pulse" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                    </svg>
                  ) : (
                    <div className="animate-spin rounded-full h-7 w-7 border-[3px] border-primary/30 border-t-primary" />
                  )}
                </div>
                <h3 className="text-base font-semibold text-on-surface">
                  {isComplete ? 'Generation Complete' : progressTotal === 0 ? 'Preparing Invoices' : 'Generating Invoices'}
                </h3>
                <p className="text-xs text-on-surface-secondary mt-1">
                  {isComplete
                    ? `All invoices processed in ${fmt(elapsed)}`
                    : progressTotal > 0
                      ? `Processing invoice ${progressCurrent} of ${progressTotal}`
                      : 'Fetching records and setting up template...'}
                </p>
              </div>

              {/* Progress bar */}
              <div className="px-6 pt-4 pb-2">
                <div className="flex items-center justify-between mb-1.5">
                  <span className="text-[11px] font-medium text-on-surface-secondary">Progress</span>
                  {progressTotal > 0 && (
                    <span className={`text-[11px] font-bold tabular-nums ${isComplete ? 'text-emerald-500' : 'text-primary'}`}>{pct}%</span>
                  )}
                </div>
                <div className="w-full h-2 bg-gray-200 dark:bg-white/5 rounded-full overflow-hidden">
                  {progressTotal > 0 ? (
                    <div
                      className={`h-full rounded-full transition-all duration-700 ease-out ${isComplete ? 'bg-emerald-500' : 'bg-primary'}`}
                      style={{ width: `${pct}%` }}
                    />
                  ) : (
                    <div className="h-full w-full rounded-full overflow-hidden relative">
                      <div className="absolute inset-0 bg-primary/20" />
                      <div className="absolute inset-0 bg-gradient-to-r from-transparent via-primary/50 to-transparent animate-[indeterminate_1.5s_ease-in-out_infinite]" style={{ backgroundSize: '200% 100%' }} />
                    </div>
                  )}
                </div>
              </div>

              {/* Stats row */}
              {progressTotal > 0 && (
                <div className="px-6 pt-3 pb-1">
                  <div className="flex rounded-lg border border-default/15 divide-x divide-default/15 overflow-hidden">
                    <div className="flex-1 py-3 text-center">
                      <div className={`text-base font-bold tabular-nums ${isComplete ? 'text-emerald-500' : 'text-primary'}`}>{progressGenerated}</div>
                      <div className="text-[10px] text-on-surface-secondary font-medium mt-0.5">Generated</div>
                    </div>
                    <div className="flex-1 py-3 text-center">
                      <div className={`text-base font-bold tabular-nums ${progressErrors > 0 ? 'text-red-400' : 'text-on-surface-secondary/40'}`}>{progressErrors}</div>
                      <div className="text-[10px] text-on-surface-secondary font-medium mt-0.5">Errors</div>
                    </div>
                    <div className="flex-1 py-3 text-center">
                      <div className="text-base font-bold tabular-nums text-on-surface">
                        {isComplete ? fmt(elapsed) : progressCurrent > 0 ? `~${fmt(remaining)}` : '--'}
                      </div>
                      <div className="text-[10px] text-on-surface-secondary font-medium mt-0.5">{isComplete ? 'Duration' : 'Remaining'}</div>
                    </div>
                  </div>
                </div>
              )}

              {/* Current learner */}
              {progressName && !isComplete && (
                <div className="px-6 pt-3">
                  <div className="flex items-center gap-2 text-xs text-on-surface-secondary">
                    <div className="w-1.5 h-1.5 rounded-full bg-primary animate-pulse flex-shrink-0" />
                    <span className="truncate">
                      <span className="text-on-surface font-medium">{progressName}</span>
                    </span>
                  </div>
                </div>
              )}

              {/* Footer */}
              <div className="px-6 pt-4 pb-5">
                {isComplete ? (
                  <button
                    onClick={() => setSyncing(false)}
                    className="w-full py-2.5 rounded-lg bg-emerald-500 hover:bg-emerald-600 text-white text-sm font-medium transition-colors"
                  >
                    Done
                  </button>
                ) : (
                  <p className="text-[11px] text-center text-on-surface-secondary/60">
                    Please do not close this page while invoices are being generated.
                  </p>
                )}
              </div>

            </div>
          </div>
        );
      })()}

      {/* Table */}
      <Card className="overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm border-collapse">
            <thead>
              <tr className="border-b border-[#232c3b] bg-[#434c5e]">
                <th className={`${headerCell} text-left`}>Course Run</th>
                <th className={`${headerCell} text-left`}>Course Code</th>
                <th className={`${headerCell} text-left`}>Course Title</th>
                <th className={`${headerCell} text-left`}>Start Date</th>
                <th className={`${headerCell} text-left`}>End Date</th>
                <th className={`${headerCell} text-left`}>Name</th>
                <th className={`${headerCell} text-right`}>Fees (excl. GST)</th>
                <th className={`${headerCell} text-center`}>Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#232c3b]">
              {loading ? (
                Array.from({ length: 6 }).map((_, i) => (
                  <tr key={i} className="animate-pulse">
                    <td className={cell}><div className="h-3.5 w-16 bg-gray-200 dark:bg-gray-700 rounded" /></td>
                    <td className={cell}><div className="h-3.5 w-28 bg-gray-200 dark:bg-gray-700 rounded" /></td>
                    <td className={cell}><div className="h-3.5 w-40 bg-gray-200 dark:bg-gray-700 rounded" /></td>
                    <td className={cell}><div className="h-3.5 w-20 bg-gray-200 dark:bg-gray-700 rounded" /></td>
                    <td className={cell}><div className="h-3.5 w-20 bg-gray-200 dark:bg-gray-700 rounded" /></td>
                    <td className={cell}><div className="h-3.5 w-32 bg-gray-200 dark:bg-gray-700 rounded" /></td>
                    <td className={cell}><div className="h-3.5 w-16 bg-gray-200 dark:bg-gray-700 rounded ml-auto" /></td>
                    <td className={cell}><div className="h-6 w-16 bg-gray-200 dark:bg-gray-700 rounded-full mx-auto" /></td>
                  </tr>
                ))
              ) : !fetched || records.length === 0 ? (
                <tr><td colSpan={8} className="px-4 py-16 text-center">
                  <div className="flex flex-col items-center gap-3">
                    <div className="w-12 h-12 rounded-full bg-primary/10 flex items-center justify-center">
                      <Icon name={IconName.FileText} className="w-6 h-6 text-primary/60" />
                    </div>
                    <div>
                      <p className="text-sm font-medium text-on-surface">No invoices found</p>
                      <p className="text-xs text-on-surface-secondary mt-0.5">Try adjusting your search or generate new invoices</p>
                    </div>
                  </div>
                </td></tr>
              ) : records.map(record => (
                <tr key={record.id} className="border-b border-[#232c3b] hover:bg-surface-hover/50 transition-colors">
                  <td className={`${cell} text-left font-mono text-on-surface text-[11px]`}>{record.course_run_id || '-'}</td>
                  <td className={`${cell} text-left font-mono text-on-surface-secondary text-[11px]`}>{record.course_code || '-'}</td>
                  <td className={`${cell} text-left text-on-surface font-medium max-w-[340px] truncate`} title={record.course_title}>{record.course_title}</td>
                  <td className={`${cell} text-left text-on-surface-secondary`}>{formatDate(record.start_date)}</td>
                  <td className={`${cell} text-left text-on-surface-secondary`}>{formatDate(record.end_date)}</td>
                  <td className={`${cell} text-left text-on-surface max-w-[120px] truncate`} title={record.full_name}>{record.full_name}</td>
                  <td className={`${cell} text-right tabular-nums font-medium text-on-surface`}>{formatCurrency(record.course_fees_exclude_gst)}</td>
                  <td className={`${cell} text-center`}>
                    {record.pro_forma_url ? (
                      <button
                        onClick={() => handleDriveLink(record)}
                        disabled={verifyingId === record.id}
                        title="Open in Google Drive"
                        className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-semibold
                          bg-green-50 text-green-700 hover:bg-green-100
                          dark:bg-green-900/20 dark:text-green-400 dark:hover:bg-green-900/40
                          transition-colors disabled:opacity-60"
                      >
                        {verifyingId === record.id ? (
                          <div className="animate-spin rounded-full h-3.5 w-3.5 border-b-2 border-green-700 dark:border-green-400" />
                        ) : (
                          <Icon name={IconName.ExternalLink} className="w-3.5 h-3.5" />
                        )}
                        {verifyingId === record.id ? 'Checking...' : 'View'}
                      </button>
                    ) : (
                      <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[11px] font-medium bg-gray-100 text-gray-500 dark:bg-gray-700/40 dark:text-gray-400">
                        <span className="w-1.5 h-1.5 rounded-full bg-gray-400 dark:bg-gray-500" />
                        Pending
                      </span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* Pagination */}
        {totalCount > 0 && (
          <div className="flex items-center justify-between px-4 py-3 border-t border-[#232c3b] bg-[#434c5e]">
            <p className="text-xs text-[#f4f6fa]">
              Showing <span className="font-medium text-[#f4f6fa]">{totalCount === 0 ? 0 : (currentPage - 1) * PAGE_SIZE + 1}–{Math.min(currentPage * PAGE_SIZE, totalCount)}</span> of <span className="font-medium text-[#f4f6fa]">{totalCount.toLocaleString()}</span> invoices
            </p>
            <div className="flex items-center gap-1.5">
              <button
                onClick={() => fetchData(currentPage - 1)}
                disabled={currentPage <= 1}
                className="px-3 py-1.5 text-xs rounded-md border border-default bg-surface hover:bg-surface-hover disabled:opacity-40 disabled:cursor-not-allowed text-on-surface transition-colors"
              >
                Previous
              </button>
              <span className="px-2 text-xs text-on-surface-secondary tabular-nums">
                {currentPage} / {totalPages || 1}
              </span>
              <button
                onClick={() => fetchData(currentPage + 1)}
                disabled={currentPage >= totalPages}
                className="px-3 py-1.5 text-xs rounded-md border border-default bg-surface hover:bg-surface-hover disabled:opacity-40 disabled:cursor-not-allowed text-on-surface transition-colors"
              >
                Next
              </button>
            </div>
          </div>
        )}
      </Card>

      {/* Generate popup */}
      {showGeneratePopup && (
        <div
          className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/70"
          style={BACKDROP_STYLE}
        >
          <div className="bg-surface rounded-2xl shadow-2xl max-w-5xl w-full border border-default overflow-hidden mx-4">
            {/* Header */}
            <div className="flex items-center justify-between px-6 py-4 border-b border-default bg-surface-elevated">
              <div className="flex items-center gap-3">
                <div className="flex items-center justify-center w-9 h-9 rounded-lg bg-primary/10">
                  <Icon name={IconName.Sync} className="w-5 h-5 text-primary" />
                </div>
                <div>
                  <h3 className="text-base font-semibold text-on-surface">Generate Proforma Invoices</h3>
                  <p className="text-xs text-on-surface-secondary mt-0.5">Filter enrollments or leave empty to generate all pending</p>
                </div>
              </div>
              <button onClick={() => setShowGeneratePopup(false)} className="p-1.5 rounded-lg text-on-surface-secondary hover:text-on-surface hover:bg-surface-hover transition-colors">
                <Icon name={IconName.Close} className="w-4 h-4" />
              </button>
            </div>

            {/* Body */}
            <div className="px-6 py-5 space-y-4">
              {/* Filter grid */}
              <div className="grid grid-cols-2 gap-x-4 gap-y-3">
                <div>
                  <label className="block text-xs font-medium text-on-surface-secondary mb-1.5">Course Run</label>
                  <input
                    type="text"
                    value={genCourseRun}
                    onChange={e => setGenCourseRun(e.target.value)}
                    placeholder="e.g. CRS-RUN-001"
                    className="w-full px-3 py-2 text-sm bg-surface border border-default rounded-lg focus:outline-none focus:ring-2 focus:ring-primary/40 focus:border-primary text-on-surface placeholder-gray-400 transition-shadow"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-on-surface-secondary mb-1.5">Course Code</label>
                  <input
                    type="text"
                    value={genCourseCode}
                    onChange={e => setGenCourseCode(e.target.value)}
                    placeholder="e.g. TGS-2024-001234"
                    className="w-full px-3 py-2 text-sm bg-surface border border-default rounded-lg focus:outline-none focus:ring-2 focus:ring-primary/40 focus:border-primary text-on-surface placeholder-gray-400 transition-shadow"
                  />
                </div>
                <div className="col-span-2">
                  <label className="block text-xs font-medium text-on-surface-secondary mb-1.5">Course Title</label>
                  <input
                    type="text"
                    value={genCourseTitle}
                    onChange={e => setGenCourseTitle(e.target.value)}
                    placeholder="Search by course title..."
                    className="w-full px-3 py-2 text-sm bg-surface border border-default rounded-lg focus:outline-none focus:ring-2 focus:ring-primary/40 focus:border-primary text-on-surface placeholder-gray-400 transition-shadow"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-on-surface-secondary mb-1.5">Start Date</label>
                  <input
                    type="date"
                    value={genStartDate}
                    onChange={e => setGenStartDate(e.target.value)}
                    className="w-full px-3 py-2 text-sm bg-surface border border-default rounded-lg focus:outline-none focus:ring-2 focus:ring-primary/40 focus:border-primary text-on-surface transition-shadow"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-on-surface-secondary mb-1.5">End Date</label>
                  <input
                    type="date"
                    value={genEndDate}
                    onChange={e => setGenEndDate(e.target.value)}
                    className="w-full px-3 py-2 text-sm bg-surface border border-default rounded-lg focus:outline-none focus:ring-2 focus:ring-primary/40 focus:border-primary text-on-surface transition-shadow"
                  />
                </div>
                <div className="col-span-2">
                  <label className="block text-xs font-medium text-on-surface-secondary mb-1.5">Learner Name</label>
                  <input
                    type="text"
                    value={genName}
                    onChange={e => setGenName(e.target.value)}
                    placeholder="Search by learner name..."
                    className="w-full px-3 py-2 text-sm bg-surface border border-default rounded-lg focus:outline-none focus:ring-2 focus:ring-primary/40 focus:border-primary text-on-surface placeholder-gray-400 transition-shadow"
                  />
                </div>
              </div>

              {/* Divider */}
              <div className="border-t border-default" />

              {/* Live preview results */}
              <div>
                <div className="flex items-center justify-between mb-2">
                  <span className="text-xs font-medium text-on-surface-secondary uppercase tracking-wider">
                    Preview {!previewLoading && (previewCount > 0 || (genCourseRun.trim() || genCourseCode.trim() || genCourseTitle.trim() || genStartDate || genEndDate || genName.trim())) ? `· ${previewCount} record${previewCount !== 1 ? 's' : ''}` : ''}
                  </span>
                  {previewLoading && (
                    <div className="flex items-center gap-1.5 text-xs text-on-surface-secondary">
                      <div className="animate-spin rounded-full h-3 w-3 border-2 border-primary border-t-transparent" />
                      Searching...
                    </div>
                  )}
                </div>
                <div className="border border-default rounded-lg bg-surface-elevated overflow-hidden">
                  <div className="max-h-44 overflow-y-auto overflow-x-auto relative">
                    {!(genCourseRun.trim() || genCourseCode.trim() || genCourseTitle.trim() || genStartDate || genEndDate || genName.trim()) ? (
                      <div className="flex flex-col items-center justify-center py-8 text-on-surface-secondary">
                        <Icon name={IconName.Search} className="w-6 h-6 mb-2 opacity-40" />
                        <span className="text-xs">Enter a filter above to preview matching records</span>
                      </div>
                    ) : previewLoading && previewRecords.length === 0 ? (
                      <div className="flex items-center justify-center py-8 gap-2 text-xs text-on-surface-secondary">
                        <div className="animate-spin rounded-full h-4 w-4 border-2 border-primary border-t-transparent" />
                        Loading preview...
                      </div>
                    ) : previewRecords.length === 0 ? (
                      <div className="flex flex-col items-center justify-center py-8 text-on-surface-secondary">
                        <Icon name={IconName.InfoCircle} className="w-6 h-6 mb-2 opacity-40" />
                        <span className="text-xs">No matching records found</span>
                      </div>
                    ) : (
                      <table className="w-full text-xs">
                        <thead>
                          <tr>
                            <th className="px-3 py-2.5 text-center w-10">
                              <input
                                type="checkbox"
                                checked={previewRecords.length > 0 && previewRecords.every(r => selectedIds.has(r.id))}
                                onChange={e => {
                                  if (e.target.checked) {
                                    setSelectedIds(new Set(previewRecords.map(r => r.id)));
                                  } else {
                                    setSelectedIds(new Set());
                                  }
                                }}
                                className="w-3.5 h-3.5 rounded border-gray-400 text-primary focus:ring-primary/40 cursor-pointer"
                              />
                            </th>
                            <th className="px-3 py-2.5 text-left font-semibold text-white/90 dark:text-white/80">Course Run</th>
                            <th className="px-3 py-2.5 text-left font-semibold text-white/90 dark:text-white/80">Course Code</th>
                            <th className="px-3 py-2.5 text-left font-semibold text-white/90 dark:text-white/80">Course Title</th>
                            <th className="px-3 py-2.5 text-left font-semibold text-white/90 dark:text-white/80">Start Date</th>
                            <th className="px-3 py-2.5 text-left font-semibold text-white/90 dark:text-white/80">End Date</th>
                            <th className="px-3 py-2.5 text-left font-semibold text-white/90 dark:text-white/80">Name</th>
                            <th className="px-3 py-2.5 text-right font-semibold text-white/90 dark:text-white/80">Fees (excl. GST)</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-default bg-surface">
                          {previewRecords.map((r, i) => (
                            <tr key={r.id} className={`hover:bg-surface-hover transition-colors ${selectedIds.has(r.id) ? 'bg-primary/5' : i % 2 === 1 ? 'bg-surface-elevated/50' : ''}`}>
                              <td className="px-3 py-2 text-center w-10">
                                <input
                                  type="checkbox"
                                  checked={selectedIds.has(r.id)}
                                  onChange={e => {
                                    const next = new Set(selectedIds);
                                    if (e.target.checked) next.add(r.id); else next.delete(r.id);
                                    setSelectedIds(next);
                                  }}
                                  className="w-3.5 h-3.5 rounded border-gray-400 text-primary focus:ring-primary/40 cursor-pointer"
                                />
                              </td>
                              <td className="px-3 py-2 text-on-surface font-mono whitespace-nowrap">{r.course_run_id || '-'}</td>
                              <td className="px-3 py-2 text-on-surface-secondary font-mono whitespace-nowrap">{r.course_code || '-'}</td>
                              <td className="px-3 py-2 text-on-surface truncate max-w-[340px]" title={r.course_title}>{r.course_title}</td>
                              <td className="px-3 py-2 text-on-surface-secondary whitespace-nowrap">{formatDate(r.start_date)}</td>
                              <td className="px-3 py-2 text-on-surface-secondary whitespace-nowrap">{formatDate(r.end_date)}</td>
                              <td className="px-3 py-2 text-on-surface max-w-[120px] truncate" title={r.full_name}>{r.full_name}</td>
                              <td className="px-3 py-2 text-on-surface text-right tabular-nums whitespace-nowrap">{formatCurrency(r.course_fees_exclude_gst)}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    )}
                  </div>
                </div>
              </div>
            </div>

            {/* Footer */}
            <div className="flex items-center justify-between px-6 py-4 border-t border-default bg-surface-elevated">
              <span className="text-xs text-on-surface-secondary">
                {selectedIds.size > 0 ? `${selectedIds.size} invoice${selectedIds.size !== 1 ? 's' : ''} selected to generate` : previewCount > 0 ? 'No records selected' : 'All pending proforma invoices will be generated'}
              </span>
              <div className="flex items-center gap-3">
                <button
                  onClick={() => setShowGeneratePopup(false)}
                  className="px-4 py-2 text-sm font-medium rounded-lg border border-default bg-surface hover:bg-surface-hover text-on-surface transition-colors"
                >
                  Cancel
                </button>
                <button
                  onClick={handleGenerateClick}
                  disabled={previewRecords.length > 0 && selectedIds.size === 0}
                  className="inline-flex items-center gap-2 px-5 py-2 text-sm font-medium rounded-lg bg-primary text-white hover:bg-primary/90 shadow-sm transition-all disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  <Icon name={IconName.Sync} className="w-4 h-4" />
                  Generate
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Confirm generate all popup */}
      {showConfirmAll && (
        <div
          className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/60"
          style={BACKDROP_STYLE}
        >
          <div className="bg-surface rounded-xl shadow-2xl max-w-md w-full mx-4 p-6 border border-default">
            <div className="flex items-center gap-3 mb-4">
              <div className="flex-shrink-0 w-10 h-10 rounded-full bg-amber-100 dark:bg-amber-900/30 flex items-center justify-center">
                <Icon name={IconName.Warning} className="w-5 h-5 text-amber-600 dark:text-amber-400" />
              </div>
              <h3 className="text-lg font-semibold text-on-surface">Generate All Pending Invoices?</h3>
            </div>
            <p className="text-sm text-on-surface-secondary mb-2">
              You are about to generate <span className="font-semibold text-on-surface">all pending proforma invoices</span> with no filters applied.
            </p>
            <p className="text-sm text-on-surface-secondary mb-6">
              This may take a significant amount of time depending on the number of records. Are you sure you want to proceed?
            </p>
            <div className="flex justify-end gap-3">
              <button
                onClick={() => setShowConfirmAll(false)}
                className="px-4 py-2 text-sm font-medium rounded-lg border border-default bg-surface hover:bg-surface-hover text-on-surface transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={handleSync}
                className="inline-flex items-center gap-2 px-4 py-2 text-sm font-medium rounded-lg bg-amber-500 text-white hover:bg-amber-600 transition-colors"
              >
                <Icon name={IconName.Sync} className="w-4 h-4" />
                Yes, Generate All
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Regenerate popup */}
      {popupRecord && (
        <div
          className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/50"
          style={BACKDROP_STYLE}
        >
          <div className="bg-surface rounded-xl shadow-xl max-w-md w-full mx-4 p-6 border border-default">
            <div className="flex items-center gap-3 mb-4">
              <div className="flex-shrink-0 w-10 h-10 rounded-full bg-amber-100 dark:bg-amber-900/30 flex items-center justify-center">
                <Icon name={IconName.Warning} className="w-5 h-5 text-amber-600 dark:text-amber-400" />
              </div>
              <h3 className="text-lg font-semibold text-on-surface">Invoice Unavailable</h3>
            </div>
            <p className="text-sm text-on-surface-secondary mb-2">
              The proforma invoice for <span className="font-medium text-on-surface">{popupRecord.full_name}</span> is no longer available on Google Drive.
            </p>
            <p className="text-sm text-on-surface-secondary mb-6">
              Would you like to regenerate this invoice?
            </p>
            <div className="flex justify-end gap-3">
              <button
                onClick={() => setPopupRecord(null)}
                disabled={regenerating}
                className="px-4 py-2 text-sm rounded-lg border border-default bg-surface hover:bg-surface-hover text-on-surface transition-colors disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                onClick={handleRegenerate}
                disabled={regenerating}
                className="inline-flex items-center gap-2 px-4 py-2 text-sm rounded-lg bg-primary text-white hover:bg-primary/90 transition-colors disabled:opacity-60"
              >
                {regenerating && <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white" />}
                {regenerating ? 'Regenerating...' : 'Regenerate'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default ProFormaInvoiceView;