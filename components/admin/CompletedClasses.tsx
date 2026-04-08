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
  classType: string;
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

interface SyncResult {
  courseRunId: string;
  courseTitle: string;
  ssgEnrolmentsFetched: number;
  ssgEnrolmentsInserted: number;
  errors: string[];
}

const CompletedClasses: React.FC = () => {
  const { setAdminPage, setSelectedCourseRunId, setEditingCourseRun } = useLms();
  const [completedClasses, setCompletedClasses] = useState<CompletedClass[]>([]);
  const [statistics, setStatistics] = useState<Statistics>({
    completedClassesFound: 0,
    totalGraduatedLearners: 0,
    involvedTrainers: 0,
  });
  const [trainers, setTrainers] = useState<Trainer[]>([]);
  const [loading, setLoading] = useState(true);

  // Sync from SSG modal state
  const [showSyncModal, setShowSyncModal] = useState(false);
  const [syncInput, setSyncInput] = useState('');
  const [syncing, setSyncing] = useState(false);
  const [syncResults, setSyncResults] = useState<SyncResult[] | null>(null);
  const [syncSummary, setSyncSummary] = useState<any>(null);
  const [syncError, setSyncError] = useState('');
  const [syncProgress, setSyncProgress] = useState({ completed: 0, total: 0, currentId: '' });

  // Search and filter states
  const [searchQuery, setSearchQuery] = useState('');
  const [showAdvancedFilters, setShowAdvancedFilters] = useState(false);
  const [courseTitle, setCourseTitle] = useState('');
  const [courseCode, setCourseCode] = useState('');
  const [courseRunId, setCourseRunId] = useState('');
  const [selectedTrainer, setSelectedTrainer] = useState('');
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

  // Fetch completed classes from API
  const fetchCompletedClasses = async () => {
    try {
      console.log('🔄 Fetching completed classes...');
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
      if (debouncedStartDate) params.append('startDateFrom', debouncedStartDate);
      if (debouncedEndDate) params.append('endDateUntil', debouncedEndDate);

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
  }, [selectedTrainer]);

  // Fetch data when debounced filters or pagination change
  useEffect(() => {
    fetchCompletedClasses();
  }, [currentPage, debouncedSearch, debouncedCourseTitle, debouncedCourseCode, debouncedCourseRunId, selectedTrainer, debouncedStartDate, debouncedEndDate]);

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
    setStartDateFrom('');
    setEndDateUntil('');
    setCurrentPage(0);
  };

  const parseCourseRunIds = (input: string): string[] => {
    // Extract numeric IDs from any format: comma-separated, newline-separated, spaces, etc.
    const ids = input.match(/\d{6,}/g) || [];
    return [...new Set(ids)]; // deduplicate
  };

  const handleSyncFromSSG = async () => {
    const ids = parseCourseRunIds(syncInput);
    if (ids.length === 0) {
      setSyncError('No valid course run IDs found. Enter numeric IDs (6+ digits).');
      return;
    }

    setSyncing(true);
    setSyncError('');
    setSyncResults(null);
    setSyncSummary(null);
    setSyncProgress({ completed: 0, total: ids.length, currentId: '' });

    const BATCH_SIZE = 5;
    const allResults: SyncResult[] = [];
    const allSkippedExisting: { courseRunId: string; courseTitle: string }[] = [];
    const authToken = authService.getAuthToken();

    try {
      for (let i = 0; i < ids.length; i += BATCH_SIZE) {
        const batch = ids.slice(i, i + BATCH_SIZE);
        setSyncProgress({ completed: i, total: ids.length, currentId: batch[0] });

        const response = await fetch(getApiUrl('/api/admin/sync-completed-classes?app=app1'), {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            ...(authToken && { 'Authorization': `Bearer ${authToken}` }),
          },
          body: JSON.stringify({ courseRunIds: batch }),
        });

        const data = await response.json();

        if (data.success) {
          if (data.results) allResults.push(...data.results);
          if (data.skippedExisting) allSkippedExisting.push(...data.skippedExisting);
          setSyncResults([...allResults]);
        } else {
          setSyncError(data.error || `Batch failed at ID ${batch[0]}`);
          break;
        }
      }

      setSyncProgress({ completed: ids.length, total: ids.length, currentId: '' });

      // Build combined summary
      setSyncSummary({
        alreadyInDb: allSkippedExisting.length,
        pulledFromSsg: allResults.length,
        totalCourseRuns: allResults.length,
        totalEnrolmentsFetched: allResults.reduce((s, r) => s + r.ssgEnrolmentsFetched, 0),
        totalEnrolmentsInserted: allResults.reduce((s, r) => s + r.ssgEnrolmentsInserted, 0),
        skippedExisting: allSkippedExisting,
      });

      // Refresh the table
      fetchCompletedClasses();
    } catch (err) {
      setSyncError(err instanceof Error ? err.message : 'Network error. Please try again.');
    } finally {
      setSyncing(false);
    }
  };

  const closeSyncModal = () => {
    setShowSyncModal(false);
    setSyncInput('');
    setSyncResults(null);
    setSyncSummary(null);
    setSyncError('');
    setSyncProgress({ completed: 0, total: 0, currentId: '' });
  };

  const handleViewDetails = (classItem: any) => {
    setEditingCourseRun(classItem);
    setSelectedCourseRunId(classItem.courseRunId);
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
    return new Date(dateString).toLocaleDateString('en-GB');
  };

  return (
    <div>
      <div className="flex justify-between items-center mb-6">
        <h2 className="text-3xl font-bold dark:text-white">Completed Classes</h2>
        <Button variant="primary" size="sm" onClick={() => setShowSyncModal(true)}>
          Sync from SSG
        </Button>
      </div>

      {/* Sync from SSG Modal */}
      {showSyncModal && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4" onClick={(e) => { if (e.target === e.currentTarget) closeSyncModal(); }}>
          <div className="bg-white dark:bg-gray-800 rounded-lg shadow-xl w-full max-w-2xl max-h-[90vh] overflow-y-auto">
            <div className="p-6">
              <div className="flex justify-between items-center mb-4">
                <h3 className="text-xl font-bold dark:text-white">Sync Course Runs from SSG</h3>
                <button onClick={closeSyncModal} className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 text-2xl leading-none">&times;</button>
              </div>

              <p className="text-sm text-gray-600 dark:text-gray-400 mb-4">
                Enter course run IDs below (comma-separated, one per line, or any format).
                Data will be pulled from SSG API including enrollments, sessions, attendance, and trainer info.
                Only course runs with at least 1 enrollment will be added.
              </p>

              <textarea
                value={syncInput}
                onChange={(e) => setSyncInput(e.target.value)}
                placeholder={"Enter course run IDs, e.g.:\n1322309\n1325270\n1077452"}
                rows={8}
                disabled={syncing}
                className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 text-sm font-mono dark:bg-gray-700 dark:border-gray-600 dark:text-white dark:placeholder-gray-400 disabled:opacity-50"
              />

              <div className="flex justify-between items-center mt-2 mb-4">
                <span className="text-xs text-gray-500 dark:text-gray-400">
                  {parseCourseRunIds(syncInput).length} unique IDs detected
                </span>
              </div>

              {syncError && (
                <div className="bg-red-50 dark:bg-red-900/30 border border-red-200 dark:border-red-800 text-red-700 dark:text-red-300 px-4 py-3 rounded-md mb-4 text-sm">
                  {syncError}
                </div>
              )}

              {/* Progress bar during sync */}
              {syncing && syncProgress.total > 0 && (
                <div className="mb-4">
                  <div className="flex justify-between text-xs text-gray-500 dark:text-gray-400 mb-1">
                    <span>Syncing: {syncProgress.completed} / {syncProgress.total} course runs</span>
                    <span>{Math.round((syncProgress.completed / syncProgress.total) * 100)}%</span>
                  </div>
                  <div className="w-full bg-gray-200 dark:bg-gray-700 rounded-full h-3 overflow-hidden">
                    <div
                      className="bg-blue-600 h-3 rounded-full transition-all duration-500 ease-out"
                      style={{ width: `${Math.max(2, (syncProgress.completed / syncProgress.total) * 100)}%` }}
                    />
                  </div>
                  <p className="text-xs text-gray-400 dark:text-gray-500 mt-1">
                    ~{Math.ceil(((syncProgress.total - syncProgress.completed) / 5) * 30)}s remaining (est.)
                  </p>
                </div>
              )}

              {!syncResults && !syncing && (
                <div className="flex justify-end gap-2">
                  <Button variant="ghost" size="sm" onClick={closeSyncModal}>Cancel</Button>
                  <Button variant="primary" size="sm" onClick={handleSyncFromSSG} disabled={parseCourseRunIds(syncInput).length === 0}>
                    Sync {parseCourseRunIds(syncInput).length} Course Runs
                  </Button>
                </div>
              )}

              {/* Sync Results */}
              {syncSummary && syncResults && (
                <div className="mt-4">
                  <div className="grid grid-cols-4 gap-3 mb-4">
                    <div className="bg-gray-50 dark:bg-gray-700/30 rounded-lg p-3 text-center">
                      <p className="text-lg font-bold text-gray-500">{syncSummary.alreadyInDb || 0}</p>
                      <p className="text-xs text-gray-600 dark:text-gray-400">Already in DB</p>
                    </div>
                    <div className="bg-blue-50 dark:bg-blue-900/30 rounded-lg p-3 text-center">
                      <p className="text-lg font-bold text-blue-600">{syncSummary.pulledFromSsg || syncSummary.totalCourseRuns}</p>
                      <p className="text-xs text-gray-600 dark:text-gray-400">Pulled from SSG</p>
                    </div>
                    <div className="bg-green-50 dark:bg-green-900/30 rounded-lg p-3 text-center">
                      <p className="text-lg font-bold text-green-600">{syncSummary.totalEnrolmentsFetched}</p>
                      <p className="text-xs text-gray-600 dark:text-gray-400">Enrollments Found</p>
                    </div>
                    <div className="bg-purple-50 dark:bg-purple-900/30 rounded-lg p-3 text-center">
                      <p className="text-lg font-bold text-purple-600">{syncSummary.totalEnrolmentsInserted}</p>
                      <p className="text-xs text-gray-600 dark:text-gray-400">New Enrollments</p>
                    </div>
                  </div>

                  <div className="max-h-60 overflow-y-auto border dark:border-gray-700 rounded-md">
                    <table className="w-full text-sm">
                      <thead className="bg-gray-50 dark:bg-gray-700/50 sticky top-0">
                        <tr>
                          <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 dark:text-gray-400">Run ID</th>
                          <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 dark:text-gray-400">Course Title</th>
                          <th className="px-3 py-2 text-center text-xs font-medium text-gray-500 dark:text-gray-400">Enrol</th>
                          <th className="px-3 py-2 text-center text-xs font-medium text-gray-500 dark:text-gray-400">Status</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-gray-200 dark:divide-gray-700">
                        {syncSummary.skippedExisting?.map((s: any) => (
                          <tr key={`existing-${s.courseRunId}`} className="bg-gray-50/50 dark:bg-gray-700/10">
                            <td className="px-3 py-1.5 text-gray-400 dark:text-gray-500 font-mono">{s.courseRunId}</td>
                            <td className="px-3 py-1.5 text-gray-400 dark:text-gray-500 truncate max-w-[200px]">{s.courseTitle}</td>
                            <td className="px-3 py-1.5 text-center text-gray-400 dark:text-gray-500">—</td>
                            <td className="px-3 py-1.5 text-center">
                              <span className="text-gray-400 dark:text-gray-500 text-xs">In DB</span>
                            </td>
                          </tr>
                        ))}
                        {syncResults.map((r) => (
                          <tr key={r.courseRunId} className="hover:bg-gray-50 dark:hover:bg-gray-700/30">
                            <td className="px-3 py-1.5 text-gray-700 dark:text-gray-300 font-mono">{r.courseRunId}</td>
                            <td className="px-3 py-1.5 text-gray-700 dark:text-gray-300 truncate max-w-[200px]">{r.courseTitle}</td>
                            <td className="px-3 py-1.5 text-center text-gray-700 dark:text-gray-300">{r.ssgEnrolmentsFetched}</td>
                            <td className="px-3 py-1.5 text-center">
                              {r.errors.length === 0 ? (
                                <span className="text-green-600 text-xs font-medium">OK</span>
                              ) : (
                                <span className="text-red-500 text-xs" title={r.errors.join(', ')}>Error</span>
                              )}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>

                  <div className="flex justify-end mt-4">
                    <Button variant="primary" size="sm" onClick={closeSyncModal}>Done</Button>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

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
                  {completedClasses.map((classItem: any, index) => (
                    <tr key={classItem.courseRunId || index} className="border-b dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-700/50">
                      <td className="px-4 py-2 whitespace-nowrap text-sm text-gray-700 dark:text-gray-200">{classItem.courseRunId}</td>
                      <td className="px-4 py-2 text-sm font-medium overflow-hidden text-ellipsis"><button type="button" onClick={() => handleViewDetails(classItem)} className="text-left text-blue-600 dark:text-blue-400 hover:underline">{classItem.courseTitle}</button></td>
                      <td className="px-4 py-2 whitespace-nowrap text-sm text-gray-700 dark:text-gray-200">{classItem.courseCode}</td>
                      <td className="px-4 py-2 whitespace-nowrap text-sm">
                        <span className={`px-2 inline-flex text-xs leading-5 font-semibold rounded-full ${
                          classItem.classStatus === 'Confirmed' ? 'bg-green-100 text-green-800' :
                          classItem.classStatus === 'Pending' ? 'bg-yellow-100 text-yellow-800' :
                          classItem.classStatus === 'Cancelled' ? 'bg-red-100 text-red-800 dark:bg-red-900/50 dark:text-red-200' :
                          'bg-gray-100 text-gray-800 dark:bg-gray-700 dark:text-gray-300'
                        }`}>{classItem.classStatus}</span>
                      </td>
                      <td className="px-4 py-2 whitespace-nowrap text-sm text-gray-700 dark:text-gray-200">{classItem.classType || 'Physical'}</td>
                      <td className="px-4 py-2 whitespace-nowrap text-sm text-gray-700 dark:text-gray-200">{formatDate(classItem.startDate)}</td>
                      <td className="px-4 py-2 whitespace-nowrap text-sm text-gray-700 dark:text-gray-200">{formatDate(classItem.endDate)}</td>
                      <td className="px-4 py-2 whitespace-nowrap text-sm text-center text-gray-700 dark:text-gray-200">{classItem.numOfTrainee}</td>
                      <td className="px-4 py-2 whitespace-nowrap text-sm text-gray-700 dark:text-gray-200">{classItem.assignedTrainerTpg || <span className="text-gray-400">—</span>}</td>
                      <td className="px-4 py-2 whitespace-nowrap text-sm text-gray-700 dark:text-gray-200">{classItem.assignedTrainerLocal || <span className="text-gray-400">—</span>}</td>
                      <td className="px-4 py-2 whitespace-nowrap text-sm font-medium">
                        <Button variant="primary" size="sm" onClick={() => handleViewDetails(classItem)}>
                          <Icon name={IconName.Edit} className="w-4 h-4 mr-1" />
                          Details
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
                  {/* First */}
                  <Button variant="ghost" size="sm" onClick={() => setCurrentPage(0)} disabled={currentPage === 0}>
                    First
                  </Button>
                  {/* Previous */}
                  <Button variant="ghost" size="sm" onClick={() => setCurrentPage(currentPage - 1)} disabled={currentPage === 0}>
                    Prev
                  </Button>

                  {/* Page numbers */}
                  {(() => {
                    const pages: number[] = [];
                    const maxVisible = 5;
                    let start = Math.max(0, currentPage - Math.floor(maxVisible / 2));
                    let end = Math.min(totalPages - 1, start + maxVisible - 1);
                    if (end - start < maxVisible - 1) start = Math.max(0, end - maxVisible + 1);

                    if (start > 0) pages.push(0);
                    if (start > 1) pages.push(-1); // ellipsis

                    for (let i = start; i <= end; i++) pages.push(i);

                    if (end < totalPages - 2) pages.push(-2); // ellipsis
                    if (end < totalPages - 1) pages.push(totalPages - 1);

                    return pages.map((p, idx) =>
                      p < 0 ? (
                        <span key={`ellipsis-${idx}`} className="px-1 text-gray-400 dark:text-gray-500">...</span>
                      ) : (
                        <button
                          key={p}
                          onClick={() => setCurrentPage(p)}
                          className={`px-3 py-1 text-sm rounded-md ${
                            p === currentPage
                              ? 'bg-blue-600 text-white font-semibold'
                              : 'text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700'
                          }`}
                        >
                          {p + 1}
                        </button>
                      )
                    );
                  })()}

                  {/* Next */}
                  <Button variant="ghost" size="sm" onClick={() => setCurrentPage(currentPage + 1)} disabled={currentPage >= totalPages - 1}>
                    Next
                  </Button>
                  {/* Last */}
                  <Button variant="ghost" size="sm" onClick={() => setCurrentPage(totalPages - 1)} disabled={currentPage >= totalPages - 1}>
                    Last
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