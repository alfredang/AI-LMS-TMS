import { getApiUrl, getFileUrl } from '@/lib/urlHelpers';
import React, { useState, useEffect } from 'react';
import { Card } from '../ui/Card';
import { Button } from '../ui/Button';
import { Icon, IconName } from '../ui/Icon';
import { useLms } from '@contexts/LmsContext';
import { authService } from '@lib/services/authService';
import { AdminPage } from '@app-types';

interface OngoingClass {
  id: string;
  courseRunId: string;
  courseTitle: string;
  courseCode: string;
  classStatus: string;
  classType: string;
  digitalAttendanceId: string;
  startDate: string;
  endDate: string;
  trainerName: string;
  numOfTrainee: string;
}

interface Statistics {
  ongoingClassesFound: number;
  learnersInSession: number;
  activeTrainers: number;
}

interface ApiResponse {
  success: boolean;
  data: {
    statistics: Statistics;
    classes: OngoingClass[];
    totalCount: number;
    totalPages: number;
    currentPage: number;
    itemsPerPage: number;
  };
}

const StatCard: React.FC<{ title: string; value: string | number }> = ({ title, value }) => (
  <Card className="p-6 text-center">
    <p className="text-4xl font-bold text-blue-600">{value}</p>
    <p className="text-gray-600 dark:text-gray-300 mt-1">{title}</p>
  </Card>
);

interface Trainer {
  trainer_name: string;
}

