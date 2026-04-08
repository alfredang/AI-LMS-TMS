import React, { useState, useEffect } from 'react';
import { Card } from './ui/Card';
import { Icon, IconName } from './ui/Icon';
import { Button } from './ui/Button';
import { useLms } from '@contexts/LmsContext';

interface CertificateRecord {
  enrollment_id: string;
  course_title: string;
  course_code: string | null;
  course_run_id: string | null;
  start_date: string | null;
  end_date: string | null;
  assessment_status: string;
  certificate_url: string | null;
}

const formatDate = (dateStr: string | null): string => {
  if (!dateStr) return '-';
  return new Date(dateStr).toLocaleDateString('en-SG', { day: '2-digit', month: 'short', year: 'numeric' });
};

const CertificateHistoryView: React.FC = () => {
  const { currentUser } = useLms();
  const [records, setRecords] = useState<CertificateRecord[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [downloadingId, setDownloadingId] = useState<string | null>(null);

  useEffect(() => {
    if (!currentUser?.id) return;
    const fetchCertificates = async () => {
      setLoading(true);
      setError(null);
      try {
        const res = await fetch(`/api/learner/certificates?userId=${currentUser.id}`);
        const data = await res.json();
        if (data.success) {
          setRecords(data.data || []);
        } else {
          setError(data.error || 'Failed to fetch certificates');
        }
      } catch {
        setError('Failed to fetch certificates');
      } finally {
        setLoading(false);
      }
    };
    fetchCertificates();
  }, [currentUser?.id]);

  const handleDownloadCertificate = async (record: CertificateRecord) => {
    setDownloadingId(record.enrollment_id);
    try {
      if (record.certificate_url) {
        window.open(record.certificate_url, '_blank');
      } else {
        const res = await fetch('/api/learner/generate-certificate', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ enrolmentId: record.enrollment_id }),
        });
        const data = await res.json();
        if (data.success && data.fileUrl) {
          window.open(data.fileUrl, '_blank');
          setRecords(prev => prev.map(r =>
            r.enrollment_id === record.enrollment_id ? { ...r, certificate_url: data.fileUrl } : r
          ));
        }
      }
    } catch (err) {
      console.error('Certificate download error:', err);
    } finally {
      setDownloadingId(null);
    }
  };

  const getStatusBadge = (status: string, certUrl: string | null) => {
    if (certUrl) {
      return { label: 'Ready', className: 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400' };
    }
    if (status === 'Competent') {
      return { label: 'Generating', className: 'bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-400' };
    }
    return { label: 'Pending', className: 'bg-gray-100 text-gray-800 dark:bg-gray-700 dark:text-gray-400' };
  };

  const readyCount = records.filter(r => r.certificate_url).length;
  const pendingCount = records.filter(r => !r.certificate_url).length;

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold text-gray-900 dark:text-white">Certificate History</h2>
        <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">View and download your course certificates</p>
      </div>

      {/* Certificate Table */}
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
          <Icon name={IconName.Award} className="w-10 h-10 text-gray-300 dark:text-gray-600 mx-auto mb-3" />
          <p className="text-gray-500 dark:text-gray-400">No course enrollments found</p>
        </Card>
      ) : (
        <Card className="overflow-hidden dark:bg-gray-800 dark:border-gray-700">
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-gray-200 dark:divide-gray-700">
              <thead className="bg-gray-50 dark:bg-gray-900/50">
                <tr>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">Course Title</th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">Course Ref Code</th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">Course Run ID</th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">Course Date</th>
                  <th className="px-4 py-3 text-center text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">PDF Download</th>
                </tr>
              </thead>
              <tbody className="bg-white dark:bg-gray-800 divide-y divide-gray-200 dark:divide-gray-700">
                {records.map((record) => {
                  const status = getStatusBadge(record.assessment_status, record.certificate_url);
                  return (
                    <tr key={record.enrollment_id} className="hover:bg-gray-50 dark:hover:bg-gray-700/50">
                      <td className="px-4 py-3 text-sm font-medium text-gray-900 dark:text-white">{record.course_title}</td>
                      <td className="px-4 py-3 text-sm text-gray-600 dark:text-gray-300">{record.course_code || '-'}</td>
                      <td className="px-4 py-3 text-sm text-gray-600 dark:text-gray-300">{record.course_run_id || '-'}</td>
                      <td className="px-4 py-3 text-sm text-gray-600 dark:text-gray-300">
                        {record.start_date ? `${formatDate(record.start_date)} - ${formatDate(record.end_date)}` : '-'}
                      </td>
                      <td className="px-4 py-3 text-center">
                        <button
                          onClick={() => handleDownloadCertificate(record)}
                          disabled={downloadingId === record.enrollment_id}
                          title="Download PDF"
                          className="inline-flex items-center justify-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-semibold transition-colors
                            bg-blue-50 text-blue-700 hover:bg-blue-100
                            dark:bg-blue-900/20 dark:text-blue-400 dark:hover:bg-blue-900/40
                            disabled:opacity-50 disabled:cursor-not-allowed"
                        >
                          {downloadingId === record.enrollment_id ? (
                            <>
                              <Icon name={IconName.Spinner} className="w-3.5 h-3.5 animate-spin" />
                              <span>Generating...</span>
                            </>
                          ) : (
                            <>
                              <Icon name={IconName.FilePdf} className="w-3.5 h-3.5" />
                              <span>Download</span>
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
        </Card>
      )}
    </div>
  );
};

export default CertificateHistoryView;
