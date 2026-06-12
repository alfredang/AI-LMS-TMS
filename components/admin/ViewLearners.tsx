import { getApiUrl } from '@/lib/urlHelpers';
import React, { useState, useEffect, useRef } from 'react';
import { Card } from '../ui/Card';
import { Button } from '../ui/Button';
import { Icon, IconName } from '../ui/Icon';
import { maskNric } from '../../utils';

interface Learner {
  user_id: string;
  learner_name: string;
  email: string;
  secondary_email: string | null;
  profile_picture: string | null;
  telephone: string | null;
  nric: string | null;
  gender: string | null;
  company: string | null;
  employment_status: string | null;
  nationality: string | null;
  ethnicity: string | null;
  dob: string | null;
  account_status: string | null;
  sponsorship_type: string | null;
}

const getStatusColor = (status: string | null) => {
  const s = (status || '').toLowerCase();
  if (s === 'active') return 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400';
  return 'bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400';
};

const capitalise = (s: string | null) => s ? s.charAt(0).toUpperCase() + s.slice(1) : 'N/A';

const ViewLearners: React.FC = () => {
  const [learners, setLearners] = useState<Learner[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [filterStatus, setFilterStatus] = useState<string>('All');
  const [currentPage, setCurrentPage] = useState(1);
  // Track current page in a ref to avoid closure bugs in window event listeners
  const currentPageRef = useRef(currentPage);

  useEffect(() => {
    currentPageRef.current = currentPage;
  }, [currentPage]);

  const [visibleNrics, setVisibleNrics] = useState<Set<string>>(new Set());

  // Detail modal
  const [detailLearner, setDetailLearner] = useState<Learner | null>(null);

  // Status confirmation
  const [showStatusConfirmation, setShowStatusConfirmation] = useState(false);
  const [selectedLearner, setSelectedLearner] = useState<Learner | null>(null);
  const [targetStatus, setTargetStatus] = useState<'active' | 'inactive' | null>(null);
  const [isUpdatingStatus, setIsUpdatingStatus] = useState(false);

  // Delete confirmation
  const [showDeleteConfirmation, setShowDeleteConfirmation] = useState(false);
  const [deletingLearner, setDeletingLearner] = useState<Learner | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);

  const itemsPerPage = 30;

  const toggleNricVisibility = (userId: string) => {
    setVisibleNrics(prev => {
      const next = new Set(prev);
      if (next.has(userId)) next.delete(userId); else next.add(userId);
      return next;
    });
  };

  const handleStatusChange = (learner: Learner, newStatus: 'active' | 'inactive') => {
    setSelectedLearner(learner);
    setTargetStatus(newStatus);
    setShowStatusConfirmation(true);
  };

  const confirmStatusUpdate = async () => {
    if (!selectedLearner || !targetStatus) return;
    try {
      setIsUpdatingStatus(true);
      const response = await fetch('/api/admin/update-learner-status', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId: selectedLearner.user_id, newStatus: targetStatus })
      });
      const result = await response.json();
      if (!response.ok || !result.success) throw new Error(result.message || 'Failed');
      await fetchLearners();
    } catch (error) {
      alert(`Failed: ${error instanceof Error ? error.message : 'Please try again.'}`);
    } finally {
      setIsUpdatingStatus(false);
      setShowStatusConfirmation(false);
      setSelectedLearner(null);
      setTargetStatus(null);
    }
  };

  const confirmDelete = async () => {
    if (!deletingLearner) return;
    try {
      setIsDeleting(true);
      const response = await fetch('/api/training-provider/hard-delete-user', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId: deletingLearner.user_id })
      });
      const result = await response.json();
      if (!response.ok || !result.success) throw new Error(result.message || 'Failed');
      await fetchLearners();
    } catch (error) {
      alert(`Failed: ${error instanceof Error ? error.message : 'Please try again.'}`);
    } finally {
      setIsDeleting(false);
      setShowDeleteConfirmation(false);
      setDeletingLearner(null);
    }
  };

  const fetchLearners = async () => {
    try {
      setLoading(true);
      const response = await fetch('/api/admin/learners-detail');
      const data = await response.json();
      if (data.success) setLearners(data.data.learners);
    } catch (error) {
      console.error('Error fetching learners:', error);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchLearners();

    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        console.log('👀 Tab focused, refreshing learners for page:', currentPageRef.current);
        fetchLearners();
      }
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);
    return () => document.removeEventListener('visibilitychange', handleVisibilityChange);
  }, []);

  const filteredLearners = learners.filter(learner => {
    const matchesSearch = !searchQuery ||
      learner.learner_name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      learner.email.toLowerCase().includes(searchQuery.toLowerCase()) ||
      (learner.telephone && learner.telephone.includes(searchQuery));

    const matchesStatus = filterStatus === 'All' ||
      (filterStatus === 'Active' && (learner.account_status || '').toLowerCase() === 'active') ||
      (filterStatus === 'Inactive' && (learner.account_status || '').toLowerCase() !== 'active');

    return matchesSearch && matchesStatus;
  });

  const totalPages = Math.ceil(filteredLearners.length / itemsPerPage);
  const paginatedLearners = filteredLearners.slice((currentPage - 1) * itemsPerPage, currentPage * itemsPerPage);
  const activeLearners = learners.filter(l => (l.account_status || '').toLowerCase() === 'active').length;

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[400px]">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-500 mx-auto" />
          <p className="mt-4 text-gray-600 dark:text-gray-400">Loading learners...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <h1 className="text-3xl font-bold text-gray-900 dark:text-white">View Learners</h1>

      {/* Stats */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <Card className="p-4 text-center">
          <p className="text-3xl font-bold text-blue-600">{learners.length}</p>
          <p className="text-sm text-gray-600 dark:text-gray-300">Total Learners</p>
        </Card>
        <Card className="p-4 text-center">
          <p className="text-3xl font-bold text-green-600">{activeLearners}</p>
          <p className="text-sm text-gray-600 dark:text-gray-300">Active</p>
        </Card>
        <Card className="p-4 text-center">
          <p className="text-3xl font-bold text-red-600">{learners.length - activeLearners}</p>
          <p className="text-sm text-gray-600 dark:text-gray-300">Inactive</p>
        </Card>
      </div>

      {/* Search + Filter */}
      <Card className="p-4">
        <div className="flex flex-col sm:flex-row gap-3">
          <div className="flex-1 relative">
            <Icon name={IconName.Search} className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-gray-400" />
            <input
              type="text"
              placeholder="Search name, email, phone..."
              value={searchQuery}
              onChange={e => { setSearchQuery(e.target.value); setCurrentPage(1); }}
              className="w-full pl-10 pr-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 text-sm dark:bg-gray-700 dark:border-gray-600 dark:text-white"
            />
          </div>
          <select
            value={filterStatus}
            onChange={e => { setFilterStatus(e.target.value); setCurrentPage(1); }}
            className="px-3 py-2 border border-gray-300 rounded-lg text-sm dark:bg-gray-700 dark:border-gray-600 dark:text-white"
          >
            <option value="All">All Status</option>
            <option value="Active">Active</option>
            <option value="Inactive">Inactive</option>
          </select>
          {(searchQuery || filterStatus !== 'All') && (
            <button
              onClick={() => { setSearchQuery(''); setFilterStatus('All'); setCurrentPage(1); }}
              className="px-3 py-2 text-sm border border-gray-300 rounded-lg hover:bg-gray-50 dark:border-gray-600 dark:hover:bg-gray-700 dark:text-gray-300"
            >
              Clear
            </button>
          )}
        </div>
      </Card>

      {/* Table */}
      <Card className="p-0 overflow-hidden">
        {paginatedLearners.length > 0 ? (
          <>
            <div className="overflow-x-auto">
              <table className="min-w-full divide-y divide-gray-200 dark:divide-gray-700">
                <thead className="bg-gray-50 dark:bg-gray-700/50">
                  <tr>
                    <th className="px-4 py-2.5 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">Name</th>
                    <th className="px-4 py-2.5 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">Email</th>
                    <th className="px-4 py-2.5 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">Phone</th>
                    <th className="px-4 py-2.5 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">NRIC</th>
                    <th className="px-4 py-2.5 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">Status</th>
                    <th className="px-4 py-2.5 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">Action</th>
                  </tr>
                </thead>
                <tbody className="bg-white dark:bg-gray-800 divide-y divide-gray-200 dark:divide-gray-700">
                  {paginatedLearners.map((learner, index) => (
                    <tr key={`${learner.user_id}-${index}`} className="hover:bg-gray-50 dark:hover:bg-gray-700/50">
                      <td className="px-4 py-2 whitespace-nowrap">
                        <button
                          onClick={() => setDetailLearner(learner)}
                          className="text-sm font-medium text-blue-600 dark:text-blue-400 hover:underline text-left"
                        >
                          {learner.learner_name}
                        </button>
                      </td>
                      <td className="px-4 py-2 whitespace-nowrap text-sm text-gray-700 dark:text-gray-300">{learner.email}</td>
                      <td className="px-4 py-2 whitespace-nowrap text-sm text-gray-500 dark:text-gray-400">{learner.telephone || '—'}</td>
                      <td className="px-4 py-2 whitespace-nowrap">
                        <div className="flex items-center gap-1">
                          <span className="text-sm text-gray-700 dark:text-gray-300">
                            {learner.nric && learner.nric !== 'N/A'
                              ? (visibleNrics.has(learner.user_id) ? learner.nric : maskNric(learner.nric))
                              : '—'}
                          </span>
                          {learner.nric && learner.nric !== 'N/A' && (
                            <button onClick={() => toggleNricVisibility(learner.user_id)} className="text-gray-400 hover:text-blue-500">
                              <Icon name={visibleNrics.has(learner.user_id) ? IconName.EyeOff : IconName.Eye} className="w-3.5 h-3.5" />
                            </button>
                          )}
                        </div>
                      </td>
                      <td className="px-4 py-2 whitespace-nowrap">
                        <span className={`px-2 py-0.5 text-xs font-semibold rounded-full ${getStatusColor(learner.account_status)}`}>
                          {(learner.account_status || '').toLowerCase() === 'active' ? 'Active' : 'Inactive'}
                        </span>
                      </td>
                      <td className="px-4 py-2 whitespace-nowrap text-sm">
                        <div className="flex items-center gap-1">
                          {(learner.account_status || '').toLowerCase() === 'active' ? (
                            <button onClick={() => handleStatusChange(learner, 'inactive')} className="text-red-500 hover:text-red-700 p-1" title="Deactivate">
                              <Icon name={IconName.Close} className="w-4 h-4" />
                            </button>
                          ) : (
                            <button onClick={() => handleStatusChange(learner, 'active')} className="text-green-500 hover:text-green-700 p-1" title="Activate">
                              <Icon name={IconName.Check} className="w-4 h-4" />
                            </button>
                          )}
                          <button onClick={() => { setDeletingLearner(learner); setShowDeleteConfirmation(true); }} className="text-gray-400 hover:text-red-600 p-1" title="Delete">
                            <Icon name={IconName.Delete} className="w-4 h-4" />
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* Pagination */}
            {totalPages > 1 && (
              <div className="p-3 flex items-center justify-between border-t dark:border-gray-700">
                <p className="text-sm text-gray-500 dark:text-gray-400">
                  {(currentPage - 1) * itemsPerPage + 1}–{Math.min(currentPage * itemsPerPage, filteredLearners.length)} of {filteredLearners.length}
                </p>
                <div className="flex items-center gap-1">
                  <button onClick={() => setCurrentPage(1)} disabled={currentPage === 1} className="px-2.5 py-1 text-xs font-medium rounded border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-gray-700 dark:text-gray-300 disabled:opacity-40 hover:bg-gray-50 dark:hover:bg-gray-700">First</button>
                  <button onClick={() => setCurrentPage(p => Math.max(1, p - 1))} disabled={currentPage === 1} className="px-2.5 py-1 text-xs font-medium rounded border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-gray-700 dark:text-gray-300 disabled:opacity-40 hover:bg-gray-50 dark:hover:bg-gray-700">Prev</button>
                  {Array.from({ length: totalPages }, (_, i) => i + 1)
                    .filter(i => i === 1 || i === totalPages || Math.abs(i - currentPage) <= 1)
                    .reduce<(number | 'e')[]>((acc, i, idx, arr) => {
                      if (idx > 0 && i - (arr[idx - 1] as number) > 1) acc.push('e');
                      acc.push(i);
                      return acc;
                    }, [])
                    .map((item, idx) =>
                      item === 'e' ? <span key={`e${idx}`} className="px-1 text-gray-400">...</span> : (
                        <button key={item} onClick={() => setCurrentPage(item as number)} className={`px-2.5 py-1 text-xs font-medium rounded border ${currentPage === item ? 'bg-blue-600 text-white border-blue-600' : 'border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700'}`}>{item}</button>
                      )
                    )}
                  <button onClick={() => setCurrentPage(p => Math.min(totalPages, p + 1))} disabled={currentPage === totalPages} className="px-2.5 py-1 text-xs font-medium rounded border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-gray-700 dark:text-gray-300 disabled:opacity-40 hover:bg-gray-50 dark:hover:bg-gray-700">Next</button>
                  <button onClick={() => setCurrentPage(totalPages)} disabled={currentPage === totalPages} className="px-2.5 py-1 text-xs font-medium rounded border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-gray-700 dark:text-gray-300 disabled:opacity-40 hover:bg-gray-50 dark:hover:bg-gray-700">Last</button>
                </div>
              </div>
            )}
          </>
        ) : (
          <div className="text-center py-12">
            <Icon name={IconName.User} className="w-12 h-12 text-gray-300 dark:text-gray-600 mx-auto mb-3" />
            <p className="text-gray-500 dark:text-gray-400">{searchQuery || filterStatus !== 'All' ? 'No learners match your filters.' : 'No learners in the system yet.'}</p>
          </div>
        )}
      </Card>

      {/* Learner Detail Modal */}
      {detailLearner && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4" onClick={() => setDetailLearner(null)}>
          <div className="bg-white dark:bg-gray-800 rounded-xl shadow-2xl max-w-lg w-full" onClick={e => e.stopPropagation()}>
            <div className="p-6">
              <div className="flex items-center justify-between mb-6">
                <h3 className="text-xl font-bold text-gray-900 dark:text-white">Learner Details</h3>
                <button onClick={() => setDetailLearner(null)} className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-300">
                  <Icon name={IconName.Close} className="w-5 h-5" />
                </button>
              </div>
              <div className="space-y-3">
                {[
                  ['Name', detailLearner.learner_name],
                  ['Email', detailLearner.email],
                  ['Secondary Email', detailLearner.secondary_email],
                  ['Phone', detailLearner.telephone],
                  ['NRIC', detailLearner.nric],
                  ['Gender', capitalise(detailLearner.gender)],
                  ['Date of Birth', detailLearner.dob ? new Date(detailLearner.dob).toLocaleDateString('en-SG', { year: 'numeric', month: 'short', day: 'numeric' }) : null],
                  ['Nationality', detailLearner.nationality],
                  ['Ethnicity', detailLearner.ethnicity],
                  ['Company', detailLearner.company],
                  ['Employment Status', capitalise(detailLearner.employment_status)],
                  ['Sponsorship', detailLearner.sponsorship_type],
                  ['Account Status', capitalise(detailLearner.account_status)],
                ].map(([label, value], i) => (
                  <div key={i} className={`flex justify-between py-2 ${i % 2 === 0 ? 'bg-gray-50 dark:bg-gray-700/30 -mx-6 px-6' : ''}`}>
                    <span className="text-sm font-medium text-gray-500 dark:text-gray-400">{label}</span>
                    <span className="text-sm text-gray-900 dark:text-white text-right">{value || '—'}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Status Confirmation */}
      {showStatusConfirmation && selectedLearner && targetStatus && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
          <div className="bg-white dark:bg-gray-800 rounded-lg shadow-xl max-w-md w-full p-6">
            <h3 className="text-lg font-semibold text-gray-900 dark:text-white mb-3">
              {targetStatus === 'active' ? 'Activate' : 'Deactivate'} Learner
            </h3>
            <p className="text-gray-700 dark:text-gray-300 mb-6">
              {targetStatus === 'active'
                ? <>Activate <strong>{selectedLearner.learner_name}</strong>? They will be able to log in.</>
                : <>Deactivate <strong>{selectedLearner.learner_name}</strong>? They will not be able to log in.</>}
            </p>
            <div className="flex gap-3 justify-end">
              <Button variant="ghost" onClick={() => { setShowStatusConfirmation(false); setSelectedLearner(null); setTargetStatus(null); }} disabled={isUpdatingStatus}>Cancel</Button>
              <Button onClick={confirmStatusUpdate} disabled={isUpdatingStatus} className={targetStatus === 'active' ? 'bg-green-600 hover:bg-green-700 text-white' : 'bg-red-600 hover:bg-red-700 text-white'}>
                {isUpdatingStatus ? 'Updating...' : (targetStatus === 'active' ? 'Activate' : 'Deactivate')}
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* Delete Confirmation */}
      {showDeleteConfirmation && deletingLearner && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
          <div className="bg-white dark:bg-gray-800 rounded-lg shadow-xl max-w-md w-full p-6">
            <h3 className="text-lg font-semibold text-gray-900 dark:text-white mb-3">Delete Learner</h3>
            <p className="text-gray-700 dark:text-gray-300 mb-2">
              Permanently delete <strong>{deletingLearner.learner_name}</strong>?
            </p>
            <p className="text-sm text-red-600 dark:text-red-400 mb-6">This cannot be undone. All enrollments and records will be removed.</p>
            <div className="flex gap-3 justify-end">
              <Button variant="ghost" onClick={() => { setShowDeleteConfirmation(false); setDeletingLearner(null); }} disabled={isDeleting}>Cancel</Button>
              <Button onClick={confirmDelete} disabled={isDeleting} className="bg-red-600 hover:bg-red-700 text-white">
                {isDeleting ? 'Deleting...' : 'Delete Permanently'}
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default ViewLearners;
