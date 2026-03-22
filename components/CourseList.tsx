import React, { useState, useMemo, useEffect, useRef } from 'react';
import { useLms } from '@contexts/LmsContext';
import { useCourses, useLearnerCourseSearch } from '../hooks/useCourses';
import { useTrainerCourses, useTrainerCourseSearch } from '../hooks/useTrainerCourses';
import { useDeveloperCourses, useDeveloperCourseSearch } from '../hooks/useDeveloperCourses';
import { Card } from '../components/ui/Card';
import { Button } from '../components/ui/Button';
import { EmptyState } from '../components/ui/EmptyState';
import { Icon, IconName } from '../components/ui/Icon';
import { UserRole, AdminPage } from '@app-types';
import EnrolledCourseListItem from './EnrolledCourseListItem';
import { CourseDetail } from './CourseDetail';
import { getCourseImageUrl } from '@utils/imageUtils';
import { BulkUploadCoursesView } from './admin/BulkUploadCoursesView';

const getTypeColor = (courseType: string) => {
    switch (courseType) {
        case 'WSQ': return 'bg-blue-100 text-blue-800 dark:bg-blue-900/40 dark:text-blue-300';
        case 'IBF': return 'bg-purple-100 text-purple-800 dark:bg-purple-900/40 dark:text-purple-300';
        default: return 'bg-gray-100 text-gray-800 dark:bg-gray-700 dark:text-gray-300';
    }
}

const getModeColor = (mode: string) => {
    switch (mode) {
        case 'Virtual': return 'bg-cyan-100 text-cyan-800 dark:bg-cyan-900/40 dark:text-cyan-300';
        case 'Hybrid': return 'bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300';
        default: return 'bg-green-100 text-green-800 dark:bg-green-900/40 dark:text-green-300';
    }
}

const DetailRow: React.FC<{ label: string; value: React.ReactNode }> = ({ label, value }) => (
    <div className="flex justify-between items-start gap-2">
        <p className="font-semibold text-on-surface-secondary flex-shrink-0">{label}:</p>
        <div className="text-right text-on-surface">{value}</div>
    </div>
);

