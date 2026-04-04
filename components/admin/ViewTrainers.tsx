import { getApiUrl } from '@/lib/urlHelpers';
import React, { useState, useEffect } from 'react';
import { Card } from '../ui/Card';
import { Button } from '../ui/Button';
import { Icon, IconName } from '../ui/Icon';
import AddTrainerForm from './AddTrainerForm';
import { BulkUploadTrainersView } from './BulkUploadTrainersView';
import { SKILLS_FUTURE_INDUSTRIES } from '@app-types/profile';

interface Trainer {
  trainer_name: string;
  email: string;
  secondary_email: string | null;
  profile_picture: string | null;
  telephone: string | null;
  trainer_type: string | null;
  status: string | null;
  account_status: string | null;
  linkedin_url: string | null;
  cv_folder_url: string | null;
  areas_of_expertise: string[] | null;
  user_id: string;
}

const getStatusColor = (status: string | null) => {
  switch (status) {
    case 'Active':
      return 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400';
    case 'Inactive':
      return 'bg-gray-100 text-gray-800 dark:bg-gray-700 dark:text-gray-400';
    default:
      return 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-400';
  }
};

const getAccountStatusColor = (status: string | null) => {
  const normalised = (status || '').toLowerCase();
  if (normalised === 'active') return 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400';
  if (normalised === 'inactive' || normalised === 'disabled' || normalised === 'suspended')
    return 'bg-gray-100 text-gray-800 dark:bg-gray-700 dark:text-gray-400';
  return 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-400';
};

const capitalise = (s: string | null) =>
  s ? s.charAt(0).toUpperCase() + s.slice(1) : 'N/A';

const TRAINER_TYPES = ['ACLP', 'non-ACLP'];
const TRAINER_STATUSES = ['Active', 'Inactive'];

