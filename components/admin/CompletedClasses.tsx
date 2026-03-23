import { getApiUrl, getFileUrl } from '@/lib/urlHelpers';
import React, { useState, useEffect } from 'react';
import { Card } from '../ui/Card';
import { Button } from '../ui/Button';
import { Icon, IconName } from '../ui/Icon';
import { useLms } from '@contexts/LmsContext';
import { authService } from '@lib/services/authService';
import { AdminPage } from '@app-types';

interface CompletedClass {
  courseRunId: string;
  courseTitle: string;
  courseCode: string;
  classStatus: string;
  digitalAttendanceId: string;
  startDate: string;
  endDate: string;
  trainerName: string;
  numOfTrainee: number;
}

interface Statistics {
  completedClassesFound: number;
  totalGraduatedLearners: number;
  involvedTrainers: number;
}

interface ApiResponse {
  success: boolean;
  data: {
    statistics: Statistics;
    classes: CompletedClass[];
    totalCount: number;
    totalPages: number;
    currentPage: number;
    itemsPerPage: number;
  };
}

interface Trainer {
  trainer_name: string;
}

const StatCard: React.FC<{ title: string; value: string | number }> = ({ title, value }) => (
  <Card className="p-6 text-center">
    <p className="text-4xl font-bold text-blue-600">{value}</p>
    <p className="text-gray-600 dark:text-gray-300 mt-1">{title}</p>
  </Card>
);

