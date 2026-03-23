import React, { useState, useEffect } from 'react';
import { useLms } from '@contexts/LmsContext';
import { Card } from './ui/Card';
import { Button } from './ui/Button';
import { Icon, IconName } from './ui/Icon';
import { AdminPage } from '@app-types';
import { getApiUrl } from '@/lib/urlHelpers';

const getStatusColor = (status: string) => {
    switch (status) {
        case 'Paid':
        case 'Claimed':
        case 'Approved':
        case 'Completed':
        case 'Competent':
        case 'Pass':
        case 'Success':
        case 'Successful':
        case 'Full Payment':
        case 'Confirmed':
            return 'bg-green-100 text-green-800';
        case 'Processing':
        case 'Reschedule':
            return 'bg-blue-100 text-blue-800';
        case 'Pending':
        case 'In Progress':
            return 'bg-yellow-100 text-yellow-800';
        case 'Overdue':
        case 'Rejected':
        case 'Unpaid':
        case 'Not Yet Competent':
        case 'Fail':
        case 'Failed':
        case 'Cancelled':
            return 'bg-red-100 text-red-800 dark:bg-red-900/50 dark:text-red-200';
        default:
            return 'bg-gray-100 text-gray-800 dark:bg-gray-700 dark:text-gray-300';
    }
};

interface UpcomingClass {
    id: string; // UUID of the course run
    courseRunId: string;
    courseTitle: string;
    courseCode: string;
    classStatus: string;
    digitalAttendanceId: string;
    startDate: string;
    endDate: string;
    trainerName: string;
    assignedTrainerName: string;
    assignedTrainerEmail: string;
    numOfTrainee: number;
}

interface Trainer {
    trainer_name: string;
}

interface UpcomingClassesTableProps {
    showTitle?: boolean;
    showFilters?: boolean;
}

