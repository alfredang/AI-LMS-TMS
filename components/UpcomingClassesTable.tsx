import React, { useState, useEffect, useRef } from 'react';
import ReactDOM from 'react-dom';
import { useLms } from '@contexts/LmsContext';
import { Card } from './ui/Card';
import { Button } from './ui/Button';
import { Icon, IconName } from './ui/Icon';
import { AdminPage } from '@app-types';
import { getApiUrl } from '@/lib/urlHelpers';

/**
 * Fixed horizontal scrollbar pinned to the bottom of the viewport.
 * Syncs scroll position bidirectionally with the table container.
 */
const StickyScrollbar: React.FC<{ tableRef: React.RefObject<HTMLDivElement | null> }> = ({ tableRef }) => {
  const scrollbarRef = useRef<HTMLDivElement>(null);
  const innerRef = useRef<HTMLDivElement>(null);
  const syncing = useRef(false);
  const [portalTarget, setPortalTarget] = useState<HTMLElement | null>(null);
  const [style, setStyle] = useState<React.CSSProperties>({ display: 'none' });

  useEffect(() => {
    const el = document.createElement('div');
    el.id = 'upcoming-sticky-scrollbar-portal';
    document.body.appendChild(el);
    setPortalTarget(el);
    return () => { if (document.body.contains(el)) document.body.removeChild(el); };
  }, []);

  useEffect(() => {
    const table = tableRef.current;
    const scrollbar = scrollbarRef.current;
    const inner = innerRef.current;
    if (!table || !scrollbar || !inner) return;

    const update = () => {
      const rect = table.getBoundingClientRect();
      const scrollW = table.scrollWidth;
      const clientW = table.clientWidth;
      inner.style.width = `${scrollW}px`;

      const overflows = scrollW > clientW;
      const nativeScrollbarVisible = rect.bottom <= window.innerHeight;

      if (overflows && !nativeScrollbarVisible) {
        setStyle({
          position: 'fixed',
          bottom: 0,
          left: rect.left,
          width: rect.width,
          height: 18,
          zIndex: 9999,
          overflowX: 'auto',
          overflowY: 'hidden',
          background: '#0f172a',
        });
      } else {
        setStyle({ display: 'none' });
      }
    };

    const syncToScrollbar = () => {
      if (syncing.current) return;
      syncing.current = true;
      scrollbar.scrollLeft = table.scrollLeft;
      requestAnimationFrame(() => { syncing.current = false; });
    };

    const syncToTable = () => {
      if (syncing.current) return;
      syncing.current = true;
      table.scrollLeft = scrollbar.scrollLeft;
      requestAnimationFrame(() => { syncing.current = false; });
    };

    table.addEventListener('scroll', syncToScrollbar);
    scrollbar.addEventListener('scroll', syncToTable);
    window.addEventListener('scroll', update, { passive: true });
    window.addEventListener('resize', update);
    update();

    return () => {
      table.removeEventListener('scroll', syncToScrollbar);
      scrollbar.removeEventListener('scroll', syncToTable);
      window.removeEventListener('scroll', update);
      window.removeEventListener('resize', update);
    };
  }, [tableRef, portalTarget]);

  if (!portalTarget) return null;

  return ReactDOM.createPortal(
    <div ref={scrollbarRef} style={style}>
      <div ref={innerRef} style={{ height: 1 }} />
    </div>,
    portalTarget
  );
};

/**
 * Fixed header clone pinned below the site nav (64px).
 * Clones the real thead and syncs horizontal scroll.
 */
const StickyHeader: React.FC<{
  tableRef: React.RefObject<HTMLDivElement | null>;
  theadRef: React.RefObject<HTMLTableSectionElement | null>;
}> = ({ tableRef, theadRef }) => {
  const cloneRef = useRef<HTMLDivElement>(null);
  const syncing = useRef(false);
  const [portalTarget, setPortalTarget] = useState<HTMLElement | null>(null);
  const [visible, setVisible] = useState(false);
  const [style, setStyle] = useState<React.CSSProperties>({});

  useEffect(() => {
    const el = document.createElement('div');
    el.id = 'upcoming-sticky-header-portal';
    document.body.appendChild(el);
    setPortalTarget(el);
    return () => { if (document.body.contains(el)) document.body.removeChild(el); };
  }, []);

  useEffect(() => {
    const table = tableRef.current;
    const thead = theadRef.current;
    const clone = cloneRef.current;
    if (!table || !thead || !clone || !portalTarget) return;

    const SITE_HEADER_HEIGHT = 64;

    const update = () => {
      const tableRect = table.getBoundingClientRect();
      const theadRect = thead.getBoundingClientRect();

      const shouldShow = theadRect.top < SITE_HEADER_HEIGHT && tableRect.bottom > SITE_HEADER_HEIGHT + 100;

      setVisible(shouldShow);
      if (shouldShow) {
        setStyle({
          position: 'fixed',
          top: SITE_HEADER_HEIGHT,
          left: tableRect.left,
          width: tableRect.width,
          zIndex: 25,
          overflow: 'hidden',
        });

        const realCells = thead.querySelectorAll('th');
        clone.innerHTML = '';
        const cloneTable = document.createElement('table');
        cloneTable.className = 'w-full text-sm border-collapse';
        cloneTable.style.width = `${table.scrollWidth}px`;
        cloneTable.style.marginLeft = `-${table.scrollLeft}px`;
        const cloneThead = thead.cloneNode(true) as HTMLTableSectionElement;
        cloneTable.appendChild(cloneThead);
        clone.appendChild(cloneTable);

        const cloneCells = cloneThead.querySelectorAll('th');
        realCells.forEach((cell, i) => {
          if (cloneCells[i]) {
            (cloneCells[i] as HTMLElement).style.width = `${cell.getBoundingClientRect().width}px`;
            (cloneCells[i] as HTMLElement).style.minWidth = `${cell.getBoundingClientRect().width}px`;
          }
        });
      }
    };

    const syncScroll = () => {
      if (!cloneRef.current) return;
      const innerTable = cloneRef.current.querySelector('table');
      if (innerTable) {
        innerTable.style.marginLeft = `-${table.scrollLeft}px`;
      }
    };

    table.addEventListener('scroll', syncScroll);
    window.addEventListener('scroll', update, { passive: true });
    window.addEventListener('resize', update);
    update();

    return () => {
      table.removeEventListener('scroll', syncScroll);
      window.removeEventListener('scroll', update);
      window.removeEventListener('resize', update);
    };
  }, [tableRef, theadRef, portalTarget]);

  if (!portalTarget) return null;

  return ReactDOM.createPortal(
    <div
      ref={cloneRef}
      style={{
        ...style,
        display: visible ? 'block' : 'none',
        background: '#1e293b',
        boxShadow: '0 2px 8px rgba(0,0,0,0.3)',
      }}
    />,
    portalTarget
  );
};

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
        case 'Unconfirmed':
            return 'bg-purple-100 text-purple-800 dark:bg-purple-900/50 dark:text-purple-200';
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
    assignedTrainerTpg: string;
    assignedTrainerTpgEmail: string;
    assignedTrainerLocal: string;
    assignedTrainerLocalEmail: string;
    nextAvailableTrainer: string;
    nextAvailableTrainerEmail: string;
    latestInvitationStatus: string;
    latestInvitationTrainer: string;
    numOfTrainee: number;
    modeOfTraining: string;
    classType: string;
    invitationPaused: boolean;
    trainerInCalendar: boolean | null;
    attendanceScore: number | null;
    trainersList: string;
}

interface Trainer {
    trainer_name: string;
}

const splitTrainerList = (list: string): string[] => {
    const s = (list || '').trim();
    if (!s) return [];
    if (s.includes('|')) return s.split('|').map(x => x.trim()).filter(Boolean);
    return s.split(',').map(x => x.trim()).filter(Boolean);
};

interface UpcomingClassesTableProps {
    showTitle?: boolean;
    showFilters?: boolean;
    includeOngoing?: boolean;
}

