import { getApiUrl, getFileUrl } from '@/lib/urlHelpers';
import React, { useState, useEffect } from 'react';
import { Card } from '../ui/Card';
import { Button } from '../ui/Button';
import { Icon, IconName } from '../ui/Icon';
import AddTrainerForm from './AddTrainerForm';

interface Trainer {
  trainer_name: string;
  email: string;
  profile_picture: string | null;
  telephone: string | null;
  trainer_type: string | null;
  status: string | null;
  linkedin_url: string | null;
  courses_taught: string | null;
  user_id: string; // Add user_id for status updates
}

const getStatusColor = (status: string | null) => {
  switch (status) {
    case 'Active':
      return 'bg-green-100 text-green-800';
    case 'Inactive':
      return 'bg-gray-100 text-gray-800';
    default:
      return 'bg-yellow-100 text-yellow-800';
  }
};

const ViewTrainers: React.FC = () => {
  const [trainers, setTrainers] = useState<Trainer[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [showAdvancedFilters, setShowAdvancedFilters] = useState(false);
  const [filterName, setFilterName] = useState('');
  const [filterStatus, setFilterStatus] = useState<'All' | 'Active' | 'Inactive'>('All');
  const [filterCourse, setFilterCourse] = useState('');
  const [currentPage, setCurrentPage] = useState(1);
  const [showAddTrainerForm, setShowAddTrainerForm] = useState(false);

  // Status update confirmation states
  const [showStatusConfirmation, setShowStatusConfirmation] = useState(false);
  const [selectedTrainer, setSelectedTrainer] = useState<Trainer | null>(null);
  const [targetStatus, setTargetStatus] = useState<'Active' | 'Inactive' | null>(null);
  const [isUpdatingStatus, setIsUpdatingStatus] = useState(false);

  const itemsPerPage = 10;

  const inputClasses = "w-full px-3 py-2 border border-gray-300 rounded-md focus:ring-2 focus:ring-blue-500 focus:border-transparent dark:bg-gray-700 dark:border-gray-600 dark:text-white dark:placeholder-gray-400";

  const handleResetFilters = () => {
    setSearchQuery('');
    setFilterName('');
    setFilterStatus('All');
    setFilterCourse('');
    setCurrentPage(1);
  };

  const handleAddTrainerSuccess = () => {
    setShowAddTrainerForm(false);
    // Refresh the trainers list
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
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          userId: selectedTrainer.user_id,
          newStatus: targetStatus
        })
      });

      const result = await response.json();

      if (!response.ok || !result.success) {
        throw new Error(result.message || 'Failed to update trainer status');
      }

      console.log('✅ Trainer status updated successfully:', result);
      alert(`Trainer ${targetStatus.toLowerCase()} successfully!`);

      // Refresh the trainers list
      await fetchTrainers();

      // Reset confirmation dialog
      setShowStatusConfirmation(false);
      setSelectedTrainer(null);
      setTargetStatus(null);

    } catch (error) {
      console.error('❌ Failed to update trainer status:', error);
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

      if (data.success) {
        setTrainers(data.data.trainers);
      } else {
        console.error('Failed to fetch trainers:', data.message);
      }
    } catch (error) {
      console.error('Error fetching trainers:', error);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchTrainers();
  }, []);

  const filteredTrainers = trainers.filter(trainer => {
    // General search
    const matchesGeneralSearch = !searchQuery ||
      trainer.trainer_name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      trainer.email.toLowerCase().includes(searchQuery.toLowerCase()) ||
      (trainer.telephone && trainer.telephone.toLowerCase().includes(searchQuery.toLowerCase()));

    // Advanced filters
    const matchesName = !filterName || trainer.trainer_name.toLowerCase().includes(filterName.toLowerCase());

    const matchesStatus = filterStatus === 'All' || trainer.status === filterStatus;

    const matchesCourse = !filterCourse ||
      (trainer.courses_taught && trainer.courses_taught.toLowerCase().includes(filterCourse.toLowerCase()));

    return matchesGeneralSearch && matchesName && matchesStatus && matchesCourse;
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

  // Show Add Trainer Form if requested
  if (showAddTrainerForm) {
    return (
      <AddTrainerForm
        onCancel={() => setShowAddTrainerForm(false)}
        onSuccess={handleAddTrainerSuccess}
      />
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex justify-between items-center">
        <h1 className="text-3xl font-bold text-gray-900 dark:text-white">View Trainers</h1>
        <Button variant="primary" onClick={() => setShowAddTrainerForm(true)}>
          <Icon name={IconName.Add} className="w-4 h-4 mr-2" />
          Add New Trainer
        </Button>
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
              <input type="text" id="general-search" placeholder="Search name, email..." value={searchQuery} onChange={e => setSearchQuery(e.target.value)} className={`${inputClasses} pl-10`} />
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
          <div className="mt-4 pt-4 border-t grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 items-end dark:border-gray-700">
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300">Trainer Name</label>
              <input type="text" value={filterName} onChange={e => setFilterName(e.target.value)} className={`${inputClasses} mt-1`} placeholder="Filter by trainer name..." />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300">Status</label>
              <select value={filterStatus} onChange={e => setFilterStatus(e.target.value as 'All' | 'Active' | 'Inactive')} className={`${inputClasses} mt-1`}>
                <option value="All">All Statuses</option>
                <option value="Active">Active</option>
                <option value="Inactive">Inactive</option>
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300">Associated Course</label>
              <input type="text" value={filterCourse} onChange={e => setFilterCourse(e.target.value)} className={`${inputClasses} mt-1`} placeholder="Search by course keywords..." />
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
                  <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider dark:text-gray-400">Status</th>
                  <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider dark:text-gray-400">LinkedIn Profile</th>
                  <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider dark:text-gray-400">Associated Courses</th>
                  <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider dark:text-gray-400">Action</th>
                </tr>
              </thead>
              <tbody className="bg-white divide-y divide-gray-200 dark:bg-gray-800 dark:divide-gray-700">
                {paginatedTrainers.map((trainer, index) => (
                  <tr key={`${trainer.trainer_name}-${index}`} className="hover:bg-gray-50 dark:hover:bg-gray-700/50">
                    <td className="px-6 py-4 whitespace-nowrap">
                      <div className="flex items-center">
                        <div className="flex-shrink-0 h-10 w-10">
                          {trainer.profile_picture ? (
                            <img
                              className="h-10 w-10 rounded-full object-cover"
                              src={trainer.profile_picture.startsWith('http')
                                ? trainer.profile_picture
                                : getApiUrl(`/api${trainer.profile_picture}`)
                              }
                              alt={trainer.trainer_name}
                              onError={(e) => {
                                console.log('❌ Failed to load image:', trainer.profile_picture);
                                // Set fallback to default user icon on error
                                e.currentTarget.style.display = 'none';
                                e.currentTarget.nextElementSibling?.classList.remove('hidden');
                              }}
                            />
                          ) : (
                            <div className="h-10 w-10 bg-gray-200 rounded-full flex items-center justify-center">
                              <Icon name={IconName.User} className="w-5 h-5 text-gray-500" />
                            </div>
                          )}
                          {/* Fallback icon (hidden by default, shown on image load error) */}
                          <div className="h-10 w-10 bg-gray-200 rounded-full flex items-center justify-center hidden">
                            <Icon name={IconName.User} className="w-5 h-5 text-gray-500" />
                          </div>
                        </div>
                        <div className="ml-4">
                          <div className="text-sm font-medium text-gray-900 dark:text-white">{trainer.trainer_name}</div>
                        </div>
                      </div>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap">
                      <div className="text-sm text-gray-900 dark:text-white">{trainer.email}</div>
                      <div className="text-sm text-gray-500 dark:text-gray-400">{trainer.telephone || 'N/A'}</div>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500 dark:text-gray-400">{trainer.trainer_type || 'N/A'}</td>
                    <td className="px-6 py-4 whitespace-nowrap">
                      <span className={`px-2 inline-flex text-xs leading-5 font-semibold rounded-full ${getStatusColor(trainer.status)}`}>
                        {trainer.status}
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
                      {trainer.courses_taught ? (
                        <ul className="list-disc list-inside space-y-1">
                          {trainer.courses_taught.split(', ').map((course, courseIndex) => (
                            <li key={courseIndex}>{course}</li>
                          ))}
                        </ul>
                      ) : (
                        'None'
                      )}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500 dark:text-gray-400">
                      {trainer.status === 'Active' ? (
                        <Button
                          variant="ghost"
                          onClick={() => handleStatusChange(trainer, 'Inactive')}
                          className="text-red-600 hover:text-red-800 hover:bg-red-50"
                        >
                          <Icon name={IconName.Close} className="w-4 h-4 mr-1" />
                          Deactivate Trainer
                        </Button>
                      ) : (
                        <Button
                          variant="ghost"
                          onClick={() => handleStatusChange(trainer, 'Active')}
                          className="text-green-600 hover:text-green-800 hover:bg-green-50"
                        >
                          <Icon name={IconName.Check} className="w-4 h-4 mr-1" />
                          Activate Trainer
                        </Button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {totalPages > 1 && (
              <div className="p-4 flex justify-between items-center border-t">
                <Button
                  variant="ghost"
                  onClick={() => setCurrentPage(prev => Math.max(1, prev - 1))}
                  disabled={currentPage === 1}
                >
                  Previous
                </Button>
                <span className="text-sm text-gray-500 dark:text-gray-400">
                  Page {currentPage} of {totalPages}
                </span>
                <Button
                  variant="ghost"
                  onClick={() => setCurrentPage(prev => Math.min(totalPages, prev + 1))}
                  disabled={currentPage === totalPages}
                >
                  Next
                </Button>
              </div>
            )}
          </>
        ) : (
          <div className="text-center py-12">
            <Icon name={IconName.User} className="w-16 h-16 text-gray-300 mx-auto mb-4" />
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
          <div className="bg-white rounded-lg shadow-xl max-w-md w-full mx-auto">
            <div className="p-6">
              <div className="flex items-center gap-4 mb-4">
                <div className={`w-12 h-12 rounded-full flex items-center justify-center flex-shrink-0 ${targetStatus === 'Active' ? 'bg-green-100' : 'bg-red-100'
                  }`}>
                  <Icon
                    name={targetStatus === 'Active' ? IconName.Check : IconName.Close}
                    className={`w-6 h-6 ${targetStatus === 'Active' ? 'text-green-600' : 'text-red-600'}`}
                  />
                </div>
                <div>
                  <h3 className="text-lg font-semibold text-gray-900 mb-1">
                    {targetStatus === 'Active' ? 'Activate' : 'Deactivate'} Trainer
                  </h3>
                </div>
              </div>

              <div className="mb-6">
                <p className="text-gray-700 dark:text-gray-300 mb-4">
                  Are you sure you want to {targetStatus.toLowerCase()} the trainer{' '}
                  <strong>"{selectedTrainer.trainer_name}"</strong>?
                </p>
              </div>

              <div className="flex gap-3 justify-end">
                <Button
                  variant="ghost"
                  onClick={() => {
                    setShowStatusConfirmation(false);
                    setSelectedTrainer(null);
                    setTargetStatus(null);
                  }}
                  disabled={isUpdatingStatus}
                >
                  Cancel
                </Button>
                <Button
                  onClick={confirmStatusUpdate}
                  disabled={isUpdatingStatus}
                  className={`${targetStatus === 'Active'
                    ? 'bg-green-600 hover:bg-green-700 text-white'
                    : 'bg-red-600 hover:bg-red-700 text-white'
                    }`}
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