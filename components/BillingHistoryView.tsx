import React, { useEffect, useState } from 'react';
import { useLms } from '@contexts/LmsContext';
import { Card } from './ui/Card';
import { Icon, IconName } from './ui/Icon';

interface BillingRow {
  enrollment_id: string;
  enrolment_id: string | null;
  course_title: string;
  course_code: string | null;
  course_run_id: string | null;
  enrolment_date: string | null;
  type: string;
  document_url: string | null;
  invoice_number: string | null;
  status: 'Issued' | 'Pending';
  /** QB invoice completed in our system (Drive and/or QBO); PDF available via /api/billing/invoice-pdf even if web view link is missing */
  invoice_pdf_ready?: boolean;
}

interface Summary {
  proformaCount: number;
  invoiceCount: number;
  receiptCount: number;
}

const formatDate = (dateStr: string | null): string => {
  if (!dateStr) return '—';
  return new Date(dateStr).toLocaleDateString('en-SG', {
    day: '2-digit', month: 'short', year: 'numeric',
  });
};

const typeBadgeClass = (type: string): string => {
  switch (type) {
    case 'Proforma Invoice':
      return 'bg-yellow-50 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-300';
    case 'Personal Invoice':
      return 'bg-purple-50 text-purple-700 dark:bg-purple-900/30 dark:text-purple-300';
    case 'Company Invoice':
      return 'bg-indigo-50 text-indigo-700 dark:bg-indigo-900/30 dark:text-indigo-300';
    case 'Receipt':
      return 'bg-red-50 text-red-700 dark:bg-red-900/30 dark:text-red-300';
    default:
      return 'bg-gray-100 text-gray-500 dark:bg-gray-700 dark:text-gray-400';
  }
};

