import React, { useState, useCallback, useEffect } from 'react';
import { Card } from './ui/Card';
import { Icon, IconName } from './ui/Icon';
import { Button } from './ui/Button';
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
  grants: Grant[];
}

const formatDate = (dateStr: string | null): string => {
  if (!dateStr) return '-';
  return new Date(dateStr).toLocaleDateString('en-SG', { day: '2-digit', month: 'short', year: 'numeric' });
};

const formatCurrency = (amount: string | null): string => {
  if (!amount) return '-';
  return `$${parseFloat(amount).toFixed(2)}`;
};

const getPaymentBadge = (status: string | null) => {
  switch (status) {
    case 'Paid':
      return 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400';
    case 'Unpaid':
      return 'bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-400';
    default:
      return 'bg-gray-100 text-gray-800 dark:bg-gray-700 dark:text-gray-400';
  }
};

// ── Download handler ──────────────────────────────────────────────────────────
// Calls /api/billing/proforma, receives a PDF blob, triggers browser download.

const downloadProForma = async (record: BillingRecord): Promise<void> => {
  const res = await fetch('/api/billing/proforma', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      enrolment_id: record.enrolment_id,
      full_name: record.full_name,
      course_title: record.course_title,
      course_code: record.course_code,
      course_fees_exclude_gst: record.course_fees_exclude_gst,
      start_date: record.start_date,
      grants: record.grants,
      // Pass MCES eligibility based on grants
      eligibility: record.is_mces_eligible ? 'above' : 'below',
      sponsorship_type: 'Self-Sponsored', // adjust if you store this on the record
    }),
  });

  if (!res.ok) {
    throw new Error('Failed to generate PDF');
  }

  // Trigger browser download
  const blob = await res.blob();
  const url = window.URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  const orderNum = (record.enrolment_id ?? record.id).replace('#', '');
  a.download = `ProFormaInvoice_${orderNum}.pdf`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  window.URL.revokeObjectURL(url);
};

// ── Component ─────────────────────────────────────────────────────────────────