const ManagementCourseList: React.FC = () => {
    const { role, currentUser, setSelectedCourse: setContextSelectedCourse, setEditingCourse, setCourseEditMode, loadCourseData, setAdminPage } = useLms();

    // Hooks for different user roles
    const { courses: learnerCourses, loading: learnerLoading, error: learnerError } = useCourses(
        role === UserRole.Learner && currentUser?.id ? currentUser.id : undefined
    );
    const { courses: trainerCourses, loading: trainerLoading, error: trainerError } = useTrainerCourses(
        role === UserRole.Trainer && currentUser?.id ? currentUser.id : undefined
    );
    const { courses: developerCourses, loading: developerLoading, error: developerError } = useDeveloperCourses();

    // Search and filter state
    const [searchQuery, setSearchQuery] = useState('');
    const [filterCourseType, setFilterCourseType] = useState<'WSQ' | 'IBF' | 'Non-WSQ' | 'All'>('All');
    const [filterMode, setFilterMode] = useState<string>('All');
    const [filterStartDate, setFilterStartDate] = useState<'All' | 'This Month' | 'Next Month' | 'Last Month' | 'Earlier' | 'Later'>('All');
    const [filterCourseCode, setFilterCourseCode] = useState('');
    const [showAdvancedFilters, setShowAdvancedFilters] = useState(false);
    const [viewMode, setViewMode] = useState<'block' | 'table'>('block');
    const [selectedCourse, setSelectedCourse] = useState<any>(null);
    const [trainerClassView, setTrainerClassView] = useState<'upcoming' | 'past'>('upcoming');

    // Pagination state
    const [currentPage, setCurrentPage] = useState(1);
    const itemsPerPage = 9;

    // Determine which courses to use based on role
    let relevantCourses, currentLoading, currentError;

    switch (role) {
        case UserRole.Trainer:
            relevantCourses = trainerCourses;
            currentLoading = trainerLoading;
            currentError = trainerError;
            break;
        case UserRole.Developer:
        case UserRole.Admin:
        case UserRole.TrainingProvider:
            relevantCourses = developerCourses;
            currentLoading = developerLoading;
            currentError = developerError;
            break;
        default:
            relevantCourses = learnerCourses;
            currentLoading = learnerLoading;
            currentError = learnerError;
    }

    // Helper function to check if a date falls within the selected range
    const isDateInRange = (dateString: string | undefined, range: string): boolean => {
        if (!dateString) return range === 'All';

        const courseDate = new Date(dateString);
        const now = new Date();
        const currentYear = now.getFullYear();
        const currentMonth = now.getMonth();

        // Create date ranges
        const thisMonthStart = new Date(currentYear, currentMonth, 1);
        const thisMonthEnd = new Date(currentYear, currentMonth + 1, 0);

        const nextMonthStart = new Date(currentYear, currentMonth + 1, 1);
        const nextMonthEnd = new Date(currentYear, currentMonth + 2, 0);

        const lastMonthStart = new Date(currentYear, currentMonth - 1, 1);
        const lastMonthEnd = new Date(currentYear, currentMonth, 0);

        switch (range) {
            case 'All':
                return true;
            case 'This Month':
                return courseDate >= thisMonthStart && courseDate <= thisMonthEnd;
            case 'Next Month':
                return courseDate >= nextMonthStart && courseDate <= nextMonthEnd;
            case 'Last Month':
                return courseDate >= lastMonthStart && courseDate <= lastMonthEnd;
            case 'Earlier':
                return courseDate < lastMonthStart;
            case 'Later':
                return courseDate > nextMonthEnd;
            default:
                return true;
        }
    };

    // Client-side filtering for developers/admins (similar to reference implementation)
    const filteredCourses = useMemo(() => {
        if (!relevantCourses) return [];

        const todayDate = new Date(new Date().toDateString());
        const nextWeekDate = new Date(todayDate);
        nextWeekDate.setDate(nextWeekDate.getDate() + 7);

        return relevantCourses.filter(course => {
            const searchLower = searchQuery.toLowerCase();
            const matchesSearch = searchQuery === '' ||
                course.title.toLowerCase().includes(searchLower) ||
                course.courseCode?.toLowerCase().includes(searchLower) ||
                course.tscTitle?.toLowerCase().includes(searchLower) ||
                course.tscCode?.toLowerCase().includes(searchLower);

            const matchesCourseCode = filterCourseCode === '' ||
                course.courseCode?.toLowerCase().includes(filterCourseCode.toLowerCase());

            const matchesType = filterCourseType === 'All' || course.courseType === filterCourseType;
            const matchesMode = filterMode === 'All' || (course.modeOfLearning && course.modeOfLearning.includes(filterMode));

            // Trainer: apply upcoming/past date logic
            if (role === UserRole.Trainer) {
                const end = course.endDate ? new Date(course.endDate) : null;
                const start = course.startDate ? new Date(course.startDate) : null;
                const matchesDateView = trainerClassView === 'past'
                    ? (end !== null && end < todayDate)
                    : ((!end || end >= todayDate) && (!start || start <= nextWeekDate));
                return matchesSearch && matchesCourseCode && matchesType && matchesMode && matchesDateView;
            }

            const matchesStartDate = isDateInRange(course.startDate, filterStartDate);
            return matchesSearch && matchesCourseCode && matchesType && matchesMode && matchesStartDate;
        });
    }, [relevantCourses, searchQuery, filterCourseCode, filterCourseType, filterMode, filterStartDate, role, trainerClassView]);

    // Pagination calculations
    const totalPages = Math.ceil(filteredCourses.length / itemsPerPage);
    const paginatedCourses = useMemo(() => {
        const startIndex = (currentPage - 1) * itemsPerPage;
        return filteredCourses.slice(startIndex, startIndex + itemsPerPage);
    }, [filteredCourses, currentPage, itemsPerPage]);

    // Reset page when filters change
    React.useEffect(() => {
        setCurrentPage(1);
    }, [searchQuery, filterCourseCode, filterCourseType, filterMode, filterStartDate]);

    // Handle clear filters
    const handleClearFilters = () => {
        setSearchQuery('');
        setFilterCourseCode('');
        setFilterCourseType('All');
        setFilterMode('All');
        setFilterStartDate('All');
        setCurrentPage(1);
    };


    // Handle edit course
    const handleEditCourse = async (course: any) => {
        if (!course?.id) return;

        try {
            console.log('🔄 Loading complete course data for editing...');
            const response = await fetch(`/api/courses/edit-data?courseId=${course.id}`);
            const result = await response.json();

            if (result.success && result.data) {
                console.log('✅ Complete course data loaded for editing:', result.data);
                setEditingCourse(result.data);
                setCourseEditMode('edit');
                console.log('✏️ CourseList: Set course edit mode to EDIT for course:', course.id);
            } else {
                console.error('❌ Failed to load course edit data:', result.message);
                alert('Failed to load course data for editing. Please try again.');
            }
        } catch (error) {
            console.error('❌ Error loading course edit data:', error);
            alert('Failed to load course data for editing. Please try again.');
        }
    };

    const inputClasses = "block w-full px-3 py-2 text-on-surface bg-surface border border-default rounded-md shadow-sm placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-primary focus:border-transparent";

    // Use effect to set course in context when selectedCourse changes
    React.useEffect(() => {
        if (selectedCourse) {
            loadCourseData(selectedCourse);
        }
    }, [selectedCourse, loadCourseData]);

    // If a course is selected, show course detail
    if (selectedCourse) {

        return (
            <div>
                <div className="mb-4">
                    <Button variant="ghost" onClick={() => {
                        setSelectedCourse(null);
                        setContextSelectedCourse(null);
                    }} className="flex items-center">
                        <Icon name={IconName.Back} className="w-4 h-4 mr-2" />
                        Back to Course List
                    </Button>
                </div>
                <CourseDetail />
            </div>
        );
    }

    const CourseBlockView = () => (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {paginatedCourses.map(course => {
                const totalHours = Number(course.trainingHours) + Number(course.assessmentHours);
                return (
                    <Card key={course.id} className="flex flex-col bg-surface border-default">
                        <div className="aspect-[16/9] w-full overflow-hidden">
                            <img
                                src={getCourseImageUrl(course.imageUrl, course.id)}
                                alt={course.title}
                                className="w-full h-full object-cover object-center"
                                onError={(e) => {
                                    const target = e.target as HTMLImageElement;
                                    target.src = `https://picsum.photos/seed/${course.id}/400/200`;
                                }}
                            />
                        </div>
                        <div className="p-6 flex flex-col flex-grow">
                            {/* Title with fixed height and line clamp */}
                            <h3 className="text-xl font-bold mb-4 h-14 line-clamp-2 overflow-hidden">{course.title}</h3>

                            {/* Details Section with consistent height */}
                            <div className="text-xs space-y-2 mb-4 flex-grow min-h-[180px]">
                                <DetailRow label="TGS Ref" value={course.courseCode} />
                                <DetailRow label="TSC Title" value={course.tscTitle || 'N/A'} />
                                <DetailRow label="TSC Code" value={course.tscCode || 'N/A'} />
                                <DetailRow label="Course Type" value={
                                    <span className={`font-semibold px-2 py-0.5 rounded-full ${getTypeColor(course.courseType)}`}>
                                        {course.courseType}
                                    </span>
                                } />
                                <DetailRow label="Mode of Training" value={course.modeOfLearning.join(', ')} />
                                <DetailRow label="Course Duration" value={
                                    <div className="flex flex-col items-end">
                                        <span>{totalHours} Hours Total</span>
                                        <span className="text-gray-400 font-normal">
                                            ({course.trainingHours}T + {course.assessmentHours}A)
                                        </span>
                                    </div>
                                } />
                                {role === UserRole.Trainer && course.courseRunId && (
                                    <DetailRow label="Course Run ID" value={course.courseRunCode} />
                                )}
                                {course.startDate && role !== UserRole.Developer && (
                                    <DetailRow label="Start Date" value={
                                        new Date(course.startDate).toLocaleDateString('en-SG', {
                                            year: 'numeric',
                                            month: 'short',
                                            day: 'numeric'
                                        })
                                    } />
                                )}
                            </div>

                            <div className="flex justify-between items-center mt-auto pt-4 border-t">
                                <Button onClick={() => {
                                    setSelectedCourse(course);
                                    loadCourseData(course);
                                }}>
                                    View Course
                                </Button>
                                {(role === UserRole.Developer || role === UserRole.Admin) && (
                                    <button onClick={() => handleEditCourse(course)} className="flex items-center text-subtle font-semibold hover:text-primary transition-colors">
                                        <Icon name={IconName.Edit} className="w-4 h-4 mr-1" />
                                        <span>Edit</span>
                                    </button>
                                )}
                            </div>
                        </div>
                    </Card>
                );
            })}
        </div>
    );

    const CourseTableView = () => (
        <Card className="p-0 overflow-x-auto bg-surface border-default">
            <table className="min-w-full divide-y divide-default">
                <thead className="bg-surface-elevated">
                    <tr>
                        <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-on-surface-secondary uppercase tracking-wider">Course</th>
                        <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-on-surface-secondary uppercase tracking-wider">Details</th>
                        <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-on-surface-secondary uppercase tracking-wider">Duration</th>
                        {role === UserRole.Trainer && (
                            <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-on-surface-secondary uppercase tracking-wider">Course Run ID</th>
                        )}
                        {(role !== UserRole.Developer && role !== UserRole.Admin && role !== UserRole.TrainingProvider) && (
                            <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-on-surface-secondary uppercase tracking-wider">Start Date</th>
                        )}
                        <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-on-surface-secondary uppercase tracking-wider">Actions</th>
                    </tr>
                </thead>
                <tbody className="bg-surface divide-y divide-default">
                    {paginatedCourses.map(course => {
                        const totalHours = Number(course.trainingHours) + Number(course.assessmentHours);
                        return (
                            <tr key={course.id} className="hover:bg-surface-elevated transition-colors">
                                <td className="px-6 py-4 whitespace-nowrap">
                                    <div className="flex items-center">
                                        <div className="flex-shrink-0 h-10 w-10">
                                            <img
                                                className="h-10 w-10 rounded-md object-cover"
                                                src={getCourseImageUrl(course.imageUrl, course.id)}
                                                alt={course.title}
                                                onError={(e) => {
                                                    const target = e.target as HTMLImageElement;
                                                    target.src = `https://picsum.photos/seed/${course.id}/100/100`;
                                                }}
                                            />
                                        </div>
                                        <div className="ml-4">
                                            <div className="text-sm font-medium text-on-surface">{course.title}</div>
                                            <div className="text-sm text-on-surface-secondary">{course.courseCode}</div>
                                        </div>
                                    </div>
                                </td>
                                <td className="px-6 py-4 whitespace-nowrap text-sm text-on-surface-secondary">
                                    <span className={`font-semibold px-2 py-0.5 rounded-full text-xs ${getTypeColor(course.courseType)}`}>{course.courseType}</span>
                                    <div className="mt-1">{course.modeOfLearning.join(', ')}</div>
                                </td>
                                <td className="px-6 py-4 whitespace-nowrap text-sm text-on-surface-secondary">
                                    <div>{totalHours} Hours</div>
                                    <div className="text-xs">({course.trainingHours}T + {course.assessmentHours}A)</div>
                                </td>
                                {role === UserRole.Trainer && (
                                    <td className="px-6 py-4 whitespace-nowrap text-sm text-on-surface-secondary">
                                        {course.courseRunCode || 'N/A'}
                                    </td>
                                )}
                                {(role !== UserRole.Developer && role !== UserRole.Admin && role !== UserRole.TrainingProvider) && (
                                    <td className="px-6 py-4 whitespace-nowrap text-sm text-on-surface-secondary">
                                        {course.startDate ? (
                                            new Date(course.startDate).toLocaleDateString('en-SG', {
                                                year: 'numeric',
                                                month: 'short',
                                                day: 'numeric'
                                            })
                                        ) : (
                                            'Not scheduled'
                                        )}
                                    </td>
                                )}
                                <td className="px-6 py-4 whitespace-nowrap text-sm font-medium">
                                    <div className="flex items-center space-x-2">
                                        <Button size="sm" onClick={() => {
                                            setSelectedCourse(course);
                                            loadCourseData(course);
                                        }}>
                                            View Course
                                        </Button>
                                        {(role === UserRole.Developer || role === UserRole.Admin) && (
                                            <Button size="sm" variant="ghost" onClick={() => handleEditCourse(course)}>
                                                <Icon name={IconName.Edit} className="w-4 h-4 mr-1" />
                                                Edit
                                            </Button>
                                        )}
                                    </div>
                                </td>
                            </tr>
                        );
                    })}
                </tbody>
            </table>
        </Card>
    );

    if (currentLoading) {
        return (
            <div className="flex items-center justify-center min-h-64">
                <div className="text-center">
                    <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary mx-auto"></div>
                    <p className="mt-2 text-on-surface-secondary">Loading courses...</p>
                </div>
            </div>
        );
    }

    if (currentError) {
        return (
            <div className="text-center py-8">
                <p className="text-red-600 mb-4">Error loading courses: {currentError}</p>
                <button
                    onClick={() => window.location.reload()}
                    className="px-4 py-2 bg-primary text-white rounded hover:opacity-90"
                >
                    Retry
                </button>
            </div>
        );
    }

    return (
        <div>

            {/* Upcoming / Past toggle for trainer */}
            {role === UserRole.Trainer && (
                <div className="flex gap-1 p-1 bg-surface rounded-lg w-fit border border-default mb-6">
                    <button
                        onClick={() => { setTrainerClassView('upcoming'); setCurrentPage(1); }}
                        className={`px-4 py-1.5 text-sm font-medium rounded-md transition-colors ${trainerClassView === 'upcoming' ? 'bg-primary text-white shadow-sm' : 'text-gray-400 hover:text-white hover:bg-gray-700/50'}`}
                    >
                        Upcoming
                    </button>
                    <button
                        onClick={() => { setTrainerClassView('past'); setCurrentPage(1); }}
                        className={`px-4 py-1.5 text-sm font-medium rounded-md transition-colors ${trainerClassView === 'past' ? 'bg-primary text-white shadow-sm' : 'text-gray-400 hover:text-white hover:bg-gray-700/50'}`}
                    >
                        Past Classes
                    </button>
                </div>
            )}

            {/* Search and Filter Controls Card */}
            <Card className="p-6 mb-8 bg-surface border-default">
                <div className="grid grid-cols-1 md:grid-cols-4 gap-4 items-end">
                    <div className="md:col-span-2">
                        <label htmlFor="general-search-courses" className="block text-sm font-medium text-on-surface-secondary">General Search</label>
                        <div className="relative mt-1">
                            <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                                <Icon name={IconName.Eye} className="w-5 h-5 text-gray-400" />
                            </div>
                            <input
                                type="text"
                                id="general-search-courses"
                                placeholder="Search title, code, TSC..."
                                value={searchQuery}
                                onChange={e => setSearchQuery(e.target.value)}
                                className={`${inputClasses} pl-10`}
                            />
                        </div>
                    </div>
                    <div className="md:col-span-2 flex justify-end items-center gap-4">
                        <div className="flex items-center gap-2">
                            <label className="text-sm font-medium text-on-surface-secondary hidden sm:block">View:</label>
                            <div className="flex items-center rounded-md bg-surface-elevated p-0.5 border border-default">
                                <button
                                    onClick={() => setViewMode('block')}
                                    className={`p-1.5 rounded-md transition-colors ${viewMode === 'block' ? 'bg-white shadow text-primary dark:bg-gray-600 dark:text-blue-400' : 'text-gray-500 hover:text-gray-800 dark:text-gray-400 dark:hover:text-gray-200'}`}
                                    aria-label="Block view"
                                    aria-pressed={viewMode === 'block'}
                                >
                                    <Icon name={IconName.Eye} className="w-5 h-5" />
                                </button>
                                <button
                                    onClick={() => setViewMode('table')}
                                    className={`p-1.5 rounded-md transition-colors ${viewMode === 'table' ? 'bg-white shadow text-primary dark:bg-gray-600 dark:text-blue-400' : 'text-gray-500 hover:text-gray-800 dark:text-gray-400 dark:hover:text-gray-200'}`}
                                    aria-label="Table view"
                                    aria-pressed={viewMode === 'table'}
                                >
                                    <Icon name={IconName.Menu} className="w-5 h-5" />
                                </button>
                            </div>
                        </div>
                        <Button variant="ghost" onClick={handleClearFilters} className="dark:text-white dark:hover:bg-gray-700">Reset</Button>
                        <Button variant="ghost" onClick={() => setShowAdvancedFilters(!showAdvancedFilters)} className="dark:text-white dark:hover:bg-gray-700">
                            {showAdvancedFilters ? 'Hide' : 'Show'} Filters
                        </Button>
                    </div>
                </div>

                {showAdvancedFilters && (
                    <div className="mt-4 pt-4 border-t border-default grid grid-cols-1 md:grid-cols-3 gap-4 items-end">
                        {role === UserRole.Trainer && (
                            <div>
                                <label className="block text-sm font-medium text-on-surface-secondary">Course Code</label>
                                <input
                                    type="text"
                                    placeholder="e.g. TGS-2022015368"
                                    value={filterCourseCode}
                                    onChange={e => setFilterCourseCode(e.target.value)}
                                    className={`${inputClasses} mt-1`}
                                />
                            </div>
                        )}
                        <div>
                            <label className="block text-sm font-medium text-on-surface-secondary">Course Type</label>
                            <select value={filterCourseType} onChange={e => setFilterCourseType(e.target.value as 'WSQ' | 'IBF' | 'Non-WSQ' | 'All')} className={`${inputClasses} mt-1`}>
                                <option value="All">All Types</option>
                                <option value="WSQ">WSQ</option>
                                <option value="IBF">IBF</option>
                                <option value="Non-WSQ">Non-WSQ</option>
                            </select>
                        </div>
                        <div>
                            <label className="block text-sm font-medium text-on-surface-secondary">Mode of Training</label>
                            <select value={filterMode} onChange={e => setFilterMode(e.target.value)} className={`${inputClasses} mt-1`}>
                                <option value="All">All Modes</option>
                                <option value="Hybrid">Hybrid</option>
                                <option value="Virtual">Virtual</option>
                                <option value="Physical">Physical</option>
                            </select>
                        </div>
                        {role === UserRole.Trainer && (
                            <div>
                                <label className="block text-sm font-medium text-on-surface-secondary">Start Date</label>
                                <select value={filterStartDate} onChange={e => setFilterStartDate(e.target.value as 'All' | 'This Month' | 'Next Month' | 'Last Month' | 'Earlier' | 'Later')} className={`${inputClasses} mt-1`}>
                                    <option value="All">All Dates</option>
                                    <option value="This Month">This Month</option>
                                    <option value="Next Month">Next Month</option>
                                    <option value="Last Month">Last Month</option>
                                    <option value="Earlier">Earlier (Before Last Month)</option>
                                    <option value="Later">Later (After Next Month)</option>
                                </select>
                            </div>
                        )}
                    </div>
                )}
            </Card>

            {/* Course Content */}
            <div>
                {filteredCourses.length > 0 ? (
                    viewMode === 'block' ? <CourseBlockView /> : <CourseTableView />
                ) : (
                    <EmptyState
                        title="No courses found"
                        description={(searchQuery !== '' || filterCourseType !== 'All' || filterMode !== 'All' || (role === UserRole.Trainer && filterStartDate !== 'All'))
                            ? 'No courses match your search criteria.'
                            : 'No courses found.'
                        }
                        icon={IconName.Courses}
                        className="dark:bg-gray-800 dark:border-gray-700"
                    />
                )}
            </div>

            {/* Pagination Controls */}
            {filteredCourses.length > itemsPerPage && (
                <div className="mt-6 flex flex-col sm:flex-row items-center justify-between gap-4">
                    <div className="text-sm text-gray-600 dark:text-gray-400">
                        Showing {((currentPage - 1) * itemsPerPage) + 1} to {Math.min(currentPage * itemsPerPage, filteredCourses.length)} of {filteredCourses.length} courses
                    </div>
                    <div className="flex items-center gap-2">
                        <Button
                            variant="outline"
                            size="sm"
                            onClick={() => setCurrentPage(prev => Math.max(prev - 1, 1))}
                            disabled={currentPage === 1}
                        >
                            <Icon name={IconName.Back} className="w-4 h-4 mr-1" />
                            Previous
                        </Button>
                        <div className="flex items-center gap-1">
                            {Array.from({ length: Math.min(totalPages, 5) }, (_, i) => {
                                let pageNum;
                                if (totalPages <= 5) {
                                    pageNum = i + 1;
                                } else if (currentPage <= 3) {
                                    pageNum = i + 1;
                                } else if (currentPage >= totalPages - 2) {
                                    pageNum = totalPages - 4 + i;
                                } else {
                                    pageNum = currentPage - 2 + i;
                                }
                                return (
                                    <button
                                        key={pageNum}
                                        onClick={() => setCurrentPage(pageNum)}
                                        className={`px-3 py-1 text-sm rounded-md transition-colors ${currentPage === pageNum
                                            ? 'bg-primary text-white'
                                            : 'bg-gray-100 text-gray-700 hover:bg-gray-200 dark:bg-gray-700 dark:text-gray-300 dark:hover:bg-gray-600'
                                            }`}
                                    >
                                        {pageNum}
                                    </button>
                                );
                            })}
                        </div>
                        <Button
                            variant="outline"
                            size="sm"
                            onClick={() => setCurrentPage(prev => Math.min(prev + 1, totalPages))}
                            disabled={currentPage === totalPages}
                        >
                            Next →
                        </Button>
                    </div>
                </div>
            )}
        </div>
    );
};

