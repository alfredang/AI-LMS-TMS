import React, { useState, useMemo } from 'react';
import { useLms } from '@contexts/LmsContext';
import { useCourses, useLearnerCourseSearch } from '../hooks/useCourses';
import { useTrainerCourses, useTrainerCourseSearch } from '../hooks/useTrainerCourses';
import { useDeveloperCourses, useDeveloperCourseSearch } from '../hooks/useDeveloperCourses';
import { Card } from '../components/ui/Card';
import { Button } from '../components/ui/Button';
import { EmptyState } from '../components/ui/EmptyState';
import { Icon, IconName } from '../components/ui/Icon';
import { UserRole } from '@app-types';
import EnrolledCourseListItem from './EnrolledCourseListItem';
import { CourseDetail } from './CourseDetail';
import { getCourseImageUrl } from '@utils/imageUtils';

const getTypeColor = (courseType: string) => {
    switch (courseType) {
        case 'WSQ': return 'bg-blue-100 text-blue-800';
        case 'IBF': return 'bg-purple-100 text-purple-800';
        default: return 'bg-gray-100 text-gray-800';
    }
}

const DetailRow: React.FC<{ label: string; value: React.ReactNode }> = ({ label, value }) => (
    <div className="flex justify-between items-start gap-2">
        <p className="font-semibold text-gray-600 flex-shrink-0 dark:text-gray-400">{label}:</p>
        <div className="text-right text-gray-800 dark:text-gray-200">{value}</div>
    </div>
);