export const UpcomingClassesTable: React.FC<UpcomingClassesTableProps> = ({
    showTitle = true,
    showFilters = true
}) => {
    const { setAdminPage, setSelectedCourseRunId, setEditingCourseRun } = useLms();
    const [currentPage, setCurrentPage] = useState(0);
    const [searchQuery, setSearchQuery] = useState('');
    const [showAdvancedFilters, setShowAdvancedFilters] = useState(false);

    // Advanced filter states
    const [courseTitle, setCourseTitle] = useState('');
    const [courseCode, setCourseCode] = useState('');
    const [courseRunId, setCourseRunId] = useState('');
    const [selectedTrainer, setSelectedTrainer] = useState('');
    const [startDateFrom, setStartDateFrom] = useState('');
    const [endDateUntil, setEndDateUntil] = useState('');

    // Data states
    const [upcomingClasses, setUpcomingClasses] = useState<UpcomingClass[]>([]);
    const [trainers, setTrainers] = useState<Trainer[]>([]);
    const [loading, setLoading] = useState(true);
    const [totalCount, setTotalCount] = useState(0);
    const [totalPages, setTotalPages] = useState(0);
    const [stats, setStats] = useState<{ totalClasses: number; totalTrainees: number; totalTrainers: number }>({ totalClasses: 0, totalTrainees: 0, totalTrainers: 0 });

    // Import Run modal states
    const [showImportModal, setShowImportModal] = useState(false);
    const [importRunId, setImportRunId] = useState('');
    const [importLoading, setImportLoading] = useState(false);
    const [importResult, setImportResult] = useState<{ success: boolean; message: string; detail?: string } | null>(null);

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

    // Fetch upcoming classes from API
    const fetchUpcomingClasses = async () => {
        try {
            console.log('🔄 Fetching upcoming classes...');
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

            const response = await fetch(getApiUrl(`/api/admin/upcoming-classes?${params}`));
            const result = await response.json();

            console.log('📊 Upcoming classes API response:', result);

            if (result.success) {
                console.log('✅ Upcoming classes loaded:', result.data.classes.length);
                setUpcomingClasses(result.data.classes);
                setTotalCount(result.data.totalCount);
                setTotalPages(result.data.totalPages);
                if (result.data.stats) setStats(result.data.stats);
            } else {
                console.error('❌ Error fetching upcoming classes:', result.message);
            }
        } catch (error) {
            console.error('❌ Error fetching upcoming classes:', error);
        } finally {
            setLoading(false);
        }
    };

    // Initial data fetch
    useEffect(() => {
        console.log('🚀 UpcomingClassesTable mounted - fetching initial data');
        fetchTrainers();
        fetchUpcomingClasses();
    }, []);

    // Refetch when filters or pagination change
    useEffect(() => {
        fetchUpcomingClasses();
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

    const handleEditClass = (classItem: UpcomingClass) => {
        setEditingCourseRun(classItem);
        setAdminPage(AdminPage.EditClass);
    };

    const handleViewDetails = (courseRunId: string) => {
        setSelectedCourseRunId(courseRunId);
        setAdminPage(AdminPage.ClassDetail);
    };

    const handleDelete = (classId: string, classTitle: string) => {
        if (window.confirm(`Are you sure you want to delete the class "${classTitle}"? This action cannot be undone.`)) {
            console.log('Delete class:', classId);
        }
    };

    const formatDate = (dateString: string) => {
        if (!dateString) return 'N/A';
        return new Date(dateString).toLocaleDateString();
    };

    const handleImportRun = async () => {
        if (!importRunId.trim()) return;
        setImportLoading(true);
        setImportResult(null);
        try {
            const response = await fetch(getApiUrl('/api/admin/import-course-run'), {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ course_run_id: importRunId.trim() }),
            });
            const result = await response.json();
            if (result.success) {
                const { courseTitle, courseRunId: runId, startDate, endDate, action } = result.data;
                setImportResult({
                    success: true,
                    message: `Course run ${action === 'created' ? 'added' : 'updated'} successfully.`,
                    detail: `${courseTitle} (Run ID: ${runId}, ${startDate ?? 'N/A'} → ${endDate ?? 'N/A'})`,
                });
                fetchUpcomingClasses();
            } else {
                setImportResult({ success: false, message: result.error || 'Import failed.' });
            }
        } catch {
            setImportResult({ success: false, message: 'Network error. Please try again.' });
        } finally {
            setImportLoading(false);
        }
    };

    return (
        <div>
            {showTitle && (
                <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 mb-6">
                    <h3 className="text-3xl font-bold dark:text-white">Upcoming Classes</h3>
                    <Button
                        variant="primary"
                        size="sm"
                        onClick={() => { setShowImportModal(true); setImportResult(null); setImportRunId(''); }}
                    >
                        <Icon name={IconName.Add} className="w-4 h-4 mr-2" />
                        Import Course Run
                    </Button>
                </div>
            )}

            {/* KPI Stats */}
            {showTitle && (
                <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-8">
                    <Card className="p-6 text-center">
                        <p className="text-4xl font-bold text-blue-600">{stats.totalClasses}</p>
                        <p className="text-gray-600 dark:text-gray-300 mt-1">Upcoming Classes</p>
                    </Card>
                    <Card className="p-6 text-center">
                        <p className="text-4xl font-bold text-green-600">{stats.totalTrainees}</p>
                        <p className="text-gray-600 dark:text-gray-300 mt-1">Trainees</p>
                    </Card>
                    <Card className="p-6 text-center">
                        <p className="text-4xl font-bold text-purple-600">{stats.totalTrainers}</p>
                        <p className="text-gray-600 dark:text-gray-300 mt-1">Trainers</p>
                    </Card>
                </div>
            )}

            {/* Upcoming Classes Section */}
            <Card className="p-6 dark:bg-gray-800 dark:border-gray-700">
                {showFilters && (
                    <>
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
                                <div className="bg-gray-50 dark:bg-gray-900/50 p-4 rounded-lg space-y-4">

                                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                                        {/* Course Title */}
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

                                        {/* Course Code */}
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

                                        {/* Course Run ID */}
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

                                        {/* Trainer Dropdown */}
                                        <div>
                                            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Trainer</label>
                                            <select
                                                value={selectedTrainer}
                                                onChange={(e) => setSelectedTrainer(e.target.value)}
                                                className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 text-sm dark:bg-gray-700 dark:border-gray-600 dark:text-white"
                                            >
                                                <option value="">Select a trainer...</option>
                                                {trainers.map((trainer, index) => (
                                                    <option key={index} value={trainer.trainer_name}>
                                                        {trainer.trainer_name}
                                                    </option>
                                                ))}
                                            </select>
                                        </div>

                                        {/* Start Date From */}
                                        <div>
                                            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Start Date (From)</label>
                                            <input
                                                type="text"
                                                placeholder="YYYY/MM/DD"
                                                value={startDateFrom}
                                                onChange={handleStartDateChange}
                                                maxLength={10}
                                                className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 text-sm dark:bg-gray-700 dark:border-gray-600 dark:text-white"
                                            />
                                        </div>

                                        {/* End Date Until */}
                                        <div>
                                            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">End Date (Until)</label>
                                            <input
                                                type="text"
                                                placeholder="YYYY/MM/DD"
                                                value={endDateUntil}
                                                onChange={handleEndDateChange}
                                                maxLength={10}
                                                className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 text-sm dark:bg-gray-700 dark:border-gray-600 dark:text-white"
                                            />
                                        </div>
                                    </div>
                                </div>
                            )}
                        </div>
                    </>
                )}

                {/* Classes Table */}
                {loading ? (
                    <div className="text-center py-8">
                        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-500 mx-auto mb-4"></div>
                        <p className="text-gray-500 text-lg">Loading upcoming classes...</p>
                    </div>
                ) : upcomingClasses.length === 0 ? (
                    <div className="text-center py-8">
                        <Icon name={IconName.BookOpen} className="w-12 h-12 text-gray-400 mx-auto mb-4" />
                        <p className="text-gray-500 text-lg">No upcoming classes found</p>
                        <p className="text-gray-400 text-sm mt-2">
                            {searchQuery || courseTitle || courseCode || courseRunId || selectedTrainer || startDateFrom || endDateUntil
                                ? 'Try adjusting your search filters'
                                : 'No classes are scheduled for the future'}
                        </p>
                    </div>
                ) : (
                    <>
                        <div className="overflow-x-auto">
                            <table className="min-w-full divide-y divide-gray-200 dark:divide-gray-700">
                                <thead className="bg-gray-50 dark:bg-gray-700/50">
                                    <tr className="border-b dark:border-gray-700">
                                        <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">COURSE RUN ID</th>
                                        <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">COURSE TITLE</th>
                                        <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">COURSE REF CODE</th>
                                        <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">CLASS STATUS</th>
                                        <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">DA ID</th>
                                        <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">START DATE</th>
                                        <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">END DATE</th>
                                        <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">TRAINER</th>
                                        <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider"># OF TRAINEE</th>
                                        <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">ACTIONS</th>
                                    </tr>
                                </thead>
                                <tbody className="bg-white dark:bg-gray-800 divide-y divide-gray-200 dark:divide-gray-700">
                                    {upcomingClasses.map((classItem, index) => (
                                        <tr key={index} className="border-b dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-700/50">
                                            <td className="px-4 py-4 whitespace-nowrap text-sm text-gray-700 dark:text-gray-200">{classItem.courseRunId}</td>
                                            <td className="px-4 py-4 whitespace-nowrap text-sm font-medium text-gray-900 dark:text-white">{classItem.courseTitle}</td>
                                            <td className="px-4 py-4 whitespace-nowrap text-sm text-gray-700 dark:text-gray-200">{classItem.courseCode}</td>
                                            <td className="px-4 py-4 whitespace-nowrap text-sm">
                                                <span className={`px-2 inline-flex text-xs leading-5 font-semibold rounded-full ${getStatusColor(classItem.classStatus || 'Unknown')}`}>
                                                    {classItem.classStatus}
                                                </span>
                                            </td>
                                            <td className="px-4 py-4 whitespace-nowrap text-sm text-gray-700 dark:text-gray-200">{classItem.digitalAttendanceId || 'N/A'}</td>
                                            <td className="px-4 py-4 whitespace-nowrap text-sm text-gray-700 dark:text-gray-200">{formatDate(classItem.startDate)}</td>
                                            <td className="px-4 py-4 whitespace-nowrap text-sm text-gray-700 dark:text-gray-200">{formatDate(classItem.endDate)}</td>
                                            <td className="px-4 py-4 whitespace-nowrap text-sm text-gray-700 dark:text-gray-200">{classItem.trainerName}</td>
                                            <td className="px-4 py-4 whitespace-nowrap text-sm text-gray-700 dark:text-gray-200 text-center">{classItem.numOfTrainee}</td>
                                            <td className="px-4 py-4 whitespace-nowrap text-sm font-medium">
                                                <div className="flex items-center space-x-2">
                                                    <Button
                                                        size="sm"
                                                        variant="ghost"
                                                        onClick={() => handleViewDetails(classItem.courseRunId)}
                                                    >
                                                        Details
                                                    </Button>
                                                    <Button
                                                        variant="ghost"
                                                        size="sm"
                                                        onClick={() => handleEditClass(classItem)}
                                                        className="!text-blue-600 hover:!bg-blue-50"
                                                    >
                                                        <Icon name={IconName.Edit} className="w-4 h-4 mr-1" />
                                                        Edit
                                                    </Button>
                                                    <Button
                                                        variant="ghost"
                                                        size="sm"
                                                        onClick={() => handleDelete(classItem.courseRunId, classItem.courseTitle)}
                                                        className="!text-red-600 hover:!bg-red-50"
                                                    >
                                                        <Icon name={IconName.Delete} className="w-4 h-4 mr-1" />
                                                        Delete
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
                                <p className="text-sm text-gray-500">
                                    Showing {currentPage * ITEMS_PER_PAGE + 1} to {Math.min((currentPage + 1) * ITEMS_PER_PAGE, totalCount)} of {totalCount} classes
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
        {/* Import Run Modal */}
        {showImportModal && (
            <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
                <div className="bg-white dark:bg-gray-800 rounded-lg shadow-xl w-full max-w-md">
                    <div className="p-6">
                        <h3 className="text-lg font-semibold text-gray-900 dark:text-white mb-1">Import Course Run</h3>
                        <p className="text-sm text-gray-500 dark:text-gray-400 mb-4">
                            Enter a Course Run ID to fetch its details from SSG and save it to the database.
                        </p>

                        <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                            Course Run ID
                        </label>
                        <input
                            type="text"
                            value={importRunId}
                            onChange={e => { setImportRunId(e.target.value); setImportResult(null); }}
                            onKeyDown={e => e.key === 'Enter' && !importLoading && handleImportRun()}
                            placeholder="e.g. 1067907"
                            className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 dark:bg-gray-700 dark:border-gray-600 dark:text-white dark:placeholder-gray-400 mb-4"
                            autoFocus
                        />

                        {/* Result banner */}
                        {importResult && (
                            <div className={`rounded-md p-3 mb-4 text-sm ${importResult.success ? 'bg-green-50 border border-green-200 text-green-800 dark:bg-green-900/20 dark:border-green-700 dark:text-green-300' : 'bg-red-50 border border-red-200 text-red-800 dark:bg-red-900/20 dark:border-red-700 dark:text-red-300'}`}>
                                <p className="font-medium">{importResult.message}</p>
                                {importResult.detail && <p className="mt-1 text-xs opacity-80">{importResult.detail}</p>}
                            </div>
                        )}

                        <div className="flex gap-3 justify-end">
                            <Button
                                variant="ghost"
                                onClick={() => { setShowImportModal(false); setImportRunId(''); setImportResult(null); }}
                                disabled={importLoading}
                            >
                                {importResult?.success ? 'Close' : 'Cancel'}
                            </Button>
                            <Button
                                variant="primary"
                                onClick={handleImportRun}
                                disabled={importLoading || !importRunId.trim()}
                            >
                                {importLoading ? (
                                    <>
                                        <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white mr-2" />
                                        Fetching...
                                    </>
                                ) : 'Import'}
                            </Button>
                        </div>
                    </div>
                </div>
            </div>
        )}
        </div>
    );
};