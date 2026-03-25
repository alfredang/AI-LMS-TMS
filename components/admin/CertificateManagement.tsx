import React, { useState, useEffect } from 'react';
import { Icon, IconName } from '../ui/Icon';

interface Learner {
  id: string;
  full_name: string;
  email: string;
}

interface Enrollment {
  enrollment_id: string;
  course_title: string;
  course_code: string;
  start_date: string;
  end_date: string;
  assessment_status: string;
  certificate: string | null;
}

// ========== CREATE CERTIFICATE VIEW ==========
export const CreateCertificateView: React.FC = () => {
  const [learners, setLearners] = useState<Learner[]>([]);
  const [enrollments, setEnrollments] = useState<Enrollment[]>([]);
  const [selectedLearnerId, setSelectedLearnerId] = useState('');
  const [selectedEnrollmentId, setSelectedEnrollmentId] = useState('');
  const [loadingLearners, setLoadingLearners] = useState(false);
  const [loadingEnrollments, setLoadingEnrollments] = useState(false);
  const [creating, setCreating] = useState(false);
  const [result, setResult] = useState<{ success: boolean; message: string } | null>(null);

  // Fetch all learners on mount
  useEffect(() => {
    setLoadingLearners(true);
    fetch('/api/admin/certificate-data')
      .then(res => res.json())
      .then(data => { if (Array.isArray(data)) setLearners(data); })
      .catch(err => console.error('Failed to fetch learners:', err))
      .finally(() => setLoadingLearners(false));
  }, []);

  // Fetch enrollments when learner changes
  useEffect(() => {
    setEnrollments([]);
    setSelectedEnrollmentId('');
    setResult(null);
    if (!selectedLearnerId) return;

    setLoadingEnrollments(true);
    fetch(`/api/admin/certificate-data?learnerId=${selectedLearnerId}`)
      .then(res => res.json())
      .then(data => { if (Array.isArray(data)) setEnrollments(data); })
      .catch(err => console.error('Failed to fetch enrollments:', err))
      .finally(() => setLoadingEnrollments(false));
  }, [selectedLearnerId]);

  const handleCreate = async () => {
    if (!selectedEnrollmentId) return;
    setCreating(true);
    setResult(null);
    try {
      const res = await fetch('/api/learner/generate-certificate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ enrolmentId: selectedEnrollmentId })
      });
      const data = await res.json();
      if (res.ok) {
        setResult({ success: true, message: 'Certificate created successfully and uploaded to Google Drive.' });
        // Refresh enrollments to update certificate status
        const refreshRes = await fetch(`/api/admin/certificate-data?learnerId=${selectedLearnerId}`);
        const refreshData = await refreshRes.json();
        if (Array.isArray(refreshData)) setEnrollments(refreshData);
      } else {
        setResult({ success: false, message: data.message || 'Failed to create certificate.' });
      }
    } catch {
      setResult({ success: false, message: 'Network error. Please try again.' });
    } finally {
      setCreating(false);
    }
  };

  const selectedEnrollment = enrollments.find(e => e.enrollment_id === selectedEnrollmentId);

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold dark:text-white">Create Certificate</h1>

      <div className="bg-surface rounded-lg border border-default shadow-sm overflow-hidden">
        <div className="px-5 py-4 border-b border-default bg-gray-50 dark:bg-gray-800">
          <h2 className="text-sm font-semibold text-gray-700 dark:text-gray-300">Select Learner & Course</h2>
        </div>
        <div className="p-5 space-y-4">
          {/* Learner Dropdown */}
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Learner</label>
            {loadingLearners ? (
              <div className="flex items-center gap-2 text-sm text-gray-500 py-2">
                <Icon name={IconName.Spinner} className="w-5 h-5 animate-spin text-blue-500" />
                Loading learners...
              </div>
            ) : (
              <select
                value={selectedLearnerId}
                onChange={e => setSelectedLearnerId(e.target.value)}
                className="w-full px-3 py-2.5 text-sm border border-gray-300 dark:border-gray-600 rounded-md shadow-sm focus:outline-none focus:ring-blue-500 focus:border-blue-500 dark:bg-gray-700 dark:text-white"
              >
                <option value="">— Choose a learner —</option>
                {learners.map(l => (
                  <option key={l.id} value={l.id}>{l.full_name} ({l.email})</option>
                ))}
              </select>
            )}
          </div>

          {/* Course Enrollment Dropdown */}
          {selectedLearnerId && (
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Enrolled Course</label>
              {loadingEnrollments ? (
                <div className="flex items-center gap-2 text-sm text-gray-500 py-2">
                  <Icon name={IconName.Spinner} className="w-5 h-5 animate-spin text-blue-500" />
                  Loading enrollments...
                </div>
              ) : enrollments.length === 0 ? (
                <p className="text-sm text-gray-500 py-2">This learner has no enrollments.</p>
              ) : (
                <select
                  value={selectedEnrollmentId}
                  onChange={e => setSelectedEnrollmentId(e.target.value)}
                  className="w-full px-3 py-2.5 text-sm border border-gray-300 dark:border-gray-600 rounded-md shadow-sm focus:outline-none focus:ring-blue-500 focus:border-blue-500 dark:bg-gray-700 dark:text-white"
                >
                  <option value="">— Choose an enrollment —</option>
                  {enrollments.map(e => (
                    <option key={e.enrollment_id} value={e.enrollment_id}>
                      {e.course_title} ({e.course_code}) — {e.assessment_status || 'No Status'}
                      {e.certificate ? ' [Certificate Exists]' : ''}
                    </option>
                  ))}
                </select>
              )}
            </div>
          )}

          {/* Selected Enrollment Info */}
          {selectedEnrollment && (
            <div className="p-4 rounded-lg bg-gray-50 dark:bg-gray-800 border border-gray-200 dark:border-gray-700 space-y-2">
              <div className="flex justify-between text-sm">
                <span className="text-gray-500 dark:text-gray-400">Course</span>
                <span className="font-semibold dark:text-white">{selectedEnrollment.course_title}</span>
              </div>
              <div className="flex justify-between text-sm">
                <span className="text-gray-500 dark:text-gray-400">Status</span>
                <span className={`font-semibold ${
                  selectedEnrollment.assessment_status === 'Competent' || selectedEnrollment.assessment_status === 'Passed'
                    ? 'text-green-600' : 'text-amber-600'
                }`}>{selectedEnrollment.assessment_status || 'N/A'}</span>
              </div>
              <div className="flex justify-between text-sm">
                <span className="text-gray-500 dark:text-gray-400">Existing Certificate</span>
                <span className={`font-semibold ${selectedEnrollment.certificate ? 'text-green-600' : 'text-gray-400'}`}>
                  {selectedEnrollment.certificate ? 'Yes' : 'None'}
                </span>
              </div>
            </div>
          )}

          {/* Create Button */}
          {selectedEnrollmentId && (
            <button
              onClick={handleCreate}
              disabled={creating}
              className="w-full py-2.5 px-4 rounded-md font-semibold text-white bg-blue-600 hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors shadow-sm"
            >
              {creating ? (
                <span className="flex items-center justify-center gap-2">
                  <Icon name={IconName.Spinner} className="w-5 h-5 animate-spin" />
                  Generating Certificate...
                </span>
              ) : (
                <span className="flex items-center justify-center gap-2">
                  <Icon name={IconName.FileText} className="w-5 h-5" />
                  Create Certificate
                </span>
              )}
            </button>
          )}

          {/* Result Message */}
          {result && (
            <div className={`p-4 rounded-lg border text-sm font-medium ${
              result.success
                ? 'bg-green-50 border-green-200 text-green-800 dark:bg-green-900/20 dark:border-green-800 dark:text-green-400'
                : 'bg-red-50 border-red-200 text-red-800 dark:bg-red-900/20 dark:border-red-800 dark:text-red-400'
            }`}>
              <div className="flex items-center gap-2">
                <Icon name={result.success ? IconName.CheckCircle : IconName.InfoCircle} className="w-5 h-5 flex-shrink-0" />
                {result.message}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

// ========== DELETE CERTIFICATE VIEW ==========
export const DeleteCertificateView: React.FC = () => {
  const [learners, setLearners] = useState<Learner[]>([]);
  const [enrollments, setEnrollments] = useState<Enrollment[]>([]);
  const [selectedLearnerId, setSelectedLearnerId] = useState('');
  const [selectedEnrollmentId, setSelectedEnrollmentId] = useState('');
  const [loadingLearners, setLoadingLearners] = useState(false);
  const [loadingEnrollments, setLoadingEnrollments] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [result, setResult] = useState<{ success: boolean; message: string } | null>(null);

  // Fetch all learners on mount
  useEffect(() => {
    setLoadingLearners(true);
    fetch('/api/admin/certificate-data')
      .then(res => res.json())
      .then(data => { if (Array.isArray(data)) setLearners(data); })
      .catch(err => console.error('Failed to fetch learners:', err))
      .finally(() => setLoadingLearners(false));
  }, []);

  // Fetch enrollments with certificates when learner changes
  useEffect(() => {
    setEnrollments([]);
    setSelectedEnrollmentId('');
    setResult(null);
    setConfirmDelete(false);
    if (!selectedLearnerId) return;

    setLoadingEnrollments(true);
    fetch(`/api/admin/certificate-data?learnerId=${selectedLearnerId}`)
      .then(res => res.json())
      .then(data => {
        if (Array.isArray(data)) {
          // Only show enrollments that have an existing certificate
          setEnrollments(data.filter((e: Enrollment) => e.certificate));
        }
      })
      .catch(err => console.error('Failed to fetch enrollments:', err))
      .finally(() => setLoadingEnrollments(false));
  }, [selectedLearnerId]);

  const handleDelete = async () => {
    if (!selectedEnrollmentId) return;
    setDeleting(true);
    setResult(null);
    try {
      const res = await fetch('/api/admin/delete-certificate', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ enrollmentId: selectedEnrollmentId })
      });
      const data = await res.json();
      if (res.ok) {
        setResult({ success: true, message: 'Certificate deleted successfully.' });
        setSelectedEnrollmentId('');
        setConfirmDelete(false);
        // Refresh enrollments
        const refreshRes = await fetch(`/api/admin/certificate-data?learnerId=${selectedLearnerId}`);
        const refreshData = await refreshRes.json();
        if (Array.isArray(refreshData)) {
          setEnrollments(refreshData.filter((e: Enrollment) => e.certificate));
        }
      } else {
        setResult({ success: false, message: data.message || 'Failed to delete certificate.' });
      }
    } catch {
      setResult({ success: false, message: 'Network error. Please try again.' });
    } finally {
      setDeleting(false);
    }
  };

  const selectedEnrollment = enrollments.find(e => e.enrollment_id === selectedEnrollmentId);

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold dark:text-white">Delete Certificate</h1>

      <div className="bg-surface rounded-lg border border-default shadow-sm overflow-hidden">
        <div className="px-5 py-4 border-b border-default bg-gray-50 dark:bg-gray-800">
          <h2 className="text-sm font-semibold text-gray-700 dark:text-gray-300">Select Learner & Certificate</h2>
        </div>
        <div className="p-5 space-y-4">
          {/* Learner Dropdown */}
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Learner</label>
            {loadingLearners ? (
              <div className="flex items-center gap-2 text-sm text-gray-500 py-2">
                <Icon name={IconName.Spinner} className="w-5 h-5 animate-spin text-blue-500" />
                Loading learners...
              </div>
            ) : (
              <select
                value={selectedLearnerId}
                onChange={e => setSelectedLearnerId(e.target.value)}
                className="w-full px-3 py-2.5 text-sm border border-gray-300 dark:border-gray-600 rounded-md shadow-sm focus:outline-none focus:ring-blue-500 focus:border-blue-500 dark:bg-gray-700 dark:text-white"
              >
                <option value="">— Choose a learner —</option>
                {learners.map(l => (
                  <option key={l.id} value={l.id}>{l.full_name} ({l.email})</option>
                ))}
              </select>
            )}
          </div>

          {/* Certificate Enrollment Dropdown */}
          {selectedLearnerId && (
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Existing Certificates</label>
              {loadingEnrollments ? (
                <div className="flex items-center gap-2 text-sm text-gray-500 py-2">
                  <Icon name={IconName.Spinner} className="w-5 h-5 animate-spin text-blue-500" />
                  Loading certificates...
                </div>
              ) : enrollments.length === 0 ? (
                <p className="text-sm text-gray-500 py-2">This learner has no existing certificates.</p>
              ) : (
                <select
                  value={selectedEnrollmentId}
                  onChange={e => { setSelectedEnrollmentId(e.target.value); setConfirmDelete(false); }}
                  className="w-full px-3 py-2.5 text-sm border border-gray-300 dark:border-gray-600 rounded-md shadow-sm focus:outline-none focus:ring-blue-500 focus:border-blue-500 dark:bg-gray-700 dark:text-white"
                >
                  <option value="">— Choose a certificate to delete —</option>
                  {enrollments.map(e => (
                    <option key={e.enrollment_id} value={e.enrollment_id}>
                      {e.course_title} ({e.course_code})
                    </option>
                  ))}
                </select>
              )}
            </div>
          )}

          {/* Selected Certificate Info */}
          {selectedEnrollment && (
            <div className="p-4 rounded-lg bg-red-50 dark:bg-red-900/10 border border-red-200 dark:border-red-800 space-y-2">
              <div className="flex justify-between text-sm">
                <span className="text-gray-500 dark:text-gray-400">Course</span>
                <span className="font-semibold dark:text-white">{selectedEnrollment.course_title}</span>
              </div>
              <div className="flex justify-between text-sm">
                <span className="text-gray-500 dark:text-gray-400">Certificate URL</span>
                <a href={selectedEnrollment.certificate!} target="_blank" rel="noopener noreferrer" className="text-blue-600 hover:underline text-xs truncate max-w-[200px]">
                  View Certificate →
                </a>
              </div>
            </div>
          )}

          {/* Delete Button */}
          {selectedEnrollmentId && !confirmDelete && (
            <button
              onClick={() => setConfirmDelete(true)}
              className="w-full py-2.5 px-4 rounded-md font-semibold text-white bg-red-600 hover:bg-red-700 transition-colors shadow-sm"
            >
              <span className="flex items-center justify-center gap-2">
                <Icon name={IconName.Delete} className="w-5 h-5" />
                Delete Certificate
              </span>
            </button>
          )}

          {/* Confirm Deletion */}
          {confirmDelete && (
            <div className="p-4 border-2 border-red-400 dark:border-red-700 rounded-lg bg-red-50 dark:bg-red-900/20 space-y-3">
              <p className="text-sm font-semibold text-red-800 dark:text-red-400">
                ⚠️ Are you sure? This will permanently remove the certificate link from the learner's record.
              </p>
              <div className="flex gap-3">
                <button
                  onClick={handleDelete}
                  disabled={deleting}
                  className="flex-1 py-2 px-4 rounded-md font-semibold text-white bg-red-600 hover:bg-red-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                >
                  {deleting ? (
                    <span className="flex items-center justify-center gap-2">
                      <Icon name={IconName.Spinner} className="w-4 h-4 animate-spin" />
                      Deleting...
                    </span>
                  ) : 'Confirm Delete'}
                </button>
                <button
                  onClick={() => setConfirmDelete(false)}
                  className="flex-1 py-2 px-4 rounded-md font-semibold text-gray-700 dark:text-gray-300 bg-gray-200 dark:bg-gray-700 hover:bg-gray-300 dark:hover:bg-gray-600 transition-colors"
                >
                  Cancel
                </button>
              </div>
            </div>
          )}

          {/* Result Message */}
          {result && (
            <div className={`p-4 rounded-lg border text-sm font-medium ${
              result.success
                ? 'bg-green-50 border-green-200 text-green-800 dark:bg-green-900/20 dark:border-green-800 dark:text-green-400'
                : 'bg-red-50 border-red-200 text-red-800 dark:bg-red-900/20 dark:border-red-800 dark:text-red-400'
            }`}>
              <div className="flex items-center gap-2">
                <Icon name={result.success ? IconName.CheckCircle : IconName.InfoCircle} className="w-5 h-5 flex-shrink-0" />
                {result.message}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