const ManagementCourseList: React.FC = () => {
    const { role, currentUser, setSelectedCourse: setContextSelectedCourse, setEditingCourse, setCourseEditMode, loadCourseData } = useLms();

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
    const [showAdvancedFilters, setShowAdvancedFilters] = useState(false);
    const [viewMode, setViewMode] = useState<'block' | 'table'>('block');
    const [selectedCourse, setSelectedCourse] = useState<any>(null);

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

        return relevantCourses.filter(course => {
            const searchLower = searchQuery.toLowerCase();
            const matchesSearch = searchQuery === '' ||
                course.title.toLowerCase().includes(searchLower) ||
                course.courseCode?.toLowerCase().includes(searchLower) ||
                course.tscTitle?.toLowerCase().includes(searchLower) ||
                course.tscCode?.toLowerCase().includes(searchLower);

            const matchesType = filterCourseType === 'All' || course.courseType === filterCourseType;
            const matchesMode = filterMode === 'All' || (course.modeOfLearning && course.modeOfLearning.includes(filterMode));

            // Apply date filtering only for trainers (not for developers)
            const matchesStartDate = (role !== UserRole.Trainer) || isDateInRange(course.startDate, filterStartDate);

            return matchesSearch && matchesType && matchesMode && matchesStartDate;
        });
    }, [relevantCourses, searchQuery, filterCourseType, filterMode, filterStartDate, role]);

    // Handle clear filters
    const handleClearFilters = () => {
        setSearchQuery('');
        setFilterCourseType('All');
        setFilterMode('All');
        setFilterStartDate('All');
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

    const inputClasses = "block w-full px-3 py-2 text-on-surface bg-white border border-gray-300 rounded-md shadow-sm placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-primary focus:border-transparent dark:bg-gray-700 dark:border-gray-600 dark:text-white dark:placeholder-gray-500";

    // Use effect to set course in context when selectedCourse changes
    React.useEffect(() => {
        if (selectedCourse) {
            loadCourseData(selectedCourse);
        }
    }, [selectedCourse, loadCourseData]);

    // If a course is selected, show course detail
    if (selectedCourse) {
        console.log('Selected course for detail view:', selectedCourse);
        console.log('Course run ID:', selectedCourse.courseRunId);

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
            {filteredCourses.map(course => {
                const totalHours = Number(course.trainingHours) + Number(course.assessmentHours);
                console.log('course run info,', course);
                return (
                    <Card key={course.id} className="flex flex-col dark:bg-gray-800 dark:border-gray-700">
                        <img
                            src={getCourseImageUrl(course.imageUrl, course.id)}
                            alt={course.title}
                            className="w-full h-40 object-cover"
                            onError={(e) => {
                                const target = e.target as HTMLImageElement;
                                target.src = `https://picsum.photos/seed/${course.id}/400/200`;
                            }}
                        />
                        <div className="p-6 flex flex-col flex-grow">
                            <h3 className="text-xl font-bold mb-4">{course.title}</h3>

                            {/* New Details Section */}
                            <div className="text-xs space-y-2 mb-4 flex-grow">
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
                                    console.log('🔍 CourseList: View Course clicked for:', {
                                        id: course.id,
                                        title: course.title,
                                        courseCode: course.courseCode,
                                        tscTitle: course.tscTitle,
                                        tscCode: course.tscCode,
                                        courseRunId: course.courseRunId
                                    });
                                    setSelectedCourse(course);
                                    loadCourseData(course);
                                }}>
                                    {role === UserRole.Trainer ? 'View Course' : 'View Course'}
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
        <Card className="p-0 overflow-x-auto dark:bg-gray-800 dark:border-gray-700">
            <table className="min-w-full divide-y divide-gray-200 dark:divide-gray-700">
                <thead className="bg-gray-50 dark:bg-gray-700/50">
                    <tr>
                        <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Course</th>
                        <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Details</th>
                        <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Duration</th>
                        {role === UserRole.Trainer && (
                            <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Course Run ID</th>
                        )}
                        {(role !== UserRole.Developer && role !== UserRole.Admin && role !== UserRole.TrainingProvider) && (
                            <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Start Date</th>
                        )}
                        <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider dark:text-gray-400">Actions</th>
                    </tr>
                </thead>
                <tbody className="bg-white divide-y divide-gray-200 dark:bg-gray-800 dark:divide-gray-700">
                    {filteredCourses.map(course => {
                        const totalHours = Number(course.trainingHours) + Number(course.assessmentHours);
                        return (
                            <tr key={course.id} className="hover:bg-gray-50 dark:hover:bg-gray-700/50">
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
                                            <div className="text-sm font-medium text-gray-900 dark:text-white">{course.title}</div>
                                            <div className="text-sm text-gray-500 dark:text-gray-400">{course.courseCode}</div>
                                        </div>
                                    </div>
                                </td>
                                <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                                    <span className={`font-semibold px-2 py-0.5 rounded-full text-xs ${getTypeColor(course.courseType)}`}>{course.courseType}</span>
                                    <div className="mt-1">{course.modeOfLearning.join(', ')}</div>
                                </td>
                                <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                                    <div>{totalHours} Hours</div>
                                    <div className="text-xs">({course.trainingHours}T + {course.assessmentHours}A)</div>
                                </td>
                                {role === UserRole.Trainer && (
                                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                                        {course.courseRunCode || 'N/A'}
                                    </td>
                                )}
                                {(role !== UserRole.Developer && role !== UserRole.Admin && role !== UserRole.TrainingProvider) && (
                                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
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
                                            console.log('🔍 CourseList: View Course clicked for:', {
                                                id: course.id,
                                                title: course.title,
                                                courseCode: course.courseCode,
                                                tscTitle: course.tscTitle,
                                                tscCode: course.tscCode,
                                                courseRunId: course.courseRunId
                                            });
                                            setSelectedCourse(course);
                                            loadCourseData(course);
                                        }}>
                                            {role === UserRole.Trainer ? 'View Course' : 'View Course'}
                                        </Button>
                                        {(role === UserRole.Developer || role === UserRole.Admin) && (
                                            <Button size="sm" variant="ghost" onClick={() => handleEditCourse(course)} className="!text-blue-600 hover:!bg-blue-50">
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
                    <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-500 mx-auto"></div>
                    <p className="mt-2 text-gray-600">Loading courses...</p>
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
                    className="px-4 py-2 bg-blue-500 text-white rounded hover:bg-blue-600"
                >
                    Retry
                </button>
            </div>
        );
    }

    return (
        <div>
            {/* Search and Filter Controls Card */}
            <Card className="p-6 mb-8 dark:bg-gray-800 dark:border-gray-700">
                <div className="grid grid-cols-1 md:grid-cols-4 gap-4 items-end">
                    <div className="md:col-span-2">
                        <label htmlFor="general-search-courses" className="block text-sm font-medium text-gray-700 dark:text-gray-300">General Search</label>
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
                            <label className="text-sm font-medium text-gray-700 hidden sm:block dark:text-gray-300">View:</label>
                            <div className="flex items-center rounded-md bg-gray-100 p-0.5 border dark:bg-gray-700 dark:border-gray-600">
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
                    <div className="mt-4 pt-4 border-t grid grid-cols-1 md:grid-cols-3 gap-4 items-end dark:border-gray-700">
                        <div>
                            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300">Course Type</label>
                            <select value={filterCourseType} onChange={e => setFilterCourseType(e.target.value as 'WSQ' | 'IBF' | 'Non-WSQ' | 'All')} className={`${inputClasses} mt-1`}>
                                <option value="All">All Types</option>
                                <option value="WSQ">WSQ</option>
                                <option value="IBF">IBF</option>
                                <option value="Non-WSQ">Non-WSQ</option>
                            </select>
                        </div>
                        <div>
                            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300">Mode of Training</label>
                            <select value={filterMode} onChange={e => setFilterMode(e.target.value)} className={`${inputClasses} mt-1`}>
                                <option value="All">All Modes</option>
                                <option value="Hybrid">Hybrid</option>
                                <option value="Virtual">Virtual</option>
                                <option value="Physical">Physical</option>
                            </select>
                        </div>
                        {role === UserRole.Trainer && (
                            <div>
                                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300">Start Date</label>
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

const LearnerCourseList: React.FC = () => {
    const { currentUser } = useLms();
    const { courses, loading, error } = useCourses(currentUser?.id);

    // Search state
    const [searchQuery, setSearchQuery] = useState('');
    const [filterCourseType, setFilterCourseType] = useState<'WSQ' | 'IBF' | 'Non-WSQ' | 'All'>('All');
    const [filterMode, setFilterMode] = useState<string>('All');
    const [showAdvancedFilters, setShowAdvancedFilters] = useState(false);

    // Client-side filtering based on search query and filters
    const filteredCourses = useMemo(() => {
        if (!courses) return [];

        return courses.filter(course => {
            // Search by course title (case-insensitive)
            const matchesSearch = searchQuery === '' ||
                course.title.toLowerCase().includes(searchQuery.toLowerCase());

            // Filter by course type
            const matchesType = filterCourseType === 'All' || course.courseType === filterCourseType;

            // Filter by mode of learning
            const matchesMode = filterMode === 'All' ||
                (course.modeOfLearning && course.modeOfLearning.includes(filterMode));

            return matchesSearch && matchesType && matchesMode;
        });
    }, [courses, searchQuery, filterCourseType, filterMode]);

    // Handle clear filters
    const handleClearFilters = () => {
        setSearchQuery('');
        setFilterCourseType('All');
        setFilterMode('All');
    };

    const inputClasses = "w-full pl-10 pr-4 py-2 text-on-surface bg-surface border border-gray-300 rounded-md placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-primary focus:border-transparent dark:bg-gray-700 dark:border-gray-600 dark:text-white dark:placeholder-gray-400";

    // Check if any filters are active
    const hasActiveFilters = searchQuery !== '' || filterCourseType !== 'All' || filterMode !== 'All';

    if (loading) {
        return (
            <div className="flex items-center justify-center min-h-64">
                <div className="text-center">
                    <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-500 mx-auto"></div>
                    <p className="mt-2 text-gray-600">Loading your courses...</p>
                </div>
            </div>
        );
    }

    if (error) {
        return (
            <div className="text-center py-8">
                <p className="text-red-600 mb-4">Error loading courses: {error}</p>
                <button
                    onClick={() => window.location.reload()}
                    className="px-4 py-2 bg-blue-500 text-white rounded hover:bg-blue-600"
                >
                    Retry
                </button>
            </div>
        );
    }

    // Use filtered courses as enrolled courses
    const enrolledCourses = filteredCourses;

    return (
        <div>
            <div className="flex justify-between items-center mb-6">
                <div>
                    <h2 className="text-3xl font-bold">Courses</h2>
                    <p className="text-subtle mt-1">Continue your learning now</p>
                </div>
                <div className="flex items-center space-x-2">
                    <div className="relative">
                        <Icon name={IconName.Eye} className="w-5 h-5 text-gray-400 absolute left-3 top-1/2 -translate-y-1/2" />
                        <input
                            type="text"
                            placeholder="Search courses..."
                            value={searchQuery}
                            onChange={(e) => setSearchQuery(e.target.value)}
                            className={inputClasses}
                        />
                    </div>
                    {hasActiveFilters && (
                        <Button variant="ghost" onClick={handleClearFilters}>
                            Reset
                        </Button>
                    )}
                </div>
            </div>

            {/* Advanced Filters */}
            {showAdvancedFilters && (
                <Card className="p-4 mb-6 dark:bg-gray-800 dark:border-gray-700">
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        <div>
                            <label className="block text-sm font-medium text-gray-700 mb-1 dark:text-gray-300">Course Type</label>
                            <select
                                value={filterCourseType}
                                onChange={e => setFilterCourseType(e.target.value as 'WSQ' | 'IBF' | 'Non-WSQ' | 'All')}
                                className="w-full px-3 py-2 text-on-surface bg-white border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-2 focus:ring-primary focus:border-transparent dark:bg-gray-700 dark:border-gray-600 dark:text-white"
                            >
                                <option value="All">All Types</option>
                                <option value="WSQ">WSQ</option>
                                <option value="IBF">IBF</option>
                                <option value="Non-WSQ">Non-WSQ</option>
                            </select>
                        </div>
                        <div>
                            <label className="block text-sm font-medium text-gray-700 mb-1 dark:text-gray-300">Mode of Training</label>
                            <select
                                value={filterMode}
                                onChange={e => setFilterMode(e.target.value)}
                                className="w-full px-3 py-2 text-on-surface bg-white border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-2 focus:ring-primary focus:border-transparent dark:bg-gray-700 dark:border-gray-600 dark:text-white"
                            >
                                <option value="All">All Modes</option>
                                <option value="Hybrid">Hybrid</option>
                                <option value="Virtual">Virtual</option>
                                <option value="Physical">Physical</option>
                            </select>
                        </div>
                    </div>
                </Card>
            )}

            <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
                <div className="lg:col-span-3 space-y-4">
                    {enrolledCourses.length === 0 ? (
                        <EmptyState
                            title={hasActiveFilters ? 'No courses match your search criteria' : 'No enrolled courses found'}
                            description={hasActiveFilters ? 'Try adjusting your search or filters' : "You haven't enrolled in any courses yet"}
                            icon={IconName.Courses}
                            className="dark:bg-gray-800 dark:border-gray-700"
                        />
                    ) : (
                        enrolledCourses.map(course => (
                            <EnrolledCourseListItem key={course.id} course={course} />
                        ))
                    )}
                </div>
                {/* <div className="lg:col-span-1">
                    <TrendingCoursesCard />
                </div> */}
            </div>
        </div>
    );
}

const CourseList: React.FC = () => {
    const { role } = useLms();

    if (role === UserRole.Learner) {
        return <LearnerCourseList />;
    }

    // Trainer, Developer, Admin, and TrainingProvider view
    const title = role === UserRole.Trainer ? "My Assigned Classes" : "Course Management";
    return (
        <div>
            <h2 className="text-3xl font-bold mb-6">{title}</h2>
            <ManagementCourseList />
        </div>
    );
};

export default CourseList;