const BillingHistoryView: React.FC = () => {
  const { currentUser } = useLms();
  const [records, setRecords] = useState<BillingRecord[]>([]);
  const [loading, setLoading] = useState(false);
  const [fetched, setFetched] = useState(false);
  const [downloadingId, setDownloadingId] = useState<string | null>(null);
  const [downloadError, setDownloadError] = useState<string | null>(null);

  const fetchBillingHistory = useCallback(async () => {
    if (!currentUser?.id) return;
    setLoading(true);
    try {
      const res = await fetch(`/api/billing/history?userId=${currentUser.id}`);
      const json = await res.json();
      if (json.success) {
        setRecords(json.data);
      }
    } catch (err) {
      console.error('[BillingHistory] Fetch error:', err);
    } finally {
      setLoading(false);
      setFetched(true);
    }
  }, [currentUser?.id]);

  useEffect(() => {
    fetchBillingHistory();
  }, [fetchBillingHistory]);

  const handleDownload = async (record: BillingRecord) => {
    setDownloadingId(record.id);
    setDownloadError(null);
    try {
      await downloadProForma(record);
    } catch (err) {
      console.error('[BillingHistory] Download error:', err);
      setDownloadError('Failed to generate invoice. Please try again.');
    } finally {
      setDownloadingId(null);
    }
  };

  const paidCount = records.filter(r => r.payment_status === 'Paid').length;
  const unpaidCount = records.filter(r => r.payment_status === 'Unpaid').length;

  return (
    <div>
      <h2 className="text-3xl font-bold mb-6">Billing History</h2>
      <div className="grid grid-cols-1 gap-6">

        {/* Summary Cards */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <Card className="p-5">
            <div className="flex items-center space-x-3">
              <div className="p-2 bg-blue-100 dark:bg-blue-900/30 rounded-lg">
                <Icon name={IconName.FilePdf} className="w-6 h-6 text-blue-600 dark:text-blue-400" />
              </div>
              <div>
                <p className="text-sm font-semibold text-subtle">Total Invoices</p>
                <p className="text-2xl font-bold text-on-surface">{records.length}</p>
              </div>
            </div>
          </Card>
          <Card className="p-5">
            <div className="flex items-center space-x-3">
              <div className="p-2 bg-green-100 dark:bg-green-900/30 rounded-lg">
                <Icon name={IconName.CheckCircle} className="w-6 h-6 text-green-600 dark:text-green-400" />
              </div>
              <div>
                <p className="text-sm font-semibold text-subtle">Paid</p>
                <p className="text-2xl font-bold text-on-surface">{paidCount}</p>
              </div>
            </div>
          </Card>
          <Card className="p-5">
            <div className="flex items-center space-x-3">
              <div className="p-2 bg-amber-100 dark:bg-amber-900/30 rounded-lg">
                <Icon name={IconName.Clock} className="w-6 h-6 text-amber-600 dark:text-amber-400" />
              </div>
              <div>
                <p className="text-sm font-semibold text-subtle">Pending</p>
                <p className="text-2xl font-bold text-on-surface">{unpaidCount}</p>
              </div>
            </div>
          </Card>
        </div>

        {/* Error banner */}
        {downloadError && (
          <div className="px-4 py-3 rounded-lg bg-red-50 dark:bg-red-900/20 text-red-700 dark:text-red-400 text-sm">
            {downloadError}
          </div>
        )}

        {/* Invoice Table */}
        <Card className="p-6">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-xl font-bold">Invoices</h3>
            <Button
              onClick={fetchBillingHistory}
              disabled={loading}
              className="!bg-primary hover:!bg-primary-hover"
            >
              {loading ? (
                <span className="flex items-center space-x-2">
                  <Icon name={IconName.Spinner} className="w-4 h-4 animate-spin" />
                  <span>Loading...</span>
                </span>
              ) : (
                <span className="flex items-center space-x-2">
                  <Icon name={IconName.Download} className="w-4 h-4" />
                  <span>Refresh</span>
                </span>
              )}
            </Button>
          </div>

          {!fetched ? (
            <div className="text-center py-12 px-6 bg-gray-50 dark:bg-gray-800/50 rounded-lg">
              <Icon name={IconName.DollarSign} className="w-24 h-24 mx-auto mb-6 text-primary" />
              <h4 className="text-xl font-bold text-on-surface">No invoices loaded</h4>
              <p className="mt-2 text-subtle max-w-md mx-auto">Click Refresh to load your billing history.</p>
            </div>
          ) : records.length === 0 ? (
            <div className="text-center py-12 px-6 bg-gray-50 dark:bg-gray-800/50 rounded-lg">
              <Icon name={IconName.DollarSign} className="w-24 h-24 mx-auto mb-6 text-primary" />
              <h4 className="text-xl font-bold text-on-surface">No invoices yet</h4>
              <p className="mt-2 text-subtle max-w-md mx-auto">
                Pro forma invoices will appear here once you are enrolled in a course.
              </p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm whitespace-nowrap">
                <thead>
                  <tr className="border-b border-gray-200 dark:border-gray-700">
                    <th className="text-left py-3 px-4 font-semibold text-subtle">Enrolment ID</th>
                    <th className="text-left py-3 px-4 font-semibold text-subtle">Course Run ID</th>
                    <th className="text-left py-3 px-4 font-semibold text-subtle">Course</th>
                    <th className="text-left py-3 px-4 font-semibold text-subtle">Course Date</th>
                    <th className="text-right py-3 px-4 font-semibold text-subtle">Fee (excl. GST)</th>
                    <th className="text-right py-3 px-4 font-semibold text-subtle">Baseline Funding</th>
                    <th className="text-right py-3 px-4 font-semibold text-subtle">MCES / SME</th>
                    <th className="text-right py-3 px-4 font-semibold text-subtle">Nett Payable</th>
                    <th className="text-center py-3 px-4 font-semibold text-subtle">Payment</th>
                    <th className="text-center py-3 px-4 font-semibold text-subtle">Status</th>
                    <th className="text-center py-3 px-4 font-semibold text-subtle">Quotation</th>
                  </tr>
                </thead>
                <tbody>
                  {records.map((record) => {
                    const baselineGrant = record.grants.find(g => g.funding_scheme === 'Baseline SkillsFuture Funding');
                    const enhancedGrant = record.grants.find(g =>
                      g.funding_scheme === 'Mid-Career Enhanced Subsidy' ||
                      g.funding_scheme === 'Enhanced Training Support for SMEs' ||
                      g.funding_scheme === 'IBF STS'
                    );
                    const baselineAmt = baselineGrant
                      ? parseFloat(baselineGrant.approved_amount !== '0.00' ? baselineGrant.approved_amount : baselineGrant.estimated_amount)
                      : 0;
                    const enhancedAmt = enhancedGrant
                      ? parseFloat(enhancedGrant.approved_amount !== '0.00' ? enhancedGrant.approved_amount : enhancedGrant.estimated_amount)
                      : 0;
                    const fee = parseFloat(record.course_fees_exclude_gst || '0');
                    const nettPayable = fee > 0 ? fee - baselineAmt - enhancedAmt : 0;
                    const isDownloading = downloadingId === record.id;

                    return (
                      <tr key={record.id} className="border-b border-gray-100 dark:border-gray-800 hover:bg-gray-50 dark:hover:bg-gray-800/30">
                        <td className="py-3 px-4 font-mono text-xs">{record.enrolment_id || '-'}</td>
                        <td className="py-3 px-4 font-mono text-xs">{record.course_run_id || '-'}</td>
                        <td className="py-3 px-4">
                          <div className="font-semibold text-on-surface">{record.course_title}</div>
                          <div className="text-xs text-subtle">{record.course_code || '-'}</div>
                        </td>
                        <td className="py-3 px-4 text-subtle">{formatDate(record.start_date)}</td>
                        <td className="py-3 px-4 text-right font-mono">{formatCurrency(record.course_fees_exclude_gst)}</td>
                        <td className="py-3 px-4 text-right font-mono text-green-600 dark:text-green-400">
                          {baselineAmt > 0 ? `-${formatCurrency(baselineAmt.toFixed(2))}` : '-'}
                        </td>
                        <td className="py-3 px-4 text-right font-mono text-green-600 dark:text-green-400">
                          {enhancedAmt > 0 ? `-${formatCurrency(enhancedAmt.toFixed(2))}` : '-'}
                        </td>
                        <td className="py-3 px-4 text-right font-mono font-semibold">
                          {fee > 0 ? formatCurrency(nettPayable.toFixed(2)) : '-'}
                        </td>
                        <td className="py-3 px-4 text-center">
                          <span className={`inline-block px-2 py-1 rounded-full text-xs font-semibold ${getPaymentBadge(record.payment_status)}`}>
                            {record.payment_status || 'Unknown'}
                          </span>
                        </td>
                        <td className="py-3 px-4 text-center">
                          <span className={`inline-block px-2 py-1 rounded-full text-xs font-semibold ${
                            record.enrolment_status === 'Confirmed'
                              ? 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400'
                              : record.enrolment_status === 'Cancelled'
                              ? 'bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400'
                              : 'bg-gray-100 text-gray-800 dark:bg-gray-700 dark:text-gray-400'
                          }`}>
                            {record.enrolment_status || 'Unknown'}
                          </span>
                        </td>

                        {/* ── Pro Forma Download ── */}
                        <td className="py-3 px-4 text-center">
                          <button
                            onClick={() => handleDownload(record)}
                            disabled={isDownloading}
                            title="Download Pro Forma Invoice"
                            className="inline-flex items-center justify-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-semibold transition-colors
                              bg-blue-50 text-blue-700 hover:bg-blue-100
                              dark:bg-blue-900/20 dark:text-blue-400 dark:hover:bg-blue-900/40
                              disabled:opacity-50 disabled:cursor-not-allowed"
                          >
                            {isDownloading ? (
                              <>
                                <Icon name={IconName.Spinner} className="w-3.5 h-3.5 animate-spin" />
                                <span>Generating...</span>
                              </>
                            ) : (
                              <>
                                <Icon name={IconName.FilePdf} className="w-3.5 h-3.5" />
                                <span>Pro Forma</span>
                              </>
                            )}
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      </div>
    </div>
  );
};

export default BillingHistoryView;