// const TrendingCoursesCard: React.FC = () => {
//     // For now, show a placeholder since we don't have trending course data
//     const { currentUser } = useLms();
//     const { courses } = useCourses(currentUser?.id);
//     const trending = courses.slice(0, 4); // Show first 4 courses as "trending"

//     return (
//         <Card className="p-6">
//             <h3 className="text-xl font-bold mb-4">Trending Courses</h3>
//             {trending.length === 0 ? (
//                 <p className="text-gray-500">No trending courses available</p>
//             ) : (
//                 <ul className="space-y-2">
//                     {trending.map(course => (
//                         <li key={course.id}>
//                             <a 
//                                 href="#" 
//                                 onClick={(e) => { e.preventDefault(); /* setSelectedCourse(course); */}}
//                                 className="flex justify-between items-center p-2 rounded-md hover:bg-gray-100 group"
//                             >
//                                 <span className="font-semibold text-on-surface group-hover:text-primary">{course.title}</span>
//                                 <svg className="w-5 h-5 text-subtle group-hover:text-primary" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M14 5l7 7m0 0l-7 7m7-7H3" /></svg>
//                             </a>
//                         </li>
//                     ))}
//                 </ul>
//             )}
//         </Card>
//     );
// };

// Sanitize search input to prevent XSS and injection attacks
const sanitizeSearchInput = (input: string): string => {
    return input.replace(/[<>"'`;\\]/g, '').trim();
};

const LearnerCardDetailRow: React.FC<{ label: string; value: React.ReactNode }> = ({ label, value }) => (
    <div className="flex justify-between items-center py-1.5">
        <span className="text-xs text-on-surface-secondary">{label}</span>
        <span className="text-xs font-semibold text-on-surface text-right">{value}</span>
    </div>
);

const CircularProgress: React.FC<{ percent: number; size?: number }> = ({ percent, size = 44 }) => {
    const radius = (size - 6) / 2;
    const circumference = 2 * Math.PI * radius;
    const offset = circumference - (Math.min(percent, 100) / 100) * circumference;
    const isComplete = percent >= 100;
    return (
        <svg width={size} height={size} className="rotate-[-90deg]">
            <circle cx={size / 2} cy={size / 2} r={radius} fill="none" stroke="currentColor" strokeWidth={4} className="text-gray-200 dark:text-gray-600" />
            <circle
                cx={size / 2} cy={size / 2} r={radius} fill="none"
                stroke={isComplete ? '#22c55e' : '#3b82f6'}
                strokeWidth={4} strokeLinecap="round"
                strokeDasharray={circumference} strokeDashoffset={offset}
                className="transition-all duration-500"
            />
        </svg>
    );
};

const LearnerCourseCard: React.FC<{ course: any }> = ({ course }) => {
    const { loadCourseData } = useLms();
    const totalHours = Number(course.trainingHours) + Number(course.assessmentHours);
    const progress = Math.round(course.progressPercent || 0);

    const handleClick = async () => {
        try { await loadCourseData(course); } catch (e) { console.error(e); }
    };

    return (
        <div
            onClick={handleClick}
            className="group bg-surface border border-default rounded-2xl overflow-hidden shadow-sm hover:shadow-xl hover:-translate-y-1 transition-all duration-200 cursor-pointer flex flex-col"
        >
            {/* Course Image */}
            <div className="relative overflow-hidden bg-surface-elevated" style={{ height: '170px' }}>
                <img
                    src={getCourseImageUrl(course.imageUrl, course.id)}
                    alt={course.title}
                    className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
                    onError={(e) => { (e.target as HTMLImageElement).src = `https://picsum.photos/seed/${course.id}/400/200`; }}
                />
            </div>

            {/* Card Body */}
            <div className="p-4 flex flex-col flex-grow">
                {/* Title */}
                <h3 className="font-bold text-sm text-on-surface line-clamp-2 mb-3 leading-snug group-hover:text-primary transition-colors">
                    {course.title}
                </h3>

                {/* Detail Rows */}
                <div className="flex-grow space-y-0">
                    <LearnerCardDetailRow label="Course Code" value={course.courseCode || '—'} />
                    <LearnerCardDetailRow
                        label="Course Duration"
                        value={`${totalHours} Hours (${course.trainingHours}T + ${course.assessmentHours}A)`}
                    />
                    <LearnerCardDetailRow
                        label="Course Type"
                        value={
                            <span className={`px-2 py-0.5 rounded text-xs font-semibold ${getTypeColor(course.courseType)}`}>
                                {course.courseType}
                            </span>
                        }
                    />
                    {(course.courseRunCode || course.courseRunId) && (
                        <LearnerCardDetailRow
                            label="Course Run"
                            value={course.courseRunCode || course.courseRunId}
                        />
                    )}
                </div>

                {/* Footer */}
                <div className="flex items-center justify-between mt-4 pt-3 border-t border-default">
                    <span className="text-sm font-semibold text-primary">View Course</span>
                    <div className="relative flex items-center justify-center flex-shrink-0" title={`${progress}% complete`}>
                        <CircularProgress percent={progress} size={40} />
                        <span className="absolute text-[10px] font-bold text-on-surface">{progress}%</span>
                    </div>
                </div>
            </div>
        </div>
    );
};

const LearnerCourseList: React.FC = () => {
    const { currentUser } = useLms();
    const { courses, loading, error, refetchCourses } = useCourses(currentUser?.id);

    const [searchQuery, setSearchQuery] = useState('');
    const [viewMode, setViewMode] = useState<'grid' | 'list'>('grid');

    // Poll every 30s — refetch if admin changed this learner's enrollments
    const loadedAtRef = useRef(new Date().toISOString());
    useEffect(() => {
        if (!currentUser?.id) return;
        const interval = setInterval(async () => {
            try {
                const res = await fetch(`/api/auth/check-refresh?userId=${currentUser.id}&since=${loadedAtRef.current}`);
                const json = await res.json();
                if (json.refresh) {
                    loadedAtRef.current = new Date().toISOString();
                    refetchCourses();
                }
            } catch { /* silent */ }
        }, 30000);
        return () => clearInterval(interval);
    }, [currentUser?.id, refetchCourses]);

    const handleSearchChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        setSearchQuery(sanitizeSearchInput(e.target.value));
    };

    const filteredCourses = useMemo(() => {
        if (!courses) return [];
        if (searchQuery === '') return courses;
        const q = searchQuery.toLowerCase();
        return courses.filter(course => {
            if (course.title.toLowerCase().includes(q)) return true;
            if (course.courseCode?.toLowerCase().includes(q)) return true;
            // Only match run ID/code if query is at least 3 chars (avoids single digit false matches)
            if (q.length >= 3) {
                if (course.courseRunCode?.toLowerCase().includes(q)) return true;
                if (String(course.courseRunId || '').toLowerCase().includes(q)) return true;
            }
            return false;
        });
    }, [courses, searchQuery]);

    if (loading) {
        return (
            <div className="flex items-center justify-center min-h-64">
                <div className="text-center">
                    <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary mx-auto"></div>
                    <p className="mt-2 text-on-surface-secondary">Loading your courses...</p>
                </div>
            </div>
        );
    }

    if (error) {
        return (
            <div className="text-center py-8">
                <p className="text-red-500 mb-4">Error loading courses: {error}</p>
                <button onClick={() => window.location.reload()} className="px-4 py-2 bg-primary text-white rounded hover:opacity-90">Retry</button>
            </div>
        );
    }

    return (
        <div className="space-y-4">
            {/* Page Header */}
            <h2 className="text-2xl font-bold text-on-surface">My Courses</h2>

            {/* Search + View Toggle */}
            <div className="flex items-center gap-3">
                <div className="relative flex-1">
                    <Icon name={IconName.Search} className="w-4 h-4 text-gray-400 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
                    <input
                        type="text"
                        placeholder="Search by course code, title, or run ID..."
                        value={searchQuery}
                        onChange={handleSearchChange}
                        className="w-full pl-9 pr-9 py-2.5 text-sm text-on-surface bg-surface border border-default rounded-xl placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-primary focus:border-transparent shadow-sm"
                    />
                    {searchQuery && (
                        <button
                            onClick={() => setSearchQuery('')}
                            className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600 dark:hover:text-gray-200"
                            aria-label="Clear search"
                        >
                            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                                <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                            </svg>
                        </button>
                    )}
                </div>
                {/* View toggle */}
                <div className="flex items-center rounded-xl bg-surface border border-default p-0.5 shadow-sm flex-shrink-0">
                    <button
                        onClick={() => setViewMode('grid')}
                        title="Card view"
                        className={`p-2 rounded-lg transition-colors ${viewMode === 'grid' ? 'bg-primary text-white shadow' : 'text-gray-400 hover:text-gray-700 dark:hover:text-gray-200'}`}
                    >
                        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                            <rect x="3" y="3" width="7" height="7" rx="1" /><rect x="14" y="3" width="7" height="7" rx="1" />
                            <rect x="3" y="14" width="7" height="7" rx="1" /><rect x="14" y="14" width="7" height="7" rx="1" />
                        </svg>
                    </button>
                    <button
                        onClick={() => setViewMode('list')}
                        title="List view"
                        className={`p-2 rounded-lg transition-colors ${viewMode === 'list' ? 'bg-primary text-white shadow' : 'text-gray-400 hover:text-gray-700 dark:hover:text-gray-200'}`}
                    >
                        <Icon name={IconName.Menu} className="w-4 h-4" />
                    </button>
                </div>
            </div>

            {/* Results count when searching */}
            {searchQuery && (
                <p className="text-sm text-on-surface-secondary -mt-2">
                    {filteredCourses.length} result{filteredCourses.length !== 1 ? 's' : ''} for &ldquo;{searchQuery}&rdquo;
                </p>
            )}

            {/* Course List */}
            {filteredCourses.length === 0 ? (
                <EmptyState
                    title={searchQuery ? 'No courses match your search' : 'No enrolled courses found'}
                    description={searchQuery ? 'Try a different course code, title, or run ID' : "You haven't enrolled in any courses yet"}
                    icon={IconName.Courses}
                />
            ) : viewMode === 'grid' ? (
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5">
                    {filteredCourses.map(course => (
                        <LearnerCourseCard key={course.id} course={course} />
                    ))}
                </div>
            ) : (
                <div className="space-y-3">
                    {filteredCourses.map(course => (
                        <EnrolledCourseListItem key={course.id} course={course} />
                    ))}
                </div>
            )}
        </div>
    );
}

const CourseList: React.FC = () => {
    const { role, setAdminPage } = useLms();
    const [showBulkUpload, setShowBulkUpload] = useState(false);

    if (role === UserRole.Learner) {
        return <LearnerCourseList />;
    }

    if (showBulkUpload) {
        return <BulkUploadCoursesView onBack={() => setShowBulkUpload(false)} />;
    }

    // Trainer, Developer, Admin, and TrainingProvider view
    const title = role === UserRole.Trainer ? "My Assigned Classes" : "Course Management";
    return (
        <div>
            <div className="flex items-center justify-between mb-6">
                <h2 className="text-3xl font-bold dark:text-white">{title}</h2>
                {role === UserRole.Admin && (
                    <div className="flex items-center gap-3">
                        <Button variant="ghost" onClick={() => setShowBulkUpload(true)} className="border border-blue-500 text-blue-600 hover:bg-blue-50 dark:border-blue-400 dark:text-blue-400 dark:hover:bg-blue-900/20">
                            <Icon name={IconName.Upload} className="w-4 h-4 mr-2" />
                            Bulk Upload Courses
                        </Button>
                        <Button onClick={() => setAdminPage(AdminPage.AddCourse)} leftIcon={<Icon name={IconName.Add} className="w-4 h-4" />}>
                            Add Course
                        </Button>
                    </div>
                )}
            </div>
            <ManagementCourseList />
        </div>
    );
};

export default CourseList;