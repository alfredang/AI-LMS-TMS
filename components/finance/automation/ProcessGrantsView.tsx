import React, { useEffect, useMemo, useRef, useState } from 'react';
import { ssgFetch } from '@lib/ssgAppState';
import AutomationPageShell from './AutomationPageShell';
import { Card } from '../../ui/Card';
import { Button } from '../../ui/Button';
import { Icon, IconName } from '../../ui/Icon';

const PAGE_SIZE = 10;

const getStatusColor = (status: string) => {
  switch (status) {
    case 'Paid':
    case 'Claimed':
    case 'Approved':
    case 'C':
    case 'Competent':
    case 'Pass':
    case 'Success':
    case 'Successful':
    case 'Full Payment':
      return 'bg-success-bg text-success border-green-200 dark:border-green-800';
    case 'Processing':
      return 'bg-info-bg text-info border-blue-200 dark:border-blue-800';
    case 'Pending':
    case 'In Progress':
    case 'Pending Assessment':
      return 'bg-warning-bg text-warning border-yellow-200 dark:border-yellow-800';
    case 'Overdue':
    case 'Rejected':
    case 'Unpaid':
    case 'NYC':
    case 'Not Yet Competent':
    case 'Fail':
    case 'Failed':
      return 'bg-danger-bg text-danger border-red-200 dark:border-red-800';
    default:
      return 'bg-surface-elevated text-on-surface border-default';
  }
};

type GrantsSearchResponse = {
  success?: boolean;
  data?: any[];
  meta?: any;
  error?: string;
  details?: unknown;
};

function formatGrantSearchFailure(json: GrantsSearchResponse, httpStatus: number): string {
  const base = json.error?.trim() || `SSG error ${httpStatus}`;
  const d = json.details;
  if (d == null) return base;
  if (typeof d === 'string' && d.trim()) return `${base} — ${d.slice(0, 400)}`;
  try {
    const s = JSON.stringify(d);
    if (s && s !== '{}' && s !== 'null') return `${base} — ${s.slice(0, 400)}`;
  } catch { /* ignore */ }
  return base;
}

