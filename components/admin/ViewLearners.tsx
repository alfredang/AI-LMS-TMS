import { getApiUrl } from '@/lib/urlHelpers';
import React, { useState, useEffect } from 'react';
import { Card } from '../ui/Card';
import { Button } from '../ui/Button';
import { Icon, IconName } from '../ui/Icon';

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

const getAccountStatusColor = (status: string | null) => {
  const s = (status || '').toLowerCase();
  if (s === 'active') return 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400';
  if (s === 'inactive' || s === 'disabled' || s === 'suspended')
    return 'bg-gray-100 text-gray-800 dark:bg-gray-700 dark:text-gray-400';
  return 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-400';
};

const capitalise = (s: string | null) =>
  s ? s.charAt(0).toUpperCase() + s.slice(1) : 'N/A';

const ACCOUNT_STATUSES = ['Active', 'Inactive', 'Suspended'];
const SPONSORSHIP_TYPES = ['Self-Sponsored', 'Employer-Sponsored'];
const NATIONALITIES = ['Singaporean', 'Singapore PR', 'Non Citizen'];

const ViewLearners: React.FC = () => {
  const [learners, setLearners] = useState<Learner[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [showAdvancedFilters, setShowAdvancedFilters] = useState(false);
  const [filterSponsorships, setFilterSponsorships] = useState<string[]>([]);
  const [filterAccountStatuses, setFilterAccountStatuses] = useState<string[]>([]);
  const [filterNationalities, setFilterNationalities] = useState<string[]>([]);
  const [currentPage, setCurrentPage] = useState(1);

  const [showStatusConfirmation, setShowStatusConfirmation] = useState(false);
  const [selectedLearner, setSelectedLearner] = useState<Learner | null>(null);
  const [targetStatus, setTargetStatus] = useState<'active' | 'inactive' | null>(null);
  const [isUpdatingStatus, setIsUpdatingStatus] = useState(false);

  const itemsPerPage = 10;
  const inputClasses = "w-full px-3 py-2 border border-gray-300 rounded-md focus:ring-2 focus:ring-blue-500 focus:border-transparent dark:bg-gray-700 dark:border-gray-600 dark:text-white dark:placeholder-gray-400";

  const toggleCheckbox = (
    value: string,
    _current: string[],
    setSelected: React.Dispatch<React.SetStateAction<string[]>>
  ) => {
    setSelected(prev =>
      prev.includes(value) ? prev.filter(v => v !== value) : [...prev, value]
    );
    setCurrentPage(1);
  };

  const handleResetFilters = () => {
    setSearchQuery('');
    setFilterSponsorships([]);
    setFilterAccountStatuses([]);
    setFilterNationalities([]);
    setCurrentPage(1);
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
      if (!response.ok || !result.success) throw new Error(result.message || 'Failed to update status');
      alert(`Learner ${targetStatus} successfully!`);
      await fetchLearners();
      setShowStatusConfirmation(false);
      setSelectedLearner(null);
      setTargetStatus(null);
    } catch (error) {
      alert(`Failed to update learner status: ${error instanceof Error ? error.message : 'Please try again.'}`);
    } finally {
      setIsUpdatingStatus(false);
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

  useEffect(() => { fetchLearners(); }, []);

  const filteredLearners = learners.filter(learner => {
    const matchesSearch = !searchQuery ||
      learner.learner_name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      learner.email.toLowerCase().includes(searchQuery.toLowerCase()) ||
      (learner.telephone && learner.telephone.includes(searchQuery)) ||
      (learner.company && learner.company.toLowerCase().includes(searchQuery.toLowerCase()));

    const matchesSponsorship = filterSponsorships.length === 0 ||
      filterSponsorships.includes(learner.sponsorship_type || '');

    const matchesAccountStatus = filterAccountStatuses.length === 0 ||
      filterAccountStatuses.some(s => s.toLowerCase() === (learner.account_status || '').toLowerCase());

    const matchesNationality = filterNationalities.length === 0 ||
      filterNationalities.includes(learner.nationality || '');

    return matchesSearch && matchesSponsorship && matchesAccountStatus && matchesNationality;
  });

  const totalPages = Math.ceil(filteredLearners.length / itemsPerPage);
  const startIndex = (currentPage - 1) * itemsPerPage;
  const paginatedLearners = filteredLearners.slice(startIndex, startIndex + itemsPerPage);

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[400px]">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-500 mx-auto"></div>
          <p className="mt-4 text-gray-600 dark:text-gray-400">Loading learners...</p>
        </div>
      </div>
    );
  }

  const selfSponsored = learners.filter(l => (l.sponsorship_type || '').toLowerCase() === 'self-sponsored').length;
  const employerSponsored = learners.filter(l => (l.sponsorship_type || '').toLowerCase() === 'employer-sponsored').length;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex justify-between items-center">
        <h1 className="text-3xl font-bold text-gray-900 dark:text-white">View Learners</h1>
      </div>

      {/* KPI Stats */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        <Card className="p-6 text-center">
          <p className="text-4xl font-bold text-blue-600">{learners.length}</p>
          <p className="text-gray-600 dark:text-gray-300 mt-1">Learners</p>
        </Card>
        <Card className="p-6 text-center">
          <p className="text-4xl font-bold text-green-600">{selfSponsored}</p>
          <p className="text-gray-600 dark:text-gray-300 mt-1">Self Sponsored</p>
        </Card>
        <Card className="p-6 text-center">
          <p className="text-4xl font-bold text-purple-600">{employerSponsored}</p>
          <p className="text-gray-600 dark:text-gray-300 mt-1">Employer Sponsored</p>
        </Card>
      </div>

      {/* Search and Filters */}
      <Card className="p-6 mb-8 dark:bg-gray-800 dark:border-gray-700">
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 items-end">
          <div className="lg:col-span-2">
            <label htmlFor="learner-search" className="block text-sm font-medium text-gray-700 dark:text-gray-300">General Search</label>
            <div className="relative mt-1">
              <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                <Icon name={IconName.User} className="w-5 h-5 text-gray-400" />
              </div>
              <input
                type="text"
                id="learner-search"
                placeholder="Search name, email, phone, company..."
                value={searchQuery}
                onChange={e => { setSearchQuery(e.target.value); setCurrentPage(1); }}
                className={`${inputClasses} pl-10`}
              />
            </div>
          </div>
          <div className="lg:col-span-2 flex justify-end gap-2">
            <Button variant="ghost" onClick={handleResetFilters}>Reset Filters</Button>
            <Button variant="primary" onClick={() => setShowAdvancedFilters(!showAdvancedFilters)}>
              {showAdvancedFilters ? 'Hide' : 'Show'} Advanced Filters
            </Button>
          </div>
        </div>

        {showAdvancedFilters && (
          <div className="mt-4 pt-4 border-t dark:border-gray-700 space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4 items-start">
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">Sponsorship</label>
                <div className="flex flex-wrap gap-3">
                  {SPONSORSHIP_TYPES.map(s => (
                    <label key={s} className="flex items-center gap-2 cursor-pointer select-none">
                      <input
                        type="checkbox"
                        checked={filterSponsorships.includes(s)}
                        onChange={() => toggleCheckbox(s, filterSponsorships, setFilterSponsorships)}
                        className="w-4 h-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500 dark:border-gray-600 dark:bg-gray-700"
                      />
                      <span className="text-sm text-gray-700 dark:text-gray-300">{s}</span>
                    </label>
                  ))}
                </div>
                {filterSponsorships.length > 0 && (
                  <p className="mt-1 text-xs text-gray-400 dark:text-gray-500">Showing: {filterSponsorships.join(', ')}</p>
                )}
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">Nationality</label>
                <div className="flex flex-wrap gap-3">
                  {NATIONALITIES.map(n => (
                    <label key={n} className="flex items-center gap-2 cursor-pointer select-none">
                      <input
                        type="checkbox"
                        checked={filterNationalities.includes(n)}
                        onChange={() => toggleCheckbox(n, filterNationalities, setFilterNationalities)}
                        className="w-4 h-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500 dark:border-gray-600 dark:bg-gray-700"
                      />
                      <span className="text-sm text-gray-700 dark:text-gray-300">{n}</span>
                    </label>
                  ))}
                </div>
                {filterNationalities.length > 0 && (
                  <p className="mt-1 text-xs text-gray-400 dark:text-gray-500">Showing: {filterNationalities.join(', ')}</p>
                )}
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">Account Status</label>
                <div className="flex flex-wrap gap-3">
                  {ACCOUNT_STATUSES.map(s => (
                    <label key={s} className="flex items-center gap-2 cursor-pointer select-none">
                      <input
                        type="checkbox"
                        checked={filterAccountStatuses.includes(s)}
                        onChange={() => toggleCheckbox(s, filterAccountStatuses, setFilterAccountStatuses)}
                        className="w-4 h-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500 dark:border-gray-600 dark:bg-gray-700"
                      />
                      <span className="text-sm text-gray-700 dark:text-gray-300">{s}</span>
                    </label>
                  ))}
                </div>
                {filterAccountStatuses.length > 0 && (
                  <p className="mt-1 text-xs text-gray-400 dark:text-gray-500">Showing: {filterAccountStatuses.join(', ')}</p>
                )}
              </div>
            </div>
          </div>
        )}
      </Card>

      {/* Results */}
      <Card className="p-0 overflow-x-auto dark:bg-gray-800 dark:border-gray-700">
        {paginatedLearners.length > 0 ? (
          <>
            <table className="min-w-full divide-y divide-gray-200 dark:divide-gray-700">
              <thead className="bg-gray-50 dark:bg-gray-700/50">
                <tr>
                  <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider dark:text-gray-400">Learner Name</th>
                  <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider dark:text-gray-400">Contact</th>
                  <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider dark:text-gray-400">Gender</th>
                  <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider dark:text-gray-400">Company</th>
                  <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider dark:text-gray-400">Nationality</th>
                  <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider dark:text-gray-400">Employment</th>
                  <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider dark:text-gray-400">Account Status</th>
                  <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider dark:text-gray-400">Action</th>
                </tr>
              </thead>
              <tbody className="bg-white divide-y divide-gray-200 dark:bg-gray-800 dark:divide-gray-700">
                {paginatedLearners.map((learner, index) => (
                  <tr key={`${learner.user_id}-${index}`} className="hover:bg-gray-50 dark:hover:bg-gray-700/50">
                    <td className="px-6 py-4 whitespace-nowrap">
                      <div className="flex items-center">
                        <div className="flex-shrink-0 h-10 w-10">
                          <img
                            className="h-10 w-10 rounded-full object-cover"
                            src={learner.profile_picture
                              ? (learner.profile_picture.startsWith('http')
                                  ? learner.profile_picture
                                  : getApiUrl(`/api${learner.profile_picture}`))
                              : 'data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iNDAiIGhlaWdodD0iNDAiIHZpZXdCb3g9IjAgMCA0MCA0MCIgZmlsbD0ibm9uZSIgeG1sbnM9Imh0dHA6Ly93d3cudzMub3JnLzIwMDAvc3ZnIj4KPGNpcmNsZSBjeD0iMjAiIGN5PSIyMCIgcj0iMjAiIGZpbGw9IiM5Q0EzQUYiLz4KPGNpcmNsZSBjeD0iMjAiIGN5PSIxNSIgcj0iNiIgZmlsbD0id2hpdGUiLz4KPHBhdGggZD0iTTMwIDMzQzMwIDI3LjQ3NzIgMjUuNTIyOCAyMyAyMCAyM0MxNC40NzcyIDIzIDEwIDI3LjQ3NzIgMTAgMzNIMzBaIiBmaWxsPSJ3aGl0ZSIvPgo8L3N2Zz4K'
                            }
                            alt={learner.learner_name}
                            onError={(e) => {
                              e.currentTarget.src = 'data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iNDAiIGhlaWdodD0iNDAiIHZpZXdCb3g9IjAgMCA0MCA0MCIgZmlsbD0ibm9uZSIgeG1sbnM9Imh0dHA6Ly93d3cudzMub3JnLzIwMDAvc3ZnIj4KPGNpcmNsZSBjeD0iMjAiIGN5PSIyMCIgcj0iMjAiIGZpbGw9IiM5Q0EzQUYiLz4KPGNpcmNsZSBjeD0iMjAiIGN5PSIxNSIgcj0iNiIgZmlsbD0id2hpdGUiLz4KPHBhdGggZD0iTTMwIDMzQzMwIDI3LjQ3NzIgMjUuNTIyOCAyMyAyMCAyM0MxNC40NzcyIDIzIDEwIDI3LjQ3NzIgMTAgMzNIMzBaIiBmaWxsPSJ3aGl0ZSIvPgo8L3N2Zz4K';
                            }}
                          />
                        </div>
                        <div className="ml-4">
                          <div className="text-sm font-medium text-gray-900 dark:text-white">{learner.learner_name}</div>
                        </div>
                      </div>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap">
                      <div className="text-sm text-gray-900 dark:text-white">{learner.email}</div>
                      <div className="text-sm text-gray-500 dark:text-gray-400">{learner.telephone || 'N/A'}</div>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500 dark:text-gray-400">{capitalise(learner.gender)}</td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500 dark:text-gray-400">{learner.company || 'N/A'}</td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500 dark:text-gray-400">{learner.nationality || 'N/A'}</td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500 dark:text-gray-400">{capitalise(learner.employment_status)}</td>
                    <td className="px-6 py-4 whitespace-nowrap">
                      <span className={`px-2 inline-flex text-xs leading-5 font-semibold rounded-full ${getAccountStatusColor(learner.account_status)}`}>
                        {capitalise(learner.account_status)}
                      </span>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm">
                      {(learner.account_status || '').toLowerCase() === 'active' ? (
                        <Button
                          variant="ghost"
                          onClick={() => handleStatusChange(learner, 'inactive')}
                          className="text-red-600 hover:text-red-800 hover:bg-red-50 dark:hover:bg-red-900/20"
                        >
                          <Icon name={IconName.Close} className="w-4 h-4 mr-1" />
                          Deactivate
                        </Button>
                      ) : (
                        <Button
                          variant="ghost"
                          onClick={() => handleStatusChange(learner, 'active')}
                          className="text-green-600 hover:text-green-800 hover:bg-green-50 dark:hover:bg-green-900/20"
                        >
                          <Icon name={IconName.Check} className="w-4 h-4 mr-1" />
                          Activate
                        </Button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {totalPages > 1 && (
              <div className="p-4 flex justify-between items-center border-t dark:border-gray-700">
                <Button variant="ghost" onClick={() => setCurrentPage(prev => Math.max(1, prev - 1))} disabled={currentPage === 1}>
                  Previous
                </Button>
                <span className="text-sm text-gray-500 dark:text-gray-400">
                  Page {currentPage} of {totalPages}
                </span>
                <Button variant="ghost" onClick={() => setCurrentPage(prev => Math.min(totalPages, prev + 1))} disabled={currentPage === totalPages}>
                  Next
                </Button>
              </div>
            )}
          </>
        ) : (
          <div className="text-center py-12">
            <Icon name={IconName.User} className="w-16 h-16 text-gray-300 dark:text-gray-600 mx-auto mb-4" />
            <h3 className="text-lg font-medium text-gray-900 mb-2 dark:text-white">No learners found</h3>
            <p className="text-gray-500 mb-6 dark:text-gray-400">
              {learners.length === 0
                ? "There are no learners in the system yet."
                : "No learners match your current search criteria."}
            </p>
          </div>
        )}
      </Card>

      {/* Status Update Confirmation Dialog */}
      {showStatusConfirmation && selectedLearner && targetStatus && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
          <div className="bg-white dark:bg-gray-800 rounded-lg shadow-xl max-w-md w-full mx-auto">
            <div className="p-6">
              <div className="flex items-center gap-4 mb-4">
                <div className={`w-12 h-12 rounded-full flex items-center justify-center flex-shrink-0 ${targetStatus === 'active' ? 'bg-green-100 dark:bg-green-900/30' : 'bg-red-100 dark:bg-red-900/30'}`}>
                  <Icon
                    name={targetStatus === 'active' ? IconName.Check : IconName.Close}
                    className={`w-6 h-6 ${targetStatus === 'active' ? 'text-green-600 dark:text-green-400' : 'text-red-600 dark:text-red-400'}`}
                  />
                </div>
                <h3 className="text-lg font-semibold text-gray-900 dark:text-white">
                  {targetStatus === 'active' ? 'Activate' : 'Deactivate'} Learner
                </h3>
              </div>
              <p className="text-gray-700 dark:text-gray-300 mb-6">
                Are you sure you want to {targetStatus} the learner{' '}
                <strong>&quot;{selectedLearner.learner_name}&quot;</strong>?
              </p>
              <div className="flex gap-3 justify-end">
                <Button
                  variant="ghost"
                  onClick={() => { setShowStatusConfirmation(false); setSelectedLearner(null); setTargetStatus(null); }}
                  disabled={isUpdatingStatus}
                >
                  Cancel
                </Button>
                <Button
                  onClick={confirmStatusUpdate}
                  disabled={isUpdatingStatus}
                  className={`${targetStatus === 'active' ? 'bg-green-600 hover:bg-green-700 text-white' : 'bg-red-600 hover:bg-red-700 text-white'}`}
                >
                  {isUpdatingStatus ? (
                    <>
                      <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white mr-2"></div>
                      Updating...
                    </>
                  ) : (
                    `${targetStatus === 'active' ? 'Activate' : 'Deactivate'} Learner`
                  )}
                </Button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default ViewLearners;