const ViewTrainers: React.FC = () => {
  const [trainers, setTrainers] = useState<Trainer[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [showAdvancedFilters, setShowAdvancedFilters] = useState(false);
  const [filterTrainerTypes, setFilterTrainerTypes] = useState<string[]>([]);
  const [filterTrainerStatuses, setFilterTrainerStatuses] = useState<string[]>([]);
  const [filterAreasOfExpertise, setFilterAreasOfExpertise] = useState<string[]>([]);
  const [currentPage, setCurrentPage] = useState(1);
  const [showAddTrainerForm, setShowAddTrainerForm] = useState(false);
  const [showBulkUpload, setShowBulkUpload] = useState(false);

  // Status update confirmation states
  const [showStatusConfirmation, setShowStatusConfirmation] = useState(false);
  const [selectedTrainer, setSelectedTrainer] = useState<Trainer | null>(null);
  const [targetStatus, setTargetStatus] = useState<'Active' | 'Inactive' | null>(null);
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
    setFilterTrainerTypes([]);
    setFilterTrainerStatuses([]);
    setFilterAreasOfExpertise([]);
    setCurrentPage(1);
  };

  const handleAddTrainerSuccess = () => {
    setShowAddTrainerForm(false);
    fetchTrainers();
  };

  const handleStatusChange = (trainer: Trainer, newStatus: 'Active' | 'Inactive') => {
    setSelectedTrainer(trainer);
    setTargetStatus(newStatus);
    setShowStatusConfirmation(true);
  };

  const confirmStatusUpdate = async () => {
    if (!selectedTrainer || !targetStatus) return;

    try {
      setIsUpdatingStatus(true);

      const response = await fetch('/api/admin/update-trainer-status', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId: selectedTrainer.user_id, newStatus: targetStatus })
      });

      const result = await response.json();

      if (!response.ok || !result.success) {
        throw new Error(result.message || 'Failed to update trainer status');
      }

      alert(`Trainer ${targetStatus.toLowerCase()} successfully!`);
      await fetchTrainers();
      setShowStatusConfirmation(false);
      setSelectedTrainer(null);
      setTargetStatus(null);

    } catch (error) {
      alert(`Failed to update trainer status: ${error instanceof Error ? error.message : 'Please try again.'}`);
    } finally {
      setIsUpdatingStatus(false);
    }
  };

  const fetchTrainers = async () => {
    try {
      setLoading(true);
      const response = await fetch('/api/admin/trainers-detail');
      const data = await response.json();
      if (data.success) setTrainers(data.data.trainers);
    } catch (error) {
      console.error('Error fetching trainers:', error);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { fetchTrainers(); }, []);

  const filteredTrainers = trainers.filter(trainer => {
    const matchesSearch = !searchQuery ||
      trainer.trainer_name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      trainer.email.toLowerCase().includes(searchQuery.toLowerCase()) ||
      (trainer.secondary_email && trainer.secondary_email.toLowerCase().includes(searchQuery.toLowerCase())) ||
      (trainer.telephone && trainer.telephone.toLowerCase().includes(searchQuery.toLowerCase()));

    const matchesTrainerType = filterTrainerTypes.length === 0 || filterTrainerTypes.includes(trainer.trainer_type || '');

    const matchesTrainerStatus = filterTrainerStatuses.length === 0 ||
      filterTrainerStatuses.includes(trainer.status || '');

    const areas = Array.isArray(trainer.areas_of_expertise)
      ? trainer.areas_of_expertise
      : (typeof trainer.areas_of_expertise === 'string' ? JSON.parse(trainer.areas_of_expertise) : []);
    const matchesAreasOfExpertise = filterAreasOfExpertise.length === 0 ||
      (areas.length > 0 && areas.some((a: string) => filterAreasOfExpertise.includes(a)));

    return matchesSearch && matchesTrainerType && matchesTrainerStatus && matchesAreasOfExpertise;
  });

  const totalPages = Math.ceil(filteredTrainers.length / itemsPerPage);
  const startIndex = (currentPage - 1) * itemsPerPage;
  const paginatedTrainers = filteredTrainers.slice(startIndex, startIndex + itemsPerPage);

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[400px]">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-500 mx-auto"></div>
          <p className="mt-4 text-gray-600 dark:text-gray-400">Loading trainers...</p>
        </div>
      </div>
    );
  }

  if (showAddTrainerForm) {
    return (
      <AddTrainerForm
        onCancel={() => setShowAddTrainerForm(false)}
        onSuccess={handleAddTrainerSuccess}
      />
    );
  }

  if (showBulkUpload) {
    return (
      <BulkUploadTrainersView
        onBack={() => { setShowBulkUpload(false); fetchTrainers(); }}
      />
    );
  }

  const totalTrainers = trainers.length;
  const activeTrainers = trainers.filter(t => (t.status || '').toLowerCase() === 'active').length;
  const aclpTrainers = trainers.filter(t => (t.trainer_type || '').toUpperCase() === 'ACLP').length;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex justify-between items-center">
        <h1 className="text-3xl font-bold text-gray-900 dark:text-white">View Trainers</h1>
        <div className="flex gap-2">
          <Button variant="ghost" onClick={() => setShowBulkUpload(true)} className="border border-blue-500 text-blue-600 hover:bg-blue-50 dark:border-blue-400 dark:text-blue-400 dark:hover:bg-blue-900/20">
            <Icon name={IconName.Upload} className="w-4 h-4 mr-2" />
            Bulk Upload Trainers
          </Button>
          <Button variant="primary" onClick={() => setShowAddTrainerForm(true)}>
            <Icon name={IconName.Add} className="w-4 h-4 mr-2" />
            Add New Trainer
          </Button>
        </div>
      </div>

      {/* KPI Stats */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        <Card className="p-6 text-center">
          <p className="text-4xl font-bold text-blue-600">{totalTrainers}</p>
          <p className="text-gray-600 dark:text-gray-300 mt-1">Trainers</p>
        </Card>
        <Card className="p-6 text-center">
          <p className="text-4xl font-bold text-green-600">{activeTrainers}</p>
          <p className="text-gray-600 dark:text-gray-300 mt-1">Active Trainers</p>
        </Card>
        <Card className="p-6 text-center">
          <p className="text-4xl font-bold text-purple-600">{aclpTrainers}</p>
          <p className="text-gray-600 dark:text-gray-300 mt-1">ACLP Trainers</p>
        </Card>
      </div>

      {/* Search and Filters */}
      <Card className="p-6 mb-8 dark:bg-gray-800 dark:border-gray-700">
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 items-end">
          <div className="lg:col-span-2">
            <label htmlFor="general-search" className="block text-sm font-medium text-gray-700 dark:text-gray-300">General Search</label>
            <div className="relative mt-1">
              <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                <Icon name={IconName.User} className="w-5 h-5 text-gray-400" />
              </div>
              <input
                type="text"
                id="general-search"
                placeholder="Search name, email..."
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
              {/* Trainer Type checkboxes */}
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">Trainer Type</label>
                <div className="flex flex-wrap gap-3">
                  {TRAINER_TYPES.map(t => (
                    <label key={t} className="flex items-center gap-2 cursor-pointer select-none">
                      <input
                        type="checkbox"
                        checked={filterTrainerTypes.includes(t)}
                        onChange={() => toggleCheckbox(t, filterTrainerTypes, setFilterTrainerTypes)}
                        className="w-4 h-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500 dark:border-gray-600 dark:bg-gray-700"
                      />
                      <span className="text-sm text-gray-700 dark:text-gray-300">{t}</span>
                    </label>
                  ))}
                </div>
                {filterTrainerTypes.length > 0 && (
                  <p className="mt-1 text-xs text-gray-400 dark:text-gray-500">Showing: {filterTrainerTypes.join(', ')}</p>
                )}
              </div>

              {/* Trainer Status checkboxes */}
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">Trainer Status</label>
                <div className="flex flex-wrap gap-3">
                  {TRAINER_STATUSES.map(s => (
                    <label key={s} className="flex items-center gap-2 cursor-pointer select-none">
                      <input
                        type="checkbox"
                        checked={filterTrainerStatuses.includes(s)}
                        onChange={() => toggleCheckbox(s, filterTrainerStatuses, setFilterTrainerStatuses)}
                        className="w-4 h-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500 dark:border-gray-600 dark:bg-gray-700"
                      />
                      <span className="text-sm text-gray-700 dark:text-gray-300">{s}</span>
                    </label>
                  ))}
                </div>
                {filterTrainerStatuses.length > 0 && (
                  <p className="mt-1 text-xs text-gray-400 dark:text-gray-500">Showing: {filterTrainerStatuses.join(', ')}</p>
                )}
              </div>

              {/* Area of Expertise dropdown */}
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">Area of Expertise</label>
                <select
                  value={filterAreasOfExpertise[0] || ''}
                  onChange={(e) => {
                    setFilterAreasOfExpertise(e.target.value ? [e.target.value] : []);
                    setCurrentPage(1);
                  }}
                  className={inputClasses}
                >
                  <option value="">None</option>
                  {SKILLS_FUTURE_INDUSTRIES.map(area => (
                    <option key={area} value={area}>{area}</option>
                  ))}
                </select>
              </div>
            </div>
          </div>
        )}
      </Card>

      {/* Results */}
      <Card className="p-0 overflow-x-auto dark:bg-gray-800 dark:border-gray-700">
        {paginatedTrainers.length > 0 ? (
          <>
            <table className="min-w-full divide-y divide-gray-200 dark:divide-gray-700">
              <thead className="bg-gray-50 dark:bg-gray-700/50">
                <tr>
                  <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider dark:text-gray-400">Trainer Name</th>
                  <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider dark:text-gray-400">Contact</th>
                  <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider dark:text-gray-400">Trainer Type</th>
                  <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider dark:text-gray-400">Area of Expertise</th>
                  <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider dark:text-gray-400">Trainer Status</th>
                  <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider dark:text-gray-400">Account Status</th>
                  <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider dark:text-gray-400">LinkedIn Profile</th>
                  <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider dark:text-gray-400">CV Folder</th>
                  <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider dark:text-gray-400">Action</th>
                </tr>
              </thead>
              <tbody className="bg-white divide-y divide-gray-200 dark:bg-gray-800 dark:divide-gray-700">
                {paginatedTrainers.map((trainer, index) => (
                  <tr key={`${trainer.trainer_name}-${index}`} className="hover:bg-gray-50 dark:hover:bg-gray-700/50">
                    <td className="px-6 py-4 whitespace-nowrap">
                      <div className="flex items-center">
                        <div className="flex-shrink-0 h-10 w-10">
                          <img
                            className="h-10 w-10 rounded-full object-cover"
                            src={trainer.profile_picture
                              ? (trainer.profile_picture.startsWith('http')
                                  ? trainer.profile_picture
                                  : getApiUrl(`/api${trainer.profile_picture}`))
                              : 'data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iNDAiIGhlaWdodD0iNDAiIHZpZXdCb3g9IjAgMCA0MCA0MCIgZmlsbD0ibm9uZSIgeG1sbnM9Imh0dHA6Ly93d3cudzMub3JnLzIwMDAvc3ZnIj4KPGNpcmNsZSBjeD0iMjAiIGN5PSIyMCIgcj0iMjAiIGZpbGw9IiM5Q0EzQUYiLz4KPGNpcmNsZSBjeD0iMjAiIGN5PSIxNSIgcj0iNiIgZmlsbD0id2hpdGUiLz4KPHBhdGggZD0iTTMwIDMzQzMwIDI3LjQ3NzIgMjUuNTIyOCAyMyAyMCAyM0MxNC40NzcyIDIzIDEwIDI3LjQ3NzIgMTAgMzNIMzBaIiBmaWxsPSJ3aGl0ZSIvPgo8L3N2Zz4K'
                            }
                            alt={trainer.trainer_name}
                            onError={(e) => {
                              e.currentTarget.src = 'data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iNDAiIGhlaWdodD0iNDAiIHZpZXdCb3g9IjAgMCA0MCA0MCIgZmlsbD0ibm9uZSIgeG1sbnM9Imh0dHA6Ly93d3cudzMub3JnLzIwMDAvc3ZnIj4KPGNpcmNsZSBjeD0iMjAiIGN5PSIyMCIgcj0iMjAiIGZpbGw9IiM5Q0EzQUYiLz4KPGNpcmNsZSBjeD0iMjAiIGN5PSIxNSIgcj0iNiIgZmlsbD0id2hpdGUiLz4KPHBhdGggZD0iTTMwIDMzQzMwIDI3LjQ3NzIgMjUuNTIyOCAyMyAyMCAyM0MxNC40NzcyIDIzIDEwIDI3LjQ3NzIgMTAgMzNIMzBaIiBmaWxsPSJ3aGl0ZSIvPgo8L3N2Zz4K';
                            }}
                          />
                        </div>
                        <div className="ml-4">
                          <div className="text-sm font-medium text-gray-900 dark:text-white">{trainer.trainer_name}</div>
                        </div>
                      </div>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap">
                      <div className="text-sm text-gray-900 dark:text-white">{trainer.email}</div>
                      {trainer.secondary_email && (
                        <div className="text-sm text-gray-500 dark:text-gray-400">{trainer.secondary_email}</div>
                      )}
                      <div className="text-sm text-gray-500 dark:text-gray-400">{trainer.telephone || 'N/A'}</div>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500 dark:text-gray-400">{trainer.trainer_type || 'N/A'}</td>
                    <td className="px-6 py-4">
                      {(() => {
                        const areas = Array.isArray(trainer.areas_of_expertise)
                          ? trainer.areas_of_expertise
                          : (typeof trainer.areas_of_expertise === 'string' ? JSON.parse(trainer.areas_of_expertise) : []);
                        return areas.length > 0 ? (
                          <div className="flex items-center gap-1 max-w-[200px]" title={areas.join(', ')}>
                            <span className="px-2 py-0.5 text-xs font-medium rounded-full bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-400 truncate max-w-[150px]">
                              {areas[0]}
                            </span>
                            {areas.length > 1 && (
                              <span className="text-xs text-gray-500 dark:text-gray-400 whitespace-nowrap">+{areas.length - 1} more</span>
                            )}
                          </div>
                        ) : (
                          <span className="text-sm text-gray-500 dark:text-gray-400">N/A</span>
                        );
                      })()}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap">
                      <span className={`px-2 inline-flex text-xs leading-5 font-semibold rounded-full ${getStatusColor(trainer.status)}`}>
                        {trainer.status || 'N/A'}
                      </span>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap">
                      <span className={`px-2 inline-flex text-xs leading-5 font-semibold rounded-full ${getAccountStatusColor(trainer.account_status)}`}>
                        {capitalise(trainer.account_status)}
                      </span>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500 dark:text-gray-400">
                      {trainer.linkedin_url ? (
                        <a
                          href={trainer.linkedin_url.startsWith('http') ? trainer.linkedin_url : `https://${trainer.linkedin_url}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-blue-600 hover:text-blue-800 underline flex items-center gap-1.5"
                        >
                          <Icon name={IconName.Linkedin} className="w-4 h-4" />
                          View
                        </a>
                      ) : (
                        'N/A'
                      )}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500 dark:text-gray-400">
                      {trainer.cv_folder_url ? (
                        <a
                          href={trainer.cv_folder_url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-blue-600 hover:text-blue-800 underline flex items-center gap-1.5"
                        >
                          <Icon name={IconName.Folder} className="w-4 h-4" />
                          Open
                        </a>
                      ) : (
                        'N/A'
                      )}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500 dark:text-gray-400">
                      {trainer.status === 'Active' ? (
                        <Button
                          variant="ghost"
                          onClick={() => handleStatusChange(trainer, 'Inactive')}
                          className="text-red-600 hover:text-red-800 hover:bg-red-50 dark:hover:bg-red-900/20"
                        >
                          <Icon name={IconName.Close} className="w-4 h-4 mr-1" />
                          Deactivate
                        </Button>
                      ) : (
                        <Button
                          variant="ghost"
                          onClick={() => handleStatusChange(trainer, 'Active')}
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
            <h3 className="text-lg font-medium text-gray-900 mb-2 dark:text-white">No trainers found</h3>
            <p className="text-gray-500 mb-6 dark:text-gray-400">
              {trainers.length === 0
                ? "There are no trainers in the system yet."
                : "No trainers match your current search criteria."}
            </p>
          </div>
        )}
      </Card>

      {/* Status Update Confirmation Dialog */}
      {showStatusConfirmation && selectedTrainer && targetStatus && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
          <div className="bg-white dark:bg-gray-800 rounded-lg shadow-xl max-w-md w-full mx-auto">
            <div className="p-6">
              <div className="flex items-center gap-4 mb-4">
                <div className={`w-12 h-12 rounded-full flex items-center justify-center flex-shrink-0 ${targetStatus === 'Active' ? 'bg-green-100 dark:bg-green-900/30' : 'bg-red-100 dark:bg-red-900/30'}`}>
                  <Icon
                    name={targetStatus === 'Active' ? IconName.Check : IconName.Close}
                    className={`w-6 h-6 ${targetStatus === 'Active' ? 'text-green-600 dark:text-green-400' : 'text-red-600 dark:text-red-400'}`}
                  />
                </div>
                <h3 className="text-lg font-semibold text-gray-900 dark:text-white">
                  {targetStatus === 'Active' ? 'Activate' : 'Deactivate'} Trainer
                </h3>
              </div>
              <p className="text-gray-700 dark:text-gray-300 mb-6">
                Are you sure you want to {targetStatus.toLowerCase()} the trainer{' '}
                <strong>"{selectedTrainer.trainer_name}"</strong>?
              </p>
              <div className="flex gap-3 justify-end">
                <Button
                  variant="ghost"
                  onClick={() => { setShowStatusConfirmation(false); setSelectedTrainer(null); setTargetStatus(null); }}
                  disabled={isUpdatingStatus}
                >
                  Cancel
                </Button>
                <Button
                  onClick={confirmStatusUpdate}
                  disabled={isUpdatingStatus}
                  className={`${targetStatus === 'Active' ? 'bg-green-600 hover:bg-green-700 text-white' : 'bg-red-600 hover:bg-red-700 text-white'}`}
                >
                  {isUpdatingStatus ? (
                    <>
                      <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white mr-2"></div>
                      Updating...
                    </>
                  ) : (
                    `${targetStatus === 'Active' ? 'Activate' : 'Deactivate'} Trainer`
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

export default ViewTrainers;