export const UpcomingClassesTable: React.FC<UpcomingClassesTableProps> = ({
    showTitle = true,
    showFilters = true,
    includeOngoing = false,
}) => {
    const [currentPage, setCurrentPage] = useState(0);

    // Track initial mount to prevent filter-reset effects from overriding the restored page
    const isInitialMount = useRef(true);
    // Track current page in a ref for the visibilitychange listener to avoid closure bugs
    const currentPageRef = useRef(currentPage);

    useEffect(() => {
        currentPageRef.current = currentPage;
    }, [currentPage]);
    const [searchQuery, setSearchQuery] = useState('');
    const [showAdvancedFilters, setShowAdvancedFilters] = useState(false);

    // Advanced filter states
    const [courseTitle, setCourseTitle] = useState('');
    const [courseCode, setCourseCode] = useState('');
    const [courseRunId, setCourseRunId] = useState('');
    const [selectedTrainer, setSelectedTrainer] = useState('');
    // Default to 'ActiveOnly' (Pending + Confirmed) so the Upcoming Classes
    // list doesn't clutter with cancelled runs. Admins can switch to 'all' or
    // 'Cancelled' from the Advanced Filters dropdown to see cancelled classes.
    const [selectedClassStatus, setSelectedClassStatus] = useState<'all' | 'ActiveOnly' | 'Confirmed' | 'Pending' | 'Cancelled'>('ActiveOnly');
    const [selectedClassType, setSelectedClassType] = useState<'all' | 'Physical' | 'Virtual' | 'Hybrid' | 'External'>('all');
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

    // Data states
    const [upcomingClasses, setUpcomingClasses] = useState<UpcomingClass[]>([]);
    const [trainers, setTrainers] = useState<Trainer[]>([]);
    const [loading, setLoading] = useState(true);
    const [totalCount, setTotalCount] = useState(0);
    const [totalPages, setTotalPages] = useState(0);
    const [stats, setStats] = useState({
        totalClasses: 0,
        totalConfirmedClasses: 0,
        totalPendingClasses: 0,
        totalAssignedTpgClasses: 0,
        totalAssignedLocalClasses: 0,
    });

    // Import Run modal states
    const [showImportModal, setShowImportModal] = useState(false);
    const [importRunId, setImportRunId] = useState('');
    const [importLoading, setImportLoading] = useState(false);
    const [importResult, setImportResult] = useState<{ success: boolean; message: string; detail?: string } | null>(null);

    // Calendar sync state
    const [showCalendarModal, setShowCalendarModal] = useState(false);
    const [calSyncStartDate, setCalSyncStartDate] = useState(() => new Date().toISOString().slice(0, 10));
    const [calSyncEndDate, setCalSyncEndDate] = useState(() => {
        const d = new Date(); d.setMonth(d.getMonth() + 1); return d.toISOString().slice(0, 10);
    });
    const [calSyncing, setCalSyncing] = useState(false);
    const [calSyncResult, setCalSyncResult] = useState<any>(null);
    const [sendingInvitationFor, setSendingInvitationFor] = useState<string | null>(null);
    const [checkingCalendar, setCheckingCalendar] = useState(false);
    const [bulkSending, setBulkSending] = useState(false);
    const [showBulkPreview, setShowBulkPreview] = useState(false);
    const [bulkPreviewData, setBulkPreviewData] = useState<any[]>([]);
    const [bulkPreviewLoading, setBulkPreviewLoading] = useState(false);
    const [bulkSelected, setBulkSelected] = useState<Set<string>>(new Set());
    const [bulkDateFrom, setBulkDateFrom] = useState('');
    const [bulkDateTo, setBulkDateTo] = useState('');
    const [showTpgPreview, setShowTpgPreview] = useState(false);
    const [tpgPreviewData, setTpgPreviewData] = useState<any[]>([]);
    const [tpgPreviewLoading, setTpgPreviewLoading] = useState(false);
    const [tpgSelected, setTpgSelected] = useState<Set<string>>(new Set());
    const [tpgSending, setTpgSending] = useState(false);
    const [tpgDateFrom, setTpgDateFrom] = useState('');
    const [tpgDateTo, setTpgDateTo] = useState('');
    const [revealedNrics, setRevealedNrics] = useState<Set<string>>(new Set());
    const tableScrollRef = useRef<HTMLDivElement>(null);
    const theadRef = useRef<HTMLTableSectionElement>(null);
    const [actionMessage, setActionMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
    // Per-row next trainer overrides (courseRun UUID → selected trainer name)
    const [nextTrainerOverrides, setNextTrainerOverrides] = useState<Record<string, string>>({});

    const ITEMS_PER_PAGE = 20;
    const totalUnassignedTrainers = Math.max(stats.totalClasses - stats.totalAssignedLocalClasses, 0);

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
                page: currentPageRef.current.toString(),
                limit: ITEMS_PER_PAGE.toString(),
                _t: Date.now().toString(),
            });

            // Include ongoing classes if requested
            if (includeOngoing) params.append('includeOngoing', 'true');

            // Add search and filter parameters (use debounced values for text inputs)
            if (debouncedSearch) params.append('search', debouncedSearch);
            if (debouncedCourseTitle) params.append('courseTitle', debouncedCourseTitle);
            if (debouncedCourseCode) params.append('courseCode', debouncedCourseCode);
            if (debouncedCourseRunId) params.append('courseRunId', debouncedCourseRunId);
            if (selectedTrainer) params.append('trainer', selectedTrainer);
            // Pass classStatus through unless the admin explicitly picks 'all'
            // (which means "no filter — include cancelled"). 'ActiveOnly' is
            // the new default and maps to "Confirmed OR Pending" server-side.
            if (selectedClassStatus !== 'all') params.append('classStatus', selectedClassStatus);
            if (selectedClassType !== 'all') params.append('classType', selectedClassType);
            if (selectedCourseType !== 'all') params.append('courseType', selectedCourseType);
            if (debouncedStartDate) params.append('startDateFrom', debouncedStartDate);
            if (debouncedEndDate) params.append('endDateUntil', debouncedEndDate);

            console.log('📝 Query params:', params.toString());

            const response = await fetch(getApiUrl(`/api/admin/upcoming-classes?${params}`));
            const result = await response.json();

            console.log('📊 Upcoming classes API response:', result);

            if (result.success) {
                console.log('✅ Upcoming classes loaded:', result.data.classes.length);
                setUpcomingClasses(result.data.classes);
                setTotalCount(result.data.totalCount);
                setTotalPages(result.data.totalPages);
                if (result.data.stats) {
                    setStats({
                        totalClasses: result.data.stats.totalClasses ?? 0,
                        totalConfirmedClasses: result.data.stats.totalConfirmedClasses ?? 0,
                        totalPendingClasses: result.data.stats.totalPendingClasses ?? 0,
                        totalAssignedTpgClasses: result.data.stats.totalAssignedTpgClasses ?? 0,
                        totalAssignedLocalClasses: result.data.stats.totalAssignedLocalClasses ?? 0,
                    });
                }
            } else {
                console.error('❌ Error fetching upcoming classes:', result.message);
            }
        } catch (error) {
            console.error('❌ Error fetching upcoming classes:', error);
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
        if (isInitialMount.current) {
            return; // Skip first run — debounced values already default to '' and page is restored from context
        }
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
        if (isInitialMount.current) {
            return;
        }
        setCurrentPage(0);
    }, [selectedTrainer, selectedClassStatus, selectedClassType, selectedCourseType]);

    // Mark initial mount as done AFTER all other mount effects have executed
    useEffect(() => {
        isInitialMount.current = false;
        return () => { isInitialMount.current = true; }; // Reset for React StrictMode remount
    }, []);

    // Fetch data when debounced filters or pagination change
    useEffect(() => {
        fetchUpcomingClasses();
    }, [currentPage, debouncedSearch, debouncedCourseTitle, debouncedCourseCode, debouncedCourseRunId, selectedTrainer, selectedClassStatus, selectedClassType, selectedCourseType, debouncedStartDate, debouncedEndDate]);

    // Auto-refresh when the tab becomes visible again. Common flow: admin
    // sends an invitation, switches to email to test, then comes back — this
    // picks up any trainer accept/decline that happened while away.
    useEffect(() => {
        const handleVisibilityChange = () => {
            if (document.visibilityState === 'visible' && !isInitialMount.current) {
                console.log('👁️ Tab visible again — refetching upcoming classes from page', currentPageRef.current);
                fetchUpcomingClasses();
            }
        };
        document.addEventListener('visibilitychange', handleVisibilityChange);
        return () => document.removeEventListener('visibilitychange', handleVisibilityChange);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

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
        // Reset to the default view (Pending + Confirmed), not 'all' —
        // 'all' would surface cancelled runs which admins usually don't want.
        setSelectedClassStatus('ActiveOnly');
        setSelectedClassType('all');
        setSelectedCourseType('all');
        setStartDateFrom('');
        setEndDateUntil('');
        setCurrentPage(0);
    };

    const handleEditClass = (classItem: UpcomingClass) => {
        setEditingCourseRun(classItem);
        setClassListCurrentPage(currentPage);
        setClassListReturnTo(AdminPage.UpcomingClasses);
        setAdminPage(AdminPage.EditClass);
    };

    const handleViewDetails = (classItem: UpcomingClass) => {
        setEditingCourseRun(classItem);
        setSelectedCourseRunId(classItem.courseRunId);
        setClassListCurrentPage(currentPage);
        setClassListReturnTo(AdminPage.UpcomingClasses);
        setAdminPage(AdminPage.ClassDetail);
    };

    const handleDelete = (classId: string, classTitle: string) => {
        if (window.confirm(`Are you sure you want to delete the class "${classTitle}"? This action cannot be undone.`)) {
            console.log('Delete class:', classId);
        }
    };

    const formatDate = (dateString: string) => {
        if (!dateString) return 'N/A';
        return new Date(dateString).toLocaleDateString('en-GB');
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

    const handleCalendarSync = async () => {
        setCalSyncing(true);
        setCalSyncResult(null);
        try {
            const response = await fetch(getApiUrl('/api/external/sync-google-calendar'), {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ startDate: calSyncStartDate, endDate: calSyncEndDate }),
            });
            const data = await response.json();
            setCalSyncResult(data);
            if (data.success) fetchUpcomingClasses();
        } catch {
            setCalSyncResult({ success: false, error: 'Network error. Please try again.' });
        } finally {
            setCalSyncing(false);
        }
    };

    const renderTrainerCell = (name: string, email?: string) => {
        if (!name) {
            return <span className="text-gray-400 dark:text-gray-500 text-xs">N/A</span>;
        }
        return (
            <span className="text-sm text-gray-900 dark:text-white" title={email || ''}>{name}</span>
        );
    };

    const handleSendTrainerInvitation = async (classItem: UpcomingClass) => {
        if (classItem.invitationPaused) {
            setActionMessage({ type: 'error', text: 'Invitations are paused for this course run. Unpause from Edit Class to send.' });
            return;
        }
        setSendingInvitationFor(classItem.id);
        setActionMessage(null);
        try {
            const overrideTrainerName = nextTrainerOverrides[classItem.id] || undefined;
            const response = await fetch(getApiUrl('/api/admin/send-trainer-invitation'), {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ courseRunUuid: classItem.id, overrideTrainerName }),
            });
            const result = await response.json();
            if (!result.success) {
                throw new Error(result.error || 'Failed to send trainer invitation.');
            }
            setActionMessage({ type: 'success', text: result.message || 'Trainer invitation sent.' });
            await fetchUpcomingClasses();
        } catch (error) {
            setActionMessage({ type: 'error', text: error instanceof Error ? error.message : 'Failed to send trainer invitation.' });
        } finally {
            setSendingInvitationFor(null);
            setTimeout(() => setActionMessage(null), 4000);
        }
    };

    return (
        <div>
            {showTitle && (
                <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 mb-6">
                    <h3 className="text-3xl font-bold dark:text-white">Upcoming Classes</h3>
                    <div className="flex gap-2">
                        <Button
                            variant="secondary"
                            size="sm"
                            onClick={() => fetchUpcomingClasses()}
                            disabled={loading}
                            title="Pull the latest data (use this after a trainer accepts/declines an invitation)"
                        >
                            <svg
                                xmlns="http://www.w3.org/2000/svg"
                                fill="none"
                                viewBox="0 0 24 24"
                                strokeWidth={2}
                                stroke="currentColor"
                                className={`w-4 h-4 mr-2 ${loading ? 'animate-spin' : ''}`}
                            >
                                <path strokeLinecap="round" strokeLinejoin="round" d="M16.023 9.348h4.992V4.356m0 4.992-3.181-3.183a8.25 8.25 0 0 0-13.803 3.7M4.031 9.865a8.25 8.25 0 0 0 13.803 3.7l3.181-3.182m-4.991 0h4.991v-4.99" />
                            </svg>
                            Refresh
                        </Button>
                        <Button
                            variant="secondary"
                            size="sm"
                            onClick={() => { setShowCalendarModal(true); setCalSyncResult(null); }}
                        >
                            Sync Google Calendar
                        </Button>
                        <Button
                            variant="secondary"
                            size="sm"
                            disabled={checkingCalendar}
                            onClick={async () => {
                                setCheckingCalendar(true);
                                try {
                                    const res = await fetch(getApiUrl('/api/admin/check-calendar-trainers'), {
                                        method: 'POST',
                                        headers: { 'Content-Type': 'application/json' },
                                        body: JSON.stringify({ daysAhead: 60 }),
                                    });
                                    const json = await res.json();
                                    if (json.success) {
                                        setActionMessage({ type: 'success', text: `Calendar check: ${json.trainerInCalendar} matched, ${json.trainerNotInCalendar} not matched` });
                                        fetchUpcomingClasses();
                                    } else {
                                        setActionMessage({ type: 'error', text: json.error || 'Calendar check failed' });
                                    }
                                } catch {
                                    setActionMessage({ type: 'error', text: 'Failed to check calendar' });
                                } finally {
                                    setCheckingCalendar(false);
                                }
                            }}
                            title="Check if local trainers match Google Calendar attendees"
                        >
                            {checkingCalendar ? 'Checking...' : 'Check Calendar'}
                        </Button>
                        <Button
                            variant="secondary"
                            size="sm"
                            disabled={bulkPreviewLoading}
                            onClick={async () => {
                                setBulkPreviewLoading(true);
                                setBulkDateFrom('');
                                setBulkDateTo('');
                                try {
                                    const res = await fetch(getApiUrl('/api/admin/preview-bulk-trainer-invitations'));
                                    const data = await res.json();
                                    if (data.success) {
                                        setBulkPreviewData(data.preview || []);
                                        const sendable = (data.preview || []).filter((p: any) => p.canSend && p.confirmedEnrolments > 0);
                                        setBulkSelected(new Set(sendable.map((p: any) => p.courseRunUuid)));
                                        setShowBulkPreview(true);
                                    } else {
                                        setActionMessage({ type: 'error', text: data.error || 'Failed to load preview' });
                                    }
                                } catch {
                                    setActionMessage({ type: 'error', text: 'Failed to load preview' });
                                } finally {
                                    setBulkPreviewLoading(false);
                                }
                            }}
                        >
                            <Icon name={IconName.Send} className="w-4 h-4 mr-1" />
                            {bulkPreviewLoading ? 'Loading...' : 'Invite All Pending'}
                        </Button>
                        <Button
                            variant="secondary"
                            size="sm"
                            disabled={tpgPreviewLoading}
                            onClick={async () => {
                                setTpgPreviewLoading(true);
                                setTpgDateFrom('');
                                setTpgDateTo('');
                                setRevealedNrics(new Set());
                                try {
                                    const res = await fetch(getApiUrl('/api/admin/preview-bulk-tpg-assign'));
                                    const data = await res.json();
                                    if (data.success) {
                                        setTpgPreviewData(data.preview || []);
                                        const assignable = (data.preview || []).filter((p: any) => p.canAssign);
                                        setTpgSelected(new Set(assignable.map((p: any) => p.courseRunUuid)));
                                        setShowTpgPreview(true);
                                    } else {
                                        setActionMessage({ type: 'error', text: data.error || 'Failed to load TPG preview' });
                                    }
                                } catch {
                                    setActionMessage({ type: 'error', text: 'Failed to load TPG preview' });
                                } finally {
                                    setTpgPreviewLoading(false);
                                }
                            }}
                        >
                            {tpgPreviewLoading ? 'Loading...' : 'Assign to TPG'}
                        </Button>
                        <Button
                            variant="primary"
                            size="sm"
                            onClick={() => { setShowImportModal(true); setImportResult(null); setImportRunId(''); }}
                        >
                            <Icon name={IconName.Add} className="w-4 h-4 mr-2" />
                            Import Course Run
                        </Button>
                    </div>
                </div>
            )}

            {/* KPI Stats */}
            {showTitle && (
                <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-6 gap-6 mb-8">
                    <Card className="p-6 text-center">
                        <p className="text-4xl font-bold text-blue-600">{stats.totalClasses}</p>
                        <p className="text-gray-600 dark:text-gray-300 mt-1">Upcoming Classes</p>
                    </Card>
                    <Card className="p-6 text-center">
                        <p className="text-4xl font-bold text-green-600">{stats.totalConfirmedClasses}</p>
                        <p className="text-gray-600 dark:text-gray-300 mt-1">Confirmed Classes</p>
                    </Card>
                    <Card className="p-6 text-center">
                        <p className="text-4xl font-bold text-amber-500">{stats.totalPendingClasses}</p>
                        <p className="text-gray-600 dark:text-gray-300 mt-1">Pending Classes</p>
                    </Card>
                    <Card className="p-6 text-center">
                        <p className="text-4xl font-bold text-emerald-500">{stats.totalAssignedLocalClasses}</p>
                        <p className="text-gray-600 dark:text-gray-300 mt-1">Trainer (Local)</p>
                    </Card>
                    <Card className="p-6 text-center">
                        <p className="text-4xl font-bold text-cyan-500">{stats.totalAssignedTpgClasses}</p>
                        <p className="text-gray-600 dark:text-gray-300 mt-1">Trainer (TPG)</p>
                    </Card>
                    <Card className="p-6 text-center">
                        <p className="text-4xl font-bold text-purple-600">{totalUnassignedTrainers}</p>
                        <p className="text-gray-600 dark:text-gray-300 mt-1">Unassigned Trainers</p>
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

                                        <div>
                                            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Class Status</label>
                                            <select
                                                value={selectedClassStatus}
                                                onChange={(e) => setSelectedClassStatus(e.target.value as 'all' | 'ActiveOnly' | 'Confirmed' | 'Pending' | 'Cancelled')}
                                                className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 text-sm dark:bg-gray-700 dark:border-gray-600 dark:text-white"
                                            >
                                                <option value="ActiveOnly">Active (Pending + Confirmed)</option>
                                                <option value="all">All (incl. Cancelled)</option>
                                                <option value="Confirmed">Confirmed only</option>
                                                <option value="Pending">Pending only</option>
                                                <option value="Cancelled">Cancelled only</option>
                                            </select>
                                        </div>

                                        {/* Class Type */}
                                        <div>
                                            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Class Type</label>
                                            <select
                                                value={selectedClassType}
                                                onChange={(e) => setSelectedClassType(e.target.value as 'all' | 'Physical' | 'Virtual' | 'Hybrid' | 'External')}
                                                className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 text-sm dark:bg-gray-700 dark:border-gray-600 dark:text-white"
                                            >
                                                <option value="all">All</option>
                                                <option value="Physical">Physical</option>
                                                <option value="Virtual">Virtual</option>
                                                <option value="Hybrid">Hybrid</option>
                                                <option value="External">External</option>
                                            </select>
                                        </div>

                                        {/* Course Type */}
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

                                        {/* Start Date From */}
                                        <div>
                                            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Start Date (From)</label>
                                            <input
                                                type="text"
                                                placeholder="DD/MM/YYYY"
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
                                                placeholder="DD/MM/YYYY"
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
                {actionMessage && (
                    <div className={`mb-4 p-3 rounded-md text-sm ${actionMessage.type === 'success' ? 'bg-green-50 text-green-700 dark:bg-green-900/30 dark:text-green-400' : 'bg-red-50 text-red-700 dark:bg-red-900/30 dark:text-red-400'}`}>
                        {actionMessage.text}
                    </div>
                )}
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
                            {/* 'ActiveOnly' is the default — don't count it as a user-applied filter */}
                            {searchQuery || courseTitle || courseCode || courseRunId || selectedTrainer || (selectedClassStatus !== 'all' && selectedClassStatus !== 'ActiveOnly') || selectedClassType !== 'all' || selectedCourseType !== 'all' || startDateFrom || endDateUntil
                                ? 'Try adjusting your search filters'
                                : 'No classes are scheduled for the future'}
                        </p>
                    </div>
                ) : (
                    <>
                        <div className="overflow-x-auto" ref={tableScrollRef}>
                          {includeOngoing ? (
                            <table className="min-w-full divide-y divide-gray-200 dark:divide-gray-700">
                                <thead className="bg-gray-50 dark:bg-gray-700/50">
                                    <tr className="border-b dark:border-gray-700">
                                        <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">Course Run ID</th>
                                        <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider text-center">Course Title</th>
                                        <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider whitespace-nowrap">Course Ref Code</th>
                                        <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider whitespace-nowrap">Class Type</th>
                                        <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider whitespace-nowrap">Start Date</th>
                                        <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider whitespace-nowrap">End Date</th>
                                        <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider whitespace-nowrap">Class Status</th>
                                        <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">Learners</th>
                                        <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider whitespace-nowrap">Trainer (TPG)</th>
                                        <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider whitespace-nowrap">Trainer (Local)</th>
                                        <th className="px-4 py-3 text-center text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider whitespace-nowrap" title="Trainer matches Google Calendar attendee">Cal</th>
                                        <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">Attendance</th>
                                        <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider"></th>
                                    </tr>
                                </thead>
                                <tbody className="bg-white dark:bg-gray-800 divide-y divide-gray-200 dark:divide-gray-700">
                                    {upcomingClasses.map((classItem, index) => {
                                        // Use API-derived status directly (considers junction table, legacy scalar, and TPG trainer).
                                        const status = classItem.classStatus;
                                        const classType = classItem.classType || 'Physical';
                                        return (
                                            <tr key={index} className="border-b dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-700/50">
                                                <td className="px-4 py-2 whitespace-nowrap text-sm text-gray-700 dark:text-gray-200">{classItem.courseRunId}</td>
                                                <td className="px-4 py-2 text-sm font-medium min-w-[350px]"><button type="button" onClick={() => handleViewDetails(classItem)} className="text-left text-blue-600 dark:text-blue-400 hover:underline">{classItem.courseTitle}</button></td>
                                                <td className="px-4 py-2 whitespace-nowrap text-sm text-gray-700 dark:text-gray-200">{classItem.courseCode}</td>
                                                <td className="px-4 py-2 whitespace-nowrap text-sm">
                                                    <span className={`px-2 py-0.5 inline-flex text-xs leading-5 font-semibold rounded-full ${classType === 'Virtual' ? 'bg-blue-100 text-blue-800 dark:bg-blue-900/40 dark:text-blue-300' : classType === 'Hybrid' ? 'bg-purple-100 text-purple-800 dark:bg-purple-900/40 dark:text-purple-300' : classType === 'External' ? 'bg-cyan-100 text-cyan-800 dark:bg-cyan-900/40 dark:text-cyan-300' : 'bg-gray-100 text-gray-700 dark:bg-gray-700 dark:text-gray-300'}`}>{classType}</span>
                                                </td>
                                                <td className="px-4 py-2 whitespace-nowrap text-sm text-gray-700 dark:text-gray-200">{formatDate(classItem.startDate)}</td>
                                                <td className="px-4 py-2 whitespace-nowrap text-sm text-gray-700 dark:text-gray-200">{formatDate(classItem.endDate)}</td>
                                                <td className="px-4 py-2 whitespace-nowrap text-sm">
                                                    <span className={`px-2 inline-flex text-xs leading-5 font-semibold rounded-full ${getStatusColor(status)}`}>{status}</span>
                                                </td>
                                                <td className="px-4 py-2 whitespace-nowrap text-sm text-center text-gray-700 dark:text-gray-200">{classItem.numOfTrainee}</td>
                                                <td className="px-4 py-2 whitespace-nowrap text-sm text-gray-700 dark:text-gray-200">{renderTrainerCell(classItem.assignedTrainerTpg, classItem.assignedTrainerTpgEmail)}</td>
                                                <td className="px-4 py-2 whitespace-nowrap text-sm text-gray-700 dark:text-gray-200">{renderTrainerCell(classItem.assignedTrainerLocal, classItem.assignedTrainerLocalEmail)}</td>
                                                <td className="px-4 py-2 whitespace-nowrap text-sm text-center">
                                                    {classItem.trainerInCalendar === true ? (
                                                        <span className="text-green-500" title="Trainer matches calendar">✓</span>
                                                    ) : classItem.trainerInCalendar === false ? (
                                                        <span className="text-red-500" title="Trainer not in calendar">✗</span>
                                                    ) : (
                                                        <span className="text-gray-400" title="Not checked yet">—</span>
                                                    )}
                                                </td>
                                                <td className="px-4 py-2 whitespace-nowrap text-sm text-center">
                                                    {classItem.attendanceScore != null ? (
                                                        <span className={`font-semibold ${classItem.attendanceScore >= 75 ? 'text-green-600' : classItem.attendanceScore >= 50 ? 'text-yellow-600' : 'text-red-600'}`}>
                                                            {classItem.attendanceScore}%
                                                        </span>
                                                    ) : (
                                                        <span className="text-gray-400">—</span>
                                                    )}
                                                </td>
                                                <td className="px-4 py-2 whitespace-nowrap text-sm font-medium">
                                                    <Button
                                                        variant="primary"
                                                        size="sm"
                                                        onClick={() => handleEditClass(classItem)}
                                                    >
                                                        <Icon name={IconName.Edit} className="w-4 h-4 mr-1" />
                                                        Edit
                                                    </Button>
                                                </td>
                                            </tr>
                                        );
                                    })}
                                </tbody>
                            </table>
                          ) : (
                            <table className="w-full divide-y divide-gray-200 dark:divide-gray-700" style={{ tableLayout: 'auto' }}>
                                <colgroup>
                                    <col style={{ minWidth: '90px', width: '5%' }} />
                                    <col style={{ minWidth: '250px' }} />
                                    <col style={{ minWidth: '140px', width: '9%' }} />
                                    <col style={{ minWidth: '100px', width: '6%' }} />
                                    <col style={{ minWidth: '80px', width: '5%' }} />
                                    <col style={{ minWidth: '90px', width: '6%' }} />
                                    <col style={{ minWidth: '90px', width: '6%' }} />
                                    <col style={{ minWidth: '60px', width: '4%' }} />
                                    <col style={{ minWidth: '140px', width: '10%' }} />
                                    <col style={{ minWidth: '140px', width: '10%' }} />
                                    <col style={{ minWidth: '140px', width: '10%' }} />
                                    <col style={{ minWidth: '180px', width: '12%' }} />
                                    <col style={{ minWidth: '70px', width: '4%' }} />
                                </colgroup>
                                <thead ref={theadRef} className="bg-gray-50 dark:bg-gray-700/50">
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
                                        <th className="px-4 py-3 text-center text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider whitespace-nowrap" title="Trainer matches Google Calendar attendee">Cal</th>
                                        <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider whitespace-nowrap">Next Trainer</th>
                                        <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider whitespace-nowrap">Invite Next Trainer</th>
                                        <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider"></th>
                                    </tr>
                                </thead>
                                <tbody className="bg-white dark:bg-gray-800 divide-y divide-gray-200 dark:divide-gray-700">
                                    {upcomingClasses.map((classItem, index) => {
                                        const classType = classItem.classType || 'Physical';
                                        return (
                                        <tr key={index} className="border-b dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-700/50">
                                            <td className="px-4 py-2 whitespace-nowrap text-sm text-gray-700 dark:text-gray-200">{classItem.courseRunId}</td>
                                            <td className="px-4 py-2 text-sm font-medium overflow-hidden text-ellipsis"><button type="button" onClick={() => handleViewDetails(classItem)} className="text-left text-blue-600 dark:text-blue-400 hover:underline">{classItem.courseTitle}</button></td>
                                            <td className="px-4 py-2 whitespace-nowrap text-sm text-gray-700 dark:text-gray-200">{classItem.courseCode}</td>
                                            <td className="px-4 py-2 whitespace-nowrap text-sm">
                                                <select
                                                    value={classItem.classStatus === 'Cancelled' ? 'Cancelled' : classItem.classStatus === 'Unconfirmed' ? 'Unconfirmed' : 'auto'}
                                                    onChange={async (e) => {
                                                        // Two-option dropdown: "Pending/Confirmed" (auto-derived from local trainer)
                                                        // or "Cancelled" (manual sticky override). When switching off Cancelled,
                                                        // compute the auto-derived value client-side so the UI updates optimistically.
                                                        const selection = e.target.value;
                                                        const hasLocalTrainer = !!(classItem.assignedTrainerLocal || '').trim();
                                                        const hasTpgTrainer = !!(classItem.assignedTrainerTpg || '').trim();
                                                        const newStatus = (selection === 'Cancelled' || selection === 'Unconfirmed')
                                                            ? selection
                                                            : ((hasLocalTrainer || hasTpgTrainer) ? 'Confirmed' : 'Pending');
                                                        try {
                                                            await fetch(getApiUrl('/api/admin/upcoming-classes'), {
                                                                method: 'PUT',
                                                                headers: { 'Content-Type': 'application/json' },
                                                                body: JSON.stringify({ id: classItem.id, class_status: newStatus }),
                                                            });
                                                            setUpcomingClasses(prev => prev.map(c => c.id === classItem.id ? { ...c, classStatus: newStatus } : c));
                                                        } catch { /* silent */ }
                                                    }}
                                                    className={`text-xs font-semibold rounded-full px-2 py-1 border-0 cursor-pointer focus:ring-2 focus:ring-blue-500 text-center ${getStatusColor(classItem.classStatus)}`}
                                                    style={{ width: '120px', textAlignLast: 'center' }}
                                                >
                                                    {classItem.classStatus === 'Cancelled' ? (
                                                        <>
                                                            <option value="Cancelled" className="text-left">Cancelled</option>
                                                            <option value="auto" className="text-left">Confirmed/Pending</option>
                                                            <option value="Unconfirmed" className="text-left">Unconfirmed</option>
                                                        </>
                                                    ) : classItem.classStatus === 'Unconfirmed' ? (
                                                        <>
                                                            <option value="Unconfirmed" className="text-left">Unconfirmed</option>
                                                            <option value="auto" className="text-left">Confirmed/Pending</option>
                                                            <option value="Cancelled" className="text-left">Cancelled</option>
                                                        </>
                                                    ) : (
                                                        <>
                                                            <option value="auto" className="text-left">{classItem.classStatus}</option>
                                                            <option value="Cancelled" className="text-left">Cancelled</option>
                                                            <option value="Unconfirmed" className="text-left">Unconfirmed</option>
                                                        </>
                                                    )}
                                                </select>
                                            </td>
                                            <td className="px-4 py-2 whitespace-nowrap text-sm">
                                                <span className={`px-2 py-0.5 inline-flex text-xs leading-5 font-semibold rounded-full ${classType === 'Virtual' ? 'bg-blue-100 text-blue-800 dark:bg-blue-900/40 dark:text-blue-300' : classType === 'Hybrid' ? 'bg-purple-100 text-purple-800 dark:bg-purple-900/40 dark:text-purple-300' : classType === 'External' ? 'bg-cyan-100 text-cyan-800 dark:bg-cyan-900/40 dark:text-cyan-300' : 'bg-gray-100 text-gray-700 dark:bg-gray-700 dark:text-gray-300'}`}>{classType}</span>
                                            </td>
                                            <td className="px-4 py-2 whitespace-nowrap text-sm text-gray-700 dark:text-gray-200">{formatDate(classItem.startDate)}</td>
                                            <td className="px-4 py-2 whitespace-nowrap text-sm text-gray-700 dark:text-gray-200">{formatDate(classItem.endDate)}</td>
                                            <td className="px-4 py-2 whitespace-nowrap text-sm text-center text-gray-700 dark:text-gray-200">{classItem.numOfTrainee}</td>
                                            <td className="px-4 py-2 whitespace-nowrap text-sm text-gray-700 dark:text-gray-200">{renderTrainerCell(classItem.assignedTrainerTpg, classItem.assignedTrainerTpgEmail)}</td>
                                            <td className="px-4 py-2 whitespace-nowrap text-sm text-gray-700 dark:text-gray-200">{renderTrainerCell(classItem.assignedTrainerLocal, classItem.assignedTrainerLocalEmail)}</td>
                                            <td className="px-4 py-2 whitespace-nowrap text-sm text-center">
                                                {classItem.trainerInCalendar === true ? (
                                                    <span className="text-green-500" title="Trainer matches calendar">✓</span>
                                                ) : classItem.trainerInCalendar === false ? (
                                                    <span className="text-red-500" title="Trainer not in calendar">✗</span>
                                                ) : (
                                                    <span className="text-gray-400" title="Not checked yet">—</span>
                                                )}
                                            </td>
                                            <td className="px-4 py-2 text-sm text-gray-700 dark:text-gray-200">
                                                {classItem.nextAvailableTrainer ? (() => {
                                                    const courseTrainers = splitTrainerList(classItem.trainersList);
                                                    return (
                                                        <select
                                                            value={nextTrainerOverrides[classItem.id] ?? classItem.nextAvailableTrainer}
                                                            onChange={e => setNextTrainerOverrides(prev => ({ ...prev, [classItem.id]: e.target.value }))}
                                                            className="w-full min-w-[160px] border border-gray-300 dark:border-gray-600 rounded-md px-2 py-1 text-xs bg-white dark:bg-gray-700 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
                                                        >
                                                            <option value="">-- Reassign Trainer --</option>
                                                            {courseTrainers.map(name => (
                                                                <option key={name} value={name}>{name}</option>
                                                            ))}
                                                        </select>
                                                    );
                                                })() : (
                                                    <span className="text-gray-400 text-xs italic">—</span>
                                                )}
                                            </td>
                                            <td className="px-4 py-2 whitespace-nowrap text-sm text-gray-700 dark:text-gray-200">
                                                <div className="flex items-center gap-2">
                                                    <Button
                                                        variant="secondary"
                                                        size="sm"
                                                        onClick={() => handleSendTrainerInvitation(classItem)}
                                                        disabled={!(nextTrainerOverrides[classItem.id] || classItem.nextAvailableTrainer) || sendingInvitationFor === classItem.id}
                                                        title={classItem.latestInvitationStatus === 'pending' ? 'Resend invitation (overwrites the previous pending one)' : 'Send trainer invitation'}
                                                    >
                                                        {sendingInvitationFor === classItem.id ? (
                                                            <Icon name={IconName.Spinner} className="w-3.5 h-3.5 animate-spin" />
                                                        ) : (
                                                            <>
                                                                <Icon name={IconName.Send} className="w-3.5 h-3.5 mr-1" />
                                                                {classItem.latestInvitationStatus === 'pending' ? 'RESEND' : 'SEND INVITE'}
                                                            </>
                                                        )}
                                                    </Button>
                                                    {(classItem.latestInvitationStatus === 'accepted' || classItem.latestInvitationStatus === 'declined' || classItem.latestInvitationStatus === 'blocked' || classItem.latestInvitationStatus === 'pending') && (
                                                        <span className={`inline-flex px-2 py-0.5 text-xs font-semibold rounded-full ${
                                                            classItem.latestInvitationStatus === 'accepted' ? 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-300'
                                                            : (classItem.latestInvitationStatus === 'declined' || classItem.latestInvitationStatus === 'blocked') ? 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-300'
                                                            : 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300'
                                                            }`}>
                                                            {classItem.latestInvitationStatus === 'blocked' ? 'Declined' : classItem.latestInvitationStatus.charAt(0).toUpperCase() + classItem.latestInvitationStatus.slice(1)}
                                                        </span>
                                                    )}
                                                </div>
                                            </td>
                                            <td className="px-4 py-2 whitespace-nowrap text-sm font-medium">
                                                <Button
                                                    variant="primary"
                                                    size="sm"
                                                    onClick={() => handleEditClass(classItem)}
                                                >
                                                    <Icon name={IconName.Edit} className="w-4 h-4 mr-1" />
                                                    Edit
                                                </Button>
                                            </td>
                                        </tr>
                                        );
                                    })}
                                </tbody>
                            </table>
                          )}
                        </div>

                        {/* Pagination */}
                        {totalPages > 1 && (
                            <div className="flex justify-between items-center mt-6">
                                <p className="text-sm text-gray-500 dark:text-gray-400">
                                    Showing {currentPage * ITEMS_PER_PAGE + 1} to {Math.min((currentPage + 1) * ITEMS_PER_PAGE, totalCount)} of {totalCount} classes
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
                        {/* Sticky header + scrollbar */}
                        <StickyHeader tableRef={tableScrollRef} theadRef={theadRef} />
                        <StickyScrollbar tableRef={tableScrollRef} />
                    </>
                )}
            </Card>
            {/* Bulk Invite Preview Modal */}
            {showBulkPreview && (
                <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
                    <div className="bg-white dark:bg-gray-800 rounded-lg shadow-xl w-full max-w-4xl max-h-[85vh] flex flex-col border dark:border-gray-700">
                        <div className="p-4 border-b dark:border-gray-700">
                            <div className="flex items-center justify-between mb-3">
                                <div>
                                    <h3 className="text-lg font-semibold text-gray-900 dark:text-white">Preview: Bulk Trainer Invitations</h3>
                                    <p className="text-sm text-gray-500 dark:text-gray-400 mt-0.5">
                                        {bulkPreviewData.filter(p => p.canSend).length} sendable / {bulkPreviewData.length} total course runs with no local trainer
                                    </p>
                                </div>
                                <button onClick={() => setShowBulkPreview(false)} className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 text-xl">&times;</button>
                            </div>
                            <div className="flex items-center gap-3">
                                <label className="text-xs text-gray-500 dark:text-gray-400">From</label>
                                <input
                                    type="date"
                                    value={bulkDateFrom}
                                    onChange={(e) => {
                                        setBulkDateFrom(e.target.value);
                                        // Auto-refresh on date change
                                        const from = e.target.value;
                                        const to = bulkDateTo;
                                        setBulkPreviewLoading(true);
                                        const params = new URLSearchParams();
                                        if (from) params.set('dateFrom', from);
                                        if (to) params.set('dateTo', to);
                                        fetch(getApiUrl(`/api/admin/preview-bulk-trainer-invitations?${params.toString()}`))
                                            .then(r => r.json())
                                            .then(data => {
                                                if (data.success) {
                                                    setBulkPreviewData(data.preview || []);
                                                    const sendable = (data.preview || []).filter((p: any) => p.canSend && p.confirmedEnrolments > 0);
                                                    setBulkSelected(new Set(sendable.map((p: any) => p.courseRunUuid)));
                                                }
                                            })
                                            .catch(() => {})
                                            .finally(() => setBulkPreviewLoading(false));
                                    }}
                                    className="px-2 py-1 text-sm border border-gray-300 dark:border-gray-600 rounded bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
                                />
                                <label className="text-xs text-gray-500 dark:text-gray-400">To</label>
                                <input
                                    type="date"
                                    value={bulkDateTo}
                                    onChange={(e) => {
                                        setBulkDateTo(e.target.value);
                                        const from = bulkDateFrom;
                                        const to = e.target.value;
                                        setBulkPreviewLoading(true);
                                        const params = new URLSearchParams();
                                        if (from) params.set('dateFrom', from);
                                        if (to) params.set('dateTo', to);
                                        fetch(getApiUrl(`/api/admin/preview-bulk-trainer-invitations?${params.toString()}`))
                                            .then(r => r.json())
                                            .then(data => {
                                                if (data.success) {
                                                    setBulkPreviewData(data.preview || []);
                                                    const sendable = (data.preview || []).filter((p: any) => p.canSend && p.confirmedEnrolments > 0);
                                                    setBulkSelected(new Set(sendable.map((p: any) => p.courseRunUuid)));
                                                }
                                            })
                                            .catch(() => {})
                                            .finally(() => setBulkPreviewLoading(false));
                                    }}
                                    className="px-2 py-1 text-sm border border-gray-300 dark:border-gray-600 rounded bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
                                />
                            </div>
                        </div>
                        <div className="flex-1 overflow-auto p-4">
                            {bulkPreviewData.length === 0 ? (
                                <p className="text-sm text-gray-500 dark:text-gray-400">No eligible course runs found in the lookahead window.</p>
                            ) : (
                                <table className="w-full text-sm">
                                    <thead>
                                        <tr className="text-left text-xs text-gray-500 dark:text-gray-400 border-b dark:border-gray-700">
                                            <th className="pb-2 pr-2 w-8">
                                                <input
                                                    type="checkbox"
                                                    checked={bulkSelected.size === bulkPreviewData.filter(p => p.canSend && p.confirmedEnrolments > 0).length && bulkSelected.size > 0}
                                                    onChange={(e) => {
                                                        if (e.target.checked) {
                                                            setBulkSelected(new Set(bulkPreviewData.filter(p => p.canSend && p.confirmedEnrolments > 0).map(p => p.courseRunUuid)));
                                                        } else {
                                                            setBulkSelected(new Set());
                                                        }
                                                    }}
                                                    className="rounded"
                                                />
                                            </th>
                                            <th className="pb-2 pr-2">Course Run</th>
                                            <th className="pb-2 pr-2">Course Title</th>
                                            <th className="pb-2 pr-2">Start Date</th>
                                            <th className="pb-2 pr-2 text-center">Enrolments</th>
                                            <th className="pb-2 pr-2">Trainer</th>
                                            <th className="pb-2">Email</th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {bulkPreviewData.map((item: any) => (
                                            <tr
                                                key={item.courseRunUuid}
                                                className={`border-b dark:border-gray-700/50 ${!item.canSend ? 'opacity-50' : ''}`}
                                            >
                                                <td className="py-2 pr-2">
                                                    <input
                                                        type="checkbox"
                                                        checked={bulkSelected.has(item.courseRunUuid)}
                                                        disabled={!item.canSend}
                                                        onChange={(e) => {
                                                            const next = new Set(bulkSelected);
                                                            if (e.target.checked) next.add(item.courseRunUuid);
                                                            else next.delete(item.courseRunUuid);
                                                            setBulkSelected(next);
                                                        }}
                                                        className="rounded"
                                                    />
                                                </td>
                                                <td className="py-2 pr-2 font-mono text-xs">{item.courseRunId}</td>
                                                <td className="py-2 pr-2 max-w-[200px] truncate" title={item.courseTitle}>{item.courseTitle}</td>
                                                <td className="py-2 pr-2 whitespace-nowrap">{item.startDate ? new Date(item.startDate).toLocaleDateString('en-SG') : '—'}</td>
                                                <td className="py-2 pr-2 text-center">
                                                    {item.confirmedEnrolments > 0 ? (
                                                        <span className="text-gray-900 dark:text-white">{item.confirmedEnrolments}</span>
                                                    ) : (
                                                        <span className="text-xs text-amber-500" title="No confirmed enrolments">0</span>
                                                    )}
                                                </td>
                                                <td className="py-2 pr-2">
                                                    {item.canSend ? (
                                                        <span className="text-gray-900 dark:text-white">{item.nextTrainer}</span>
                                                    ) : (
                                                        <span className="text-xs text-gray-400 italic">{item.reason}</span>
                                                    )}
                                                </td>
                                                <td className="py-2 text-xs text-gray-500 dark:text-gray-400">{item.nextEmail || '—'}</td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                            )}
                        </div>
                        <div className="p-4 border-t dark:border-gray-700 flex items-center justify-between">
                            <span className="text-sm text-gray-500 dark:text-gray-400">
                                {bulkSelected.size} selected
                            </span>
                            <div className="flex items-center gap-2">
                                <Button variant="secondary" size="sm" onClick={() => setShowBulkPreview(false)}>Cancel</Button>
                                <Button
                                    variant="primary"
                                    size="sm"
                                    disabled={bulkSelected.size === 0 || bulkSending}
                                    onClick={async () => {
                                        setBulkSending(true);
                                        setActionMessage(null);
                                        try {
                                            const res = await fetch(getApiUrl('/api/admin/run-auto-send-trainer-invitations'), {
                                                method: 'POST',
                                                headers: { 'Content-Type': 'application/json' },
                                                body: JSON.stringify({ courseRunUuids: Array.from(bulkSelected) }),
                                            });
                                            const data = await res.json();
                                            if (data.success) {
                                                setActionMessage({ type: 'success', text: `Sent ${data.sent || 0} invitation(s), skipped ${data.skipped || 0}, errors ${data.errors || 0}` });
                                                setShowBulkPreview(false);
                                                fetchUpcomingClasses();
                                            } else {
                                                setActionMessage({ type: 'error', text: data.error || 'Failed to send invitations' });
                                            }
                                        } catch {
                                            setActionMessage({ type: 'error', text: 'Failed to send invitations' });
                                        } finally {
                                            setBulkSending(false);
                                        }
                                    }}
                                >
                                    <Icon name={IconName.Send} className="w-4 h-4 mr-1" />
                                    {bulkSending ? 'Sending...' : `Send ${bulkSelected.size} Invitation${bulkSelected.size !== 1 ? 's' : ''}`}
                                </Button>
                            </div>
                        </div>
                    </div>
                </div>
            )}

            {/* Bulk TPG Assign Preview Modal */}
            {showTpgPreview && (
                <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
                    <div className="bg-white dark:bg-gray-800 rounded-lg shadow-xl w-full max-w-5xl max-h-[85vh] flex flex-col border dark:border-gray-700">
                        <div className="p-4 border-b dark:border-gray-700">
                            <div className="flex items-center justify-between mb-3">
                                <div>
                                    <h3 className="text-lg font-semibold text-gray-900 dark:text-white">Preview: Assign Trainers to TPG</h3>
                                    <p className="text-sm text-gray-500 dark:text-gray-400 mt-0.5">
                                        {tpgPreviewData.filter(p => p.canAssign).length} assignable / {tpgPreviewData.length} total course runs with no TPG trainer
                                    </p>
                                </div>
                                <button onClick={() => setShowTpgPreview(false)} className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 text-xl">&times;</button>
                            </div>
                            <div className="flex items-center gap-3">
                                <label className="text-xs text-gray-500 dark:text-gray-400">From</label>
                                <input type="date" value={tpgDateFrom} onChange={(e) => {
                                    setTpgDateFrom(e.target.value);
                                    setTpgPreviewLoading(true);
                                    const params = new URLSearchParams();
                                    if (e.target.value) params.set('dateFrom', e.target.value);
                                    if (tpgDateTo) params.set('dateTo', tpgDateTo);
                                    fetch(getApiUrl(`/api/admin/preview-bulk-tpg-assign?${params.toString()}`))
                                        .then(r => r.json())
                                        .then(data => {
                                            if (data.success) {
                                                setTpgPreviewData(data.preview || []);
                                                setTpgSelected(new Set((data.preview || []).filter((p: any) => p.canAssign).map((p: any) => p.courseRunUuid)));
                                            }
                                        })
                                        .catch(() => {})
                                        .finally(() => setTpgPreviewLoading(false));
                                }} className="px-2 py-1 text-sm border border-gray-300 dark:border-gray-600 rounded bg-white dark:bg-gray-700 text-gray-900 dark:text-white" />
                                <label className="text-xs text-gray-500 dark:text-gray-400">To</label>
                                <input type="date" value={tpgDateTo} onChange={(e) => {
                                    setTpgDateTo(e.target.value);
                                    setTpgPreviewLoading(true);
                                    const params = new URLSearchParams();
                                    if (tpgDateFrom) params.set('dateFrom', tpgDateFrom);
                                    if (e.target.value) params.set('dateTo', e.target.value);
                                    fetch(getApiUrl(`/api/admin/preview-bulk-tpg-assign?${params.toString()}`))
                                        .then(r => r.json())
                                        .then(data => {
                                            if (data.success) {
                                                setTpgPreviewData(data.preview || []);
                                                setTpgSelected(new Set((data.preview || []).filter((p: any) => p.canAssign).map((p: any) => p.courseRunUuid)));
                                            }
                                        })
                                        .catch(() => {})
                                        .finally(() => setTpgPreviewLoading(false));
                                }} className="px-2 py-1 text-sm border border-gray-300 dark:border-gray-600 rounded bg-white dark:bg-gray-700 text-gray-900 dark:text-white" />
                            </div>
                        </div>
                        <div className="flex-1 overflow-auto p-4">
                            {tpgPreviewData.length === 0 ? (
                                <p className="text-sm text-gray-500 dark:text-gray-400">No eligible course runs found.</p>
                            ) : (
                                <table className="w-full text-sm">
                                    <thead>
                                        <tr className="text-left text-xs text-gray-500 dark:text-gray-400 border-b dark:border-gray-700">
                                            <th className="pb-2 pr-2 w-8">
                                                <input type="checkbox"
                                                    checked={tpgSelected.size === tpgPreviewData.filter(p => p.canAssign).length && tpgSelected.size > 0}
                                                    onChange={(e) => {
                                                        if (e.target.checked) setTpgSelected(new Set(tpgPreviewData.filter(p => p.canAssign).map(p => p.courseRunUuid)));
                                                        else setTpgSelected(new Set());
                                                    }}
                                                    className="rounded"
                                                />
                                            </th>
                                            <th className="pb-2 pr-2">Course Run</th>
                                            <th className="pb-2 pr-2">Course Title</th>
                                            <th className="pb-2 pr-2">Start Date</th>
                                            <th className="pb-2 pr-2">Status</th>
                                            <th className="pb-2 pr-2">Trainer</th>
                                            <th className="pb-2">NRIC</th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {tpgPreviewData.map((item: any) => {
                                            const primary = item.localTrainers?.[0];
                                            const nricKey = item.courseRunUuid;
                                            const isRevealed = revealedNrics.has(nricKey);
                                            return (
                                                <tr key={item.courseRunUuid} className={`border-b dark:border-gray-700/50 ${!item.canAssign ? 'opacity-50' : ''}`}>
                                                    <td className="py-2 pr-2">
                                                        <input type="checkbox" checked={tpgSelected.has(item.courseRunUuid)} disabled={!item.canAssign}
                                                            onChange={(e) => {
                                                                const next = new Set(tpgSelected);
                                                                if (e.target.checked) next.add(item.courseRunUuid);
                                                                else next.delete(item.courseRunUuid);
                                                                setTpgSelected(next);
                                                            }}
                                                            className="rounded"
                                                        />
                                                    </td>
                                                    <td className="py-2 pr-2 font-mono text-xs">{item.courseRunId}</td>
                                                    <td className="py-2 pr-2 max-w-[200px] truncate" title={item.courseTitle}>{item.courseTitle}</td>
                                                    <td className="py-2 pr-2 whitespace-nowrap">{item.startDate ? new Date(item.startDate).toLocaleDateString('en-SG') : '—'}</td>
                                                    <td className="py-2 pr-2">
                                                        <span className={`px-1.5 py-0.5 text-[10px] font-semibold rounded ${
                                                            item.classStatus === 'Confirmed' ? 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300' :
                                                            item.classStatus === 'Pending' ? 'bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-300' :
                                                            'bg-gray-100 text-gray-500 dark:bg-gray-700 dark:text-gray-400'
                                                        }`}>{item.classStatus || '—'}</span>
                                                    </td>
                                                    <td className="py-2 pr-2">
                                                        {item.localTrainers?.length > 0 ? (
                                                            <div>
                                                                {item.localTrainers.map((t: any, i: number) => (
                                                                    <div key={i} className={`${i === 0 ? 'font-medium text-gray-900 dark:text-white' : 'text-xs text-gray-400'}`}>
                                                                        {t.name}{i === 0 && item.localTrainers.length > 1 && ' (primary)'}
                                                                    </div>
                                                                ))}
                                                            </div>
                                                        ) : (
                                                            <span className="text-xs text-gray-400 italic">{item.reason}</span>
                                                        )}
                                                    </td>
                                                    <td className="py-2">
                                                        {primary?.hasNric ? (
                                                            <div className="flex items-center gap-1.5">
                                                                <span className="font-mono text-xs">{isRevealed ? primary.nric : primary.maskedNric}</span>
                                                                <button
                                                                    onClick={() => {
                                                                        const next = new Set(revealedNrics);
                                                                        if (isRevealed) next.delete(nricKey);
                                                                        else next.add(nricKey);
                                                                        setRevealedNrics(next);
                                                                    }}
                                                                    className="text-gray-400 hover:text-gray-200 text-xs"
                                                                    title={isRevealed ? 'Hide NRIC' : 'Reveal NRIC'}
                                                                >
                                                                    {isRevealed ? '🙈' : '👁️'}
                                                                </button>
                                                            </div>
                                                        ) : (
                                                            <span className="text-xs text-amber-500">{primary ? 'No NRIC' : '—'}</span>
                                                        )}
                                                    </td>
                                                </tr>
                                            );
                                        })}
                                    </tbody>
                                </table>
                            )}
                        </div>
                        <div className="p-4 border-t dark:border-gray-700 flex items-center justify-between">
                            <span className="text-sm text-gray-500 dark:text-gray-400">{tpgSelected.size} selected</span>
                            <div className="flex items-center gap-2">
                                <Button variant="secondary" size="sm" onClick={() => setShowTpgPreview(false)}>Cancel</Button>
                                <Button
                                    variant="primary"
                                    size="sm"
                                    disabled={tpgSelected.size === 0 || tpgSending}
                                    onClick={async () => {
                                        setTpgSending(true);
                                        setActionMessage(null);
                                        try {
                                            const items = tpgPreviewData
                                                .filter(p => tpgSelected.has(p.courseRunUuid) && p.canAssign)
                                                .map(p => ({
                                                    courseRunUuid: p.courseRunUuid,
                                                    trainerName: p.localTrainers[0]?.name,
                                                    trainerEmail: p.localTrainers[0]?.email,
                                                    nric: p.localTrainers[0]?.nric,
                                                }));
                                            const res = await fetch(getApiUrl('/api/admin/run-bulk-tpg-assign'), {
                                                method: 'POST',
                                                headers: { 'Content-Type': 'application/json' },
                                                body: JSON.stringify({ items }),
                                            });
                                            const data = await res.json();
                                            if (data.success) {
                                                setActionMessage({ type: 'success', text: `TPG assigned: ${data.sent || 0} success, ${data.skipped || 0} skipped, ${data.errors || 0} errors` });
                                                setShowTpgPreview(false);
                                                fetchUpcomingClasses();
                                            } else {
                                                setActionMessage({ type: 'error', text: data.error || 'Failed to assign to TPG' });
                                            }
                                        } catch {
                                            setActionMessage({ type: 'error', text: 'Failed to assign to TPG' });
                                        } finally {
                                            setTpgSending(false);
                                        }
                                    }}
                                >
                                    {tpgSending ? 'Assigning...' : `Assign ${tpgSelected.size} to TPG`}
                                </Button>
                            </div>
                        </div>
                    </div>
                </div>
            )}

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

            {/* Calendar Sync Modal */}
            {showCalendarModal && (
                <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4" onClick={(e) => { if (e.target === e.currentTarget && !calSyncing) setShowCalendarModal(false); }}>
                    <div className="bg-white dark:bg-gray-800 rounded-lg shadow-xl w-full max-w-lg">
                        <div className="p-6">
                            <div className="flex justify-between items-center mb-4">
                                <h3 className="text-lg font-semibold text-gray-900 dark:text-white">Sync with Google Calendar</h3>
                                <button onClick={() => !calSyncing && setShowCalendarModal(false)} className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 text-2xl leading-none">&times;</button>
                            </div>
                            <p className="text-sm text-gray-500 dark:text-gray-400 mb-4">
                                Check Google Calendar events in the date range. Events with <code className="bg-gray-100 dark:bg-gray-700 px-1 rounded text-xs">[VIRTUAL]</code> in the title will have their class type set to Virtual and Google Meet link saved.
                            </p>

                            <div className="grid grid-cols-2 gap-4 mb-4">
                                <div>
                                    <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Start Date</label>
                                    <input
                                        type="date"
                                        value={calSyncStartDate}
                                        onChange={e => setCalSyncStartDate(e.target.value)}
                                        disabled={calSyncing}
                                        className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 dark:bg-gray-700 dark:border-gray-600 dark:text-white text-sm disabled:opacity-50"
                                    />
                                </div>
                                <div>
                                    <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">End Date</label>
                                    <input
                                        type="date"
                                        value={calSyncEndDate}
                                        onChange={e => setCalSyncEndDate(e.target.value)}
                                        disabled={calSyncing}
                                        className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 dark:bg-gray-700 dark:border-gray-600 dark:text-white text-sm disabled:opacity-50"
                                    />
                                </div>
                            </div>

                            {/* Sync progress */}
                            {calSyncing && (
                                <div className="flex items-center gap-3 mb-4 p-3 bg-blue-50 dark:bg-blue-900/20 rounded-md">
                                    <div className="animate-spin rounded-full h-5 w-5 border-b-2 border-blue-600"></div>
                                    <span className="text-sm text-blue-700 dark:text-blue-300">Syncing calendar events...</span>
                                </div>
                            )}

                            {/* Results */}
                            {calSyncResult && (
                                <div className="mb-4">
                                    {calSyncResult.success ? (
                                        <>
                                            <div className="grid grid-cols-3 gap-3 mb-3">
                                                <div className="bg-blue-50 dark:bg-blue-900/30 rounded-lg p-2 text-center">
                                                    <p className="text-lg font-bold text-blue-600">{calSyncResult.summary?.totalEvents || 0}</p>
                                                    <p className="text-[10px] text-gray-500 dark:text-gray-400">Total Events</p>
                                                </div>
                                                <div className="bg-purple-50 dark:bg-purple-900/30 rounded-lg p-2 text-center">
                                                    <p className="text-lg font-bold text-purple-600">{calSyncResult.summary?.virtualEvents || 0}</p>
                                                    <p className="text-[10px] text-gray-500 dark:text-gray-400">Virtual Events</p>
                                                </div>
                                                <div className="bg-green-50 dark:bg-green-900/30 rounded-lg p-2 text-center">
                                                    <p className="text-lg font-bold text-green-600">{calSyncResult.summary?.updated || 0}</p>
                                                    <p className="text-[10px] text-gray-500 dark:text-gray-400">Classes Updated</p>
                                                </div>
                                            </div>

                                            {calSyncResult.results?.length > 0 && (
                                                <div className="max-h-48 overflow-y-auto border dark:border-gray-700 rounded-md">
                                                    <table className="w-full text-xs">
                                                        <thead className="bg-gray-50 dark:bg-gray-700/50 sticky top-0">
                                                            <tr>
                                                                <th className="px-2 py-1.5 text-left text-gray-500 dark:text-gray-400">Run ID</th>
                                                                <th className="px-2 py-1.5 text-left text-gray-500 dark:text-gray-400">Course</th>
                                                                <th className="px-2 py-1.5 text-center text-gray-500 dark:text-gray-400">Status</th>
                                                            </tr>
                                                        </thead>
                                                        <tbody className="divide-y divide-gray-200 dark:divide-gray-700">
                                                            {calSyncResult.results.map((r: any, i: number) => (
                                                                <tr key={i}>
                                                                    <td className="px-2 py-1 text-gray-700 dark:text-gray-300 font-mono">{r.courseRunId || '—'}</td>
                                                                    <td className="px-2 py-1 text-gray-700 dark:text-gray-300 truncate max-w-[200px]">{r.courseTitle || r.event || '—'}</td>
                                                                    <td className="px-2 py-1 text-center">
                                                                        {r.changes ? (
                                                                            <span className="text-green-600 font-medium">Updated</span>
                                                                        ) : r.status === 'no_match' ? (
                                                                            <span className="text-yellow-500">No match</span>
                                                                        ) : (
                                                                            <span className="text-gray-400">Already virtual</span>
                                                                        )}
                                                                    </td>
                                                                </tr>
                                                            ))}
                                                        </tbody>
                                                    </table>
                                                </div>
                                            )}

                                            {calSyncResult.summary?.virtualEvents === 0 && (
                                                <p className="text-sm text-gray-500 dark:text-gray-400 text-center py-2">No [VIRTUAL] events found in the date range.</p>
                                            )}
                                        </>
                                    ) : (
                                        <div className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-700 rounded-md p-3 text-sm text-red-700 dark:text-red-300">
                                            {calSyncResult.error || calSyncResult.message || 'Sync failed.'}
                                        </div>
                                    )}
                                </div>
                            )}

                            <div className="flex gap-3 justify-end">
                                <Button variant="ghost" onClick={() => setShowCalendarModal(false)} disabled={calSyncing}>
                                    {calSyncResult?.success ? 'Done' : 'Cancel'}
                                </Button>
                                {!calSyncResult && (
                                    <Button variant="primary" onClick={handleCalendarSync} disabled={calSyncing}>
                                        {calSyncing ? 'Syncing...' : 'Sync Now'}
                                    </Button>
                                )}
                            </div>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
};
