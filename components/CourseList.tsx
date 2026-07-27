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
import { getCourseBannerDataUrl } from '@utils/courseBanner';
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

const HeaderCell: React.FC<{ shortLabel: string; fullLabel?: string }> = ({ shortLabel, fullLabel }) => (
    <span className="inline-block whitespace-nowrap" title={fullLabel || shortLabel}>
        {shortLabel}
    </span>
);

const formatMoney = (value?: string | number | null) => {
    if (value === null || value === undefined || value === '') return '—';
    const numeric = typeof value === 'number' ? value : Number(String(value).replace(/,/g, ''));
    if (Number.isNaN(numeric)) return String(value);
    return new Intl.NumberFormat('en-SG', {
        style: 'currency',
        currency: 'SGD',
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
    }).format(numeric);
};

const formatPercent = (value?: string | number | null) => {
    if (value === null || value === undefined || value === '') return '—';
    const numeric = typeof value === 'number' ? value : Number(String(value).replace(/%/g, '').trim());
    if (Number.isNaN(numeric)) return String(value);
    return `${numeric}%`;
};

const parseMoney = (value?: string | number | null) => {
    if (value === null || value === undefined || value === '') return null;
    const numeric = typeof value === 'number' ? value : Number(String(value).replace(/,/g, ''));
    return Number.isNaN(numeric) ? null : numeric;
};

const computeGstAmount = (
    courseFee?: string | number | null,
    gstRate?: number | null,
    isGstRegistered?: boolean
) => {
    if (!isGstRegistered) return 0;
    const fee = parseMoney(courseFee);
    const rate = typeof gstRate === 'number' ? gstRate : null;
    if (fee === null || rate === null) return null;
    return (fee * rate) / 100;
};

