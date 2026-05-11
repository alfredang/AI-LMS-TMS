import { getApiUrl, getFileUrl } from '@/lib/urlHelpers';
import React, { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { Card } from '../ui/Card';
import { Button } from '../ui/Button';
import { useLms } from '@contexts/LmsContext';
import { AdminPage } from '@app-types';

// Searchable select dropdown component
const SearchableSelect: React.FC<{
    options: { value: string; label: string }[];
    value: string;
    onChange: (value: string) => void;
    placeholder?: string;
    className?: string;
}> = ({ options, value, onChange, placeholder = '— Search or select —', className }) => {
    const [query, setQuery] = useState('');
    const [open, setOpen] = useState(false);
    const ref = useRef<HTMLDivElement>(null);

    // Find selected label
    const selectedOption = options.find(o => o.value === value);

    // Close on outside click
    useEffect(() => {
        const handler = (e: MouseEvent) => {
            if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
        };
        document.addEventListener('mousedown', handler);
        return () => document.removeEventListener('mousedown', handler);
    }, []);

    const filtered = query
        ? options.filter(o => o.label.toLowerCase().includes(query.toLowerCase()))
        : options;

    return (
        <div ref={ref} className="relative">
            <input
                type="text"
                className={className}
                placeholder={selectedOption ? selectedOption.label : placeholder}
                value={open ? query : (selectedOption ? selectedOption.label : '')}
                onChange={e => { setQuery(e.target.value); setOpen(true); if (!e.target.value) onChange(''); }}
                onFocus={() => { setOpen(true); setQuery(''); }}
            />
            {open && (
                <div className="absolute z-50 mt-1 w-full max-h-48 overflow-y-auto bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-600 rounded-md shadow-lg">
                    {filtered.length === 0 ? (
                        <div className="px-3 py-2 text-sm text-gray-500 dark:text-gray-400 italic">No results found</div>
                    ) : (
                        filtered.map(o => (
                            <div
                                key={o.value}
                                className={`px-3 py-2 text-sm cursor-pointer hover:bg-blue-50 dark:hover:bg-blue-900/30 ${o.value === value ? 'bg-blue-100 dark:bg-blue-900/50 font-medium' : 'text-gray-900 dark:text-gray-100'}`}
                                onMouseDown={e => { e.preventDefault(); onChange(o.value); setQuery(''); setOpen(false); }}
                            >
                                {o.label}
                            </div>
                        ))
                    )}
                </div>
            )}
        </div>
    );
};

// Import SSG constants for ViewCourseSessions
enum Month {
    JANUARY = 1,
    FEBRUARY = 2,
    MARCH = 3,
    APRIL = 4,
    MAY = 5,
    JUNE = 6,
    JULY = 7,
    AUGUST = 8,
    SEPTEMBER = 9,
    OCTOBER = 10,
    NOVEMBER = 11,
    DECEMBER = 12
}

const MonthNames = {
    [Month.JANUARY]: 'January',
    [Month.FEBRUARY]: 'February',
    [Month.MARCH]: 'March',
    [Month.APRIL]: 'April',
    [Month.MAY]: 'May',
    [Month.JUNE]: 'June',
    [Month.JULY]: 'July',
    [Month.AUGUST]: 'August',
    [Month.SEPTEMBER]: 'September',
    [Month.OCTOBER]: 'October',
    [Month.NOVEMBER]: 'November',
    [Month.DECEMBER]: 'December'
};

// Types and enums for form data
export enum OptionalSelector {
    YES = 'true',
    NO = 'false'
}

interface EditRunInfo {
    courseReferenceNumber: string;
    sequenceNumber?: number;
    openingRegistrationDate?: string;
    closingRegistrationDate?: string;
    courseStartDate?: string;
    courseEndDate?: string;
    scheduleInfo?: string;
    block?: string;
    street?: string;
    floor?: string;
    unit?: string;
    building?: string;
    postalCode?: string;
    room?: string;
    wheelChairAccess?: OptionalSelector;
    intakeSize?: number;
    threshold?: number;
    registeredUserCount?: number;
    modeOfTraining?: string;
    courseAdminEmail?: string;
    courseVacancy?: {
        code: string;
        description?: string;
    };
}

interface ClassManagerViewProps {
    courseToEdit?: any | null;
    viewOnly?: boolean;
}

// FormSection component definition moved outside to prevent re-creation on re-renders
const FormSection: React.FC<{ title: string; children: React.ReactNode }> = ({ title, children }) => (
    <Card className="p-6 dark:bg-gray-800 dark:border-gray-700">
        <h3 className="text-xl font-bold mb-4 dark:text-white">{title}</h3>
        <div className="space-y-4">{children}</div>
    </Card>
);

export const ClassManagerView: React.FC<ClassManagerViewProps> = ({ courseToEdit, viewOnly = false }) => {
    const { setAdminPage, setEditingCourseRun, currentUser, classListReturnTo, setClassListReturnTo, trainingProviderProfile } = useLms();
    const goBackToList = () => {
        const target = classListReturnTo || AdminPage.Dashboard;
        setClassListReturnTo(null);
        setAdminPage(target);
    };
    const isEditMode = !!courseToEdit;
    const title = viewOnly ? 'Class Details' : (isEditMode ? 'Edit Class' : 'Create New Class');

    // Get current user's email for courseAdminEmail
    const currentUserEmail = currentUser?.email || "";

    // Show warning if user is not logged in
    React.useEffect(() => {
        if (!currentUser || !currentUserEmail) {
            console.warn('⚠️ No current user found or user email is empty. courseAdminEmail will be empty.');
        } else {
            console.log('✅ Using current user email for courseAdminEmail:', currentUserEmail);
        }
    }, [currentUser, currentUserEmail]);

    React.useEffect(() => {
        if (courseToEdit?.virtualMeetingProvider) return;
        const configured = (trainingProviderProfile as any)?.integrations?.virtualMeetingProvider;
        if (configured === 'zoom' || configured === 'teams' || configured === 'google_meet') {
            setVirtualMeetingProvider(configured);
        }
    }, [courseToEdit?.virtualMeetingProvider, trainingProviderProfile]);

    // Tab state for navigation
    const [activeTab, setActiveTab] = useState<'courseRun' | 'sessions' | 'enrollments' | 'trainer' | 'assessment'>('courseRun');
    const [assessmentLinks, setAssessmentLinks] = useState<{
        courseTitle?: string | null;
        courseCode?: string | null;
        assessmentFolderUrl?: string | null;
        assessmentRecordFolderUrl?: string | null;
        assessmentSummaryRecordUrl?: string | null;
    } | null>(null);
    const [assessmentLinksLoading, setAssessmentLinksLoading] = useState(false);
    const [assessmentLinksError, setAssessmentLinksError] = useState<string | null>(null);
    const [enrolledLearners, setEnrolledLearners] = useState<Array<{
        user_id: string; full_name: string; email: string; secondary_email: string | null;
        nric: string | null; tel: string | null; sponsorship_type: string | null;
        enrolment_id: string | null; grant_id: string | null; grant_amount: number | null;
        sf_claim_amount: number | null;
    }>>([]);
    const [enrollmentsLoading, setEnrollmentsLoading] = useState(false);
    const [visibleNrics, setVisibleNrics] = useState<Set<string>>(new Set());

    // Form state management
    const [courseRunId, setCourseRunId] = useState('');
    const [courseReferenceNumber, setCourseReferenceNumber] = useState('');
    const [startDate, setStartDate] = useState('');
    const [endDate, setEndDate] = useState('');
    const [loading, setLoading] = useState(false);

    // Edit form state
    const [editFormData, setEditFormData] = useState<EditRunInfo>({
        courseReferenceNumber: ''
    });

    // Session state management
    const [sessionCount, setSessionCount] = useState(1);
    const [sessionData, setSessionData] = useState<Record<number, any>>({
        0: {}
    });
    const [existingSessions, setExistingSessions] = useState<any[]>([]);
    const [sessionsLoading, setSessionsLoading] = useState(false);
    const [hasExistingSessions, setHasExistingSessions] = useState(false);
    const [editingSessionIndex, setEditingSessionIndex] = useState<number | null>(null);

    // Multiple new sessions state instead of single
    const [showNewSessionForm, setShowNewSessionForm] = useState(false);
    const [newSessions, setNewSessions] = useState([{
        id: '',
        modeOfTraining: '',
        startDate: '',
        endDate: '',
        startTime: '',
        endTime: '',
        venue: '',
        floor: '',
        unit: '',
        postalCode: '',
        room: ''
    }]);

    // Trainer state management
    const [trainerCount, setTrainerCount] = useState(1);
    const [trainerData, setTrainerData] = useState<Record<number, any>>({
        0: {}
    });

    // Local DB trainer assignment state
    const [availableTrainers, setAvailableTrainers] = useState<any[]>([]);
    const [selectedDbTrainerId, setSelectedDbTrainerId] = useState('');
    const [dbTrainerAssignMode, setDbTrainerAssignMode] = useState<'dropdown' | 'manual'>('dropdown');
    const [manualTrainerName, setManualTrainerName] = useState('');
    const [manualTrainerEmail, setManualTrainerEmail] = useState('');
    const [manualTrainerContact, setManualTrainerContact] = useState('');
    // Track all locally-assigned trainers from junction table
    const [assignedTrainersList, setAssignedTrainersList] = useState<any[]>([]);
    // Per-session trainer override state. `sessionTrainerList` is the list of
    // local course_session rows (not SSG) with each session's resolved trainer
    // — either the run-level default or a per-session override.
    const [sessionTrainerList, setSessionTrainerList] = useState<any[]>([]);
    const [sessionTrainerLoading, setSessionTrainerLoading] = useState(false);
    const [sessionTrainerExpanded, setSessionTrainerExpanded] = useState(false);
    // Legacy single-trainer state (kept for backward compat during transition)
    const [localAssignedTrainerName, setLocalAssignedTrainerName] = useState(courseToEdit?.assignedTrainerName || '');
    const [localAssignedTrainerEmail, setLocalAssignedTrainerEmail] = useState(courseToEdit?.assignedTrainerEmail || '');

    // Class Status and Type
    const [classStatus, setClassStatus] = useState(courseToEdit?.classStatus || 'Pending');
    const [invitationPaused, setInvitationPaused] = useState(!!(courseToEdit as any)?.invitationPaused);
    const [repliesBlocked, setRepliesBlocked] = useState(!!(courseToEdit as any)?.invitationRepliesBlocked);
    const [classType, setClassType] = useState(() => {
        // Use DB class_type first, then fallback to modeOfTraining
        if (courseToEdit?.classType && courseToEdit.classType !== 'Physical') return courseToEdit.classType;
        if (courseToEdit?.classType) return courseToEdit.classType;
        const mode = (courseToEdit?.modeOfTraining || '').toLowerCase();
        if (mode.includes('virtual') || mode.includes('online')) return 'Virtual';
        if (mode.includes('blended') || mode.includes('hybrid')) return 'Hybrid';
        return 'Physical';
    });
    const [virtualMeetingLink, setVirtualMeetingLink] = useState(courseToEdit?.virtualMeetingLink || '');
    const [virtualMeetingHostLink, setVirtualMeetingHostLink] = useState(courseToEdit?.virtualMeetingHostLink || '');
    const [virtualMeetingProvider, setVirtualMeetingProvider] = useState<'google_meet' | 'zoom' | 'teams'>(() => {
        const stored = courseToEdit?.virtualMeetingProvider;
        if (stored === 'zoom' || stored === 'teams' || stored === 'google_meet') return stored;
        const configured = (trainingProviderProfile as any)?.integrations?.virtualMeetingProvider;
        return configured === 'zoom' || configured === 'teams' ? configured : 'google_meet';
    });
    const [storedVirtualMeetingLink, setStoredVirtualMeetingLink] = useState(courseToEdit?.virtualMeetingLink || '');
    const [storedVirtualMeetingHostLink, setStoredVirtualMeetingHostLink] = useState(courseToEdit?.virtualMeetingHostLink || '');
    const [storedVirtualMeetingProvider, setStoredVirtualMeetingProvider] = useState<'google_meet' | 'zoom' | 'teams' | ''>(() => {
        const stored = courseToEdit?.virtualMeetingProvider;
        return stored === 'zoom' || stored === 'teams' || stored === 'google_meet' ? stored : '';
    });
    const [meetingBusy, setMeetingBusy] = useState(false);

    useEffect(() => {
        const nextStoredLink = courseToEdit?.virtualMeetingLink || '';
        const nextStoredHostLink = courseToEdit?.virtualMeetingHostLink || '';
        setVirtualMeetingLink(nextStoredLink);
        setStoredVirtualMeetingLink(nextStoredLink);
        setVirtualMeetingHostLink(nextStoredHostLink);
        setStoredVirtualMeetingHostLink(nextStoredHostLink);
        const stored = courseToEdit?.virtualMeetingProvider;
        if (stored === 'zoom' || stored === 'teams' || stored === 'google_meet') {
            setVirtualMeetingProvider(stored);
            setStoredVirtualMeetingProvider(stored);
            return;
        }
        setStoredVirtualMeetingProvider('');
        const configured = (trainingProviderProfile as any)?.integrations?.virtualMeetingProvider;
        if (configured === 'zoom' || configured === 'teams' || configured === 'google_meet') {
            setVirtualMeetingProvider(configured);
        }
    }, [courseToEdit?.id, courseToEdit?.virtualMeetingLink, courseToEdit?.virtualMeetingHostLink, courseToEdit?.virtualMeetingProvider, trainingProviderProfile]);

    // ViewCourseRun state management
    const [includeExpired, setIncludeExpired] = useState(false);
    const [ssgApiResponse, setSsgApiResponse] = useState<any>(null);
    const [ssgApiLoading, setSsgApiLoading] = useState(false);
    const [showSsgResponse, setShowSsgResponse] = useState(false);
    const [ssgDataPopulated, setSsgDataPopulated] = useState(false);

    // ViewCourseSessions state management
    const [includeExpiredSessions, setIncludeExpiredSessions] = useState(false);
    const [specifyMonthYear, setSpecifyMonthYear] = useState(false);
    const [selectedMonth, setSelectedMonth] = useState<Month>(Month.JANUARY);
    const [selectedYear, setSelectedYear] = useState(new Date().getFullYear());
    const [ssgSessionsResponse, setSsgSessionsResponse] = useState<any>(null);
    const [ssgSessionsLoading, setSsgSessionsLoading] = useState(false);
    const [showSsgSessionsResponse, setShowSsgSessionsResponse] = useState(false);

    // Popup modal state management
    const [showPopup, setShowPopup] = useState(false);
    const [popupConfig, setPopupConfig] = useState<{
        title: string;
        message: string;
        type: 'success' | 'error' | 'warning' | 'info' | 'confirm';
        onConfirm?: () => void;
        onCancel?: () => void;
        confirmText?: string;
        cancelText?: string;
    }>({
        title: '',
        message: '',
        type: 'info'
    });

    // Constants for form options
    const inputClasses = "block w-full px-3 py-2 text-gray-900 dark:text-white bg-white dark:bg-gray-700 border border-gray-300 dark:border-gray-600 rounded-md shadow-sm placeholder-gray-400 dark:placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent";
    const disabledInputClasses = "bg-gray-100 dark:bg-gray-800 text-gray-500 dark:text-gray-400 cursor-not-allowed";
    const virtualMeetingProviderLabel = virtualMeetingProvider === 'zoom' ? 'Zoom' : virtualMeetingProvider === 'teams' ? 'Microsoft Teams' : 'Google Meet';
    const canGenerateZoomMeeting = classType === 'Virtual' || classType === 'Hybrid';
    const isZoomMeetingProvider = virtualMeetingProvider === 'zoom';
    const hasStoredZoomMeeting = storedVirtualMeetingProvider === 'zoom' && !!(storedVirtualMeetingHostLink || storedVirtualMeetingLink);

    const handleGenerateZoomMeeting = async (force = false) => {
        if (!courseToEdit?.id) return;
        if (force && (storedVirtualMeetingHostLink || storedVirtualMeetingLink)) {
            const shouldRegenerate = confirm('Generate a new Zoom meeting and replace the currently stored Zoom links? The learner join URL and trainer start URL will both be replaced.');
            if (!shouldRegenerate) return;
        }

        setMeetingBusy(true);
        try {
            const response = await fetch(getApiUrl('/api/virtual-meetings/create'), {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ courseRunId: courseToEdit.id, provider: 'zoom', force }),
            });
            const result = await response.json();
            if (!response.ok || !result.success) throw new Error(result.error || 'Failed to create Zoom meeting');
            const meeting = result.data?.meeting || {};
            const joinUrl = meeting.join_url || meeting.joinUrl || '';
            const startUrl = meeting.start_url || meeting.startUrl || '';
            if (joinUrl) setVirtualMeetingLink(joinUrl);
            if (startUrl) setVirtualMeetingHostLink(startUrl);
            setVirtualMeetingProvider('zoom');
            if (joinUrl) setStoredVirtualMeetingLink(joinUrl);
            if (startUrl) setStoredVirtualMeetingHostLink(startUrl);
            setStoredVirtualMeetingProvider('zoom');
            alert(result.data?.reused ? 'Existing Zoom meeting link reused.' : force ? 'Zoom meeting regenerated.' : 'Zoom meeting created.');
        } catch (error) {
            alert(error instanceof Error ? error.message : 'Failed to create Zoom meeting');
        } finally {
            setMeetingBusy(false);
        }
    };

    const handleSaveVirtualMeeting = async () => {
        if (!courseToEdit?.id) {
            showErrorPopup('No course run selected.');
            return;
        }

        const hasStoredMeetingLinks = isZoomMeetingProvider
            ? !!(storedVirtualMeetingHostLink || storedVirtualMeetingLink)
            : !!storedVirtualMeetingLink;
        const meetingLinksChanged = isZoomMeetingProvider
            ? storedVirtualMeetingHostLink !== virtualMeetingHostLink || storedVirtualMeetingLink !== virtualMeetingLink
            : storedVirtualMeetingLink !== virtualMeetingLink;

        if (
            hasStoredMeetingLinks &&
            (meetingLinksChanged || storedVirtualMeetingProvider !== virtualMeetingProvider)
        ) {
            const shouldReplace = confirm(
                isZoomMeetingProvider
                    ? 'Save these Zoom meeting URLs? The trainer start URL is sensitive and should only be shared with trainers.'
                    : 'Save this virtual meeting link and make it the active link shown to learners and trainers? This will replace the currently stored meeting link for this class.'
            );
            if (!shouldReplace) return;
        }

        try {
            const response = await fetch(getApiUrl('/api/admin/upcoming-classes'), {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    id: courseToEdit.id,
                    ...(isZoomMeetingProvider
                        ? { virtual_meeting_host_link: virtualMeetingHostLink, virtual_meeting_link: virtualMeetingLink }
                        : { virtual_meeting_link: virtualMeetingLink }),
                    virtual_meeting_provider: virtualMeetingProvider,
                }),
            });
            const result = await response.json();
            if (!response.ok || !result.success) {
                throw new Error(result.error || 'Failed to save virtual meeting link');
            }

            setVirtualMeetingLink(result.data?.virtual_meeting_link || virtualMeetingLink);
            setVirtualMeetingHostLink(result.data?.virtual_meeting_host_link || virtualMeetingHostLink);
            setVirtualMeetingProvider(result.data?.virtual_meeting_provider || virtualMeetingProvider);
            setStoredVirtualMeetingLink(result.data?.virtual_meeting_link || virtualMeetingLink);
            setStoredVirtualMeetingHostLink(result.data?.virtual_meeting_host_link || virtualMeetingHostLink);
            setStoredVirtualMeetingProvider(result.data?.virtual_meeting_provider || virtualMeetingProvider);
            showSuccessPopup('Virtual meeting link saved.');
        } catch (error) {
            showErrorPopup(error instanceof Error ? error.message : 'Failed to save virtual meeting link');
        }
    };

    const modeOfTrainingOptions = [
        { value: '1', label: '1 - Classroom' },
        { value: '2', label: '2 - Asynchronous eLearning' },
        { value: '3', label: '3 - In-house' },
        { value: '4', label: '4 - On-the-Job' },
        { value: '5', label: '5 - Blended Learning' },
        { value: '6', label: '6 - Synchronous eLearning' },
        { value: '7', label: '7 - Practical / Traineeship' },
        { value: '8', label: '8 - Assessment' },
        { value: '9', label: '9 - Virtual Classroom' }
    ];

    const vacancyOptions = [
        { value: 'A', label: 'A - Available' },
        { value: 'F', label: 'F - Full' }
    ];

    const optionalSelectorOptions = [
        { value: OptionalSelector.YES, label: 'Yes' },
        { value: OptionalSelector.NO, label: 'No' }
    ];

    // Helper function to format dates for display
    const formatDateForDisplay = (dateString: string) => {
        if (!dateString) return '';
        // Convert YYYYMMDD to DD/MM/YYYY
        if (dateString.length === 8) {
            const year = dateString.substring(0, 4);
            const month = dateString.substring(4, 6);
            const day = dateString.substring(6, 8);
            return `${day}/${month}/${year}`;
        }
        return dateString;
    };

    // Helper function to get mode label from value
    const getModeLabel = (modeValue: string | number) => {
        const mode = modeOfTrainingOptions.find(option => option.value === String(modeValue));
        return mode ? mode.label : `Mode ${modeValue}`;
    };

    // Helper function to format venue object as string
    const formatVenueString = (venue: any): string => {
        if (!venue || typeof venue === 'string') {
            return venue || '';
        }

        console.log('🏢 Formatting venue object:', venue);
        const parts = [];
        if (venue.room) parts.push(venue.room);
        if (venue.building) parts.push(venue.building);
        if (venue.street) parts.push(venue.street);
        if (venue.floor) parts.push(`Floor ${venue.floor}`);
        if (venue.unit) parts.push(`Unit ${venue.unit}`);
        if (venue.block) parts.push(`Block ${venue.block}`);
        if (venue.postalCode) parts.push(venue.postalCode);

        const formatted = parts.length > 0 ? parts.join(', ') : '';
        console.log('🏢 Formatted venue string:', formatted);
        return formatted;
    };

    // Helper function to get venue as string for input fields
    const getVenueInputValue = (session: any): string => {
        if (!session) return '';
        return session.venueString || formatVenueString(session.venue) || '';
    };

    // Helper functions
    const updateEditField = (field: keyof EditRunInfo, value: any) => {
        setEditFormData(prev => ({ ...prev, [field]: value }));
    };

    // Memoized callback to prevent unnecessary re-renders
    const handleInputChange = useCallback((field: keyof EditRunInfo, value: any) => {
        setEditFormData(prev => ({ ...prev, [field]: value }));
    }, []);

    const updateSessionCount = (count: number) => {
        setSessionCount(count);
        const newSessionData = { ...sessionData };
        for (let i = 0; i < count; i++) {
            if (!newSessionData[i]) {
                newSessionData[i] = {};
            }
        }
        Object.keys(newSessionData).forEach(key => {
            const index = parseInt(key);
            if (index >= count) {
                delete newSessionData[index];
            }
        });
        setSessionData(newSessionData);
    };

    const updateSessionField = useCallback((sessionIndex: number, field: string, value: any) => {
        setSessionData(prev => ({
            ...prev,
            [sessionIndex]: {
                ...prev[sessionIndex],
                [field]: value
            }
        }));
    }, []);

    const getSessionData = (sessionIndex: number) => {
        return sessionData[sessionIndex] || {};
    };

    const updateTrainerCount = (count: number) => {
        setTrainerCount(count);
        const newTrainerData = { ...trainerData };
        for (let i = 0; i < count; i++) {
            if (!newTrainerData[i]) {
                newTrainerData[i] = {};
            }
        }
        Object.keys(newTrainerData).forEach(key => {
            const index = parseInt(key);
            if (index >= count) {
                delete newTrainerData[index];
            }
        });
        setTrainerData(newTrainerData);
    };

    const updateTrainerField = useCallback((trainerIndex: number, field: string, value: any) => {
        setTrainerData(prev => ({
            ...prev,
            [trainerIndex]: {
                ...prev[trainerIndex],
                [field]: value
            }
        }));
    }, []);

    const getTrainerData = (trainerIndex: number) => {
        return trainerData[trainerIndex] || {};
    };

    const isValidEmail = (email: string): boolean => {
        const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
        return emailRegex.test(email);
    };

    // Popup helper functions
    const showSuccessPopup = (message: string, title: string = 'Success') => {
        setPopupConfig({
            title,
            message,
            type: 'success',
            confirmText: 'OK'
        });
        setShowPopup(true);
    };

    const showErrorPopup = (message: string, title: string = 'Error') => {
        setPopupConfig({
            title,
            message,
            type: 'error',
            confirmText: 'OK'
        });
        setShowPopup(true);
    };

    const showWarningPopup = (message: string, title: string = 'Warning') => {
        setPopupConfig({
            title,
            message,
            type: 'warning',
            confirmText: 'OK'
        });
        setShowPopup(true);
    };

    const showInfoPopup = (message: string, title: string = 'Information') => {
        setPopupConfig({
            title,
            message,
            type: 'info',
            confirmText: 'OK'
        });
        setShowPopup(true);
    };

    const showConfirmPopup = (
        message: string,
        onConfirm: () => void,
        title: string = 'Confirm Action',
        confirmText: string = 'Confirm',
        cancelText: string = 'Cancel'
    ): Promise<boolean> => {
        return new Promise((resolve) => {
            setPopupConfig({
                title,
                message,
                type: 'confirm',
                onConfirm: () => {
                    onConfirm();
                    setShowPopup(false);
                    resolve(true);
                },
                onCancel: () => {
                    setShowPopup(false);
                    resolve(false);
                },
                confirmText,
                cancelText
            });
            setShowPopup(true);
        });
    };

    const closePopup = () => {
        setShowPopup(false);
        if (popupConfig.onCancel) {
            popupConfig.onCancel();
        }
    };

    // SSG API function to fetch course run data
    const fetchCourseRunData = async (runId?: string) => {
        const runIdToUse = runId || courseRunId;
        if (!runIdToUse.trim()) {
            showErrorPopup('No Course Run ID available');
            return;
        }

        setSsgApiLoading(true);
        try {
            const params = new URLSearchParams({
                runId: runIdToUse,
                includeExpired: includeExpired.toString()
                // No need to pass trainingProviderId - API will use the only one available
            });

            const response = await fetch(`/api/ssg/courses?${params}`, {
                method: 'GET',
                headers: {
                    'Content-Type': 'application/json'
                }
            });

            const data = await response.json();
            setSsgApiResponse(data);
            setShowSsgResponse(true);

            // Automatically populate form with SSG data
            populateFormFromSsgData(data);
        } catch (error) {
            setSsgApiResponse({ error: 'Failed to fetch course run details' });
            setShowSsgResponse(true);
        } finally {
            setSsgApiLoading(false);
        }
    };

    // SSG API function to fetch course sessions data
    const fetchCourseSessions = async (runId?: string, refNumber?: string) => {
        const runIdToUse = runId || courseRunId;
        const refNumberToUse = refNumber || courseReferenceNumber;

        if (!runIdToUse.trim()) {
            showErrorPopup('No Course Run ID available');
            return;
        }

        if (!refNumberToUse.trim()) {
            showErrorPopup('No Course Reference Number available');
            return;
        }

        setSsgSessionsLoading(true);
        try {
            const params = new URLSearchParams({
                includeExpired: includeExpiredSessions.toString(),
                courseCode: refNumberToUse
            });

            // Add month and year parameters if specified
            if (specifyMonthYear) {
                params.append('month', selectedMonth.toString());
                params.append('year', selectedYear.toString());
            }

            const response = await fetch(`/api/ssg/courses/runs/${runIdToUse}/sessions?${params}`, {
                method: 'GET',
                headers: {
                    'Content-Type': 'application/json'
                }
            });

            const data = await response.json();
            setSsgSessionsResponse(data);
            setShowSsgSessionsResponse(true);
        } catch (error) {
            setSsgSessionsResponse({ error: 'Failed to fetch course sessions' });
            setShowSsgSessionsResponse(true);
        } finally {
            setSsgSessionsLoading(false);
        }
    };

    // Helper function to convert SSG date format (YYYYMMDD) to HTML date format (YYYY-MM-DD)
    const convertSsgDateToHtml = (ssgDate: number | string): string => {
        if (!ssgDate) return '';
        const dateStr = ssgDate.toString();
        if (dateStr.length === 8) {
            const year = dateStr.substring(0, 4);
            const month = dateStr.substring(4, 6);
            const day = dateStr.substring(6, 8);
            return `${year}-${month}-${day}`;
        }
        return '';
    };

    // Helper function to convert HTML date format (YYYY-MM-DD) to SSG date format (YYYYMMDD)
    const convertHtmlDateToSsg = (htmlDate: string): number => {
        if (!htmlDate) return 0;
        return parseInt(htmlDate.replace(/-/g, ''));
    };

    // Helper function to generate schedule info from course dates (same logic as CreateNewClassView.tsx)
    const generateScheduleInfo = (startDate: string, endDate: string) => {
        if (!startDate || !endDate) return 'Course dates not specified';
        if (startDate === endDate) {
            return `${startDate} - ${endDate}`; // Single day course
        } else {
            return `${startDate} - ${endDate}`; // Multi-day course
        }
    };

    // Function to fetch enrolled learners
    const fetchEnrolledLearners = async () => {
        if (!courseToEdit?.id) return;
        setEnrollmentsLoading(true);
        try {
            const res = await fetch(getApiUrl(`/api/admin/course-run-enrollments?courseRunId=${courseToEdit.id}`));
            const data = await res.json();
            if (data.success) {
                setEnrolledLearners(data.data);
            }
        } catch (error) {
            console.error('Error fetching enrollments:', error);
        } finally {
            setEnrollmentsLoading(false);
        }
    };

    // Function to fetch existing sessions
    const fetchExistingSessions = async () => {
        if (!courseRunId.trim() || !courseReferenceNumber.trim()) {
            console.log('Missing course run ID or reference number for sessions fetch');
            return;
        }

        setSessionsLoading(true);
        try {
            const params = new URLSearchParams({
                includeExpired: includeExpiredSessions.toString(),
                courseCode: courseReferenceNumber
            });

            if (specifyMonthYear) {
                params.append('month', selectedMonth.toString());
                params.append('year', selectedYear.toString());
            }

            const response = await fetch(`/api/ssg/courses/runs/${courseRunId}/sessions?${params}`, {
                method: 'GET',
                headers: {
                    'Content-Type': 'application/json'
                }
            });

            const data = await response.json();
            console.log('Sessions API response:', data);
            const sessions = data.data?.result?.sessions;
            if (response.status === 200 && sessions && sessions.length > 0) {
                console.log('✅ Successfully fetched sessions data:', sessions);
                // Existing sessions found - process venue data
                const processedSessions = sessions.map((session: any) => ({
                    ...session,
                    venueString: formatVenueString(session.venue)
                }));
                setExistingSessions(processedSessions);
                setHasExistingSessions(true);
                console.log('✅ Found existing sessions:', processedSessions.length);
            } else if (response.status === 200 && sessions && sessions.length === 0) {
                setExistingSessions([]);
                setHasExistingSessions(false);
                console.log('📝 No sessions returned from API');
            } else if (response.status === 404) {
                // No sessions found - show add new session form
                setExistingSessions([]);
                setHasExistingSessions(false);
                console.log('📝 No existing sessions found - showing add new session form');
            } else {
                console.error('Unexpected response:', response.status, data);
                setExistingSessions([]);
                setHasExistingSessions(false);
            }
        } catch (error) {
            console.error('Error fetching sessions:', error);
            setExistingSessions([]);
            setHasExistingSessions(false);
        } finally {
            setSessionsLoading(false);
        }
    };

    // Function to toggle new session form
    const toggleNewSessionForm = () => {
        setShowNewSessionForm(!showNewSessionForm);
        if (!showNewSessionForm) {
            // Reset form when opening
            setNewSessions([{
                id: '',
                modeOfTraining: '',
                startDate: '',
                endDate: '',
                startTime: '',
                endTime: '',
                venue: '',
                floor: '',
                unit: '',
                postalCode: '',
                room: ''
            }]);
        }
    };

    // Function to reset new session form
    const resetNewSessionForm = () => {
        setNewSessions([{
            id: '',
            modeOfTraining: '',
            startDate: '',
            endDate: '',
            startTime: '',
            endTime: '',
            venue: '',
            floor: '',
            unit: '',
            postalCode: '',
            room: ''
        }]);
        setShowNewSessionForm(false);
    };

    // Function to add a new session form
    const addNewSessionForm = () => {
        setNewSessions(prev => [...prev, {
            id: '',
            modeOfTraining: '',
            startDate: '',
            endDate: '',
            startTime: '',
            endTime: '',
            venue: '',
            floor: '',
            unit: '',
            postalCode: '',
            room: ''
        }]);
    };

    // Function to remove a session form (except the first one)
    const removeSessionForm = (index: number) => {
        if (index > 0) { // Don't allow removing the first form
            setNewSessions(prev => prev.filter((_, i) => i !== index));
        }
    };

    // Helper function to handle session field updates with mode of training logic
    const handleSessionFieldUpdate = (sessionData: any, field: string, value: any) => {
        const updatedSession = { ...sessionData, [field]: value };

        // Handle automatic time setting for mode of training 2 and 4
        if (field === 'modeOfTraining') {
            if (value === '2' || value === '4') {
                updatedSession.startTime = '00:00';
                updatedSession.endTime = '23:59';
                // For mode 2 and 4, end date is based on user input, so don't auto-set it
            } else {
                // For other modes, set end date same as start date
                updatedSession.endDate = updatedSession.startDate;
                // Reset times to allow user input
                updatedSession.startTime = '';
                updatedSession.endTime = '';
            }
        }

        // When start date changes for non-2/4 modes, update end date to match
        if (field === 'startDate' && value !== '2' && value !== '4') {
            const currentMode = updatedSession.modeOfTraining;
            if (currentMode !== '2' && currentMode !== '4') {
                updatedSession.endDate = value;
            }
        }

        return updatedSession;
    };

    // Function to update a session field
    const updateNewSessionField = (index: number, field: string, value: any) => {
        setNewSessions(prev => {
            const updated = [...prev];
            updated[index] = handleSessionFieldUpdate(updated[index], field, value);
            return updated;
        });
    };

    // Function to add new sessions to course run
    const addNewSessions = async () => {
        // Validate required data first
        if (!courseRunId.trim() || !courseReferenceNumber.trim()) {
            showErrorPopup('Course Run ID and Course Reference Number are required for adding sessions');
            return;
        }

        // Validate that we have sessions to add
        if (!newSessions || newSessions.length === 0) {
            showErrorPopup('No sessions to add');
            return;
        }

        // Validate each session has required fields
        const validationErrors: string[] = [];
        newSessions.forEach((session, index) => {
            if (!session.modeOfTraining) {
                validationErrors.push(`Session ${index + 1}: Mode of Training is required`);
            }
            if (!session.startDate) {
                validationErrors.push(`Session ${index + 1}: Start Date is required`);
            }
            if (!session.endDate) {
                validationErrors.push(`Session ${index + 1}: End Date is required`);
            }
            if (!session.startTime) {
                validationErrors.push(`Session ${index + 1}: Start Time is required`);
            }
            if (!session.endTime) {
                validationErrors.push(`Session ${index + 1}: End Time is required`);
            }
        });

        if (validationErrors.length > 0) {
            showErrorPopup('Please fix the following errors:\n' + validationErrors.join('\n'));
            return;
        }

        // Validate that SSG data is available for populating course run details
        if (!ssgApiResponse?.data?.course?.run) {
            showErrorPopup('Course run data is required. Please fetch SSG data first before adding sessions.');
            return;
        }

        const runData = ssgApiResponse.data.course.run;

        // Generate schedule info from course dates
        const courseStartDateForSchedule = (runData.courseStartDate ?? runData.courseDates?.start) ? convertSsgDateToHtml(runData.courseStartDate ?? runData.courseDates?.start) : (editFormData.courseStartDate || '');
        const courseEndDateForSchedule = (runData.courseEndDate ?? runData.courseDates?.end) ? convertSsgDateToHtml(runData.courseEndDate ?? runData.courseDates?.end) : (editFormData.courseEndDate || '');
        const scheduleInfo = generateScheduleInfo(courseStartDateForSchedule, courseEndDateForSchedule);

        // Build the request body that will be sent to API (flat structure with all required run data)
        const requestBody = {
            // Required field at root level (as expected by backend)
            courseReferenceNumber: courseReferenceNumber,

            // Course run dates (required for proper SSG API payload) - convert YYYYMMDD to YYYY-MM-DD format
            openingRegistrationDate: (runData.registrationOpeningDate ?? runData.registrationDates?.opening) ? convertSsgDateToHtml(runData.registrationOpeningDate ?? runData.registrationDates?.opening) : (editFormData.openingRegistrationDate || ''),
            closingRegistrationDate: (runData.registrationClosingDate ?? runData.registrationDates?.closing) ? convertSsgDateToHtml(runData.registrationClosingDate ?? runData.registrationDates?.closing) : (editFormData.closingRegistrationDate || ''),
            courseStartDate: (runData.courseStartDate ?? runData.courseDates?.start) ? convertSsgDateToHtml(runData.courseStartDate ?? runData.courseDates?.start) : (editFormData.courseStartDate || ''),
            courseEndDate: (runData.courseEndDate ?? runData.courseDates?.end) ? convertSsgDateToHtml(runData.courseEndDate ?? runData.courseDates?.end) : (editFormData.courseEndDate || ''),

            // Schedule info (required by backend)
            scheduleInfoTypeCode: "01",
            scheduleInfoTypeDescription: "New Info Type Description",
            scheduleInfo: scheduleInfo,

            // Venue information (required for proper SSG API payload)
            block: editFormData.block || runData.venue?.block || "",
            street: editFormData.street || runData.venue?.street || "",
            floor: editFormData.floor || runData.venue?.floor || "",
            unit: editFormData.unit || runData.venue?.unit || "",
            building: editFormData.building || runData.venue?.building || "",
            postalCode: editFormData.postalCode || runData.venue?.postalCode || "",
            room: editFormData.room || runData.venue?.room || "",
            wheelChairAccess: editFormData.wheelChairAccess || (runData.venue?.wheelChairAccess ? OptionalSelector.YES : OptionalSelector.NO),

            // Course admin and vacancy (required for proper SSG API payload)
            courseAdminEmail: currentUserEmail,
            courseVacancy: editFormData.courseVacancy || runData.courseVacancy || { code: "A", description: "Available" },

            // File information (required by API)
            fileName: "",
            fileContent: "",

            // Sessions array at root level (as expected by backend)
            sessions: newSessions.map((session) => ({
                action: "add", // Action for each session is "add"
                sessionId: "", // Backend will generate the session ID
                startDate: session.startDate ? session.startDate.replace(/-/g, '') : "",
                endDate: session.endDate ? session.endDate.replace(/-/g, '') : "",
                startTime: session.startTime || "",
                endTime: session.endTime || "",
                modeOfTraining: session.modeOfTraining || "",
                // Use flat venue fields for sessions (matching backend expectation)
                sessionBlock: editFormData.block || runData.venue?.block || "",
                sessionStreet: editFormData.street || runData.venue?.street || "",
                sessionFloor: session.floor || editFormData.floor || runData.venue?.floor || "",
                sessionUnit: session.unit || editFormData.unit || runData.venue?.unit || "",
                sessionBuilding: editFormData.building || runData.venue?.building || "",
                sessionPostalCode: session.postalCode || editFormData.postalCode || runData.venue?.postalCode || "",
                sessionRoom: session.room || editFormData.room || runData.venue?.room || ""
            }))
        };

        // Also prepare the display version for the popup (showing the intended structure from user request)
        const displayRequestBody = {
            course: {
                courseReferenceNumber: courseReferenceNumber,
                trainingProvider: {
                    uen: runData.organizationKey
                },
                run: {
                    action: "update", // Action under "run" is "update" 
                    registrationDates: {
                        opening: runData.registrationOpeningDate ?? runData.registrationDates?.opening ?? convertHtmlDateToSsg(editFormData.openingRegistrationDate || ''),
                        closing: runData.registrationClosingDate ?? runData.registrationDates?.closing ?? convertHtmlDateToSsg(editFormData.closingRegistrationDate || '')
                    },
                    courseDates: {
                        start: runData.courseStartDate ?? runData.courseDates?.start ?? convertHtmlDateToSsg(editFormData.courseStartDate || ''),
                        end: runData.courseEndDate ?? runData.courseDates?.end ?? convertHtmlDateToSsg(editFormData.courseEndDate || '')
                    },
                    scheduleInfoType: {
                        code: "01",
                        description: "New Info Type Description"
                    },
                    scheduleInfo: scheduleInfo,
                    venue: {
                        floor: editFormData.floor || runData.venue?.floor || "",
                        unit: editFormData.unit || runData.venue?.unit || "",
                        postalCode: editFormData.postalCode || runData.venue?.postalCode || "",
                        room: editFormData.room || runData.venue?.room || ""
                    },
                    courseAdminEmail: currentUserEmail,
                    courseVacancy: {
                        code: editFormData.courseVacancy?.code || runData.courseVacancy?.code || "A",
                        description: editFormData.courseVacancy?.description || runData.courseVacancy?.description || "Available"
                    },
                    file: {},
                    sessions: newSessions.map((session) => ({
                        action: "add", // Action under "sessions" is "add"
                        sessionId: "",
                        startDate: session.startDate ? session.startDate.replace(/-/g, '') : "",
                        endDate: session.endDate ? session.endDate.replace(/-/g, '') : "",
                        startTime: session.startTime || "",
                        endTime: session.endTime || "",
                        modeOfTraining: session.modeOfTraining || "",
                        venue: {
                            floor: session.floor || editFormData.floor || runData.venue?.floor || "",
                            unit: session.unit || editFormData.unit || runData.venue?.unit || "",
                            postalCode: session.postalCode || editFormData.postalCode || runData.venue?.postalCode || "",
                            room: session.room || editFormData.room || runData.venue?.room || ""
                        }
                    }))
                }
            }
        };

        // Show confirmation popup with the display request body for review
        const confirmMessage = `Are you sure you want to add ${newSessions.length} new session(s)?`;

        showConfirmPopup(
            confirmMessage,
            async () => {
                try {
                    setLoading(true);

                    console.log('=== ADD NEW SESSIONS REQUEST DEBUG ===');
                    console.log('Sessions to add:', newSessions);
                    console.log('=== SENDING REQUEST BODY ===');
                    console.log(JSON.stringify(requestBody, null, 2));

                    const response = await fetch(`/api/ssg/courses/courseRuns/${courseRunId}?includeExpiredCourses=false&action=add-sessions`, {
                        method: 'POST',
                        headers: {
                            'Content-Type': 'application/json'
                        },
                        body: JSON.stringify(requestBody)
                    });

                    console.log('=== ADD SESSIONS API RESPONSE ===');
                    console.log('Response Status:', response.status);
                    console.log('Response OK:', response.ok);

                    if (!response.ok) {
                        const errorText = await response.text();
                        console.error('Add Sessions API Error:', errorText);
                        throw new Error(`HTTP error! status: ${response.status}, message: ${errorText}`);
                    }

                    const data = await response.json();
                    console.log('Add Sessions Success Response:', JSON.stringify(data, null, 2));

                    if (response.status === 200) {
                        showSuccessPopup('Sessions added successfully!');

                        // Reset the form
                        resetNewSessionForm();

                        // Refresh the sessions data to show the newly added sessions
                        fetchExistingSessions();
                    } else {
                        throw new Error('Failed to add sessions: Unexpected response status');
                    }

                } catch (error) {
                    const errorMessage = error instanceof Error ? error.message : 'An error occurred during session addition';
                    console.error('=== ADD SESSIONS ERROR ===');
                    console.error('Error Details:', error);
                    console.error('Error Message:', errorMessage);
                    showErrorPopup('Failed to add sessions: ' + errorMessage);
                } finally {
                    setLoading(false);
                }
            },
            'Add New Sessions',
            'Submit',
            'Cancel'
        );
    };

    // Function to delete an existing session
    const deleteExistingSession = async (sessionId: string, sessionIndex: number) => {
        // Validate required data first
        if (!courseRunId.trim() || !courseReferenceNumber.trim()) {
            showErrorPopup('Course Run ID and Course Reference Number are required for deleting sessions');
            return;
        }

        if (!ssgApiResponse?.data?.course?.run) {
            showErrorPopup('Course run data is required. Please fetch SSG data first.');
            return;
        }

        // Get the session to delete
        const sessionToDelete = existingSessions[sessionIndex];
        if (!sessionToDelete) {
            showErrorPopup('Session not found');
            return;
        }

        // Get SSG run data (same as add sessions)
        const runData = ssgApiResponse.data.course.run;

        // Generate schedule info from course dates
        const courseStartDateForSchedule = (runData.courseStartDate ?? runData.courseDates?.start) ? convertSsgDateToHtml(runData.courseStartDate ?? runData.courseDates?.start) : (editFormData.courseStartDate || '');
        const courseEndDateForSchedule = (runData.courseEndDate ?? runData.courseDates?.end) ? convertSsgDateToHtml(runData.courseEndDate ?? runData.courseDates?.end) : (editFormData.courseEndDate || '');
        const scheduleInfo = generateScheduleInfo(courseStartDateForSchedule, courseEndDateForSchedule);

        // Build the request body that will be sent to API (SAME structure as add sessions)
        const requestBody = {
            // Required field at root level (as expected by backend)
            courseReferenceNumber: courseReferenceNumber,

            // Course run dates (required for proper SSG API payload) - convert YYYYMMDD to YYYY-MM-DD format
            openingRegistrationDate: (runData.registrationOpeningDate ?? runData.registrationDates?.opening) ? convertSsgDateToHtml(runData.registrationOpeningDate ?? runData.registrationDates?.opening) : (editFormData.openingRegistrationDate || ''),
            closingRegistrationDate: (runData.registrationClosingDate ?? runData.registrationDates?.closing) ? convertSsgDateToHtml(runData.registrationClosingDate ?? runData.registrationDates?.closing) : (editFormData.closingRegistrationDate || ''),
            courseStartDate: (runData.courseStartDate ?? runData.courseDates?.start) ? convertSsgDateToHtml(runData.courseStartDate ?? runData.courseDates?.start) : (editFormData.courseStartDate || ''),
            courseEndDate: (runData.courseEndDate ?? runData.courseDates?.end) ? convertSsgDateToHtml(runData.courseEndDate ?? runData.courseDates?.end) : (editFormData.courseEndDate || ''),

            // Schedule info (required by backend)
            scheduleInfoTypeCode: "01",
            scheduleInfoTypeDescription: "Description",
            scheduleInfo: scheduleInfo,

            // Venue information (required for proper SSG API payload)
            block: editFormData.block || runData.venue?.block || "",
            street: editFormData.street || runData.venue?.street || "",
            floor: editFormData.floor || runData.venue?.floor || "",
            unit: editFormData.unit || runData.venue?.unit || "",
            building: editFormData.building || runData.venue?.building || "",
            postalCode: editFormData.postalCode || runData.venue?.postalCode || "",
            room: editFormData.room || runData.venue?.room || "",
            wheelChairAccess: editFormData.wheelChairAccess || (runData.venue?.wheelChairAccess ? OptionalSelector.YES : OptionalSelector.NO),

            // Course admin and vacancy (required for proper SSG API payload)
            courseAdminEmail: currentUserEmail,
            courseVacancy: editFormData.courseVacancy || runData.courseVacancy || { code: "A", description: "Available" },

            // File information (required by API)
            fileName: "",
            fileContent: "",

            // ONLY include the session we want to delete
            sessions: [
                {
                    action: "delete", // This is the key - delete action for this specific session
                    sessionId: sessionToDelete.id || "",
                    startDate: sessionToDelete.startDate ? String(sessionToDelete.startDate) : "20251025",
                    endDate: sessionToDelete.endDate ? String(sessionToDelete.endDate) : "20251025",
                    startTime: sessionToDelete.startTime || "15:30",
                    endTime: sessionToDelete.endTime || "18:30",
                    modeOfTraining: sessionToDelete.modeOfTraining || "8",
                    sessionBlock: sessionToDelete.venue?.block || "12",
                    sessionStreet: sessionToDelete.venue?.street || "WOODLANDS SQUARE",
                    sessionFloor: sessionToDelete.venue?.floor || "07",
                    sessionUnit: sessionToDelete.venue?.unit || "85-87",
                    sessionBuilding: sessionToDelete.venue?.building || "WOODS SQUARE",
                    sessionPostalCode: sessionToDelete.venue?.postalCode || "737715",
                    sessionRoom: sessionToDelete.venue?.room || "Tertiary Courses Training Venue"
                }
            ]
        };

        // Show confirmation popup with the request body for review
        const confirmMessage = `Are you sure you want to delete session ${sessionId}?

📋 **Request Body to be sent to API:**
\`\`\`json
${JSON.stringify(requestBody, null, 2)}
\`\`\`

🔍 **API Endpoint:**
POST /api/ssg/courses/courseRuns/${courseRunId}?action=delete-sessions

⚠️ This action cannot be undone. Please review the request body above before proceeding.`;

        showConfirmPopup(
            confirmMessage,
            async () => {

                try {
                    setLoading(true);

                    console.log('=== DELETE SESSION REQUEST DEBUG ===');
                    console.log('Session to delete:', sessionToDelete);
                    console.log('Session ID:', sessionId);
                    console.log('=== SENDING REQUEST BODY ===');
                    console.log(JSON.stringify(requestBody, null, 2));

                    const response = await fetch(`/api/ssg/courses/courseRuns/${courseRunId}?includeExpiredCourses=false&action=delete-sessions`, {
                        method: 'POST',
                        headers: {
                            'Content-Type': 'application/json'
                        },
                        body: JSON.stringify(requestBody)
                    });

                    console.log('=== DELETE SESSION API RESPONSE ===');
                    console.log('Response Status:', response.status);
                    console.log('Response OK:', response.ok);

                    if (!response.ok) {
                        const errorText = await response.text();
                        console.error('Delete Session API Error:', errorText);
                        throw new Error(`HTTP error! status: ${response.status}, message: ${errorText}`);
                    }

                    const data = await response.json();
                    console.log('Delete Session Success Response:', JSON.stringify(data, null, 2));

                    if (response.status === 200) {
                        // Remove from local state only after successful API call
                        setExistingSessions(prev => prev.filter((_, index) => index !== sessionIndex));
                        showSuccessPopup('Session deleted successfully!');

                        // Optionally refresh the sessions data
                        fetchExistingSessions();
                    } else {
                        throw new Error('Failed to delete session: Unexpected response status');
                    }

                } catch (error) {
                    const errorMessage = error instanceof Error ? error.message : 'An error occurred during session deletion';
                    console.error('=== DELETE SESSION ERROR ===');
                    console.error('Error Details:', error);
                    console.error('Error Message:', errorMessage);
                    showErrorPopup('Failed to delete session: ' + errorMessage);
                } finally {
                    setLoading(false);
                }
            },
            'Delete Session',
            'Delete',
            'Cancel'
        );
    };

    // Function to update an existing session
    const updateExistingSession = async (sessionIndex: number) => {
        // Validate required data first
        if (!courseRunId.trim() || !courseReferenceNumber.trim()) {
            showErrorPopup('Course Run ID and Course Reference Number are required for updating sessions');
            return;
        }

        if (!ssgApiResponse?.data?.course?.run) {
            showErrorPopup('Course run data is required. Please fetch SSG data first.');
            return;
        }

        // Get the session to update
        const sessionToUpdate = existingSessions[sessionIndex];
        if (!sessionToUpdate) {
            showErrorPopup('Session not found');
            return;
        }

        // Get SSG run data (same as add sessions)
        const runData = ssgApiResponse.data.course.run;

        // Generate schedule info from course dates
        const courseStartDateForSchedule = (runData.courseStartDate ?? runData.courseDates?.start) ? convertSsgDateToHtml(runData.courseStartDate ?? runData.courseDates?.start) : (editFormData.courseStartDate || '');
        const courseEndDateForSchedule = (runData.courseEndDate ?? runData.courseDates?.end) ? convertSsgDateToHtml(runData.courseEndDate ?? runData.courseDates?.end) : (editFormData.courseEndDate || '');
        const scheduleInfo = generateScheduleInfo(courseStartDateForSchedule, courseEndDateForSchedule);

        // Build the request body that will be sent to API (flat structure matching add/delete sessions)
        const requestBody = {
            // Required field at root level (as expected by backend)
            courseReferenceNumber: courseReferenceNumber,

            // Course run dates (required for proper SSG API payload) - convert YYYYMMDD to YYYY-MM-DD format
            openingRegistrationDate: (runData.registrationOpeningDate ?? runData.registrationDates?.opening) ? convertSsgDateToHtml(runData.registrationOpeningDate ?? runData.registrationDates?.opening) : (editFormData.openingRegistrationDate || ''),
            closingRegistrationDate: (runData.registrationClosingDate ?? runData.registrationDates?.closing) ? convertSsgDateToHtml(runData.registrationClosingDate ?? runData.registrationDates?.closing) : (editFormData.closingRegistrationDate || ''),
            courseStartDate: (runData.courseStartDate ?? runData.courseDates?.start) ? convertSsgDateToHtml(runData.courseStartDate ?? runData.courseDates?.start) : (editFormData.courseStartDate || ''),
            courseEndDate: (runData.courseEndDate ?? runData.courseDates?.end) ? convertSsgDateToHtml(runData.courseEndDate ?? runData.courseDates?.end) : (editFormData.courseEndDate || ''),

            // Schedule info (required by backend)
            scheduleInfoTypeCode: "01",
            scheduleInfoTypeDescription: "Description",

            // Venue information (required for proper SSG API payload)
            block: editFormData.block || runData.venue?.block || "",
            street: editFormData.street || runData.venue?.street || "",
            floor: editFormData.floor || runData.venue?.floor || "",
            unit: editFormData.unit || runData.venue?.unit || "",
            building: editFormData.building || runData.venue?.building || "",
            postalCode: editFormData.postalCode || runData.venue?.postalCode || "",
            room: editFormData.room || runData.venue?.room || "",
            wheelChairAccess: editFormData.wheelChairAccess || (runData.venue?.wheelChairAccess ? OptionalSelector.YES : OptionalSelector.NO),

            // Course admin and vacancy (required for proper SSG API payload)
            courseAdminEmail: currentUserEmail,
            courseVacancy: editFormData.courseVacancy || runData.courseVacancy || { code: "A", description: "Available" },

            // File information (required by API)
            fileName: "",
            fileContent: "",

            // Sessions array at root level (flat structure for backend)
            sessions: [
                {
                    action: "update", // Action for this session is "update"
                    sessionId: sessionToUpdate.id || "", // REQUIRED for update
                    startDate: sessionToUpdate.startDate ? String(sessionToUpdate.startDate).replace(/-/g, '') : "",
                    endDate: sessionToUpdate.endDate ? String(sessionToUpdate.endDate).replace(/-/g, '') : "",
                    startTime: sessionToUpdate.startTime || "",
                    endTime: sessionToUpdate.endTime || "",
                    modeOfTraining: sessionToUpdate.modeOfTraining || "",
                    // Use flat venue fields for sessions (matching backend expectation)
                    sessionBlock: sessionToUpdate.venue?.block || editFormData.block || runData.venue?.block || "",
                    sessionStreet: sessionToUpdate.venue?.street || editFormData.street || runData.venue?.street || "",
                    sessionFloor: sessionToUpdate.venue?.floor || editFormData.floor || runData.venue?.floor || "",
                    sessionUnit: sessionToUpdate.venue?.unit || editFormData.unit || runData.venue?.unit || "",
                    sessionBuilding: sessionToUpdate.venue?.building || editFormData.building || runData.venue?.building || "",
                    sessionPostalCode: sessionToUpdate.venue?.postalCode || editFormData.postalCode || runData.venue?.postalCode || "",
                    sessionRoom: sessionToUpdate.venue?.room || editFormData.room || runData.venue?.room || ""
                }
            ]
        };

        // Prepare the display version for the popup (showing the correct nested structure)
        const displayRequestBody = {
            course: {
                courseReferenceNumber: courseReferenceNumber,
                trainingProvider: {
                    uen: runData.organizationKey
                },
                run: {
                    action: "update", // Action under "run" is "update" 
                    registrationDates: {
                        opening: runData.registrationOpeningDate ?? runData.registrationDates?.opening ?? convertHtmlDateToSsg(editFormData.openingRegistrationDate || ''),
                        closing: runData.registrationClosingDate ?? runData.registrationDates?.closing ?? convertHtmlDateToSsg(editFormData.closingRegistrationDate || '')
                    },
                    courseDates: {
                        start: runData.courseStartDate ?? runData.courseDates?.start ?? convertHtmlDateToSsg(editFormData.courseStartDate || ''),
                        end: runData.courseEndDate ?? runData.courseDates?.end ?? convertHtmlDateToSsg(editFormData.courseEndDate || '')
                    },
                    scheduleInfoType: {
                        code: "01",
                        description: "Description"
                    },
                    scheduleInfo: scheduleInfo,
                    venue: {
                        floor: editFormData.floor || runData.venue?.floor || "",
                        unit: editFormData.unit || runData.venue?.unit || "",
                        postalCode: editFormData.postalCode || runData.venue?.postalCode || "",
                        room: editFormData.room || runData.venue?.room || ""
                    },
                    courseAdminEmail: currentUserEmail,
                    courseVacancy: {
                        code: editFormData.courseVacancy?.code || runData.courseVacancy?.code || "A",
                        description: editFormData.courseVacancy?.description || runData.courseVacancy?.description || "Available"
                    },
                    file: {
                        Name: "",
                        content: ""
                    },
                    sessions: [
                        {
                            action: "update", // Action under "sessions" is "update"
                            sessionId: sessionToUpdate.id || "",
                            startDate: sessionToUpdate.startDate ? String(sessionToUpdate.startDate).replace(/-/g, '') : "",
                            endDate: sessionToUpdate.endDate ? String(sessionToUpdate.endDate).replace(/-/g, '') : "",
                            startTime: sessionToUpdate.startTime || "",
                            endTime: sessionToUpdate.endTime || "",
                            modeOfTraining: sessionToUpdate.modeOfTraining || "",
                            venue: {
                                block: sessionToUpdate.venue?.block || editFormData.block || runData.venue?.block || "",
                                street: sessionToUpdate.venue?.street || editFormData.street || runData.venue?.street || "",
                                floor: sessionToUpdate.venue?.floor || editFormData.floor || runData.venue?.floor || "",
                                unit: sessionToUpdate.venue?.unit || editFormData.unit || runData.venue?.unit || "",
                                building: sessionToUpdate.venue?.building || editFormData.building || runData.venue?.building || "",
                                postalCode: sessionToUpdate.venue?.postalCode || editFormData.postalCode || runData.venue?.postalCode || "",
                                room: sessionToUpdate.venue?.room || editFormData.room || runData.venue?.room || ""
                            }
                        }
                    ]
                }
            }
        };

        // Show confirmation popup with the request body for review
        const confirmMessage = `Are you sure you want to update session ${sessionToUpdate.id}?

📋 **Request Body Structure (for display):**
\`\`\`json
${JSON.stringify(displayRequestBody, null, 2)}
\`\`\`

🔍 **API Endpoint:**
POST /api/ssg/courses/courseRuns/${courseRunId}?action=update-sessions

ℹ️ This will update the session with the current form data. The actual request will be transformed by the backend to match the SSG API requirements.`;

        showConfirmPopup(
            confirmMessage,
            async () => {

                try {
                    setLoading(true);

                    console.log('=== UPDATE SESSION REQUEST DEBUG ===');
                    console.log('Session to update:', sessionToUpdate);
                    console.log('Session ID:', sessionToUpdate.id);
                    console.log('=== SENDING REQUEST BODY (flat structure) ===');
                    console.log(JSON.stringify(requestBody, null, 2));

                    const response = await fetch(`/api/ssg/courses/courseRuns/${courseRunId}?includeExpiredCourses=false&action=update-sessions`, {
                        method: 'POST',
                        headers: {
                            'Content-Type': 'application/json'
                        },
                        body: JSON.stringify(requestBody)
                    });

                    console.log('=== UPDATE SESSION API RESPONSE ===');
                    console.log('Response Status:', response.status);
                    console.log('Response OK:', response.ok);

                    if (!response.ok) {
                        const errorText = await response.text();
                        console.error('Update Session API Error:', errorText);
                        throw new Error(`HTTP error! status: ${response.status}, message: ${errorText}`);
                    }

                    const data = await response.json();
                    console.log('Update Session Success Response:', JSON.stringify(data, null, 2));

                    if (response.status === 200) {
                        // Update local state with the updated session
                        setExistingSessions(prev => prev.map((session, index) =>
                            index === sessionIndex ? sessionToUpdate : session
                        ));
                        showSuccessPopup('Session updated successfully!');

                        // Cancel editing mode
                        cancelEditingSession();

                        // Optionally refresh the sessions data
                        fetchExistingSessions();
                    } else {
                        throw new Error('Failed to update session: Unexpected response status');
                    }

                } catch (error) {
                    const errorMessage = error instanceof Error ? error.message : 'An error occurred during session update';
                    console.error('=== UPDATE SESSION ERROR ===');
                    console.error('Error Details:', error);
                    console.error('Error Message:', errorMessage);
                    showErrorPopup('Failed to update session: ' + errorMessage);
                } finally {
                    setLoading(false);
                }
            },
            'Update Session',
            'Update',
            'Cancel'
        );
    };

    // Function to start editing an existing session
    const startEditingSession = (sessionIndex: number) => {
        setEditingSessionIndex(sessionIndex);

        // Populate session data for editing
        const session = existingSessions[sessionIndex];
        setSessionData({
            0: {
                sessionId: session.id,
                startDate: convertSsgDateToHtml(session.startDate),
                endDate: convertSsgDateToHtml(session.endDate),
                startTime: session.startTime,
                endTime: session.endTime,
                modeOfTraining: session.modeOfTraining,
                sessionBlock: session.venue?.block || '',
                sessionStreet: session.venue?.street || '',
                sessionBuilding: session.venue?.building || '',
                sessionFloor: session.venue?.floor || '',
                sessionUnit: session.venue?.unit || '',
                sessionPostalCode: session.venue?.postalCode || '',
                sessionRoom: session.venue?.room || '',
                sessionWheelchairAccess: session.venue?.wheelChairAccess ? 'true' : 'false'
            }
        });
        setSessionCount(1);
    };

    // Function to cancel editing
    const cancelEditingSession = () => {
        setEditingSessionIndex(null);
        setSessionData({ 0: {} });
        setSessionCount(1);
    };

    // Function to populate form data from SSG API response
    const populateFormFromSsgData = (ssgResponse: any) => {
        if (!ssgResponse) {
            console.warn('populateFormFromSsgData: No SSG response provided');
            return;
        }

        if (!ssgResponse?.data?.course?.run) {
            console.warn('populateFormFromSsgData: No course run data in response');
            return;
        }

        const run = ssgResponse.data.course.run;
        const virtualMeetingLinkFromResponse = run.virtualMeetingLink || ssgResponse.data.virtualMeetingLink || '';
        const virtualMeetingProviderFromResponse = run.virtualMeetingProvider || ssgResponse.data.virtualMeetingProvider || '';

        // Update form data with the actual SSG response structure, falling back to local database data
        const updatedFormData = {
            // Registration dates - Local DB fallback to SSG
            openingRegistrationDate: (courseToEdit as any)?.registrationOpeningDate 
                ? String((courseToEdit as any).registrationOpeningDate).slice(0, 10) 
                : ((run.registrationOpeningDate ?? run.registrationDates?.opening) ? convertSsgDateToHtml(run.registrationOpeningDate ?? run.registrationDates?.opening) : undefined),
            closingRegistrationDate: (courseToEdit as any)?.registrationClosingDate
                ? String((courseToEdit as any).registrationClosingDate).slice(0, 10)
                : ((run.registrationClosingDate ?? run.registrationDates?.closing) ? convertSsgDateToHtml(run.registrationClosingDate ?? run.registrationDates?.closing) : undefined),

            // Course dates - Local DB fallback to SSG
            courseStartDate: courseToEdit?.startDate 
                ? String(courseToEdit.startDate).slice(0, 10) 
                : ((run.courseStartDate ?? run.courseDates?.start) ? convertSsgDateToHtml(run.courseStartDate ?? run.courseDates?.start) : undefined),
            courseEndDate: courseToEdit?.endDate
                ? String(courseToEdit.endDate).slice(0, 10)
                : ((run.courseEndDate ?? run.courseDates?.end) ? convertSsgDateToHtml(run.courseEndDate ?? run.courseDates?.end) : undefined),

            // Course vacancy
            courseVacancy: run.courseVacancy ? {
                code: run.courseVacancy.code,
                description: run.courseVacancy.description
            } : undefined,

            // Venue information
            block: run.venue?.block || undefined,
            street: run.venue?.street || undefined,
            building: run.venue?.building || undefined,
            floor: run.venue?.floor || undefined,
            unit: run.venue?.unit || undefined,
            postalCode: run.venue?.postalCode || undefined,
            room: run.venue?.room || undefined,
            wheelChairAccess: run.venue?.wheelChairAccess !== undefined ?
                (run.venue.wheelChairAccess ? OptionalSelector.YES : OptionalSelector.NO) :
                undefined,

            // Course admin email - use SSG value, fall back to current user
            courseAdminEmail: run.courseAdminEmail || currentUserEmail
        };

        setEditFormData(prev => {
            const newFormData = { ...prev };

            if (updatedFormData.openingRegistrationDate !== undefined) newFormData.openingRegistrationDate = updatedFormData.openingRegistrationDate;
            if (updatedFormData.closingRegistrationDate !== undefined) newFormData.closingRegistrationDate = updatedFormData.closingRegistrationDate;
            if (updatedFormData.courseStartDate !== undefined) newFormData.courseStartDate = updatedFormData.courseStartDate;
            if (updatedFormData.courseEndDate !== undefined) newFormData.courseEndDate = updatedFormData.courseEndDate;
            if (updatedFormData.courseVacancy !== undefined) newFormData.courseVacancy = updatedFormData.courseVacancy;
            if (updatedFormData.block !== undefined) newFormData.block = updatedFormData.block;
            if (updatedFormData.street !== undefined) newFormData.street = updatedFormData.street;
            if (updatedFormData.building !== undefined) newFormData.building = updatedFormData.building;
            if (updatedFormData.floor !== undefined) newFormData.floor = updatedFormData.floor;
            if (updatedFormData.unit !== undefined) newFormData.unit = updatedFormData.unit;
            if (updatedFormData.postalCode !== undefined) newFormData.postalCode = updatedFormData.postalCode;
            if (updatedFormData.room !== undefined) newFormData.room = updatedFormData.room;
            if (updatedFormData.wheelChairAccess !== undefined) newFormData.wheelChairAccess = updatedFormData.wheelChairAccess;
            if (updatedFormData.courseAdminEmail !== undefined) newFormData.courseAdminEmail = updatedFormData.courseAdminEmail;

            return newFormData;
        });

        // Update the individual date states as well
        const startDateRaw = run.courseStartDate ?? run.courseDates?.start;
        if (startDateRaw) {
            setStartDate(convertSsgDateToHtml(startDateRaw));
        }
        const endDateRaw = run.courseEndDate ?? run.courseDates?.end;
        if (endDateRaw) {
            setEndDate(convertSsgDateToHtml(endDateRaw));
        }

        if (virtualMeetingLinkFromResponse) {
            setVirtualMeetingLink(virtualMeetingLinkFromResponse);
            setStoredVirtualMeetingLink(virtualMeetingLinkFromResponse);
        }
        if (
            virtualMeetingProviderFromResponse === 'google_meet' ||
            virtualMeetingProviderFromResponse === 'zoom' ||
            virtualMeetingProviderFromResponse === 'teams'
        ) {
            setVirtualMeetingProvider(virtualMeetingProviderFromResponse);
            setStoredVirtualMeetingProvider(virtualMeetingProviderFromResponse);
        }

        setSsgDataPopulated(true);
    };

    // Function to handle course run update
    const handleUpdateCourseRun = async () => {
        if (!courseRunId.trim() || !courseReferenceNumber.trim()) {
            showErrorPopup('Course Run ID and Course Reference Number are required for updating');
            return;
        }

        // Generate schedule info from course dates
        const scheduleInfo = generateScheduleInfo(editFormData.courseStartDate || '', editFormData.courseEndDate || '');

        setLoading(true);
        try {
            const requestBody = {
                courseReferenceNumber: courseReferenceNumber, // Move to root level
                course: {
                    trainingProvider: {
                        uen: ssgApiResponse?.data?.course?.run?.organizationKey
                    },
                    run: {
                        action: "update",
                        registrationDates: {
                            opening: editFormData.openingRegistrationDate ? convertHtmlDateToSsg(editFormData.openingRegistrationDate) : 0,
                            closing: editFormData.closingRegistrationDate ? convertHtmlDateToSsg(editFormData.closingRegistrationDate) : 0
                        },
                        courseDates: {
                            start: editFormData.courseStartDate ? convertHtmlDateToSsg(editFormData.courseStartDate) : 0,
                            end: editFormData.courseEndDate ? convertHtmlDateToSsg(editFormData.courseEndDate) : 0
                        },
                        scheduleInfoType: {
                            code: "01",
                            description: "Description"
                        },
                        scheduleInfo: scheduleInfo,
                        venue: {
                            block: editFormData.block || "",
                            street: editFormData.street || "",
                            floor: editFormData.floor || "",
                            unit: editFormData.unit || "",
                            building: editFormData.building || "",
                            postalCode: editFormData.postalCode || "",
                            room: editFormData.room || "",
                            wheelChairAccess: editFormData.wheelChairAccess === OptionalSelector.YES
                        },
                        courseAdminEmail: currentUserEmail,
                        courseVacancy: {
                            code: editFormData.courseVacancy?.code || "A",
                            description: editFormData.courseVacancy?.description || "Available"
                        },
                        file: {
                            Name: "",
                            content: ""
                        }
                        // TODO: Re-implement linkCourseRunTrainer in a better way in the future
                        // Include linkCourseRunTrainer if it exists in the SSG response
                        // ...(ssgApiResponse?.data?.course?.run?.linkCourseRunTrainer && {
                        //     linkCourseRunTrainer: ssgApiResponse.data.course.run.linkCourseRunTrainer
                        // })
                    }
                }
            };

            console.log('Sending update request:', requestBody);

            const response = await fetch(`/api/ssg/courses/courseRuns/${courseRunId}?includeExpiredCourses=false&action=edit`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify(requestBody)
            });

            if (!response.ok) {
                throw new Error(`HTTP error! status: ${response.status}`);
            }

            const data = await response.json();
            console.log('Update response:', data);

            if (response.status === 200) {
                showSuccessPopup('Course run updated successfully!');
                // Re-fetch the updated data
                fetchCourseRunData(courseRunId);
            } else {
                showInfoPopup('Update completed with status: ' + response.status);
            }
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : 'An error occurred during update';
            console.error('Update error:', error);
            showErrorPopup('Failed to update course run: ' + errorMessage);
        } finally {
            setLoading(false);
        }
    };

    // Function to handle course run update specifically
    const handleUpdateCourseRunOnly = async () => {
        if (!courseRunId.trim()) {
            showErrorPopup('Course Run ID is required for updating');
            return;
        }

        setLoading(true);
        try {
            const requestBody = {
                courseRunId,
                courseStartDate: editFormData.courseStartDate || undefined,
                courseEndDate: editFormData.courseEndDate || undefined,
                openingRegistrationDate: editFormData.openingRegistrationDate || undefined,
                closingRegistrationDate: editFormData.closingRegistrationDate || undefined,
                block: editFormData.block || undefined,
                street: editFormData.street || undefined,
                building: editFormData.building || undefined,
                floor: editFormData.floor || undefined,
                unit: editFormData.unit || undefined,
                postalCode: editFormData.postalCode || undefined,
                room: editFormData.room || undefined,
                wheelChairAccess: editFormData.wheelChairAccess === OptionalSelector.YES,
                courseVacancyCode: editFormData.courseVacancy?.code || undefined,
                courseVacancyDescription: editFormData.courseVacancy?.description || undefined,
                courseAdminEmail: editFormData.courseAdminEmail || currentUserEmail,
                classStatus: classStatus || undefined,
                classType: classType || undefined,
            };

            const response = await fetch(getApiUrl('/api/admin/update-course-run-local'), {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(requestBody)
            });

            if (!response.ok) {
                const errorData = await response.json();
                throw new Error(errorData.error || `HTTP error: ${response.status}`);
            }

            showSuccessPopup('Course run saved locally.');
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : 'An error occurred during update';
            console.error('Local update error:', error);
            showErrorPopup('Failed to save course run: ' + errorMessage);
        } finally {
            setLoading(false);
        }
    };

    // Function to handle sessions update
    const handleUpdateSessions = async () => {
        showInfoPopup('Sessions update functionality will be implemented');
        // TODO: Implement sessions update logic
    };

    // Fetch trainers list from local DB for the dropdown
    const fetchAvailableTrainers = async () => {
        try {
            const res = await fetch('/api/admin/trainers-detail');
            const json = await res.json();
            if (json.success) setAvailableTrainers(json.data.trainers);
        } catch {
            // silent – dropdown just stays empty
        }
    };

    // Load assessment links when the Assessment tab becomes active
    useEffect(() => {
        if (!isEditMode || activeTab !== 'assessment' || !courseToEdit?.id) return;
        let cancelled = false;
        (async () => {
            setAssessmentLinksLoading(true);
            setAssessmentLinksError(null);
            try {
                const res = await fetch(`/api/admin/course-run-assessment-links?courseRunId=${encodeURIComponent(courseToEdit.id)}`);
                const json = await res.json();
                if (cancelled) return;
                if (!res.ok || !json.success) {
                    setAssessmentLinksError(typeof json.error === 'string' ? json.error : `Error ${res.status}`);
                    setAssessmentLinks(null);
                } else {
                    setAssessmentLinks(json.data);
                }
            } catch (err) {
                if (cancelled) return;
                setAssessmentLinksError(err instanceof Error ? err.message : 'Failed to load assessment links');
            } finally {
                if (!cancelled) setAssessmentLinksLoading(false);
            }
        })();
        return () => { cancelled = true; };
    }, [isEditMode, activeTab, courseToEdit?.id]);

    // Load trainers when trainer tab becomes active
    useEffect(() => {
        if (isEditMode && activeTab === 'trainer' && availableTrainers.length === 0) {
            fetchAvailableTrainers();
        }
        if (isEditMode && activeTab === 'trainer' && courseToEdit?.id) {
            fetchAssignedTrainers();
            fetchSessionTrainers();
        }
    }, [isEditMode, activeTab]); // eslint-disable-line react-hooks/exhaustive-deps

    // Fetch per-session trainer overrides from local DB. The endpoint resolves
    // the effective trainer per session server-side (inherit or override).
    const fetchSessionTrainers = async () => {
        if (!courseToEdit?.id) return;
        setSessionTrainerLoading(true);
        try {
            const res = await fetch(`/api/admin/course-sessions/list-with-trainers?courseRunUuid=${courseToEdit.id}`);
            const json = await res.json();
            if (json.success && json.data?.sessions) {
                setSessionTrainerList(json.data.sessions);
            }
        } catch {
            // silent — feature degrades gracefully
        } finally {
            setSessionTrainerLoading(false);
        }
    };

    // Update or clear a per-session trainer override. Pass trainerId=null to clear.
    const updateSessionTrainer = async (
        sessionId: string,
        trainerId: string | null,
        trainerName: string | null,
        trainerEmail: string | null
    ) => {
        try {
            const res = await fetch('/api/admin/course-sessions/update-trainer', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ sessionId, trainerId, trainerName, trainerEmail }),
            });
            const json = await res.json();
            if (!json.success) {
                showErrorPopup(json.error || 'Failed to update session trainer');
                return;
            }
            // Refetch to pick up the server-resolved effective trainer
            await fetchSessionTrainers();
        } catch (err) {
            showErrorPopup('Failed to update session trainer');
        }
    };

    // Fetch all trainers assigned to this course run from the junction table
    const fetchAssignedTrainers = async () => {
        if (!courseToEdit?.id) return;
        try {
            const res = await fetch(`/api/admin/course-run-trainers?courseRunUuid=${courseToEdit.id}`);
            const json = await res.json();
            if (json.success && json.data) {
                setAssignedTrainersList(json.data);
                // Also sync legacy state for backward compat
                if (json.data.length > 0) {
                    setLocalAssignedTrainerName(json.data.map((t: any) => t.trainer_name).join(', '));
                    setLocalAssignedTrainerEmail(json.data.map((t: any) => t.trainer_email).filter(Boolean).join(', '));
                }
            }
        } catch {
            // Junction table may not exist yet — no-op
        }
    };

    // Assign trainer to course run in local DB (sets assigned_trainer_id / name / email)
    const handleAssignTrainerLocal = async (e?: React.MouseEvent) => {
        if (e) {
            e.preventDefault();
            e.stopPropagation();
        }
        if (!courseToEdit?.id) {
            showErrorPopup('No course run selected');
            return;
        }

        let trainerName = '';
        let trainerEmail = '';
        let trainerId = '';

        if (dbTrainerAssignMode === 'dropdown') {
            const selected = availableTrainers.find((t: any) => t.user_id === selectedDbTrainerId);
            if (!selected) {
                showErrorPopup('Please select a trainer from the list');
                return;
            }
            trainerName = selected.trainer_name;
            trainerEmail = selected.email;
            trainerId = selected.user_id;
        } else {
            if (!manualTrainerName.trim()) {
                showErrorPopup('Trainer name is required');
                return;
            }
            trainerName = manualTrainerName.trim();
            trainerEmail = manualTrainerEmail.trim();
        }

        try {
            setLoading(true);
            const updateResponse = await fetch('/api/admin/update-trainer-info', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    courseRunUuid: courseToEdit.id,
                    courseRunId: courseToEdit.courseRunId,
                    trainerName,
                    trainerEmail,
                    trainerId: trainerId || undefined,
                }),
            });
            const data = await updateResponse.json();
            if (!updateResponse.ok) throw new Error(data.error || 'Failed to assign trainer');
            showSuccessPopup(`Trainer "${trainerName}" has been added to this course run.`);
            // Refresh the trainers list from DB
            await fetchAssignedTrainers();
            setSelectedDbTrainerId('');
            setManualTrainerName('');
            setManualTrainerEmail('');
        } catch (err) {
            showErrorPopup(err instanceof Error ? err.message : 'Failed to assign trainer');
        } finally {
            setLoading(false);
        }
    };

    // Remove a specific trainer from this course run
    const handleRemoveTrainerLocal = async (junctionId: string, trainerName: string, e?: React.MouseEvent) => {
        if (e) {
            e.preventDefault();
            e.stopPropagation();
        }
        if (!courseToEdit?.id) return;
        try {
            setLoading(true);
            // If junctionId is 'legacy', there's no junction row — remove all
            // trainers (clears legacy scalar columns via syncLegacyColumns)
            const body = junctionId === 'legacy'
                ? { courseRunUuid: courseToEdit.id }
                : { courseRunUuid: courseToEdit.id, junctionId };
            const res = await fetch('/api/admin/remove-trainer', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(body),
            });
            const data = await res.json();
            if (!res.ok) throw new Error(data.error || 'Failed to remove trainer');
            showSuccessPopup(`Trainer "${trainerName}" has been removed.`);
            await fetchAssignedTrainers();
        } catch (err) {
            showErrorPopup(err instanceof Error ? err.message : 'Failed to remove trainer');
        } finally {
            setLoading(false);
        }
    };

    // Function to handle trainer update
    // Function to handle trainer assignment to course run
    const handleUpdateTrainer = async () => {
        // Validate required data first
        if (!courseRunId.trim() || !courseReferenceNumber.trim()) {
            showErrorPopup('Course Run ID and Course Reference Number are required for assigning trainer');
            return;
        }

        if (!ssgApiResponse?.data?.course?.run) {
            showErrorPopup('Course run data is required. Please fetch SSG data first before assigning trainer.');
            return;
        }

        // Get trainer data (we're only using the first trainer since trainerCount is 1)
        const trainerInfo = getTrainerData(0);

        // Validate that trainer ID is provided
        if (!trainerInfo.trainerIdNumber || trainerInfo.trainerIdNumber.trim() === '') {
            showErrorPopup('Trainer ID Number is required');
            return;
        }

        // Get SSG run data for populating course run details
        const runData = ssgApiResponse.data.course.run;

        // Generate schedule info from course dates
        const courseStartDateForSchedule = (runData.courseStartDate ?? runData.courseDates?.start) ? convertSsgDateToHtml(runData.courseStartDate ?? runData.courseDates?.start) : (editFormData.courseStartDate || '');
        const courseEndDateForSchedule = (runData.courseEndDate ?? runData.courseDates?.end) ? convertSsgDateToHtml(runData.courseEndDate ?? runData.courseDates?.end) : (editFormData.courseEndDate || '');
        const scheduleInfo = generateScheduleInfo(courseStartDateForSchedule, courseEndDateForSchedule);

        // Build the request body with the exact structure required by the API
        const requestBody = {
            course: {
                courseReferenceNumber: courseReferenceNumber,
                trainingProvider: {
                    uen: runData.organizationKey
                },
                run: {
                    action: "update",
                    registrationDates: {
                        opening: runData.registrationOpeningDate ?? runData.registrationDates?.opening ?? convertHtmlDateToSsg(editFormData.openingRegistrationDate || ''),
                        closing: runData.registrationClosingDate ?? runData.registrationDates?.closing ?? convertHtmlDateToSsg(editFormData.closingRegistrationDate || '')
                    },
                    courseDates: {
                        start: runData.courseStartDate ?? runData.courseDates?.start ?? convertHtmlDateToSsg(editFormData.courseStartDate || ''),
                        end: runData.courseEndDate ?? runData.courseDates?.end ?? convertHtmlDateToSsg(editFormData.courseEndDate || '')
                    },
                    scheduleInfoType: {
                        code: "01",
                        description: "New Info Type Description"
                    },
                    scheduleInfo: scheduleInfo,
                    venue: {
                        floor: editFormData.floor || runData.venue?.floor || "",
                        unit: editFormData.unit || runData.venue?.unit || "",
                        postalCode: editFormData.postalCode || runData.venue?.postalCode || "",
                        room: editFormData.room || runData.venue?.room || "",
                        building: editFormData.building || runData.venue?.building || "",
                        street: editFormData.street || runData.venue?.street || "",
                        block: editFormData.block || runData.venue?.block || ""
                    },
                    courseAdminEmail: currentUserEmail,
                    courseVacancy: {
                        code: editFormData.courseVacancy?.code || runData.courseVacancy?.code || "A",
                        description: editFormData.courseVacancy?.description || runData.courseVacancy?.description || "Available"
                    },
                    file: {
                        Name: "",
                        content: ""
                    },
                    linkCourseRunTrainer: [
                        {
                            trainer: {
                                photo: {
                                    name: "",
                                    content: ""
                                },
                                trainerType: {
                                    code: "1",
                                    description: "Existing"
                                },
                                idNumber: trainerInfo.trainerIdNumber.trim()
                            }
                        }
                    ]
                }
            }
        };

        // Show confirmation popup with the request body for review
        const confirmMessage = `Are you sure you want to assign trainer ${trainerInfo.trainerIdNumber} to this course run?

📋 **Request Body to be sent to API:**
\`\`\`json
${JSON.stringify(requestBody, null, 2)}
\`\`\`

🔍 **API Endpoint:**
POST /api/ssg/courses/courseRuns/${courseRunId}?action=assign-trainer

ℹ️ This will assign the existing trainer to the course run. Please review the request body above before proceeding.`;

        showConfirmPopup(
            confirmMessage,
            async () => {
                try {
                    setLoading(true);

                    console.log('=== ASSIGN TRAINER REQUEST DEBUG ===');
                    console.log('Trainer to assign:', trainerInfo.trainerIdNumber);
                    console.log('Course Run ID:', courseRunId);
                    console.log('Course Reference Number:', courseReferenceNumber);
                    console.log('=== SENDING REQUEST BODY ===');
                    console.log(JSON.stringify(requestBody, null, 2));

                    const response = await fetch(`/api/ssg/courses/courseRuns/${courseRunId}?includeExpiredCourses=false&action=assign-trainer`, {
                        method: 'POST',
                        headers: {
                            'Content-Type': 'application/json'
                        },
                        body: JSON.stringify(requestBody)
                    });

                    console.log('=== ASSIGN TRAINER API RESPONSE ===');
                    console.log('Response Status:', response.status);
                    console.log('Response OK:', response.ok);

                    if (!response.ok) {
                        const errorText = await response.text();
                        console.error('Assign Trainer API Error:', errorText);
                        throw new Error(`HTTP error! status: ${response.status}, message: ${errorText}`);
                    }

                    const data = await response.json();
                    console.log('Assign Trainer Success Response:', JSON.stringify(data, null, 2));

                    if (response.status === 200) {
                        showSuccessPopup(`Trainer ${trainerInfo.trainerIdNumber} assigned successfully to course run!`);

                        // After successful trainer assignment, fetch course run data again to get trainer name
                        console.log('🔄 Fetching updated course run data to get trainer name...');
                        try {
                            const updatedCourseRun = await fetch(`/api/ssg/courses?runId=${courseRunId}&includeExpired=false`, {
                                method: 'GET',
                                headers: {
                                    'Content-Type': 'application/json'
                                }
                            });

                            if (updatedCourseRun.ok) {
                                const updatedData = await updatedCourseRun.json();
                                console.log('✅ Updated course run data received:', updatedData);

                                // Extract trainer name and email from the response
                                const trainers = updatedData?.data?.course?.run?.linkCourseRunTrainer;
                                if (trainers && trainers.length > 0) {
                                    const trainerName = trainers[0].trainer?.name;
                                    const trainerEmail = trainers[0].trainer?.email;
                                    console.log('👨‍🏫 Trainer name from SSG:', trainerName);
                                    console.log('📧 Trainer email from SSG:', trainerEmail);

                                    if (trainerName && courseToEdit?.courseRunId) {
                                        // Debug: Check if course run exists in database
                                        console.log('🔍 Debug: Checking course run in database...');
                                        try {
                                            const debugResponse = await fetch(getApiUrl(`/api/debug/course-run-lookup?courseRunId=${courseToEdit.courseRunId}`));
                                            if (debugResponse.ok) {
                                                const debugData = await debugResponse.json();
                                                console.log('🔍 Debug response:', debugData);
                                            }
                                        } catch (debugError) {
                                            console.error('🔍 Debug endpoint error:', debugError);
                                        }

                                        // Update database with trainer name and email
                                        console.log('💾 Updating database with trainer information...');
                                        console.log('🔍 Using course UUID:', courseToEdit.id);
                                        console.log('🔍 Using courseRunId string:', courseToEdit.courseRunId);

                                        const updateResponse = await fetch(getApiUrl('/api/admin/update-trainer-info'), {
                                            method: 'POST',
                                            headers: {
                                                'Content-Type': 'application/json'
                                            },
                                            body: JSON.stringify({
                                                courseRunUuid: courseToEdit.id, // Use the UUID for database update
                                                courseRunId: courseToEdit.courseRunId, // Also send the string ID for reference
                                                trainerName: trainerName,
                                                trainerEmail: trainerEmail
                                            })
                                        });

                                        console.log('🔍 Update response status:', updateResponse.status);

                                        if (updateResponse.ok) {
                                            const updateResult = await updateResponse.json();
                                            console.log('✅ Database updated successfully:', updateResult);
                                        } else {
                                            const updateError = await updateResponse.text();
                                            console.error('❌ Failed to update database:', updateError);
                                            console.error('❌ Response status:', updateResponse.status);
                                        }
                                    } else {
                                        console.warn('⚠️ Missing trainer name or course run ID for database update');
                                        console.warn('⚠️ Trainer name:', trainerName);
                                        console.warn('⚠️ Course run ID:', courseToEdit?.courseRunId);
                                        console.warn('⚠️ Full courseToEdit object:', courseToEdit);
                                    }
                                } else {
                                    console.warn('⚠️ No trainer data found in updated course run response');
                                }

                                // Update the local SSG response data to reflect the new trainer
                                setSsgApiResponse(updatedData);
                            } else {
                                console.error('❌ Failed to fetch updated course run data');
                            }
                        } catch (fetchError) {
                            console.error('❌ Error fetching updated course run data:', fetchError);
                        }

                        // Optionally clear the trainer field after successful assignment
                        updateTrainerField(0, 'trainerIdNumber', '');
                    } else {
                        throw new Error('Failed to assign trainer: Unexpected response status');
                    }

                } catch (error) {
                    const errorMessage = error instanceof Error ? error.message : 'An error occurred during trainer assignment';
                    console.error('=== ASSIGN TRAINER ERROR ===');
                    console.error('Error Details:', error);
                    console.error('Error Message:', errorMessage);
                    showErrorPopup('Failed to assign trainer: ' + errorMessage);
                } finally {
                    setLoading(false);
                }
            },
            'Assign Trainer',
            'Assign',
            'Cancel'
        );
    };

    // Initialize form data when courseToEdit changes
    useEffect(() => {
        if (courseToEdit && isEditMode) {
            const runId = courseToEdit.courseRunId || courseToEdit.id || '';
            const refNumber = courseToEdit.courseCode || courseToEdit.referenceNumber || ''; // Use courseCode (TGS REF)

            setCourseRunId(runId);
            setCourseReferenceNumber(refNumber);
            setStartDate(courseToEdit.startDate || '');
            setEndDate(courseToEdit.endDate || '');
            setEditFormData(prev => ({
                ...prev,
                courseReferenceNumber: refNumber,
                courseStartDate: courseToEdit.startDate ? String(courseToEdit.startDate).slice(0, 10) : '',
                courseEndDate: courseToEdit.endDate ? String(courseToEdit.endDate).slice(0, 10) : '',
                openingRegistrationDate: (courseToEdit as any).registrationOpeningDate ? String((courseToEdit as any).registrationOpeningDate).slice(0, 10) : '',
                closingRegistrationDate: (courseToEdit as any).registrationClosingDate ? String((courseToEdit as any).registrationClosingDate).slice(0, 10) : ''
            }));

            // Automatically fetch course run data and course sessions, then switch to Course Run tab
            if (runId && refNumber) {
                fetchCourseRunData(runId);
                fetchCourseSessions(runId, refNumber);
                setActiveTab('courseRun'); // Auto-switch to Course Run tab for data population
            }
        }
    }, [courseToEdit, isEditMode]);

    // Fetch existing sessions when Sessions tab is activated
    useEffect(() => {
        console.log('[Sessions useEffect]', { isEditMode, activeTab, courseRunId, courseReferenceNumber });
        if (isEditMode && activeTab === 'sessions' && courseRunId && courseReferenceNumber) {
            fetchExistingSessions();
        }
    }, [activeTab, courseRunId, courseReferenceNumber, includeExpiredSessions, specifyMonthYear, selectedMonth, selectedYear]);

    // Fetch enrolled learners when Enrollments tab is activated
    useEffect(() => {
        if (isEditMode && activeTab === 'enrollments' && courseToEdit?.id) {
            fetchEnrolledLearners();
        }
    }, [activeTab, courseToEdit?.id]); // eslint-disable-line react-hooks/exhaustive-deps

    return (
        <div>
            <div className="flex justify-between items-center mb-6">
                <h2 className="text-3xl font-bold">{title}</h2>
                <div>
                    <Button variant="ghost" onClick={goBackToList} className="mr-2">{viewOnly ? 'Back to List' : 'Cancel'}</Button>
                    {viewOnly && isEditMode && (
                        <Button
                            onClick={() => {
                                setEditingCourseRun(courseToEdit);
                                setAdminPage(AdminPage.EditClass);
                            }}
                            className="bg-blue-600 hover:bg-blue-700 text-white"
                        >
                            Edit Class
                        </Button>
                    )}
                    {!viewOnly && isEditMode && activeTab === 'courseRun' && (
                        <Button
                            onClick={handleUpdateCourseRunOnly}
                            disabled={loading}
                            className="bg-blue-600 hover:bg-blue-700 text-white"
                        >
                            {loading ? (
                                <div className="flex items-center">
                                    <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white mr-2"></div>
                                    Saving...
                                </div>
                            ) : 'Save to Local Database'}
                        </Button>
                    )}
                    {!isEditMode && (
                        <Button onClick={() => {
                            showInfoPopup('Create mode functionality will be implemented');
                        }} disabled={loading}>
                            {loading ? (
                                <div className="flex items-center">
                                    <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white mr-2"></div>
                                    Creating...
                                </div>
                            ) : 'Create Class'}
                        </Button>
                    )}
                </div>
            </div>

            {isEditMode && (
                <div className="border-b border-gray-200 dark:border-gray-700 mb-6">
                    <nav className="-mb-px flex space-x-8">
                        {(['courseRun', 'sessions', 'enrollments', 'trainer', 'assessment'] as const).map(tab => (
                            <button
                                key={tab}
                                onClick={() => setActiveTab(tab)}
                                className={`whitespace-nowrap py-2 px-1 border-b-2 font-medium text-sm transition-colors ${
                                    activeTab === tab
                                        ? 'border-blue-500 text-blue-500'
                                        : 'border-transparent text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 hover:border-gray-300 dark:hover:border-gray-500'
                                }`}
                            >
                                {tab === 'courseRun' ? 'Course Run' : tab === 'sessions' ? 'Sessions' : tab === 'enrollments' ? 'Enrolled Learners' : tab === 'trainer' ? 'Trainer' : 'Assessment'}
                            </button>
                        ))}
                    </nav>
                </div>
            )}

            <div className="space-y-6">
                {/* Course Run Tab */}
                {(!isEditMode || activeTab === 'courseRun') && (
                    <>
                        {isEditMode && ssgDataPopulated && !ssgApiLoading && (
                            <div className="bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-700 rounded-md p-3 mb-4 flex items-start justify-between gap-3">
                                <p className="text-sm text-green-800 dark:text-green-300 flex-1">
                                    <strong>✓ Form populated with SSG data</strong> - The form fields below have been automatically filled with data from the SSG API. You can modify any field as needed before updating.
                                </p>
                                <button
                                    type="button"
                                    onClick={() => fetchCourseRunData(courseRunId)}
                                    disabled={ssgApiLoading || !courseRunId}
                                    className="flex-shrink-0 px-3 py-1 text-xs font-medium rounded border border-green-300 dark:border-green-600 text-green-800 dark:text-green-300 hover:bg-green-100 dark:hover:bg-green-900/40 disabled:opacity-50"
                                    title="Re-fetch this course run from SSG and re-populate the form"
                                >
                                    Refetch
                                </button>
                            </div>
                        )}

                        {isEditMode && ssgApiResponse && !ssgApiLoading && !ssgDataPopulated && (
                            <div className="bg-yellow-50 dark:bg-yellow-900/20 border border-yellow-200 dark:border-yellow-700 rounded-md p-3 mb-4 flex items-start justify-between gap-3">
                                <p className="text-sm text-yellow-800 dark:text-yellow-300 flex-1">
                                    <strong>⚠ SSG data retrieved but form not populated</strong> - The SSG API returned data, but the form fields could not be filled. The response may have an unexpected structure.
                                </p>
                                <button
                                    type="button"
                                    onClick={() => fetchCourseRunData(courseRunId)}
                                    disabled={ssgApiLoading || !courseRunId}
                                    className="flex-shrink-0 px-3 py-1 text-xs font-medium rounded border border-yellow-400 dark:border-yellow-600 text-yellow-900 dark:text-yellow-200 hover:bg-yellow-100 dark:hover:bg-yellow-900/40 disabled:opacity-50"
                                    title="Re-fetch this course run from SSG and retry populating the form. Switch SSG App above if you suspect the wrong cert is being used."
                                >
                                    Refetch
                                </button>
                            </div>
                        )}

                        {isEditMode && ssgApiLoading && (
                            <div className="bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-700 rounded-md p-3 mb-4">
                                <div className="flex items-center">
                                    <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-blue-600 mr-2"></div>
                                    <p className="text-sm text-blue-800 dark:text-blue-300">
                                        <strong>Loading SSG data...</strong> Form fields will be populated automatically when data is retrieved.
                                    </p>
                                </div>
                            </div>
                        )}

                        <FormSection title="Basic Class Information">
                            {isEditMode && courseToEdit?.courseTitle && (
                                <div className="mb-4">
                                    <label className="block text-sm font-bold text-gray-700 dark:text-gray-300 mb-1">Course Title</label>
                                    <input
                                        type="text"
                                        value={courseToEdit.courseTitle}
                                        className={`${inputClasses} ${disabledInputClasses}`}
                                        readOnly
                                        disabled
                                    />
                                </div>
                            )}
                            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-2 gap-4">
                                <div>
                                    <label className="block text-sm font-bold text-gray-700 dark:text-gray-300 mb-1">
                                        Course Run ID *
                                    </label>
                                    <input
                                        type="text"
                                        value={courseRunId}
                                        onChange={e => setCourseRunId(e.target.value)}
                                        className={`${inputClasses} ${isEditMode ? disabledInputClasses : ''}`}
                                        placeholder="Enter course run ID"
                                        readOnly={isEditMode}
                                        disabled={isEditMode}
                                    />
                                </div>
                                {isEditMode && (
                                    <div>
                                        <label className="block text-sm font-bold text-gray-700 dark:text-gray-300 mb-1">
                                            Course Reference Number *
                                        </label>
                                        <input
                                            type="text"
                                            value={courseReferenceNumber}
                                            onChange={e => setCourseReferenceNumber(e.target.value)}
                                            className={`${inputClasses} ${disabledInputClasses}`}
                                            placeholder="Enter course reference number"
                                            readOnly={isEditMode}
                                            disabled={isEditMode}
                                        />
                                    </div>
                                )}
                            </div>
                        </FormSection>

                        {/* Class Status & Type */}
                        {isEditMode && (
                            <FormSection title="Class Status & Type">
                                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                                    <div>
                                        <label className="block text-sm font-bold text-gray-700 dark:text-gray-300 mb-1">Class Status *</label>
                                        <select
                                            value={classStatus}
                                            onChange={async (e) => {
                                                const newStatus = e.target.value;
                                                setClassStatus(newStatus);
                                                if (courseToEdit?.id) {
                                                    try {
                                                        await fetch(getApiUrl('/api/admin/upcoming-classes'), {
                                                            method: 'PUT',
                                                            headers: { 'Content-Type': 'application/json' },
                                                            body: JSON.stringify({ id: courseToEdit.id, class_status: newStatus }),
                                                        });
                                                    } catch { /* silent */ }
                                                }
                                            }}
                                            className={`${inputClasses} text-center`}
                                        >
                                            <option value="Confirmed">Confirmed</option>
                                            <option value="Pending">Pending</option>
                                            <option value="Cancelled">Cancelled</option>
                                            <option value="Unconfirmed">Unconfirmed</option>
                                        </select>
                                    </div>
                                    <div>
                                        <label className="block text-sm font-bold text-gray-700 dark:text-gray-300 mb-1">Class Type *</label>
                                        <select
                                            value={classType}
                                            onChange={async (e) => {
                                                const newType = e.target.value;
                                                setClassType(newType);
                                                if (courseToEdit?.id) {
                                                    try {
                                                        await fetch(getApiUrl('/api/admin/upcoming-classes'), {
                                                            method: 'PUT',
                                                            headers: { 'Content-Type': 'application/json' },
                                                            body: JSON.stringify({ id: courseToEdit.id, class_type: newType }),
                                                        });
                                                    } catch { /* silent */ }
                                                }
                                            }}
                                            className={inputClasses}
                                        >
                                            <option value="Physical">Physical</option>
                                            <option value="Virtual">Virtual</option>
                                            <option value="Hybrid">Hybrid</option>
                                            <option value="External">External</option>
                                        </select>
                                    </div>
                                </div>
                            </FormSection>
                        )}

                        {/* Virtual Meeting Link */}
                        {isEditMode && (
                            <FormSection title="Virtual Meeting">
                                <div>
                                    <div className="mb-3 grid grid-cols-1 md:grid-cols-2 gap-3">
                                        <div>
                                            <label className="block text-sm font-bold text-gray-700 dark:text-gray-300 mb-1">Provider</label>
                                            <select
                                                value={virtualMeetingProvider}
                                                onChange={(e) => {
                                                    const nextProvider = e.target.value as 'google_meet' | 'zoom' | 'teams';
                                                    setVirtualMeetingProvider(nextProvider);
                                                    setVirtualMeetingLink(nextProvider === storedVirtualMeetingProvider ? storedVirtualMeetingLink : '');
                                                }}
                                                className={inputClasses}
                                            >
                                                <option value="google_meet">Google Meet</option>
                                                <option value="zoom">Zoom</option>
                                                <option value="teams">Microsoft Teams</option>
                                            </select>
                                        </div>
                                        {virtualMeetingProvider === 'zoom' && (
                                            <div className="relative flex items-end">
                                                <div className="h-10 flex items-center">
                                                    <Button
                                                        variant="secondary"
                                                        size="sm"
                                                        type="button"
                                                        onClick={() => handleGenerateZoomMeeting(!!storedVirtualMeetingLink)}
                                                        disabled={meetingBusy || !canGenerateZoomMeeting}
                                                        className="w-auto flex-none"
                                                    >
                                                        {meetingBusy ? 'Generating...' : hasStoredZoomMeeting ? 'Regenerate Zoom Meeting' : 'Generate Zoom Meeting'}
                                                    </Button>
                                                </div>
                                                {!canGenerateZoomMeeting && (
                                                    <p className="absolute left-0 top-full mt-1 w-max max-w-[min(28rem,90vw)] text-xs text-amber-600 dark:text-amber-400">
                                                        Set Class Type to Virtual or Hybrid before generating a Zoom meeting.
                                                    </p>
                                                )}
                                            </div>
                                        )}
                                    </div>
                                    {isZoomMeetingProvider ? (
                                        <div className="space-y-4">
                                            <div>
                                                <label className="block text-sm font-bold text-gray-700 dark:text-gray-300 mb-1">Trainer Zoom Start URL</label>
                                                <input
                                                    type="url"
                                                    value={virtualMeetingHostLink}
                                                    onChange={(e) => setVirtualMeetingHostLink(e.target.value)}
                                                    placeholder="https://zoom.us/s/..."
                                                    className={inputClasses}
                                                />
                                                {virtualMeetingHostLink && (
                                                    <a href={virtualMeetingHostLink} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 mt-2 text-sm text-blue-600 hover:underline">
                                                        Open trainer start URL
                                                    </a>
                                                )}
                                                <p className="mt-1 text-xs text-amber-600 dark:text-amber-400">
                                                    Sensitive trainer-only URL. This starts the Zoom meeting with host access and must not be shared with learners.
                                                </p>
                                            </div>
                                            <div>
                                                <label className="block text-sm font-bold text-gray-700 dark:text-gray-300 mb-1">Learner Join URL</label>
                                                <input
                                                    type="url"
                                                    value={virtualMeetingLink}
                                                    onChange={(e) => setVirtualMeetingLink(e.target.value)}
                                                    placeholder="https://zoom.us/j/..."
                                                    className={inputClasses}
                                                />
                                                {virtualMeetingLink && (
                                                    <a href={virtualMeetingLink} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 mt-2 text-sm text-blue-600 hover:underline">
                                                        Open learner join URL
                                                    </a>
                                                )}
                                                <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
                                                    This URL is shown to learners. Trainers can also join with it, but may not have host/admin controls.
                                                </p>
                                            </div>
                                            <div>
                                                <Button
                                                    variant="primary"
                                                    size="sm"
                                                    type="button"
                                                    onClick={handleSaveVirtualMeeting}
                                                >
                                                    Save Zoom URLs
                                                </Button>
                                            </div>
                                        </div>
                                    ) : (
                                        <>
                                            <label className="block text-sm font-bold text-gray-700 dark:text-gray-300 mb-1">Virtual Meeting Link</label>
                                            <div className="flex gap-3">
                                                <input
                                                    type="url"
                                                    value={virtualMeetingLink}
                                                    onChange={(e) => setVirtualMeetingLink(e.target.value)}
                                                    placeholder={virtualMeetingProvider === 'teams' ? 'https://teams.microsoft.com/l/meetup-join/...' : 'https://meet.google.com/xxx-xxxx-xxx'}
                                                    className={inputClasses}
                                                />
                                                <Button
                                                    variant="primary"
                                                    size="sm"
                                                    type="button"
                                                    onClick={handleSaveVirtualMeeting}
                                                >
                                                    Save
                                                </Button>
                                            </div>
                                            {virtualMeetingLink && (
                                                <a href={virtualMeetingLink} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 mt-2 text-sm text-blue-600 hover:underline">
                                                    Open {virtualMeetingProviderLabel}
                                                </a>
                                            )}
                                            <p className="mt-1 text-xs text-gray-400">
                                                Google Meet links are synced from Google Calendar; Teams links can be entered manually.
                                            </p>
                                        </>
                                    )}
                                </div>
                            </FormSection>
                        )}

                        {/* Course Vacancy Details */}
                        {isEditMode && (
                            <FormSection title="Course Vacancy Details">
                                <div>
                                    <label className="block text-sm font-bold text-gray-700 dark:text-gray-300 mb-1">Course Vacancy *</label>
                                    <select
                                        value={editFormData.courseVacancy?.code || ''}
                                        onChange={(e) => handleInputChange('courseVacancy', {
                                            code: e.target.value,
                                            description: vacancyOptions.find(opt => opt.value === e.target.value)?.label
                                        })}
                                        className={inputClasses}
                                    >
                                        <option value="">Select course vacancy</option>
                                        {vacancyOptions.map(option => (
                                            <option key={option.value} value={option.value}>
                                                {option.label}
                                            </option>
                                        ))}
                                    </select>
                                </div>
                            </FormSection>
                        )}

                        {/* Registration Dates */}
                        {isEditMode && (
                            <FormSection title="Registration Dates">
                                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                                    <div>
                                        <label className="block text-sm font-bold text-gray-700 dark:text-gray-300 mb-1">Opening Registration Date *</label>
                                        <input
                                            type="date"
                                            value={editFormData.openingRegistrationDate || ''}
                                            onChange={(e) => handleInputChange('openingRegistrationDate', e.target.value)}
                                            className={inputClasses}
                                        />
                                    </div>
                                    <div>
                                        <label className="block text-sm font-bold text-gray-700 dark:text-gray-300 mb-1">Closing Registration Date *</label>
                                        <input
                                            type="date"
                                            value={editFormData.closingRegistrationDate || ''}
                                            onChange={(e) => handleInputChange('closingRegistrationDate', e.target.value)}
                                            className={inputClasses}
                                        />
                                    </div>
                                </div>
                            </FormSection>
                        )}

                        {/* Course Dates */}
                        {isEditMode && (
                            <FormSection title="Course Dates">
                                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                                    <div>
                                        <label className="block text-sm font-bold text-gray-700 dark:text-gray-300 mb-1">Course Start Date *</label>
                                        <input
                                            type="date"
                                            value={editFormData.courseStartDate || startDate}
                                            onChange={(e) => {
                                                handleInputChange('courseStartDate', e.target.value);
                                                setStartDate(e.target.value);
                                            }}
                                            className={inputClasses}
                                        />
                                    </div>
                                    <div>
                                        <label className="block text-sm font-bold text-gray-700 dark:text-gray-300 mb-1">Course End Date *</label>
                                        <input
                                            type="date"
                                            value={editFormData.courseEndDate || endDate}
                                            onChange={(e) => {
                                                handleInputChange('courseEndDate', e.target.value);
                                                setEndDate(e.target.value);
                                            }}
                                            className={inputClasses}
                                        />
                                    </div>
                                </div>
                            </FormSection>
                        )}

                        {/* Venue Information */}
                        {isEditMode && (
                            <FormSection title="Venue Information">
                                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                                    <div>
                                        <label className="block text-sm font-bold text-gray-700 dark:text-gray-300 mb-1">Block *</label>
                                        <input
                                            type="text"
                                            value={editFormData.block || ''}
                                            onChange={(e) => handleInputChange('block', e.target.value)}
                                            className={inputClasses}
                                            placeholder="Enter block"
                                            required
                                        />
                                    </div>
                                    <div>
                                        <label className="block text-sm font-bold text-gray-700 dark:text-gray-300 mb-1">Street *</label>
                                        <input
                                            type="text"
                                            value={editFormData.street || ''}
                                            onChange={(e) => handleInputChange('street', e.target.value)}
                                            className={inputClasses}
                                            placeholder="Enter street"
                                            required
                                        />
                                    </div>
                                    <div>
                                        <label className="block text-sm font-bold text-gray-700 dark:text-gray-300 mb-1">Building *</label>
                                        <input
                                            type="text"
                                            value={editFormData.building || ''}
                                            onChange={(e) => handleInputChange('building', e.target.value)}
                                            className={inputClasses}
                                            placeholder="Enter building"
                                            required
                                        />
                                    </div>
                                    <div>
                                        <label className="block text-sm font-bold text-gray-700 dark:text-gray-300 mb-1">Floor *</label>
                                        <input
                                            type="text"
                                            value={editFormData.floor || ''}
                                            onChange={(e) => handleInputChange('floor', e.target.value)}
                                            className={inputClasses}
                                            placeholder="Enter floor"
                                            required
                                        />
                                    </div>
                                    <div>
                                        <label className="block text-sm font-bold text-gray-700 dark:text-gray-300 mb-1">Unit *</label>
                                        <input
                                            type="text"
                                            value={editFormData.unit || ''}
                                            onChange={(e) => handleInputChange('unit', e.target.value)}
                                            className={inputClasses}
                                            placeholder="Enter unit"
                                            required
                                        />
                                    </div>
                                    <div>
                                        <label className="block text-sm font-bold text-gray-700 dark:text-gray-300 mb-1">Postal Code *</label>
                                        <input
                                            type="text"
                                            value={editFormData.postalCode || ''}
                                            onChange={(e) => handleInputChange('postalCode', e.target.value)}
                                            className={inputClasses}
                                            placeholder="Enter postal code"
                                            required
                                        />
                                    </div>
                                    <div>
                                        <label className="block text-sm font-bold text-gray-700 dark:text-gray-300 mb-1">Room *</label>
                                        <input
                                            type="text"
                                            value={editFormData.room || ''}
                                            onChange={(e) => handleInputChange('room', e.target.value)}
                                            className={inputClasses}
                                            placeholder="Enter room"
                                            required
                                        />
                                    </div>
                                    <div>
                                        <label className="block text-sm font-bold text-gray-700 dark:text-gray-300 mb-1">Wheelchair Access *</label>
                                        <select
                                            value={editFormData.wheelChairAccess || ''}
                                            onChange={(e) => handleInputChange('wheelChairAccess', e.target.value as OptionalSelector)}
                                            className={inputClasses}
                                            required
                                        >
                                            <option value="">Select wheelchair access</option>
                                            {optionalSelectorOptions.map(option => (
                                                <option key={option.value} value={option.value}>
                                                    {option.label}
                                                </option>
                                            ))}
                                        </select>
                                    </div>
                                </div>
                            </FormSection>
                        )}

                        {/* Course Administration */}
                        {isEditMode && (
                            <FormSection title="Course Administration">
                                <div>
                                    <label className="block text-sm font-bold text-gray-700 dark:text-gray-300 mb-1">Course Admin Email</label>
                                    <input
                                        type="email"
                                        value={editFormData.courseAdminEmail || ''}
                                        onChange={(e) => handleInputChange('courseAdminEmail', e.target.value)}
                                        className={`${inputClasses} ${ssgApiResponse?.data ? 'bg-gray-100' : ''}`}
                                        placeholder="Enter course admin email"
                                    />
                                </div>

                            </FormSection>
                        )}
                    </>
                )}

                {/* Sessions Tab */}
                {isEditMode && activeTab === 'sessions' && (
                    <FormSection title="Sessions Management">
                        <div className="space-y-4">
                            {sessionsLoading && (
                                <div className="text-blue-600 mb-4">Loading existing sessions...</div>
                            )}

                            {!sessionsLoading && (
                                <>
                                    {/* Add New Session button at top right */}
                                    <div className="flex justify-end mb-2">
                                        <Button
                                            type="button"
                                            variant="primary"
                                            onClick={toggleNewSessionForm}
                                            className="bg-green-600 text-white hover:bg-green-700"
                                        >
                                            {showNewSessionForm ? 'Cancel Add Session' : 'Add New Session'}
                                        </Button>
                                    </div>

                                    {hasExistingSessions ? (
                                        <div className="space-y-4">
                                            {/* Sessions Table */}
                                            <div className="overflow-x-auto">
                                                <table className="w-full text-sm whitespace-nowrap">
                                                    <thead className="bg-gray-100 dark:bg-gray-700/60">
                                                        <tr>
                                                            <th className="text-left py-3 px-3 font-semibold">Session</th>
                                                            <th className="text-left py-3 px-3 font-semibold">Date</th>
                                                            <th className="text-left py-3 px-3 font-semibold">Time</th>
                                                            <th className="text-left py-3 px-3 font-semibold">Mode</th>
                                                            <th className="text-right py-3 px-3 font-semibold"></th>
                                                        </tr>
                                                    </thead>
                                                    <tbody>
                                                        {existingSessions.map((session: any, index: number) => (
                                                            <tr key={session.id || index} className="border-b border-gray-100 dark:border-gray-800">
                                                                <td className="py-3 px-3 text-gray-500 font-medium">S{index + 1}</td>
                                                                <td className="py-3 px-3">{session.startDate ? formatDateForDisplay(session.startDate) : 'N/A'} - {session.endDate ? formatDateForDisplay(session.endDate) : 'N/A'}</td>
                                                                <td className="py-3 px-3">{session.startTime || 'N/A'} - {session.endTime || 'N/A'}</td>
                                                                <td className="py-3 px-3">{getModeLabel(session.modeOfTraining)}</td>
                                                                <td className="py-3 px-3 text-right">
                                                                    <Button variant="ghost" onClick={() => startEditingSession(index)} className="!text-blue-600 hover:!bg-blue-50" size="sm">Edit</Button>
                                                                </td>
                                                            </tr>
                                                        ))}
                                                    </tbody>
                                                </table>
                                            </div>

                                            {/* Inline edit form for a selected session */}
                                            {editingSessionIndex !== null && existingSessions[editingSessionIndex] && (() => {
                                                const index = editingSessionIndex;
                                                const session = existingSessions[index];
                                                return (
                                                <Card key={session.id || index} className="p-4 bg-gray-50 dark:bg-gray-800/60">
                                                    {true ? (
                                                        // Editing mode for existing session
                                                        <div className="space-y-3">
                                                            <h4 className="font-medium text-blue-600">Edit Session {index + 1}</h4>
                                                            <div className="grid grid-cols-2 gap-4">
                                                                <div>
                                                                    <label className="block text-sm font-medium mb-1">Session ID</label>
                                                                    <input
                                                                        type="text"
                                                                        value={session.id || ''}
                                                                        readOnly
                                                                        className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-md bg-gray-100 dark:bg-gray-800 text-gray-500 dark:text-gray-400 cursor-not-allowed"
                                                                        placeholder="Session ID (Read Only)"
                                                                    />
                                                                </div>
                                                                <div>
                                                                    <label className="block text-sm font-medium mb-1">Mode of Training</label>
                                                                    <select
                                                                        value={session.modeOfTraining || ''}
                                                                        onChange={(e) => {
                                                                            const updatedSessions = [...existingSessions];
                                                                            updatedSessions[index] = handleSessionFieldUpdate(updatedSessions[index], 'modeOfTraining', e.target.value);
                                                                            setExistingSessions(updatedSessions);
                                                                        }}
                                                                        className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-md bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
                                                                    >
                                                                        <option value="">Select mode of training</option>
                                                                        <option value="1">1 - Classroom</option>
                                                                        <option value="2">2 - Asynchronous eLearning</option>
                                                                        <option value="3">3 - In-house</option>
                                                                        <option value="4">4 - On-the-Job</option>
                                                                        <option value="5">5 - Blended Learning</option>
                                                                        <option value="6">6 - Synchronous eLearning</option>
                                                                        <option value="7">7 - Practical / Traineeship</option>
                                                                        <option value="8">8 - Assessment</option>
                                                                        <option value="9">9 - Virtual Classroom</option>
                                                                    </select>
                                                                </div>
                                                                <div>
                                                                    <label className="block text-sm font-medium mb-1">Session Start Date</label>
                                                                    <input
                                                                        type="date"
                                                                        value={session.startDate ? convertSsgDateToHtml(session.startDate) : ''}
                                                                        onChange={(e) => {
                                                                            const updatedSessions = [...existingSessions];
                                                                            updatedSessions[index] = handleSessionFieldUpdate(updatedSessions[index], 'startDate', e.target.value);
                                                                            setExistingSessions(updatedSessions);
                                                                        }}
                                                                        className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-md bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
                                                                    />
                                                                </div>
                                                                <div>
                                                                    <label className="block text-sm font-medium mb-1">Session End Date</label>
                                                                    <input
                                                                        type="date"
                                                                        value={session.endDate ? convertSsgDateToHtml(session.endDate) : ''}
                                                                        onChange={(e) => {
                                                                            const updatedSessions = [...existingSessions];
                                                                            updatedSessions[index] = { ...updatedSessions[index], endDate: e.target.value };
                                                                            setExistingSessions(updatedSessions);
                                                                        }}
                                                                        className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-md bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
                                                                        disabled={session.modeOfTraining === '2' || session.modeOfTraining === '4' ? false : false}
                                                                    />
                                                                    {(session.modeOfTraining && session.modeOfTraining !== '2' && session.modeOfTraining !== '4') && (
                                                                        <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">Auto-filled from start date for this mode</p>
                                                                    )}
                                                                </div>
                                                                <div>
                                                                    <label className="block text-sm font-medium mb-1">Session Start Time</label>
                                                                    <input
                                                                        type="time"
                                                                        value={session.startTime || ''}
                                                                        onChange={(e) => {
                                                                            const updatedSessions = [...existingSessions];
                                                                            updatedSessions[index] = { ...updatedSessions[index], startTime: e.target.value };
                                                                            setExistingSessions(updatedSessions);
                                                                        }}
                                                                        className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-md bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
                                                                        disabled={session.modeOfTraining === '2' || session.modeOfTraining === '4'}
                                                                    />
                                                                    {(session.modeOfTraining === '2' || session.modeOfTraining === '4') && (
                                                                        <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">Auto-set to 00:00 for this mode</p>
                                                                    )}
                                                                </div>
                                                                <div>
                                                                    <label className="block text-sm font-medium mb-1">Session End Time</label>
                                                                    <input
                                                                        type="time"
                                                                        value={session.endTime || ''}
                                                                        onChange={(e) => {
                                                                            const updatedSessions = [...existingSessions];
                                                                            updatedSessions[index] = { ...updatedSessions[index], endTime: e.target.value };
                                                                            setExistingSessions(updatedSessions);
                                                                        }}
                                                                        className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-md bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
                                                                        disabled={session.modeOfTraining === '2' || session.modeOfTraining === '4'}
                                                                    />
                                                                    {(session.modeOfTraining === '2' || session.modeOfTraining === '4') && (
                                                                        <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">Auto-set to 23:59 for this mode</p>
                                                                    )}
                                                                </div>
                                                            </div>

                                                            {/* Session Venue Fields */}
                                                            <div className="border-t pt-4">
                                                                <h5 className="text-md font-medium text-gray-700 dark:text-gray-300 mb-3">Session Venue</h5>
                                                                <div className="grid grid-cols-2 gap-4">
                                                                    <div>
                                                                        <label className="block text-sm font-medium mb-1">Block</label>
                                                                        <input
                                                                            type="text"
                                                                            value={session.venue?.block || ''}
                                                                            onChange={(e) => {
                                                                                const updatedSessions = [...existingSessions];
                                                                                updatedSessions[index] = {
                                                                                    ...updatedSessions[index],
                                                                                    venue: { ...updatedSessions[index].venue, block: e.target.value }
                                                                                };
                                                                                setExistingSessions(updatedSessions);
                                                                            }}
                                                                            className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-md bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
                                                                            placeholder="Enter block"
                                                                        />
                                                                    </div>
                                                                    <div>
                                                                        <label className="block text-sm font-medium mb-1">Street</label>
                                                                        <input
                                                                            type="text"
                                                                            value={session.venue?.street || ''}
                                                                            onChange={(e) => {
                                                                                const updatedSessions = [...existingSessions];
                                                                                updatedSessions[index] = {
                                                                                    ...updatedSessions[index],
                                                                                    venue: { ...updatedSessions[index].venue, street: e.target.value }
                                                                                };
                                                                                setExistingSessions(updatedSessions);
                                                                            }}
                                                                            className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-md bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
                                                                            placeholder="Enter street"
                                                                        />
                                                                    </div>
                                                                    <div>
                                                                        <label className="block text-sm font-medium mb-1">Building</label>
                                                                        <input
                                                                            type="text"
                                                                            value={session.venue?.building || ''}
                                                                            onChange={(e) => {
                                                                                const updatedSessions = [...existingSessions];
                                                                                updatedSessions[index] = {
                                                                                    ...updatedSessions[index],
                                                                                    venue: { ...updatedSessions[index].venue, building: e.target.value }
                                                                                };
                                                                                setExistingSessions(updatedSessions);
                                                                            }}
                                                                            className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-md bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
                                                                            placeholder="Enter building"
                                                                        />
                                                                    </div>
                                                                    <div>
                                                                        <label className="block text-sm font-medium mb-1">Floor</label>
                                                                        <input
                                                                            type="text"
                                                                            value={session.venue?.floor || ''}
                                                                            onChange={(e) => {
                                                                                const updatedSessions = [...existingSessions];
                                                                                updatedSessions[index] = {
                                                                                    ...updatedSessions[index],
                                                                                    venue: { ...updatedSessions[index].venue, floor: e.target.value }
                                                                                };
                                                                                setExistingSessions(updatedSessions);
                                                                            }}
                                                                            className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-md bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
                                                                            placeholder="Enter floor"
                                                                        />
                                                                    </div>
                                                                    <div>
                                                                        <label className="block text-sm font-medium mb-1">Unit</label>
                                                                        <input
                                                                            type="text"
                                                                            value={session.venue?.unit || ''}
                                                                            onChange={(e) => {
                                                                                const updatedSessions = [...existingSessions];
                                                                                updatedSessions[index] = {
                                                                                    ...updatedSessions[index],
                                                                                    venue: { ...updatedSessions[index].venue, unit: e.target.value }
                                                                                };
                                                                                setExistingSessions(updatedSessions);
                                                                            }}
                                                                            className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-md bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
                                                                            placeholder="Enter unit"
                                                                        />
                                                                    </div>
                                                                    <div>
                                                                        <label className="block text-sm font-medium mb-1">Postal Code</label>
                                                                        <input
                                                                            type="text"
                                                                            value={session.venue?.postalCode || ''}
                                                                            onChange={(e) => {
                                                                                const updatedSessions = [...existingSessions];
                                                                                updatedSessions[index] = {
                                                                                    ...updatedSessions[index],
                                                                                    venue: { ...updatedSessions[index].venue, postalCode: e.target.value }
                                                                                };
                                                                                setExistingSessions(updatedSessions);
                                                                            }}
                                                                            className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-md bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
                                                                            placeholder="Enter postal code"
                                                                        />
                                                                    </div>
                                                                    <div>
                                                                        <label className="block text-sm font-medium mb-1">Room</label>
                                                                        <input
                                                                            type="text"
                                                                            value={session.venue?.room || ''}
                                                                            onChange={(e) => {
                                                                                const updatedSessions = [...existingSessions];
                                                                                updatedSessions[index] = {
                                                                                    ...updatedSessions[index],
                                                                                    venue: { ...updatedSessions[index].venue, room: e.target.value }
                                                                                };
                                                                                setExistingSessions(updatedSessions);
                                                                            }}
                                                                            className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-md bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
                                                                            placeholder="Enter room"
                                                                        />
                                                                    </div>
                                                                    <div>
                                                                        <label className="block text-sm font-medium mb-1">Wheelchair Access</label>
                                                                        <select
                                                                            value={session.venue?.wheelChairAccess !== undefined ? (session.venue.wheelChairAccess ? 'true' : 'false') : ''}
                                                                            onChange={(e) => {
                                                                                const updatedSessions = [...existingSessions];
                                                                                updatedSessions[index] = {
                                                                                    ...updatedSessions[index],
                                                                                    venue: { ...updatedSessions[index].venue, wheelChairAccess: e.target.value === 'true' }
                                                                                };
                                                                                setExistingSessions(updatedSessions);
                                                                            }}
                                                                            className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-md bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
                                                                        >
                                                                            <option value="">Select wheelchair access</option>
                                                                            <option value="true">Yes</option>
                                                                            <option value="false">No</option>
                                                                        </select>
                                                                    </div>
                                                                </div>
                                                            </div>

                                                            <div className="flex justify-end space-x-2 mt-4">
                                                                <button
                                                                    type="button"
                                                                    onClick={() => cancelEditingSession()}
                                                                    className="px-4 py-2 bg-gray-500 text-white rounded hover:bg-gray-600"
                                                                >
                                                                    Cancel
                                                                </button>
                                                                <button
                                                                    type="button"
                                                                    onClick={() => updateExistingSession(index)}
                                                                    className="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700"
                                                                >
                                                                    Update Session
                                                                </button>
                                                            </div>
                                                        </div>
                                                    ) : null}
                                                </Card>
                                                );
                                            })()}
                                        </div>
                                    ) : (
                                        <div className="text-center py-8">
                                            <p className="text-gray-500 dark:text-gray-400">No existing sessions found.</p>
                                        </div>
                                    )}

                                    {/* Multiple New Session Forms */}
                                    {showNewSessionForm && (
                                        <div className="space-y-4">
                                            {newSessions.map((session, index) => (
                                                <Card key={index} className="p-4 bg-green-50 dark:bg-green-900/20 space-y-3 border-green-200 dark:border-green-700">
                                                    <div className="flex justify-between items-center">
                                                        <h4 className="font-medium text-green-700 dark:text-green-400">
                                                            {index === 0 ? 'Add New Session' : `Add New Session ${index + 1}`}
                                                        </h4>
                                                        {index > 0 && (
                                                            <button
                                                                type="button"
                                                                onClick={() => removeSessionForm(index)}
                                                                className="px-3 py-1 bg-red-500 text-white text-sm rounded hover:bg-red-600"
                                                            >
                                                                Remove
                                                            </button>
                                                        )}
                                                    </div>
                                                    {/* Mode of Training - Full Width Row */}
                                                    <div className="w-full">
                                                        <label className="block text-sm font-medium mb-1">Mode of Training</label>
                                                        <select
                                                            value={session.modeOfTraining}
                                                            onChange={(e) => updateNewSessionField(index, 'modeOfTraining', e.target.value)}
                                                            className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-md bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
                                                        >
                                                            <option value="">Select mode of training</option>
                                                            {modeOfTrainingOptions.map(option => (
                                                                <option key={option.value} value={option.value}>
                                                                    {option.label}
                                                                </option>
                                                            ))}
                                                        </select>
                                                    </div>

                                                    {/* Date and Time Fields in Grid */}
                                                    <div className="grid grid-cols-2 gap-4">
                                                        <div>
                                                            <label className="block text-sm font-medium mb-1">Session Start Date</label>
                                                            <input
                                                                type="date"
                                                                value={session.startDate}
                                                                onChange={(e) => updateNewSessionField(index, 'startDate', e.target.value)}
                                                                className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-md bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
                                                            />
                                                        </div>
                                                        <div>
                                                            <label className="block text-sm font-medium mb-1">Session End Date</label>
                                                            <input
                                                                type="date"
                                                                value={session.endDate}
                                                                onChange={(e) => updateNewSessionField(index, 'endDate', e.target.value)}
                                                                className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-md bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
                                                            />
                                                            {(session.modeOfTraining && session.modeOfTraining !== '2' && session.modeOfTraining !== '4') && (
                                                                <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">Auto-filled from start date for this mode</p>
                                                            )}
                                                        </div>
                                                        <div>
                                                            <label className="block text-sm font-medium mb-1">Session Start Time</label>
                                                            <input
                                                                type="time"
                                                                value={session.startTime}
                                                                onChange={(e) => updateNewSessionField(index, 'startTime', e.target.value)}
                                                                className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-md bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
                                                                disabled={session.modeOfTraining === '2' || session.modeOfTraining === '4'}
                                                            />
                                                            {(session.modeOfTraining === '2' || session.modeOfTraining === '4') && (
                                                                <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">Auto-set to 00:00 for this mode</p>
                                                            )}
                                                        </div>
                                                        <div>
                                                            <label className="block text-sm font-medium mb-1">Session End Time</label>
                                                            <input
                                                                type="time"
                                                                value={session.endTime}
                                                                onChange={(e) => updateNewSessionField(index, 'endTime', e.target.value)}
                                                                className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-md bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
                                                                disabled={session.modeOfTraining === '2' || session.modeOfTraining === '4'}
                                                            />
                                                            {(session.modeOfTraining === '2' || session.modeOfTraining === '4') && (
                                                                <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">Auto-set to 23:59 for this mode</p>
                                                            )}
                                                        </div>
                                                    </div>

                                                    {/* Session Venue Fields */}
                                                    <div className="border-t pt-4">
                                                        <h5 className="text-md font-medium text-gray-700 dark:text-gray-300 mb-3">Session Venue</h5>
                                                        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
                                                            <div>
                                                                <label className="block text-sm font-medium mb-1">Floor *</label>
                                                                <input
                                                                    type="text"
                                                                    value={session.floor || ''}
                                                                    onChange={(e) => updateNewSessionField(index, 'floor', e.target.value)}
                                                                    className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-md bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
                                                                    maxLength={3}
                                                                    placeholder="Enter floor"
                                                                />
                                                            </div>
                                                            <div>
                                                                <label className="block text-sm font-medium mb-1">Unit *</label>
                                                                <input
                                                                    type="text"
                                                                    value={session.unit || ''}
                                                                    onChange={(e) => updateNewSessionField(index, 'unit', e.target.value)}
                                                                    className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-md bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
                                                                    maxLength={5}
                                                                    placeholder="Enter unit"
                                                                />
                                                            </div>
                                                            <div>
                                                                <label className="block text-sm font-medium mb-1">Postal Code *</label>
                                                                <input
                                                                    type="text"
                                                                    value={session.postalCode || ''}
                                                                    onChange={(e) => updateNewSessionField(index, 'postalCode', e.target.value)}
                                                                    className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-md bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
                                                                    maxLength={6}
                                                                    placeholder="Enter postal code"
                                                                />
                                                            </div>
                                                            <div>
                                                                <label className="block text-sm font-medium mb-1">Room *</label>
                                                                <input
                                                                    type="text"
                                                                    value={session.room || ''}
                                                                    onChange={(e) => updateNewSessionField(index, 'room', e.target.value)}
                                                                    className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-md bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
                                                                    maxLength={255}
                                                                    placeholder="Enter room"
                                                                />
                                                            </div>
                                                        </div>
                                                    </div>
                                                </Card>
                                            ))}

                                            {/* Action Buttons */}
                                            <div className="space-y-3">
                                                {/* Add Session Button - Centered */}
                                                <div className="flex justify-center">
                                                    <Button
                                                        type="button"
                                                        variant="primary"
                                                        onClick={addNewSessionForm}
                                                        className="px-6 py-2 bg-green-600 text-white rounded hover:bg-green-700"
                                                    >
                                                        Add Session
                                                    </Button>
                                                </div>

                                                {/* Submit and Cancel Buttons */}
                                                <div className="flex justify-end space-x-3">
                                                    <button
                                                        type="button"
                                                        onClick={resetNewSessionForm}
                                                        className="px-4 py-2 bg-gray-500 text-white rounded hover:bg-gray-600"
                                                    >
                                                        Cancel
                                                    </button>
                                                    <Button
                                                        type="button"
                                                        variant="primary"
                                                        onClick={addNewSessions}
                                                        disabled={loading}
                                                        className="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700"
                                                    >
                                                        {loading ? (
                                                            <div className="flex items-center">
                                                                <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white mr-2"></div>
                                                                Submitting...
                                                            </div>
                                                        ) : 'Submit'}
                                                    </Button>
                                                </div>
                                            </div>
                                        </div>
                                    )}
                                </>
                            )}
                        </div>
                    </FormSection>
                )}

                {/* Enrolled Learners Tab */}
                {isEditMode && activeTab === 'enrollments' && (
                    <FormSection title="Enrolled Learners">
                        {enrollmentsLoading ? (
                            <div className="flex items-center justify-center py-8">
                                <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-blue-500 mr-3"></div>
                                Loading enrollments...
                            </div>
                        ) : enrolledLearners.length === 0 ? (
                            <p className="text-gray-500 dark:text-gray-400 py-4">No learners enrolled in this course run.</p>
                        ) : (
                            <div>
                                <p className="text-sm text-gray-500 dark:text-gray-400 mb-4">
                                    {enrolledLearners.length} learner{enrolledLearners.length !== 1 ? 's' : ''} enrolled
                                </p>
                                <div className="overflow-x-auto">
                                    <table className="text-sm whitespace-nowrap min-w-max w-full">
                                        <thead className="bg-gray-100 dark:bg-gray-700/60">
                                            <tr>
                                                <th className="text-left py-3 px-3 font-semibold">#</th>
                                                <th className="text-left py-3 px-3 font-semibold">Name</th>
                                                <th className="text-left py-3 px-3 font-semibold">NRIC</th>
                                                <th className="text-left py-3 px-3 font-semibold">Email</th>
                                                <th className="text-left py-3 px-3 font-semibold">Tel</th>
                                                <th className="text-left py-3 px-3 font-semibold">Sponsorship</th>
                                                <th className="text-left py-3 px-3 font-semibold">Enrollment ID</th>
                                                <th className="text-left py-3 px-3 font-semibold">Grant ID</th>
                                                <th className="text-right py-3 px-3 font-semibold">Grant Amt</th>
                                                <th className="text-right py-3 px-3 font-semibold">SF Claim Amt</th>
                                            </tr>
                                        </thead>
                                        <tbody>
                                            {enrolledLearners.map((learner, idx) => {
                                                const nric = learner.nric || '';
                                                const isVisible = visibleNrics.has(learner.user_id);
                                                const maskedNric = nric.length >= 5
                                                    ? `${nric[0]}${'X'.repeat(nric.length - 5)}${nric.slice(-4)}`
                                                    : nric || '-';
                                                return (
                                                <tr key={`${learner.user_id}-${idx}`} className="border-b border-gray-100 dark:border-gray-800">
                                                    <td className="py-3 px-3 text-gray-500">{idx + 1}</td>
                                                    <td className="py-3 px-3">{learner.full_name}</td>
                                                    <td className="py-3 px-3 font-mono">
                                                        <span className="inline-flex items-center gap-1.5">
                                                            {isVisible ? nric || '-' : maskedNric}
                                                            {nric && (
                                                                <button
                                                                    type="button"
                                                                    onClick={() => setVisibleNrics(prev => {
                                                                        const next = new Set(Array.from(prev));
                                                                        if (next.has(learner.user_id)) next.delete(learner.user_id);
                                                                        else next.add(learner.user_id);
                                                                        return next;
                                                                    })}
                                                                    className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-200"
                                                                    title={isVisible ? 'Hide NRIC' : 'Show NRIC'}
                                                                >
                                                                    {isVisible ? (
                                                                        <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13.875 18.825A10.05 10.05 0 0112 19c-4.478 0-8.268-2.943-9.543-7a9.97 9.97 0 011.563-3.029m5.858.908a3 3 0 114.243 4.243M9.878 9.878l4.242 4.242M9.878 9.878L3 3m6.878 6.878L21 21" /></svg>
                                                                    ) : (
                                                                        <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" /><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" /></svg>
                                                                    )}
                                                                </button>
                                                            )}
                                                        </span>
                                                    </td>
                                                    <td className="py-3 px-3">
                                                        <div>{learner.email}</div>
                                                        {learner.secondary_email && <div className="text-xs text-gray-400 dark:text-gray-500">{learner.secondary_email}</div>}
                                                    </td>
                                                    <td className="py-3 px-3">{learner.tel || '-'}</td>
                                                    <td className="py-3 px-3">
                                                        {learner.sponsorship_type === 'Employer' ? (
                                                            <span className="px-2 py-0.5 text-xs font-medium rounded-full bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-300">Employer</span>
                                                        ) : learner.sponsorship_type === 'Individual' ? (
                                                            <span className="px-2 py-0.5 text-xs font-medium rounded-full bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300">Self</span>
                                                        ) : (
                                                            <span className="text-gray-400">-</span>
                                                        )}
                                                    </td>
                                                    <td className="py-3 px-3 font-mono text-xs">{learner.enrolment_id || '-'}</td>
                                                    <td className="py-3 px-3 font-mono text-xs">{learner.grant_id || '-'}</td>
                                                    <td className="py-3 px-3 text-right">{learner.grant_amount != null ? `$${Number(learner.grant_amount).toFixed(2)}` : '-'}</td>
                                                    <td className="py-3 px-3 text-right">{`$${Number(learner.sf_claim_amount || 0).toFixed(2)}`}</td>
                                                </tr>
                                                );
                                            })}
                                        </tbody>
                                    </table>
                                </div>
                            </div>
                        )}
                    </FormSection>
                )}

                {/* Trainer Tab */}
                {isEditMode && activeTab === 'trainer' && (
                    <FormSection title="Trainer Management">
                        <div className="space-y-6">
                            {/* Assigned Trainer (Local) */}
                            <div>
                                <div className="flex items-center justify-between mb-3">
                                    <div>
                                        <h4 className="text-lg font-medium text-gray-900 dark:text-white">Assigned Trainer (Local)</h4>
                                        <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">Manually assigned by the system or admin.</p>
                                    </div>
                                    <div className="flex items-center gap-2">
                                        <select
                                            value={selectedDbTrainerId || manualTrainerName}
                                            onChange={(e) => {
                                                const val = e.target.value;
                                                if (!val) { setSelectedDbTrainerId(''); setManualTrainerName(''); setManualTrainerEmail(''); return; }
                                                const td = availableTrainers.find((at: any) => at.user_id === val);
                                                if (td) { setSelectedDbTrainerId(td.user_id); setManualTrainerName(td.trainer_name); setManualTrainerEmail(td.email || ''); }
                                                else { setSelectedDbTrainerId(''); setManualTrainerName(val); setManualTrainerEmail(''); }
                                            }}
                                            className="px-2 py-1.5 text-sm border border-gray-300 dark:border-gray-600 rounded-md bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:ring-2 focus:ring-blue-500"
                                        >
                                            <option value="">-- Reassign Trainer --</option>
                                            {courseToEdit?.trainersList
                                                ? (courseToEdit.trainersList.includes('|') ? courseToEdit.trainersList.split('|') : courseToEdit.trainersList.split(',')).map((t: string) => t.trim()).filter(Boolean).map((name: string, idx: number) => {
                                                    const td = availableTrainers.find((at: any) => at.trainer_name?.toLowerCase() === name.toLowerCase());
                                                    return <option key={idx} value={td?.user_id || name}>{name}</option>;
                                                })
                                                : availableTrainers.map((t: any) => (
                                                    <option key={t.user_id} value={t.user_id}>{t.trainer_name}</option>
                                                ))
                                            }
                                        </select>
                                        <Button
                                            type="button"
                                            onClick={(e) => handleAssignTrainerLocal(e)}
                                            disabled={loading || (!selectedDbTrainerId && !manualTrainerName)}
                                            className="bg-blue-600 hover:bg-blue-700 text-white"
                                            size="sm"
                                        >
                                            {loading ? 'Saving...' : 'Re-Assign'}
                                        </Button>
                                        <Button
                                            type="button"
                                            onClick={() => setDbTrainerAssignMode(dbTrainerAssignMode === 'manual' ? '' as any : 'manual')}
                                            className={`${dbTrainerAssignMode === 'manual' ? 'bg-gray-500 hover:bg-gray-600' : 'bg-green-600 hover:bg-green-700'} text-white`}
                                            size="sm"
                                        >
                                            {dbTrainerAssignMode === 'manual' ? 'Cancel' : 'Add New Trainer'}
                                        </Button>
                                        <Button
                                            type="button"
                                            onClick={async () => {
                                                const localEmail = assignedTrainersList[0]?.trainer_email || localAssignedTrainerEmail;
                                                const localName = assignedTrainersList[0]?.trainer_name || localAssignedTrainerName;
                                                if (!localName) { showErrorPopup('No local trainer assigned.'); return; }
                                                const match = availableTrainers.find((t: any) =>
                                                    (localEmail && t.email?.toLowerCase() === localEmail.toLowerCase()) ||
                                                    (localName && t.trainer_name?.toLowerCase() === localName.toLowerCase())
                                                );
                                                const nric = match?.nric;
                                                if (!nric || nric === 'NA') {
                                                    showErrorPopup('No NRIC found for the assigned local trainer. Please ensure the trainer has an NRIC on file.');
                                                    return;
                                                }
                                                if (!ssgApiResponse?.data?.course?.run) {
                                                    // No SSG data — save locally only
                                                    setLoading(true);
                                                    try {
                                                        await fetch(getApiUrl('/api/admin/rename-trainer'), {
                                                            method: 'POST',
                                                            headers: { 'Content-Type': 'application/json' },
                                                            body: JSON.stringify({ action: 'update-tpg-trainer', courseRunId, trainerName: localName, trainerEmail: localEmail })
                                                        });
                                                        showSuccessPopup(`TPG trainer saved locally as ${localName}. SSG data not available — sync will update TPG when available.`);
                                                    } catch { showErrorPopup('Failed to save TPG trainer.'); }
                                                    finally { setLoading(false); }
                                                    return;
                                                }
                                                // SSG data available — try SSG API
                                                const runData = ssgApiResponse.data.course.run;
                                                const requestBody = {
                                                    course: {
                                                        courseReferenceNumber: courseReferenceNumber,
                                                        trainingProvider: { uen: runData.organizationKey },
                                                        run: {
                                                            action: "update",
                                                            registrationDates: { opening: runData.registrationOpeningDate || runData.registrationDates?.opening || 0, closing: runData.registrationClosingDate || runData.registrationDates?.closing || 0 },
                                                            courseDates: { start: runData.courseStartDate || runData.courseDates?.start || 0, end: runData.courseEndDate || runData.courseDates?.end || 0 },
                                                            scheduleInfoType: { code: "01", description: "Description" },
                                                            scheduleInfo: "Schedule",
                                                            venue: runData.venue || {},
                                                            courseAdminEmail: runData.courseAdminEmail || currentUserEmail,
                                                            courseVacancy: runData.courseVacancy || { code: "A", description: "Available" },
                                                            file: { Name: "", content: "" },
                                                            linkCourseRunTrainer: [{ trainer: { photo: { name: "", content: "" }, trainerType: { code: "1", description: "Existing" }, idNumber: nric } }]
                                                        }
                                                    }
                                                };
                                                showConfirmPopup(
                                                    `Assign trainer ${localName} (NRIC: ${nric}) to TPG via SSG API?`,
                                                    async () => {
                                                        setLoading(true);
                                                        try {
                                                            const response = await fetch(`/api/ssg/courses/courseRuns/${courseRunId}?includeExpiredCourses=true&action=assign-trainer`, {
                                                                method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(requestBody)
                                                            });

                                                            // Parse the body regardless of HTTP status — SSG returns HTTP 200 with
                                                            // `error: { code, message }` in the body on silent/validation failures
                                                            // (e.g. #62 registration-date-immutable rule). Relying on `response.ok`
                                                            // alone masked real failures and ghost-wrote local tpg_assigned_trainer_*
                                                            // (see backlog #60). Extract error uniformly from both paths.
                                                            const body = await response.json().catch(() => ({} as any));
                                                            const bodyError = body?.error && (body.error.code || body.error.message) ? body.error : null;
                                                            const httpErrorDetail = !response.ok
                                                                ? (body?.details?.[0]?.message || body?.message || '')
                                                                : '';
                                                            const ssgErrorMessage: string = bodyError?.message || bodyError?.code || httpErrorDetail || '';
                                                            const ssgHadError = !!ssgErrorMessage;

                                                            // Legitimate fallback case: trainer isn't registered in SSG's TP Profile
                                                            // yet. Preserve the existing behavior — save locally and prompt the
                                                            // admin to register the trainer in SSG.
                                                            const isExistingTrainerNotFound = ssgErrorMessage.includes('Existing_Trainer_NotFound');

                                                            if (!ssgHadError) {
                                                                // Real success — write local using the admin's input (not a re-fetch,
                                                                // which would blank local if the re-fetch itself failed).
                                                                await fetch(getApiUrl('/api/admin/rename-trainer'), {
                                                                    method: 'POST', headers: { 'Content-Type': 'application/json' },
                                                                    body: JSON.stringify({ action: 'update-tpg-trainer', courseRunId, trainerName: localName, trainerEmail: localEmail })
                                                                });
                                                                showSuccessPopup(`Trainer ${localName} assigned to TPG successfully!`);
                                                                // Non-destructive verification re-fetch — only used to refresh the UI,
                                                                // never to overwrite local.
                                                                const updated = await fetch(`/api/ssg/courses?runId=${courseRunId}&includeExpired=false`);
                                                                if (updated.ok) setSsgApiResponse(await updated.json());
                                                            } else if (isExistingTrainerNotFound) {
                                                                // Legitimate local-only fallback
                                                                await fetch(getApiUrl('/api/admin/rename-trainer'), {
                                                                    method: 'POST', headers: { 'Content-Type': 'application/json' },
                                                                    body: JSON.stringify({ action: 'update-tpg-trainer', courseRunId, trainerName: localName, trainerEmail: localEmail })
                                                                });
                                                                showInfoPopup(`Trainer ${localName} is not registered in the SSG TP Profile yet. TPG trainer has been saved locally. Please register the trainer in SSG first.`);
                                                            } else {
                                                                // Real SSG rejection — do NOT write local, surface the error so the
                                                                // admin knows the assignment didn't actually go through. This is the
                                                                // fix for backlog #60 (ghost-write on silent SSG failure).
                                                                showErrorPopup(`SSG rejected the trainer assignment: ${ssgErrorMessage}. Local DB was NOT updated. Please resolve the SSG-side issue and try again.`);
                                                            }
                                                        } catch { showErrorPopup('Failed to assign trainer to TPG.'); }
                                                        finally { setLoading(false); }
                                                    }
                                                );
                                            }}
                                            disabled={loading || (!assignedTrainersList.length && !localAssignedTrainerName)}
                                            className="bg-purple-600 hover:bg-purple-700 text-white"
                                            size="sm"
                                        >
                                            {loading ? 'Assigning...' : 'Assign to TPG'}
                                        </Button>
                                        <Button
                                            type="button"
                                            onClick={async () => {
                                                const localEmail = assignedTrainersList[0]?.trainer_email || localAssignedTrainerEmail;
                                                const localName = assignedTrainersList[0]?.trainer_name || localAssignedTrainerName;
                                                if (!localEmail) {
                                                    showErrorPopup('No email found for the locally assigned trainer. Cannot add to calendar.');
                                                    return;
                                                }
                                                setLoading(true);
                                                try {
                                                    const res = await fetch('/api/admin/add-trainer-to-calendar', {
                                                        method: 'POST',
                                                        headers: { 'Content-Type': 'application/json' },
                                                        body: JSON.stringify({ courseRunId, trainerEmail: localEmail })
                                                    });
                                                    const data = await res.json();
                                                    if (res.ok && data.success) {
                                                        showSuccessPopup(`Trainer ${localName} added to ${data.addedCount} calendar event(s).`);
                                                    } else {
                                                        showErrorPopup(data.error || 'Failed to add trainer to calendar.');
                                                    }
                                                } catch (err) {
                                                    console.error('Error adding to calendar:', err);
                                                    showErrorPopup('An error occurred while adding to calendar.');
                                                } finally {
                                                    setLoading(false);
                                                }
                                            }}
                                            disabled={loading || (!assignedTrainersList.length && !localAssignedTrainerName)}
                                            className="bg-indigo-600 hover:bg-indigo-700 text-white"
                                            size="sm"
                                        >
                                            {loading ? 'Adding...' : 'Add to Calendar'}
                                        </Button>
                                    </div>
                                </div>
                                {(assignedTrainersList.length > 0 || localAssignedTrainerName) ? (
                                    <div className="bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-700 rounded-md p-4">
                                        <div className="space-y-2">
                                            {/* Display ALL locally assigned trainers — junction first, scalar fallback */}
                                            {(assignedTrainersList.length > 0 ? assignedTrainersList : [{
                                              id: 'legacy',
                                              trainer_name: localAssignedTrainerName,
                                              trainer_email: localAssignedTrainerEmail,
                                            }]).map((t: any) => {
                                                const trainerDetail = availableTrainers.find((at: any) =>
                                                    (at.email && t.trainer_email && at.email.toLowerCase() === t.trainer_email.toLowerCase()) ||
                                                    (at.trainer_name && t.trainer_name && at.trainer_name.toLowerCase() === t.trainer_name.toLowerCase())
                                                );
                                                return (
                                                <div key={t.id} className="flex items-center justify-between bg-white dark:bg-gray-800 border border-green-200 dark:border-green-700/50 rounded-lg px-4 py-2.5">
                                                    <div className="flex flex-wrap gap-4 text-sm">
                                                        <div>
                                                            <span className="font-bold text-gray-700 dark:text-gray-300">Name:</span>{' '}
                                                            <span className="text-gray-900 dark:text-white">{t.trainer_name}</span>
                                                        </div>
                                                        {t.trainer_email && (
                                                            <div>
                                                                <span className="font-bold text-gray-700 dark:text-gray-300">Email:</span>{' '}
                                                                <span className="text-gray-900 dark:text-white">{t.trainer_email}</span>
                                                            </div>
                                                        )}
                                                        {trainerDetail?.telephone && (
                                                            <div>
                                                                <span className="font-bold text-gray-700 dark:text-gray-300">Contact (HP):</span>{' '}
                                                                <span className="text-gray-900 dark:text-white">{trainerDetail.telephone}</span>
                                                            </div>
                                                        )}
                                                        <div>
                                                            <span className="font-bold text-gray-700 dark:text-gray-300">NRIC:</span>{' '}
                                                            {trainerDetail?.nric && trainerDetail.nric !== 'NA' ? (
                                                                <span className="text-gray-900 dark:text-white font-mono">{trainerDetail.nric}</span>
                                                            ) : (
                                                                <span className="text-amber-500 dark:text-amber-400 text-xs italic">Not on file</span>
                                                            )}
                                                        </div>
                                                    </div>
                                                    <button
                                                        type="button"
                                                        onClick={(e) => handleRemoveTrainerLocal(t.id, t.trainer_name, e)}
                                                        disabled={loading}
                                                        className="ml-3 px-2.5 py-1 text-xs font-medium text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/20 rounded transition-colors"
                                                        title={`Remove ${t.trainer_name}`}
                                                    >
                                                        ✕ Remove
                                                    </button>
                                                </div>
                                                );
                                            })}
                                        </div>
                                    </div>
                                ) : localAssignedTrainerName ? (() => {
                                    const trainerDetail = availableTrainers.find((at: any) =>
                                        (at.email && localAssignedTrainerEmail && at.email.toLowerCase() === localAssignedTrainerEmail.toLowerCase()) ||
                                        (at.trainer_name && at.trainer_name.toLowerCase() === localAssignedTrainerName.toLowerCase())
                                    );
                                    return (
                                    <div className="bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-700 rounded-md p-4">
                                        <div className="flex flex-wrap gap-6 text-sm">
                                            <div>
                                                <span className="font-bold text-gray-700 dark:text-gray-300">Name:</span>{' '}
                                                <span className="text-gray-900 dark:text-white">{localAssignedTrainerName}</span>
                                            </div>
                                            {localAssignedTrainerEmail && (
                                                <div>
                                                    <span className="font-bold text-gray-700 dark:text-gray-300">Email:</span>{' '}
                                                    <span className="text-gray-900 dark:text-white">{localAssignedTrainerEmail}</span>
                                                </div>
                                            )}
                                            {trainerDetail?.telephone && (
                                                <div>
                                                    <span className="font-bold text-gray-700 dark:text-gray-300">Contact (HP):</span>{' '}
                                                    <span className="text-gray-900 dark:text-white">{trainerDetail.telephone}</span>
                                                </div>
                                            )}
                                            <div>
                                                <span className="font-bold text-gray-700 dark:text-gray-300">NRIC:</span>{' '}
                                                {trainerDetail?.nric && trainerDetail.nric !== 'NA' ? (
                                                    <span className="text-gray-900 dark:text-white font-mono">{trainerDetail.nric}</span>
                                                ) : (
                                                    <span className="text-amber-500 dark:text-amber-400 text-xs italic">Not on file</span>
                                                )}
                                            </div>
                                        </div>
                                    </div>
                                    );
                                })() : (
                                    <div className="bg-gray-50 dark:bg-gray-800/60 border border-gray-200 dark:border-gray-700 rounded-md p-4 text-sm text-gray-500 dark:text-gray-400">
                                        No trainer has been locally assigned yet.
                                    </div>
                                )}


                                {/* Inline Add New Trainer form */}
                                {dbTrainerAssignMode === 'manual' && (
                                    <div className="mt-4 border border-green-200 dark:border-green-700 rounded-lg p-4 bg-green-50/50 dark:bg-green-900/10">
                                        <p className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-3">Add a new trainer:</p>
                                        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                                            <div>
                                                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Name <span className="text-red-500">*</span></label>
                                                <input type="text" placeholder="Full name" value={manualTrainerName} onChange={e => setManualTrainerName(e.target.value)} className={inputClasses} />
                                            </div>
                                            <div>
                                                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Email</label>
                                                <input type="email" placeholder="email@example.com" value={manualTrainerEmail} onChange={e => setManualTrainerEmail(e.target.value)} className={inputClasses} />
                                            </div>
                                            <div>
                                                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Contact (HP)</label>
                                                <input type="tel" placeholder="Phone number" value={manualTrainerContact || ''} onChange={e => setManualTrainerContact(e.target.value)} className={inputClasses} />
                                            </div>
                                        </div>
                                        <div className="flex justify-end mt-4">
                                            <Button type="button" onClick={(e) => handleAssignTrainerLocal(e)} disabled={loading} className="bg-green-600 hover:bg-green-700 text-white">
                                                {loading ? 'Saving...' : 'Add & Assign Trainer'}
                                            </Button>
                                        </div>
                                    </div>
                                )}

                                {/* --- Per-Session Trainer Assignment --- */}
                                {/* By default every session inherits the run-level trainer
                                    above. This collapsible panel lets the admin override
                                    specific sessions with a different trainer from the
                                    pool of locally assigned trainers. */}
                                {sessionTrainerList.length > 0 && (
                                    <div className="mt-6 border border-blue-200 dark:border-blue-800 rounded-lg bg-blue-50/40 dark:bg-blue-900/10">
                                        <button
                                            type="button"
                                            onClick={() => setSessionTrainerExpanded(v => !v)}
                                            className="w-full flex items-center justify-between px-4 py-3 text-left"
                                        >
                                            <div className="flex items-center gap-2 min-w-0">
                                                <span className="text-base">📋</span>
                                                <div className="min-w-0">
                                                    <h4 className="text-sm font-semibold text-gray-800 dark:text-white">
                                                        Per-Session Trainer Assignment
                                                    </h4>
                                                    <p className="text-xs text-gray-500 dark:text-gray-400">
                                                        {sessionTrainerList.length} session{sessionTrainerList.length === 1 ? '' : 's'} ·
                                                        {' '}{sessionTrainerList.filter(s => s.hasOverride).length} overridden ·
                                                        {' '}{sessionTrainerList.filter(s => !s.hasOverride).length} using default
                                                    </p>
                                                </div>
                                            </div>
                                            <span className="text-xs text-blue-600 dark:text-blue-400 flex-shrink-0">
                                                {sessionTrainerExpanded ? 'Hide ▲' : 'Show ▼'}
                                            </span>
                                        </button>
                                        {sessionTrainerExpanded && (
                                            <div className="px-4 pb-4 border-t border-blue-200 dark:border-blue-800">
                                                <p className="text-xs text-gray-600 dark:text-gray-400 py-3">
                                                    Every session below uses the <strong>run-level trainer</strong> by default.
                                                    Use the dropdown to assign a different trainer to specific sessions —
                                                    choose a trainer from the Assigned Trainer (Local) list above. Select
                                                    "Use default" to revert a session back to the run-level trainer.
                                                </p>
                                                {sessionTrainerLoading ? (
                                                    <p className="text-xs text-gray-500 italic">Loading sessions…</p>
                                                ) : (
                                                    <div className="space-y-2">
                                                        {sessionTrainerList.map((s: any) => {
                                                            const effectiveName = s.trainer?.trainerName || '—';
                                                            // Format date: 20260411 -> 11 Apr 2026
                                                            const formatDate = (yyyymmdd: string) => {
                                                                if (!yyyymmdd || yyyymmdd.length !== 8) return yyyymmdd || '';
                                                                const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
                                                                const y = yyyymmdd.slice(0, 4);
                                                                const m = parseInt(yyyymmdd.slice(4, 6), 10) - 1;
                                                                const d = parseInt(yyyymmdd.slice(6, 8), 10);
                                                                return `${d} ${months[m] || '?'} ${y}`;
                                                            };
                                                            return (
                                                                <div
                                                                    key={s.id}
                                                                    className={`flex items-center gap-3 px-3 py-2 rounded border ${
                                                                        s.hasOverride
                                                                            ? 'border-blue-400 dark:border-blue-600 bg-white dark:bg-gray-800'
                                                                            : 'border-gray-200 dark:border-gray-700 bg-white/70 dark:bg-gray-800/60'
                                                                    }`}
                                                                >
                                                                    <div className="flex-1 min-w-0">
                                                                        <div className="flex items-center gap-2 flex-wrap">
                                                                            <span className="text-xs font-bold text-blue-700 dark:text-blue-300">
                                                                                {s.sessionNumber || 'S?'}
                                                                            </span>
                                                                            <span className="text-xs text-gray-600 dark:text-gray-400">
                                                                                {formatDate(s.startDate)}
                                                                                {s.startTime && s.endTime && ` · ${s.startTime}–${s.endTime}`}
                                                                            </span>
                                                                            {s.hasOverride ? (
                                                                                <span className="text-[10px] px-1.5 py-0.5 rounded bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300 font-semibold">
                                                                                    Override
                                                                                </span>
                                                                            ) : (
                                                                                <span className="text-[10px] px-1.5 py-0.5 rounded bg-gray-100 text-gray-600 dark:bg-gray-700 dark:text-gray-300">
                                                                                    Default
                                                                                </span>
                                                                            )}
                                                                        </div>
                                                                        <div className="text-xs text-gray-700 dark:text-gray-200 mt-0.5 truncate">
                                                                            {effectiveName}
                                                                        </div>
                                                                    </div>
                                                                    <select
                                                                        value={s.hasOverride ? (s.trainer?.trainerId || '') : ''}
                                                                        onChange={(e) => {
                                                                            const chosenId = e.target.value;
                                                                            if (!chosenId) {
                                                                                // Clear override — revert to run-level default
                                                                                updateSessionTrainer(s.id, null, null, null);
                                                                                return;
                                                                            }
                                                                            const chosen = assignedTrainersList.find((t: any) => t.trainer_id === chosenId);
                                                                            if (chosen) {
                                                                                updateSessionTrainer(s.id, chosen.trainer_id, chosen.trainer_name, chosen.trainer_email);
                                                                            }
                                                                        }}
                                                                        className="flex-shrink-0 text-xs px-2 py-1 rounded border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
                                                                    >
                                                                        <option value="">Use default</option>
                                                                        {assignedTrainersList.map((t: any) => (
                                                                            <option key={t.trainer_id || t.trainer_name} value={t.trainer_id || ''}>
                                                                                {t.trainer_name}
                                                                            </option>
                                                                        ))}
                                                                    </select>
                                                                </div>
                                                            );
                                                        })}
                                                    </div>
                                                )}
                                            </div>
                                        )}
                                    </div>
                                )}
                            </div>

                            {/* Assigned Trainer (TPG) */}
                            {(() => {
                                // Use freshly fetched SSG data if available, otherwise fall back to initial courseToEdit data
                                const ssgTrainers = ssgApiResponse?.data?.course?.run?.linkCourseRunTrainer;
                                const tpgName = ssgTrainers?.[0]?.trainer?.name || courseToEdit?.assignedTrainerTpg;
                                const tpgEmail = ssgTrainers?.[0]?.trainer?.email || courseToEdit?.assignedTrainerTpgEmail;
                                const tpgId = ssgTrainers?.[0]?.trainer?.idNumber;
                                const handleRemoveTpgTrainer = () => {
                                    const runData = ssgApiResponse?.data?.course?.run;
                                    showConfirmPopup(
                                        `Remove ${tpgName} from ${runData ? 'SSG/TPG and' : ''} the local database for this course run?`,
                                        async () => {
                                            setLoading(true);
                                            try {
                                                let ssgErrorMessage = '';

                                                // Only call SSG API if we have SSG data loaded
                                                if (runData) {
                                                    const requestBody = {
                                                        course: {
                                                            courseReferenceNumber: courseReferenceNumber,
                                                            trainingProvider: { uen: runData.organizationKey },
                                                            run: {
                                                                action: "update",
                                                                registrationDates: { opening: runData.registrationOpeningDate || runData.registrationDates?.opening || 0, closing: runData.registrationClosingDate || runData.registrationDates?.closing || 0 },
                                                                courseDates: { start: runData.courseStartDate || runData.courseDates?.start || 0, end: runData.courseEndDate || runData.courseDates?.end || 0 },
                                                                scheduleInfoType: { code: "01", description: "Description" },
                                                                scheduleInfo: "Schedule",
                                                                venue: runData.venue || {},
                                                                courseAdminEmail: runData.courseAdminEmail || currentUserEmail,
                                                                courseVacancy: runData.courseVacancy || { code: "A", description: "Available" },
                                                                file: { Name: "", content: "" },
                                                                linkCourseRunTrainer: []
                                                            }
                                                        }
                                                    };
                                                    const response = await fetch(`/api/ssg/courses/courseRuns/${courseRunId}?includeExpiredCourses=true&action=assign-trainer`, {
                                                        method: 'POST',
                                                        headers: { 'Content-Type': 'application/json' },
                                                        body: JSON.stringify(requestBody)
                                                    });

                                                    const body = await response.json().catch(() => ({} as any));
                                                    const bodyError = body?.error && (body.error.code || body.error.message) ? body.error : null;
                                                    const httpErrorDetail = !response.ok
                                                        ? (body?.details?.[0]?.message || body?.message || body?.error || '')
                                                        : '';
                                                    ssgErrorMessage = bodyError?.message || bodyError?.code || httpErrorDetail || '';
                                                }

                                                                // Always clear local TPG columns regardless of SSG result
                                                    await fetch(getApiUrl('/api/admin/rename-trainer'), {
                                                        method: 'POST',
                                                        headers: { 'Content-Type': 'application/json' },
                                                        body: JSON.stringify({
                                                            action: 'update-tpg-trainer',
                                                            courseRunId,
                                                            trainerName: null,
                                                            trainerEmail: null,
                                                        }),
                                                    });
                                                    // Non-destructive refetch to refresh the card
                                                    try {
                                                        const updated = await fetch(`/api/ssg/courses?runId=${courseRunId}&includeExpired=false`);
                                                        if (updated.ok) setSsgApiResponse(await updated.json());
                                                    } catch { /* ignore refetch errors */ }
                                                if (!ssgErrorMessage) {
                                                    showSuccessPopup(`TPG trainer removed${runData ? '' : ' (local only)'}.`);
                                                } else {
                                                    showInfoPopup(`Local TPG trainer cleared. Note: SSG returned: ${ssgErrorMessage}. You may need to update SSG separately.`);
                                                }
                                            } catch {
                                                showErrorPopup('Failed to remove TPG trainer.');
                                            } finally {
                                                setLoading(false);
                                            }
                                        }
                                    );
                                };
                                return (
                                <div>
                                    <div className="mb-3">
                                        <h4 className="text-lg font-medium text-gray-900 dark:text-white">Assigned Trainer (TPG)</h4>
                                        <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">Auto-pulled from the SSG/TPG API. Use "Reassign TPG" or "Assign to TPG" to change.</p>
                                    </div>
                                    {/* Quick Reassign TPG Trainer */}
                                    <div className="flex items-center gap-2 mb-3">
                                        <select
                                            id="tpg-reassign-select"
                                            className="flex-1 px-2 py-1.5 text-sm border border-gray-300 dark:border-gray-600 rounded-md bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:ring-2 focus:ring-purple-500"
                                            defaultValue=""
                                        >
                                            <option value="">-- Reassign TPG Trainer --</option>
                                            {availableTrainers.filter((t: any) => t.nric && t.nric !== 'NA').map((t: any) => (
                                                <option key={t.user_id} value={t.user_id}>{t.trainer_name} (NRIC: {t.nric})</option>
                                            ))}
                                        </select>
                                        <Button
                                            type="button"
                                            size="sm"
                                            className="bg-purple-600 hover:bg-purple-700 text-white"
                                            disabled={loading}
                                            onClick={async () => {
                                                const sel = document.getElementById('tpg-reassign-select') as HTMLSelectElement;
                                                const userId = sel?.value;
                                                if (!userId) { showErrorPopup('Please select a trainer to reassign.'); return; }
                                                const match = availableTrainers.find((t: any) => t.user_id === userId);
                                                if (!match?.nric || match.nric === 'NA') { showErrorPopup('Selected trainer has no NRIC on file.'); return; }
                                                const trainerName = match.trainer_name;
                                                const trainerEmail = match.email || '';
                                                const nric = match.nric;

                                                const runData = ssgApiResponse?.data?.course?.run;
                                                if (!runData) {
                                                    // No SSG data — save locally only
                                                    await fetch(getApiUrl('/api/admin/rename-trainer'), {
                                                        method: 'POST', headers: { 'Content-Type': 'application/json' },
                                                        body: JSON.stringify({ action: 'update-tpg-trainer', courseRunId, trainerName, trainerEmail })
                                                    });
                                                    showSuccessPopup(`TPG trainer updated locally to ${trainerName}. SSG data not available.`);
                                                    return;
                                                }

                                                showConfirmPopup(`Assign ${trainerName} (NRIC: ${nric}) as TPG trainer via SSG?`, async () => {
                                                    setLoading(true);
                                                    try {
                                                        const requestBody = {
                                                            course: {
                                                                courseReferenceNumber: courseReferenceNumber,
                                                                trainingProvider: { uen: runData.organizationKey },
                                                                run: {
                                                                    action: "update",
                                                                    registrationDates: { opening: runData.registrationOpeningDate || runData.registrationDates?.opening || 0, closing: runData.registrationClosingDate || runData.registrationDates?.closing || 0 },
                                                                    courseDates: { start: runData.courseStartDate || runData.courseDates?.start || 0, end: runData.courseEndDate || runData.courseDates?.end || 0 },
                                                                    scheduleInfoType: { code: "01", description: "Description" },
                                                                    scheduleInfo: "Schedule",
                                                                    venue: runData.venue || {},
                                                                    courseAdminEmail: runData.courseAdminEmail || currentUserEmail,
                                                                    courseVacancy: runData.courseVacancy || { code: "A", description: "Available" },
                                                                    file: { Name: "", content: "" },
                                                                    linkCourseRunTrainer: [{ trainer: { photo: { name: "", content: "" }, trainerType: { code: "1", description: "Existing" }, idNumber: nric } }]
                                                                }
                                                            }
                                                        };
                                                        const response = await fetch(`/api/ssg/courses/courseRuns/${courseRunId}?includeExpiredCourses=true&action=assign-trainer`, {
                                                            method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(requestBody)
                                                        });
                                                        const body = await response.json().catch(() => ({} as any));
                                                        const bodyError = body?.error && (body.error.code || body.error.message) ? body.error : null;
                                                        const ssgErr = bodyError?.message || bodyError?.code || (!response.ok ? (body?.details?.[0]?.message || body?.message || '') : '');

                                                        // Always update local TPG columns
                                                        await fetch(getApiUrl('/api/admin/rename-trainer'), {
                                                            method: 'POST', headers: { 'Content-Type': 'application/json' },
                                                            body: JSON.stringify({ action: 'update-tpg-trainer', courseRunId, trainerName, trainerEmail })
                                                        });
                                                        try {
                                                            const updated = await fetch(`/api/ssg/courses?runId=${courseRunId}&includeExpired=false`);
                                                            if (updated.ok) setSsgApiResponse(await updated.json());
                                                        } catch { /* ignore */ }

                                                        if (!ssgErr) {
                                                            showSuccessPopup(`TPG trainer reassigned to ${trainerName}.`);
                                                        } else {
                                                            showInfoPopup(`Local TPG updated to ${trainerName}. SSG note: ${ssgErr}`);
                                                        }
                                                    } catch { showErrorPopup('Failed to reassign TPG trainer.'); }
                                                    finally { setLoading(false); }
                                                });
                                            }}
                                        >
                                            {loading ? 'Assigning...' : 'Reassign TPG'}
                                        </Button>
                                    </div>
                                    {tpgName ? (
                                        <div className="bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-700 rounded-md p-4">
                                            <div className="flex flex-wrap gap-6 text-sm">
                                                <div>
                                                    <span className="font-bold text-gray-700 dark:text-gray-300">Name:</span>{' '}
                                                    <span className="text-gray-900 dark:text-white">{tpgName}</span>
                                                </div>
                                                {tpgEmail && (
                                                    <div>
                                                        <span className="font-bold text-gray-700 dark:text-gray-300">Email:</span>{' '}
                                                        <span className="text-gray-900 dark:text-white">{tpgEmail}</span>
                                                    </div>
                                                )}
                                                {tpgId && (
                                                    <div>
                                                        <span className="font-bold text-gray-700 dark:text-gray-300">NRIC:</span>{' '}
                                                        <span className="text-gray-900 dark:text-white font-mono">{tpgId}</span>
                                                    </div>
                                                )}
                                            </div>
                                        </div>
                                    ) : (
                                        <div className="bg-gray-50 dark:bg-gray-800/60 border border-gray-200 dark:border-gray-700 rounded-md p-4 text-sm text-gray-500 dark:text-gray-400">
                                            No TPG trainer assigned. Data will appear after SSG/TPG sync or after clicking "Assign to TPG".
                                        </div>
                                    )}
                                </div>
                                );
                            })()}

                            {/* Next Available Trainer — hidden when a local trainer is already assigned */}
                            {!assignedTrainersList.length && !localAssignedTrainerName ? (
                            <div>
                                <h4 className="text-lg font-medium text-gray-900 dark:text-white mb-3">Next Available Trainer</h4>
                                {courseToEdit?.nextAvailableTrainer ? (() => {
                                    const nextDetail = availableTrainers.find((at: any) =>
                                        (at.email && courseToEdit.nextAvailableTrainerEmail && at.email.toLowerCase() === courseToEdit.nextAvailableTrainerEmail.toLowerCase()) ||
                                        (at.trainer_name && at.trainer_name.toLowerCase() === courseToEdit.nextAvailableTrainer.toLowerCase())
                                    );
                                    return (
                                    <div className="bg-orange-50 dark:bg-orange-900/20 border border-orange-200 dark:border-orange-700 rounded-md p-4">
                                        <div className="flex items-center justify-between">
                                            <div className="flex flex-wrap gap-6 text-sm">
                                                <div>
                                                    <span className="font-bold text-gray-700 dark:text-gray-300">Name:</span>{' '}
                                                    <span className="text-gray-900 dark:text-white">{courseToEdit.nextAvailableTrainer}</span>
                                                </div>
                                                {(courseToEdit.nextAvailableTrainerEmail || nextDetail?.email) && (
                                                    <div>
                                                        <span className="font-bold text-gray-700 dark:text-gray-300">Email:</span>{' '}
                                                        <span className="text-gray-900 dark:text-white">{courseToEdit.nextAvailableTrainerEmail || nextDetail?.email}</span>
                                                    </div>
                                                )}
                                                {nextDetail?.telephone && (
                                                    <div>
                                                        <span className="font-bold text-gray-700 dark:text-gray-300">Contact (HP):</span>{' '}
                                                        <span className="text-gray-900 dark:text-white">{nextDetail.telephone}</span>
                                                    </div>
                                                )}
                                                {courseToEdit.latestInvitationStatus && (
                                                    <div>
                                                        <span className="font-bold text-gray-700 dark:text-gray-300">Invitation Status:</span>{' '}
                                                        <span className={`font-medium ${
                                                            courseToEdit.latestInvitationStatus === 'accepted' ? 'text-green-600 dark:text-green-400' :
                                                            courseToEdit.latestInvitationStatus === 'declined' ? 'text-red-600 dark:text-red-400' :
                                                            courseToEdit.latestInvitationStatus === 'pending' ? 'text-yellow-600 dark:text-yellow-400' :
                                                            'text-gray-900 dark:text-white'
                                                        }`}>{courseToEdit.latestInvitationStatus}</span>
                                                    </div>
                                                )}
                                            </div>
                                            <Button
                                                onClick={async () => {
                                                    if (!courseToEdit?.id) return;
                                                    try {
                                                        setLoading(true);
                                                        const res = await fetch(getApiUrl('/api/admin/send-trainer-invitation'), {
                                                            method: 'POST',
                                                            headers: { 'Content-Type': 'application/json' },
                                                            body: JSON.stringify({ courseRunUuid: courseToEdit.id }),
                                                        });
                                                        const data = await res.json();
                                                        if (data.success) {
                                                            showSuccessPopup(`Invitation sent to ${data.trainerName || courseToEdit.nextAvailableTrainer}`);
                                                        } else {
                                                            showErrorPopup(data.error || 'Failed to send invitation');
                                                        }
                                                    } catch {
                                                        showErrorPopup('Failed to send trainer invitation');
                                                    } finally {
                                                        setLoading(false);
                                                    }
                                                }}
                                                disabled={loading}
                                                className="bg-orange-600 hover:bg-orange-700 text-white ml-4 whitespace-nowrap"
                                            >
                                                {loading ? 'Sending...' : 'Send Invitation'}
                                            </Button>
                                        </div>
                                    </div>
                                    );
                                })() : (
                                    <div className="bg-gray-50 dark:bg-gray-800/60 border border-gray-200 dark:border-gray-700 rounded-md p-4 text-sm text-gray-500 dark:text-gray-400">
                                        No next available trainer in the approved list.
                                    </div>
                                )}
                            </div>
                            ) : null}

                            {/* Pause Invitations toggle */}
                            <div className="flex items-center gap-3 mb-4 px-1">
                                <label className="relative inline-flex items-center cursor-pointer">
                                    <input
                                        type="checkbox"
                                        checked={invitationPaused}
                                        onChange={async (e) => {
                                            const newVal = e.target.checked;
                                            setInvitationPaused(newVal);
                                            if (courseToEdit?.id) {
                                                try {
                                                    await fetch(getApiUrl('/api/admin/upcoming-classes'), {
                                                        method: 'PUT',
                                                        headers: { 'Content-Type': 'application/json' },
                                                        body: JSON.stringify({ id: courseToEdit.id, invitation_paused: newVal }),
                                                    });
                                                } catch {
                                                    setInvitationPaused(!newVal);
                                                }
                                            }
                                        }}
                                        className="sr-only peer"
                                    />
                                    <div className="w-9 h-5 bg-gray-200 peer-focus:outline-none peer-focus:ring-2 peer-focus:ring-orange-300 rounded-full peer dark:bg-gray-600 peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-orange-500" />
                                </label>
                                <span className="text-sm font-medium text-gray-700 dark:text-gray-300">
                                    Pause Invitations
                                </span>
                                <span className="text-xs text-gray-400">
                                    {invitationPaused ? 'Scheduler and cascade invitations are blocked for this course run' : 'Invitations are active'}
                                </span>
                            </div>
                            <div className="flex items-center gap-3 mb-4 px-1">
                                <label className="relative inline-flex items-center cursor-pointer">
                                    <input
                                        type="checkbox"
                                        checked={repliesBlocked}
                                        onChange={async (e) => {
                                            const newVal = e.target.checked;
                                            setRepliesBlocked(newVal);
                                            if (courseToEdit?.id) {
                                                try {
                                                    await fetch(getApiUrl('/api/admin/upcoming-classes'), {
                                                        method: 'PUT',
                                                        headers: { 'Content-Type': 'application/json' },
                                                        body: JSON.stringify({ id: courseToEdit.id, invitation_replies_blocked: newVal }),
                                                    });
                                                } catch {
                                                    setRepliesBlocked(!newVal);
                                                }
                                            }
                                        }}
                                        className="sr-only peer"
                                    />
                                    <div className="w-9 h-5 bg-gray-200 peer-focus:outline-none peer-focus:ring-2 peer-focus:ring-red-300 rounded-full peer dark:bg-gray-600 peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-red-500" />
                                </label>
                                <span className="text-sm font-medium text-gray-700 dark:text-gray-300">
                                    Block Replies
                                </span>
                                <span className="text-xs text-gray-400">
                                    {repliesBlocked ? 'All accept/decline responses are blocked — trainers see "Already Assigned"' : 'Trainers can respond to pending invitations'}
                                </span>
                            </div>

                            {/* Approved Trainers List */}
                            <div>
                                <h4 className="text-lg font-medium text-gray-900 dark:text-white mb-3">Approved Trainers for This Course</h4>
                                <p className="text-xs text-gray-500 dark:text-gray-400 mb-3">Trainers approved to teach this course (from course record). The next available trainer follows the assigned local trainer in this order.</p>
                                {courseToEdit?.trainersList ? (() => {
                                    const approvedTrainers = (courseToEdit.trainersList.includes('|') ? courseToEdit.trainersList.split('|') : courseToEdit.trainersList.split(',')).map((t: string) => t.trim()).filter(Boolean);
                                    const nextName = courseToEdit.nextAvailableTrainer;

                                    // Build bidirectional name <-> email maps from availableTrainers (app_user data)
                                    const dbNameToEmail = new Map<string, string>();
                                    const emailToDbNames = new Map<string, Set<string>>();
                                    availableTrainers.forEach((t: any) => {
                                        if (t.trainer_name && t.email) {
                                            const name = t.trainer_name.toLowerCase().trim();
                                            const email = t.email.toLowerCase().trim();
                                            dbNameToEmail.set(name, email);
                                            if (!emailToDbNames.has(email)) emailToDbNames.set(email, new Set());
                                            emailToDbNames.get(email)!.add(name);
                                        }
                                    });

                                    // Collect all local assigned emails and expand to ALL known names via email
                                    const localEmails = new Set<string>();
                                    const localAllNames = new Set<string>();
                                    assignedTrainersList.forEach((t: any) => {
                                        if (t.trainer_name) localAllNames.add(t.trainer_name.toLowerCase().trim());
                                        if (t.trainer_email) localEmails.add(t.trainer_email.toLowerCase().trim());
                                    });
                                    if (localAssignedTrainerName) localAllNames.add(localAssignedTrainerName.toLowerCase().trim());
                                    if (localAssignedTrainerEmail) localEmails.add(localAssignedTrainerEmail.toLowerCase().trim());
                                    // Expand: for each local email, add all names associated with that email
                                    localEmails.forEach(email => {
                                        const names = emailToDbNames.get(email);
                                        if (names) names.forEach(n => localAllNames.add(n));
                                    });

                                    // Match: an approved trainer is locally assigned if their name, email, or word overlap matches
                                    const isLocallyAssigned = (approvedName: string) => {
                                        const lower = approvedName.toLowerCase().trim();
                                        if (localAllNames.has(lower)) return true;
                                        const approvedEmail = dbNameToEmail.get(lower);
                                        if (approvedEmail && localEmails.has(approvedEmail)) return true;
                                        // Word-overlap fallback for name mismatches (e.g. "Dr. Siraj Mohammad" vs "Dr. Muhammed Siraj")
                                        const approvedWords = lower.split(/\s+/).filter((w: string) => w.length > 2);
                                        if (approvedWords.length > 0) {
                                            const approvedSet = new Set(approvedWords);
                                            const localNamesArr = Array.from(localAllNames);
                                            for (let i = 0; i < localNamesArr.length; i++) {
                                                const localWords = localNamesArr[i].split(/\s+/).filter((w: string) => w.length > 2);
                                                const shared = localWords.filter((w: string) => approvedSet.has(w));
                                                if (shared.length >= 2 || (shared.length >= 1 && (approvedWords.length <= 1 || localWords.length <= 1))) {
                                                    return true;
                                                }
                                            }
                                        }
                                        return false;
                                    };

                                    // Invitation data from the API (passed via setEditingCourseRun)
                                    const invitations = (courseToEdit as any)?.trainerInvitations || {};
                                    const isDetailedView = classListReturnTo === AdminPage.ViewClassByDate;

                                    const formatDt = (iso: string | null) => {
                                        if (!iso) return '';
                                        const d = new Date(iso);
                                        if (isNaN(d.getTime())) return '';
                                        return d.toLocaleString('en-SG', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false });
                                    };

                                    const statusBadge = (status: string) => {
                                        switch (status) {
                                            case 'accepted': return <span className="px-1.5 py-0.5 text-[10px] font-semibold rounded bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300">Accepted</span>;
                                            case 'declined': return <span className="px-1.5 py-0.5 text-[10px] font-semibold rounded bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-300">Declined</span>;
                                            case 'pending': return <span className="px-1.5 py-0.5 text-[10px] font-semibold rounded bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-300">Pending</span>;
                                            case 'resent': return <span className="px-1.5 py-0.5 text-[10px] font-semibold rounded bg-gray-100 text-gray-500 dark:bg-gray-700 dark:text-gray-400">Resent</span>;
                                            case 'not_sent': return <span className="px-1.5 py-0.5 text-[10px] font-semibold rounded bg-slate-100 text-slate-500 dark:bg-slate-800 dark:text-slate-400">Not Sent</span>;
                                            case 'manual': return <span className="px-1.5 py-0.5 text-[10px] font-semibold rounded bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300">Manually Added</span>;
                                            default: return <span className="px-1.5 py-0.5 text-[10px] font-semibold rounded bg-gray-100 text-gray-500 dark:bg-gray-700 dark:text-gray-400">{status}</span>;
                                        }
                                    };

                                    return (
                                        <div className="bg-gray-50 dark:bg-gray-800/60 border border-gray-200 dark:border-gray-700 rounded-md p-4">
                                            <div className="space-y-2">
                                                {approvedTrainers.map((trainerName: string, idx: number) => {
                                                    const isLocal = isLocallyAssigned(trainerName);
                                                    const isNext = nextName && trainerName.toLowerCase().trim() === nextName.toLowerCase().trim();
                                                    const norm = trainerName.toLowerCase().replace(/\[[^\]]+\]/g, '').replace(/\s+/g, ' ').trim();
                                                    const trainerInvs = invitations[norm];

                                                    return (
                                                        <div key={idx} className={`text-sm rounded border ${
                                                            isLocal ? 'bg-green-50 dark:bg-green-900/20 border-green-300 dark:border-green-700' :
                                                            isNext ? 'bg-orange-50 dark:bg-orange-900/20 border-orange-300 dark:border-orange-700' :
                                                            'bg-white dark:bg-gray-800 border-gray-200 dark:border-gray-700'
                                                        }`}>
                                                            <div className="flex items-center justify-between py-1.5 px-3">
                                                                <div className="flex items-center">
                                                                    <span className="text-gray-400 mr-3 w-6 text-right">{idx + 1}.</span>
                                                                    <span className="text-gray-900 dark:text-white">{trainerName}</span>
                                                                </div>
                                                                <div className="flex items-center gap-2">
                                                                    {/* Latest status badge — "Manually Added" when local but no invitation, else default to "Not Sent" */}
                                                                    {statusBadge(isLocal && !trainerInvs?.[0] ? 'manual' : (trainerInvs?.[0]?.status || 'not_sent'))}
                                                                    {isLocal && (
                                                                        <span className="text-xs font-medium text-green-600 dark:text-green-400">Assigned (Local)</span>
                                                                    )}
                                                                    {isNext && !isLocal && (
                                                                        <span className="text-xs font-medium text-orange-600 dark:text-orange-400">Next Available</span>
                                                                    )}
                                                                </div>
                                                            </div>
                                                            {/* Detailed view: full invitation history with timestamps */}
                                                            {isDetailedView && trainerInvs && trainerInvs.length > 0 && (
                                                                <div className="px-3 pb-2 pt-0.5 ml-9 border-t border-gray-100 dark:border-gray-700/50">
                                                                    {trainerInvs.map((inv: any, i: number) => (
                                                                        <div key={i} className="flex items-center gap-2 text-[11px] text-gray-500 dark:text-gray-400 py-0.5">
                                                                            {statusBadge(inv.status)}
                                                                            <span>Sent: {formatDt(inv.sent_at)}</span>
                                                                            {inv.responded_at && (
                                                                                <span>→ Responded: {formatDt(inv.responded_at)}</span>
                                                                            )}
                                                                        </div>
                                                                    ))}
                                                                </div>
                                                            )}
                                                        </div>
                                                    );
                                                })}
                                            </div>
                                        </div>
                                    );
                                })() : (
                                    <div className="bg-gray-50 dark:bg-gray-800/60 border border-gray-200 dark:border-gray-700 rounded-md p-4 text-sm text-gray-500 dark:text-gray-400">
                                        No approved trainers list available for this course.
                                    </div>
                                )}
                            </div>


                        </div>
                    </FormSection>
                )}

                {/* Assessment Tab */}
                {isEditMode && activeTab === 'assessment' && (
                    <FormSection title="Assessment Resources">
                        <p className="text-sm text-gray-500 dark:text-gray-400 mb-4">
                            Quick access to the Assessment folder and Assessment Record folder configured on the parent course.
                        </p>

                        {assessmentLinksLoading && (
                            <div className="flex items-center gap-2 text-sm text-gray-600 dark:text-gray-400">
                                <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-blue-500"></div>
                                Loading…
                            </div>
                        )}

                        {!assessmentLinksLoading && assessmentLinksError && (
                            <div className="bg-red-50 dark:bg-red-900/20 border-l-4 border-red-500 dark:border-red-600 rounded-r-lg p-3 text-sm text-red-800 dark:text-red-300">
                                {assessmentLinksError}
                            </div>
                        )}

                        {!assessmentLinksLoading && !assessmentLinksError && assessmentLinks && (
                            <div className="space-y-3">
                                {[
                                    { label: 'Assessment Folder', url: assessmentLinks.assessmentFolderUrl, hint: 'Folder containing the assessment plan and source documents.' },
                                    { label: 'Assessment Record Folder', url: assessmentLinks.assessmentRecordFolderUrl, hint: 'Folder where graded assessment records are stored.' },
                                    { label: 'Assessment Summary Record', url: assessmentLinks.assessmentSummaryRecordUrl, hint: 'Optional — link to the consolidated ASR document or folder.' },
                                ].map(item => (
                                    <div key={item.label} className="rounded-md border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 p-4">
                                        <div className="flex items-start justify-between gap-4">
                                            <div className="min-w-0">
                                                <p className="text-sm font-semibold text-gray-900 dark:text-white">{item.label}</p>
                                                <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">{item.hint}</p>
                                                {item.url ? (
                                                    <a
                                                        href={item.url}
                                                        target="_blank"
                                                        rel="noopener noreferrer"
                                                        className="block mt-2 text-sm text-blue-600 dark:text-blue-400 hover:underline break-all"
                                                    >
                                                        {item.url}
                                                    </a>
                                                ) : (
                                                    <p className="mt-2 text-sm text-gray-400 italic">Not configured on the course.</p>
                                                )}
                                            </div>
                                            {item.url && (
                                                <a
                                                    href={item.url}
                                                    target="_blank"
                                                    rel="noopener noreferrer"
                                                    className="flex-shrink-0 inline-flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium rounded-md bg-blue-600 hover:bg-blue-700 text-white"
                                                >
                                                    Open
                                                </a>
                                            )}
                                        </div>
                                    </div>
                                ))}
                                <p className="text-xs text-gray-500 dark:text-gray-400 mt-2">
                                    These links are configured on the course (not the run). Update them in <strong>Course Management → Edit Course</strong>.
                                </p>
                            </div>
                        )}
                    </FormSection>
                )}
            </div>

            {/* Popup Modal */}
            {showPopup && (
                <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
                    <div className="bg-white dark:bg-gray-800 rounded-lg shadow-xl max-w-4xl w-full mx-4 max-h-[90vh] overflow-auto border dark:border-gray-700">
                        <div className="p-6">
                            <div className="flex items-center mb-4">
                                <div className="w-8 h-8 rounded-full flex items-center justify-center mr-3">
                                    {popupConfig.type === 'success' && (
                                        <svg className="w-5 h-5 text-green-600" fill="currentColor" viewBox="0 0 20 20">
                                            <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                                        </svg>
                                    )}
                                    {popupConfig.type === 'error' && (
                                        <svg className="w-5 h-5 text-red-600" fill="currentColor" viewBox="0 0 20 20">
                                            <path fillRule="evenodd" d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z" clipRule="evenodd" />
                                        </svg>
                                    )}
                                    {popupConfig.type === 'warning' && (
                                        <svg className="w-5 h-5 text-yellow-600" fill="currentColor" viewBox="0 0 20 20">
                                            <path fillRule="evenodd" d="M8.257 3.099c.765-1.36 2.722-1.36 3.486 0l5.58 9.92c.75 1.334-.213 2.98-1.742 2.98H4.42c-1.53 0-2.493-1.646-1.743-2.98l5.58-9.92zM11 13a1 1 0 11-2 0 1 1 0 012 0zm-1-8a1 1 0 00-1 1v3a1 1 0 002 0V6a1 1 0 00-1-1z" clipRule="evenodd" />
                                        </svg>
                                    )}
                                    {(popupConfig.type === 'info' || popupConfig.type === 'confirm') && (
                                        <svg className="w-5 h-5 text-blue-600" fill="currentColor" viewBox="0 0 20 20">
                                            <path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7-4a1 1 0 11-2 0 1 1 0 012 0zM9 9a1 1 0 000 2v3a1 1 0 001 1h1a1 1 0 100-2v-3a1 1 0 00-1-1H9z" clipRule="evenodd" />
                                        </svg>
                                    )}
                                </div>
                                <h3 className="text-lg font-semibold text-gray-900 dark:text-white">{popupConfig.title}</h3>
                            </div>

                            <p className="text-gray-600 dark:text-gray-300 mb-6">{popupConfig.message}</p>

                            <div className="flex justify-end space-x-3">
                                {popupConfig.type === 'confirm' ? (
                                    <>
                                        <Button
                                            variant="ghost"
                                            onClick={() => {
                                                if (popupConfig.onCancel) {
                                                    popupConfig.onCancel();
                                                }
                                                setShowPopup(false);
                                            }}
                                        >
                                            {popupConfig.cancelText || 'Cancel'}
                                        </Button>
                                        <Button
                                            variant="primary"
                                            onClick={() => {
                                                if (popupConfig.onConfirm) {
                                                    popupConfig.onConfirm();
                                                }
                                                setShowPopup(false);
                                            }}
                                            className="bg-orange-600 hover:bg-orange-700 text-white"
                                        >
                                            {popupConfig.confirmText || 'Confirm'}
                                        </Button>
                                    </>
                                ) : (
                                    <Button
                                        variant="primary"
                                        onClick={closePopup}
                                        className={`${popupConfig.type === 'success' ? 'bg-green-600 hover:bg-green-700' :
                                                popupConfig.type === 'error' ? 'bg-red-600 hover:bg-red-700' :
                                                    popupConfig.type === 'warning' ? 'bg-yellow-600 hover:bg-yellow-700' :
                                                        'bg-blue-600 hover:bg-blue-700'
                                            } text-white`}
                                    >
                                        {popupConfig.confirmText || 'OK'}
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

export const EnrollLearnersView: React.FC = () => {
    const { setAdminPage, currentUser } = useLms();

    return (
        <div>
            <div className="flex justify-between items-center mb-6">
                <h2 className="text-3xl font-bold">Enroll Learners</h2>
                <Button variant="ghost" onClick={() => setAdminPage(AdminPage.Dashboard)}>
                    Back to Dashboard
                </Button>
            </div>

            <Card className="p-6">
                <div className="text-center py-8">
                    <h3 className="text-xl font-semibold text-gray-700 dark:text-gray-300 mb-2">Enroll Learners Feature</h3>
                    <p className="text-gray-500 dark:text-gray-400">This feature will allow bulk enrollment of learners to classes.</p>
                    <p className="text-sm text-gray-400 mt-2">Coming soon...</p>
                </div>
            </Card>
        </div>
    );
};

export const AssignTrainerView: React.FC = () => {
    const { setAdminPage } = useLms();

    const [courseRuns, setCourseRuns] = useState<any[]>([]);
    const [search, setSearch] = useState('');
    const [loadingRuns, setLoadingRuns] = useState(false);

    const [availableTrainers, setAvailableTrainers] = useState<any[]>([]);
    const [loadingTrainers, setLoadingTrainers] = useState(false);

    const [selectedRunId, setSelectedRunId] = useState<string | null>(null);
    const [assignMode, setAssignMode] = useState<'dropdown' | 'manual'>('dropdown');
    const [selectedTrainerId, setSelectedTrainerId] = useState('');
    const [manualName, setManualName] = useState('');
    const [manualEmail, setManualEmail] = useState('');
    const [saving, setSaving] = useState(false);
    const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

    // Filters
    const [filterNoTrainer, setFilterNoTrainer] = useState(false);
    const [filterTrainerName, setFilterTrainerName] = useState('');
    const [filterCourse, setFilterCourse] = useState('');

    const [classFilter, setClassFilter] = useState<'upcoming' | 'ongoing' | 'completed'>('upcoming');
    const [currentPage, setCurrentPage] = useState(1);
    const PAGE_SIZE = 10;

    // Track live assignments without refetching the whole table
    const [localAssignments, setLocalAssignments] = useState<Record<string, { name: string; email: string }>>({});

    // Track detailed trainers for the currently expanded row
    const [expandedRunTrainers, setExpandedRunTrainers] = useState<any[]>([]);
    const [loadingExpandedTrainers, setLoadingExpandedTrainers] = useState(false);

    const fetchCourseRuns = async (q: string, filter: 'upcoming' | 'ongoing' | 'completed' = classFilter) => {
        setLoadingRuns(true);
        setCurrentPage(1);
        try {
            const queryParams = new URLSearchParams({ status: filter });
            if (q) queryParams.set('search', q);
            const res = await fetch(`/api/admin/all-course-runs?${queryParams.toString()}`);
            const json = await res.json();
            if (json.success) setCourseRuns(json.data);
        } catch {
            /* silent */
        } finally {
            setLoadingRuns(false);
        }
    };

    const fetchTrainers = async () => {
        setLoadingTrainers(true);
        try {
            const res = await fetch('/api/admin/trainers-detail');
            const json = await res.json();
            if (json.success) setAvailableTrainers(json.data.trainers);
        } catch {
            /* silent */
        } finally {
            setLoadingTrainers(false);
        }
    };

    const fetchExpandedRunTrainers = async (runId: string) => {
        setLoadingExpandedTrainers(true);
        try {
            const res = await fetch(`/api/admin/course-run-trainers?courseRunUuid=${runId}`);
            const json = await res.json();
            if (json.success && json.data) {
                setExpandedRunTrainers(json.data);
                return json.data;
            } else {
                setExpandedRunTrainers([]);
                return [];
            }
        } catch {
            setExpandedRunTrainers([]);
            return [];
        } finally {
            setLoadingExpandedTrainers(false);
        }
    };

    useEffect(() => {
        fetchCourseRuns('');
        fetchTrainers();
    }, []); // eslint-disable-line react-hooks/exhaustive-deps

    // Fetch detailed trainers when a row is expanded
    useEffect(() => {
        if (selectedRunId) {
            fetchExpandedRunTrainers(selectedRunId);
        } else {
            setExpandedRunTrainers([]);
        }
    }, [selectedRunId]);

    const handleSearch = (e: React.FormEvent) => {
        e.preventDefault();
        fetchCourseRuns(search, classFilter);
    };

    const handleRemoveSpecificTrainer = async (runId: string, junctionId: string, trainerName: string) => {
        setMessage(null);
        setSaving(true);
        try {
            const res = await fetch('/api/admin/remove-trainer', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ courseRunUuid: runId, junctionId }),
            });
            const data = await res.json();
            if (!res.ok) throw new Error(data.error || 'Failed to remove trainer');

            setMessage({ type: 'success', text: `Trainer "${trainerName}" removed successfully.` });
            
            // Re-fetch the detailed list for the expanded row
            await fetchExpandedRunTrainers(runId);
            
            // Update the local assignment string representation for the main table row
            setExpandedRunTrainers((prev) => {
                const updated = prev.filter(t => t.id !== junctionId);
                const combinedNames = updated.map(t => t.trainer_name).join(', ');
                const combinedEmails = updated.map(t => t.trainer_email).filter(Boolean).join(', ');
                setLocalAssignments(curr => ({ ...curr, [runId]: { name: combinedNames, email: combinedEmails } }));
                return updated;
            });
        } catch (err) {
            setMessage({ type: 'error', text: err instanceof Error ? err.message : 'Failed to remove trainer' });
        } finally {
            setSaving(false);
        }
    };

    const handleAssign = async (e: React.MouseEvent, run: any) => {
        e.preventDefault();
        setMessage(null);
        let trainerName = '';
        let trainerEmail = '';
        let trainerId = '';

        if (assignMode === 'dropdown') {
            const selected = availableTrainers.find(t => t.user_id === selectedTrainerId);
            if (!selected) { setMessage({ type: 'error', text: 'Please select a trainer.' }); return; }
            trainerName = selected.trainer_name;
            trainerEmail = selected.email;
            trainerId = selected.user_id;
        } else {
            if (!manualName.trim()) { setMessage({ type: 'error', text: 'Trainer name is required.' }); return; }
            trainerName = manualName.trim();
            trainerEmail = manualEmail.trim();
        }

        setSaving(true);
        try {
            const res = await fetch('/api/admin/update-trainer-info', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    courseRunUuid: run.id,
                    courseRunId: run.courseRunId,
                    trainerName,
                    trainerEmail,
                    trainerId: trainerId || undefined,
                }),
            });
            const data = await res.json();
            if (!res.ok) throw new Error(data.error || 'Failed to assign trainer');
            
            setMessage({ type: 'success', text: `"${trainerName}" assigned successfully.` });
            setSelectedTrainerId('');
            setManualName('');
            setManualEmail('');
            
            // Re-fetch detailed trainers
            const freshTrainers = await fetchExpandedRunTrainers(run.id);

            // Update main view string wrapper with the fresh data from the server
            const updatedNames = freshTrainers.map((t: any) => t.trainer_name).join(', ');
            const updatedEmails = freshTrainers.map((t: any) => t.trainer_email).filter(Boolean).join(', ');
            setLocalAssignments(curr => ({ ...curr, [run.id]: { name: updatedNames, email: updatedEmails } }));

        } catch (err) {
            setMessage({ type: 'error', text: err instanceof Error ? err.message : 'Failed to assign trainer' });
        } finally {
            setSaving(false);
        }
    };

    const handleRemoveAllTrainers = async (runId: string) => {
        if (!confirm('Are you sure you want to remove all trainers for this class?')) return;
        setMessage(null);
        setSaving(true);
        try {
            const res = await fetch('/api/admin/remove-trainer', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ courseRunUuid: runId }),
            });
            const data = await res.json();
            if (!res.ok) throw new Error(data.error || 'Failed to remove all trainers');

            setMessage({ type: 'success', text: `All trainers removed successfully.` });
            
            await fetchExpandedRunTrainers(runId);
            setLocalAssignments(curr => ({ ...curr, [runId]: { name: '', email: '' } }));
        } catch (err) {
            setMessage({ type: 'error', text: err instanceof Error ? err.message : 'Failed to remove trainers' });
        } finally {
            setSaving(false);
        }
    };

    // Get unique trainer names for filter dropdown
    const uniqueTrainerNames = Array.from(
        new Set(
            courseRuns
                .map(run => {
                    const local = localAssignments[run.id];
                    return local?.name || run.primaryAssignedTrainerName;
                })
                .filter(Boolean)
        )
    ).sort();

    const uniqueCourseNames = Array.from(
        new Set(courseRuns.map(run => run.courseTitle).filter(Boolean))
    ).sort();

    // Apply client-side filters
    const filteredRuns = courseRuns.filter(run => {
        const local = localAssignments[run.id];
        const trainerName = local?.name ?? run.primaryAssignedTrainerName;

        if (filterNoTrainer && trainerName) return false;
        if (filterTrainerName && trainerName !== filterTrainerName) return false;
        if (filterCourse && run.courseTitle !== filterCourse) return false;

        return true;
    });

    const totalPages = Math.ceil(filteredRuns.length / PAGE_SIZE);
    const paginatedRuns = filteredRuns.slice((currentPage - 1) * PAGE_SIZE, currentPage * PAGE_SIZE);

    // KPI stats
    const totalClasses = courseRuns.length;
    const trainersAssigned = courseRuns.filter(run => {
        const local = localAssignments[run.id];
        return (local?.name ?? run.primaryAssignedTrainerName);
    }).length;
    const missingTrainers = totalClasses - trainersAssigned;

    const inputClasses = 'w-full border border-gray-300 dark:border-gray-600 rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 dark:bg-gray-700 dark:text-white';

    return (
        <div>
            <div className="flex justify-between items-center mb-6">
                <h2 className="text-3xl font-bold dark:text-white">Assign Trainer</h2>
                <Button variant="ghost" onClick={() => setAdminPage(AdminPage.Dashboard)}>
                    Back to Dashboard
                </Button>
            </div>

            {/* KPI Stats */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-8">
                <Card className="p-6 text-center">
                    <p className="text-4xl font-bold text-blue-600">{totalClasses}</p>
                    <p className="text-gray-600 dark:text-gray-300 mt-1 capitalize">{classFilter} Classes</p>
                </Card>
                <Card className="p-6 text-center">
                    <p className="text-4xl font-bold text-green-600">{trainersAssigned}</p>
                    <p className="text-gray-600 dark:text-gray-300 mt-1">Trainers Assigned</p>
                </Card>
                <Card className="p-6 text-center">
                    <p className="text-4xl font-bold text-red-600">{missingTrainers}</p>
                    <p className="text-gray-600 dark:text-gray-300 mt-1">Missing Trainers</p>
                </Card>
            </div>

            {/* Feedback banner */}
            {message && (
                <div className={`mb-4 p-3 rounded-md text-sm ${message.type === 'success' ? 'bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-700 text-green-800 dark:text-green-300' : 'bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-700 text-red-800 dark:text-red-300'}`}>
                    {message.text}
                </div>
            )}

            {/* Search & Filters */}
            <Card className="p-4 mb-4 dark:bg-gray-800 dark:border-gray-700">
                {/* Filter tabs */}
                <div className="inline-flex rounded-lg bg-gray-100 dark:bg-gray-700 p-1 mb-4">
                    {(['upcoming', 'ongoing', 'completed'] as const).map(f => (
                        <button
                            key={f}
                            onClick={() => {
                                setClassFilter(f);
                                setSelectedRunId(null);
                                fetchCourseRuns(search, f);
                            }}
                            className={`px-4 py-1.5 rounded-md text-sm font-medium transition-colors capitalize ${
                                classFilter === f
                                    ? 'bg-white dark:bg-gray-900 text-blue-600 shadow-sm'
                                    : 'text-gray-500 hover:text-gray-700 dark:hover:text-gray-300'
                            }`}
                        >
                            {f}
                        </button>
                    ))}
                </div>
                <form onSubmit={handleSearch} className="flex gap-2 mb-4">
                    <input
                        type="text"
                        value={search}
                        onChange={e => {
                            setSearch(e.target.value);
                            if (e.target.value === '') fetchCourseRuns('', classFilter);
                        }}
                        placeholder="Search by course title, code or run ID..."
                        className={`${inputClasses} flex-1`}
                    />
                    <Button type="submit" disabled={loadingRuns}>
                        {loadingRuns ? 'Searching...' : 'Search'}
                    </Button>
                </form>
                <div className="flex flex-wrap items-center gap-4">
                    <label className="flex items-center gap-2 text-sm text-gray-700 dark:text-gray-300 cursor-pointer">
                        <input
                            type="checkbox"
                            checked={filterNoTrainer}
                            onChange={e => {
                                setFilterNoTrainer(e.target.checked);
                                if (e.target.checked) setFilterTrainerName('');
                            }}
                            className="rounded border-gray-300 dark:border-gray-600 text-blue-600 focus:ring-blue-500"
                        />
                        Show only classes with no trainer
                    </label>
                    <div className="flex items-center gap-2">
                        <label className="text-sm text-gray-700 dark:text-gray-300 whitespace-nowrap">Filter by trainer:</label>
                        <select
                            value={filterTrainerName}
                            onChange={e => {
                                setFilterTrainerName(e.target.value);
                                if (e.target.value) setFilterNoTrainer(false);
                            }}
                            className="border border-gray-300 dark:border-gray-600 rounded-md px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 dark:bg-gray-700 dark:text-white"
                        >
                            <option value="">All trainers</option>
                            {uniqueTrainerNames.map(name => (
                                <option key={name} value={name}>{name}</option>
                            ))}
                        </select>
                    </div>
                    <div className="flex items-center gap-2">
                        <label className="text-sm text-gray-700 dark:text-gray-300 whitespace-nowrap">Filter by course:</label>
                        <select
                            value={filterCourse}
                            onChange={e => setFilterCourse(e.target.value)}
                            className="border border-gray-300 dark:border-gray-600 rounded-md px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 dark:bg-gray-700 dark:text-white max-w-xs"
                        >
                            <option value="">All courses</option>
                            {uniqueCourseNames.map(name => (
                                <option key={name} value={name}>{name}</option>
                            ))}
                        </select>
                    </div>
                    <span className="text-xs text-gray-500 dark:text-gray-400">
                        Showing {filteredRuns.length} of {courseRuns.length} <span className="capitalize">{classFilter}</span> classes
                    </span>
                </div>
            </Card>

            {/* Course Runs Table */}
            <Card className="dark:bg-gray-800 dark:border-gray-700 overflow-hidden">
                {loadingRuns ? (
                    <div className="p-8 text-center">
                        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-500 mx-auto mb-4"></div>
                        <p className="text-gray-500 dark:text-gray-400 text-lg capitalize">Loading {classFilter} classes...</p>
                    </div>
                ) : filteredRuns.length === 0 ? (
                    <div className="p-8 text-center text-sm text-gray-500 dark:text-gray-400">
                        {courseRuns.length === 0 ? `No ${classFilter} classes found.` : 'No classes match the current filters.'}
                    </div>
                ) : (
                    <div className="overflow-x-auto">
                        <table className="min-w-full divide-y divide-gray-200 dark:divide-gray-700">
                            <thead className="bg-gray-50 dark:bg-gray-700/50">
                                <tr>
                                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider dark:text-gray-400">Start Date</th>
                                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider dark:text-gray-400">Course Run ID</th>
                                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider dark:text-gray-400">Course Title</th>
                                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider dark:text-gray-400">Course Ref Code</th>
                                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider dark:text-gray-400">Class Status</th>
                                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider dark:text-gray-400">Trainer</th>
                                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider dark:text-gray-400">Action</th>
                                </tr>
                            </thead>
                            <tbody className="bg-white divide-y divide-gray-200 dark:bg-gray-800 dark:divide-gray-700">
                                {paginatedRuns.map(run => {
                                    const local = localAssignments[run.id];
                                    const currentName = local?.name ?? run.primaryAssignedTrainerName;
                                    const currentEmail = local?.email ?? run.assignedTrainerEmail;
                                    const isExpanded = selectedRunId === run.id;

                                    return (
                                        <React.Fragment key={run.id}>
                                            <tr className="hover:bg-gray-50 dark:hover:bg-gray-700/50">
                                                <td className="px-4 py-3 whitespace-nowrap text-sm text-gray-700 dark:text-gray-200">
                                                    {run.startDate ? new Date(run.startDate).toLocaleDateString() : '—'}
                                                </td>
                                                <td className="px-4 py-3 whitespace-nowrap text-sm font-medium text-blue-600 dark:text-blue-400">
                                                    {run.courseRunId || '—'}
                                                </td>
                                                <td className="px-4 py-3 text-sm text-gray-900 dark:text-white max-w-xs truncate">
                                                    {run.courseTitle}
                                                </td>
                                                <td className="px-4 py-3 whitespace-nowrap text-sm text-gray-700 dark:text-gray-200">
                                                    {run.courseCode || '—'}
                                                </td>
                                                <td className="px-4 py-3 whitespace-nowrap text-sm">
                                                    {run.classStatus ? (
                                                        <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${
                                                            run.classStatus === 'Confirmed'  ? 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300' :
                                                            run.classStatus === 'Cancelled'  ? 'bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-300' :
                                                            run.classStatus === 'Pending'    ? 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-300' :
                                                            'bg-gray-100 text-gray-600 dark:bg-gray-700 dark:text-gray-400'
                                                        }`}>
                                                            {run.classStatus}
                                                        </span>
                                                    ) : (
                                                        <span className="text-gray-400">—</span>
                                                    )}
                                                </td>
                                                <td className="px-4 py-3 whitespace-nowrap text-sm">
                                                    {currentName ? (
                                                        <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300">
                                                            {currentName}
                                                        </span>
                                                    ) : (
                                                        <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-gray-100 text-gray-500 dark:bg-gray-700 dark:text-gray-400">
                                                            No trainer
                                                        </span>
                                                    )}
                                                </td>
                                                <td className="px-4 py-3 whitespace-nowrap text-sm">
                                                    <button
                                                        onClick={() => {
                                                            setSelectedRunId(isExpanded ? null : run.id);
                                                            setMessage(null);
                                                            setAssignMode('dropdown');
                                                            setSelectedTrainerId('');
                                                            setManualName('');
                                                            setManualEmail('');
                                                        }}
                                                        className={`px-3 py-1.5 rounded-md text-xs font-medium transition-colors ${
                                                            isExpanded
                                                                ? 'bg-gray-200 text-gray-700 dark:bg-gray-600 dark:text-gray-200'
                                                                : currentName
                                                                    ? 'bg-blue-50 text-blue-700 hover:bg-blue-100 border border-blue-200 dark:bg-blue-900/30 dark:text-blue-300 dark:border-blue-700 dark:hover:bg-blue-900/50'
                                                                    : 'bg-green-50 text-green-700 hover:bg-green-100 border border-green-200 dark:bg-green-900/30 dark:text-green-300 dark:border-green-700 dark:hover:bg-green-900/50'
                                                        }`}
                                                    >
                                                        {isExpanded ? 'Close' : currentName ? 'Edit Trainer' : 'Assign Trainer'}
                                                    </button>
                                                </td>
                                            </tr>

                                            {/* Expanded assignment form row */}
                                            {isExpanded && (
                                                <tr>
                                                    <td colSpan={7} className="px-4 py-4 bg-gray-50 dark:bg-gray-900 border-t border-gray-200 dark:border-gray-700">
                                                        <div className="max-w-2xl space-y-4">
                                                            {/* Detailed Trainers List (Multi-Trainer) */}
                                                            <div className="bg-white dark:bg-gray-800 p-4 border border-gray-200 dark:border-gray-700 rounded-lg">
                                                                <div className="flex justify-between items-center mb-3">
                                                                    <h4 className="text-sm font-semibold text-gray-800 dark:text-gray-200">
                                                                        Currently Assigned ({expandedRunTrainers.length})
                                                                    </h4>
                                                                    {expandedRunTrainers.length > 0 && (
                                                                        <button
                                                                            type="button"
                                                                            onClick={() => handleRemoveAllTrainers(run.id)}
                                                                            disabled={saving}
                                                                            className="text-xs text-red-600 hover:text-red-800 hover:bg-red-50 dark:hover:bg-red-900/30 px-2 py-1 rounded transition-colors"
                                                                        >
                                                                            Remove All
                                                                        </button>
                                                                    )}
                                                                </div>
                                                                {loadingExpandedTrainers ? (
                                                                    <div className="text-sm text-gray-500 animate-pulse">Loading trainers...</div>
                                                                ) : expandedRunTrainers.length > 0 ? (
                                                                    <div className="space-y-2">
                                                                        {expandedRunTrainers.map(t => (
                                                                            <div key={t.id} className="flex justify-between items-center bg-gray-50 dark:bg-gray-700/50 p-2 rounded border border-gray-100 dark:border-gray-600">
                                                                                <div className="text-sm">
                                                                                    <span className="font-medium text-gray-900 dark:text-white">{t.trainer_name}</span>
                                                                                    {t.trainer_email && <span className="text-gray-500 dark:text-gray-400 ml-2">({t.trainer_email})</span>}
                                                                                </div>
                                                                                <button
                                                                                    type="button"
                                                                                    onClick={() => handleRemoveSpecificTrainer(run.id, t.id, t.trainer_name)}
                                                                                    disabled={saving}
                                                                                    className="text-xs text-red-600 hover:text-red-800 hover:bg-red-50 dark:hover:bg-red-900/30 px-2 py-1 rounded transition-colors"
                                                                                >
                                                                                    ✕ Remove
                                                                                </button>
                                                                            </div>
                                                                        ))}
                                                                    </div>
                                                                ) : (
                                                                    <div className="text-sm text-gray-500 italic">No trainers assigned. Add one below.</div>
                                                                )}
                                                            </div>

                                                            <div className="border-t border-gray-200 dark:border-gray-700 pt-4 mt-4">
                                                                <h4 className="text-sm font-semibold text-gray-800 dark:text-gray-200 mb-3">Add New Trainer</h4>
                                                                
                                                                {/* Mode toggle */}
                                                                <div className="flex gap-2 mb-4">
                                                                    {(['dropdown', 'manual'] as const).map(mode => (
                                                                        <button
                                                                            key={mode}
                                                                            type="button"
                                                                            onClick={() => setAssignMode(mode)}
                                                                            className={`px-3 py-1.5 rounded text-sm font-medium transition-colors ${assignMode === mode ? 'bg-blue-600 text-white' : 'border border-gray-300 text-gray-600 hover:bg-gray-100 dark:border-gray-600 dark:text-gray-300 dark:hover:bg-gray-700'}`}
                                                                        >
                                                                            {mode === 'dropdown' ? 'Select from list' : 'Enter manually'}
                                                                        </button>
                                                                    ))}
                                                                </div>

                                                                {assignMode === 'dropdown' ? (
                                                                    <div>
                                                                        <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                                                                            Trainer <span className="text-red-500">*</span>
                                                                        </label>
                                                                        {loadingTrainers ? (
                                                                            <p className="text-sm text-gray-500 italic">Loading trainers...</p>
                                                                        ) : (
                                                                            <SearchableSelect
                                                                                options={availableTrainers.map(t => ({ value: t.user_id, label: `${t.trainer_name} (${t.email})` }))}
                                                                                value={selectedTrainerId}
                                                                                onChange={setSelectedTrainerId}
                                                                                placeholder="— Search trainer by name or email —"
                                                                                className={inputClasses}
                                                                            />
                                                                        )}
                                                                    </div>
                                                                ) : (
                                                                    <div className="space-y-2">
                                                                        <div>
                                                                            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                                                                                Trainer Name <span className="text-red-500">*</span>
                                                                            </label>
                                                                            <input
                                                                                type="text"
                                                                                placeholder="Full name"
                                                                                value={manualName}
                                                                                onChange={e => setManualName(e.target.value)}
                                                                                className={inputClasses}
                                                                            />
                                                                        </div>
                                                                        <div>
                                                                            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                                                                                Trainer Email
                                                                            </label>
                                                                            <input
                                                                                type="email"
                                                                                placeholder="email@example.com"
                                                                                value={manualEmail}
                                                                                onChange={e => setManualEmail(e.target.value)}
                                                                                className={inputClasses}
                                                                            />
                                                                        </div>
                                                                    </div>
                                                                )}

                                                                <div className="flex justify-end mt-4">
                                                                    <Button
                                                                        type="button"
                                                                        onClick={(e) => handleAssign(e, run)}
                                                                        disabled={saving}
                                                                        className="bg-green-600 hover:bg-green-700 text-white"
                                                                    >
                                                                        {saving ? 'Adding...' : 'Add Trainer'}
                                                                    </Button>
                                                                </div>
                                                            </div>
                                                        </div>
                                                    </td>
                                                </tr>
                                            )}
                                        </React.Fragment>
                                    );
                                })}
                            </tbody>
                        </table>
                    </div>
                )}
                {/* Pagination */}
                {totalPages > 1 && (
                    <div className="flex items-center justify-between px-4 py-3 border-t border-gray-200 dark:border-gray-700">
                        <span className="text-sm text-gray-500 dark:text-gray-400">
                            Page {currentPage} of {totalPages} ({filteredRuns.length} classes)
                        </span>
                        <div className="flex items-center gap-1">
                            <button
                                onClick={() => setCurrentPage(p => Math.max(1, p - 1))}
                                disabled={currentPage === 1}
                                className="px-3 py-1.5 text-sm rounded-md border border-gray-300 dark:border-gray-600 disabled:opacity-40 hover:bg-gray-50 dark:hover:bg-gray-700 disabled:cursor-not-allowed"
                            >
                                Prev
                            </button>
                            {Array.from({ length: totalPages }, (_, i) => i + 1).map(p => (
                                <button
                                    key={p}
                                    onClick={() => setCurrentPage(p)}
                                    className={`px-3 py-1.5 text-sm rounded-md border ${
                                        p === currentPage
                                            ? 'bg-blue-600 text-white border-blue-600'
                                            : 'border-gray-300 dark:border-gray-600 hover:bg-gray-50 dark:hover:bg-gray-700'
                                    }`}
                                >
                                    {p}
                                </button>
                            ))}
                            <button
                                onClick={() => setCurrentPage(p => Math.min(totalPages, p + 1))}
                                disabled={currentPage === totalPages}
                                className="px-3 py-1.5 text-sm rounded-md border border-gray-300 dark:border-gray-600 disabled:opacity-40 hover:bg-gray-50 dark:hover:bg-gray-700 disabled:cursor-not-allowed"
                            >
                                Next
                            </button>
                        </div>
                    </div>
                )}
            </Card>
        </div>
    );
};

export const AssignStudentView: React.FC = () => {
    const { setAdminPage } = useLms();

    const [courseRuns, setCourseRuns] = useState<any[]>([]);
    const [search, setSearch] = useState('');
    const [loadingRuns, setLoadingRuns] = useState(false);

    const [availableLearners, setAvailableLearners] = useState<any[]>([]);
    const [loadingLearners, setLoadingLearners] = useState(false);

    const [selectedRunId, setSelectedRunId] = useState<string | null>(null);
    const [activeTab, setActiveTab] = useState<'assign' | 'unassign'>('assign');
    const [selectedLearnerId, setSelectedLearnerId] = useState('');
    const [learnerAssignMode, setLearnerAssignMode] = useState<'dropdown' | 'manual'>('dropdown');
    const [manualLearnerName, setManualLearnerName] = useState('');
    const [manualLearnerEmail, setManualLearnerEmail] = useState('');
    const [saving, setSaving] = useState(false);
    const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

    // Unassign state
    const [enrolledLearners, setEnrolledLearners] = useState<any[]>([]);
    const [loadingEnrolled, setLoadingEnrolled] = useState(false);
    const [unassigning, setUnassigning] = useState<string | null>(null);

    // Track local enrollment count changes
    const [localEnrollmentDeltas, setLocalEnrollmentDeltas] = useState<Record<string, number>>({});

    const [classFilter, setClassFilter] = useState<'upcoming' | 'ongoing' | 'completed'>('upcoming');
    const [currentPage, setCurrentPage] = useState(1);
    const PAGE_SIZE = 10;

    const fetchCourseRuns = async (q: string, filter: 'upcoming' | 'ongoing' | 'completed' = 'upcoming') => {
        setLoadingRuns(true);
        setCurrentPage(1);
        try {
            const queryParams = new URLSearchParams({ status: filter });
            if (q) queryParams.set('search', q);
            const res = await fetch(`/api/admin/all-course-runs?${queryParams.toString()}`);
            const json = await res.json();
            if (json.success) {
                setCourseRuns(json.data);
                setLocalEnrollmentDeltas({});
            }
        } catch {
            /* silent */
        } finally {
            setLoadingRuns(false);
        }
    };

    const fetchLearners = async () => {
        setLoadingLearners(true);
        try {
            const res = await fetch('/api/admin/learners');
            const json = await res.json();
            if (json.success) setAvailableLearners(json.data);
        } catch {
            /* silent */
        } finally {
            setLoadingLearners(false);
        }
    };

    const fetchEnrolledLearners = async (courseRunId: string) => {
        setLoadingEnrolled(true);
        try {
            const res = await fetch(`/api/admin/course-run-enrollments?courseRunId=${courseRunId}`);
            const json = await res.json();
            if (json.success) setEnrolledLearners(json.data);
        } catch {
            /* silent */
        } finally {
            setLoadingEnrolled(false);
        }
    };

    useEffect(() => {
        fetchCourseRuns('', 'upcoming');
        fetchLearners();
    }, []); // eslint-disable-line react-hooks/exhaustive-deps

    const handleSearch = (e: React.FormEvent) => {
        e.preventDefault();
        fetchCourseRuns(search, classFilter);
    };

    const handleAssign = async (run: any) => {
        setMessage(null);

        let body: any;
        let displayName: string;

        if (learnerAssignMode === 'dropdown') {
            if (!selectedLearnerId) {
                setMessage({ type: 'error', text: 'Please select a learner.' });
                return;
            }
            body = { courseRunUuid: run.id, userId: selectedLearnerId };
            const learner = availableLearners.find(l => l.user_id === selectedLearnerId);
            displayName = learner?.full_name || 'Learner';
        } else {
            if (!manualLearnerName.trim()) {
                setMessage({ type: 'error', text: 'Please enter the learner name.' });
                return;
            }
            body = { courseRunUuid: run.id, manualName: manualLearnerName.trim(), manualEmail: manualLearnerEmail.trim() || undefined };
            displayName = manualLearnerName.trim();
        }

        setSaving(true);
        try {
            const res = await fetch('/api/admin/assign-student', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(body),
            });
            const data = await res.json();
            if (!res.ok) throw new Error(data.error || 'Failed to assign learner');
            setMessage({ type: 'success', text: `"${displayName}" enrolled in ${run.courseTitle}.` });
            setLocalEnrollmentDeltas(prev => ({ ...prev, [run.id]: (prev[run.id] || 0) + 1 }));
            setSelectedLearnerId('');
            setManualLearnerName('');
            setManualLearnerEmail('');
            // Refresh enrolled list if viewing unassign tab
            if (activeTab === 'unassign') fetchEnrolledLearners(run.id);
        } catch (err) {
            setMessage({ type: 'error', text: err instanceof Error ? err.message : 'Failed to assign learner' });
        } finally {
            setSaving(false);
        }
    };

    const handleUnassign = async (learner: any, run: any) => {
        setMessage(null);
        setUnassigning(learner.user_id);
        try {
            const res = await fetch('/api/admin/remove-enrollment', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ email: learner.email, courseRunId: run.id }),
            });
            const data = await res.json();
            if (!res.ok) throw new Error(data.message || 'Failed to remove learner');
            setMessage({ type: 'success', text: `"${learner.full_name}" has been removed from ${run.courseTitle}.` });
            setEnrolledLearners(prev => prev.filter(l => l.user_id !== learner.user_id));
            setLocalEnrollmentDeltas(prev => ({ ...prev, [run.id]: (prev[run.id] || 0) - 1 }));
        } catch (err) {
            setMessage({ type: 'error', text: err instanceof Error ? err.message : 'Failed to remove learner' });
        } finally {
            setUnassigning(null);
        }
    };

    const handleExpandRun = (run: any) => {
        const isExpanded = selectedRunId === run.id;
        if (isExpanded) {
            setSelectedRunId(null);
        } else {
            setSelectedRunId(run.id);
            setActiveTab('assign');
            setSelectedLearnerId('');
            setEnrolledLearners([]);
            setMessage(null);
            fetchEnrolledLearners(run.id);
        }
    };

    const handleTabChange = (tab: 'assign' | 'unassign', runId: string) => {
        setActiveTab(tab);
        setMessage(null);
        if (tab === 'unassign') {
            fetchEnrolledLearners(runId);
        }
    };

    const getEnrollmentCount = (run: any) => {
        return (run.enrollmentCount || 0) + (localEnrollmentDeltas[run.id] || 0);
    };

    // KPI stats
    const totalUpcoming = courseRuns.length;
    const totalTrainees = courseRuns.reduce((sum, run) => sum + getEnrollmentCount(run), 0);
    const classesWithNoTrainee = courseRuns.filter(run => getEnrollmentCount(run) === 0).length;

    // Pagination — applied for all tabs
    const paginatedRuns = courseRuns.slice((currentPage - 1) * PAGE_SIZE, currentPage * PAGE_SIZE);
    const totalPages = Math.ceil(courseRuns.length / PAGE_SIZE);

    const inputClasses = 'w-full border border-gray-300 dark:border-gray-600 rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 dark:bg-gray-700 dark:text-white';

    return (
        <div>
            <div className="flex justify-between items-center mb-6">
                <h2 className="text-3xl font-bold dark:text-white">Assign Learners</h2>
                <Button variant="ghost" onClick={() => setAdminPage(AdminPage.Dashboard)}>
                    Back to Dashboard
                </Button>
            </div>

            {/* KPI Stats */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-8">
                <Card className="p-6 text-center">
                    <p className="text-4xl font-bold text-blue-600">{totalUpcoming}</p>
                    <p className="text-gray-600 dark:text-gray-300 mt-1">Upcoming Classes</p>
                </Card>
                <Card className="p-6 text-center">
                    <p className="text-4xl font-bold text-green-600">{totalTrainees}</p>
                    <p className="text-gray-600 dark:text-gray-300 mt-1">No. of Trainees</p>
                </Card>
                <Card className="p-6 text-center">
                    <p className="text-4xl font-bold text-red-600">{classesWithNoTrainee}</p>
                    <p className="text-gray-600 dark:text-gray-300 mt-1">Classes with No Trainee</p>
                </Card>
            </div>

            {/* Feedback banner */}
            {message && (
                <div className={`mb-4 p-3 rounded-md text-sm ${message.type === 'success' ? 'bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-700 text-green-800 dark:text-green-300' : 'bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-700 text-red-800 dark:text-red-300'}`}>
                    {message.text}
                </div>
            )}

            {/* Filter + Search */}
            <Card className="p-4 mb-4 dark:bg-gray-800 dark:border-gray-700">
                {/* Class status toggle */}
                <div className="flex gap-1 mb-3 p-1 bg-gray-100 dark:bg-gray-700 rounded-lg w-fit">
                    {(['upcoming', 'ongoing', 'completed'] as const).map(f => (
                        <button
                            key={f}
                            type="button"
                            onClick={() => {
                                setClassFilter(f);
                                setSelectedRunId(null);
                                fetchCourseRuns(search, f);
                            }}
                            className={`px-4 py-1.5 rounded-md text-sm font-medium transition-colors capitalize ${
                                classFilter === f
                                    ? 'bg-white dark:bg-gray-900 text-blue-600 dark:text-blue-400 shadow-sm'
                                    : 'text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200'
                            }`}
                        >
                            {f}
                        </button>
                    ))}
                </div>
                <form onSubmit={handleSearch} className="flex gap-2">
                    <input
                        type="text"
                        value={search}
                        onChange={e => {
                            setSearch(e.target.value);
                            if (e.target.value === '') fetchCourseRuns('', classFilter);
                        }}
                        placeholder="Search by course title, code or run ID..."
                        className={`${inputClasses} flex-1`}
                    />
                    <Button type="submit" disabled={loadingRuns}>
                        {loadingRuns ? 'Searching...' : 'Search'}
                    </Button>
                </form>
            </Card>

            {/* Course Runs Table */}
            <Card className="dark:bg-gray-800 dark:border-gray-700 overflow-hidden">
                {loadingRuns ? (
                    <div className="p-8 text-center">
                        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-500 mx-auto mb-4"></div>
                        <p className="text-gray-500 dark:text-gray-400 text-lg">Loading {classFilter} classes...</p>
                    </div>
                ) : courseRuns.length === 0 ? (
                    <div className="p-8 text-center text-sm text-gray-500 dark:text-gray-400">No {classFilter} classes found.</div>
                ) : (
                    <div className="overflow-x-auto">
                        <table className="min-w-full divide-y divide-gray-200 dark:divide-gray-700">
                            <thead className="bg-gray-50 dark:bg-gray-700/50">
                                <tr>
                                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider dark:text-gray-400">Start Date</th>
                                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider dark:text-gray-400">Course Run ID</th>
                                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider dark:text-gray-400">Course Title</th>
                                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider dark:text-gray-400">Course Ref Code</th>
                                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider dark:text-gray-400">Trainees</th>
                                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider dark:text-gray-400">Action</th>
                                </tr>
                            </thead>
                            <tbody className="bg-white divide-y divide-gray-200 dark:bg-gray-800 dark:divide-gray-700">
                                {paginatedRuns.map(run => {
                                    const isExpanded = selectedRunId === run.id;
                                    const enrollCount = getEnrollmentCount(run);

                                    return (
                                        <React.Fragment key={run.id}>
                                            <tr className="hover:bg-gray-50 dark:hover:bg-gray-700/50">
                                                <td className="px-4 py-3 whitespace-nowrap text-sm text-gray-700 dark:text-gray-200">
                                                    {run.startDate ? new Date(run.startDate).toLocaleDateString() : '—'}
                                                </td>
                                                <td className="px-4 py-3 whitespace-nowrap text-sm font-medium text-blue-600 dark:text-blue-400">
                                                    {run.courseRunId || '—'}
                                                </td>
                                                <td className="px-4 py-3 text-sm text-gray-900 dark:text-white max-w-xs truncate">
                                                    {run.courseTitle}
                                                </td>
                                                <td className="px-4 py-3 whitespace-nowrap text-sm text-gray-700 dark:text-gray-200">
                                                    {run.courseCode || '—'}
                                                </td>
                                                <td className="px-4 py-3 whitespace-nowrap text-sm">
                                                    {enrollCount > 0 ? (
                                                        <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300">
                                                            {enrollCount} enrolled
                                                        </span>
                                                    ) : (
                                                        <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-gray-100 text-gray-500 dark:bg-gray-700 dark:text-gray-400">
                                                            No trainees
                                                        </span>
                                                    )}
                                                </td>
                                                <td className="px-4 py-3 whitespace-nowrap text-sm">
                                                    <button
                                                        onClick={() => handleExpandRun(run)}
                                                        className={`px-3 py-1.5 rounded-md text-xs font-medium transition-colors ${
                                                            isExpanded
                                                                ? 'bg-gray-200 text-gray-700 dark:bg-gray-600 dark:text-gray-200'
                                                                : 'bg-blue-50 text-blue-700 hover:bg-blue-100 border border-blue-200 dark:bg-blue-900/30 dark:text-blue-300 dark:border-blue-700 dark:hover:bg-blue-900/50'
                                                        }`}
                                                    >
                                                        {isExpanded ? 'Close' : 'Add / Edit Learners'}
                                                    </button>
                                                </td>
                                            </tr>

                                            {/* Expanded panel */}
                                            {isExpanded && (
                                                <tr>
                                                    <td colSpan={6} className="px-4 py-0 bg-gray-50 dark:bg-gray-900 border-t border-gray-200 dark:border-gray-700">
                                                        {/* Tabs */}
                                                        <div className="flex border-b border-gray-200 dark:border-gray-700">
                                                            <button
                                                                className={`px-4 py-2 text-sm font-medium border-b-2 -mb-px transition-colors ${activeTab === 'assign' ? 'border-blue-500 text-blue-600 dark:text-blue-400' : 'border-transparent text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200'}`}
                                                                onClick={() => handleTabChange('assign', run.id)}
                                                            >
                                                                Add Learner
                                                            </button>
                                                            <button
                                                                className={`px-4 py-2 text-sm font-medium border-b-2 -mb-px transition-colors ${activeTab === 'unassign' ? 'border-red-500 text-red-600 dark:text-red-400' : 'border-transparent text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200'}`}
                                                                onClick={() => handleTabChange('unassign', run.id)}
                                                            >
                                                                View / Remove Learners ({enrollCount})
                                                            </button>
                                                        </div>

                                                        {/* Assign tab */}
                                                        {activeTab === 'assign' && (
                                                            <div className="py-4 space-y-4 max-w-2xl">
                                                                {/* Mode toggle */}
                                                                <div className="flex gap-2">
                                                                    {(['dropdown', 'manual'] as const).map(mode => (
                                                                        <button
                                                                            key={mode}
                                                                            type="button"
                                                                            onClick={() => setLearnerAssignMode(mode)}
                                                                            className={`px-3 py-1.5 rounded text-sm font-medium transition-colors ${learnerAssignMode === mode ? 'bg-blue-600 text-white' : 'border border-gray-300 text-gray-600 hover:bg-gray-100 dark:border-gray-600 dark:text-gray-300 dark:hover:bg-gray-700'}`}
                                                                        >
                                                                            {mode === 'dropdown' ? 'Select from list' : 'Enter manually'}
                                                                        </button>
                                                                    ))}
                                                                </div>

                                                                {learnerAssignMode === 'dropdown' ? (
                                                                    <div>
                                                                        <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                                                                            Learner <span className="text-red-500">*</span>
                                                                        </label>
                                                                        {loadingLearners ? (
                                                                            <p className="text-sm text-gray-500 italic">Loading learners...</p>
                                                                        ) : (
                                                                            <SearchableSelect
                                                                                options={availableLearners.map(l => ({ value: l.user_id, label: `${l.full_name} (${l.email})` }))}
                                                                                value={selectedLearnerId}
                                                                                onChange={setSelectedLearnerId}
                                                                                placeholder="— Search learner by name or email —"
                                                                                className={inputClasses}
                                                                            />
                                                                        )}
                                                                    </div>
                                                                ) : (
                                                                    <div className="space-y-3">
                                                                        <div>
                                                                            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                                                                                Learner Name <span className="text-red-500">*</span>
                                                                            </label>
                                                                            <input
                                                                                type="text"
                                                                                placeholder="Full name"
                                                                                value={manualLearnerName}
                                                                                onChange={e => setManualLearnerName(e.target.value)}
                                                                                className={inputClasses}
                                                                            />
                                                                        </div>
                                                                        <div>
                                                                            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                                                                                Learner Email
                                                                            </label>
                                                                            <input
                                                                                type="email"
                                                                                placeholder="email@example.com"
                                                                                value={manualLearnerEmail}
                                                                                onChange={e => setManualLearnerEmail(e.target.value)}
                                                                                className={inputClasses}
                                                                            />
                                                                        </div>
                                                                    </div>
                                                                )}

                                                                <div className="flex justify-end">
                                                                    <Button
                                                                        onClick={() => handleAssign(run)}
                                                                        disabled={saving}
                                                                        className="bg-green-600 hover:bg-green-700 text-white"
                                                                    >
                                                                        {saving ? 'Adding...' : 'Add Learner'}
                                                                    </Button>
                                                                </div>
                                                            </div>
                                                        )}

                                                        {/* Unassign tab */}
                                                        {activeTab === 'unassign' && (
                                                            <div className="py-4">
                                                                {loadingEnrolled ? (
                                                                    <p className="text-sm text-gray-500 italic">Loading enrolled learners...</p>
                                                                ) : enrolledLearners.length === 0 ? (
                                                                    <p className="text-sm text-gray-500 dark:text-gray-400 italic">No learners enrolled in this course run.</p>
                                                                ) : (
                                                                    <div className="divide-y divide-gray-200 dark:divide-gray-700 rounded-md border border-gray-200 dark:border-gray-700 overflow-hidden max-w-2xl">
                                                                        {enrolledLearners.map(learner => (
                                                                            <div key={learner.user_id} className="flex items-center justify-between px-3 py-2 bg-white dark:bg-gray-800">
                                                                                <div>
                                                                                    <p className="text-sm font-medium text-gray-900 dark:text-white">{learner.full_name}</p>
                                                                                    <p className="text-xs text-gray-500 dark:text-gray-400">{learner.email}</p>
                                                                                </div>
                                                                                <Button
                                                                                    variant="ghost"
                                                                                    onClick={() => handleUnassign(learner, run)}
                                                                                    disabled={unassigning === learner.user_id}
                                                                                    className="text-red-600 hover:text-red-700 hover:bg-red-50 dark:hover:bg-red-900/20 text-xs"
                                                                                >
                                                                                    {unassigning === learner.user_id ? 'Removing...' : 'Remove'}
                                                                                </Button>
                                                                            </div>
                                                                        ))}
                                                                    </div>
                                                                )}
                                                            </div>
                                                        )}
                                                    </td>
                                                </tr>
                                            )}
                                        </React.Fragment>
                                    );
                                })}
                            </tbody>
                        </table>
                    </div>
                )}
                {/* Pagination */}
                {totalPages > 1 && (
                    <div className="flex items-center justify-between px-4 py-3 border-t border-gray-200 dark:border-gray-700">
                        <p className="text-xs text-gray-500 dark:text-gray-400">
                            Showing {(currentPage - 1) * PAGE_SIZE + 1}–{Math.min(currentPage * PAGE_SIZE, courseRuns.length)} of {courseRuns.length} classes
                        </p>
                        <div className="flex items-center gap-1">
                            <button
                                onClick={() => { setCurrentPage(p => Math.max(1, p - 1)); setSelectedRunId(null); }}
                                disabled={currentPage === 1}
                                className="px-2.5 py-1.5 text-xs border border-gray-300 dark:border-gray-600 rounded text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                            >
                                ‹ Prev
                            </button>
                            {Array.from({ length: totalPages }, (_, i) => i + 1).map(p => (
                                <button
                                    key={p}
                                    onClick={() => { setCurrentPage(p); setSelectedRunId(null); }}
                                    className={`px-2.5 py-1.5 text-xs border rounded transition-colors ${p === currentPage ? 'bg-blue-600 text-white border-blue-600' : 'border-gray-300 dark:border-gray-600 text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700'}`}
                                >
                                    {p}
                                </button>
                            ))}
                            <button
                                onClick={() => { setCurrentPage(p => Math.min(totalPages, p + 1)); setSelectedRunId(null); }}
                                disabled={currentPage === totalPages}
                                className="px-2.5 py-1.5 text-xs border border-gray-300 dark:border-gray-600 rounded text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                            >
                                Next ›
                            </button>
                        </div>
                    </div>
                )}
            </Card>
        </div>
    );
};

export const AddCourseView: React.FC = () => {
    const { setAdminPage } = useLms();
    const [form, setForm] = useState({ title: '', courseCode: '', courseType: 'Non-WSQ', tscTitle: '', tscCode: '', trainingHours: '', assessmentHours: '' });
    const [saving, setSaving] = useState(false);
    const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
    const inputClasses = 'w-full border border-gray-300 dark:border-gray-600 rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 dark:bg-gray-700 dark:text-white';

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        setSaving(true);
        setMessage(null);
        try {
            const res = await fetch('/api/admin/add-course', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(form),
            });
            const data = await res.json();
            if (!res.ok) throw new Error(data.error || 'Failed to add course');
            setMessage({ type: 'success', text: `Course "${form.title}" added successfully.` });
            setForm({ title: '', courseCode: '', courseType: 'Non-WSQ', tscTitle: '', tscCode: '', trainingHours: '', assessmentHours: '' });
        } catch (err) {
            setMessage({ type: 'error', text: err instanceof Error ? err.message : 'Failed to add course' });
        } finally {
            setSaving(false);
        }
    };

    return (
        <div>
            <div className="flex justify-between items-center mb-6">
                <h2 className="text-3xl font-bold dark:text-white">Add Course</h2>
                <Button variant="ghost" onClick={() => setAdminPage(AdminPage.ViewCourses)}>Back to Courses</Button>
            </div>
            {message && (
                <div className={`mb-4 p-3 rounded-md text-sm ${message.type === 'success' ? 'bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-700 text-green-800 dark:text-green-300' : 'bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-700 text-red-800 dark:text-red-300'}`}>
                    {message.text}
                </div>
            )}
            <Card className="p-6 dark:bg-gray-800 dark:border-gray-700">
                <form onSubmit={handleSubmit} className="space-y-4">
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                        <div>
                            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Title <span className="text-red-500">*</span></label>
                            <input type="text" required value={form.title} onChange={e => setForm(p => ({ ...p, title: e.target.value }))} className={inputClasses} placeholder="Course title" />
                        </div>
                        <div>
                            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Course Code <span className="text-red-500">*</span></label>
                            <input type="text" required value={form.courseCode} onChange={e => setForm(p => ({ ...p, courseCode: e.target.value }))} className={inputClasses} placeholder="e.g. TGS-2025054613" />
                        </div>
                        <div>
                            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Course Type</label>
                            <select value={form.courseType} onChange={e => setForm(p => ({ ...p, courseType: e.target.value }))} className={inputClasses}>
                                <option value="Non-WSQ">Non-WSQ</option>
                                <option value="WSQ">WSQ</option>
                                <option value="IBF">IBF</option>
                            </select>
                        </div>
                        <div>
                            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">TSC Title</label>
                            <input type="text" value={form.tscTitle} onChange={e => setForm(p => ({ ...p, tscTitle: e.target.value }))} className={inputClasses} placeholder="Optional" />
                        </div>
                        <div>
                            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">TSC Code</label>
                            <input type="text" value={form.tscCode} onChange={e => setForm(p => ({ ...p, tscCode: e.target.value }))} className={inputClasses} placeholder="Optional" />
                        </div>
                        <div>
                            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Training Hours</label>
                            <input type="number" min="0" step="0.5" value={form.trainingHours} onChange={e => setForm(p => ({ ...p, trainingHours: e.target.value }))} className={inputClasses} placeholder="0" />
                        </div>
                        <div>
                            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Assessment Hours</label>
                            <input type="number" min="0" step="0.5" value={form.assessmentHours} onChange={e => setForm(p => ({ ...p, assessmentHours: e.target.value }))} className={inputClasses} placeholder="0" />
                        </div>
                    </div>
                    <div className="flex justify-end">
                        <Button type="submit" disabled={saving} className="bg-blue-600 hover:bg-blue-700 text-white">
                            {saving ? 'Saving...' : 'Add Course'}
                        </Button>
                    </div>
                </form>
            </Card>
        </div>
    );
};

export const AddCourseRunView: React.FC = () => {
    const { setAdminPage } = useLms();
    const emptyForm = { courseCode: '', courseRunId: '', startDate: '', endDate: '', classStatus: 'Confirmed', digitalAttendanceId: '' };
    const [form, setForm] = useState(emptyForm);
    const [saving, setSaving] = useState(false);
    const [fetching, setFetching] = useState(false);
    const [fetchedTitle, setFetchedTitle] = useState<string | null>(null);
    const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
    const inputClasses = 'w-full border border-gray-300 dark:border-gray-600 rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 dark:bg-gray-700 dark:text-white';
    const readonlyClasses = `${inputClasses} bg-gray-50 dark:bg-gray-600 cursor-default`;

    const formatDateNum = (dateNum: number): string => {
        const s = String(dateNum);
        return `${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)}`;
    };

    const handleFetch = async () => {
        if (!form.courseRunId.trim()) {
            setMessage({ type: 'error', text: 'Please enter a Course Run ID before fetching.' });
            return;
        }
        setFetching(true);
        setFetchedTitle(null);
        setMessage(null);
        try {
            const res = await fetch(`/api/course-runs/view?courseRunId=${encodeURIComponent(form.courseRunId.trim())}`);
            if (!res.ok) throw new Error(`SSG API returned ${res.status}`);
            const json = await res.json();
            if (!json.success) throw new Error(json.error || 'Failed to fetch course run');
            // SSG response: data.course.run (run is nested inside course)
            const course = json.data?.course;
            const run = course?.run;
            if (!run) throw new Error('No course run data in SSG response');
            // Dates are numbers e.g. 20261212 → convert to YYYY-MM-DD
            const fmtDate = (v: number | undefined) =>
                v ? `${String(v).slice(0,4)}-${String(v).slice(4,6)}-${String(v).slice(6,8)}` : '';
            const startDate = fmtDate(run.courseStartDate);
            const endDate = fmtDate(run.courseEndDate);
            // Extract digital attendance ID from qrCodeLink
            const qrRaw: string = run.qrCodeLink || run.digitalClassroomLink || '';
            const digitalAttendanceId = qrRaw ? (qrRaw.split('/').pop() || '') : '';
            setForm(p => ({ ...p, startDate, endDate, digitalAttendanceId }));
            setFetchedTitle(course?.title || null);
        } catch (err) {
            setMessage({ type: 'error', text: 'Failed to fetch course run from SSG: ' + (err instanceof Error ? err.message : 'Unknown error') });
        } finally {
            setFetching(false);
        }
    };

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        setSaving(true);
        setMessage(null);
        try {
            const res = await fetch('/api/admin/add-course-run', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(form),
            });
            const data = await res.json();
            if (!res.ok) throw new Error(data.error || 'Failed to add course run');
            setMessage({ type: 'success', text: `Course run "${form.courseRunId}" added successfully.` });
            setForm(emptyForm);
            setFetchedTitle(null);
        } catch (err) {
            setMessage({ type: 'error', text: err instanceof Error ? err.message : 'Failed to add course run' });
        } finally {
            setSaving(false);
        }
    };

    return (
        <div>
            <div className="flex justify-between items-center mb-6">
                <h2 className="text-3xl font-bold dark:text-white">Add Course Run</h2>
                <Button variant="ghost" onClick={() => setAdminPage(AdminPage.ViewCourses)}>Back to Courses</Button>
            </div>
            {message && (
                <div className={`mb-4 p-3 rounded-md text-sm ${message.type === 'success' ? 'bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-700 text-green-800 dark:text-green-300' : 'bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-700 text-red-800 dark:text-red-300'}`}>
                    {message.text}
                </div>
            )}
            <Card className="p-6 dark:bg-gray-800 dark:border-gray-700">
                <form onSubmit={handleSubmit} className="space-y-4">
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                        <div>
                            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Course Code <span className="text-red-500">*</span></label>
                            <input type="text" required value={form.courseCode} onChange={e => setForm(p => ({ ...p, courseCode: e.target.value }))} className={inputClasses} placeholder="e.g. TGS-2025054613" />
                        </div>
                        <div>
                            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Course Run ID <span className="text-red-500">*</span></label>
                            <div className="flex gap-2">
                                <input type="text" required value={form.courseRunId} onChange={e => { setForm(p => ({ ...p, courseRunId: e.target.value })); setFetchedTitle(null); }} className={inputClasses} placeholder="e.g. 1293908" />
                                <Button type="button" onClick={handleFetch} disabled={fetching} className="shrink-0 bg-blue-600 hover:bg-blue-700 text-white text-sm px-3">
                                    {fetching ? 'Fetching...' : 'Fetch'}
                                </Button>
                            </div>
                        </div>
                    </div>
                    {fetchedTitle && (
                        <div className="p-3 bg-blue-50 dark:bg-blue-900/30 border border-blue-200 dark:border-blue-700 rounded-md text-sm text-blue-800 dark:text-blue-200">
                            <span className="font-medium">Fetched:</span> {fetchedTitle}
                        </div>
                    )}
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                        <div>
                            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Start Date</label>
                            <input type="date" readOnly value={form.startDate} className={readonlyClasses} />
                        </div>
                        <div>
                            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">End Date</label>
                            <input type="date" readOnly value={form.endDate} className={readonlyClasses} />
                        </div>
                        <div>
                            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Digital Attendance ID</label>
                            <input type="text" readOnly value={form.digitalAttendanceId} className={readonlyClasses} placeholder="Auto-filled from fetch" />
                        </div>
                        <div>
                            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Class Status</label>
                            <select value={form.classStatus} onChange={e => setForm(p => ({ ...p, classStatus: e.target.value }))} className={inputClasses}>
                                <option value="Confirmed">Confirmed</option>
                                <option value="Pending">Pending</option>
                                <option value="Cancelled">Cancelled</option>
                            </select>
                        </div>
                    </div>
                    <div className="flex justify-end">
                        <Button type="submit" disabled={saving || !fetchedTitle} className="bg-indigo-600 hover:bg-indigo-700 text-white disabled:opacity-50">
                            {saving ? 'Saving...' : 'Add Course Run'}
                        </Button>
                    </div>
                </form>
            </Card>
        </div>
    );
};

// ─── Automation Logging ──────────────────────────────────────────────────────

interface AutomationLogRow {
    id: number;
    run_id: string;
    created_at: string;
    course_run_id: string;
    course_title: string;
    course_code: string | null;
    start_date: string | null;
    end_date: string | null;
    status: 'success' | 'partial' | 'error' | 'pending';
    total_enrolled: number;
    created_count: number;
    existing_count: number;
    error_count: number;
    details: { enrolmentRef?: string | null; email: string; name?: string; status: string; accountExists?: boolean; reason?: string }[] | null;
    error_message: string | null;
}

interface AutomationBatch {
    run_id: string;
    created_at: string;
    rows: AutomationLogRow[];
    total_enrolled: number;
    created_count: number;
    existing_count: number;
    error_count: number;
    overallStatus: AutomationLogRow['status'];
}

export const AutomationLogsView: React.FC = () => {
    const { setAdminPage } = useLms();
    const [logs, setLogs] = useState<AutomationLogRow[]>([]);
    const [loading, setLoading] = useState(false);
    const [running, setRunning] = useState(false);
    const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
    const [expandedBatch, setExpandedBatch] = useState<string | null>(null);

    const fetchLogs = async () => {
        setLoading(true);
        try {
            const res = await fetch('/api/admin/automation-logs?limit=500');
            const json = await res.json();
            if (json.success) setLogs(json.data);
        } catch {
            /* silent */
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => { fetchLogs(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

    const handleRunNow = async () => {
        setRunning(true);
        setMessage(null);
        try {
            const res = await fetch('/api/admin/trigger-automation', { method: 'POST' });
            const json = await res.json();
            if (json.success) {
                setMessage({ type: 'success', text: `Run completed — ${json.processed} course run(s) processed.` });
                await fetchLogs();
            } else {
                setMessage({ type: 'error', text: json.message || 'Run failed' });
            }
        } catch (err) {
            setMessage({ type: 'error', text: err instanceof Error ? err.message : 'Request failed' });
        } finally {
            setRunning(false);
        }
    };

    // Group logs by run_id, newest batch first
    const batches: AutomationBatch[] = React.useMemo(() => {
        const map = new Map<string, AutomationLogRow[]>();
        for (const log of logs) {
            if (!map.has(log.run_id)) map.set(log.run_id, []);
            map.get(log.run_id)!.push(log);
        }
        return Array.from(map.entries()).map(([run_id, rows]) => {
            const total_enrolled = rows.reduce((s, r) => s + r.total_enrolled, 0);
            const created_count = rows.reduce((s, r) => s + r.created_count, 0);
            const existing_count = rows.reduce((s, r) => s + r.existing_count, 0);
            const error_count = rows.reduce((s, r) => s + r.error_count, 0);
            const hasError = rows.some(r => r.status === 'error');
            const hasPartial = rows.some(r => r.status === 'partial');
            const overallStatus: AutomationLogRow['status'] = hasError ? 'error' : hasPartial ? 'partial' : 'success';
            return { run_id, created_at: rows[0].created_at, rows, total_enrolled, created_count, existing_count, error_count, overallStatus };
        });
    }, [logs]);

    const statusBadge = (status: AutomationLogRow['status']) => {
        const map: Record<string, string> = {
            success: 'bg-green-100 text-green-800 dark:bg-green-900/40 dark:text-green-300',
            partial: 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900/40 dark:text-yellow-300',
            error: 'bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-300',
            pending: 'bg-gray-100 text-gray-700 dark:bg-gray-700 dark:text-gray-300',
        };
        return (
            <span className={`inline-block px-2 py-0.5 rounded text-xs font-semibold ${map[status] ?? map.pending}`}>
                {status}
            </span>
        );
    };

    return (
        <div>
            <div className="flex flex-wrap items-center justify-between gap-3 mb-6">
                <h2 className="text-3xl font-bold">Automation Logging</h2>
                <div className="flex items-center gap-2">
                    <Button variant="ghost" onClick={fetchLogs} disabled={loading}>
                        {loading ? 'Refreshing…' : 'Refresh'}
                    </Button>
                    <Button
                        onClick={handleRunNow}
                        disabled={running}
                        className="bg-indigo-600 hover:bg-indigo-700 text-white disabled:opacity-50"
                    >
                        {running ? 'Running…' : 'Run Now'}
                    </Button>
                    <Button variant="ghost" onClick={() => setAdminPage(AdminPage.Dashboard)}>
                        Back
                    </Button>
                </div>
            </div>

            <p className="text-sm text-gray-500 dark:text-gray-400 mb-4">
                Daily automation (6 PM SGT): searches SSG enrollments for classes starting tomorrow and auto-creates learner accounts.
                Use <strong>Run Now</strong> to trigger manually.
            </p>

            {message && (
                <div className={`mb-4 px-4 py-3 rounded-lg text-sm font-medium ${
                    message.type === 'success'
                        ? 'bg-green-50 text-green-800 border border-green-200 dark:bg-green-900/20 dark:text-green-300 dark:border-green-800'
                        : 'bg-red-50 text-red-800 border border-red-200 dark:bg-red-900/20 dark:text-red-300 dark:border-red-800'
                }`}>
                    {message.text}
                </div>
            )}

            {loading ? (
                <div className="text-center py-12 text-gray-400">Loading logs…</div>
            ) : batches.length === 0 ? (
                <Card className="p-8 text-center text-gray-500 dark:text-gray-400">
                    No automation runs yet. Click <strong>Run Now</strong> to trigger the first run.
                </Card>
            ) : (
                <div className="space-y-3">
                    {batches.map(batch => (
                        <Card key={batch.run_id} className="overflow-hidden">
                            {/* Batch header row */}
                            <button
                                className="w-full text-left px-5 py-4 flex flex-wrap items-center gap-3 hover:bg-gray-50 dark:hover:bg-gray-800/40 transition-colors"
                                onClick={() => setExpandedBatch(expandedBatch === batch.run_id ? null : batch.run_id)}
                            >
                                <div className="flex items-center gap-3 min-w-0">
                                    <span className="text-sm font-medium text-gray-700 dark:text-gray-200 whitespace-nowrap">
                                        {new Date(batch.created_at).toLocaleString('en-SG', {
                                            day: '2-digit', month: 'short', year: 'numeric',
                                            hour: '2-digit', minute: '2-digit', hour12: false,
                                        })}
                                    </span>
                                    <span className="text-xs text-gray-400 dark:text-gray-500 font-mono bg-gray-100 dark:bg-gray-800 px-2 py-0.5 rounded hidden sm:inline">
                                        {batch.run_id}
                                    </span>
                                </div>
                                <div className="ml-auto flex items-center gap-3 flex-wrap justify-end">
                                    {statusBadge(batch.overallStatus)}
                                    <span className="text-xs text-gray-400 dark:text-gray-500">{batch.rows.length} run{batch.rows.length !== 1 ? 's' : ''}</span>
                                    <div className="flex items-center gap-2 text-sm">
                                        <span className="text-gray-600 dark:text-gray-300 font-semibold">{batch.total_enrolled}</span>
                                        <span className="text-gray-400 text-xs">enrolled</span>
                                    </div>
                                    <div className="flex items-center gap-1.5 text-sm">
                                        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-emerald-50 dark:bg-emerald-900/30 text-emerald-700 dark:text-emerald-300 text-xs font-semibold">✓ {batch.created_count} new</span>
                                        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-blue-50 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300 text-xs font-semibold">↩ {batch.existing_count} existing</span>
                                        {batch.error_count > 0 && (
                                            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-red-50 dark:bg-red-900/30 text-red-700 dark:text-red-300 text-xs font-semibold">✕ {batch.error_count} errors</span>
                                        )}
                                    </div>
                                    <span className="text-gray-400 text-xs ml-1">{expandedBatch === batch.run_id ? '▲' : '▼'}</span>
                                </div>
                            </button>

                            {/* Expanded: per-course-run table */}
                            {expandedBatch === batch.run_id && (
                                <div className="border-t border-gray-100 dark:border-gray-700">
                                    <table className="w-full text-sm">
                                        <thead className="bg-gray-50 dark:bg-gray-800/80 text-left">
                                            <tr>
                                                <th className="px-4 py-2.5 font-semibold text-xs uppercase tracking-wide text-gray-500 dark:text-gray-400">Course Title</th>
                                                <th className="px-4 py-2.5 font-semibold text-xs uppercase tracking-wide text-gray-500 dark:text-gray-400">Course Code</th>
                                                <th className="px-4 py-2.5 font-semibold text-xs uppercase tracking-wide text-gray-500 dark:text-gray-400">SSG Run ID</th>
                                                <th className="px-4 py-2.5 font-semibold text-xs uppercase tracking-wide text-gray-500 dark:text-gray-400">Start Date</th>
                                                <th className="px-4 py-2.5 font-semibold text-xs uppercase tracking-wide text-gray-500 dark:text-gray-400">End Date</th>
                                                <th className="px-4 py-2.5 font-semibold text-xs uppercase tracking-wide text-gray-500 dark:text-gray-400 text-center">Status</th>
                                                <th className="px-4 py-2.5 font-semibold text-xs uppercase tracking-wide text-gray-500 dark:text-gray-400 text-center">Enrolled</th>
                                                <th className="px-4 py-2.5 font-semibold text-xs uppercase tracking-wide text-gray-500 dark:text-gray-400 text-center">Created</th>
                                                <th className="px-4 py-2.5 font-semibold text-xs uppercase tracking-wide text-gray-500 dark:text-gray-400 text-center">Existing</th>
                                                <th className="px-4 py-2.5 font-semibold text-xs uppercase tracking-wide text-gray-500 dark:text-gray-400 text-center">Errors</th>
                                            </tr>
                                        </thead>
                                        <tbody>
                                            {batch.rows.map(log => (
                                                <React.Fragment key={log.id}>
                                                    <tr className="border-t border-gray-100 dark:border-gray-700/60 hover:bg-gray-50 dark:hover:bg-gray-800/30 transition-colors">
                                                        <td className="px-4 py-3 max-w-[220px]">
                                                            <div className="font-medium text-gray-900 dark:text-gray-100 truncate">{log.course_title || '—'}</div>
                                                        </td>
                                                        <td className="px-4 py-3">
                                                            <span className="text-xs text-indigo-600 dark:text-indigo-400 font-mono bg-indigo-50 dark:bg-indigo-900/30 px-1.5 py-0.5 rounded">
                                                                {log.course_code || '—'}
                                                            </span>
                                                        </td>
                                                        <td className="px-4 py-3">
                                                            <span className="text-xs text-gray-500 dark:text-gray-400 font-mono bg-gray-100 dark:bg-gray-800 px-1.5 py-0.5 rounded">
                                                                {log.course_run_id || '—'}
                                                            </span>
                                                            {log.error_message && (
                                                                <span className="text-red-500 ml-1.5 text-xs" title={log.error_message}>⚠ {log.error_message.slice(0, 40)}{log.error_message.length > 40 ? '…' : ''}</span>
                                                            )}
                                                        </td>
                                                        <td className="px-4 py-3 text-xs text-gray-500 dark:text-gray-400 whitespace-nowrap">
                                                            {log.start_date ? new Date(log.start_date).toLocaleDateString('en-SG', { day: '2-digit', month: 'short', year: 'numeric' }) : '—'}
                                                        </td>
                                                        <td className="px-4 py-3 text-xs text-gray-500 dark:text-gray-400 whitespace-nowrap">
                                                            {log.end_date ? new Date(log.end_date).toLocaleDateString('en-SG', { day: '2-digit', month: 'short', year: 'numeric' }) : '—'}
                                                        </td>
                                                        <td className="px-4 py-3 text-center">{statusBadge(log.status)}</td>
                                                        <td className="px-4 py-3 text-center font-semibold text-gray-700 dark:text-gray-300">{log.total_enrolled}</td>
                                                        <td className="px-4 py-3 text-center">
                                                            <span className="font-semibold text-emerald-600 dark:text-emerald-400">{log.created_count}</span>
                                                        </td>
                                                        <td className="px-4 py-3 text-center">
                                                            <span className="font-semibold text-blue-600 dark:text-blue-400">{log.existing_count}</span>
                                                        </td>
                                                        <td className="px-4 py-3 text-center">
                                                            <span className={`font-semibold ${log.error_count > 0 ? 'text-red-600 dark:text-red-400' : 'text-gray-400'}`}>{log.error_count}</span>
                                                        </td>
                                                    </tr>
                                                    {/* Learner rows — always shown when there are details */}
                                                    {log.details && log.details.length > 0 && (
                                                        <tr key={`${log.id}-detail`}>
                                                            <td colSpan={10} className="px-5 pb-4 pt-1 bg-gray-50/80 dark:bg-gray-900/40">
                                                                <div className="rounded-lg border border-gray-200 dark:border-gray-700 overflow-hidden">
                                                                    <table className="w-full text-xs">
                                                                        <thead className="bg-gray-100 dark:bg-gray-800">
                                                                            <tr>
                                                                                <th className="px-3 py-2 text-left font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide text-[10px]">Enrolment ID</th>
                                                                                <th className="px-3 py-2 text-left font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide text-[10px]">Email</th>
                                                                                <th className="px-3 py-2 text-left font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide text-[10px]">Name</th>
                                                                                <th className="px-3 py-2 text-left font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide text-[10px]">Account</th>
                                                                                <th className="px-3 py-2 text-left font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide text-[10px]">Result</th>
                                                                                <th className="px-3 py-2 text-left font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide text-[10px]">Reason</th>
                                                                            </tr>
                                                                        </thead>
                                                                        <tbody className="divide-y divide-gray-100 dark:divide-gray-700/60">
                                                                            {log.details.map((d, i) => (
                                                                                <tr key={i} className={`transition-colors ${
                                                                                    d.status === 'error'     ? 'bg-red-50/60 dark:bg-red-900/10' :
                                                                                    d.status === 'created'   ? 'bg-emerald-50/40 dark:bg-emerald-900/10' :
                                                                                    d.status === 'cancelled' ? 'bg-orange-50/40 dark:bg-orange-900/10' :
                                                                                    'hover:bg-white dark:hover:bg-gray-800/50'
                                                                                }`}>
                                                                                    <td className="px-3 py-2 font-mono text-gray-400 dark:text-gray-500">{d.enrolmentRef || '—'}</td>
                                                                                    <td className="px-3 py-2 font-mono text-gray-700 dark:text-gray-300">{d.email}</td>
                                                                                    <td className="px-3 py-2 text-gray-700 dark:text-gray-300">{d.name || '—'}</td>
                                                                                    <td className="px-3 py-2">
                                                                                        {d.accountExists === undefined ? (
                                                                                            <span className="text-gray-400 text-[10px]">—</span>
                                                                                        ) : d.accountExists ? (
                                                                                            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold bg-gray-100 text-gray-600 dark:bg-gray-700 dark:text-gray-300">✓ Exists</span>
                                                                                        ) : (
                                                                                            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold bg-yellow-100 text-yellow-700 dark:bg-yellow-900/40 dark:text-yellow-300">✕ Not Found</span>
                                                                                        )}
                                                                                    </td>
                                                                                    <td className="px-3 py-2">
                                                                                        <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold ${
                                                                                            d.status === 'created'   ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300' :
                                                                                            d.status === 'existing'  ? 'bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300' :
                                                                                            d.status === 'cancelled' ? 'bg-orange-100 text-orange-700 dark:bg-orange-900/40 dark:text-orange-300' :
                                                                                            d.status === 'error'     ? 'bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300' :
                                                                                            'bg-gray-100 text-gray-600 dark:bg-gray-700 dark:text-gray-400'
                                                                                        }`}>
                                                                                            {d.status === 'created' ? '✓' : d.status === 'existing' ? '↩' : d.status === 'cancelled' ? '⊘' : d.status === 'error' ? '✕' : ''}
                                                                                            {d.status}
                                                                                        </span>
                                                                                    </td>
                                                                                    <td className="px-3 py-2 text-gray-500 dark:text-gray-400 max-w-[300px]">
                                                                                        {d.reason ? (
                                                                                            <span className="text-red-500 dark:text-red-400">{d.reason}</span>
                                                                                        ) : '—'}
                                                                                    </td>
                                                                                </tr>
                                                                            ))}
                                                                        </tbody>
                                                                    </table>
                                                                </div>
                                                            </td>
                                                        </tr>
                                                    )}
                                                </React.Fragment>
                                            ))}
                                        </tbody>
                                    </table>
                                </div>
                            )}
                        </Card>
                    ))}
                </div>
            )}
        </div>
    );
};

// ── Backfill Enrollments ──────────────────────────────────────────────────────

interface BackfillPreviewRow {
    id: string;
    enrolment_id: string;
    enrolment_status: string | null;
    email: string | null;
    nric: string | null;
    created_at: string;
    ssg_run_id: string | null;
    course_title: string | null;
    course_code: string | null;
}

export const BackfillEnrollmentsView: React.FC = () => {
    const { setAdminPage } = useLms();
    const [preview, setPreview] = useState<BackfillPreviewRow[]>([]);
    const [previewing, setPreviewing] = useState(false);
    const [running, setRunning] = useState(false);
    const [runResult, setRunResult] = useState<any>(null);
    const [limit, setLimit] = useState(50);
    const [error, setError] = useState<string | null>(null);

    const fetchPreview = async () => {
        setPreviewing(true);
        setError(null);
        setRunResult(null);
        try {
            const res  = await fetch(`/api/admin/backfill-enrollments?limit=${limit}`);
            const json = await res.json();
            if (json.success) {
                setPreview(json.enrollments ?? []);
            } else {
                setError(json.error ?? 'Preview failed');
            }
        } catch (e) {
            setError(e instanceof Error ? e.message : 'Network error');
        } finally {
            setPreviewing(false);
        }
    };

    const runBackfill = async () => {
        if (!window.confirm(`This will call the SSG webhook for up to ${preview.length} enrollment(s), 4 seconds apart. Proceed?`)) return;
        setRunning(true);
        setError(null);
        setRunResult(null);
        try {
            const res  = await fetch(`/api/admin/backfill-enrollments?limit=${limit}`, {
                method: 'POST',
            });
            const json = await res.json();
            if (json.success) {
                setRunResult(json);
                setPreview([]); // clear preview after run
            } else {
                setError(json.error ?? 'Backfill failed');
            }
        } catch (e) {
            setError(e instanceof Error ? e.message : 'Network error');
        } finally {
            setRunning(false);
        }
    };

    return (
        <div className="max-w-5xl">
            <div className="flex flex-wrap items-center justify-between gap-3 mb-6">
                <h2 className="text-3xl font-bold">Backfill Enrollments</h2>
                <Button variant="ghost" onClick={() => setAdminPage(AdminPage.Dashboard)}>Back</Button>
            </div>

            <p className="text-sm text-gray-500 dark:text-gray-400 mb-6">
                Finds enrollments with a missing <code className="bg-gray-100 dark:bg-gray-800 px-1 rounded">raw_data</code> field and fetches the full SSG data for each one.
                Preview first to verify, then run the backfill.
            </p>

            {/* Controls */}
            <Card className="p-5 mb-6">
                <div className="flex flex-wrap items-end gap-4">
                    <div>
                        <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Limit</label>
                        <input
                            type="number"
                            min={1} max={200}
                            value={limit}
                            onChange={e => setLimit(Math.min(200, Math.max(1, Number(e.target.value))))}
                            className="w-24 px-3 py-2 text-sm border border-gray-300 dark:border-gray-600 rounded-md bg-white dark:bg-slate-800 text-gray-900 dark:text-white"
                        />
                    </div>
                    <Button onClick={fetchPreview} disabled={previewing || running} variant="secondary">
                        {previewing ? 'Fetching preview…' : 'Fetch Preview'}
                    </Button>
                    {preview.length > 0 && (
                        <Button onClick={runBackfill} disabled={running || previewing} className="bg-blue-600 hover:bg-blue-700 text-white">
                            {running ? 'Running…' : `Run Backfill (${preview.length})`}
                        </Button>
                    )}
                </div>
                <p className="text-xs text-gray-400 dark:text-gray-500 mt-3">
                    Note: Backfill calls the SSG webhook once per enrollment with a 4-second delay between each call.
                </p>
            </Card>

            {/* Error */}
            {error && (
                <div className="mb-4 p-4 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg text-sm text-red-700 dark:text-red-300">
                    {error}
                </div>
            )}

            {/* Run result summary */}
            {runResult && (
                <Card className="p-5 mb-6">
                    <h3 className="font-semibold text-gray-900 dark:text-white mb-3">Backfill Complete</h3>
                    <div className="flex flex-wrap gap-4 mb-4 text-sm">
                        <span className="px-3 py-1 rounded-full bg-gray-100 dark:bg-gray-800 text-gray-700 dark:text-gray-300">Total: <strong>{runResult.total}</strong></span>
                        <span className="px-3 py-1 rounded-full bg-emerald-100 dark:bg-emerald-900/40 text-emerald-700 dark:text-emerald-300">Updated: <strong>{runResult.updated}</strong></span>
                        <span className="px-3 py-1 rounded-full bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-400">Skipped: <strong>{runResult.skipped}</strong></span>
                        <span className="px-3 py-1 rounded-full bg-red-100 dark:bg-red-900/40 text-red-700 dark:text-red-300">Errors: <strong>{runResult.errors}</strong></span>
                    </div>
                    <div className="overflow-x-auto">
                        <table className="w-full text-sm">
                            <thead className="bg-gray-50 dark:bg-gray-800 text-left">
                                <tr>
                                    <th className="px-4 py-2 font-semibold text-xs uppercase tracking-wide text-gray-500 dark:text-gray-400">Enrolment ID</th>
                                    <th className="px-4 py-2 font-semibold text-xs uppercase tracking-wide text-gray-500 dark:text-gray-400">SSG Status</th>
                                    <th className="px-4 py-2 font-semibold text-xs uppercase tracking-wide text-gray-500 dark:text-gray-400">Result</th>
                                    <th className="px-4 py-2 font-semibold text-xs uppercase tracking-wide text-gray-500 dark:text-gray-400">Detail</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-gray-100 dark:divide-gray-700">
                                {(runResult.results ?? []).map((r: any, i: number) => (
                                    <tr key={i} className="hover:bg-gray-50 dark:hover:bg-gray-800/50">
                                        <td className="px-4 py-2 font-mono text-xs text-gray-700 dark:text-gray-300">{r.enrolmentId}</td>
                                        <td className="px-4 py-2 text-xs text-gray-500 dark:text-gray-400">{r.status}</td>
                                        <td className="px-4 py-2">
                                            <span className={`inline-flex px-2 py-0.5 rounded-full text-xs font-semibold ${
                                                r.result === 'updated' ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300'
                                                : r.result === 'skipped' ? 'bg-gray-100 text-gray-600 dark:bg-gray-700 dark:text-gray-400'
                                                : 'bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300'
                                            }`}>{r.result}</span>
                                        </td>
                                        <td className="px-4 py-2 text-xs text-gray-500 dark:text-gray-400">{r.detail ?? '—'}</td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                </Card>
            )}

            {/* Preview table */}
            {preview.length > 0 && !runResult && (
                <Card className="overflow-hidden">
                    <div className="px-5 py-3 border-b border-gray-100 dark:border-gray-700 flex items-center justify-between">
                        <span className="font-semibold text-gray-900 dark:text-white">{preview.length} enrollment{preview.length !== 1 ? 's' : ''} missing raw data</span>
                        <span className="text-xs text-amber-600 dark:text-amber-400 font-medium">Review below, then click Run Backfill</span>
                    </div>
                    <div className="overflow-x-auto">
                        <table className="w-full text-sm">
                            <thead className="bg-gray-50 dark:bg-gray-800 text-left">
                                <tr>
                                    <th className="px-4 py-2.5 font-semibold text-xs uppercase tracking-wide text-gray-500 dark:text-gray-400">Enrolment ID</th>
                                    <th className="px-4 py-2.5 font-semibold text-xs uppercase tracking-wide text-gray-500 dark:text-gray-400">Course</th>
                                    <th className="px-4 py-2.5 font-semibold text-xs uppercase tracking-wide text-gray-500 dark:text-gray-400">Course Run ID</th>
                                    <th className="px-4 py-2.5 font-semibold text-xs uppercase tracking-wide text-gray-500 dark:text-gray-400">Email</th>
                                    <th className="px-4 py-2.5 font-semibold text-xs uppercase tracking-wide text-gray-500 dark:text-gray-400">NRIC</th>
                                    <th className="px-4 py-2.5 font-semibold text-xs uppercase tracking-wide text-gray-500 dark:text-gray-400">Status</th>
                                    <th className="px-4 py-2.5 font-semibold text-xs uppercase tracking-wide text-gray-500 dark:text-gray-400">Created</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-gray-100 dark:divide-gray-700">
                                {preview.map(row => (
                                    <tr key={row.id} className="hover:bg-gray-50 dark:hover:bg-gray-800/50">
                                        <td className="px-4 py-3 font-mono text-xs text-indigo-600 dark:text-indigo-400">{row.enrolment_id}</td>
                                        <td className="px-4 py-3 max-w-[200px]">
                                            <div className="font-medium text-gray-900 dark:text-gray-100 text-xs whitespace-normal">{row.course_title || '—'}</div>
                                            {row.course_code && <span className="text-xs text-gray-400 font-mono">{row.course_code}</span>}
                                        </td>
                                        <td className="px-4 py-3 font-mono text-xs text-gray-500 dark:text-gray-400">{row.ssg_run_id || '—'}</td>
                                        <td className="px-4 py-3 text-xs text-gray-500 dark:text-gray-400">{row.email || '—'}</td>
                                        <td className="px-4 py-3 text-xs font-mono text-gray-500 dark:text-gray-400">{row.nric || '—'}</td>
                                        <td className="px-4 py-3 text-xs text-gray-500 dark:text-gray-400">{row.enrolment_status || '—'}</td>
                                        <td className="px-4 py-3 text-xs text-gray-500 dark:text-gray-400 whitespace-nowrap">
                                            {new Date(row.created_at).toLocaleDateString('en-SG', { day: '2-digit', month: 'short', year: 'numeric' })}
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                </Card>
            )}

            {preview.length === 0 && !previewing && !runResult && !error && (
                <Card className="p-8 text-center text-gray-500 dark:text-gray-400">
                    Click <strong>Fetch Preview</strong> to see which enrollments are missing raw data.
                </Card>
            )}
        </div>
    );
};

// ─────────────────────────────────────────────────────────────────────────────
// Fetch Upcoming Classes Enrolment
// ─────────────────────────────────────────────────────────────────────────────

interface UpcomingCourseRunPreview {
    uuid: string;
    ssg_run_id: string;
    course_title: string;
    course_code: string;
    start_date: string;
    end_date: string;
    class_status: string;
    enrolment_count: string;
}

interface FetchUpcomingRunResult {
    ssgRunId: string;
    courseTitle: string;
    enrollmentsInserted: number;
    enrollmentsSkipped: number;
    dateFixed: boolean;
    dateMismatch?: string;
    error?: string;
}

export const FetchUpcomingEnrolmentsView: React.FC = () => {
    const { setAdminPage } = useLms();
    const [preview, setPreview] = useState<UpcomingCourseRunPreview[]>([]);
    const [previewing, setPreviewing] = useState(false);
    const [running, setRunning] = useState(false);
    const [runResult, setRunResult] = useState<any>(null);
    const [limit, setLimit] = useState(20);
    const [error, setError] = useState<string | null>(null);

    const fetchPreview = async () => {
        setPreviewing(true);
        setError(null);
        setRunResult(null);
        try {
            const res = await fetch(`/api/admin/fetch-upcoming-enrolments?limit=${limit}`);
            const json = await res.json();
            if (json.success) {
                setPreview(json.courseRuns ?? []);
            } else {
                setError(json.error ?? 'Preview failed');
            }
        } catch (e) {
            setError(e instanceof Error ? e.message : 'Network error');
        } finally {
            setPreviewing(false);
        }
    };

    const runFetch = async () => {
        if (!window.confirm(`This will call the SSG webhook for up to ${preview.length} course run(s), 4 seconds apart. Proceed?`)) return;
        setRunning(true);
        setError(null);
        setRunResult(null);
        try {
            const res = await fetch(`/api/admin/fetch-upcoming-enrolments?limit=${limit}`, { method: 'POST' });
            const json = await res.json();
            if (json.success) {
                setRunResult(json);
                setPreview([]);
            } else {
                setError(json.error ?? 'Fetch failed');
            }
        } catch (e) {
            setError(e instanceof Error ? e.message : 'Network error');
        } finally {
            setRunning(false);
        }
    };

    const fmt = (d: string) => {
        if (!d) return '—';
        const date = new Date(d);
        const day = String(date.getDate()).padStart(2, '0');
        const month = String(date.getMonth() + 1).padStart(2, '0');
        const year = date.getFullYear();
        return `${day}/${month}/${year}`;
    };

    return (
        <div className="max-w-5xl">
            <div className="flex flex-wrap items-center justify-between gap-3 mb-6">
                <h2 className="text-3xl font-bold">Fetch Upcoming Classes Enrolment</h2>
                <Button variant="ghost" onClick={() => setAdminPage(AdminPage.Dashboard)}>Back</Button>
            </div>

            <p className="text-sm text-gray-500 dark:text-gray-400 mb-6">
                For each upcoming course run, calls the SSG view-enrolment webhook, upserts all returned enrolments into the database, and corrects any mismatched start/end dates.
                Preview first to verify, then run.
            </p>

            {/* Controls */}
            <Card className="p-5 mb-6">
                <div className="flex flex-wrap items-end gap-4">
                    <div>
                        <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Limit</label>
                        <input
                            type="number"
                            min={1} max={100}
                            value={limit}
                            onChange={e => setLimit(Math.min(100, Math.max(1, Number(e.target.value))))}
                            className="w-24 px-3 py-2 text-sm border border-gray-300 dark:border-gray-600 rounded-md bg-white dark:bg-slate-800 text-gray-900 dark:text-white"
                        />
                    </div>
                    <Button onClick={fetchPreview} disabled={previewing || running} variant="secondary">
                        {previewing ? 'Fetching preview…' : 'Fetch Preview'}
                    </Button>
                    {preview.length > 0 && (
                        <Button onClick={runFetch} disabled={running || previewing} className="bg-blue-600 hover:bg-blue-700 text-white">
                            {running ? 'Running…' : `Run Fetch (${preview.length} runs)`}
                        </Button>
                    )}
                </div>
                <p className="text-xs text-gray-400 dark:text-gray-500 mt-3">
                    Note: Calls the SSG webhook once per course run with a 4-second delay between each call.
                </p>
            </Card>

            {/* Error */}
            {error && (
                <div className="mb-4 p-4 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg text-sm text-red-700 dark:text-red-300">
                    {error}
                </div>
            )}

            {/* Run result summary */}
            {runResult && (
                <Card className="p-5 mb-6">
                    <h3 className="font-semibold text-gray-900 dark:text-white mb-3">Fetch Complete</h3>
                    <p className="text-sm text-gray-500 dark:text-gray-400 mb-4">{runResult.message}</p>
                    <div className="flex flex-wrap gap-4 mb-4 text-sm">
                        <span className="px-3 py-1 rounded-full bg-gray-100 dark:bg-gray-800 text-gray-700 dark:text-gray-300">Runs: <strong>{runResult.total}</strong></span>
                        <span className="px-3 py-1 rounded-full bg-emerald-100 dark:bg-emerald-900/40 text-emerald-700 dark:text-emerald-300">Inserted: <strong>{runResult.totalInserted}</strong></span>
                        <span className="px-3 py-1 rounded-full bg-blue-100 dark:bg-blue-900/40 text-blue-700 dark:text-blue-300">Dates Fixed: <strong>{runResult.totalFixed}</strong></span>
                        <span className="px-3 py-1 rounded-full bg-red-100 dark:bg-red-900/40 text-red-700 dark:text-red-300">Errors: <strong>{runResult.totalErrors}</strong></span>
                    </div>
                    <div className="overflow-x-auto">
                        <table className="w-full text-sm">
                            <thead className="bg-gray-50 dark:bg-gray-800 text-left">
                                <tr>
                                    <th className="px-4 py-2 font-semibold text-xs uppercase tracking-wide text-gray-500 dark:text-gray-400">Course Run ID</th>
                                    <th className="px-4 py-2 font-semibold text-xs uppercase tracking-wide text-gray-500 dark:text-gray-400">Course</th>
                                    <th className="px-4 py-2 font-semibold text-xs uppercase tracking-wide text-gray-500 dark:text-gray-400">Inserted</th>
                                    <th className="px-4 py-2 font-semibold text-xs uppercase tracking-wide text-gray-500 dark:text-gray-400">Skipped</th>
                                    <th className="px-4 py-2 font-semibold text-xs uppercase tracking-wide text-gray-500 dark:text-gray-400">Date Fix</th>
                                    <th className="px-4 py-2 font-semibold text-xs uppercase tracking-wide text-gray-500 dark:text-gray-400">Detail</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-gray-100 dark:divide-gray-700">
                                {(runResult.results ?? []).map((r: FetchUpcomingRunResult, i: number) => (
                                    <tr key={i} className="hover:bg-gray-50 dark:hover:bg-gray-800/50">
                                        <td className="px-4 py-2 font-mono text-xs text-indigo-600 dark:text-indigo-400">{r.ssgRunId}</td>
                                        <td className="px-4 py-2 text-xs text-gray-700 dark:text-gray-300 max-w-[180px] whitespace-normal">{r.courseTitle}</td>
                                        <td className="px-4 py-2 text-xs text-center">
                                            <span className="px-2 py-0.5 rounded-full bg-emerald-100 dark:bg-emerald-900/40 text-emerald-700 dark:text-emerald-300 font-semibold">{r.enrollmentsInserted}</span>
                                        </td>
                                        <td className="px-4 py-2 text-xs text-center text-gray-500 dark:text-gray-400">{r.enrollmentsSkipped}</td>
                                        <td className="px-4 py-2 text-xs text-center">
                                            {r.dateFixed
                                                ? <span className="px-2 py-0.5 rounded-full bg-blue-100 dark:bg-blue-900/40 text-blue-700 dark:text-blue-300 font-semibold">Fixed</span>
                                                : <span className="text-gray-400">—</span>
                                            }
                                        </td>
                                        <td className="px-4 py-2 text-xs text-gray-500 dark:text-gray-400">
                                            {r.error
                                                ? <span className="text-red-600 dark:text-red-400">{r.error}</span>
                                                : r.dateMismatch
                                                    ? <span className="text-blue-600 dark:text-blue-400">{r.dateMismatch}</span>
                                                    : '—'
                                            }
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                </Card>
            )}

            {/* Preview table */}
            {preview.length > 0 && !runResult && (
                <Card className="overflow-hidden">
                    <div className="px-5 py-3 border-b border-gray-100 dark:border-gray-700 flex items-center justify-between">
                        <span className="font-semibold text-gray-900 dark:text-white">{preview.length} upcoming course run{preview.length !== 1 ? 's' : ''}</span>
                        <span className="text-xs text-amber-600 dark:text-amber-400 font-medium">Review below, then click Run Fetch</span>
                    </div>
                    <div className="overflow-x-auto">
                        <table className="w-full text-sm">
                            <thead className="bg-gray-50 dark:bg-gray-800 text-left">
                                <tr>
                                    <th className="px-4 py-2.5 font-semibold text-xs uppercase tracking-wide text-gray-500 dark:text-gray-400">Course Run ID</th>
                                    <th className="px-4 py-2.5 font-semibold text-xs uppercase tracking-wide text-gray-500 dark:text-gray-400">Course</th>
                                    <th className="px-4 py-2.5 font-semibold text-xs uppercase tracking-wide text-gray-500 dark:text-gray-400">Start Date</th>
                                    <th className="px-4 py-2.5 font-semibold text-xs uppercase tracking-wide text-gray-500 dark:text-gray-400">End Date</th>
                                    <th className="px-4 py-2.5 font-semibold text-xs uppercase tracking-wide text-gray-500 dark:text-gray-400">Status</th>
                                    <th className="px-4 py-2.5 font-semibold text-xs uppercase tracking-wide text-gray-500 dark:text-gray-400">Enrolments</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-gray-100 dark:divide-gray-700">
                                {preview.map(row => (
                                    <tr key={row.uuid} className="hover:bg-gray-50 dark:hover:bg-gray-800/50">
                                        <td className="px-4 py-3 font-mono text-xs text-indigo-600 dark:text-indigo-400">{row.ssg_run_id || '—'}</td>
                                        <td className="px-4 py-3 max-w-[200px]">
                                            <div className="font-medium text-gray-900 dark:text-gray-100 text-xs whitespace-normal">{row.course_title || '—'}</div>
                                            {row.course_code && <span className="text-xs text-gray-400 font-mono">{row.course_code}</span>}
                                        </td>
                                        <td className="px-4 py-3 text-xs text-gray-500 dark:text-gray-400 whitespace-nowrap">{fmt(row.start_date)}</td>
                                        <td className="px-4 py-3 text-xs text-gray-500 dark:text-gray-400 whitespace-nowrap">{fmt(row.end_date)}</td>
                                        <td className="px-4 py-3 text-xs text-gray-500 dark:text-gray-400">{row.class_status || '—'}</td>
                                        <td className="px-4 py-3 text-xs text-center font-semibold text-gray-700 dark:text-gray-300">{row.enrolment_count}</td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                </Card>
            )}

            {preview.length === 0 && !previewing && !runResult && !error && (
                <Card className="p-8 text-center text-gray-500 dark:text-gray-400">
                    Click <strong>Fetch Preview</strong> to see upcoming course runs.
                </Card>
            )}
        </div>
    );
};

// ── Upcoming Enrolment View (with Calendar Matching) ─────────────────────────

// ── Shared Enrolment Table (used by both Upcoming + New Enrolment) ───────────
// Mirrors the View DA table columns: Enrol/Cal/Inv checkboxes, KPI cards,
// Sync + Action buttons, NRIC/DOB masking with eye toggle.

const EnrolmentTable: React.FC<{
    title: string;
    description: string;
    data: any[];
    loading: boolean;
    onRefresh: () => void;
    onSync?: () => void;
    syncLabel?: string;
    syncing?: boolean;
    showDateRange?: boolean;
    startDate?: string;
    endDate?: string;
    onStartDateChange?: (v: string) => void;
    onEndDateChange?: (v: string) => void;
}> = ({ title, description, data, loading, onRefresh, onSync, syncLabel, syncing, showDateRange, startDate, endDate, onStartDateChange, onEndDateChange }) => {
    const { setAdminPage } = useLms();
    const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
    const [showPii, setShowPii] = useState(false);
    const [isAddingToCal, setIsAddingToCal] = useState(false);
    const [isSyncingCal, setIsSyncingCal] = useState(false);
    const [isSyncingGrants, setIsSyncingGrants] = useState(false);
    const [searchQuery, setSearchQuery] = useState('');
    const [localData, setLocalData] = useState<any[]>([]);

    React.useEffect(() => { setLocalData(data); }, [data]);

    const filteredData = searchQuery.trim()
        ? localData.filter(r => {
            const q = searchQuery.toLowerCase();
            return (r.learner_name || '').toLowerCase().includes(q)
                || (r.email || '').toLowerCase().includes(q)
                || (r.enrolment_id || '').toLowerCase().includes(q)
                || (r.nric || '').toLowerCase().includes(q)
                || (r.course_title || r.title || '').toLowerCase().includes(q)
                || (r.course_code || '').toLowerCase().includes(q)
                || (r.course_run_id || '').toLowerCase().includes(q);
        })
        : localData;

    const total = localData.length;
    const enrolled = localData.filter(r => r.enrolment_id && String(r.enrolment_id).trim()).length;
    const calAdded = localData.filter(r => !!r.calendar_added).length;
    const invoiced = localData.filter(r => r.invoice_id && String(r.invoice_id).trim()).length;

    const toggleSelect = (id: string) => setSelectedIds(prev => { const s = new Set(prev); s.has(id) ? s.delete(id) : s.add(id); return s; });
    const toggleSelectAll = () => {
        const allSelected = filteredData.length > 0 && filteredData.every(r => selectedIds.has(r.id));
        setSelectedIds(allSelected ? new Set() : new Set(filteredData.map(r => r.id)));
    };

    const toggleField = async (enrollmentId: string, field: 'calendar' | 'invoice', newValue: boolean) => {
        setLocalData(prev => prev.map(r => {
            if (r.id !== enrollmentId) return r;
            if (field === 'calendar') return { ...r, calendar_added: newValue };
            if (field === 'invoice') return { ...r, invoice_id: newValue ? 'MANUAL' : null };
            return r;
        }));
        try {
            await fetch('/api/admin/enrolment-actions', {
                method: 'POST', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ action: 'toggle-field', enrollmentId, field, value: newValue }),
            });
        } catch { console.error('Toggle save failed'); }
    };

    const handleSyncCal = async () => {
        setIsSyncingCal(true);
        try {
            const res = await fetch('/api/admin/enrolment-actions', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'sync-calendar' }) });
            const json = await res.json();
            alert(json.success ? `Sync: ${json.checked} checked, ${json.matched} in calendar.` : `Failed: ${json.error}`);
            onRefresh();
        } catch { alert('Sync calendar failed.'); }
        finally { setIsSyncingCal(false); }
    };

    const handleSyncGrants = async () => {
        setIsSyncingGrants(true);
        try {
            const res = await fetch('/api/admin/enrolment-actions', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'sync-grants' }) });
            const json = await res.json();
            alert(json.success ? `Sync: ${json.matched} grant(s) matched.` : `Failed: ${json.error}`);
            onRefresh();
        } catch { alert('Sync grants failed.'); }
        finally { setIsSyncingGrants(false); }
    };

    const handleAddToCal = async () => {
        const ids = Array.from(selectedIds).filter(id => { const r = localData.find(d => d.id === id); return r && !r.calendar_added; });
        if (ids.length === 0) { alert('No eligible rows selected.'); return; }
        if (!window.confirm(`Add ${ids.length} learner(s) to calendar?`)) return;
        setIsAddingToCal(true);
        try {
            const res = await fetch('/api/admin/enrolment-actions', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'add-to-calendar', enrollmentIds: ids }) });
            const json = await res.json();
            const ok = (json.results || []).filter((r: any) => r.success).length;
            const fail = (json.results || []).filter((r: any) => !r.success);
            const successIds = new Set((json.results || []).filter((r: any) => r.success).map((r: any) => r.id));
            setLocalData(prev => prev.map(r => successIds.has(r.id) ? { ...r, calendar_added: true } : r));
            alert(`${ok} added.` + (fail.length ? `\n${fail.length} failed.` : ''));
        } catch { alert('Failed.'); }
        finally { setIsAddingToCal(false); }
    };

    const fmt = (d: string | null) => {
        if (!d) return '—';
        const date = new Date(d);
        if (isNaN(date.getTime())) return d;
        return new Intl.DateTimeFormat('en-GB', { day: '2-digit', month: '2-digit', year: 'numeric', timeZone: 'Asia/Singapore' }).format(date);
    };

    const formatDateInput = (value: string) => {
        const numeric = value.replace(/\D/g, '');
        if (numeric.length <= 2) return numeric;
        if (numeric.length <= 4) return `${numeric.slice(0, 2)}/${numeric.slice(2)}`;
        return `${numeric.slice(0, 2)}/${numeric.slice(2, 4)}/${numeric.slice(4, 8)}`;
    };

    return (
        <div className="space-y-6">
            <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                    <h2 className="text-3xl font-bold">{title}</h2>
                    <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">{description}</p>
                </div>
                <div className="flex items-center gap-2">
                    {onSync && <Button onClick={onSync} disabled={syncing}>{syncing ? 'Syncing…' : syncLabel || 'Sync'}</Button>}
                    <Button variant="ghost" onClick={() => setAdminPage(AdminPage.Dashboard)}>Back</Button>
                </div>
            </div>

            {/* KPI Cards */}
            {total > 0 && (
                <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                    <Card className="p-4 text-center"><p className="text-3xl font-bold text-blue-600">{total}</p><p className="text-xs text-gray-500 mt-1">Total Enrolments</p></Card>
                    <Card className="p-4 text-center"><p className="text-3xl font-bold text-green-600">{enrolled}</p><p className="text-xs text-gray-500 mt-1">Enrolled (SSG)</p></Card>
                    <Card className="p-4 text-center"><p className="text-3xl font-bold text-indigo-600">{calAdded}</p><p className="text-xs text-gray-500 mt-1">Added to Calendar</p></Card>
                    <Card className="p-4 text-center"><p className="text-3xl font-bold text-amber-600">{invoiced}</p><p className="text-xs text-gray-500 mt-1">Invoice Created</p></Card>
                </div>
            )}

            {/* Date Range + Search */}
            <Card className="p-4">
                <div className="flex flex-wrap items-end gap-4">
                    {showDateRange && (
                        <>
                            <div className="space-y-1">
                                <label className="block text-xs font-semibold uppercase tracking-wider text-gray-500">Start Date</label>
                                <input type="text" placeholder="DD/MM/YYYY" value={startDate} onChange={e => onStartDateChange?.(formatDateInput(e.target.value))} maxLength={10} className="w-32 px-3 py-2 text-sm border border-gray-300 dark:border-gray-600 rounded-md bg-white dark:bg-slate-800 text-gray-900 dark:text-white focus:ring-2 focus:ring-blue-500 outline-none" />
                            </div>
                            <div className="space-y-1">
                                <label className="block text-xs font-semibold uppercase tracking-wider text-gray-500">End Date</label>
                                <input type="text" placeholder="DD/MM/YYYY" value={endDate} onChange={e => onEndDateChange?.(formatDateInput(e.target.value))} maxLength={10} className="w-32 px-3 py-2 text-sm border border-gray-300 dark:border-gray-600 rounded-md bg-white dark:bg-slate-800 text-gray-900 dark:text-white focus:ring-2 focus:ring-blue-500 outline-none" />
                            </div>
                        </>
                    )}
                    <div className="flex-1">
                        <label className="block text-xs font-semibold uppercase tracking-wider text-gray-500 mb-1">Search</label>
                        <input type="text" placeholder="Search name, NRIC, email, course..." value={searchQuery} onChange={e => setSearchQuery(e.target.value)} className="w-full px-3 py-2 text-sm border border-gray-300 dark:border-gray-600 rounded-md bg-white dark:bg-slate-800 text-gray-900 dark:text-white focus:ring-2 focus:ring-blue-500 outline-none" />
                    </div>
                    <Button onClick={onRefresh} disabled={loading}>{loading ? 'Loading...' : 'Refresh'}</Button>
                </div>
            </Card>

            {/* Action + Sync buttons */}
            <div className="flex flex-wrap items-center gap-2">
                <button onClick={handleAddToCal} disabled={isAddingToCal || selectedIds.size === 0} className="px-3 py-1.5 text-xs font-medium rounded-lg bg-indigo-600 text-white hover:bg-indigo-700 disabled:bg-indigo-400 disabled:cursor-not-allowed">{isAddingToCal ? 'Adding...' : 'Add to Calendar'}</button>
                <span className="w-px h-5 bg-gray-300 dark:bg-gray-600 mx-1" />
                <button onClick={handleSyncGrants} disabled={isSyncingGrants} className="px-3 py-1.5 text-xs font-medium rounded-lg border border-green-500 text-green-700 dark:text-green-300 hover:bg-green-50 dark:hover:bg-green-900/20 disabled:opacity-50">{isSyncingGrants ? 'Syncing...' : 'Sync Grants'}</button>
                <button onClick={handleSyncCal} disabled={isSyncingCal} className="px-3 py-1.5 text-xs font-medium rounded-lg border border-indigo-500 text-indigo-700 dark:text-indigo-300 hover:bg-indigo-50 dark:hover:bg-indigo-900/20 disabled:opacity-50">{isSyncingCal ? 'Syncing...' : 'Sync Calendar'}</button>
            </div>

            {/* Table */}
            <Card className="overflow-hidden">
                <div className="overflow-x-auto">
                    <table className="w-full text-xs text-left">
                        <thead className="bg-gray-50 dark:bg-gray-800 border-b border-gray-200 dark:border-gray-700">
                            <tr>
                                <th className="px-2 py-2 w-8"><input type="checkbox" checked={filteredData.length > 0 && filteredData.every(r => selectedIds.has(r.id))} onChange={toggleSelectAll} className="w-3.5 h-3.5" /></th>
                                <th className="px-2 py-2 text-center text-[10px] font-semibold text-gray-500 dark:text-gray-300 uppercase whitespace-nowrap" title="SSG Enrolled">Enrol</th>
                                <th className="px-2 py-2 text-center text-[10px] font-semibold text-gray-500 dark:text-gray-300 uppercase whitespace-nowrap" title="In Calendar">Cal</th>
                                <th className="px-2 py-2 text-center text-[10px] font-semibold text-gray-500 dark:text-gray-300 uppercase whitespace-nowrap" title="Invoice">Inv</th>
                                <th className="px-2 py-2 text-left text-[10px] font-semibold text-gray-500 dark:text-gray-300 uppercase whitespace-nowrap">Enrolment ID</th>
                                <th className="px-2 py-2 text-left text-[10px] font-semibold text-gray-500 dark:text-gray-300 uppercase whitespace-nowrap">Enrol Date</th>
                                <th className="px-2 py-2 text-left text-[10px] font-semibold text-gray-500 dark:text-gray-300 uppercase whitespace-nowrap">Name</th>
                                <th className="px-2 py-2 text-left text-[10px] font-semibold text-gray-500 dark:text-gray-300 uppercase whitespace-nowrap">NRIC <button onClick={() => setShowPii(v => !v)} className="ml-1 inline-flex align-middle text-gray-400 hover:text-blue-500" title={showPii ? 'Hide' : 'Reveal'}><svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d={showPii ? "M13.875 18.825A10.05 10.05 0 0112 19c-4.478 0-8.268-2.943-9.543-7a9.97 9.97 0 011.563-3.029m5.858.908a3 3 0 114.243 4.243M9.878 9.878l4.242 4.242M9.878 9.878L3 3m6.878 6.878L21 21" : "M15 12a3 3 0 11-6 0 3 3 0 016 0z M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z"} /></svg></button></th>
                                <th className="px-2 py-2 text-left text-[10px] font-semibold text-gray-500 dark:text-gray-300 uppercase whitespace-nowrap">DOB <button onClick={() => setShowPii(v => !v)} className="ml-1 inline-flex align-middle text-gray-400 hover:text-blue-500" title={showPii ? 'Hide' : 'Reveal'}><svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d={showPii ? "M13.875 18.825A10.05 10.05 0 0112 19c-4.478 0-8.268-2.943-9.543-7a9.97 9.97 0 011.563-3.029m5.858.908a3 3 0 114.243 4.243M9.878 9.878l4.242 4.242M9.878 9.878L3 3m6.878 6.878L21 21" : "M15 12a3 3 0 11-6 0 3 3 0 016 0z M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z"} /></svg></button></th>
                                <th className="px-2 py-2 text-left text-[10px] font-semibold text-gray-500 dark:text-gray-300 uppercase whitespace-nowrap">Email</th>
                                <th className="px-2 py-2 text-left text-[10px] font-semibold text-gray-500 dark:text-gray-300 uppercase whitespace-nowrap">Course Title</th>
                                <th className="px-2 py-2 text-left text-[10px] font-semibold text-gray-500 dark:text-gray-300 uppercase whitespace-nowrap">Course Ref No.</th>
                                <th className="px-2 py-2 text-left text-[10px] font-semibold text-gray-500 dark:text-gray-300 uppercase whitespace-nowrap">Start Date</th>
                                <th className="px-2 py-2 text-left text-[10px] font-semibold text-gray-500 dark:text-gray-300 uppercase whitespace-nowrap">Run ID</th>
                                <th className="px-2 py-2 text-left text-[10px] font-semibold text-gray-500 dark:text-gray-300 uppercase whitespace-nowrap">Fee</th>
                                <th className="px-2 py-2 text-left text-[10px] font-semibold text-gray-500 dark:text-gray-300 uppercase whitespace-nowrap">GST</th>
                                <th className="px-2 py-2 text-left text-[10px] font-semibold text-gray-500 dark:text-gray-300 uppercase whitespace-nowrap">Sponsor</th>
                                <th className="px-2 py-2 text-left text-[10px] font-semibold text-gray-500 dark:text-gray-300 uppercase whitespace-nowrap">SF Sub</th>
                                <th className="px-2 py-2 text-left text-[10px] font-semibold text-gray-500 dark:text-gray-300 uppercase whitespace-nowrap">SF Cr</th>
                                <th className="px-2 py-2 text-left text-[10px] font-semibold text-gray-500 dark:text-gray-300 uppercase whitespace-nowrap">Payable</th>
                                <th className="px-2 py-2 text-left text-[10px] font-semibold text-gray-500 dark:text-gray-300 uppercase whitespace-nowrap">SF Claim ID</th>
                                <th className="px-2 py-2 text-left text-[10px] font-semibold text-gray-500 dark:text-gray-300 uppercase whitespace-nowrap">Payment</th>
                                <th className="px-2 py-2 text-left text-[10px] font-semibold text-gray-500 dark:text-gray-300 uppercase whitespace-nowrap">Status</th>
                                <th className="px-2 py-2 text-left text-[10px] font-semibold text-gray-500 dark:text-gray-300 uppercase whitespace-nowrap">Grant ID</th>
                                <th className="px-2 py-2 text-left text-[10px] font-semibold text-gray-500 dark:text-gray-300 uppercase whitespace-nowrap">Grant Amt</th>
                                <th className="px-2 py-2 text-left text-[10px] font-semibold text-gray-500 dark:text-gray-300 uppercase whitespace-nowrap">Invoice #</th>
                                <th className="px-2 py-2 text-center text-[10px] font-semibold text-gray-500 dark:text-gray-300 uppercase whitespace-nowrap">Not In Cal</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-gray-100 dark:divide-gray-700">
                            {loading ? (
                                <tr><td colSpan={27} className="px-3 py-8 text-center text-gray-500 italic">Loading...</td></tr>
                            ) : filteredData.length === 0 ? (
                                <tr><td colSpan={27} className="px-3 py-8 text-center text-gray-500 italic">No enrolments found.</td></tr>
                            ) : filteredData.map((row, idx) => (
                                <tr key={row.id || idx} className="hover:bg-gray-50 dark:hover:bg-gray-800/50">
                                    <td className="px-2 py-1.5"><input type="checkbox" checked={selectedIds.has(row.id)} onChange={() => toggleSelect(row.id)} className="w-3.5 h-3.5" /></td>
                                    <td className="px-2 py-1.5 text-center"><input type="checkbox" checked={!!(row.enrolment_id && String(row.enrolment_id).trim())} readOnly className={`w-3.5 h-3.5 rounded border-gray-300 cursor-default ${row.enrolment_id ? 'text-green-600 accent-green-600' : ''}`} title={row.enrolment_id || 'Not enrolled'} /></td>
                                    <td className="px-2 py-1.5 text-center"><input type="checkbox" checked={!!row.calendar_added} onChange={e => toggleField(row.id, 'calendar', e.target.checked)} className={`w-3.5 h-3.5 rounded border-gray-300 cursor-pointer ${row.calendar_added ? 'text-blue-600 accent-blue-600' : ''}`} /></td>
                                    <td className="px-2 py-1.5 text-center"><input type="checkbox" checked={!!(row.invoice_id && String(row.invoice_id).trim())} onChange={e => toggleField(row.id, 'invoice', e.target.checked)} className={`w-3.5 h-3.5 rounded border-gray-300 cursor-pointer ${row.invoice_id ? 'text-amber-600 accent-amber-600' : ''}`} /></td>
                                    <td className="px-2 py-1.5 whitespace-nowrap font-mono text-gray-700 dark:text-gray-200">{row.enrolment_id || '—'}</td>
                                    <td className="px-2 py-1.5 whitespace-nowrap text-gray-500 dark:text-gray-300">{fmt(row.enrolment_date)}</td>
                                    <td className="px-2 py-1.5 whitespace-nowrap text-gray-700 dark:text-gray-200 max-w-[140px] truncate" title={row.learner_name}>{row.learner_name || '—'}</td>
                                    <td className="px-2 py-1.5 whitespace-nowrap font-mono text-gray-500 dark:text-gray-300" title={showPii ? row.nric : undefined}>{row.nric ? (showPii ? row.nric : `${row.nric.charAt(0)}****${row.nric.slice(-3)}`) : '—'}</td>
                                    <td className="px-2 py-1.5 whitespace-nowrap text-gray-500 dark:text-gray-300">{row.date_of_birth ? (showPii ? fmt(row.date_of_birth) : `**/**/${new Date(row.date_of_birth).getFullYear()}`) : '—'}</td>
                                    <td className="px-2 py-1.5 whitespace-nowrap text-gray-500 dark:text-gray-300 max-w-[160px] truncate" title={row.email}>{row.email || '—'}</td>
                                    <td className="px-2 py-1.5 whitespace-nowrap text-gray-700 dark:text-gray-300 max-w-[180px] truncate" title={row.course_title || row.title}>{row.course_title || row.title || '—'}</td>
                                    <td className="px-2 py-1.5 whitespace-nowrap font-mono text-gray-500 dark:text-gray-300">{row.course_code || '—'}</td>
                                    <td className="px-2 py-1.5 whitespace-nowrap text-gray-500 dark:text-gray-300">{fmt(row.start_date)}</td>
                                    <td className="px-2 py-1.5 whitespace-nowrap text-gray-500 dark:text-gray-300">{row.course_run_id || '—'}</td>
                                    <td className="px-2 py-1.5 whitespace-nowrap text-gray-500 dark:text-gray-300">{row.fee != null ? `$${parseFloat(row.fee || 0).toFixed(2)}` : '—'}</td>
                                    <td className="px-2 py-1.5 whitespace-nowrap text-gray-500 dark:text-gray-300">{row.gst != null ? `$${parseFloat(row.gst || 0).toFixed(2)}` : '—'}</td>
                                    <td className="px-2 py-1.5 whitespace-nowrap text-gray-500 dark:text-gray-300">{row.course_sponsorship || row.sponsorship_type || '—'}</td>
                                    <td className="px-2 py-1.5 whitespace-nowrap text-gray-500 dark:text-gray-300">{row.sf_subsidy != null ? `$${parseFloat(row.sf_subsidy || 0).toFixed(2)}` : '—'}</td>
                                    <td className="px-2 py-1.5 whitespace-nowrap text-gray-500 dark:text-gray-300">{row.sf_credit != null ? `$${parseFloat(row.sf_credit || 0).toFixed(2)}` : '—'}</td>
                                    <td className="px-2 py-1.5 whitespace-nowrap text-gray-500 dark:text-gray-300">{row.payable != null ? `$${parseFloat(row.payable || 0).toFixed(2)}` : '—'}</td>
                                    <td className="px-2 py-1.5 whitespace-nowrap font-mono text-gray-500 dark:text-gray-300">{row.sf_claim_id || '—'}</td>
                                    <td className="px-2 py-1.5 whitespace-nowrap text-gray-500 dark:text-gray-300">{row.payment_status || '—'}</td>
                                    <td className="px-2 py-1.5 whitespace-nowrap"><span className={`px-1.5 py-0.5 text-[10px] font-bold rounded-full ${(row.enrolment_status || row.class_status) === 'Confirmed' ? 'bg-green-100 text-green-800' : 'bg-gray-100 text-gray-600'}`}>{row.enrolment_status || row.class_status || '—'}</span></td>
                                    <td className="px-2 py-1.5 whitespace-nowrap font-mono text-gray-500 dark:text-gray-300">{row.grant_id || '—'}</td>
                                    <td className="px-2 py-1.5 whitespace-nowrap text-gray-500 dark:text-gray-300">{row.grant_amount ? `$${parseFloat(row.grant_amount).toFixed(2)}` : '—'}</td>
                                    <td className="px-2 py-1.5 whitespace-nowrap font-mono text-gray-500 dark:text-gray-300">{row.invoice_id || '—'}</td>
                                    <td className="px-2 py-1.5 text-center whitespace-nowrap">
                                        {row.match ? (
                                            <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full bg-emerald-100 text-emerald-700 text-[10px] font-semibold" title={row.matchDetail}><svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}><path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" /></svg>In Cal</span>
                                        ) : row.reason ? (
                                            <span className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full text-[10px] font-semibold ${row.reason === 'Not in Cal' ? 'bg-amber-100 text-amber-700' : 'bg-red-50 text-red-600'}`}><svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}><path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" /></svg>{row.reason}</span>
                                        ) : <span className="text-gray-400">—</span>}
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            </Card>
        </div>
    );
};

export const UpcomingEnrolmentView: React.FC = () => {
    const { trainingProviderProfile } = useLms();
    const [data, setData] = useState<any[]>([]);
    const [loading, setLoading] = useState(false);
    // Use admin threshold from Company Settings (default 21 days, same as Upcoming Classes)
    const thresholdDays = (trainingProviderProfile as any)?.adminSettings?.upcomingClassesThresholdDays || 21;
    const fmtDmy = (d: Date) => `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}/${d.getFullYear()}`;
    const [startDate, setStartDate] = useState(() => fmtDmy(new Date()));
    const [endDate, setEndDate] = useState(() => { const d = new Date(); d.setDate(d.getDate() + thresholdDays); return fmtDmy(d); });
    const toIsoDate = (dmy: string) => { const p = dmy.split('/'); return p.length === 3 ? `${p[2]}-${p[1]}-${p[0]}` : dmy; };
    const fetchData = async () => {
        setLoading(true);
        try { const res = await fetch(`/api/admin/upcoming-enrolment?startDate=${toIsoDate(startDate)}&endDate=${toIsoDate(endDate)}`); const json = await res.json(); if (json.success) setData(json.data); }
        catch { /* silent */ } finally { setLoading(false); }
    };
    useEffect(() => { fetchData(); }, []); // eslint-disable-line react-hooks/exhaustive-deps
    return <EnrolmentTable title="Upcoming Enrolment" description={`Confirmed enrolments starting from today to ${thresholdDays} days ahead (same threshold as Upcoming Classes). Sorted by start date.`} data={data} loading={loading} onRefresh={fetchData} showDateRange startDate={startDate} endDate={endDate} onStartDateChange={setStartDate} onEndDateChange={setEndDate} />;
};

export const NewEnrolmentView: React.FC = () => {
    const [data, setData] = useState<any[]>([]);
    const [loading, setLoading] = useState(false);
    const [syncing, setSyncing] = useState(false);
    const fetchData = async () => {
        setLoading(true);
        try { const res = await fetch('/api/admin/ssg-enrolment-records?limit=500'); const json = await res.json(); if (json.success) setData((json.data || []).map((r: any) => ({ ...r, enrolment_id: r.enrolment_reference, nric: r.learner_nric, email: r.learner_email, course_title: r.course_title, course_code: r.course_ref_code, start_date: r.start_date, enrolment_status: r.status }))); }
        catch { /* silent */ } finally { setLoading(false); }
    };
    const handleSync = async () => {
        setSyncing(true);
        try { const res = await fetch('/api/external/sync-ssg-enrolments', { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-internal-scheduler': '1' } }); const json = await res.json(); if (json.success) { alert(`Sync: ${json.inserted} new, ${json.skipped} existing, ${json.errors} errors`); fetchData(); } else alert(`Failed: ${json.error}`); }
        catch { alert('Sync failed.'); } finally { setSyncing(false); }
    };
    React.useEffect(() => { fetchData(); }, []);
    return <EnrolmentTable title="New Enrolment" description="Enrolments from yesterday & today for upcoming courses. Synced from SSG every 3 hours. Click Sync to pull latest." data={data} loading={loading} onRefresh={fetchData} onSync={handleSync} syncLabel="Sync from SSG Now" syncing={syncing} />;
};

// ── Course Run Date Sync Log ──────────────────────────────────────────────────

interface DateSyncLogRow {
    id: number;
    run_id: string;
    created_at: string;
    course_run_id: string | null;
    course_title: string | null;
    course_code: string | null;
    db_start_date: string | null;
    db_end_date: string | null;
    ssg_start_date: string | null;
    ssg_end_date: string | null;
    status: string;
    updated: boolean;
    error_message: string | null;
}

export const CourseRunDateSyncLogsView: React.FC = () => {
    const { setAdminPage } = useLms();
    const [logs, setLogs] = useState<DateSyncLogRow[]>([]);
    const [loading, setLoading] = useState(false);
    const [running, setRunning] = useState(false);
    const [runResult, setRunResult] = useState<{ updated: number; noChange: number; errors: number; processed: number } | null>(null);
    const [runError, setRunError] = useState<string | null>(null);
    const [expandedDates, setExpandedDates] = useState<Set<string>>(new Set());

    const fetchLogs = async () => {
        setLoading(true);
        try {
            const res = await fetch('/api/admin/course-run-date-sync-logs?limit=500');
            const json = await res.json();
            if (json.success) setLogs(json.data);
        } catch {
            /* silent */
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => { fetchLogs(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

    const handleRunNow = async () => {
        setRunning(true);
        setRunResult(null);
        setRunError(null);
        try {
            const res = await fetch('/api/admin/run-date-sync', { method: 'POST' });
            const json = await res.json();
            if (!json.success) throw new Error(json.error || 'Sync failed');
            setRunResult({ updated: json.updated, noChange: json.noChange, errors: json.errors, processed: json.processed });
            await fetchLogs();
        } catch (err) {
            setRunError(err instanceof Error ? err.message : 'Failed to run sync');
        } finally {
            setRunning(false);
        }
    };

    // Group by calendar date (SG time)
    const batches = useMemo(() => {
        const map = new Map<string, DateSyncLogRow[]>();
        for (const log of logs) {
            const dateKey = new Date(log.created_at).toLocaleDateString('en-SG', {
                timeZone: 'Asia/Singapore',
                day: '2-digit', month: 'short', year: 'numeric',
            });
            if (!map.has(dateKey)) map.set(dateKey, []);
            map.get(dateKey)!.push(log);
        }
        return Array.from(map.entries());
    }, [logs]);

    useEffect(() => {
        if (batches.length > 0) setExpandedDates(new Set([batches[0][0]]));
    }, [batches.length]); // eslint-disable-line react-hooks/exhaustive-deps

    const toggleDate = (dateKey: string) => {
        setExpandedDates(prev => {
            const next = new Set(prev);
            next.has(dateKey) ? next.delete(dateKey) : next.add(dateKey);
            return next;
        });
    };

    const statusBadge = (status: string, updated: boolean) => {
        const map: Record<string, string> = {
            updated:   'bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300',
            no_change: 'bg-gray-100 text-gray-600 dark:bg-gray-700 dark:text-gray-400',
            error:     'bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300',
        };
        const label = updated ? 'updated' : status;
        return (
            <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-semibold ${map[status] ?? map.no_change}`}>
                {label}
            </span>
        );
    };

    return (
        <div>
            <div className="flex flex-wrap items-center justify-between gap-3 mb-6">
                <h2 className="text-3xl font-bold">Course Run Date Sync Log</h2>
                <div className="flex items-center gap-2">
                    <Button onClick={handleRunNow} disabled={running || loading}>
                        {running ? 'Running…' : 'Run Now'}
                    </Button>
                    <Button variant="ghost" onClick={fetchLogs} disabled={loading || running}>
                        {loading ? 'Refreshing…' : 'Refresh'}
                    </Button>
                    <Button variant="ghost" onClick={() => setAdminPage(AdminPage.Dashboard)}>
                        Back
                    </Button>
                </div>
            </div>

            <p className="text-sm text-gray-500 dark:text-gray-400 mb-4">
                Daily automation (1 AM SGT): compares SSG course run start/end dates against the local database for classes starting today, and updates any mismatches automatically. Capped at 3 runs/day. Use <strong>Run Now</strong> to trigger manually.
            </p>

            {runResult && (
                <div className="mb-4 p-4 rounded-lg bg-emerald-50 dark:bg-emerald-900/20 border border-emerald-200 dark:border-emerald-700 text-sm text-emerald-800 dark:text-emerald-300">
                    Sync complete — <strong>{runResult.processed}</strong> run{runResult.processed !== 1 ? 's' : ''} checked,{' '}
                    <strong>{runResult.updated}</strong> updated,{' '}
                    <strong>{runResult.noChange}</strong> no change,{' '}
                    <strong>{runResult.errors}</strong> error{runResult.errors !== 1 ? 's' : ''}.
                </div>
            )}
            {runError && (
                <div className="mb-4 p-4 rounded-lg bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-700 text-sm text-red-700 dark:text-red-400">
                    {runError}
                </div>
            )}

            {loading ? (
                <div className="text-center py-12 text-gray-400">Loading logs…</div>
            ) : batches.length === 0 ? (
                <Card className="p-8 text-center text-gray-500 dark:text-gray-400">No date sync logs yet.</Card>
            ) : (
                <div className="space-y-4">
                    {batches.map(([dateKey, rows]) => {
                        const isOpen = expandedDates.has(dateKey);
                        const updatedCount  = rows.filter(r => r.updated).length;
                        const noChangeCount = rows.filter(r => r.status === 'no_change').length;
                        const errorCount    = rows.filter(r => r.status === 'error').length;
                        return (
                            <Card key={dateKey} className="overflow-hidden">
                                <button
                                    onClick={() => toggleDate(dateKey)}
                                    className="w-full flex items-center justify-between px-5 py-4 hover:bg-gray-50 dark:hover:bg-slate-700/50 transition-colors text-left"
                                >
                                    <div className="flex items-center gap-4 flex-wrap">
                                        <span className="font-semibold text-gray-900 dark:text-white">{dateKey}</span>
                                        <span className="text-sm text-gray-500 dark:text-gray-400">{rows.length} run{rows.length !== 1 ? 's' : ''}</span>
                                        {updatedCount > 0 && (
                                            <span className="text-xs font-semibold px-2 py-0.5 rounded-full bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300">
                                                {updatedCount} updated
                                            </span>
                                        )}
                                        {noChangeCount > 0 && (
                                            <span className="text-xs font-semibold px-2 py-0.5 rounded-full bg-gray-100 text-gray-600 dark:bg-gray-700 dark:text-gray-400">
                                                {noChangeCount} no change
                                            </span>
                                        )}
                                        {errorCount > 0 && (
                                            <span className="text-xs font-semibold px-2 py-0.5 rounded-full bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300">
                                                {errorCount} error{errorCount !== 1 ? 's' : ''}
                                            </span>
                                        )}
                                    </div>
                                    <svg className={`w-5 h-5 text-gray-400 transition-transform flex-shrink-0 ${isOpen ? 'rotate-180' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" /></svg>
                                </button>

                                {isOpen && (
                                    <div className="border-t border-gray-100 dark:border-gray-700 overflow-x-auto">
                                        <table className="w-full text-sm">
                                            <thead className="bg-gray-50 dark:bg-gray-800 text-left">
                                                <tr>
                                                    <th className="px-4 py-2.5 font-semibold text-xs uppercase tracking-wide text-gray-500 dark:text-gray-400">Time</th>
                                                    <th className="px-4 py-2.5 font-semibold text-xs uppercase tracking-wide text-gray-500 dark:text-gray-400">Course Title</th>
                                                    <th className="px-4 py-2.5 font-semibold text-xs uppercase tracking-wide text-gray-500 dark:text-gray-400">Code</th>
                                                    <th className="px-4 py-2.5 font-semibold text-xs uppercase tracking-wide text-gray-500 dark:text-gray-400">Run ID</th>
                                                    <th className="px-4 py-2.5 font-semibold text-xs uppercase tracking-wide text-gray-500 dark:text-gray-400">DB Start</th>
                                                    <th className="px-4 py-2.5 font-semibold text-xs uppercase tracking-wide text-gray-500 dark:text-gray-400">DB End</th>
                                                    <th className="px-4 py-2.5 font-semibold text-xs uppercase tracking-wide text-gray-500 dark:text-gray-400">SSG Start</th>
                                                    <th className="px-4 py-2.5 font-semibold text-xs uppercase tracking-wide text-gray-500 dark:text-gray-400">SSG End</th>
                                                    <th className="px-4 py-2.5 font-semibold text-xs uppercase tracking-wide text-gray-500 dark:text-gray-400 text-center">Status</th>
                                                </tr>
                                            </thead>
                                            <tbody className="divide-y divide-gray-100 dark:divide-gray-700">
                                                {rows.map(log => {
                                                    const startMismatch = log.ssg_start_date && log.ssg_start_date !== log.db_start_date;
                                                    const endMismatch   = log.ssg_end_date   && log.ssg_end_date   !== log.db_end_date;
                                                    return (
                                                        <tr key={log.id} className="hover:bg-gray-50 dark:hover:bg-gray-800/50 transition-colors">
                                                            <td className="px-4 py-3 whitespace-nowrap text-gray-500 dark:text-gray-400 text-xs">
                                                                {new Date(log.created_at).toLocaleTimeString('en-SG', {
                                                                    timeZone: 'Asia/Singapore',
                                                                    hour: '2-digit', minute: '2-digit', hour12: false,
                                                                })}
                                                            </td>
                                                            <td className="px-4 py-3 max-w-[240px]">
                                                                <div className="font-medium text-gray-900 dark:text-gray-100 whitespace-normal break-words">{log.course_title || '—'}</div>
                                                            </td>
                                                            <td className="px-4 py-3 whitespace-nowrap">
                                                                {log.course_code
                                                                    ? <span className="text-xs text-indigo-600 dark:text-indigo-400 font-mono bg-indigo-50 dark:bg-indigo-900/30 px-1.5 py-0.5 rounded">{log.course_code}</span>
                                                                    : <span className="text-gray-400">—</span>}
                                                            </td>
                                                            <td className="px-4 py-3 whitespace-nowrap">
                                                                <span className="text-xs text-gray-500 dark:text-gray-400 font-mono bg-gray-100 dark:bg-gray-800 px-1.5 py-0.5 rounded">
                                                                    {log.course_run_id || '—'}
                                                                </span>
                                                            </td>
                                                            <td className={`px-4 py-3 text-xs whitespace-nowrap ${startMismatch ? 'text-amber-600 dark:text-amber-400 font-semibold' : 'text-gray-500 dark:text-gray-400'}`}>
                                                                {log.db_start_date || '—'}
                                                            </td>
                                                            <td className={`px-4 py-3 text-xs whitespace-nowrap ${endMismatch ? 'text-amber-600 dark:text-amber-400 font-semibold' : 'text-gray-500 dark:text-gray-400'}`}>
                                                                {log.db_end_date || '—'}
                                                            </td>
                                                            <td className={`px-4 py-3 text-xs whitespace-nowrap ${startMismatch ? 'text-blue-600 dark:text-blue-400 font-semibold' : 'text-gray-500 dark:text-gray-400'}`}>
                                                                {log.ssg_start_date || '—'}
                                                            </td>
                                                            <td className={`px-4 py-3 text-xs whitespace-nowrap ${endMismatch ? 'text-blue-600 dark:text-blue-400 font-semibold' : 'text-gray-500 dark:text-gray-400'}`}>
                                                                {log.ssg_end_date || '—'}
                                                            </td>
                                                            <td className="px-4 py-3 text-center">
                                                                {statusBadge(log.status, log.updated)}
                                                                {log.error_message && (
                                                                    <div className="text-xs text-red-500 mt-1 text-left">{log.error_message}</div>
                                                                )}
                                                            </td>
                                                        </tr>
                                                    );
                                                })}
                                            </tbody>
                                        </table>
                                    </div>
                                )}
                            </Card>
                        );
                    })}
                </div>
            )}
        </div>
    );
};

// ─── Assessment Records Logging ───────────────────────────────────────────────────

interface TrainerFolderLogRow {
    id: number;
    run_id: string;
    created_at: string;
    course_run_id: string;
    course_title: string;
    course_code: string | null;
    start_date: string | null;
    end_date: string | null;
    trainer_name: string | null;
    trainer_source: string | null;
    folder_name: string | null;
    status: 'created' | 'existing' | 'error' | 'pending';
    error_message: string | null;
}

export const TrainerFolderLogsView: React.FC = () => {
    const { setAdminPage } = useLms();
    const [logs, setLogs] = useState<TrainerFolderLogRow[]>([]);
    const [loading, setLoading] = useState(false);
    const [running, setRunning] = useState(false);
    const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
    const [expandedDates, setExpandedDates] = useState<Set<string>>(new Set());

    const fetchLogs = async () => {
        setLoading(true);
        try {
            const res = await fetch('/api/admin/trainer-folder-logs?limit=500');
            const json = await res.json();
            if (json.success) setLogs(json.data);
        } catch {
            /* silent */
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => { fetchLogs(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

    const handleRunNow = async () => {
        setRunning(true);
        setMessage(null);
        try {
            // Re-trigger the background function locally without scheduler API key requirement
            const res = await fetch('/api/admin/scheduler', { 
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    taskId: 'auto_create_trainer_folders'
                })
            });
            const text = await res.text();
            if (res.ok) {
                setMessage({ type: 'success', text: 'Trainer folder automation run requested successfully.' });
                setTimeout(fetchLogs, 3000); // Give it a bit of time to start logging
            } else {
                setMessage({ type: 'error', text: 'Run failed: ' + text });
            }
        } catch (err) {
            setMessage({ type: 'error', text: err instanceof Error ? err.message : 'Request failed' });
        } finally {
            setRunning(false);
        }
    };

    // Group by run_id
    const batches = useMemo(() => {
        const map = new Map<string, TrainerFolderLogRow[]>();
        for (const log of logs) {
            if (!map.has(log.run_id)) map.set(log.run_id, []);
            map.get(log.run_id)!.push(log);
        }
        return Array.from(map.entries());
    }, [logs]);

    useEffect(() => {
        if (batches.length > 0) {
            setExpandedDates(new Set([batches[0][0]]));
        }
    }, [batches.length]); // eslint-disable-line react-hooks/exhaustive-deps

    const toggleDate = (key: string) => {
        setExpandedDates(prev => {
            const next = new Set(prev);
            next.has(key) ? next.delete(key) : next.add(key);
            return next;
        });
    };

    const actionBadge = (action: string | null) => {
        const map: Record<string, string> = {
            created: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300',
            existing: 'bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300',
            pending: 'bg-gray-100 text-gray-600 dark:bg-gray-700 dark:text-gray-400',
            error:   'bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300',
        };
        const key = action ?? 'pending';
        return (
            <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-semibold ${map[key] ?? map.pending}`}>
                {key}
            </span>
        );
    };

    return (
        <div>
            <div className="flex flex-wrap items-center justify-between gap-3 mb-6">
                <h2 className="text-3xl font-bold">Auto Create Assessment Records Log</h2>
                <div className="flex items-center gap-2">
                    <Button variant="ghost" onClick={fetchLogs} disabled={loading}>
                        {loading ? 'Refreshing…' : 'Refresh'}
                    </Button>
                    <Button
                        onClick={handleRunNow}
                        disabled={running}
                        className="bg-indigo-600 hover:bg-indigo-700 text-white disabled:opacity-50"
                    >
                        {running ? 'Running…' : 'Run Now'}
                    </Button>
                    <Button variant="ghost" onClick={() => setAdminPage(AdminPage.Dashboard)}>
                        Back
                    </Button>
                </div>
            </div>

            <p className="text-sm text-gray-500 dark:text-gray-400 mb-4">
                Records daily automation runs for creating trainer folders in Google Drive for today&apos;s classes.
            </p>

            {message && (
                <div className={`mb-4 px-4 py-3 rounded-lg text-sm font-medium ${
                    message.type === 'success'
                        ? 'bg-green-50 text-green-800 border border-green-200 dark:bg-green-900/20 dark:text-green-300 dark:border-green-800'
                        : 'bg-red-50 text-red-800 border border-red-200 dark:bg-red-900/20 dark:text-red-300 dark:border-red-800'
                }`}>
                    {message.text}
                </div>
            )}

            {loading ? (
                <div className="text-center py-12 text-gray-400">Loading logs…</div>
            ) : batches.length === 0 ? (
                <Card className="p-8 text-center text-gray-500 dark:text-gray-400">No trainer folder logs yet.</Card>
            ) : (
                <div className="space-y-3">
                    {batches.map(([batchKey, rows]) => {
                        const isOpen = expandedDates.has(batchKey);
                        const sortedRows = [...rows].sort((a,b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
                        const runTime = new Date(sortedRows[0]?.created_at).toLocaleString('en-SG', {
                            timeZone: 'Asia/Singapore',
                            day: '2-digit', month: 'short', year: 'numeric',
                            hour: '2-digit', minute: '2-digit', hour12: false,
                        });
                        const createdCount = rows.filter(r => r.status === 'created').length;
                        const existingCount = rows.filter(r => r.status === 'existing').length;
                        const errorCount   = rows.filter(r => r.status === 'error').length;
                        return (
                            <Card key={batchKey} className="overflow-hidden">
                                {/* Batch header */}
                                <button
                                    onClick={() => toggleDate(batchKey)}
                                    className="w-full flex items-center justify-between px-5 py-4 hover:bg-gray-50 dark:hover:bg-slate-700/50 transition-colors text-left"
                                >
                                    <div className="flex items-center gap-4 flex-wrap">
                                        <span className="font-semibold text-gray-900 dark:text-white font-mono">{runTime}</span>
                                        <span className="text-sm text-gray-500 dark:text-gray-400">{rows.length} course{rows.length !== 1 ? 's' : ''} checked</span>
                                        {createdCount > 0 && (
                                            <span className="inline-flex items-center gap-1 font-semibold text-emerald-600 dark:text-emerald-400 text-xs">
                                                ✓ {createdCount} created
                                            </span>
                                        )}
                                        {existingCount > 0 && (
                                            <span className="inline-flex items-center gap-1 font-semibold text-blue-600 dark:text-blue-400 text-xs">
                                                ↩ {existingCount} existing
                                            </span>
                                        )}
                                        {errorCount > 0 && (
                                            <span className="inline-flex items-center gap-1 font-semibold text-red-600 dark:text-red-400 text-xs">
                                                ✕ {errorCount} errors
                                            </span>
                                        )}
                                    </div>
                                    <svg className={`w-5 h-5 text-gray-400 transition-transform flex-shrink-0 ${isOpen ? 'rotate-180' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" /></svg>
                                </button>

                                {/* Rows table */}
                                {isOpen && (
                                    <div className="border-t border-gray-100 dark:border-gray-700 overflow-x-auto">
                                        <table className="w-full text-sm">
                                            <thead className="bg-gray-50 dark:bg-gray-800 text-left">
                                                <tr>
                                                    <th className="px-4 py-2.5 font-semibold text-xs uppercase tracking-wide text-gray-500 dark:text-gray-400">Course / Code</th>
                                                    <th className="px-4 py-2.5 font-semibold text-xs uppercase tracking-wide text-gray-500 dark:text-gray-400">Run ID</th>
                                                    <th className="px-4 py-2.5 font-semibold text-xs uppercase tracking-wide text-gray-500 dark:text-gray-400">Trainer</th>
                                                    <th className="px-4 py-2.5 font-semibold text-xs uppercase tracking-wide text-gray-500 dark:text-gray-400">Folder Path</th>
                                                    <th className="px-4 py-2.5 font-semibold text-xs uppercase tracking-wide text-gray-500 dark:text-gray-400 text-center">Status</th>
                                                </tr>
                                            </thead>
                                            <tbody className="divide-y divide-gray-100 dark:divide-gray-700">
                                                {sortedRows.map((log, idx) => (
                                                    <tr key={idx} className="hover:bg-gray-50 dark:hover:bg-gray-800/50 transition-colors">
                                                        <td className="px-4 py-3">
                                                            <div className="font-medium text-gray-900 dark:text-gray-100 whitespace-normal break-words max-w-[260px]">{log.course_title || '—'}</div>
                                                            <div className="mt-1">
                                                                {log.course_code
                                                                    ? <span className="text-[10px] text-indigo-600 dark:text-indigo-400 font-mono bg-indigo-50 dark:bg-indigo-900/30 px-1.5 py-0.5 rounded">{log.course_code}</span>
                                                                    : <span className="text-gray-400">—</span>}
                                                            </div>
                                                        </td>
                                                        <td className="px-4 py-3 whitespace-nowrap">
                                                            <span className="text-xs text-gray-500 dark:text-gray-400 font-mono bg-gray-100 dark:bg-gray-800 px-1.5 py-0.5 rounded">
                                                                {log.course_run_id || '—'}
                                                            </span>
                                                        </td>
                                                        <td className="px-4 py-3 text-xs text-gray-700 dark:text-gray-300">
                                                            {log.trainer_name || '—'}
                                                            {log.trainer_source && <div className="text-[10px] text-gray-400 mt-0.5 truncate max-w-[150px]">{log.trainer_source}</div>}
                                                        </td>
                                                        <td className="px-4 py-3 text-xs text-gray-500 dark:text-gray-400">
                                                           {log.folder_name || '—'}
                                                        </td>
                                                        <td className="px-4 py-3 text-center flex flex-col items-center">
                                                            {actionBadge(log.status)}
                                                            {log.error_message && (
                                                                <div className="text-[10px] text-red-500 mt-1 max-w-[200px] whitespace-normal text-left" title={log.error_message}>{log.error_message}</div>
                                                            )}
                                                        </td>
                                                    </tr>
                                                ))}
                                            </tbody>
                                        </table>
                                    </div>
                                )}
                            </Card>
                        );
                    })}
                </div>
            )}
        </div>
    );
};
export const AutoCreateCertificatesLogView: React.FC = () => {
  const { setAdminPage } = useLms();
  const [logs, setLogs] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [running, setRunning] = useState(false);
  const [runResult, setRunResult] = useState<{ totalGenerated: number; totalSkipped: number; totalErrors: number } | null>(null);
  const [runError, setRunError] = useState<string | null>(null);
  const [expandedBatches, setExpandedBatches] = useState<Set<string>>(new Set());

  const fetchLogs = async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/admin/auto-create-certificates-log?limit=500');
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      if (data.success) setLogs(data.data || []);
    } catch { /* silent */ } finally {
      setLoading(false);
    }
  };

  useEffect(() => { fetchLogs(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const handleRunNow = async () => {
    setRunning(true);
    setRunResult(null);
    setRunError(null);
    try {
      const res = await fetch('/api/admin/run-auto-create-certificates', { method: 'POST' });
      const json = await res.json();
      if (!json.success) throw new Error(json.error || 'Run failed');
      const stats = json.stats || { totalGenerated: 0, totalSkipped: 0, totalErrors: 0 };
      setRunResult(stats);
      await fetchLogs();
    } catch (err) {
      setRunError(err instanceof Error ? err.message : 'Failed to run');
    } finally {
      setRunning(false);
    }
  };

  // Group by run_id
  const batches = useMemo(() => {
    const map = new Map<string, any[]>();
    for (const log of logs) {
      if (!map.has(log.run_id)) map.set(log.run_id, []);
      map.get(log.run_id)!.push(log);
    }
    return Array.from(map.entries());
  }, [logs]);

  useEffect(() => {
    if (batches.length > 0) setExpandedBatches(new Set([batches[0][0]]));
  }, [batches.length]); // eslint-disable-line react-hooks/exhaustive-deps

  const toggleBatch = (runId: string) => {
    setExpandedBatches(prev => {
      const next = new Set(prev);
      next.has(runId) ? next.delete(runId) : next.add(runId);
      return next;
    });
  };

  const statusBadge = (status: string) => {
    const cls = status === 'created' ? 'bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-300'
      : status === 'error' ? 'bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300'
      : status === 'skipped' ? 'bg-yellow-100 text-yellow-700 dark:bg-yellow-900/40 dark:text-yellow-300'
      : 'bg-gray-100 text-gray-600 dark:bg-gray-700 dark:text-gray-300';
    return (
      <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-semibold ${cls}`}>
        {status}
      </span>
    );
  };

  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-3 mb-6">
        <h2 className="text-3xl font-bold">Auto-Create Certificates Log</h2>
        <div className="flex items-center gap-2">
          <Button onClick={handleRunNow} disabled={running || loading}>
            {running ? 'Running…' : 'Run Now'}
          </Button>
          <Button variant="ghost" onClick={fetchLogs} disabled={loading || running}>
            {loading ? 'Refreshing…' : 'Refresh'}
          </Button>
          <Button variant="ghost" onClick={() => setAdminPage(AdminPage.Scheduler)}>
            ← Back to Scheduler
          </Button>
        </div>
      </div>

      <p className="text-sm text-gray-500 dark:text-gray-400 mb-4">
        Daily at 6:30 PM SGT. Generates certificates for learners who meet attendance thresholds in recently-ended course runs, and emails them. Use <strong>Run Now</strong> to trigger manually.
      </p>

      {runResult && (
        <div className="mb-4 p-3 rounded-lg bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800 text-sm text-green-800 dark:text-green-300">
          ✅ Done — {runResult.totalGenerated} generated, {runResult.totalSkipped} skipped, {runResult.totalErrors} error(s).
        </div>
      )}
      {runError && (
        <div className="mb-4 p-3 rounded-lg bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 text-sm text-red-800 dark:text-red-300">
          ❌ {runError}
        </div>
      )}

      {loading && <p className="text-sm text-gray-500 py-6 text-center">Loading…</p>}

      {!loading && batches.length === 0 && (
        <p className="text-sm text-gray-500 py-6 text-center">No logs yet. Click <strong>Run Now</strong> to trigger this cron manually.</p>
      )}

      {batches.map(([runId, rows]) => {
        const isOpen = expandedBatches.has(runId);
        const ts = new Date(rows[0].created_at).toLocaleString('en-SG', {
          timeZone: 'Asia/Singapore', day: '2-digit', month: 'short', year: 'numeric',
          hour: '2-digit', minute: '2-digit', hour12: false,
        });
        const createdCount = rows.filter((r: any) => r.status === 'created').length;
        const skippedCount = rows.filter((r: any) => r.status === 'skipped').length;
        const errorCount   = rows.filter((r: any) => r.status === 'error').length;

        return (
          <div key={runId} className="mb-3 border border-gray-200 dark:border-gray-700 rounded-xl overflow-hidden">
            <button
              onClick={() => toggleBatch(runId)}
              className="w-full flex items-center justify-between px-4 py-3 bg-gray-50 dark:bg-slate-700/50 hover:bg-gray-100 dark:hover:bg-slate-700 text-left"
            >
              <div className="flex items-center gap-3">
                <span className="text-sm font-semibold text-gray-800 dark:text-gray-200">{ts} SGT</span>
                <span className="text-xs text-gray-500">{rows.length} row(s)</span>
                {createdCount > 0 && <span className="text-xs text-green-600 dark:text-green-400">{createdCount} created</span>}
                {skippedCount > 0 && <span className="text-xs text-yellow-600 dark:text-yellow-400">{skippedCount} skipped</span>}
                {errorCount   > 0 && <span className="text-xs text-red-600 dark:text-red-400">{errorCount} error</span>}
              </div>
              <span className="text-gray-400 text-xs">{isOpen ? '▲' : '▼'}</span>
            </button>

            {isOpen && (
              <div className="overflow-x-auto">
                <table className="min-w-full text-xs">
                  <thead className="bg-gray-50 dark:bg-slate-700/30">
                    <tr>
                      {['Course Run ID', 'Course Code', 'Course Title', 'Learner Name', 'Learner Email', 'NRIC', 'Status', 'Certificate', 'Error'].map(h => (
                        <th key={h} className="px-3 py-2 text-left font-semibold text-gray-600 dark:text-gray-300 whitespace-nowrap">{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100 dark:divide-gray-700">
                    {rows.map((row: any) => (
                      <tr key={row.id} className="hover:bg-gray-50 dark:hover:bg-slate-700/30">
                        <td className="px-3 py-2 font-mono text-gray-700 dark:text-gray-300 whitespace-nowrap">{row.course_run_id ?? '—'}</td>
                        <td className="px-3 py-2 font-mono text-gray-700 dark:text-gray-300 whitespace-nowrap">{row.course_code ?? '—'}</td>
                        <td className="px-3 py-2 max-w-[260px] truncate" title={row.course_title ?? ''}>{row.course_title ?? '—'}</td>
                        <td className="px-3 py-2 whitespace-nowrap">{row.learner_name ?? '—'}</td>
                        <td className="px-3 py-2 whitespace-nowrap">{row.learner_email ?? '—'}</td>
                        <td className="px-3 py-2 whitespace-nowrap font-mono text-gray-500">{row.nric ?? '—'}</td>
                        <td className="px-3 py-2">{statusBadge(row.status)}</td>
                        <td className="px-3 py-2">
                          {row.certificate_url ? (
                            <a href={row.certificate_url} target="_blank" rel="noreferrer" className="text-blue-600 dark:text-blue-400 hover:underline font-mono text-xs inline-flex items-center gap-1">
                              <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
                              </svg>
                              View
                            </a>
                          ) : <span className="text-gray-400">—</span>}
                        </td>
                        <td className="px-3 py-2 max-w-[320px] truncate text-red-600 dark:text-red-400" title={row.error_message ?? ''}>{row.error_message ?? ''}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
};

// ── Upcoming Course Runs Log ───────────────────────────────────────────────────

interface UpcomingRunLogRow {
  id: number;
  run_id: string;
  created_at: string;
  course_run_id: string;
  course_title: string;
  course_code: string;
  db_start_date: string | null;
  db_end_date: string | null;
  ssg_start_date: string | null;
  ssg_end_date: string | null;
  mode_of_learning: string | null;
  vacancy_code: string | null;
  status: string;
  error_message: string | null;
}

export const UpcomingCourseRunsLogView: React.FC = () => {
  const { setAdminPage } = useLms();
  const [logs, setLogs] = useState<UpcomingRunLogRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [running, setRunning] = useState(false);
  const [runResult, setRunResult] = useState<{ processed: number; success: number; errors: number; thresholdDays: number } | null>(null);
  const [runError, setRunError] = useState<string | null>(null);
  const [expandedBatches, setExpandedBatches] = useState<Set<string>>(new Set());

  const fetchLogs = async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/admin/upcoming-course-runs-logs?limit=500');
      const json = await res.json();
      if (json.success) setLogs(json.data);
    } catch { /* silent */ } finally {
      setLoading(false);
    }
  };

  useEffect(() => { fetchLogs(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const handleRunNow = async () => {
    setRunning(true);
    setRunResult(null);
    setRunError(null);
    try {
      const res = await fetch('/api/admin/run-upcoming-course-runs', { method: 'POST' });
      const json = await res.json();
      if (!json.success) throw new Error(json.error || 'Run failed');
      setRunResult({ processed: json.processed, success: json.success, errors: json.errors, thresholdDays: json.thresholdDays });
      await fetchLogs();
    } catch (err) {
      setRunError(err instanceof Error ? err.message : 'Failed to run');
    } finally {
      setRunning(false);
    }
  };

  // Group by run_id batch
  const batches = useMemo(() => {
    const map = new Map<string, UpcomingRunLogRow[]>();
    for (const log of logs) {
      if (!map.has(log.run_id)) map.set(log.run_id, []);
      map.get(log.run_id)!.push(log);
    }
    return Array.from(map.entries());
  }, [logs]);

  useEffect(() => {
    if (batches.length > 0) setExpandedBatches(new Set([batches[0][0]]));
  }, [batches.length]); // eslint-disable-line react-hooks/exhaustive-deps

  const toggleBatch = (runId: string) => {
    setExpandedBatches(prev => {
      const next = new Set(prev);
      next.has(runId) ? next.delete(runId) : next.add(runId);
      return next;
    });
  };

  const statusBadge = (status: string) => {
    const map: Record<string, string> = {
      success:  'bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-300',
      error:    'bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300',
      pending:  'bg-yellow-100 text-yellow-700 dark:bg-yellow-900/40 dark:text-yellow-300',
    };
    return (
      <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-semibold ${map[status] ?? 'bg-gray-100 text-gray-600'}`}>
        {status}
      </span>
    );
  };

  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-3 mb-6">
        <h2 className="text-3xl font-bold">TGS Enrolments &amp; Assign Trainers Log</h2>
        <div className="flex items-center gap-2">
          <Button onClick={handleRunNow} disabled={running || loading}>
            {running ? 'Running…' : 'Run Now'}
          </Button>
          <Button variant="ghost" onClick={fetchLogs} disabled={loading || running}>
            {loading ? 'Refreshing…' : 'Refresh'}
          </Button>
          <Button variant="ghost" onClick={() => setAdminPage(AdminPage.Dashboard)}>
            Back
          </Button>
        </div>
      </div>

      <p className="text-sm text-gray-500 dark:text-gray-400 mb-4">
        Daily automation (2 AM SGT): for each upcoming TGS- course run within the configured threshold window, searches SSG for enrolments and assigns trainers accordingly. Use <strong>Run Now</strong> to trigger manually.
      </p>

      {runResult && (
        <div className="mb-4 p-3 rounded-lg bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800 text-sm text-green-800 dark:text-green-300">
          ✅ Done — processed <strong>{runResult.processed}</strong> run(s) within <strong>{runResult.thresholdDays}</strong>-day window: {runResult.success} succeeded, {runResult.errors} error(s).
        </div>
      )}
      {runError && (
        <div className="mb-4 p-3 rounded-lg bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 text-sm text-red-800 dark:text-red-300">
          ❌ {runError}
        </div>
      )}

      {loading && <p className="text-sm text-gray-500 py-6 text-center">Loading…</p>}

      {!loading && batches.length === 0 && (
        <p className="text-sm text-gray-500 py-6 text-center">No logs yet. Click <strong>Run Now</strong> to fetch TGS enrolments and assign trainers.</p>
      )}

      {batches.map(([runId, rows]) => {
        const isOpen = expandedBatches.has(runId);
        const ts = new Date(rows[0].created_at).toLocaleString('en-SG', {
          timeZone: 'Asia/Singapore', day: '2-digit', month: 'short', year: 'numeric',
          hour: '2-digit', minute: '2-digit', hour12: false,
        });
        const successCount = rows.filter(r => r.status === 'success').length;
        const errorCount   = rows.filter(r => r.status === 'error').length;

        return (
          <div key={runId} className="mb-3 border border-gray-200 dark:border-gray-700 rounded-xl overflow-hidden">
            <button
              onClick={() => toggleBatch(runId)}
              className="w-full flex items-center justify-between px-4 py-3 bg-gray-50 dark:bg-slate-700/50 hover:bg-gray-100 dark:hover:bg-slate-700 text-left"
            >
              <div className="flex items-center gap-3">
                <span className="text-sm font-semibold text-gray-800 dark:text-gray-200">{ts} SGT</span>
                <span className="text-xs text-gray-500">{rows.length} run(s)</span>
                {successCount > 0 && <span className="text-xs text-green-600 dark:text-green-400">{successCount} ok</span>}
                {errorCount   > 0 && <span className="text-xs text-red-600 dark:text-red-400">{errorCount} error</span>}
              </div>
              <span className="text-gray-400 text-xs">{isOpen ? '▲' : '▼'}</span>
            </button>

            {isOpen && (
              <div className="overflow-x-auto">
                <table className="min-w-full text-xs">
                  <thead className="bg-gray-50 dark:bg-slate-700/30">
                    <tr>
                      {['Course Run ID', 'Course Code', 'Title', 'DB Start', 'SSG Start', 'SSG End', 'Mode', 'Vacancy', 'Status', 'Error'].map(h => (
                        <th key={h} className="px-3 py-2 text-left font-semibold text-gray-600 dark:text-gray-300 whitespace-nowrap">{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100 dark:divide-gray-700">
                    {rows.map(row => (
                      <tr key={row.id} className="hover:bg-gray-50 dark:hover:bg-slate-700/30">
                        <td className="px-3 py-2 font-mono text-gray-700 dark:text-gray-300 whitespace-nowrap">{row.course_run_id}</td>
                        <td className="px-3 py-2 whitespace-nowrap">{row.course_code}</td>
                        <td className="px-3 py-2 max-w-[200px] truncate">{row.course_title}</td>
                        <td className="px-3 py-2 whitespace-nowrap">{row.db_start_date ?? '—'}</td>
                        <td className="px-3 py-2 whitespace-nowrap">{row.ssg_start_date ?? '—'}</td>
                        <td className="px-3 py-2 whitespace-nowrap">{row.ssg_end_date ?? '—'}</td>
                        <td className="px-3 py-2 whitespace-nowrap">{row.mode_of_learning ?? '—'}</td>
                        <td className="px-3 py-2 whitespace-nowrap">{row.vacancy_code ?? '—'}</td>
                        <td className="px-3 py-2">{statusBadge(row.status)}</td>
                        <td className="px-3 py-2 text-red-600 dark:text-red-400 max-w-[180px] truncate">{row.error_message ?? ''}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
};

// ── Course Confirmation Email Logs ───────────────────────────────────────────

interface ConfirmationEmailLogRow {
  id: number;
  run_id: string;
  course_run_id: string | null;
  course_title: string | null;
  course_code: string | null;
  learner_name: string | null;
  learner_email: string | null;
  status: string;
  error_message: string | null;
  created_at: string;
}

export const CourseConfirmationEmailLogsView: React.FC = () => {
  const { setAdminPage } = useLms();
  const [logs, setLogs] = useState<ConfirmationEmailLogRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [expandedDates, setExpandedDates] = useState<Set<string>>(new Set());

  const fetchLogs = async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/admin/course-confirmation-email-logs?limit=500');
      const json = await res.json();
      if (json.success) setLogs(json.data);
    } catch {
      /* silent */
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { fetchLogs(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const batches = useMemo(() => {
    const map = new Map<string, ConfirmationEmailLogRow[]>();
    for (const log of logs) {
      if (!map.has(log.run_id)) map.set(log.run_id, []);
      map.get(log.run_id)!.push(log);
    }
    return Array.from(map.entries());
  }, [logs]);

  useEffect(() => {
    if (batches.length > 0) {
      setExpandedDates(new Set([batches[0][0]]));
    }
  }, [batches.length]); // eslint-disable-line react-hooks/exhaustive-deps

  const toggleDate = (key: string) => {
    setExpandedDates(prev => {
      const next = new Set(prev);
      next.has(key) ? next.delete(key) : next.add(key);
      return next;
    });
  };

  const statusBadge = (status: string) => {
    const map: Record<string, string> = {
      sent:    'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300',
      skipped: 'bg-yellow-100 text-yellow-700 dark:bg-yellow-900/40 dark:text-yellow-300',
      error:   'bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300',
      summary: 'bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300',
    };
    return (
      <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-semibold ${map[status] ?? map.error}`}>
        {status}
      </span>
    );
  };

  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-3 mb-6">
        <h2 className="text-3xl font-bold dark:text-white">Course Confirmation Email Logs</h2>
        <div className="flex items-center gap-2">
          <Button variant="ghost" onClick={fetchLogs} disabled={loading}>
            {loading ? 'Refreshing…' : 'Refresh'}
          </Button>
          <Button variant="ghost" onClick={() => setAdminPage(AdminPage.Scheduler)}>
            ← Back to Scheduler
          </Button>
        </div>
      </div>

      {loading && logs.length === 0 && (
        <div className="flex justify-center py-16">
          <div className="text-center">
            <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-500 mx-auto" />
            <p className="mt-4 text-gray-600 dark:text-gray-400">Loading logs...</p>
          </div>
        </div>
      )}

      {!loading && logs.length === 0 && (
        <Card className="p-10">
          <div className="text-center text-gray-500 dark:text-gray-400">
            <p className="text-lg font-medium">No confirmation email logs yet</p>
            <p className="text-sm mt-1">Logs will appear here after the scheduled task runs.</p>
          </div>
        </Card>
      )}

      {batches.map(([runId, entries]) => {
        const isOpen = expandedDates.has(runId);
        const date = entries[0]?.created_at ? new Date(entries[0].created_at).toLocaleString('en-SG', {
          day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', hour12: true, timeZone: 'Asia/Singapore',
        }) : runId;
        const sentCount = entries.filter(e => e.status === 'sent').length;
        const errorCount = entries.filter(e => e.status === 'error').length;
        const skippedCount = entries.filter(e => e.status === 'skipped').length;

        return (
          <div key={runId} className="mb-3">
            <button onClick={() => toggleDate(runId)} className="w-full flex items-center justify-between px-4 py-3 bg-gray-100 dark:bg-gray-800 rounded-lg hover:bg-gray-200 dark:hover:bg-gray-700 transition-colors">
              <div className="flex items-center gap-3">
                <span className={`transform transition-transform ${isOpen ? 'rotate-90' : ''}`}>▶</span>
                <span className="font-semibold text-gray-900 dark:text-white">{date}</span>
                <span className="text-xs text-gray-500 dark:text-gray-400">({entries.length} records)</span>
              </div>
              <div className="flex items-center gap-2 text-xs">
                {sentCount > 0 && <span className="px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300 font-semibold">{sentCount} sent</span>}
                {skippedCount > 0 && <span className="px-2 py-0.5 rounded-full bg-yellow-100 text-yellow-700 dark:bg-yellow-900/40 dark:text-yellow-300 font-semibold">{skippedCount} skipped</span>}
                {errorCount > 0 && <span className="px-2 py-0.5 rounded-full bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300 font-semibold">{errorCount} errors</span>}
              </div>
            </button>

            {isOpen && (
              <div className="mt-1 overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-left text-xs text-gray-500 dark:text-gray-400 uppercase">
                      <th className="px-3 py-2">Status</th>
                      <th className="px-3 py-2">Learner</th>
                      <th className="px-3 py-2">Email</th>
                      <th className="px-3 py-2">Course</th>
                      <th className="px-3 py-2">Course Run ID</th>
                      <th className="px-3 py-2">Error</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100 dark:divide-gray-700">
                    {entries.map(entry => (
                      <tr key={entry.id} className="hover:bg-gray-50 dark:hover:bg-gray-800/50">
                        <td className="px-3 py-2">{statusBadge(entry.status)}</td>
                        <td className="px-3 py-2 text-gray-900 dark:text-white">{entry.learner_name || '—'}</td>
                        <td className="px-3 py-2 text-gray-600 dark:text-gray-400 font-mono text-xs">{entry.learner_email || '—'}</td>
                        <td className="px-3 py-2 text-gray-900 dark:text-white">{entry.course_title || '—'}</td>
                        <td className="px-3 py-2 text-gray-500 dark:text-gray-400 font-mono text-xs">{entry.course_run_id || '—'}</td>
                        <td className="px-3 py-2 text-red-600 dark:text-red-400 text-xs max-w-xs truncate" title={entry.error_message || ''}>{entry.error_message || '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
};

// ── Sync Trainer to TPG Log ───────────────────────────────────────────────────

interface SyncTrainerTpgLogRow {
  id: number;
  run_id: string;
  created_at: string;
  course_run_id: string | null;
  course_code: string | null;
  course_ref_number: string | null;
  trainer_name: string | null;
  trainer_email: string | null;
  nric_present: boolean;
  nric_masked: string | null;
  ssg_status: number | null;
  status: string;
  error_message: string | null;
}

export const SyncTrainerTpgLogsView: React.FC = () => {
  const { setAdminPage } = useLms();
  const [logs, setLogs] = useState<SyncTrainerTpgLogRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [running, setRunning] = useState(false);
  const [runResult, setRunResult] = useState<{ total: number; successCount: number; skipped: number; errors: number; thresholdDays: number } | null>(null);
  const [runError, setRunError] = useState<string | null>(null);
  const [expandedBatches, setExpandedBatches] = useState<Set<string>>(new Set());

  const fetchLogs = async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/admin/sync-trainer-tpg-logs?limit=500');
      const json = await res.json();
      if (json.success) setLogs(json.data);
    } catch { /* silent */ } finally {
      setLoading(false);
    }
  };

  useEffect(() => { fetchLogs(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const handleRunNow = async () => {
    setRunning(true);
    setRunResult(null);
    setRunError(null);
    try {
      const res = await fetch('/api/admin/run-sync-trainer-tpg', { method: 'POST' });
      const json = await res.json();
      if (!json.success) throw new Error(json.error || 'Run failed');
      setRunResult({ total: json.total, successCount: json.successCount, skipped: json.skipped, errors: json.errors, thresholdDays: json.thresholdDays });
      await fetchLogs();
    } catch (err) {
      setRunError(err instanceof Error ? err.message : 'Failed to run');
    } finally {
      setRunning(false);
    }
  };

  const batches = useMemo(() => {
    const map = new Map<string, SyncTrainerTpgLogRow[]>();
    for (const log of logs) {
      if (!map.has(log.run_id)) map.set(log.run_id, []);
      map.get(log.run_id)!.push(log);
    }
    return Array.from(map.entries());
  }, [logs]);

  useEffect(() => {
    if (batches.length > 0) setExpandedBatches(new Set([batches[0][0]]));
  }, [batches.length]); // eslint-disable-line react-hooks/exhaustive-deps

  const toggleBatch = (runId: string) => {
    setExpandedBatches(prev => {
      const next = new Set(prev);
      next.has(runId) ? next.delete(runId) : next.add(runId);
      return next;
    });
  };

  const statusBadge = (status: string) => {
    const map: Record<string, string> = {
      success: 'bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-300',
      error:   'bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300',
      skipped: 'bg-yellow-100 text-yellow-700 dark:bg-yellow-900/40 dark:text-yellow-300',
      pending: 'bg-gray-100 text-gray-600 dark:bg-gray-700 dark:text-gray-300',
    };
    return (
      <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-semibold ${map[status] ?? 'bg-gray-100 text-gray-600'}`}>
        {status}
      </span>
    );
  };

  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-3 mb-6">
        <h2 className="text-3xl font-bold">Sync Trainer to TPG Log</h2>
        <div className="flex items-center gap-2">
          <Button onClick={handleRunNow} disabled={running || loading}>
            {running ? 'Running…' : 'Run Now'}
          </Button>
          <Button variant="ghost" onClick={fetchLogs} disabled={loading || running}>
            {loading ? 'Refreshing…' : 'Refresh'}
          </Button>
          <Button variant="ghost" onClick={() => setAdminPage(AdminPage.Dashboard)}>
            Back
          </Button>
        </div>
      </div>

      <p className="text-sm text-gray-500 dark:text-gray-400 mb-4">
        Daily automation: for each upcoming confirmed course run with an assigned trainer (no TPG trainer yet), resolves the trainer's NRIC and syncs to SSG. Use <strong>Run Now</strong> to trigger manually.
      </p>

      {runResult && (
        <div className="mb-4 p-3 rounded-lg bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800 text-sm text-green-800 dark:text-green-300">
          ✅ Done — {runResult.total} run(s) within {runResult.thresholdDays}-day window: {runResult.successCount} synced, {runResult.skipped} skipped, {runResult.errors} error(s).
        </div>
      )}
      {runError && (
        <div className="mb-4 p-3 rounded-lg bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 text-sm text-red-800 dark:text-red-300">
          ❌ {runError}
        </div>
      )}

      {loading && <p className="text-sm text-gray-500 py-6 text-center">Loading…</p>}

      {!loading && batches.length === 0 && (
        <p className="text-sm text-gray-500 py-6 text-center">No logs yet. Click <strong>Run Now</strong> to sync trainers to TPG.</p>
      )}

      {batches.map(([runId, rows]) => {
        const isOpen = expandedBatches.has(runId);
        const ts = new Date(rows[0].created_at).toLocaleString('en-SG', {
          timeZone: 'Asia/Singapore', day: '2-digit', month: 'short', year: 'numeric',
          hour: '2-digit', minute: '2-digit', hour12: false,
        });
        const successCount = rows.filter(r => r.status === 'success').length;
        const errorCount   = rows.filter(r => r.status === 'error').length;
        const skippedCount = rows.filter(r => r.status === 'skipped').length;

        return (
          <div key={runId} className="mb-3 border border-gray-200 dark:border-gray-700 rounded-xl overflow-hidden">
            <button
              onClick={() => toggleBatch(runId)}
              className="w-full flex items-center justify-between px-4 py-3 bg-gray-50 dark:bg-slate-700/50 hover:bg-gray-100 dark:hover:bg-slate-700 text-left"
            >
              <div className="flex items-center gap-3">
                <span className="text-sm font-semibold text-gray-800 dark:text-gray-200">{ts} SGT</span>
                <span className="text-xs text-gray-500">{rows.length} run(s)</span>
                {successCount > 0 && <span className="text-xs text-green-600 dark:text-green-400">{successCount} synced</span>}
                {skippedCount > 0 && <span className="text-xs text-yellow-600 dark:text-yellow-400">{skippedCount} skipped</span>}
                {errorCount   > 0 && <span className="text-xs text-red-600 dark:text-red-400">{errorCount} error</span>}
              </div>
              <span className="text-gray-400 text-xs">{isOpen ? '▲' : '▼'}</span>
            </button>

            {isOpen && (
              <div className="overflow-x-auto">
                <table className="min-w-full text-xs">
                  <thead className="bg-gray-50 dark:bg-slate-700/30">
                    <tr>
                      {['Course Run ID', 'Course Code', 'Trainer Name', 'Trainer Email', 'NRIC', 'SSG Status', 'Status', 'Error'].map(h => (
                        <th key={h} className="px-3 py-2 text-left font-semibold text-gray-600 dark:text-gray-300 whitespace-nowrap">{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100 dark:divide-gray-700">
                    {rows.map(row => (
                      <tr key={row.id} className="hover:bg-gray-50 dark:hover:bg-slate-700/30">
                        <td className="px-3 py-2 font-mono text-gray-700 dark:text-gray-300 whitespace-nowrap">{row.course_run_id ?? '—'}</td>
                        <td className="px-3 py-2 whitespace-nowrap">{row.course_code ?? '—'}</td>
                        <td className="px-3 py-2 whitespace-nowrap">{row.trainer_name ?? '—'}</td>
                        <td className="px-3 py-2 whitespace-nowrap">{row.trainer_email ?? '—'}</td>
                        <td className="px-3 py-2 whitespace-nowrap font-mono">
                          {row.nric_present ? (row.nric_masked ?? '✓') : <span className="text-red-500">Not in database</span>}
                        </td>
                        <td className="px-3 py-2 whitespace-nowrap">{row.ssg_status ?? '—'}</td>
                        <td className="px-3 py-2">{statusBadge(row.status)}</td>
                        <td className="px-3 py-2 text-red-600 dark:text-red-400 max-w-[200px] truncate">{row.error_message ?? ''}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
};

// ── Auto Send Trainer Invitation Log ─────────────────────────────────────────

interface AutoSendTrainerInvitationLogRow {
  id: number;
  run_id: string;
  created_at: string;
  course_run_uuid: string | null;
  course_run_id: string | null;
  course_title: string | null;
  trainer_name: string | null;
  trainer_email: string | null;
  status: string;
  message: string | null;
}

export const AutoSendTrainerInvitationLogView: React.FC = () => {
  const { setAdminPage } = useLms();
  const [logs, setLogs] = useState<AutoSendTrainerInvitationLogRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [running, setRunning] = useState(false);
  const [runResult, setRunResult] = useState<{ totalEligible: number; sent: number; skipped: number; errors: number; windowDays: number } | null>(null);
  const [runError, setRunError] = useState<string | null>(null);
  const [expandedBatches, setExpandedBatches] = useState<Set<string>>(new Set());

  const fetchLogs = async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/admin/auto-send-trainer-invitation-logs?limit=500');
      const json = await res.json();
      if (json.success) setLogs(json.data);
    } catch { /* silent */ } finally {
      setLoading(false);
    }
  };

  useEffect(() => { fetchLogs(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const handleRunNow = async () => {
    setRunning(true);
    setRunResult(null);
    setRunError(null);
    try {
      const res = await fetch('/api/admin/run-auto-send-trainer-invitations', { method: 'POST' });
      const json = await res.json();
      if (!json.success) throw new Error(json.error || 'Run failed');
      setRunResult({
        totalEligible: json.totalEligible,
        sent: json.sent,
        skipped: json.skipped,
        errors: json.errors,
        windowDays: json.windowDays,
      });
      await fetchLogs();
    } catch (err) {
      setRunError(err instanceof Error ? err.message : 'Failed to run');
    } finally {
      setRunning(false);
    }
  };

  const batches = useMemo(() => {
    const map = new Map<string, AutoSendTrainerInvitationLogRow[]>();
    for (const log of logs) {
      if (!map.has(log.run_id)) map.set(log.run_id, []);
      map.get(log.run_id)!.push(log);
    }
    return Array.from(map.entries());
  }, [logs]);

  useEffect(() => {
    if (batches.length > 0) setExpandedBatches(new Set([batches[0][0]]));
  }, [batches.length]); // eslint-disable-line react-hooks/exhaustive-deps

  const toggleBatch = (runId: string) => {
    setExpandedBatches(prev => {
      const next = new Set(prev);
      next.has(runId) ? next.delete(runId) : next.add(runId);
      return next;
    });
  };

  // Success, error, and every skipped_* variant share consistent colors so the
  // grouped header counts (sent / skipped / error) stay readable at a glance.
  const statusBadge = (status: string) => {
    let cls: string;
    if (status === 'sent') cls = 'bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-300';
    else if (status === 'error') cls = 'bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300';
    else if (status.startsWith('skipped')) cls = 'bg-yellow-100 text-yellow-700 dark:bg-yellow-900/40 dark:text-yellow-300';
    else cls = 'bg-gray-100 text-gray-600 dark:bg-gray-700 dark:text-gray-300';
    return (
      <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-semibold ${cls}`}>
        {status}
      </span>
    );
  };

  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-3 mb-6">
        <h2 className="text-3xl font-bold">Auto Send Trainer Invitation Log</h2>
        <div className="flex items-center gap-2">
          <Button onClick={handleRunNow} disabled={running || loading}>
            {running ? 'Running…' : 'Run Now'}
          </Button>
          <Button variant="ghost" onClick={fetchLogs} disabled={loading || running}>
            {loading ? 'Refreshing…' : 'Refresh'}
          </Button>
          <Button variant="ghost" onClick={() => setAdminPage(AdminPage.Dashboard)}>
            Back
          </Button>
        </div>
      </div>

      <p className="text-sm text-gray-500 dark:text-gray-400 mb-4">
        Scheduled sweep (default Mon &amp; Thu 10:00 AM SGT): scans upcoming course runs within the lookahead window and, for every class missing a locally-assigned trainer, invites the next approved trainer who hasn't already been invited, declined, or assigned. Use <strong>Run Now</strong> to trigger manually.
      </p>

      {runResult && (
        <div className="mb-4 p-3 rounded-lg bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800 text-sm text-green-800 dark:text-green-300">
          ✅ Done — {runResult.totalEligible} eligible run(s) within {runResult.windowDays}-day window: {runResult.sent} sent, {runResult.skipped} skipped, {runResult.errors} error(s).
        </div>
      )}
      {runError && (
        <div className="mb-4 p-3 rounded-lg bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 text-sm text-red-800 dark:text-red-300">
          ❌ {runError}
        </div>
      )}

      {loading && <p className="text-sm text-gray-500 py-6 text-center">Loading…</p>}

      {!loading && batches.length === 0 && (
        <p className="text-sm text-gray-500 py-6 text-center">No logs yet. Click <strong>Run Now</strong> to invite trainers for upcoming classes.</p>
      )}

      {batches.map(([runId, rows]) => {
        const isOpen = expandedBatches.has(runId);
        const ts = new Date(rows[0].created_at).toLocaleString('en-SG', {
          timeZone: 'Asia/Singapore', day: '2-digit', month: 'short', year: 'numeric',
          hour: '2-digit', minute: '2-digit', hour12: false,
        });
        const sentCount    = rows.filter(r => r.status === 'sent').length;
        const skippedCount = rows.filter(r => r.status.startsWith('skipped')).length;
        const errorCount   = rows.filter(r => r.status === 'error').length;

        return (
          <div key={runId} className="mb-3 border border-gray-200 dark:border-gray-700 rounded-xl overflow-hidden">
            <button
              onClick={() => toggleBatch(runId)}
              className="w-full flex items-center justify-between px-4 py-3 bg-gray-50 dark:bg-slate-700/50 hover:bg-gray-100 dark:hover:bg-slate-700 text-left"
            >
              <div className="flex items-center gap-3">
                <span className="text-sm font-semibold text-gray-800 dark:text-gray-200">{ts} SGT</span>
                <span className="text-xs text-gray-500">{rows.length} row(s)</span>
                {sentCount    > 0 && <span className="text-xs text-green-600 dark:text-green-400">{sentCount} sent</span>}
                {skippedCount > 0 && <span className="text-xs text-yellow-600 dark:text-yellow-400">{skippedCount} skipped</span>}
                {errorCount   > 0 && <span className="text-xs text-red-600 dark:text-red-400">{errorCount} error</span>}
              </div>
              <span className="text-gray-400 text-xs">{isOpen ? '▲' : '▼'}</span>
            </button>

            {isOpen && (
              <div className="overflow-x-auto">
                <table className="min-w-full text-xs">
                  <thead className="bg-gray-50 dark:bg-slate-700/30">
                    <tr>
                      {['Course Run ID', 'Course Title', 'Trainer Name', 'Trainer Email', 'Status', 'Message'].map(h => (
                        <th key={h} className="px-3 py-2 text-left font-semibold text-gray-600 dark:text-gray-300 whitespace-nowrap">{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100 dark:divide-gray-700">
                    {rows.map(row => (
                      <tr key={row.id} className="hover:bg-gray-50 dark:hover:bg-slate-700/30">
                        <td className="px-3 py-2 font-mono text-gray-700 dark:text-gray-300 whitespace-nowrap">{row.course_run_id ?? '—'}</td>
                        <td className="px-3 py-2 max-w-[220px] truncate">{row.course_title ?? '—'}</td>
                        <td className="px-3 py-2 whitespace-nowrap">{row.trainer_name ?? '—'}</td>
                        <td className="px-3 py-2 whitespace-nowrap">{row.trainer_email ?? '—'}</td>
                        <td className="px-3 py-2">{statusBadge(row.status)}</td>
                        <td className="px-3 py-2 max-w-[320px] truncate" title={row.message ?? ''}>{row.message ?? ''}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
};

// ── Auto Sanitise Data Log ───────────────────────────────────────────────────

interface AutoSanitiseDataLogRow {
  id: number;
  run_id: string;
  created_at: string;
  table_name: string;
  rows_scanned: number;
  rows_updated: number;
  cutoff_date: string | null;
  status: string;
  message: string | null;
}

export const AutoSanitiseDataLogView: React.FC = () => {
  const { setAdminPage } = useLms();
  const [logs, setLogs] = useState<AutoSanitiseDataLogRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [running, setRunning] = useState(false);
  const [runResult, setRunResult] = useState<{ totalScanned: number; totalUpdated: number; retentionMonths: number; cutoffDate: string; enabled: boolean } | null>(null);
  const [runError, setRunError] = useState<string | null>(null);
  const [expandedBatches, setExpandedBatches] = useState<Set<string>>(new Set());

  const fetchLogs = async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/admin/auto-sanitise-data-logs?limit=500');
      const json = await res.json();
      if (json.success) setLogs(json.data);
    } catch { /* silent */ } finally {
      setLoading(false);
    }
  };

  useEffect(() => { fetchLogs(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const handleRunNow = async () => {
    setRunning(true);
    setRunResult(null);
    setRunError(null);
    try {
      const res = await fetch('/api/admin/run-auto-sanitise-data', { method: 'POST' });
      const json = await res.json();
      if (!json.success) throw new Error(json.error || 'Run failed');
      setRunResult({
        totalScanned: json.totalScanned,
        totalUpdated: json.totalUpdated,
        retentionMonths: json.retentionMonths,
        cutoffDate: json.cutoffDate,
        enabled: json.enabled,
      });
      await fetchLogs();
    } catch (err) {
      setRunError(err instanceof Error ? err.message : 'Failed to run');
    } finally {
      setRunning(false);
    }
  };

  const batches = useMemo(() => {
    const map = new Map<string, AutoSanitiseDataLogRow[]>();
    for (const log of logs) {
      if (!map.has(log.run_id)) map.set(log.run_id, []);
      map.get(log.run_id)!.push(log);
    }
    return Array.from(map.entries());
  }, [logs]);

  useEffect(() => {
    if (batches.length > 0) setExpandedBatches(new Set([batches[0][0]]));
  }, [batches.length]); // eslint-disable-line react-hooks/exhaustive-deps

  const toggleBatch = (runId: string) => {
    setExpandedBatches(prev => {
      const next = new Set(prev);
      next.has(runId) ? next.delete(runId) : next.add(runId);
      return next;
    });
  };

  const statusBadge = (status: string) => {
    let cls: string;
    if (status === 'success') cls = 'bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-300';
    else if (status === 'error') cls = 'bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300';
    else if (status === 'skipped') cls = 'bg-yellow-100 text-yellow-700 dark:bg-yellow-900/40 dark:text-yellow-300';
    else cls = 'bg-gray-100 text-gray-600 dark:bg-gray-700 dark:text-gray-300';
    return (
      <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-semibold ${cls}`}>
        {status}
      </span>
    );
  };

  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-3 mb-6">
        <h2 className="text-3xl font-bold">Auto Sanitise Data Log</h2>
        <div className="flex items-center gap-2">
          <Button onClick={handleRunNow} disabled={running || loading}>
            {running ? 'Running…' : 'Run Once'}
          </Button>
          <Button variant="ghost" onClick={fetchLogs} disabled={loading || running}>
            {loading ? 'Refreshing…' : 'Refresh'}
          </Button>
          <Button variant="ghost" onClick={() => setAdminPage(AdminPage.Dashboard)}>
            Back
          </Button>
        </div>
      </div>

      <p className="text-sm text-gray-500 dark:text-gray-400 mb-4">
        Weekly sweep (default Sunday 02:00 SGT): redacts NRIC and phone digits on rows older than the retention window configured in <strong>Company Settings → Security Setting → Auto Sanitise Data</strong>. Honours the master toggle (off → skipped). Use <strong>Run Once</strong> to trigger manually.
      </p>

      {runResult && (
        <div className={`mb-4 p-3 rounded-lg border text-sm ${runResult.enabled
          ? 'bg-green-50 dark:bg-green-900/20 border-green-200 dark:border-green-800 text-green-800 dark:text-green-300'
          : 'bg-yellow-50 dark:bg-yellow-900/20 border-yellow-200 dark:border-yellow-800 text-yellow-800 dark:text-yellow-300'}`}>
          {runResult.enabled
            ? <>✅ Done — scanned <strong>{runResult.totalScanned}</strong>, sanitised <strong>{runResult.totalUpdated}</strong> row(s) older than {runResult.cutoffDate} (retention {runResult.retentionMonths} months).</>
            : <>⚠️ Skipped — Auto Sanitise Data is currently <strong>disabled</strong>. Enable it in Company Settings → Security Setting.</>
          }
        </div>
      )}
      {runError && (
        <div className="mb-4 p-3 rounded-lg bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 text-sm text-red-800 dark:text-red-300">
          ❌ {runError}
        </div>
      )}

      {loading && <p className="text-sm text-gray-500 py-6 text-center">Loading…</p>}

      {!loading && batches.length === 0 && (
        <p className="text-sm text-gray-500 py-6 text-center">No logs yet. Click <strong>Run Once</strong> to sanitise old PII now.</p>
      )}

      {batches.map(([runId, rows]) => {
        const isOpen = expandedBatches.has(runId);
        const ts = new Date(rows[0].created_at).toLocaleString('en-SG', {
          timeZone: 'Asia/Singapore', day: '2-digit', month: 'short', year: 'numeric',
          hour: '2-digit', minute: '2-digit', hour12: false,
        });
        const totalScanned = rows.reduce((sum, r) => sum + (r.rows_scanned || 0), 0);
        const totalUpdated = rows.reduce((sum, r) => sum + (r.rows_updated || 0), 0);
        const errorCount   = rows.filter(r => r.status === 'error').length;
        const skippedCount = rows.filter(r => r.status === 'skipped').length;

        return (
          <div key={runId} className="mb-3 border border-gray-200 dark:border-gray-700 rounded-xl overflow-hidden">
            <button
              onClick={() => toggleBatch(runId)}
              className="w-full flex items-center justify-between px-4 py-3 bg-gray-50 dark:bg-slate-700/50 hover:bg-gray-100 dark:hover:bg-slate-700 text-left"
            >
              <div className="flex items-center gap-3">
                <span className="text-sm font-semibold text-gray-800 dark:text-gray-200">{ts} SGT</span>
                <span className="text-xs text-gray-500">{rows.length} table(s)</span>
                {totalUpdated > 0 && <span className="text-xs text-green-600 dark:text-green-400">{totalUpdated} sanitised / {totalScanned} scanned</span>}
                {totalUpdated === 0 && totalScanned > 0 && <span className="text-xs text-gray-500 dark:text-gray-400">{totalScanned} scanned</span>}
                {skippedCount > 0 && <span className="text-xs text-yellow-600 dark:text-yellow-400">{skippedCount} skipped</span>}
                {errorCount > 0 && <span className="text-xs text-red-600 dark:text-red-400">{errorCount} error</span>}
              </div>
              <span className="text-gray-400 text-xs">{isOpen ? '▲' : '▼'}</span>
            </button>

            {isOpen && (
              <div className="overflow-x-auto">
                <table className="min-w-full text-xs">
                  <thead className="bg-gray-50 dark:bg-slate-700/30">
                    <tr>
                      {['Table', 'Scanned', 'Updated', 'Cutoff Date', 'Status', 'Message'].map(h => (
                        <th key={h} className="px-3 py-2 text-left font-semibold text-gray-600 dark:text-gray-300 whitespace-nowrap">{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100 dark:divide-gray-700">
                    {rows.map(row => (
                      <tr key={row.id} className="hover:bg-gray-50 dark:hover:bg-slate-700/30">
                        <td className="px-3 py-2 font-mono text-gray-700 dark:text-gray-300 whitespace-nowrap">{row.table_name}</td>
                        <td className="px-3 py-2 text-right tabular-nums">{row.rows_scanned}</td>
                        <td className="px-3 py-2 text-right tabular-nums font-semibold">{row.rows_updated}</td>
                        <td className="px-3 py-2 whitespace-nowrap">{row.cutoff_date ?? '—'}</td>
                        <td className="px-3 py-2">{statusBadge(row.status)}</td>
                        <td className="px-3 py-2 max-w-[320px] truncate" title={row.message ?? ''}>{row.message ?? ''}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
};

// ── Auto Send Courseware/Attendance + Course Completion Logs ─────────────────

interface AutoSendEmailLogRow {
  id: number;
  run_id: string;
  created_at: string;
  course_run_id: string | null;
  course_code: string | null;
  course_title: string | null;
  learner_name: string | null;
  learner_email: string | null;
  status: string;
  error_message: string | null;
}

const AutoSendEmailLogView: React.FC<{
  title: string;
  description: React.ReactNode;
  logsEndpoint: string;
  runEndpoint: string;
}> = ({ title, description, logsEndpoint, runEndpoint }) => {
  const { setAdminPage } = useLms();
  const [logs, setLogs] = useState<AutoSendEmailLogRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [running, setRunning] = useState(false);
  const [runResult, setRunResult] = useState<{ totalSent: number; totalSkipped: number; totalErrors: number } | null>(null);
  const [runError, setRunError] = useState<string | null>(null);
  const [expandedBatches, setExpandedBatches] = useState<Set<string>>(new Set());

  const fetchLogs = async () => {
    setLoading(true);
    try {
      const res = await fetch(`${logsEndpoint}?limit=500`);
      const json = await res.json();
      if (json.success) setLogs(json.data);
    } catch { /* silent */ } finally {
      setLoading(false);
    }
  };

  useEffect(() => { fetchLogs(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const handleRunNow = async () => {
    setRunning(true);
    setRunResult(null);
    setRunError(null);
    try {
      const res = await fetch(runEndpoint, { method: 'POST' });
      const json = await res.json();
      if (!json.success) throw new Error(json.error || 'Run failed');
      const stats = json.stats || { totalSent: 0, totalSkipped: 0, totalErrors: 0 };
      setRunResult(stats);
      await fetchLogs();
    } catch (err) {
      setRunError(err instanceof Error ? err.message : 'Failed to run');
    } finally {
      setRunning(false);
    }
  };

  const batches = useMemo(() => {
    const map = new Map<string, AutoSendEmailLogRow[]>();
    for (const log of logs) {
      if (!map.has(log.run_id)) map.set(log.run_id, []);
      map.get(log.run_id)!.push(log);
    }
    return Array.from(map.entries());
  }, [logs]);

  useEffect(() => {
    if (batches.length > 0) setExpandedBatches(new Set([batches[0][0]]));
  }, [batches.length]); // eslint-disable-line react-hooks/exhaustive-deps

  const toggleBatch = (runId: string) => {
    setExpandedBatches(prev => {
      const next = new Set(prev);
      next.has(runId) ? next.delete(runId) : next.add(runId);
      return next;
    });
  };

  const statusBadge = (status: string) => {
    const cls = status === 'sent' ? 'bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-300'
      : status === 'error' ? 'bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300'
      : status === 'skipped' ? 'bg-yellow-100 text-yellow-700 dark:bg-yellow-900/40 dark:text-yellow-300'
      : 'bg-gray-100 text-gray-600 dark:bg-gray-700 dark:text-gray-300';
    return (
      <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-semibold ${cls}`}>
        {status}
      </span>
    );
  };

  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-3 mb-6">
        <h2 className="text-3xl font-bold">{title}</h2>
        <div className="flex items-center gap-2">
          <Button onClick={handleRunNow} disabled={running || loading}>
            {running ? 'Running…' : 'Run Now'}
          </Button>
          <Button variant="ghost" onClick={fetchLogs} disabled={loading || running}>
            {loading ? 'Refreshing…' : 'Refresh'}
          </Button>
          <Button variant="ghost" onClick={() => setAdminPage(AdminPage.Dashboard)}>
            Back
          </Button>
        </div>
      </div>

      <p className="text-sm text-gray-500 dark:text-gray-400 mb-4">{description}</p>

      {runResult && (
        <div className="mb-4 p-3 rounded-lg bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800 text-sm text-green-800 dark:text-green-300">
          ✅ Done — {runResult.totalSent} sent, {runResult.totalSkipped} skipped, {runResult.totalErrors} error(s).
        </div>
      )}
      {runError && (
        <div className="mb-4 p-3 rounded-lg bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 text-sm text-red-800 dark:text-red-300">
          ❌ {runError}
        </div>
      )}

      {loading && <p className="text-sm text-gray-500 py-6 text-center">Loading…</p>}

      {!loading && batches.length === 0 && (
        <p className="text-sm text-gray-500 py-6 text-center">No logs yet. Click <strong>Run Now</strong> to trigger this cron manually.</p>
      )}

      {batches.map(([runId, rows]) => {
        const isOpen = expandedBatches.has(runId);
        const ts = new Date(rows[0].created_at).toLocaleString('en-SG', {
          timeZone: 'Asia/Singapore', day: '2-digit', month: 'short', year: 'numeric',
          hour: '2-digit', minute: '2-digit', hour12: false,
        });
        const sentCount    = rows.filter(r => r.status === 'sent').length;
        const skippedCount = rows.filter(r => r.status === 'skipped').length;
        const errorCount   = rows.filter(r => r.status === 'error').length;

        return (
          <div key={runId} className="mb-3 border border-gray-200 dark:border-gray-700 rounded-xl overflow-hidden">
            <button
              onClick={() => toggleBatch(runId)}
              className="w-full flex items-center justify-between px-4 py-3 bg-gray-50 dark:bg-slate-700/50 hover:bg-gray-100 dark:hover:bg-slate-700 text-left"
            >
              <div className="flex items-center gap-3">
                <span className="text-sm font-semibold text-gray-800 dark:text-gray-200">{ts} SGT</span>
                <span className="text-xs text-gray-500">{rows.length} row(s)</span>
                {sentCount    > 0 && <span className="text-xs text-green-600 dark:text-green-400">{sentCount} sent</span>}
                {skippedCount > 0 && <span className="text-xs text-yellow-600 dark:text-yellow-400">{skippedCount} skipped</span>}
                {errorCount   > 0 && <span className="text-xs text-red-600 dark:text-red-400">{errorCount} error</span>}
              </div>
              <span className="text-gray-400 text-xs">{isOpen ? '▲' : '▼'}</span>
            </button>

            {isOpen && (
              <div className="overflow-x-auto">
                <table className="min-w-full text-xs">
                  <thead className="bg-gray-50 dark:bg-slate-700/30">
                    <tr>
                      {['Course Run ID', 'Course Code', 'Course Title', 'Learner Name', 'Learner Email', 'Status', 'Error'].map(h => (
                        <th key={h} className="px-3 py-2 text-left font-semibold text-gray-600 dark:text-gray-300 whitespace-nowrap">{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100 dark:divide-gray-700">
                    {rows.map(row => (
                      <tr key={row.id} className="hover:bg-gray-50 dark:hover:bg-slate-700/30">
                        <td className="px-3 py-2 font-mono text-gray-700 dark:text-gray-300 whitespace-nowrap">{row.course_run_id ?? '—'}</td>
                        <td className="px-3 py-2 font-mono text-gray-700 dark:text-gray-300 whitespace-nowrap">{row.course_code ?? '—'}</td>
                        <td className="px-3 py-2 max-w-[260px] truncate" title={row.course_title ?? ''}>{row.course_title ?? '—'}</td>
                        <td className="px-3 py-2 whitespace-nowrap">{row.learner_name ?? '—'}</td>
                        <td className="px-3 py-2 whitespace-nowrap">{row.learner_email ?? '—'}</td>
                        <td className="px-3 py-2">{statusBadge(row.status)}</td>
                        <td className="px-3 py-2 max-w-[320px] truncate" title={row.error_message ?? ''}>{row.error_message ?? ''}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
};

export const AutoSendCoursewareAttendanceLogView: React.FC = () => (
  <AutoSendEmailLogView
    title="Auto Send Courseware and Attendance Log"
    description={<>Daily at 7:00 AM SGT. Sends the <strong>Courseware and Attendance Taking</strong> email template to all confirmed learners enrolled in course runs starting today. Use <strong>Run Now</strong> to trigger manually.</>}
    logsEndpoint="/api/admin/auto-send-courseware-attendance-logs"
    runEndpoint="/api/admin/run-auto-send-courseware-attendance"
  />
);

export const AutoSendCourseCompletionLogView: React.FC = () => (
  <AutoSendEmailLogView
    title="Auto Send Course Completion Log"
    description={<>Daily at 5:35 PM SGT. Sends the <strong>Course Completion and Thank You</strong> email template to all confirmed learners enrolled in course runs ending today. Use <strong>Run Now</strong> to trigger manually.</>}
    logsEndpoint="/api/admin/auto-send-course-completion-logs"
    runEndpoint="/api/admin/run-auto-send-course-completion"
  />
);

type ScheduledInvoiceLogRow = {
  id: number;
  run_id: string;
  created_at: string;
  status: string;
  application_id?: string | null;
  enrolment_id?: string | null;
  enrollment_id?: string | null;
  learner_name?: string | null;
  course_code?: string | null;
  course_title?: string | null;
  invoice_number?: string | null;
  drive_url?: string | null;
  stage?: string | null;
  failed_step?: string | null;
  message?: string | null;
  reason?: string | null;
  error_message?: string | null;
};

const ScheduledInvoiceLogView: React.FC<{
  title: string;
  description: React.ReactNode;
  logsEndpoint: string;
  runEndpoint: string;
  type: 'proforma' | 'da';
}> = ({ title, description, logsEndpoint, runEndpoint, type }) => {
  const { setAdminPage } = useLms();
  const [logs, setLogs] = useState<ScheduledInvoiceLogRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [running, setRunning] = useState(false);
  const [runResult, setRunResult] = useState<Record<string, number> | null>(null);
  const [runError, setRunError] = useState<string | null>(null);
  const [expandedBatches, setExpandedBatches] = useState<Set<string>>(new Set());

  const fetchLogs = async () => {
    setLoading(true);
    try {
      const res = await fetch(`${logsEndpoint}?limit=500`);
      const json = await res.json();
      if (json.success) setLogs(json.data || []);
    } catch {
      // Keep the page quiet; manual refresh can retry.
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { fetchLogs(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const handleRunNow = async () => {
    setRunning(true);
    setRunResult(null);
    setRunError(null);
    try {
      const res = await fetch(runEndpoint, { method: 'POST' });
      const json = await res.json();
      if (!json.success) throw new Error(json.error || 'Run failed');
      setRunResult(json.stats || {});
      await fetchLogs();
    } catch (err) {
      setRunError(err instanceof Error ? err.message : 'Failed to run');
    } finally {
      setRunning(false);
    }
  };

  const batches = useMemo(() => {
    const map = new Map<string, ScheduledInvoiceLogRow[]>();
    for (const log of logs) {
      if (!map.has(log.run_id)) map.set(log.run_id, []);
      map.get(log.run_id)!.push(log);
    }
    return Array.from(map.entries());
  }, [logs]);

  useEffect(() => {
    if (batches.length > 0) setExpandedBatches(new Set([batches[0][0]]));
  }, [batches.length]); // eslint-disable-line react-hooks/exhaustive-deps

  const toggleBatch = (runId: string) => {
    setExpandedBatches(prev => {
      const next = new Set(prev);
      next.has(runId) ? next.delete(runId) : next.add(runId);
      return next;
    });
  };

  const statusBadge = (status: string) => {
    const cls = ['generated', 'success'].includes(status)
      ? 'bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-300'
      : status === 'error'
        ? 'bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300'
        : status === 'skipped'
          ? 'bg-yellow-100 text-yellow-700 dark:bg-yellow-900/40 dark:text-yellow-300'
          : 'bg-gray-100 text-gray-600 dark:bg-gray-700 dark:text-gray-300';
    return <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-semibold ${cls}`}>{status}</span>;
  };

  const runSummary = runResult
    ? Object.entries(runResult)
        .filter(([, value]) => typeof value === 'number')
        .map(([key, value]) => `${key.replace(/^total/, '')}: ${value}`)
        .join(', ')
    : null;

  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-3 mb-6">
        <h2 className="text-3xl font-bold">{title}</h2>
        <div className="flex items-center gap-2">
          <Button onClick={handleRunNow} disabled={running || loading}>
            {running ? 'Running...' : 'Run Now'}
          </Button>
          <Button variant="ghost" onClick={fetchLogs} disabled={loading || running}>
            {loading ? 'Refreshing...' : 'Refresh'}
          </Button>
          <Button variant="ghost" onClick={() => setAdminPage(AdminPage.Scheduler)}>
            Back to Scheduler
          </Button>
        </div>
      </div>

      <p className="text-sm text-gray-500 dark:text-gray-400 mb-4">{description}</p>

      {runSummary && (
        <div className="mb-4 p-3 rounded-lg bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800 text-sm text-green-800 dark:text-green-300">
          Done - {runSummary}.
        </div>
      )}
      {runError && (
        <div className="mb-4 p-3 rounded-lg bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 text-sm text-red-800 dark:text-red-300">
          {runError}
        </div>
      )}

      {loading && <p className="text-sm text-gray-500 py-6 text-center">Loading...</p>}
      {!loading && batches.length === 0 && (
        <p className="text-sm text-gray-500 py-6 text-center">No logs yet. Click <strong>Run Now</strong> to trigger this cron manually.</p>
      )}

      {batches.map(([runId, rows]) => {
        const isOpen = expandedBatches.has(runId);
        const ts = new Date(rows[0].created_at).toLocaleString('en-SG', {
          timeZone: 'Asia/Singapore', day: '2-digit', month: 'short', year: 'numeric',
          hour: '2-digit', minute: '2-digit', hour12: false,
        });
        const successCount = rows.filter(r => ['generated', 'success'].includes(r.status)).length;
        const skippedCount = rows.filter(r => r.status === 'skipped').length;
        const errorCount = rows.filter(r => r.status === 'error').length;

        return (
          <div key={runId} className="mb-3 border border-gray-200 dark:border-gray-700 rounded-xl overflow-hidden">
            <button
              onClick={() => toggleBatch(runId)}
              className="w-full flex items-center justify-between px-4 py-3 bg-gray-50 dark:bg-slate-700/50 hover:bg-gray-100 dark:hover:bg-slate-700 text-left"
            >
              <div className="flex items-center gap-3">
                <span className="text-sm font-semibold text-gray-800 dark:text-gray-200">{ts} SGT</span>
                <span className="text-xs text-gray-500">{rows.length} row(s)</span>
                {successCount > 0 && <span className="text-xs text-green-600 dark:text-green-400">{successCount} ok</span>}
                {skippedCount > 0 && <span className="text-xs text-yellow-600 dark:text-yellow-400">{skippedCount} skipped</span>}
                {errorCount > 0 && <span className="text-xs text-red-600 dark:text-red-400">{errorCount} error</span>}
              </div>
              <span className="text-gray-400 text-xs">{isOpen ? '^' : 'v'}</span>
            </button>

            {isOpen && (
              <div className="overflow-x-auto">
                <table className="min-w-full text-xs">
                  <thead className="bg-gray-50 dark:bg-slate-700/30">
                    <tr>
                      {(type === 'proforma'
                        ? ['Enrolment ID', 'Learner', 'Course Code', 'Course Title', 'Invoice No.', 'Drive', 'Status', 'Message']
                        : ['Application ID', 'Enrolment ID', 'Stage', 'Status', 'Failed Step', 'Message', 'Error']
                      ).map(h => (
                        <th key={h} className="px-3 py-2 text-left font-semibold text-gray-600 dark:text-gray-300 whitespace-nowrap">{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100 dark:divide-gray-700">
                    {rows.map(row => (
                      <tr key={row.id} className="hover:bg-gray-50 dark:hover:bg-slate-700/30">
                        {type === 'proforma' ? (
                          <>
                            <td className="px-3 py-2 font-mono whitespace-nowrap">{row.enrolment_id ?? row.enrollment_id ?? '-'}</td>
                            <td className="px-3 py-2 whitespace-nowrap">{row.learner_name ?? '-'}</td>
                            <td className="px-3 py-2 font-mono whitespace-nowrap">{row.course_code ?? '-'}</td>
                            <td className="px-3 py-2 max-w-[260px] truncate" title={row.course_title ?? ''}>{row.course_title ?? '-'}</td>
                            <td className="px-3 py-2 font-mono whitespace-nowrap">{row.invoice_number ?? '-'}</td>
                            <td className="px-3 py-2 whitespace-nowrap">{row.drive_url ? <a className="text-blue-600 hover:underline" href={row.drive_url} target="_blank" rel="noreferrer">Open</a> : '-'}</td>
                            <td className="px-3 py-2">{statusBadge(row.status)}</td>
                            <td className="px-3 py-2 max-w-[320px] truncate" title={row.reason ?? row.error_message ?? ''}>{row.reason ?? row.error_message ?? ''}</td>
                          </>
                        ) : (
                          <>
                            <td className="px-3 py-2 font-mono whitespace-nowrap">{row.application_id ?? '-'}</td>
                            <td className="px-3 py-2 font-mono whitespace-nowrap">{row.enrolment_id ?? '-'}</td>
                            <td className="px-3 py-2 whitespace-nowrap">{row.stage ?? '-'}</td>
                            <td className="px-3 py-2">{statusBadge(row.status)}</td>
                            <td className="px-3 py-2 whitespace-nowrap">{row.failed_step ?? '-'}</td>
                            <td className="px-3 py-2 max-w-[320px] truncate" title={row.message ?? ''}>{row.message ?? ''}</td>
                            <td className="px-3 py-2 max-w-[320px] truncate" title={row.error_message ?? ''}>{row.error_message ?? ''}</td>
                          </>
                        )}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
};

export const AutoGenerateProformaInvoicesLogView: React.FC = () => (
  <ScheduledInvoiceLogView
    title="Auto Generate Proforma Invoices Log"
    description={<>Daily at 4:00 AM SGT. Generates proforma invoices for active enrollments still missing a proforma URL. Use <strong>Run Now</strong> to trigger manually.</>}
    logsEndpoint="/api/admin/auto-generate-proforma-invoices-logs"
    runEndpoint="/api/admin/run-auto-generate-proforma-invoices"
    type="proforma"
  />
);

export const AutoGenerateDaInvoicesLogView: React.FC = () => (
  <ScheduledInvoiceLogView
    title="Auto Generate DA Invoices Log"
    description={<>Daily at 11:00 PM SGT. Generates missing DA QuickBooks invoices and sends unsent main invoice emails once. Use <strong>Run Now</strong> to trigger manually.</>}
    logsEndpoint="/api/admin/auto-generate-da-invoices-logs"
    runEndpoint="/api/admin/run-auto-generate-da-invoices"
    type="da"
  />
);