const BillingHistoryView: React.FC = () => {
  const { currentUser } = useLms();
  const [rows, setRows] = useState<BillingRow[]>([]);
  const [summary, setSummary] = useState<Summary>({ proformaCount: 0, invoiceCount: 0, receiptCount: 0 });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [verifyingId, setVerifyingId] = useState<string | null>(null);
  const [downloadingId, setDownloadingId] = useState<string | null>(null);
  const [brokenLinks, setBrokenLinks] = useState<Set<string>>(new Set());

  useEffect(() => {
    if (!currentUser?.id) return;
    const fetchData = async () => {
      setLoading(true);
      setError(null);
      try {
        const res = await fetch(`/api/billing/billing-history?userId=${currentUser.id}`);
        const json = await res.json();
        if (!json.success) throw new Error(json.error || 'Failed to load billing history');
        setRows(json.data);
        setSummary(json.summary);
      } catch (err: any) {
        setError(err.message || 'Failed to load billing history');
      } finally {
        setLoading(false);
      }
    };
    fetchData();
  }, [currentUser?.id]);

  const filtered = rows.filter(r => {
    if (!search.trim()) return true;
    const q = search.toLowerCase();
    return (
      r.course_title?.toLowerCase().includes(q) ||
      r.course_code?.toLowerCase().includes(q) ||
      r.enrolment_id?.toLowerCase().includes(q) ||
      r.invoice_number?.toLowerCase().includes(q) ||
      r.type?.toLowerCase().includes(q)
    );
  });

  const cell = 'px-4 py-3 text-xs whitespace-nowrap';
  const headerCell = 'px-4 py-3 text-left text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider whitespace-nowrap';

  return (
    <div className="space-y-6">
      {/* Header */}
      <h2 className="text-2xl font-bold text-on-surface">Billing History</h2>

      {/* Summary Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <Card className="p-5 flex items-center gap-4">
          <div className="w-11 h-11 rounded-xl bg-yellow-50 dark:bg-yellow-900/30 flex items-center justify-center flex-shrink-0">
            <Icon name={IconName.FileText} className="w-5 h-5 text-yellow-600 dark:text-yellow-400" />
          </div>
          <div>
            <p className="text-2xl font-bold text-on-surface">{loading ? '—' : summary.proformaCount}</p>
            <p className="text-xs text-on-surface-secondary mt-0.5">Proforma Invoice{summary.proformaCount !== 1 ? 's' : ''}</p>
          </div>
        </Card>
        <Card className="p-5 flex items-center gap-4">
          <div className="w-11 h-11 rounded-xl bg-purple-50 dark:bg-purple-900/30 flex items-center justify-center flex-shrink-0">
            <Icon name={IconName.FileText} className="w-5 h-5 text-purple-600 dark:text-purple-400" />
          </div>
          <div>
            <p className="text-2xl font-bold text-on-surface">{loading ? '—' : summary.invoiceCount}</p>
            <p className="text-xs text-on-surface-secondary mt-0.5">Tax Invoice{summary.invoiceCount !== 1 ? 's' : ''}</p>
          </div>
        </Card>
        <Card className="p-5 flex items-center gap-4">
          <div className="w-11 h-11 rounded-xl bg-red-50 dark:bg-red-900/30 flex items-center justify-center flex-shrink-0">
            <Icon name={IconName.ClipboardCheck} className="w-5 h-5 text-red-600 dark:text-red-400" />
          </div>
          <div>
            <p className="text-2xl font-bold text-on-surface">{loading ? '—' : summary.receiptCount}</p>
            <p className="text-xs text-on-surface-secondary mt-0.5">Receipt{summary.receiptCount !== 1 ? 's' : ''}</p>
          </div>
        </Card>
      </div>

      {/* Search */}
      <div className="relative">
        <Icon name={IconName.Search} className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-on-surface-secondary pointer-events-none" />
        <input
          type="text"
          placeholder="Search by course title, course code, invoice number or type..."
          value={search}
          onChange={e => setSearch(e.target.value)}
          className="w-full pl-9 pr-9 py-2.5 text-sm rounded-lg border border-default bg-surface text-on-surface placeholder:text-on-surface-secondary/50 focus:outline-none focus:ring-2 focus:ring-primary/40 focus:border-primary transition-colors"
        />
        {search && (
          <button
            onClick={() => setSearch('')}
            className="absolute right-3 top-1/2 -translate-y-1/2 text-on-surface-secondary hover:text-on-surface"
          >
            <Icon name={IconName.Close} className="w-4 h-4" />
          </button>
        )}
      </div>

      {/* Table */}
      <Card className="overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm border-collapse">
            <thead>
              <tr className="border-b border-default bg-surface-elevated">
                <th className={headerCell}>Course Title</th>
                <th className={headerCell}>Course Ref Code</th>
                <th className={headerCell}>Type</th>
                <th className={headerCell}>Invoice No.</th>
                <th className={headerCell}>Enrollment ID</th>
                <th className={headerCell}>Created Date</th>
                <th className={`${headerCell} text-center`}>Status</th>
                <th className={`${headerCell} text-center`}>Documents</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-default">
              {loading ? (
                Array.from({ length: 4 }).map((_, i) => (
                  <tr key={i} className="animate-pulse">
                    {Array.from({ length: 8 }).map((_, j) => (
                      <td key={j} className={cell}>
                        <div className="h-3.5 w-24 bg-gray-200 dark:bg-gray-700 rounded" />
                      </td>
                    ))}
                  </tr>
                ))
              ) : error ? (
                <tr>
                  <td colSpan={8} className="px-4 py-12 text-center">
                    <p className="text-sm text-red-500">{error}</p>
                  </td>
                </tr>
              ) : filtered.length === 0 ? (
                <tr>
                  <td colSpan={8} className="px-4 py-16 text-center">
                    <div className="flex flex-col items-center gap-3">
                      <div className="w-12 h-12 rounded-full bg-primary/10 flex items-center justify-center">
                        <Icon name={IconName.FileText} className="w-6 h-6 text-primary/60" />
                      </div>
                      <div>
                        <p className="text-sm font-medium text-on-surface">No billing documents found</p>
                        <p className="text-xs text-on-surface-secondary mt-0.5">
                          {search ? 'Try a different search term' : 'Your invoices and receipts will appear here once issued'}
                        </p>
                      </div>
                    </div>
                  </td>
                </tr>
              ) : (
                filtered.map((row, idx) => (
                  <tr key={`${row.enrollment_id}-${row.type}-${idx}`} className="hover:bg-surface-elevated/50 transition-colors">
                    {/* Course Title */}
                    <td className={`${cell} max-w-[200px]`}>
                      <span className="font-medium text-on-surface truncate block" title={row.course_title}>
                        {row.course_title}
                      </span>
                    </td>
                    {/* Course Ref Code */}
                    <td className={`${cell} font-mono text-on-surface-secondary`}>
                      {row.course_code || '—'}
                    </td>
                    {/* Type */}
                    <td className={cell}>
                      <span className={`inline-flex items-center px-2 py-0.5 rounded text-[11px] font-semibold ${typeBadgeClass(row.type)}`}>
                        {row.type}
                      </span>
                    </td>
                    {/* Invoice No. */}
                    <td className={`${cell} font-mono text-on-surface-secondary`}>
                      {row.invoice_number || '—'}
                    </td>
                    {/* Enrollment ID */}
                    <td className={`${cell} font-mono text-on-surface-secondary text-[11px]`}>
                      {row.enrolment_id || row.enrollment_id || '—'}
                    </td>
                    {/* Created Date */}
                    <td className={`${cell} text-on-surface-secondary`}>
                      {formatDate(row.enrolment_date)}
                    </td>
                    {/* Status */}
                    <td className={`${cell} text-center`}>
                      {row.status === 'Issued' ? (
                        <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[11px] font-semibold bg-emerald-50 text-emerald-700 dark:bg-emerald-900/20 dark:text-emerald-400">
                          <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
                          Issued
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[11px] font-semibold bg-gray-100 text-gray-500 dark:bg-gray-700/40 dark:text-gray-400">
                          <span className="w-1.5 h-1.5 rounded-full bg-gray-400" />
                          Pending
                        </span>
                      )}
                    </td>
                    {/* Documents */}
                    <td className={`${cell} text-center`}>
                      {row.document_url ||
                      (row.type === 'Personal Invoice' && row.status === 'Issued' && row.invoice_pdf_ready) ? (
                        brokenLinks.has(`${row.enrollment_id}-${row.type}`) ? (
                          <div className="flex flex-col items-center gap-1">
                            <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[11px] font-semibold bg-red-50 text-red-600 dark:bg-red-900/20 dark:text-red-400">
                              <Icon name={IconName.Warning} className="w-3 h-3" />
                              Unavailable
                            </span>
                            <span className="text-[10px] text-on-surface-secondary">Document may have been deleted</span>
                          </div>
                        ) : (
                          <div className="flex items-center justify-center gap-2">
                            {row.document_url ? (
                              <button
                                onClick={async () => {
                                  const key = `${row.enrollment_id}-${row.type}`;
                                  setVerifyingId(key);
                                  try {
                                    const res = await fetch(
                                      `/api/billing/verify-drive?url=${encodeURIComponent(row.document_url!)}&enrollmentId=${row.enrollment_id}`
                                    );
                                    const json = await res.json();
                                    if (json.valid) {
                                      window.open(row.document_url!, '_blank');
                                    } else {
                                      setBrokenLinks((prev) => new Set(prev).add(key));
                                    }
                                  } catch {
                                    window.open(row.document_url!, '_blank');
                                  } finally {
                                    setVerifyingId(null);
                                  }
                                }}
                                disabled={verifyingId === `${row.enrollment_id}-${row.type}`}
                                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-semibold bg-blue-50 text-blue-700 hover:bg-blue-100 dark:bg-blue-900/20 dark:text-blue-400 dark:hover:bg-blue-900/40 transition-colors disabled:opacity-60"
                              >
                                {verifyingId === `${row.enrollment_id}-${row.type}` ? (
                                  <div className="animate-spin rounded-full h-3.5 w-3.5 border-b-2 border-blue-700 dark:border-blue-400" />
                                ) : (
                                  <Icon name={IconName.ExternalLink} className="w-3.5 h-3.5" />
                                )}
                                {verifyingId === `${row.enrollment_id}-${row.type}` ? 'Checking...' : 'View'}
                              </button>
                            ) : null}

                            {currentUser?.id &&
                              row.type.toLowerCase().includes('invoice') &&
                              (row.enrolment_id || row.enrollment_id) && (
                                <button
                                  onClick={async () => {
                                    const key = `${row.enrollment_id}-${row.type}-download`;
                                    setDownloadingId(key);
                                    try {
                                      const enr = encodeURIComponent(String(row.enrolment_id || row.enrollment_id));
                                      const uid = encodeURIComponent(String(currentUser.id));
                                      // Direct download via backend (prefers Drive, falls back to QB PDF API)
                                      window.open(`/api/billing/invoice-pdf?userId=${uid}&enrolmentId=${enr}`, '_blank');
                                    } finally {
                                      setTimeout(() => setDownloadingId(null), 800);
                                    }
                                  }}
                                  disabled={downloadingId === `${row.enrollment_id}-${row.type}-download`}
                                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-semibold bg-emerald-50 text-emerald-700 hover:bg-emerald-100 dark:bg-emerald-900/20 dark:text-emerald-400 dark:hover:bg-emerald-900/40 transition-colors disabled:opacity-60"
                                  title="Download invoice PDF"
                                >
                                  {downloadingId === `${row.enrollment_id}-${row.type}-download` ? (
                                    <div className="animate-spin rounded-full h-3.5 w-3.5 border-b-2 border-emerald-700 dark:border-emerald-400" />
                                  ) : (
                                    <Icon name={IconName.Download} className="w-3.5 h-3.5" />
                                  )}
                                  {downloadingId === `${row.enrollment_id}-${row.type}-download` ? 'Preparing…' : 'Download'}
                                </button>
                              )}
                          </div>
                        )
                      ) : (
                        <span className="text-xs text-on-surface-secondary/40">—</span>
                      )}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        {/* Footer count */}
        {!loading && !error && filtered.length > 0 && (
          <div className="px-4 py-3 border-t border-default bg-surface-elevated">
            <p className="text-xs text-on-surface-secondary">
              Showing <span className="font-medium text-on-surface">{filtered.length}</span> document{filtered.length !== 1 ? 's' : ''}
              {search && ` matching "${search}"`}
            </p>
          </div>
        )}
      </Card>
    </div>
  );
};

export default BillingHistoryView;