const ManagementCourseList: React.FC = () => {
    const { role, currentUser, trainingProviderProfile, setSelectedCourse: setContextSelectedCourse, setEditingCourse, setCourseEditMode, loadCourseData, setAdminPage, courseListPage, setCourseListPage } = useLms();

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
    const [filterCourseType, setFilterCourseType] = useState<'WSQ' | 'IBF' | 'Non-WSQ' | 'WSQ+IBF' | 'All'>(
        role === UserRole.Admin ? 'WSQ+IBF' : 'All'
    );
    const [filterMode, setFilterMode] = useState<string>('All');
    const [filterStartDate, setFilterStartDate] = useState<'All' | 'This Month' | 'Next Month' | 'Last Month' | 'Earlier' | 'Later'>('All');
    const [filterCourseCode, setFilterCourseCode] = useState('');
    const [showAdvancedFilters, setShowAdvancedFilters] = useState(false);
    const [viewMode, setViewMode] = useState<'block' | 'table'>(role === UserRole.Admin ? 'table' : 'block');
    const [selectedCourse, setSelectedCourse] = useState<any>(null);

    // Persist view mode when it changes
    useEffect(() => {
        const savedViewMode = localStorage.getItem(`managementCourseListViewMode_${role}`);
        if (savedViewMode === 'block' || savedViewMode === 'table') {
            setViewMode(savedViewMode);
        }
    }, [role]);

    const handleViewModeChange = (mode: 'block' | 'table') => {
        setViewMode(mode);
        localStorage.setItem(`managementCourseListViewMode_${role}`, mode);
    };
    const [trainerClassView, setTrainerClassView] = useState<'all' | 'current' | 'upcoming' | 'past'>('all');
    // Default trainer class-status filter: show only Pending + Confirmed runs.
    // Trainers rarely want to see cancelled classes on their dashboard, but
    // they can switch to 'all' or 'Cancelled' from Advanced Filters.
    const [trainerStatusFilter, setTrainerStatusFilter] = useState<'ActiveOnly' | 'all' | 'Confirmed' | 'Pending' | 'Cancelled'>('ActiveOnly');

    // Pagination state - stored in LmsContext so it persists across mount/unmount
    const currentPage = courseListPage;
    const itemsPerPage = 9;

    // Helper: update page param in URL without using Next.js router (avoids re-render loops)
    const syncPageToUrl = (page: number) => {
        const url = new URL(window.location.href);
        if (page > 1) {
            url.searchParams.set('page', String(page));
        } else {
            url.searchParams.delete('page');
        }
        window.history.replaceState(window.history.state, '', url.toString());
    };

    const setCurrentPage = (page: number) => {
        setCourseListPage(page);
        syncPageToUrl(page);
    };

    // On mount: read page from URL (supports direct URL navigation) and sync context → URL
    useEffect(() => {
        const url = new URL(window.location.href);
        const urlPage = url.searchParams.get('page');
        if (urlPage) {
            const parsed = Math.max(1, parseInt(urlPage, 10) || 1);
            if (parsed !== currentPage) {
                setCourseListPage(parsed);
            }
        } else if (currentPage > 1) {
            syncPageToUrl(currentPage);
        }
    }, []);

    // Determine which courses to use based on role
    let relevantCourses, currentLoading, currentError;
    const companyGstRate = trainingProviderProfile?.fundingSettings?.gstRate ?? 9;
    const isCompanyGstRegistered = trainingProviderProfile?.fundingSettings?.isGstRegistered ?? true;

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

        const todayDate = new Date();
        todayDate.setHours(0, 0, 0, 0);

        const parseLocalDate = (dateStr: string | null | undefined) => {
            if (!dateStr) return null;
            const d = new Date(dateStr);
            d.setHours(0, 0, 0, 0);
            return d;
        };

        const nextWeekDate = new Date(todayDate);
        nextWeekDate.setDate(nextWeekDate.getDate() + 7);

        return relevantCourses.filter(course => {
            const searchLower = searchQuery.toLowerCase();
            const matchesSearch = searchQuery === '' ||
                course.title.toLowerCase().includes(searchLower) ||
                course.courseCode?.toLowerCase().includes(searchLower) ||
                course.tscTitle?.toLowerCase().includes(searchLower) ||
                course.tscCode?.toLowerCase().includes(searchLower) ||
                (course.courseRunId && String(course.courseRunId).includes(searchLower)) ||
                (course.courseRunCode && course.courseRunCode.toLowerCase().includes(searchLower)) ||
                ((course as any).courseRunIds?.some((id: string) => String(id).includes(searchLower)));

            const matchesCourseCode = filterCourseCode === '' ||
                course.courseCode?.toLowerCase().includes(filterCourseCode.toLowerCase());

            const matchesType = filterCourseType === 'All' ||
                (filterCourseType === 'WSQ+IBF' ? (course.courseType === 'WSQ' || course.courseType === 'IBF') : course.courseType === filterCourseType);
            const matchesMode = filterMode === 'All' || (
                role === UserRole.Trainer
                    ? (course.classType || 'Physical') === filterMode
                    : (course.modeOfLearning && course.modeOfLearning.includes(filterMode))
            );

            // Trainer: apply date tab logic + class-status filter
            if (role === UserRole.Trainer) {
                const end = parseLocalDate(course.endDate);
                const start = parseLocalDate(course.startDate);
                let matchesDateView = true;
                if (trainerClassView === 'current') {
                    matchesDateView = (start !== null && start <= todayDate) && (end !== null && end >= todayDate);
                } else if (trainerClassView === 'upcoming') {
                    matchesDateView = start !== null && start > todayDate;
                } else if (trainerClassView === 'past') {
                    matchesDateView = end !== null && end < todayDate;
                }
                // Class-status filter. Default is 'ActiveOnly' (Pending + Confirmed),
                // so cancelled runs stay hidden unless the trainer explicitly opts
                // in via the Advanced Filters dropdown.
                const courseStatus = (course.classStatus || '').trim();
                let matchesStatus = true;
                if (trainerStatusFilter === 'ActiveOnly') {
                    matchesStatus = courseStatus === 'Confirmed' || courseStatus === 'Pending';
                } else if (trainerStatusFilter !== 'all') {
                    matchesStatus = courseStatus === trainerStatusFilter;
                }
                return matchesSearch && matchesCourseCode && matchesType && matchesMode && matchesDateView && matchesStatus;
            }

            const matchesStartDate = isDateInRange(course.startDate, filterStartDate);
            return matchesSearch && matchesCourseCode && matchesType && matchesMode && matchesStartDate;
        }).sort((a: any, b: any) => {
            // Sort by course code descending for Admin and Developer
            if (role === UserRole.Admin || role === UserRole.Developer) {
                return (b.courseCode || '').localeCompare(a.courseCode || '');
            }
            if (role === UserRole.Trainer && trainerClassView === 'upcoming') {
                const aStart = parseLocalDate(a.startDate);
                const bStart = parseLocalDate(b.startDate);
                if (aStart && bStart) return aStart.getTime() - bStart.getTime();
                if (aStart) return -1;
                if (bStart) return 1;
                return 0;
            }
            return 0;
        });
    }, [relevantCourses, searchQuery, filterCourseCode, filterCourseType, filterMode, filterStartDate, role, trainerClassView, trainerStatusFilter]);

    // Pagination calculations
    const totalPages = Math.ceil(filteredCourses.length / itemsPerPage);
    const paginatedCourses = useMemo(() => {
        const startIndex = (currentPage - 1) * itemsPerPage;
        return filteredCourses.slice(startIndex, startIndex + itemsPerPage);
    }, [filteredCourses, currentPage, itemsPerPage]);

    // Reset page when filters change (skip initial mount to preserve URL page)
    const isInitialMount = useRef(true);
    React.useEffect(() => {
        if (isInitialMount.current) {
            isInitialMount.current = false;
            return;
        }
        setCurrentPage(1);
    }, [searchQuery, filterCourseCode, filterCourseType, filterMode, filterStartDate]);

    // Handle clear filters
    const handleClearFilters = () => {
        setSearchQuery('');
        setFilterCourseCode('');
        setFilterCourseType(role === UserRole.Admin ? 'WSQ+IBF' : 'All');
        setFilterMode('All');
        setFilterStartDate('All');
        setCurrentPage(1);
    };


    const loadCourseInfo = async (course: any, mode: 'view' | 'edit') => {
        if (!course?.id) return;

        try {
            console.log(`🔄 Loading complete course data for ${mode}...`);
            const response = await fetch(`/api/courses/edit-data?courseId=${course.id}`);
            const result = await response.json();

            if (result.success && result.data) {
                console.log(`✅ Complete course data loaded for ${mode}:`, result.data);
                setEditingCourse(result.data);
                setCourseEditMode(mode);
                console.log(`✏️ CourseList: Set course edit mode to ${mode.toUpperCase()} for course:`, course.id);
            } else {
                console.error('❌ Failed to load course info:', result.message);
                alert('Failed to load course information. Please try again.');
            }
        } catch (error) {
            console.error('❌ Error loading course info:', error);
            alert('Failed to load course information. Please try again.');
        }
    };

    const handleCourseInfo = async (course: any) => {
        await loadCourseInfo(course, 'view');
    };

    const handleEditCourse = async (course: any) => {
        await loadCourseInfo(course, 'edit');
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

    const TrainerCourseCard: React.FC<{ course: any }> = ({ course }) => {
        const totalHours = Number(course.trainingHours) + Number(course.assessmentHours);
        const handleClick = () => {
            setSelectedCourse(course);
            loadCourseData(course);
        };
        return (
            <div
                onClick={handleClick}
                className="group bg-surface border border-default rounded-2xl overflow-hidden shadow-sm hover:shadow-xl hover:-translate-y-1 transition-all duration-200 cursor-pointer flex flex-col"
            >
                <div className="relative overflow-hidden bg-surface-elevated" style={{ height: '170px' }}>
                    <img
                        src={getCourseImageUrl(course.imageUrl, course.id, course.title, { width: 380, height: 170 })}
                        alt={course.title}
                        className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
                        onError={(e) => { (e.target as HTMLImageElement).src = getCourseBannerDataUrl({ width: 380, height: 170, title: course.title }); }}
                    />
                </div>
                <div className="p-4 flex flex-col flex-grow">
                    <h3 className="font-bold text-sm text-on-surface line-clamp-2 mb-3 leading-snug group-hover:text-primary transition-colors">
                        {course.title}
                    </h3>
                    <div className="flex-grow space-y-0">
                        <LearnerCardDetailRow label="Course Code" value={course.courseCode || '—'} />
                        <LearnerCardDetailRow label="Course Duration" value={`${totalHours} Hours (${course.trainingHours}T + ${course.assessmentHours}A)`} />
                        <LearnerCardDetailRow label="Course Type" value={
                            <span className={`px-2 py-0.5 rounded text-xs font-semibold ${getTypeColor(course.courseType)}`}>{course.courseType}</span>
                        } />
                        {(course.courseRunCode || course.courseRunId) && (
                            <LearnerCardDetailRow label="Course Run" value={course.courseRunCode || course.courseRunId} />
                        )}
                        <LearnerCardDetailRow
                            label="Class Type"
                            value={
                                <span className={`px-2 py-0.5 rounded text-xs font-semibold ${
                                    course.classType === 'Virtual' ? 'bg-blue-100 text-blue-800 dark:bg-blue-900/40 dark:text-blue-300'
                                    : course.classType === 'Hybrid' ? 'bg-purple-100 text-purple-800 dark:bg-purple-900/40 dark:text-purple-300'
                                    : course.classType === 'External' ? 'bg-cyan-100 text-cyan-800 dark:bg-cyan-900/40 dark:text-cyan-300'
                                    : 'bg-gray-100 text-gray-700 dark:bg-gray-700 dark:text-gray-300'
                                }`}>
                                    {course.classType || 'Physical'}
                                </span>
                            }
                        />
                        <LearnerCardDetailRow
                            label="Class Status"
                            value={(() => {
                                const status = (course.classStatus || '').toLowerCase();
                                const styleMap: Record<string, string> = {
                                    cancelled: 'bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-300',
                                    pending:   'bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300',
                                    confirmed: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-300',
                                };
                                const style = styleMap[status] || 'bg-gray-100 text-gray-700 dark:bg-gray-700 dark:text-gray-300';
                                return (
                                    <span className={`px-2 py-0.5 rounded text-xs font-semibold ${style}`}>
                                        {course.classStatus || 'N/A'}
                                    </span>
                                );
                            })()}
                        />
                        {course.startDate && (
                            <LearnerCardDetailRow label="Start Date" value={new Date(course.startDate).toLocaleDateString('en-SG', { year: 'numeric', month: 'short', day: 'numeric' })} />
                        )}
                        {course.endDate && (
                            <LearnerCardDetailRow label="End Date" value={new Date(course.endDate).toLocaleDateString('en-SG', { year: 'numeric', month: 'short', day: 'numeric' })} />
                        )}
                    </div>
                    <div className="flex items-center justify-between mt-4 pt-3 border-t border-default">
                        <Button size="sm">View Course</Button>
                    </div>
                </div>
            </div>
        );
    };

    const CourseBlockView = () => (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {paginatedCourses.map(course => {
                if (role === UserRole.Trainer) {
                    return <TrainerCourseCard key={course.id} course={course} />;
                }
                const totalHours = Number(course.trainingHours) + Number(course.assessmentHours);
                return (
                    <Card key={course.id} className="flex flex-col bg-surface border-default">
                        <div className="aspect-[16/9] w-full overflow-hidden">
                            <img
                                src={getCourseImageUrl(course.imageUrl, course.id, course.title, { width: 400, height: 225 })}
                                alt={course.title}
                                className="w-full h-full object-cover object-center"
                                onError={(e) => {
                                    const target = e.target as HTMLImageElement;
                                    target.src = getCourseBannerDataUrl({ width: 400, height: 225, title: course.title });
                                }}
                            />
                        </div>
                        <div className="p-6 flex flex-col flex-grow">
                            <h3 className="text-xl font-bold mb-4 h-14 line-clamp-2 overflow-hidden">{course.title}</h3>

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
                                {(() => {
                                    if (!course.fundingValidity) return <DetailRow label="Funding Validity" value="N/A" />;
                                    const expiry = new Date(course.fundingValidity);
                                    const isExpired = expiry < new Date();
                                    return (
                                        <DetailRow label="Funding Validity" value={
                                            <span className={`font-semibold px-2 py-0.5 rounded-full text-xs ${isExpired ? 'bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-300' : 'bg-green-100 text-green-800 dark:bg-green-900/40 dark:text-green-300'}`}>
                                                {expiry.toLocaleDateString('en-SG', { year: 'numeric', month: 'short', day: 'numeric' })} {isExpired ? '· Expired' : '· Valid'}
                                            </span>
                                        } />
                                    );
                                })()}
                                <DetailRow label="Course Duration" value={
                                    <div className="flex flex-col items-end">
                                        <span>{totalHours} Hours Total</span>
                                        <span className="text-gray-400 font-normal">
                                            ({course.trainingHours}T + {course.assessmentHours}A)
                                        </span>
                                    </div>
                                } />
                                {(role === UserRole.Admin || role === UserRole.TrainingProvider) && (
                                    <>
                                        <DetailRow label="Schedule ID" value={course.scheduleId || '—'} />
                                        <DetailRow label="Course Fee" value={formatMoney(course.courseFeesExcludeGst)} />
                                        <DetailRow label="GST" value={formatMoney(computeGstAmount(course.courseFeesExcludeGst, companyGstRate, isCompanyGstRegistered))} />
                                        <DetailRow label="Course Fee (incl. GST)" value={formatMoney(course.courseFeesIncludeGst)} />
                                        <DetailRow label="After Normal Funding" value={formatMoney(course.afterNormalFunding)} />
                                        <DetailRow label="After MCES Funding" value={formatMoney(course.afterMcesFunding)} />
                                        <DetailRow label="UTAP" value={
                                            <input
                                                type="checkbox"
                                                checked={!!course.isUtapEligible}
                                                readOnly
                                                disabled
                                                className="h-4 w-4 rounded border-gray-300 text-blue-600 disabled:opacity-100 disabled:cursor-default"
                                            />
                                        } />
                                    </>
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
                                        <span>Edit Course</span>
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
                        <th scope="col" className="px-4 py-3 text-left text-xs font-medium text-on-surface-secondary uppercase tracking-wider"><HeaderCell shortLabel="Course" /></th>
                        <th scope="col" className="px-4 py-3 text-left text-xs font-medium text-on-surface-secondary uppercase tracking-wider"><HeaderCell shortLabel="Types" /></th>
                        <th scope="col" className="px-4 py-3 text-left text-xs font-medium text-on-surface-secondary uppercase tracking-wider"><HeaderCell shortLabel="Duration" /></th>
                        {(role === UserRole.Admin || role === UserRole.TrainingProvider) && (
                            <th scope="col" className="px-4 py-3 text-left text-xs font-medium text-on-surface-secondary uppercase tracking-wider"><HeaderCell shortLabel="Schedule ID" /></th>
                        )}
                        {(role === UserRole.Admin || role === UserRole.TrainingProvider) && (
                            <th scope="col" className="px-4 py-3 text-left text-xs font-medium text-on-surface-secondary uppercase tracking-wider"><HeaderCell shortLabel="Course Fee" /></th>
                        )}
                        {(role === UserRole.Admin || role === UserRole.TrainingProvider) && (
                            <th scope="col" className="px-4 py-3 text-left text-xs font-medium text-on-surface-secondary uppercase tracking-wider"><HeaderCell shortLabel="GST" /></th>
                        )}
                        {(role === UserRole.Admin || role === UserRole.TrainingProvider) && (
                            <th scope="col" className="px-4 py-3 text-left text-xs font-medium text-on-surface-secondary uppercase tracking-wider"><HeaderCell shortLabel="Fee incl. GST" fullLabel="Course Fee (Include GST)" /></th>
                        )}
                        {(role === UserRole.Admin || role === UserRole.TrainingProvider) && (
                            <th scope="col" className="px-4 py-3 text-left text-xs font-medium text-on-surface-secondary uppercase tracking-wider"><HeaderCell shortLabel="Normal Funding" fullLabel="After Normal Funding" /></th>
                        )}
                        {(role === UserRole.Admin || role === UserRole.TrainingProvider) && (
                            <th scope="col" className="px-4 py-3 text-left text-xs font-medium text-on-surface-secondary uppercase tracking-wider"><HeaderCell shortLabel="MCES Funding" fullLabel="After MCES Funding" /></th>
                        )}
                        {(role === UserRole.Admin || role === UserRole.TrainingProvider) && (
                            <th scope="col" className="px-4 py-3 text-left text-xs font-medium text-on-surface-secondary uppercase tracking-wider"><HeaderCell shortLabel="UTAP" /></th>
                        )}
                        {(role === UserRole.Admin || role === UserRole.TrainingProvider) && (
                            <th scope="col" className="px-4 py-3 text-left text-xs font-medium text-on-surface-secondary uppercase tracking-wider"><HeaderCell shortLabel="Validity" /></th>
                        )}
                        {(role === UserRole.Admin || role === UserRole.TrainingProvider) && (
                            <th scope="col" className="px-4 py-3 text-left text-xs font-medium text-on-surface-secondary uppercase tracking-wider"><HeaderCell shortLabel="Trainers" /></th>
                        )}
                        {role === UserRole.Trainer && (
                            <th scope="col" className="px-4 py-3 text-left text-xs font-medium text-on-surface-secondary uppercase tracking-wider"><HeaderCell shortLabel="Course Run ID" /></th>
                        )}
                        {(role !== UserRole.Developer && role !== UserRole.Admin && role !== UserRole.TrainingProvider) && (
                            <th scope="col" className="px-4 py-3 text-left text-xs font-medium text-on-surface-secondary uppercase tracking-wider"><HeaderCell shortLabel="Start Date" /></th>
                        )}
                        <th scope="col" className="px-4 py-3 text-left text-xs font-medium text-on-surface-secondary uppercase tracking-wider"><HeaderCell shortLabel="Actions" /></th>
                    </tr>
                </thead>
                <tbody className="bg-surface divide-y divide-default">
                    {paginatedCourses.map(course => {
                        const totalHours = Number(course.trainingHours) + Number(course.assessmentHours);
                        return (
                            <tr key={course.id} className="hover:bg-surface-elevated transition-colors">
                                <td className="px-4 py-4 whitespace-nowrap">
                                    <div className="flex items-center">
                                        <div className="flex-shrink-0 h-10 w-10">
                                            <img
                                                className="h-10 w-10 rounded-md object-cover"
                                                src={course.imageUrl && !course.imageUrl.includes('picsum.photos')
                                                    ? getCourseImageUrl(course.imageUrl, course.id, course.title)
                                                    : getCourseBannerDataUrl({ width: 100, height: 100 })}
                                                alt={course.title}
                                                onError={(e) => {
                                                    const target = e.target as HTMLImageElement;
                                                    target.src = getCourseBannerDataUrl({ width: 100, height: 100 });
                                                }}
                                            />
                                        </div>
                                        <div className="ml-4">
                                            <div className="text-sm font-medium text-on-surface">{course.title}</div>
                                            <div className="text-sm text-on-surface-secondary">{course.courseCode}</div>
                                        </div>
                                    </div>
                                </td>
                                <td className="px-4 py-4 whitespace-nowrap text-sm text-on-surface-secondary">
                                    <span className={`font-semibold px-2 py-0.5 rounded-full text-xs ${getTypeColor(course.courseType)}`}>{course.courseType}</span>
                                    <div className="mt-1">{course.modeOfLearning.join(', ')}</div>
                                </td>
                                <td className="px-4 py-4 whitespace-nowrap text-sm text-on-surface-secondary">
                                    <div>{totalHours} Hours</div>
                                    <div className="text-xs">({course.trainingHours}T + {course.assessmentHours}A)</div>
                                </td>
                                {(role === UserRole.Admin || role === UserRole.TrainingProvider) && (
                                    <td className="px-4 py-4 whitespace-nowrap text-sm text-on-surface-secondary">
                                        {course.scheduleId || '—'}
                                    </td>
                                )}
                                {(role === UserRole.Admin || role === UserRole.TrainingProvider) && (
                                    <td className="px-4 py-4 whitespace-nowrap text-sm text-on-surface-secondary">
                                        {formatMoney(course.courseFeesExcludeGst)}
                                    </td>
                                )}
                                {(role === UserRole.Admin || role === UserRole.TrainingProvider) && (
                                    <td className="px-4 py-4 whitespace-nowrap text-sm text-on-surface-secondary">
                                        {formatMoney(computeGstAmount(course.courseFeesExcludeGst, companyGstRate, isCompanyGstRegistered))}
                                    </td>
                                )}
                                {(role === UserRole.Admin || role === UserRole.TrainingProvider) && (
                                    <td className="px-4 py-4 whitespace-nowrap text-sm text-on-surface-secondary">
                                        {formatMoney(course.courseFeesIncludeGst)}
                                    </td>
                                )}
                                {(role === UserRole.Admin || role === UserRole.TrainingProvider) && (
                                    <td className="px-4 py-4 whitespace-nowrap text-sm text-on-surface-secondary">
                                        {formatMoney(course.afterNormalFunding)}
                                    </td>
                                )}
                                {(role === UserRole.Admin || role === UserRole.TrainingProvider) && (
                                    <td className="px-4 py-4 whitespace-nowrap text-sm text-on-surface-secondary">
                                        {formatMoney(course.afterMcesFunding)}
                                    </td>
                                )}
                                {(role === UserRole.Admin || role === UserRole.TrainingProvider) && (
                                    <td className="px-4 py-4 whitespace-nowrap text-sm text-on-surface-secondary">
                                        <input
                                            type="checkbox"
                                            checked={!!course.isUtapEligible}
                                            readOnly
                                            disabled
                                            className="h-4 w-4 rounded border-gray-300 text-blue-600 disabled:opacity-100 disabled:cursor-default"
                                            aria-label={`${course.title} UTAP eligible`}
                                        />
                                    </td>
                                )}
                                {(role === UserRole.Admin || role === UserRole.TrainingProvider) && (
                                    <td className="px-4 py-4 whitespace-nowrap text-sm text-on-surface-secondary">
                                        {course.fundingValidity || '—'}
                                    </td>
                                )}
                                {(role === UserRole.Admin || role === UserRole.TrainingProvider) && (
                                    <td className="px-4 py-4 text-sm text-on-surface-secondary max-w-[200px]">
                                        <div className="font-medium">{course.numOfTrainers || 0} trainer{(course.numOfTrainers || 0) !== 1 ? 's' : ''}</div>
                                        {course.trainersList && (
                                            <div className="text-xs text-gray-500 dark:text-gray-400 mt-1 line-clamp-2" title={course.trainersList}>
                                                {course.trainersList}
                                            </div>
                                        )}
                                    </td>
                                )}
                                {role === UserRole.Trainer && (
                                    <td className="px-4 py-4 whitespace-nowrap text-sm text-on-surface-secondary">
                                        {course.courseRunCode || 'N/A'}
                                    </td>
                                )}
                                {(role !== UserRole.Developer && role !== UserRole.Admin && role !== UserRole.TrainingProvider) && (
                                    <td className="px-4 py-4 whitespace-nowrap text-sm text-on-surface-secondary">
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
                                <td className="px-4 py-4 whitespace-nowrap text-sm font-medium">
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
                                                Edit Course
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

    // KPI stats from full dataset
    const wsqCourses = (relevantCourses || []).filter(c => c.courseType === 'WSQ').length;
    const ibfCourses = (relevantCourses || []).filter(c => c.courseType === 'IBF').length;
    const unfundedCourses = (relevantCourses || []).filter(c => c.courseType !== 'WSQ' && c.courseType !== 'IBF').length;

    return (
        <div>

            {/* KPI Stat Cards */}
            {(role === UserRole.Admin || role === UserRole.Developer || role === UserRole.TrainingProvider) && (
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
                    <Card className="p-6 text-center">
                        <p className="text-4xl font-bold text-blue-600">{wsqCourses}</p>
                        <p className="text-gray-600 dark:text-gray-300 mt-1">WSQ Courses</p>
                    </Card>
                    <Card className="p-6 text-center">
                        <p className="text-4xl font-bold text-purple-600">{ibfCourses}</p>
                        <p className="text-gray-600 dark:text-gray-300 mt-1">IBF Courses</p>
                    </Card>
                    <Card className="p-6 text-center">
                        <p className="text-4xl font-bold text-gray-500">{unfundedCourses}</p>
                        <p className="text-gray-600 dark:text-gray-300 mt-1">Unfunded Courses</p>
                    </Card>
                </div>
            )}

            {/* Trainer KPI cards and class tabs */}
            {role === UserRole.Trainer && (() => {
                const todayKpi = new Date();
                todayKpi.setHours(0, 0, 0, 0);

                const parseLocalDate = (dateStr: string | null | undefined) => {
                    if (!dateStr) return null;
                    const d = new Date(dateStr);
                    d.setHours(0, 0, 0, 0);
                    return d;
                };

                // Apply the same class-status filter to the KPI counts so the
                // card totals match the list below. When the default
                // 'ActiveOnly' filter is in effect, cancelled runs don't count.
                const statusMatches = (course: any): boolean => {
                    const s = (course.classStatus || '').trim();
                    if (trainerStatusFilter === 'ActiveOnly') return s === 'Confirmed' || s === 'Pending';
                    if (trainerStatusFilter === 'all') return true;
                    return s === trainerStatusFilter;
                };

                const statusFilteredCourses = (relevantCourses || []).filter(statusMatches);

                const trainerCurrentClasses = statusFilteredCourses.filter(c => {
                    const s = parseLocalDate(c.startDate);
                    const e = parseLocalDate(c.endDate);
                    return s && s <= todayKpi && e && e >= todayKpi;
                }).length;
                const trainerUpcomingClasses = statusFilteredCourses.filter(c => {
                    const s = parseLocalDate(c.startDate);
                    return s && s > todayKpi;
                }).length;
                const trainerPastClasses = statusFilteredCourses.filter(c => {
                    const e = parseLocalDate(c.endDate);
                    return e && e < todayKpi;
                }).length;
                return (
                    <>
                        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
                            <Card className="p-6 text-center">
                                <p className="text-4xl font-bold text-green-600">{trainerCurrentClasses}</p>
                                <p className="text-gray-600 dark:text-gray-300 mt-1">Current Classes</p>
                            </Card>
                            <Card className="p-6 text-center">
                                <p className="text-4xl font-bold text-blue-600">{trainerUpcomingClasses}</p>
                                <p className="text-gray-600 dark:text-gray-300 mt-1">Upcoming Classes</p>
                            </Card>
                            <Card className="p-6 text-center">
                                <p className="text-4xl font-bold text-gray-500">{trainerPastClasses}</p>
                                <p className="text-gray-600 dark:text-gray-300 mt-1">Past Classes</p>
                            </Card>
                        </div>
                        <div className="flex gap-1 p-1 bg-surface rounded-lg w-fit border border-default mb-6">
                            {([
                                { key: 'all' as const, label: 'All Classes' },
                                { key: 'current' as const, label: 'Current Classes' },
                                { key: 'upcoming' as const, label: 'Upcoming Classes' },
                                { key: 'past' as const, label: 'Past Classes' },
                            ]).map(tab => (
                                <button
                                    key={tab.key}
                                    onClick={() => { setTrainerClassView(tab.key); setCurrentPage(1); }}
                                    className={`px-4 py-1.5 text-sm font-medium rounded-md transition-colors ${trainerClassView === tab.key ? 'bg-primary text-white shadow-sm' : 'text-gray-400 hover:text-white hover:bg-gray-700/50'}`}
                                >
                                    {tab.label}
                                </button>
                            ))}
                        </div>
                    </>
                );
            })()}

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
                                    onClick={() => handleViewModeChange('block')}
                                    className={`p-1.5 rounded-md transition-colors ${viewMode === 'block' ? 'bg-white shadow text-primary dark:bg-gray-600 dark:text-blue-400' : 'text-gray-500 hover:text-gray-800 dark:text-gray-400 dark:hover:text-gray-200'}`}
                                    aria-label="Block view"
                                    aria-pressed={viewMode === 'block'}
                                >
                                    <Icon name={IconName.Eye} className="w-5 h-5" />
                                </button>
                                <button
                                    onClick={() => handleViewModeChange('table')}
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
                            <select value={filterCourseType} onChange={e => setFilterCourseType(e.target.value as any)} className={`${inputClasses} mt-1`}>
                                <option value="All">All Types</option>
                                <option value="WSQ+IBF">WSQ + IBF</option>
                                <option value="WSQ">WSQ</option>
                                <option value="IBF">IBF</option>
                                <option value="Non-WSQ">Non-WSQ</option>
                            </select>
                        </div>
                        <div>
                            <label className="block text-sm font-medium text-on-surface-secondary">{role === UserRole.Trainer ? 'Class Type' : 'Mode of Training'}</label>
                            <select value={filterMode} onChange={e => setFilterMode(e.target.value)} className={`${inputClasses} mt-1`}>
                                <option value="All">{role === UserRole.Trainer ? 'All Types' : 'All Modes'}</option>
                                <option value="Physical">Physical</option>
                                <option value="Virtual">Virtual</option>
                                <option value="Hybrid">Hybrid</option>
                                <option value="External">External</option>
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
                        {role === UserRole.Trainer && (
                            <div>
                                <label className="block text-sm font-medium text-on-surface-secondary">Class Status</label>
                                <select
                                    value={trainerStatusFilter}
                                    onChange={e => setTrainerStatusFilter(e.target.value as 'ActiveOnly' | 'all' | 'Confirmed' | 'Pending' | 'Cancelled')}
                                    className={`${inputClasses} mt-1`}
                                >
                                    <option value="ActiveOnly">Active (Pending + Confirmed)</option>
                                    <option value="all">All (incl. Cancelled)</option>
                                    <option value="Confirmed">Confirmed only</option>
                                    <option value="Pending">Pending only</option>
                                    <option value="Cancelled">Cancelled only</option>
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
                            onClick={() => setCurrentPage(Math.max(currentPage - 1, 1))}
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
                            onClick={() => setCurrentPage(Math.min(currentPage + 1, totalPages))}
                            disabled={currentPage === totalPages}
                        >
                            Next →
                        </Button>
                        <Button
                            variant="outline"
                            size="sm"
                            onClick={() => setCurrentPage(totalPages)}
                            disabled={currentPage === totalPages}
                        >
                            Last »
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

    const handleClick = async () => {
        try { await loadCourseData(course); } catch (e) { console.error(e); }
    };

    return (
        <Card className="flex flex-col group cursor-pointer dark:bg-gray-800 dark:border-gray-700" onClick={handleClick}>
            <div className="relative">
                <img
                    src={getCourseImageUrl(course.imageUrl, course.id, course.title)}
                    alt={course.title}
                    className="w-full h-auto object-cover rounded-t-xl"
                    onError={(e) => { (e.target as HTMLImageElement).src = getCourseBannerDataUrl({ title: course.title }); }}
                />
            </div>
            <div className="p-4 flex flex-col flex-grow">
                <h3 className="font-bold text-on-surface mb-3 group-hover:text-primary transition-colors mt-3 dark:text-white">{course.title}</h3>

                <div className="flex items-center my-auto py-3">
                    <div className="text-xs space-y-2 flex-grow">
                        <div className="flex justify-between items-center">
                            <span className="font-semibold text-gray-500 dark:text-gray-400">Course Code</span>
                            <span className="font-mono text-gray-800 dark:text-gray-200">{course.courseCode || '—'}</span>
                        </div>
                        <div className="flex justify-between items-center">
                            <span className="font-semibold text-gray-500 dark:text-gray-400">Course Duration</span>
                            <span className="font-medium text-gray-800 dark:text-gray-200 text-right">{totalHours} Hours ({course.trainingHours}T + {course.assessmentHours}A)</span>
                        </div>
                        <div className="flex justify-between items-center">
                            <span className="font-semibold text-gray-500 dark:text-gray-400">Course Type</span>
                            <span className={`font-semibold px-2 py-0.5 rounded ${getTypeColor(course.courseType)}`}>{course.courseType}</span>
                        </div>
                        {(course.courseRunCode || course.courseRunId) && (
                            <div className="flex justify-between items-center">
                                <span className="font-semibold text-gray-500 dark:text-gray-400">Course Run</span>
                                <span className="font-mono text-gray-800 dark:text-gray-200">{course.courseRunCode || course.courseRunId}</span>
                            </div>
                        )}
                        <div className="flex justify-between items-center">
                            <span className="font-semibold text-gray-500 dark:text-gray-400">Class Type</span>
                            <span className={`font-semibold px-2 py-0.5 rounded ${
                                course.classType === 'Virtual' ? 'bg-blue-100 text-blue-800 dark:bg-blue-900/40 dark:text-blue-300'
                                : course.classType === 'Hybrid' ? 'bg-purple-100 text-purple-800 dark:bg-purple-900/40 dark:text-purple-300'
                                : course.classType === 'External' ? 'bg-cyan-100 text-cyan-800 dark:bg-cyan-900/40 dark:text-cyan-300'
                                : 'bg-gray-100 text-gray-700 dark:bg-gray-700 dark:text-gray-300'
                            }`}>{course.classType || 'Physical'}</span>
                        </div>
                        <div className="flex justify-between items-center">
                            <span className="font-semibold text-gray-500 dark:text-gray-400">Class Status</span>
                            {(() => {
                                const status = (course.classStatus || '').toLowerCase();
                                const styleMap: Record<string, string> = {
                                    cancelled: 'bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-300',
                                    pending:   'bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300',
                                    confirmed: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-300',
                                };
                                const style = styleMap[status] || 'bg-gray-100 text-gray-700 dark:bg-gray-700 dark:text-gray-300';
                                return (
                                    <span className={`font-semibold px-2 py-0.5 rounded ${style}`}>
                                        {course.classStatus || 'N/A'}
                                    </span>
                                );
                            })()}
                        </div>
                        {course.startDate && (
                            <div className="flex justify-between items-center">
                                <span className="font-semibold text-gray-500 dark:text-gray-400">Start Date</span>
                                <span className="font-medium text-gray-800 dark:text-gray-200">{new Date(course.startDate).toLocaleDateString('en-SG', { year: 'numeric', month: 'short', day: 'numeric' })}</span>
                            </div>
                        )}
                        {course.endDate && (
                            <div className="flex justify-between items-center">
                                <span className="font-semibold text-gray-500 dark:text-gray-400">End Date</span>
                                <span className="font-medium text-gray-800 dark:text-gray-200">{new Date(course.endDate).toLocaleDateString('en-SG', { year: 'numeric', month: 'short', day: 'numeric' })}</span>
                            </div>
                        )}
                    </div>
                </div>

                {/* Footer */}
                <div className="border-t border-gray-200 dark:border-gray-700 mt-auto pt-3 flex justify-between items-center">
                    <span className="font-semibold text-on-surface text-sm dark:text-gray-200">View Course</span>
                    <div className="w-8 h-8 rounded-full bg-primary text-white flex items-center justify-center transition-colors">
                        <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 8l4 4m0 0l-4 4m4-4H3" />
                        </svg>
                    </div>
                </div>
            </div>
        </Card>
    );
};

const LearnerCourseList: React.FC = () => {
    const { currentUser } = useLms();
    const { courses, loading, error, refetchCourses } = useCourses(currentUser?.id);

    const [searchQuery, setSearchQuery] = useState('');
    const [viewMode, setViewMode] = useState<'grid' | 'list'>('grid');
    const [classTab, setClassTab] = useState<'all' | 'current' | 'upcoming' | 'past'>('all');

    // Persist view mode when it changes
    useEffect(() => {
        const savedViewMode = localStorage.getItem('learnerCourseListViewMode');
        if (savedViewMode === 'grid' || savedViewMode === 'list') {
            setViewMode(savedViewMode);
        }
    }, []);

    const handleViewModeChange = (mode: 'grid' | 'list') => {
        setViewMode(mode);
        localStorage.setItem('learnerCourseListViewMode', mode);
    };

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

    // Classify courses by date
    const classifyCourse = (course: any): 'current' | 'upcoming' | 'past' => {
        const today = new Date();
        today.setHours(0, 0, 0, 0);

        const parseLocalDate = (dateStr: string | null | undefined) => {
            if (!dateStr) return null;
            const d = new Date(dateStr);
            d.setHours(0, 0, 0, 0);
            return d;
        };

        const start = parseLocalDate(course.startDate);
        const end = parseLocalDate(course.endDate);

        if (start && start > today) return 'upcoming';
        if (end && end < today) return 'past';
        if (start && end && start <= today && end >= today) return 'current';
        // If only start exists and it's today or earlier, treat as current
        if (start && !end && start <= today) return 'current';
        return 'current'; // default
    };

    // KPI counts from full dataset
    const currentClasses = (courses || []).filter(c => classifyCourse(c) === 'current').length;
    const upcomingClasses = (courses || []).filter(c => classifyCourse(c) === 'upcoming').length;
    const pastClasses = (courses || []).filter(c => classifyCourse(c) === 'past').length;

    const filteredCourses = useMemo(() => {
        if (!courses) return [];

        // First filter by tab
        let tabFiltered = courses;
        if (classTab !== 'all') {
            tabFiltered = courses.filter(c => classifyCourse(c) === classTab);
        }

        // Then filter by search
        if (searchQuery === '') return tabFiltered;
        const q = searchQuery.toLowerCase();
        return tabFiltered.filter(course => {
            if (course.title.toLowerCase().includes(q)) return true;
            if (course.courseCode?.toLowerCase().includes(q)) return true;
            if (q.length >= 3) {
                if (course.courseRunCode?.toLowerCase().includes(q)) return true;
                if (String(course.courseRunId || '').toLowerCase().includes(q)) return true;
            }
            return false;
        });
    }, [courses, searchQuery, classTab]);

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
            <h2 className="text-3xl font-bold dark:text-white">My Classes</h2>

            {/* KPI Stat Cards */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <Card className="p-6 text-center">
                    <p className="text-4xl font-bold text-green-600">{currentClasses}</p>
                    <p className="text-gray-600 dark:text-gray-300 mt-1">Current Classes</p>
                </Card>
                <Card className="p-6 text-center">
                    <p className="text-4xl font-bold text-blue-600">{upcomingClasses}</p>
                    <p className="text-gray-600 dark:text-gray-300 mt-1">Upcoming Classes</p>
                </Card>
                <Card className="p-6 text-center">
                    <p className="text-4xl font-bold text-gray-500">{pastClasses}</p>
                    <p className="text-gray-600 dark:text-gray-300 mt-1">Past Classes</p>
                </Card>
            </div>

            {/* Class Tabs */}
            <div className="flex gap-1 p-1 bg-surface rounded-lg w-fit border border-default">
                {([
                    { key: 'all' as const, label: 'All Classes' },
                    { key: 'current' as const, label: 'Current Classes' },
                    { key: 'upcoming' as const, label: 'Upcoming Classes' },
                    { key: 'past' as const, label: 'Past Classes' },
                ]).map(tab => (
                    <button
                        key={tab.key}
                        onClick={() => setClassTab(tab.key)}
                        className={`px-4 py-1.5 text-sm font-medium rounded-md transition-colors ${classTab === tab.key ? 'bg-primary text-white shadow-sm' : 'text-gray-400 hover:text-white hover:bg-gray-700/50'}`}
                    >
                        {tab.label}
                    </button>
                ))}
            </div>

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
                        onClick={() => handleViewModeChange('grid')}
                        title="Card view"
                        className={`p-2 rounded-lg transition-colors ${viewMode === 'grid' ? 'bg-primary text-white shadow' : 'text-gray-400 hover:text-gray-700 dark:hover:text-gray-200'}`}
                    >
                        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                            <rect x="3" y="3" width="7" height="7" rx="1" /><rect x="14" y="3" width="7" height="7" rx="1" />
                            <rect x="3" y="14" width="7" height="7" rx="1" /><rect x="14" y="14" width="7" height="7" rx="1" />
                        </svg>
                    </button>
                    <button
                        onClick={() => handleViewModeChange('list')}
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
                    title={searchQuery ? 'No courses match your search' : classTab === 'all' ? 'No enrolled courses found' : `No ${classTab} classes`}
                    description={searchQuery ? 'Try a different course code, title, or run ID' : classTab === 'all' ? "You haven't enrolled in any courses yet" : `You don't have any ${classTab} classes right now`}
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
            <div className="flex flex-wrap items-center justify-between gap-4 mb-6">
                <h2 className="text-3xl font-bold dark:text-white">{title}</h2>
                {role === UserRole.Admin && (
                    <div className="flex flex-wrap items-center gap-3">
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