const CompletedClasses: React.FC = () => {
  const { setAdminPage, setSelectedCourseRunId } = useLms();
  const [completedClasses, setCompletedClasses] = useState<CompletedClass[]>([]);
  const [statistics, setStatistics] = useState<Statistics>({
    completedClassesFound: 0,
    totalGraduatedLearners: 0,
    involvedTrainers: 0,
  });
  const [trainers, setTrainers] = useState<Trainer[]>([]);
  const [loading, setLoading] = useState(true);

  // Search and filter states
  const [searchQuery, setSearchQuery] = useState('');
  const [showAdvancedFilters, setShowAdvancedFilters] = useState(false);
  const [courseTitle, setCourseTitle] = useState('');
  const [courseCode, setCourseCode] = useState('');
  const [courseRunId, setCourseRunId] = useState('');
  const [selectedTrainer, setSelectedTrainer] = useState('');
  const [startDateFrom, setStartDateFrom] = useState('');
  const [endDateUntil, setEndDateUntil] = useState('');

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

  // Fetch completed classes from API
  const fetchCompletedClasses = async () => {
    try {
      console.log('🔄 Fetching completed classes...');
      setLoading(true);
      const params = new URLSearchParams({
        page: currentPage.toString(),
        limit: ITEMS_PER_PAGE.toString(),
      });

      // Add search and filter parameters
      if (searchQuery) params.append('search', searchQuery);
      if (courseTitle) params.append('courseTitle', courseTitle);
      if (courseCode) params.append('courseCode', courseCode);
      if (courseRunId) params.append('courseRunId', courseRunId);
      if (selectedTrainer) params.append('trainer', selectedTrainer);
      if (startDateFrom) params.append('startDateFrom', startDateFrom);
      if (endDateUntil) params.append('endDateUntil', endDateUntil);

      console.log('📝 Query params:', params.toString());

      const authToken = authService.getAuthToken();
      const response = await fetch(getApiUrl(`/api/admin/completed-classes?${params}`), {
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
        console.log('✅ Completed classes loaded:', data.data.classes.length);
        setCompletedClasses(data.data.classes);
        setStatistics(data.data.statistics);
        setTotalPages(data.data.totalPages);
        setTotal(data.data.totalCount);
        setCurrentPage(data.data.currentPage);
      } else {
        throw new Error('API returned unsuccessful response');
      }
    } catch (error) {
      console.error('Error fetching completed classes:', error);
    } finally {
      setLoading(false);
    }
  };

  // Initial data fetch
  useEffect(() => {
    console.log('🚀 CompletedClasses mounted - fetching initial data');
    fetchTrainers();
    fetchCompletedClasses();
  }, []);

  // Refetch when filters or pagination change
  useEffect(() => {
    fetchCompletedClasses();
  }, [currentPage, searchQuery, courseTitle, courseCode, courseRunId, selectedTrainer, startDateFrom, endDateUntil]);

  // Date formatting function
  const formatDateInput = (value: string) => {
    const numeric = value.replace(/\D/g, '');
    if (numeric.length <= 4) {
      return numeric;
    } else if (numeric.length <= 6) {
      return `${numeric.slice(0, 4)}/${numeric.slice(4)}`;
    } else {
      return `${numeric.slice(0, 4)}/${numeric.slice(4, 6)}/${numeric.slice(6, 8)}`;
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
    setStartDateFrom('');
    setEndDateUntil('');
    setCurrentPage(0);
  };

  const handleViewDetails = (courseRunId: string) => {
    setSelectedCourseRunId(courseRunId);
    setAdminPage(AdminPage.ClassDetail);
  };

  const getCompletionRateColor = (rate: number) => {
    if (rate >= 90) return 'text-green-600';
    if (rate >= 70) return 'text-yellow-600';
    return 'text-red-600';
  };

  const getScoreColor = (score: number) => {
    if (score >= 80) return 'text-green-600';
    if (score >= 60) return 'text-yellow-600';
    return 'text-red-600';
  };

  const formatDate = (dateString: string) => {
    if (!dateString) return 'N/A';
    return new Date(dateString).toLocaleDateString();
  };

  return (
    <div>
      <h2 className="text-3xl font-bold mb-6 dark:text-white">Completed Classes</h2>

      {/* Statistics Cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-8">
        <StatCard
          title="Completed Classes Found"
          value={statistics.completedClassesFound}
        />
        <StatCard
          title="Total Graduated Learners"
          value={statistics.totalGraduatedLearners}
        />
        <StatCard
          title="Involved Trainers"
          value={statistics.involvedTrainers}
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
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Start Date (From)</label>
                  <input
                    type="text"
                    placeholder="YYYY/MM/DD"
                    value={startDateFrom}
                    onChange={handleStartDateChange}
                    className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 text-sm dark:bg-gray-700 dark:border-gray-600 dark:text-white"
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">End Date (Until)</label>
                  <input
                    type="text"
                    placeholder="YYYY/MM/DD"
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
            <p className="text-gray-500 text-lg">Loading completed classes...</p>
          </div>
        ) : completedClasses.length === 0 ? (
          <div className="text-center py-8">
            <Icon name={IconName.CheckCircle} className="w-12 h-12 text-gray-400 mx-auto mb-4" />
            <h3 className="text-lg font-medium text-gray-900 mb-2 dark:text-white">No completed classes found</h3>
            <p className="text-gray-500 mb-6 dark:text-gray-400">
              {searchQuery || courseTitle || courseCode || courseRunId || selectedTrainer || startDateFrom || endDateUntil
                ? "No classes match your current search criteria."
                : "There are no completed classes in the system yet."}
            </p>
          </div>
        ) : (
          <>
            <div className="overflow-x-auto">
              <table className="min-w-full divide-y divide-gray-200 dark:divide-gray-700">
                <thead className="bg-gray-50 dark:bg-gray-700/50">
                  <tr className="border-b">
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider dark:text-gray-400">Course Title</th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider dark:text-gray-400">Course Ref Code</th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider dark:text-gray-400">Course Run ID</th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider dark:text-gray-400">Start Date</th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider dark:text-gray-400">End Date</th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider dark:text-gray-400">Trainer</th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider dark:text-gray-400"># of Trainee</th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider dark:text-gray-400">Actions</th>
                  </tr>
                </thead>
                <tbody className="bg-white divide-y divide-gray-200 dark:bg-gray-800 dark:divide-gray-700">
                  {completedClasses.map((classItem, index) => (
                    <tr key={classItem.courseRunId || index} className="hover:bg-gray-50 dark:hover:bg-gray-700/50">
                      <td className="px-4 py-4 whitespace-nowrap text-sm font-medium text-gray-900 dark:text-white">{classItem.courseTitle}</td>
                      <td className="px-4 py-4 whitespace-nowrap text-sm text-gray-700 dark:text-gray-200">{classItem.courseCode}</td>
                      <td className="px-4 py-4 whitespace-nowrap text-sm text-gray-700 dark:text-gray-200">{classItem.courseRunId}</td>
                      <td className="px-4 py-4 whitespace-nowrap text-sm text-gray-700 dark:text-gray-200">{formatDate(classItem.startDate)}</td>
                      <td className="px-4 py-4 whitespace-nowrap text-sm text-gray-700 dark:text-gray-200">{formatDate(classItem.endDate)}</td>
                      <td className="px-4 py-4 whitespace-nowrap text-sm text-gray-700 dark:text-gray-200">{classItem.trainerName}</td>
                      <td className="px-4 py-4 whitespace-nowrap text-sm text-gray-700 text-center dark:text-gray-200">{classItem.numOfTrainee}</td>
                      <td className="px-4 py-4 whitespace-nowrap text-sm font-medium">
                        <div className="flex items-center space-x-2">
                          <Button size="sm" variant="ghost" onClick={() => handleViewDetails(classItem.courseRunId)}>
                            Details
                          </Button>
                        </div>
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
                <div className="flex gap-2">
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => setCurrentPage(Math.max(0, currentPage - 1))}
                    disabled={currentPage === 0}
                  >
                    Previous
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => setCurrentPage(Math.min(totalPages - 1, currentPage + 1))}
                    disabled={currentPage >= totalPages - 1}
                  >
                    Next
                  </Button>
                </div>
              </div>
            )}
          </>
        )}
      </Card>
    </div>
  );
};

export default CompletedClasses;