const OngoingClasses: React.FC = () => {
  const { setAdminPage, setSelectedCourseRunId, setEditingCourseRun, setClassListReturnTo } = useLms();
  const [ongoingClasses, setOngoingClasses] = useState<OngoingClass[]>([]);
  const [statistics, setStatistics] = useState<Statistics>({
    ongoingClassesFound: 0,
    learnersInSession: 0,
    activeTrainers: 0,
  });
  const [trainers, setTrainers] = useState<Trainer[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Search and filter states
  const [searchQuery, setSearchQuery] = useState('');
  const [showAdvancedFilters, setShowAdvancedFilters] = useState(false);
  const [courseTitle, setCourseTitle] = useState('');
  const [courseCode, setCourseCode] = useState('');
  const [courseRunId, setCourseRunId] = useState('');
  const [selectedTrainer, setSelectedTrainer] = useState('');
  const [selectedClassStatus, setSelectedClassStatus] = useState<'all' | 'Confirmed' | 'Pending' | 'Cancelled'>('all');
  const [selectedClassType, setSelectedClassType] = useState<'all' | 'Physical' | 'Virtual' | 'Hybrid'>('all');
  const [selectedCourseType, setSelectedCourseType] = useState<'all' | 'WSQ' | 'IBF' | 'Non-WSQ'>('all');
  const [startDateFrom, setStartDateFrom] = useState('');
  const [endDateUntil, setEndDateUntil] = useState('');

  // Debounced filter values
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [debouncedCourseTitle, setDebouncedCourseTitle] = useState('');
  const [debouncedCourseCode, setDebouncedCourseCode] = useState('');
  const [debouncedCourseRunId, setDebouncedCourseRunId] = useState('');
  const [debouncedStartDate, setDebouncedStartDate] = useState('');
  const [debouncedEndDate, setDebouncedEndDate] = useState('');

  const [currentPage, setCurrentPage] = useState(0);
  const [totalPages, setTotalPages] = useState(1);
  const [total, setTotal] = useState(0);

  const ITEMS_PER_PAGE = 20;

  // Fetch trainers from API
  const fetchTrainers = async () => {
    try {
      console.log('🔄 Fetching trainers...');
      const response = await fetch(getApiUrl('/api/admin/trainers'));
      const result = await response.json();

      console.log('📊 Trainers API response:', result);

      if (result.success) {
        console.log('✅ Trainers loaded:', result.data.trainers.length);
        setTrainers(result.data.trainers);
      } else {
        console.error('❌ Error fetching trainers:', result.message);
      }
    } catch (error) {
      console.error('❌ Error fetching trainers:', error);
    }
  };

  // Fetch ongoing classes from API
  const fetchOngoingClasses = async () => {
    try {
      console.log('🔄 Fetching ongoing classes...');
      setLoading(true);
      const params = new URLSearchParams({
        page: currentPage.toString(),
        limit: ITEMS_PER_PAGE.toString(),
        _t: Date.now().toString(),
      });

      // Add search and filter parameters (use debounced values for text inputs)
      if (debouncedSearch) params.append('search', debouncedSearch);
      if (debouncedCourseTitle) params.append('courseTitle', debouncedCourseTitle);
      if (debouncedCourseCode) params.append('courseCode', debouncedCourseCode);
      if (debouncedCourseRunId) params.append('courseRunId', debouncedCourseRunId);
      if (selectedTrainer) params.append('trainer', selectedTrainer);
      if (selectedClassStatus !== 'all') params.append('classStatus', selectedClassStatus);
      if (selectedClassType !== 'all') params.append('classType', selectedClassType);
      if (selectedCourseType !== 'all') params.append('courseType', selectedCourseType);
      if (debouncedStartDate) params.append('startDateFrom', debouncedStartDate);
      if (debouncedEndDate) params.append('endDateUntil', debouncedEndDate);

      console.log('📝 Query params:', params.toString());

      const authToken = authService.getAuthToken();
      const response = await fetch(getApiUrl(`/api/admin/ongoing-classes?${params}`), {
        method: 'GET',
        headers: {
          'Content-Type': 'application/json',
          ...(authToken && { 'Authorization': `Bearer ${authToken}` }),
        },
      });

      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }

      const data: ApiResponse = await response.json();

      if (data.success) {
        console.log('✅ Ongoing classes loaded:', data.data.classes.length);
        setOngoingClasses(data.data.classes);
        setStatistics(data.data.statistics);
        setTotalPages(data.data.totalPages);
        setTotal(data.data.totalCount);
        setCurrentPage(data.data.currentPage);
        setError(null);
      } else {
        throw new Error('API returned unsuccessful response');
      }
    } catch (error) {
      console.error('Error fetching ongoing classes:', error);
      setError(error instanceof Error ? error.message : 'Failed to fetch ongoing classes');
    } finally {
      setLoading(false);
    }
  };

  // Fetch trainers on mount
  useEffect(() => {
    fetchTrainers();
  }, []);

  // Debounce text filter inputs (300ms) and reset page
  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedSearch(searchQuery);
      setDebouncedCourseTitle(courseTitle);
      setDebouncedCourseCode(courseCode);
      setDebouncedCourseRunId(courseRunId);
      setDebouncedStartDate(startDateFrom);
      setDebouncedEndDate(endDateUntil);
      setCurrentPage(0);
    }, 300);
    return () => clearTimeout(timer);
  }, [searchQuery, courseTitle, courseCode, courseRunId, startDateFrom, endDateUntil]);

  // Reset page immediately for non-debounced filters (dropdowns)
  useEffect(() => {
    setCurrentPage(0);
  }, [selectedTrainer, selectedClassStatus, selectedClassType, selectedCourseType]);

  // Fetch data when debounced filters or pagination change
  useEffect(() => {
    fetchOngoingClasses();
  }, [currentPage, debouncedSearch, debouncedCourseTitle, debouncedCourseCode, debouncedCourseRunId, selectedTrainer, selectedClassStatus, selectedClassType, selectedCourseType, debouncedStartDate, debouncedEndDate]);

  // Date formatting function
  const formatDateInput = (value: string) => {
    const numeric = value.replace(/\D/g, '');
    if (numeric.length <= 2) {
      return numeric;
    } else if (numeric.length <= 4) {
      return `${numeric.slice(0, 2)}/${numeric.slice(2)}`;
    } else {
      return `${numeric.slice(0, 2)}/${numeric.slice(2, 4)}/${numeric.slice(4, 8)}`;
    }
  };

  const handleStartDateChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const formatted = formatDateInput(e.target.value);
    setStartDateFrom(formatted);
  };

  const handleEndDateChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const formatted = formatDateInput(e.target.value);
    setEndDateUntil(formatted);
  };

  const clearFilters = () => {
    setSearchQuery('');
    setCourseTitle('');
    setCourseCode('');
    setCourseRunId('');
    setSelectedTrainer('');
    setSelectedClassStatus('all');
    setSelectedClassType('all');
    setSelectedCourseType('all');
    setStartDateFrom('');
    setEndDateUntil('');
    setCurrentPage(0);
  };

  const handleViewDetails = (classItem: any) => {
    setEditingCourseRun(classItem);
    setSelectedCourseRunId(classItem.courseRunId);
    setClassListReturnTo(AdminPage.OngoingClasses);
    setAdminPage(AdminPage.ClassDetail);
  };

  const handleEditClass = (classItem: OngoingClass) => {
    setClassListReturnTo(AdminPage.OngoingClasses);
    setAdminPage(AdminPage.EditClass);
  };

  const handleDelete = (classId: string, classTitle: string) => {
    if (window.confirm(`Are you sure you want to delete the class "${classTitle}"? This action cannot be undone.`)) {
      console.log('Delete class:', classId);
    }
  };

  const goToPage = (page: number) => {
    if (page >= 0 && page < totalPages) {
      setCurrentPage(page);
    }
  };

  const formatDate = (dateString: string) => {
    if (!dateString) return 'N/A';
    const date = new Date(dateString);
    return date.toLocaleDateString('en-GB');
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'Confirmed':
        return 'bg-green-100 text-green-800';
      case 'Pending':
      case 'In Progress':
        return 'bg-yellow-100 text-yellow-800';
      case 'Cancelled':
        return 'bg-red-100 text-red-800 dark:bg-red-900/50 dark:text-red-200';
      default:
        return 'bg-gray-100 text-gray-800 dark:bg-gray-700 dark:text-gray-300';
    }
  };



  return (
    <div>
      <h2 className="text-3xl font-bold mb-6 dark:text-white">Ongoing Classes</h2>

      {/* Statistics Cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-8">
        <StatCard
          title="Ongoing Classes Found"
          value={statistics.ongoingClassesFound}
        />
        <StatCard
          title="Learners In Session"
          value={statistics.learnersInSession}
        />
        <StatCard
          title="Active Trainers"
          value={statistics.activeTrainers}
        />
      </div>

      <Card className="p-6 dark:bg-gray-800 dark:border-gray-700">
        <p className="text-sm mb-1 dark:text-gray-300">General Search</p>
        {/* Search and Filters */}
        <div className="mb-6">
          <div className="flex flex-col sm:flex-row gap-4 mb-4">
            <div className="flex-1 relative">
              <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                <svg className="w-5 h-5 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                </svg>
              </div>
              <input
                type="text"
                placeholder="Search title..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="w-full pl-10 pr-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 dark:bg-gray-700 dark:border-gray-600 dark:text-white dark:placeholder-gray-400"
              />
            </div>
            <div className="flex gap-2">
              <Button
                variant="primary"
                size="sm"
                onClick={() => setShowAdvancedFilters(!showAdvancedFilters)}
              >
                {showAdvancedFilters ? 'Hide Advanced Filters' : 'Show Advanced Filters'}
              </Button>
              <Button
                variant="ghost"
                size="sm"
                onClick={clearFilters}
              >
                Clear
              </Button>
            </div>
          </div>

          {/* Advanced Filters */}
          {showAdvancedFilters && (
            <div className="bg-gray-50 p-4 rounded-lg space-y-4 dark:bg-gray-700/30">
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Course Title</label>
                  <input
                    type="text"
                    placeholder="Enter course title..."
                    value={courseTitle}
                    onChange={(e) => setCourseTitle(e.target.value)}
                    className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 text-sm dark:bg-gray-700 dark:border-gray-600 dark:text-white"
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Course Code</label>
                  <input
                    type="text"
                    placeholder="Enter course code..."
                    value={courseCode}
                    onChange={(e) => setCourseCode(e.target.value)}
                    className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 text-sm dark:bg-gray-700 dark:border-gray-600 dark:text-white"
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Course Run ID</label>
                  <input
                    type="text"
                    placeholder="Enter run ID..."
                    value={courseRunId}
                    onChange={(e) => setCourseRunId(e.target.value)}
                    className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 text-sm dark:bg-gray-700 dark:border-gray-600 dark:text-white"
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Trainer</label>
                  <select
                    value={selectedTrainer}
                    onChange={(e) => setSelectedTrainer(e.target.value)}
                    className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 text-sm dark:bg-gray-700 dark:border-gray-600 dark:text-white"
                  >
                    <option value="">All Trainers</option>
                    {trainers.map((trainer) => (
                      <option key={trainer.trainer_name} value={trainer.trainer_name}>
                        {trainer.trainer_name}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Class Status</label>
                  <select
                    value={selectedClassStatus}
                    onChange={(e) => setSelectedClassStatus(e.target.value as 'all' | 'Confirmed' | 'Pending' | 'Cancelled')}
                    className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 text-sm dark:bg-gray-700 dark:border-gray-600 dark:text-white"
                  >
                    <option value="all">All</option>
                    <option value="Confirmed">Confirmed</option>
                    <option value="Pending">Pending</option>
                    <option value="Cancelled">Cancelled</option>
                  </select>
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Class Type</label>
                  <select
                    value={selectedClassType}
                    onChange={(e) => setSelectedClassType(e.target.value as 'all' | 'Physical' | 'Virtual' | 'Hybrid')}
                    className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 text-sm dark:bg-gray-700 dark:border-gray-600 dark:text-white"
                  >
                    <option value="all">All</option>
                    <option value="Physical">Physical</option>
                    <option value="Virtual">Virtual</option>
                    <option value="Hybrid">Hybrid</option>
                  </select>
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Course Type</label>
                  <select
                    value={selectedCourseType}
                    onChange={(e) => setSelectedCourseType(e.target.value as 'all' | 'WSQ' | 'IBF' | 'Non-WSQ')}
                    className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 text-sm dark:bg-gray-700 dark:border-gray-600 dark:text-white"
                  >
                    <option value="all">All</option>
                    <option value="WSQ">WSQ</option>
                    <option value="IBF">IBF</option>
                    <option value="Non-WSQ">Non-WSQ</option>
                  </select>
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Start Date (From)</label>
                  <input
                    type="text"
                    placeholder="DD/MM/YYYY"
                    value={startDateFrom}
                    onChange={handleStartDateChange}
                    className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 text-sm dark:bg-gray-700 dark:border-gray-600 dark:text-white"
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">End Date (Until)</label>
                  <input
                    type="text"
                    placeholder="DD/MM/YYYY"
                    value={endDateUntil}
                    onChange={handleEndDateChange}
                    className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 text-sm dark:bg-gray-700 dark:border-gray-600 dark:text-white"
                  />
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Classes Table */}
        {loading ? (
          <div className="text-center py-8">
            <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-500 mx-auto mb-4"></div>
            <p className="text-gray-500 text-lg">Loading ongoing classes...</p>
          </div>
        ) : ongoingClasses.length === 0 ? (
          <div className="text-center py-8">
            <Icon name={IconName.BookOpen} className="w-12 h-12 text-gray-400 mx-auto mb-4" />
            <h3 className="text-lg font-medium text-gray-900 mb-2 dark:text-white">No ongoing classes found</h3>
            <p className="text-gray-500 mb-6 dark:text-gray-400">
              {searchQuery || courseTitle || courseCode || courseRunId || selectedTrainer || startDateFrom || endDateUntil
                ? "No classes match your current search criteria."
                : "There are no ongoing classes in the system yet."}
            </p>
          </div>
        ) : (
          <>
            <div className="overflow-x-auto">
              <table className="divide-y divide-gray-200 dark:divide-gray-700" style={{ tableLayout: 'fixed', width: '1850px' }}>
                <colgroup>
                  <col style={{ width: '90px' }} />
                  <col style={{ width: '420px' }} />
                  <col style={{ width: '160px' }} />
                  <col style={{ width: '110px' }} />
                  <col style={{ width: '100px' }} />
                  <col style={{ width: '110px' }} />
                  <col style={{ width: '110px' }} />
                  <col style={{ width: '80px' }} />
                  <col style={{ width: '200px' }} />
                  <col style={{ width: '200px' }} />
                  <col style={{ width: '70px' }} />
                </colgroup>
                <thead className="bg-gray-50 dark:bg-gray-700/50">
                  <tr className="border-b dark:border-gray-700">
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider whitespace-nowrap">Course Run ID</th>
                    <th className="px-4 py-3 text-center text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider whitespace-nowrap">Course Title</th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider whitespace-nowrap">Course Ref Code</th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider whitespace-nowrap">Class Status</th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider whitespace-nowrap">Class Type</th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider whitespace-nowrap">Start Date</th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider whitespace-nowrap">End Date</th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider whitespace-nowrap">Learners</th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider whitespace-nowrap">Trainer (TPG)</th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider whitespace-nowrap">Trainer (Local)</th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider"></th>
                  </tr>
                </thead>
                <tbody className="bg-white dark:bg-gray-800 divide-y divide-gray-200 dark:divide-gray-700">
                  {ongoingClasses.map((classItem: any, index) => (
                    <tr key={classItem.courseRunId || index} className="border-b dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-700/50">
                      <td className="px-4 py-2 whitespace-nowrap text-sm text-gray-700 dark:text-gray-200">{classItem.courseRunId}</td>
                      <td className="px-4 py-2 text-sm font-medium overflow-hidden text-ellipsis"><button type="button" onClick={() => handleViewDetails(classItem)} className="text-left text-blue-600 dark:text-blue-400 hover:underline">{classItem.courseTitle}</button></td>
                      <td className="px-4 py-2 whitespace-nowrap text-sm text-gray-700 dark:text-gray-200">{classItem.courseCode}</td>
                      <td className="px-4 py-2 whitespace-nowrap text-sm">
                        <select
                          value={classItem.classStatus}
                          onChange={async (e) => {
                            const newStatus = e.target.value;
                            try {
                              await fetch(getApiUrl('/api/admin/ongoing-classes'), {
                                method: 'PUT',
                                headers: { 'Content-Type': 'application/json' },
                                body: JSON.stringify({ id: classItem.id, class_status: newStatus }),
                              });
                              setOngoingClasses(prev => prev.map(c => c.id === classItem.id ? { ...c, classStatus: newStatus } : c));
                            } catch { /* silent */ }
                          }}
                          className={`text-xs font-semibold rounded-full px-2 py-1 border-0 cursor-pointer focus:ring-2 focus:ring-blue-500 ${getStatusColor(classItem.classStatus)}`}
                        >
                          <option value="Confirmed">Confirmed</option>
                          <option value="Pending">Pending</option>
                          <option value="Cancelled">Cancelled</option>
                        </select>
                      </td>
                      <td className="px-4 py-2 whitespace-nowrap text-sm">
                        <span className={`px-2 py-0.5 inline-flex text-xs leading-5 font-semibold rounded-full ${(classItem.classType || 'Physical') === 'Virtual' ? 'bg-blue-100 text-blue-800 dark:bg-blue-900/40 dark:text-blue-300' : (classItem.classType || 'Physical') === 'Hybrid' ? 'bg-purple-100 text-purple-800 dark:bg-purple-900/40 dark:text-purple-300' : 'bg-gray-100 text-gray-700 dark:bg-gray-700 dark:text-gray-300'}`}>{classItem.classType || 'Physical'}</span>
                      </td>
                      <td className="px-4 py-2 whitespace-nowrap text-sm text-gray-700 dark:text-gray-200">{formatDate(classItem.startDate)}</td>
                      <td className="px-4 py-2 whitespace-nowrap text-sm text-gray-700 dark:text-gray-200">{formatDate(classItem.endDate)}</td>
                      <td className="px-4 py-2 whitespace-nowrap text-sm text-center text-gray-700 dark:text-gray-200">{classItem.numOfTrainee}</td>
                      <td className="px-4 py-2 whitespace-nowrap text-sm text-gray-700 dark:text-gray-200">{classItem.assignedTrainerTpg || <span className="text-gray-400">—</span>}</td>
                      <td className="px-4 py-2 whitespace-nowrap text-sm text-gray-700 dark:text-gray-200">{classItem.assignedTrainerLocal || <span className="text-gray-400">—</span>}</td>
                      <td className="px-4 py-2 whitespace-nowrap text-sm font-medium">
                        <Button
                          variant="primary"
                          size="sm"
                          onClick={() => handleViewDetails(classItem)}
                        >
                          <Icon name={IconName.Eye} className="w-4 h-4 mr-1" />
                          View
                        </Button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* Pagination */}
            {totalPages > 1 && (
              <div className="flex justify-between items-center mt-6">
                <p className="text-sm text-gray-500 dark:text-gray-400">
                  Showing {currentPage * ITEMS_PER_PAGE + 1} to {Math.min((currentPage + 1) * ITEMS_PER_PAGE, total)} of {total} classes
                </p>
                <div className="flex items-center gap-1">
                  <Button variant="ghost" size="sm" onClick={() => setCurrentPage(0)} disabled={currentPage === 0}>First</Button>
                  <Button variant="ghost" size="sm" onClick={() => setCurrentPage(currentPage - 1)} disabled={currentPage === 0}>Prev</Button>
                  {(() => {
                    const pages: number[] = [];
                    const maxVisible = 5;
                    let start = Math.max(0, currentPage - Math.floor(maxVisible / 2));
                    let end = Math.min(totalPages - 1, start + maxVisible - 1);
                    if (end - start < maxVisible - 1) start = Math.max(0, end - maxVisible + 1);
                    if (start > 0) pages.push(0);
                    if (start > 1) pages.push(-1);
                    for (let i = start; i <= end; i++) pages.push(i);
                    if (end < totalPages - 2) pages.push(-2);
                    if (end < totalPages - 1) pages.push(totalPages - 1);
                    return pages.map((p, idx) =>
                      p < 0 ? (
                        <span key={`ellipsis-${idx}`} className="px-1 text-gray-400 dark:text-gray-500">...</span>
                      ) : (
                        <button key={p} onClick={() => setCurrentPage(p)} className={`px-3 py-1 text-sm rounded-md ${p === currentPage ? 'bg-blue-600 text-white font-semibold' : 'text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700'}`}>{p + 1}</button>
                      )
                    );
                  })()}
                  <Button variant="ghost" size="sm" onClick={() => setCurrentPage(currentPage + 1)} disabled={currentPage >= totalPages - 1}>Next</Button>
                  <Button variant="ghost" size="sm" onClick={() => setCurrentPage(totalPages - 1)} disabled={currentPage >= totalPages - 1}>Last</Button>
                </div>
              </div>
            )}
          </>
        )}
      </Card>
    </div>
  );
};

export default OngoingClasses;