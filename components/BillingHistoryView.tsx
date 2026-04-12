import React, { useState, useCallback, useEffect } from 'react';
import { Card } from './ui/Card';
import { Icon, IconName } from './ui/Icon';
import { useLms } from '@contexts/LmsContext';

interface Grant {
  funding_scheme: string;
  estimated_amount: string;
  approved_amount: string;
  status: string;
}

interface BillingRecord {
  id: string;
  enrolment_id: string | null;
  enrolment_status: string | null;
  payment_status: string | null;
  enrolment_date: string | null;
  full_name: string;
  course_title: string;
  course_code: string | null;
  course_fees_exclude_gst: string | null;
  course_fees_include_gst: string | null;
  after_normal_funding: string | null;
  after_mces_funding: string | null;
  is_wsq_funded: boolean;
  is_mces_eligible: boolean;
  course_run_id: string | null;
  start_date: string | null;
  end_date: string | null;
  pro_forma_url: string | null;
  qbo_invoice_id?: string | null;
  invoice_no?: string | null;
  qbo_doc_number?: string | null;
  drive_file_id?: string | null;
  drive_web_view_link?: string | null;
  grants: Grant[];
}

const formatDate = (dateStr: string | null): string => {
  if (!dateStr) return '-';
  return new Date(dateStr).toLocaleDateString('en-SG', { day: '2-digit', month: 'short', year: 'numeric' });
};

/**
 * Same pattern as Certificate History: open the stored Drive link in a new tab when present;
 * otherwise open the server PDF endpoint (streams Drive / QBO — no LibreOffice).
 */
const BillingHistoryView: React.FC = () => {
  const { currentUser } = useLms();
  const [records, setRecords] = useState<BillingRecord[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [downloadingId, setDownloadingId] = useState<string | null>(null);

  const fetchBillingHistory = useCallback(async () => {
    if (!currentUser?.id) return;
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/billing/history?userId=${currentUser.id}`);
      const json = await res.json();
      if (json.success) {
        setRecords(json.data || []);
      } else {
        setError(json.error || 'Failed to load billing history');
      }
    } catch (err) {
      console.error('[BillingHistory] Fetch error:', err);
      setError('Failed to load billing history');
    } finally {
      setLoading(false);
    }
  }, [currentUser?.id]);

  useEffect(() => {
    fetchBillingHistory();
  }, [fetchBillingHistory]);

  const handleDownloadInvoice = (record: BillingRecord) => {
    if (!currentUser?.id || !record.enrolment_id) return;
    setDownloadingId(record.id);
    try {
      const driveLink = record.drive_web_view_link?.trim();
      if (driveLink) {
        window.open(driveLink, '_blank', 'noopener,noreferrer');
      } else {
        const pdfUrl = `/api/billing/invoice-pdf?userId=${encodeURIComponent(currentUser.id)}&enrolmentId=${encodeURIComponent(record.enrolment_id)}`;
        window.open(pdfUrl, '_blank', 'noopener,noreferrer');
      }
    } finally {
      window.setTimeout(() => setDownloadingId(null), 400);
    }
  };

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold text-gray-900 dark:text-white">Billing History</h2>
        <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">View and download your course invoices</p>
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-12">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary" />
        </div>
      ) : error ? (
        <Card className="p-8 text-center dark:bg-gray-800 dark:border-gray-700">
          <Icon name={IconName.InfoCircle} className="w-10 h-10 text-red-400 mx-auto mb-3" />
          <p className="text-gray-500 dark:text-gray-400">{error}</p>
        </Card>
      ) : records.length === 0 ? (
        <Card className="p-8 text-center dark:bg-gray-800 dark:border-gray-700">
          <Icon name={IconName.DollarSign} className="w-10 h-10 text-gray-300 dark:text-gray-600 mx-auto mb-3" />
          <p className="text-gray-500 dark:text-gray-400">No billing records yet</p>
        </Card>
      ) : (
        <Card className="overflow-hidden dark:bg-gray-800 dark:border-gray-700">
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-gray-200 dark:divide-gray-700">
              <thead className="bg-gray-50 dark:bg-gray-900/50">
                <tr>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                    Course Title
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                    Course Ref Code
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                    Type
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                    Invoice No
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                    Enrolment ID
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                    Created Date
                  </th>
                  <th className="px-4 py-3 text-center text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                    PDF Download
                  </th>
                </tr>
              </thead>
              <tbody className="bg-white dark:bg-gray-800 divide-y divide-gray-200 dark:divide-gray-700">
                {[...records]
                  .sort((a, b) => {
                    const dateA = new Date(a.enrolment_date || a.start_date || 0).getTime();
                    const dateB = new Date(b.enrolment_date || b.start_date || 0).getTime();
                    return dateB - dateA;
                  })
                  .map((record) => {
                    const isDownloading = downloadingId === record.id;
                    return (
                      <tr key={record.id} className="hover:bg-gray-50 dark:hover:bg-gray-700/50">
                        <td className="px-4 py-3 text-sm font-medium text-gray-900 dark:text-white">{record.course_title}</td>
                        <td className="px-4 py-3 text-sm text-gray-600 dark:text-gray-300 font-mono">{record.course_code || '-'}</td>
                        <td className="px-4 py-3 text-xs">
                          {record.payment_status === 'Paid' ? (
                            <span className="px-2 py-0.5 rounded-full bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400 font-semibold">
                              Receipt
                            </span>
                          ) : record.drive_web_view_link || record.qbo_invoice_id ? (
                            <span className="px-2 py-0.5 rounded-full bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-400 font-semibold">
                              QuickBooks Invoice
                            </span>
                          ) : (
                            <span className="px-2 py-0.5 rounded-full bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-400 font-semibold">
                              Invoice
                            </span>
                          )}
                        </td>
                        <td className="px-4 py-3 text-sm font-mono text-gray-600 dark:text-gray-300">
                          {record.invoice_no || record.qbo_doc_number || '-'}
                        </td>
                        <td className="px-4 py-3 text-sm font-mono text-gray-600 dark:text-gray-300">
                          {record.enrolment_id || record.id || '-'}
                        </td>
                        <td className="px-4 py-3 text-sm text-gray-600 dark:text-gray-300">
                          {formatDate(record.enrolment_date || record.start_date)}
                        </td>
                        <td className="px-4 py-3 text-center">
                          {record.enrolment_id && currentUser?.id ? (
                            <button
                              type="button"
                              onClick={() => handleDownloadInvoice(record)}
                              disabled={isDownloading}
                              title="Download PDF"
                              className="inline-flex items-center justify-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-semibold transition-colors
                                bg-blue-50 text-blue-700 hover:bg-blue-100
                                dark:bg-blue-900/20 dark:text-blue-400 dark:hover:bg-blue-900/40
                                disabled:opacity-50 disabled:cursor-not-allowed"
                            >
                              {isDownloading ? (
                                <>
                                  <Icon name={IconName.Spinner} className="w-3.5 h-3.5 animate-spin" />
                                  <span>Opening…</span>
                                </>
                              ) : (
                                <>
                                  <Icon name={IconName.FilePdf} className="w-3.5 h-3.5" />
                                  <span>Download</span>
                                </>
                              )}
                            </button>
                          ) : (
                            <span className="text-sm text-gray-400">—</span>
                          )}
                        </td>
                      </tr>
                    );
                  })}
              </tbody>
            </table>
          </div>
        </Card>
      )}
    </div>
  );
};

export default BillingHistoryView;