export default function ProcessGrantsView() {
  const [courseRunId, setCourseRunId] = useState('');
  const [isSearching, setIsSearching] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [grantsData, setGrantsData] = useState<{ data: any[]; meta: any } | null>(null);
  const [currentPage, setCurrentPage] = useState(0);

  const [selectedEnrolmentIds, setSelectedEnrolmentIds] = useState<string[]>([]);
  const [showConfirm, setShowConfirm] = useState(false);
  const [processing, setProcessing] = useState(false);
  const [toast, setToast] = useState<{ message: string; variant: 'success' | 'error' } | null>(null);
  const [lastResult, setLastResult] = useState<null | {
    summary?: { total?: number; succeeded?: number; failed?: number };
    results?: Array<{ enrolmentId: string; success: boolean; error?: string; grantsUpserted?: number }>;
  }>(null);
  const selectAllRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 8000);
    return () => clearTimeout(t);
  }, [toast]);

  const groupedRows = useMemo(() => {
    const data = grantsData?.data ?? [];
    const grouped: Record<string, any[]> = {};
    for (const item of data) {
      const enrolKey = item.enrolment?.referenceNumber || 'Unknown';
      if (!grouped[enrolKey]) grouped[enrolKey] = [];
      grouped[enrolKey].push(item);
    }
    return Object.entries(grouped);
  }, [grantsData]);

  const totalPages = Math.ceil(groupedRows.length / PAGE_SIZE);
  const pagedRows = groupedRows.slice(currentPage * PAGE_SIZE, (currentPage + 1) * PAGE_SIZE);

  const pageEnrolmentIds = useMemo(
    () => pagedRows.map(([enrolmentId]) => enrolmentId).filter((id) => id && id !== 'Unknown'),
    [pagedRows]
  );
  const selectedOnPage = useMemo(
    () => pageEnrolmentIds.filter((id) => selectedEnrolmentIds.includes(id)),
    [pageEnrolmentIds, selectedEnrolmentIds]
  );
  const allPageSelected = pageEnrolmentIds.length > 0 && selectedOnPage.length === pageEnrolmentIds.length;

  useEffect(() => {
    const el = selectAllRef.current;
    if (!el) return;
    el.indeterminate = selectedOnPage.length > 0 && selectedOnPage.length < pageEnrolmentIds.length;
  }, [selectedOnPage.length, pageEnrolmentIds.length]);

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

  const enrolmentIds = selectedEnrolmentIds;

  const run = async () => {
    setShowConfirm(false);
    if (enrolmentIds.length === 0) {
      setToast({ variant: 'error', message: 'Select one or more enrolments to process.' });
      return;
    }
    if (enrolmentIds.length > 50) {
      setToast({ variant: 'error', message: 'At most 50 enrolment IDs per run.' });
      return;
    }

    setProcessing(true);
    setLastResult(null);
    try {
      const res = await ssgFetch('/api/finance/automation/process-grants', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ enrolmentIds }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || 'Request failed');
      setLastResult(json);

      const s = json?.summary?.succeeded ?? 0;
      const f = json?.summary?.failed ?? 0;
      setToast({
        variant: f === 0 ? 'success' : 'error',
        message: f === 0 ? `Grants refreshed for ${s} enrolment(s).` : `${s} ok, ${f} failed. See details below.`,
      });
    } catch (e) {
      setToast({ variant: 'error', message: e instanceof Error ? e.message : 'Failed to process grants' });
    } finally {
      setProcessing(false);
    }
  };

  const openRun = () => {
    if (selectedEnrolmentIds.length === 0) {
      setToast({ variant: 'error', message: 'Select one or more enrolments to process.' });
      return;
    }
    if (selectedEnrolmentIds.length > 1) setShowConfirm(true);
    else void run();
  };

  const handleSearch = async () => {
    const trimmed = courseRunId.trim();
    if (!trimmed) {
      setSearchError('Please enter Course Run ID');
      return;
    }

    setIsSearching(true);
    setSearchError(null);
    setGrantsData(null);
    setCurrentPage(0);
    setSelectedEnrolmentIds([]);
    setLastResult(null);

    try {
      const response = await ssgFetch('/api/grants/search', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ courseRunId: trimmed }),
      });
      const json = (await response.json()) as GrantsSearchResponse;
      if (!json.success) {
        setSearchError(formatGrantSearchFailure(json, response.status));
        return;
      }
      setGrantsData({ data: json.data ?? [], meta: json.meta ?? {} });
    } catch (e) {
      setSearchError(e instanceof Error ? e.message : 'Failed to connect to SSG.');
    } finally {
      setIsSearching(false);
    }
  };

  return (
    <AutomationPageShell
      title="Process Grants"
      description="Search by Course Run ID, select the enrolments you want, then fetch grant details from SSG and upsert into ssg_grants. (Max 50 enrolments per run.)"
    >
      <div className="space-y-4">
        {toast && (
          <div
            className={`rounded-lg px-4 py-3 text-sm shadow ${
              toast.variant === 'success' ? 'bg-green-800 text-white' : 'bg-red-800 text-white'
            }`}
            role="status"
          >
            {toast.message}
          </div>
        )}

        {/* Search UI + results modeled after Search Grant */}
        <div>
          <h2 className="text-2xl font-bold mb-4 text-on-surface">Process Grants</h2>

          <Card className="p-6 mb-6">
            <div>
              <h3 className="text-lg font-bold text-on-surface-secondary mb-4">Grant Search Parameters</h3>

              <div className="mb-4">
                <label htmlFor="course-run-id" className="block text-sm font-bold text-on-surface-secondary mb-1">
                  Course Run ID
                </label>
                <input
                  id="course-run-id"
                  type="text"
                  value={courseRunId}
                  onChange={(e) => setCourseRunId(e.target.value)}
                  placeholder="e.g. 1322143"
                  className="block w-full px-3 py-2 text-on-surface bg-surface border border-strong rounded-md shadow-sm placeholder-muted focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent dark:text-white"
                  disabled={isSearching || processing}
                />
              </div>

              <div className="flex justify-end">
                <Button
                  onClick={() => void handleSearch()}
                  disabled={isSearching || processing || !courseRunId.trim()}
                  className="whitespace-nowrap"
                >
                  {isSearching ? (
                    <div className="flex items-center">
                      <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white mr-2"></div>
                      Searching...
                    </div>
                  ) : (
                    <>
                      <Icon name={IconName.Search} className="w-4 h-4 mr-2" />
                      Search Grant
                    </>
                  )}
                </Button>
              </div>

              {searchError && (
                <p className="text-danger text-sm mt-3">{searchError}</p>
              )}
            </div>
          </Card>

          {grantsData && !isSearching && (
            <Card className="p-0">
              <div className="p-6 border-b dark:border-gray-700">
                <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
                  <div>
                    <h3 className="text-xl font-bold dark:text-white">Grant Search Results</h3>
                    <p className="text-muted mt-1">Course Run ID: {courseRunId}</p>
                  </div>
                  <div className="flex flex-col items-end gap-2">
                    <div className="text-sm text-muted">
                      Selected: <strong className="text-on-surface">{selectedEnrolmentIds.length}</strong>
                      {selectedEnrolmentIds.length > 50 && <span className="ml-2 text-amber-200">(max 50 per run)</span>}
                    </div>
                    <div className="flex items-center gap-2">
                      <Button
                        variant="ghost"
                        onClick={() => { setSelectedEnrolmentIds([]); setLastResult(null); }}
                        disabled={processing}
                      >
                        Clear selection
                      </Button>
                      <Button
                        onClick={openRun}
                        disabled={processing || selectedEnrolmentIds.length === 0 || selectedEnrolmentIds.length > 50}
                      >
                        {processing ? (
                          <>
                            <span className="inline-block h-3.5 w-3.5 border-2 border-white/40 border-t-white rounded-full animate-spin mr-2" />
                            Processing…
                          </>
                        ) : (
                          'Process Grants'
                        )}
                      </Button>
                    </div>
                  </div>
                </div>
              </div>

              <div className="p-6">
                {Array.isArray(grantsData.data) && grantsData.data.length > 0 ? (() => {
                  const BL_CODES = ['Baseline', 'BL'];
                  const rows = groupedRows;
                  const paged = pagedRows;
                  const totalGrantRecords = grantsData.meta?.totalRecords ?? grantsData.data.length;

                  return (
                    <div className="space-y-3">
                      <div className="flex items-center bg-info-bg px-4 py-2 rounded-lg border border-blue-100 dark:border-blue-800 text-sm">
                        <span className="font-bold text-blue-900 dark:text-blue-300 mr-3">
                          {rows.length} Enrolment{rows.length !== 1 ? 's' : ''} &nbsp;·&nbsp; {totalGrantRecords} Grant{totalGrantRecords !== 1 ? 's' : ''}
                        </span>
                        <span className="text-primary">
                          Course Run: <span className="font-mono">{courseRunId}</span>
                        </span>
                      </div>

                      {/* Desktop table */}
                      <div className="hidden md:block overflow-x-auto rounded-lg border border-default">
                        <table className="min-w-full divide-y divide-default text-xs">
                          <thead className="bg-surface-elevated">
                            <tr>
                              <th className="px-3 py-2 text-center text-xs font-semibold text-on-surface-secondary border-r border-default uppercase tracking-wider">
                                <input
                                  ref={selectAllRef}
                                  type="checkbox"
                                  className="rounded border-default"
                                  checked={allPageSelected}
                                  onChange={toggleSelectAllPage}
                                  disabled={pageEnrolmentIds.length === 0 || processing}
                                  title="Select all on this page"
                                />
                              </th>
                              <th className="px-3 py-2 text-center text-xs font-semibold text-on-surface-secondary border-r border-default uppercase tracking-wider">Enrolment</th>
                              <th colSpan={3} className="px-3 py-2 text-center text-xs font-semibold text-primary border-r border-default uppercase tracking-wider bg-info-bg">Baseline (BL)</th>
                              <th colSpan={4} className="px-3 py-2 text-center text-xs font-semibold text-purple-700 dark:text-purple-400 border-r border-default uppercase tracking-wider bg-purple-50 dark:bg-purple-900/20">MCES / SME / IBF</th>
                              <th className="px-3 py-2 text-center text-xs font-semibold text-success uppercase tracking-wider bg-success-bg">Total</th>
                            </tr>
                            <tr>
                              <th className="px-3 py-2 text-left font-medium text-muted whitespace-nowrap border-r border-default">Select</th>
                              <th className="px-3 py-2 text-left font-medium text-muted whitespace-nowrap border-r border-default">Enrolment ID</th>
                              <th className="px-3 py-2 text-left font-medium text-primary whitespace-nowrap bg-info-bg">Grant Status</th>
                              <th className="px-3 py-2 text-left font-medium text-primary whitespace-nowrap bg-info-bg">Grant ID (BL)</th>
                              <th className="px-3 py-2 text-left font-medium text-primary whitespace-nowrap border-r border-default bg-info-bg">Amount (BL)</th>
                              <th className="px-3 py-2 text-left font-medium text-purple-600 dark:text-purple-400 whitespace-nowrap bg-purple-50 dark:bg-purple-900/20">Grant Status</th>
                              <th className="px-3 py-2 text-left font-medium text-purple-600 dark:text-purple-400 whitespace-nowrap bg-purple-50 dark:bg-purple-900/20">Grant ID</th>
                              <th className="px-3 py-2 text-left font-medium text-purple-600 dark:text-purple-400 whitespace-nowrap bg-purple-50 dark:bg-purple-900/20">Scheme Code</th>
                              <th className="px-3 py-2 text-left font-medium text-purple-600 dark:text-purple-400 whitespace-nowrap border-r border-default bg-purple-50 dark:bg-purple-900/20">Amount</th>
                              <th className="px-3 py-2 text-left font-medium text-success whitespace-nowrap bg-success-bg">TG Amount</th>
                            </tr>
                          </thead>
                          <tbody className="bg-surface divide-y divide-default">
                            {paged.map(([enrolmentId, grants]) => {
                              const bl = grants.find((g: any) => BL_CODES.includes(g.fundingScheme?.code));
                              const mces = grants.find((g: any) => !BL_CODES.includes(g.fundingScheme?.code));
                              const totalTG = grants.reduce((sum: number, g: any) => sum + (g.grantAmount?.estimated ?? 0), 0);
                              const selectable = enrolmentId && enrolmentId !== 'Unknown';
                              return (
                                <tr key={enrolmentId} className="hover:bg-surface-hover">
                                  <td className="px-3 py-3 text-center border-r border-default">
                                    {selectable ? (
                                      <input
                                        type="checkbox"
                                        className="rounded border-default"
                                        checked={selectedEnrolmentIds.includes(enrolmentId)}
                                        onChange={() => toggleRowSelected(enrolmentId)}
                                        disabled={processing}
                                      />
                                    ) : (
                                      <span className="text-muted">—</span>
                                    )}
                                  </td>
                                  <td className="px-3 py-3 font-mono text-on-surface whitespace-nowrap border-r border-default">{enrolmentId}</td>
                                  <td className="px-3 py-3 whitespace-nowrap bg-blue-50/30 dark:bg-blue-900/10">
                                    {bl ? <span className={`inline-flex px-2 py-0.5 text-xs font-semibold rounded-full border ${getStatusColor(bl.status)}`}>{bl.status}</span> : <span className="text-muted">—</span>}
                                  </td>
                                  <td className="px-3 py-3 font-mono text-on-surface-secondary whitespace-nowrap bg-blue-50/30 dark:bg-blue-900/10">{bl?.referenceNumber || '—'}</td>
                                  <td className="px-3 py-3 text-on-surface-secondary whitespace-nowrap border-r border-default bg-blue-50/30 dark:bg-blue-900/10">{bl ? `$${(bl.grantAmount?.estimated ?? 0).toFixed(2)}` : '—'}</td>
                                  <td className="px-3 py-3 whitespace-nowrap bg-purple-50/30 dark:bg-purple-900/10">
                                    {mces ? <span className={`inline-flex px-2 py-0.5 text-xs font-semibold rounded-full border ${getStatusColor(mces.status)}`}>{mces.status}</span> : <span className="text-muted">—</span>}
                                  </td>
                                  <td className="px-3 py-3 font-mono text-on-surface-secondary whitespace-nowrap bg-purple-50/30 dark:bg-purple-900/10">{mces?.referenceNumber || '—'}</td>
                                  <td className="px-3 py-3 whitespace-nowrap bg-purple-50/30 dark:bg-purple-900/10">
                                    {mces ? <span className="font-mono text-xs bg-purple-100 dark:bg-purple-900/40 text-purple-800 dark:text-purple-300 px-1.5 py-0.5 rounded">{mces.fundingScheme?.code}</span> : '—'}
                                  </td>
                                  <td className="px-3 py-3 text-on-surface-secondary whitespace-nowrap border-r border-default bg-purple-50/30 dark:bg-purple-900/10">{mces ? `$${(mces.grantAmount?.estimated ?? 0).toFixed(2)}` : '—'}</td>
                                  <td className="px-3 py-3 font-bold text-success whitespace-nowrap bg-green-50/30 dark:bg-green-900/10">${totalTG.toFixed(2)}</td>
                                </tr>
                              );
                            })}
                          </tbody>
                        </table>
                      </div>

                      {/* Pagination */}
                      {totalPages > 1 && (
                        <div className="flex items-center justify-between pt-2">
                          <p className="text-xs text-muted">
                            Showing {currentPage * PAGE_SIZE + 1}–{Math.min((currentPage + 1) * PAGE_SIZE, rows.length)} of {rows.length} enrolments
                          </p>
                          <div className="flex items-center gap-1">
                            <button
                              onClick={() => setCurrentPage(0)}
                              disabled={currentPage === 0}
                              className="px-2 py-1 text-xs rounded border border-strong disabled:opacity-40 disabled:cursor-not-allowed hover:bg-surface-hover dark:text-gray-300"
                            >«</button>
                            <button
                              onClick={() => setCurrentPage((p) => Math.max(0, p - 1))}
                              disabled={currentPage === 0}
                              className="px-2 py-1 text-xs rounded border border-strong disabled:opacity-40 disabled:cursor-not-allowed hover:bg-surface-hover dark:text-gray-300"
                            >‹</button>
                            {Array.from({ length: totalPages }, (_, i) => i).filter(i =>
                              i === 0 || i === totalPages - 1 || Math.abs(i - currentPage) <= 1
                            ).reduce<(number | string)[]>((acc, i, idx, arr) => {
                              if (idx > 0 && (i as number) - (arr[idx - 1] as number) > 1) acc.push('…');
                              acc.push(i);
                              return acc;
                            }, []).map((item, idx) =>
                              item === '…' ? (
                                <span key={`ellipsis-${idx}`} className="px-1 text-xs text-muted">…</span>
                              ) : (
                                <button
                                  key={item}
                                  onClick={() => setCurrentPage(item as number)}
                                  className={`px-2.5 py-1 text-xs rounded border ${currentPage === item ? 'bg-blue-600 text-white border-blue-600' : 'border-strong hover:bg-surface-hover dark:text-gray-300'}`}
                                >{(item as number) + 1}</button>
                              )
                            )}
                            <button
                              onClick={() => setCurrentPage((p) => Math.min(totalPages - 1, p + 1))}
                              disabled={currentPage === totalPages - 1}
                              className="px-2 py-1 text-xs rounded border border-strong disabled:opacity-40 disabled:cursor-not-allowed hover:bg-surface-hover dark:text-gray-300"
                            >›</button>
                            <button
                              onClick={() => setCurrentPage(totalPages - 1)}
                              disabled={currentPage === totalPages - 1}
                              className="px-2 py-1 text-xs rounded border border-strong disabled:opacity-40 disabled:cursor-not-allowed hover:bg-surface-hover dark:text-gray-300"
                            >»</button>
                          </div>
                        </div>
                      )}
                    </div>
                  );
                })() : (
                  <div className="bg-warning-bg border border-yellow-200 dark:border-yellow-700 rounded-lg p-8 text-center">
                    <Icon name={IconName.InfoCircle} className="w-12 h-12 mx-auto text-yellow-500 dark:text-yellow-400 mb-3" />
                    <h4 className="text-lg font-bold text-warning mb-2">No Records Found</h4>
                    <p className="text-warning">
                      No grant records were returned for this Course Run ID.
                    </p>
                  </div>
                )}

                <div className="mt-6 flex justify-end">
                  <Button
                    variant="outline"
                    onClick={() => {
                      setGrantsData(null);
                      setCourseRunId('');
                      setSelectedEnrolmentIds([]);
                      setLastResult(null);
                    }}
                  >
                    Clear Results
                  </Button>
                </div>
              </div>
            </Card>
          )}

          {!grantsData && !isSearching && (
            <Card className="p-12">
              <div className="text-center text-muted">
                <Icon name={IconName.Search} className="w-16 h-16 mx-auto mb-4 text-muted" />
                <p className="text-lg font-medium">Enter details to search</p>
                <p className="text-sm mt-2">Provide Course Run ID to fetch grant details</p>
              </div>
            </Card>
          )}
        </div>

        {lastResult?.summary && (
          <div className="rounded-lg border border-default bg-surface-elevated p-4 text-sm">
            <div className="flex flex-wrap gap-4">
              <div>
                <div className="text-xs text-on-surface-secondary">Total</div>
                <div className="font-semibold text-on-surface">{lastResult.summary.total ?? '-'}</div>
              </div>
              <div>
                <div className="text-xs text-on-surface-secondary">Succeeded</div>
                <div className="font-semibold text-on-surface">{lastResult.summary.succeeded ?? '-'}</div>
              </div>
              <div>
                <div className="text-xs text-on-surface-secondary">Failed</div>
                <div className="font-semibold text-on-surface">{lastResult.summary.failed ?? '-'}</div>
              </div>
            </div>
          </div>
        )}

        {(lastResult?.results ?? []).length > 0 && (
          <div className="rounded-lg border border-default overflow-hidden">
            <div className="px-4 py-2 bg-surface-elevated text-xs font-semibold text-on-surface-secondary">
              Result details
            </div>
            <div className="divide-y divide-default">
              {(lastResult?.results ?? []).slice(0, 30).map((r) => (
                <div key={r.enrolmentId} className="px-4 py-2 text-sm flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="font-mono text-xs text-on-surface">{r.enrolmentId}</div>
                    {!r.success && (
                      <div className="mt-1 text-xs text-red-300 break-words">{r.error || 'Unknown error'}</div>
                    )}
                    {r.success && typeof r.grantsUpserted === 'number' && (
                      <div className="mt-1 text-xs text-on-surface-secondary">Upserted: {r.grantsUpserted}</div>
                    )}
                  </div>
                  <span
                    className={`shrink-0 inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${
                      r.success ? 'bg-green-900/30 text-green-300' : 'bg-red-900/30 text-red-300'
                    }`}
                  >
                    {r.success ? 'OK' : 'FAILED'}
                  </span>
                </div>
              ))}
              {(lastResult?.results ?? []).length > 30 && (
                <div className="px-4 py-2 text-xs text-on-surface-secondary">
                  Showing first 30 results.
                </div>
              )}
            </div>
          </div>
        )}

        {showConfirm && (
          <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
            <div className="bg-surface rounded-lg shadow-xl max-w-md w-full mx-auto">
              <div className="p-6">
                <div className="flex items-center gap-4 mb-4">
                  <div className="w-12 h-12 rounded-full flex items-center justify-center flex-shrink-0 bg-warning-bg">
                    <Icon name={IconName.InfoCircle} className="w-6 h-6 text-warning" />
                  </div>
                  <h3 className="text-lg font-semibold text-on-surface">Process grants</h3>
                </div>
                <p className="text-on-surface-secondary mb-6">
                  Refresh grant data from SSG for <strong>{selectedEnrolmentIds.length}</strong> selected enrolment(s)?
                  This calls SSG and updates <code className="text-xs bg-surface-elevated px-1 rounded">ssg_grants</code>.
                </p>
                <div className="flex gap-3 justify-end">
                  <Button variant="ghost" onClick={() => setShowConfirm(false)} disabled={processing}>
                    Cancel
                  </Button>
                  <Button onClick={() => { setShowConfirm(false); void run(); }} disabled={processing}>
                    {processing ? 'Processing…' : 'Confirm'}
                  </Button>
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
    </AutomationPageShell>
  );
}

