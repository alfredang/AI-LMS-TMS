import { getApiUrl, getFileUrl } from '@/lib/urlHelpers';
import React, { useState, useEffect, useCallback } from 'react';
import { Card } from '../ui/Card';
import { Button } from '../ui/Button';
import { useLms } from '@contexts/LmsContext';
import { AdminPage } from '@app-types';

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
}

// FormSection component definition moved outside to prevent re-creation on re-renders
const FormSection: React.FC<{ title: string; children: React.ReactNode }> = ({ title, children }) => (
    <Card className="p-6 dark:bg-gray-800 dark:border-gray-700">
        <h3 className="text-xl font-bold mb-4 dark:text-white">{title}</h3>
        <div className="space-y-4">{children}</div>
    </Card>
);

export const ClassManagerView: React.FC<ClassManagerViewProps> = ({ courseToEdit }) => {
    const { setAdminPage, currentUser } = useLms();
    const isEditMode = !!courseToEdit;
    const title = isEditMode ? 'Edit Class' : 'Create New Class';

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

    // Tab state for navigation
    const [activeTab, setActiveTab] = useState<'courseRun' | 'sessions' | 'trainer'>('courseRun');

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
    // Track the currently locally-assigned trainer (initialised from courseToEdit)
    const [localAssignedTrainerName, setLocalAssignedTrainerName] = useState(courseToEdit?.assignedTrainerName || '');
    const [localAssignedTrainerEmail, setLocalAssignedTrainerEmail] = useState(courseToEdit?.assignedTrainerEmail || '');

    // ViewCourseRun state management
    const [includeExpired, setIncludeExpired] = useState(false);
    const [ssgApiResponse, setSsgApiResponse] = useState<any>(null);
    const [ssgApiLoading, setSsgApiLoading] = useState(false);
    const [showSsgResponse, setShowSsgResponse] = useState(false);

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
        if (!ssgApiResponse?.data?.data?.course?.run) {
            showErrorPopup('Course run data is required. Please fetch SSG data first before adding sessions.');
            return;
        }

        const runData = ssgApiResponse.data.data.course.run;

        // Generate schedule info from course dates
        const courseStartDateForSchedule = runData.courseStartDate ? convertSsgDateToHtml(runData.courseStartDate) : (editFormData.courseStartDate || '');
        const courseEndDateForSchedule = runData.courseEndDate ? convertSsgDateToHtml(runData.courseEndDate) : (editFormData.courseEndDate || '');
        const scheduleInfo = generateScheduleInfo(courseStartDateForSchedule, courseEndDateForSchedule);

        // Build the request body that will be sent to API (flat structure with all required run data)
        const requestBody = {
            // Required field at root level (as expected by backend)
            courseReferenceNumber: courseReferenceNumber,

            // Course run dates (required for proper SSG API payload) - convert YYYYMMDD to YYYY-MM-DD format
            openingRegistrationDate: runData.registrationOpeningDate ? convertSsgDateToHtml(runData.registrationOpeningDate) : (editFormData.openingRegistrationDate || ''),
            closingRegistrationDate: runData.registrationClosingDate ? convertSsgDateToHtml(runData.registrationClosingDate) : (editFormData.closingRegistrationDate || ''),
            courseStartDate: runData.courseStartDate ? convertSsgDateToHtml(runData.courseStartDate) : (editFormData.courseStartDate || ''),
            courseEndDate: runData.courseEndDate ? convertSsgDateToHtml(runData.courseEndDate) : (editFormData.courseEndDate || ''),

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
                        opening: runData.registrationOpeningDate || convertHtmlDateToSsg(editFormData.openingRegistrationDate || ''),
                        closing: runData.registrationClosingDate || convertHtmlDateToSsg(editFormData.closingRegistrationDate || '')
                    },
                    courseDates: {
                        start: runData.courseStartDate || convertHtmlDateToSsg(editFormData.courseStartDate || ''),
                        end: runData.courseEndDate || convertHtmlDateToSsg(editFormData.courseEndDate || '')
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

        if (!ssgApiResponse?.data?.data?.course?.run) {
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
        const runData = ssgApiResponse.data.data.course.run;

        // Generate schedule info from course dates
        const courseStartDateForSchedule = runData.courseStartDate ? convertSsgDateToHtml(runData.courseStartDate) : (editFormData.courseStartDate || '');
        const courseEndDateForSchedule = runData.courseEndDate ? convertSsgDateToHtml(runData.courseEndDate) : (editFormData.courseEndDate || '');
        const scheduleInfo = generateScheduleInfo(courseStartDateForSchedule, courseEndDateForSchedule);

        // Build the request body that will be sent to API (SAME structure as add sessions)
        const requestBody = {
            // Required field at root level (as expected by backend)
            courseReferenceNumber: courseReferenceNumber,

            // Course run dates (required for proper SSG API payload) - convert YYYYMMDD to YYYY-MM-DD format
            openingRegistrationDate: runData.registrationOpeningDate ? convertSsgDateToHtml(runData.registrationOpeningDate) : (editFormData.openingRegistrationDate || ''),
            closingRegistrationDate: runData.registrationClosingDate ? convertSsgDateToHtml(runData.registrationClosingDate) : (editFormData.closingRegistrationDate || ''),
            courseStartDate: runData.courseStartDate ? convertSsgDateToHtml(runData.courseStartDate) : (editFormData.courseStartDate || ''),
            courseEndDate: runData.courseEndDate ? convertSsgDateToHtml(runData.courseEndDate) : (editFormData.courseEndDate || ''),

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

        if (!ssgApiResponse?.data?.data?.course?.run) {
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
        const runData = ssgApiResponse.data.data.course.run;

        // Generate schedule info from course dates
        const courseStartDateForSchedule = runData.courseStartDate ? convertSsgDateToHtml(runData.courseStartDate) : (editFormData.courseStartDate || '');
        const courseEndDateForSchedule = runData.courseEndDate ? convertSsgDateToHtml(runData.courseEndDate) : (editFormData.courseEndDate || '');
        const scheduleInfo = generateScheduleInfo(courseStartDateForSchedule, courseEndDateForSchedule);

        // Build the request body that will be sent to API (flat structure matching add/delete sessions)
        const requestBody = {
            // Required field at root level (as expected by backend)
            courseReferenceNumber: courseReferenceNumber,

            // Course run dates (required for proper SSG API payload) - convert YYYYMMDD to YYYY-MM-DD format
            openingRegistrationDate: runData.registrationOpeningDate ? convertSsgDateToHtml(runData.registrationOpeningDate) : (editFormData.openingRegistrationDate || ''),
            closingRegistrationDate: runData.registrationClosingDate ? convertSsgDateToHtml(runData.registrationClosingDate) : (editFormData.closingRegistrationDate || ''),
            courseStartDate: runData.courseStartDate ? convertSsgDateToHtml(runData.courseStartDate) : (editFormData.courseStartDate || ''),
            courseEndDate: runData.courseEndDate ? convertSsgDateToHtml(runData.courseEndDate) : (editFormData.courseEndDate || ''),

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
                        opening: runData.registrationOpeningDate || convertHtmlDateToSsg(editFormData.openingRegistrationDate || ''),
                        closing: runData.registrationClosingDate || convertHtmlDateToSsg(editFormData.closingRegistrationDate || '')
                    },
                    courseDates: {
                        start: runData.courseStartDate || convertHtmlDateToSsg(editFormData.courseStartDate || ''),
                        end: runData.courseEndDate || convertHtmlDateToSsg(editFormData.courseEndDate || '')
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
        console.log('=== SSG API Response Analysis ===');
        console.log('Full SSG Response:', JSON.stringify(ssgResponse, null, 2));

        if (!ssgResponse) {
            console.log('❌ No SSG response provided');
            return;
        }

        console.log('SSG Response keys:', Object.keys(ssgResponse));
        console.log('SSG Response data:', ssgResponse.data);

        if (!ssgResponse?.data?.data?.course?.run) {
            console.log('❌ No course run data found in response');
            console.log('Available path:', ssgResponse?.data?.data?.course);
            return;
        }

        // Get the run data from the actual response structure
        const run = ssgResponse.data.data.course.run;
        console.log('Course run data:', JSON.stringify(run, null, 2));
        console.log('Run keys:', Object.keys(run));

        // Update form data with the actual SSG response structure
        const updatedFormData = {
            // Registration dates - using actual field names from response
            openingRegistrationDate: run.registrationOpeningDate ? convertSsgDateToHtml(run.registrationOpeningDate) : undefined,
            closingRegistrationDate: run.registrationClosingDate ? convertSsgDateToHtml(run.registrationClosingDate) : undefined,

            // Course dates - using actual field names from response  
            courseStartDate: run.courseStartDate ? convertSsgDateToHtml(run.courseStartDate) : undefined,
            courseEndDate: run.courseEndDate ? convertSsgDateToHtml(run.courseEndDate) : undefined,

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

            // Course admin email - use current user's email instead of SSG data
            courseAdminEmail: currentUserEmail
        };

        console.log('Updated form data:', updatedFormData);

        setEditFormData(prev => {
            const newFormData = { ...prev };

            // Manually assign each field to avoid TypeScript indexing issues
            if (updatedFormData.openingRegistrationDate !== undefined) {
                newFormData.openingRegistrationDate = updatedFormData.openingRegistrationDate;
                console.log('✅ Set opening registration date:', updatedFormData.openingRegistrationDate);
            }
            if (updatedFormData.closingRegistrationDate !== undefined) {
                newFormData.closingRegistrationDate = updatedFormData.closingRegistrationDate;
                console.log('✅ Set closing registration date:', updatedFormData.closingRegistrationDate);
            }
            if (updatedFormData.courseStartDate !== undefined) {
                newFormData.courseStartDate = updatedFormData.courseStartDate;
                console.log('✅ Set course start date:', updatedFormData.courseStartDate);
            }
            if (updatedFormData.courseEndDate !== undefined) {
                newFormData.courseEndDate = updatedFormData.courseEndDate;
                console.log('✅ Set course end date:', updatedFormData.courseEndDate);
            }
            if (updatedFormData.courseVacancy !== undefined) {
                newFormData.courseVacancy = updatedFormData.courseVacancy;
                console.log('✅ Set course vacancy:', updatedFormData.courseVacancy);
            }
            if (updatedFormData.block !== undefined) {
                newFormData.block = updatedFormData.block;
                console.log('✅ Set block:', updatedFormData.block);
            }
            if (updatedFormData.street !== undefined) {
                newFormData.street = updatedFormData.street;
                console.log('✅ Set street:', updatedFormData.street);
            }
            if (updatedFormData.building !== undefined) {
                newFormData.building = updatedFormData.building;
                console.log('✅ Set building:', updatedFormData.building);
            }
            if (updatedFormData.floor !== undefined) {
                newFormData.floor = updatedFormData.floor;
                console.log('✅ Set floor:', updatedFormData.floor);
            }
            if (updatedFormData.unit !== undefined) {
                newFormData.unit = updatedFormData.unit;
                console.log('✅ Set unit:', updatedFormData.unit);
            }
            if (updatedFormData.postalCode !== undefined) {
                newFormData.postalCode = updatedFormData.postalCode;
                console.log('✅ Set postal code:', updatedFormData.postalCode);
            }
            if (updatedFormData.room !== undefined) {
                newFormData.room = updatedFormData.room;
                console.log('✅ Set room:', updatedFormData.room);
            }
            if (updatedFormData.wheelChairAccess !== undefined) {
                newFormData.wheelChairAccess = updatedFormData.wheelChairAccess;
                console.log('✅ Set wheelchair access:', updatedFormData.wheelChairAccess);
            }
            if (updatedFormData.courseAdminEmail !== undefined) {
                newFormData.courseAdminEmail = updatedFormData.courseAdminEmail;
                console.log('✅ Set course admin email (using current user email):', updatedFormData.courseAdminEmail);
            }

            console.log('Final form data to set:', newFormData);
            return newFormData;
        });

        // Update the individual date states as well
        if (run.courseStartDate) {
            const startDateHtml = convertSsgDateToHtml(run.courseStartDate);
            console.log('Setting start date:', startDateHtml);
            setStartDate(startDateHtml);
        }
        if (run.courseEndDate) {
            const endDateHtml = convertSsgDateToHtml(run.courseEndDate);
            console.log('Setting end date:', endDateHtml);
            setEndDate(endDateHtml);
        }

        console.log('✅ Form population completed successfully!');
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
                        uen: ssgApiResponse?.data?.data?.course?.run?.organizationKey
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
                        // ...(ssgApiResponse?.data?.data?.course?.run?.linkCourseRunTrainer && {
                        //     linkCourseRunTrainer: ssgApiResponse.data.data.course.run.linkCourseRunTrainer
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
        if (!courseRunId.trim() || !courseReferenceNumber.trim()) {
            showErrorPopup('Course Run ID and Course Reference Number are required for updating');
            return;
        }

        // Generate schedule info from course dates
        const scheduleInfo = generateScheduleInfo(editFormData.courseStartDate || '', editFormData.courseEndDate || '');

        setLoading(true);
        try {
            // Create the request body matching the EditRunInfo interface structure
            const requestBody = {
                // Required field
                courseReferenceNumber: courseReferenceNumber,

                // Optional fields - dates
                openingRegistrationDate: editFormData.openingRegistrationDate || undefined,
                closingRegistrationDate: editFormData.closingRegistrationDate || undefined,
                courseStartDate: editFormData.courseStartDate || undefined,
                courseEndDate: editFormData.courseEndDate || undefined,

                // Schedule information
                scheduleInfoTypeCode: "01",
                scheduleInfoTypeDescription: "Description",
                scheduleInfo: scheduleInfo,

                // Venue information (all fields)
                block: editFormData.block || undefined,
                street: editFormData.street || undefined,
                floor: editFormData.floor || undefined,
                unit: editFormData.unit || undefined,
                building: editFormData.building || undefined,
                postalCode: editFormData.postalCode || undefined,
                room: editFormData.room || undefined,
                wheelChairAccess: editFormData.wheelChairAccess || undefined,

                // Course admin email - use current user's email
                courseAdminEmail: currentUserEmail,

                // Course vacancy
                courseVacancy: editFormData.courseVacancy || undefined,

                // File information (required by API)
                fileName: "",
                fileContent: ""

                // TODO: Re-implement linkCourseRunTrainer in a better way in the future
                // Include trainer information if it exists in the SSG response (flat structure for backend)
                // Only include if we have complete trainer data with required fields
                // ...(ssgApiResponse?.data?.data?.course?.run?.linkCourseRunTrainer && 
                //     ssgApiResponse.data.data.course.run.linkCourseRunTrainer.length > 0 &&
                //     ssgApiResponse.data.data.course.run.linkCourseRunTrainer[0]?.trainer?.idNumber && {
                //     linkCourseRunTrainer: ssgApiResponse.data.data.course.run.linkCourseRunTrainer.map((trainerLink: any) => ({
                //         trainer: {
                //             photo: {
                //                 name: trainerLink.trainer?.photo?.name || "",
                //                 content: trainerLink.trainer?.photo?.content || ""
                //             },
                //             trainerType: {
                //                 code: trainerLink.trainer?.trainerType?.code || "1",
                //                 description: trainerLink.trainer?.trainerType?.description || "Existing"
                //             },
                //             idNumber: trainerLink.trainer?.idNumber || "",
                //             ...(trainerLink.trainer?.name && { name: trainerLink.trainer.name }),
                //             ...(trainerLink.trainer?.email && { email: trainerLink.trainer.email })
                //         }
                //     }))
                // })
            };

            console.log('=== API REQUEST DEBUG ===');
            console.log('Course Run ID:', courseRunId);
            console.log('Course Reference Number:', courseReferenceNumber);
            console.log('Edit Form Data:', editFormData);
            console.log('SSG API Response:', ssgApiResponse);
            console.log('Trainer Data from SSG:', ssgApiResponse?.data?.data?.course?.run?.linkCourseRunTrainer);
            console.log('Complete Request Body:', JSON.stringify(requestBody, null, 2));
            console.log('Venue Data:', {
                block: requestBody.block,
                street: requestBody.street,
                floor: requestBody.floor,
                unit: requestBody.unit,
                building: requestBody.building,
                postalCode: requestBody.postalCode,
                room: requestBody.room,
                wheelChairAccess: requestBody.wheelChairAccess
            });

            // Show confirmation popup with request body for review
            const confirmMessage = `Are you sure you want to update this course run?

📋 **Request Body to be sent to API:**
\`\`\`json
${JSON.stringify(requestBody, null, 2)}
\`\`\`

🔍 **API Endpoint:**
POST /api/ssg/courses/courseRuns/${courseRunId}?action=edit

ℹ️ Please review the request body above before proceeding.`;

            const confirmed = await showConfirmPopup(
                confirmMessage,
                () => { }, // Will be handled by the promise resolution
                'Update Course Run',
                'Update',
                'Cancel'
            );

            if (!confirmed) {
                setLoading(false);
                return;
            }

            const response = await fetch(`/api/ssg/courses/courseRuns/${courseRunId}?includeExpiredCourses=false&action=edit`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify(requestBody)
            });

            console.log('=== API RESPONSE DEBUG ===');
            console.log('Response Status:', response.status);
            console.log('Response OK:', response.ok);

            if (!response.ok) {
                const errorData = await response.json();
                console.error('HTTP error:', response.status, errorData);
                console.log('Error Response Body:', JSON.stringify(errorData, null, 2));
                throw new Error(`HTTP error! status: ${response.status}, details: ${JSON.stringify(errorData)}`);
            }

            const data = await response.json();
            console.log('Success Response:', JSON.stringify(data, null, 2));

            if (response.status === 200) {
                showSuccessPopup('Course run updated successfully!');
                fetchCourseRunData(courseRunId);
            } else {
                showInfoPopup('Update completed with status: ' + response.status);
            }
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : 'An error occurred during update';
            console.error('=== UPDATE ERROR ===');
            console.error('Error Details:', error);
            console.error('Error Message:', errorMessage);
            showErrorPopup('Failed to update course run: ' + errorMessage);
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

    // Load trainers when trainer tab becomes active
    useEffect(() => {
        if (isEditMode && activeTab === 'trainer' && availableTrainers.length === 0) {
            fetchAvailableTrainers();
        }
    }, [isEditMode, activeTab]); // eslint-disable-line react-hooks/exhaustive-deps

    // Assign trainer to course run in local DB (sets assigned_trainer_id / name / email)
    const handleAssignTrainerLocal = async () => {
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
            showSuccessPopup(`Trainer "${trainerName}" has been assigned to this course run.`);
            setLocalAssignedTrainerName(trainerName);
            setLocalAssignedTrainerEmail(trainerEmail);
            setSelectedDbTrainerId('');
            setManualTrainerName('');
            setManualTrainerEmail('');
        } catch (err) {
            showErrorPopup(err instanceof Error ? err.message : 'Failed to assign trainer');
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

        if (!ssgApiResponse?.data?.data?.course?.run) {
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
        const runData = ssgApiResponse.data.data.course.run;

        // Generate schedule info from course dates
        const courseStartDateForSchedule = runData.courseStartDate ? convertSsgDateToHtml(runData.courseStartDate) : (editFormData.courseStartDate || '');
        const courseEndDateForSchedule = runData.courseEndDate ? convertSsgDateToHtml(runData.courseEndDate) : (editFormData.courseEndDate || '');
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
                        opening: runData.registrationOpeningDate || convertHtmlDateToSsg(editFormData.openingRegistrationDate || ''),
                        closing: runData.registrationClosingDate || convertHtmlDateToSsg(editFormData.closingRegistrationDate || '')
                    },
                    courseDates: {
                        start: runData.courseStartDate || convertHtmlDateToSsg(editFormData.courseStartDate || ''),
                        end: runData.courseEndDate || convertHtmlDateToSsg(editFormData.courseEndDate || '')
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
                                const trainers = updatedData?.data?.data?.course?.run?.linkCourseRunTrainer;
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
                courseStartDate: courseToEdit.startDate || '',
                courseEndDate: courseToEdit.endDate || ''
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

    return (
        <div>
            <div className="flex justify-between items-center mb-6">
                <h2 className="text-3xl font-bold">{title}</h2>
                <div>
                    <Button variant="ghost" onClick={() => setAdminPage(AdminPage.Dashboard)} className="mr-2">Cancel</Button>
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
                        {(['courseRun', 'sessions', 'trainer'] as const).map(tab => (
                            <button
                                key={tab}
                                onClick={() => setActiveTab(tab)}
                                className={`whitespace-nowrap py-2 px-1 border-b-2 font-medium text-sm transition-colors ${
                                    activeTab === tab
                                        ? 'border-blue-500 text-blue-500'
                                        : 'border-transparent text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 hover:border-gray-300 dark:hover:border-gray-500'
                                }`}
                            >
                                {tab === 'courseRun' ? 'Course Run' : tab === 'sessions' ? 'Sessions' : 'Trainer'}
                            </button>
                        ))}
                    </nav>
                </div>
            )}

            <div className="space-y-6">
                {/* Course Run Tab */}
                {(!isEditMode || activeTab === 'courseRun') && (
                    <>
                        {isEditMode && ssgApiResponse && !ssgApiLoading && (
                            <div className="bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-700 rounded-md p-3 mb-4">
                                <p className="text-sm text-green-800 dark:text-green-300">
                                    <strong>✓ Form populated with SSG data</strong> - The form fields below have been automatically filled with data from the SSG API. You can modify any field as needed before updating.
                                </p>
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
                                    {ssgApiResponse?.data && (
                                        <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
                                            This field is populated from SSG data and cannot be edited
                                        </p>
                                    )}
                                </div>

                                <div className="flex justify-end mt-6">
                                    <Button
                                        onClick={handleUpdateCourseRunOnly}
                                        disabled={loading}
                                        className="bg-blue-600 hover:bg-blue-700 text-white"
                                    >
                                        {loading ? (
                                            <div className="flex items-center">
                                                <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white mr-2"></div>
                                                Updating Course Run...
                                            </div>
                                        ) : 'Update Course Run'}
                                    </Button>
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
                                    {hasExistingSessions ? (
                                        <div className="space-y-4">
                                            {existingSessions.map((session: any, index: number) => (
                                                <Card key={session.id || index} className="p-4 bg-gray-50 dark:bg-gray-800/60">
                                                    {editingSessionIndex === index ? (
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
                                                    ) : (
                                                        // Display mode for existing session
                                                        <div className="space-y-2">
                                                            <div className="flex justify-between items-start">
                                                                <h4 className="font-medium">Session {index + 1}</h4>
                                                                <div className="flex space-x-2">
                                                                    <Button
                                                                        variant="ghost"
                                                                        onClick={() => startEditingSession(index)}
                                                                        className="!text-blue-600 hover:!bg-blue-50"
                                                                    >
                                                                        Edit
                                                                    </Button>
                                                                    <Button
                                                                        variant="ghost"
                                                                        onClick={() => deleteExistingSession(session.id, index)}
                                                                        className="!text-red-600 hover:!bg-red-50"
                                                                    >
                                                                        Delete
                                                                    </Button>
                                                                </div>
                                                            </div>
                                                            <div className="grid grid-cols-3 gap-4 text-sm">
                                                                <div>
                                                                    <span className="font-medium">Date:</span> {session.startDate ? formatDateForDisplay(session.startDate) : 'N/A'} - {session.endDate ? formatDateForDisplay(session.endDate) : 'N/A'}
                                                                </div>
                                                                <div>
                                                                    <span className="font-medium">Time:</span> {session.startTime || 'N/A'} - {session.endTime || 'N/A'}
                                                                </div>
                                                                <div>
                                                                    <span className="font-medium">Mode:</span> {getModeLabel(session.modeOfTraining)}
                                                                </div>
                                                            </div>
                                                        </div>
                                                    )}
                                                </Card>
                                            ))}

                                            <Button
                                                type="button"
                                                variant="primary"
                                                onClick={toggleNewSessionForm}
                                                className="w-full px-4 py-2 bg-green-600 text-white rounded hover:bg-green-700"
                                            >
                                                {showNewSessionForm ? 'Cancel Add Session' : 'Add New Session'}
                                            </Button>
                                        </div>
                                    ) : (
                                        // No existing sessions - show add form
                                        <div className="text-center py-8">
                                            <p className="text-gray-600 mb-4">No existing sessions found.</p>
                                            <button
                                                type="button"
                                                onClick={toggleNewSessionForm}
                                                className="px-6 py-3 bg-green-600 text-white rounded hover:bg-green-700"
                                            >
                                                {showNewSessionForm ? 'Cancel' : 'Add First Session'}
                                            </button>
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

                {/* Trainer Tab */}
                {isEditMode && activeTab === 'trainer' && (
                    <FormSection title="Trainer Management">
                        <div className="space-y-6">
                            {/* Currently Assigned Local Trainer */}
                            {localAssignedTrainerName ? (
                                <div className="bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-700 rounded-md p-4">
                                    <h4 className="text-sm font-semibold text-green-800 dark:text-green-300 mb-2">Assigned Trainer (Local System)</h4>
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
                                    </div>
                                    <p className="text-xs text-green-700 dark:text-green-400 mt-2">
                                        This trainer can view this class in their attendance dashboard.
                                    </p>
                                </div>
                            ) : (
                                <div className="bg-gray-50 dark:bg-gray-800/60 border border-gray-200 dark:border-gray-700 rounded-md p-4 text-sm text-gray-500 dark:text-gray-400">
                                    No trainer has been locally assigned to this course run yet. Use the form below to assign one.
                                </div>
                            )}

                            {/* Display Assigned Trainer Information */}
                            {ssgApiResponse?.data?.data?.course?.run ? (
                                <div>
                                    <h4 className="text-lg font-medium text-gray-900 dark:text-white mb-4">Currently Assigned Trainer</h4>
                                    {ssgApiResponse.data.data.course.run.linkCourseRunTrainer &&
                                        ssgApiResponse.data.data.course.run.linkCourseRunTrainer.length > 0 ? (
                                        <div className="space-y-4">
                                            {ssgApiResponse.data.data.course.run.linkCourseRunTrainer.map((trainerLink: any, index: number) => {
                                                const trainer = trainerLink.trainer;
                                                return (
                                                    <Card key={index} className="p-4 bg-blue-50 dark:bg-blue-900/20 border-blue-200 dark:border-blue-700">
                                                        <div className="flex justify-between items-start">
                                                            <div className="flex-1">
                                                                <h5 className="text-md font-semibold text-blue-800 dark:text-blue-300 mb-2">
                                                                    Trainer {index + 1}
                                                                </h5>
                                                                <div className="grid grid-cols-1 md:grid-cols-3 gap-4 text-sm">
                                                                    <div>
                                                                        <span className="font-bold text-gray-700 dark:text-gray-300 ">ID Number:</span>
                                                                        <div className="text-gray-900 dark:text-white">{trainer.idNumber}</div>
                                                                    </div>
                                                                    <div>
                                                                        <span className="font-bold text-gray-700 dark:text-gray-300">Name:</span>
                                                                        <div className="text-gray-900 dark:text-white">{trainer.name}</div>
                                                                    </div>
                                                                    <div>
                                                                        <span className="font-bold text-gray-700 dark:text-gray-300">Email:</span>
                                                                        <div className="text-gray-900 dark:text-white">{trainer.email}</div>
                                                                    </div>
                                                                </div>
                                                            </div>
                                                        </div>
                                                    </Card>
                                                );
                                            })}
                                        </div>
                                    ) : (
                                        <Card className="p-6 bg-gray-50 dark:bg-gray-800/60 border-gray-200 dark:border-gray-700 text-center">
                                            <div className="text-gray-600 dark:text-gray-300">
                                                <svg className="mx-auto h-12 w-12 text-gray-400 mb-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
                                                </svg>
                                                <h5 className="text-lg font-medium text-gray-900 dark:text-white mb-2">No Trainer Assigned</h5>
                                                <p className="text-sm text-gray-500 dark:text-gray-400">
                                                    No trainer has been assigned to this course run yet. Use the form below to assign a trainer.
                                                </p>
                                            </div>
                                        </Card>
                                    )}
                                </div>
                            ) : (
                                <div className="bg-yellow-50 dark:bg-yellow-900/20 border border-yellow-200 dark:border-yellow-700 rounded-md p-4">
                                    <div className="flex">
                                        <div className="flex-shrink-0">
                                            <svg className="h-5 w-5 text-yellow-400" fill="currentColor" viewBox="0 0 20 20">
                                                <path fillRule="evenodd" d="M8.257 3.099c.765-1.36 2.722-1.36 3.486 0l5.58 9.92c.75 1.334-.213 2.98-1.742 2.98H4.42c-1.53 0-2.493-1.646-1.743-2.98l5.58-9.92zM11 13a1 1 0 11-2 0 1 1 0 012 0zm-1-8a1 1 0 00-1 1v3a1 1 0 002 0V6a1 1 0 00-1-1z" clipRule="evenodd" />
                                            </svg>
                                        </div>
                                        <div className="ml-3">
                                            <h3 className="text-sm font-medium text-yellow-800 dark:text-yellow-300">
                                                Course Run Data Required
                                            </h3>
                                            <p className="text-sm text-yellow-700 dark:text-yellow-400 mt-1">
                                                Please fetch SSG course run data first to view assigned trainer information.
                                            </p>
                                        </div>
                                    </div>
                                </div>
                            )}

                            {/* Assign New Trainer Form */}
                            <div className="border-t dark:border-gray-700 pt-6">
                                <h4 className="text-lg font-medium text-gray-900 dark:text-white mb-4">Assign New Trainer</h4>

                                {Array.from({ length: trainerCount }, (_, index) => {
                                    const trainerInfo = getTrainerData(index);
                                    // Set default trainer type to "1" (Existing) if not already set
                                    const trainerType = trainerInfo.trainerTypeCode || '1';

                                    // Ensure the default value is set in the data
                                    if (!trainerInfo.trainerTypeCode) {
                                        updateTrainerField(index, 'trainerTypeCode', '1');
                                    }

                                    return (
                                        <Card key={index} className="p-4 bg-gray-50 dark:bg-gray-800/60">
                                            <div className="space-y-4">
                                                {/* Hidden Trainer Type field - always set to "1" (Existing) for request body */}
                                                <input
                                                    type="hidden"
                                                    value="1"
                                                    onChange={(e) => updateTrainerField(index, 'trainerTypeCode', e.target.value)}
                                                />

                                                {/* Trainer ID Number field - always displayed */}
                                                <div>
                                                    <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Trainer ID Number *</label>
                                                    <input
                                                        type="text"
                                                        value={trainerInfo.trainerIdNumber || ''}
                                                        onChange={(e) => updateTrainerField(index, 'trainerIdNumber', e.target.value)}
                                                        className={inputClasses}
                                                        placeholder="Enter existing trainer ID"
                                                        required
                                                    />
                                                    <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
                                                        Enter the ID number of an existing trainer to assign them to this course run.
                                                    </p>
                                                </div>
                                            </div>
                                        </Card>
                                    );
                                })}

                                <div className="flex justify-end mt-6">
                                    <Button
                                        onClick={handleUpdateTrainer}
                                        disabled={loading}
                                        className="bg-purple-600 hover:bg-purple-700 text-white"
                                    >
                                        {loading ? (
                                            <div className="flex items-center">
                                                <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white mr-2"></div>
                                                Assigning Trainer...
                                            </div>
                                        ) : 'Assign Trainer'}
                                    </Button>
                                </div>
                            </div>

                            {/* Local DB Trainer Assignment */}
                            <div className="border-t dark:border-gray-700 pt-6 mt-6">
                                <h4 className="text-lg font-medium text-gray-900 dark:text-white mb-1">Assign Trainer (Local Database)</h4>
                                <p className="text-sm text-gray-500 dark:text-gray-400 mb-4">
                                    Select a trainer from your system so they can view this class in their attendance dashboard.
                                </p>

                                {/* Toggle: dropdown vs manual */}
                                <div className="flex gap-3 mb-4">
                                    <button
                                        type="button"
                                        onClick={() => setDbTrainerAssignMode('dropdown')}
                                        className={`px-3 py-1.5 rounded text-sm font-medium transition-colors ${
                                            dbTrainerAssignMode === 'dropdown'
                                                ? 'bg-blue-600 text-white'
                                                : 'border border-gray-300 dark:border-gray-600 text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700'
                                        }`}
                                    >
                                        Select from list
                                    </button>
                                    <button
                                        type="button"
                                        onClick={() => setDbTrainerAssignMode('manual')}
                                        className={`px-3 py-1.5 rounded text-sm font-medium transition-colors ${
                                            dbTrainerAssignMode === 'manual'
                                                ? 'bg-blue-600 text-white'
                                                : 'border border-gray-300 dark:border-gray-600 text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700'
                                        }`}
                                    >
                                        Enter manually
                                    </button>
                                </div>

                                {dbTrainerAssignMode === 'dropdown' ? (
                                    <div>
                                        <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                                            Trainer <span className="text-red-500">*</span>
                                        </label>
                                        {availableTrainers.length === 0 ? (
                                            <p className="text-sm text-gray-500 italic">Loading trainers...</p>
                                        ) : (
                                            <select
                                                value={selectedDbTrainerId}
                                                onChange={e => setSelectedDbTrainerId(e.target.value)}
                                                className={inputClasses}
                                            >
                                                <option value="">— Select a trainer —</option>
                                                {availableTrainers.map((t: any) => (
                                                    <option key={t.user_id} value={t.user_id}>
                                                        {t.trainer_name} ({t.email})
                                                    </option>
                                                ))}
                                            </select>
                                        )}
                                    </div>
                                ) : (
                                    <div className="space-y-3">
                                        <div>
                                            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                                                Trainer Name <span className="text-red-500">*</span>
                                            </label>
                                            <input
                                                type="text"
                                                placeholder="Full name"
                                                value={manualTrainerName}
                                                onChange={e => setManualTrainerName(e.target.value)}
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
                                                value={manualTrainerEmail}
                                                onChange={e => setManualTrainerEmail(e.target.value)}
                                                className={inputClasses}
                                            />
                                        </div>
                                    </div>
                                )}

                                <div className="flex justify-end mt-4">
                                    <Button
                                        onClick={handleAssignTrainerLocal}
                                        disabled={loading}
                                        className="bg-green-600 hover:bg-green-700 text-white"
                                    >
                                        {loading ? (
                                            <div className="flex items-center">
                                                <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white mr-2"></div>
                                                Saving...
                                            </div>
                                        ) : 'Save Local Assignment'}
                                    </Button>
                                </div>
                            </div>
                        </div>
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

    // Track live assignments without refetching
    const [localAssignments, setLocalAssignments] = useState<Record<string, { name: string; email: string }>>({});

    const fetchCourseRuns = async (q: string) => {
        setLoadingRuns(true);
        try {
            const params = q ? `?search=${encodeURIComponent(q)}` : '';
            const res = await fetch(`/api/admin/all-course-runs${params}`);
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

    useEffect(() => {
        fetchCourseRuns('');
        fetchTrainers();
    }, []); // eslint-disable-line react-hooks/exhaustive-deps

    const handleSearch = (e: React.FormEvent) => {
        e.preventDefault();
        fetchCourseRuns(search);
    };

    const handleRemoveTrainer = async (run: any) => {
        setMessage(null);
        setSaving(true);
        try {
            const res = await fetch('/api/admin/remove-trainer', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ courseRunUuid: run.id }),
            });
            const data = await res.json();
            if (!res.ok) throw new Error(data.error || 'Failed to remove trainer');
            setLocalAssignments(prev => ({ ...prev, [run.id]: { name: '', email: '' } }));
            setMessage({ type: 'success', text: `Trainer removed from "${run.courseTitle}".` });
            setSelectedRunId(null);
        } catch (err) {
            setMessage({ type: 'error', text: err instanceof Error ? err.message : 'Failed to remove trainer' });
        } finally {
            setSaving(false);
        }
    };

    const handleAssign = async (run: any) => {
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
            setLocalAssignments(prev => ({ ...prev, [run.id]: { name: trainerName, email: trainerEmail } }));
            setMessage({ type: 'success', text: `"${trainerName}" assigned to ${run.courseTitle}.` });
            setSelectedRunId(null);
            setSelectedTrainerId('');
            setManualName('');
            setManualEmail('');
        } catch (err) {
            setMessage({ type: 'error', text: err instanceof Error ? err.message : 'Failed to assign trainer' });
        } finally {
            setSaving(false);
        }
    };

    const inputClasses = 'w-full border border-gray-300 dark:border-gray-600 rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 dark:bg-gray-700 dark:text-white';

    return (
        <div>
            <div className="flex justify-between items-center mb-6">
                <h2 className="text-3xl font-bold dark:text-white">Assign Trainer</h2>
                <Button variant="ghost" onClick={() => setAdminPage(AdminPage.Dashboard)}>
                    Back to Dashboard
                </Button>
            </div>

            {/* Feedback banner */}
            {message && (
                <div className={`mb-4 p-3 rounded-md text-sm ${message.type === 'success' ? 'bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-700 text-green-800 dark:text-green-300' : 'bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-700 text-red-800 dark:text-red-300'}`}>
                    {message.text}
                </div>
            )}

            {/* Search */}
            <Card className="p-4 mb-4 dark:bg-gray-800 dark:border-gray-700">
                <form onSubmit={handleSearch} className="flex gap-2">
                    <input
                        type="text"
                        value={search}
                        onChange={e => setSearch(e.target.value)}
                        placeholder="Search by course title, code or run ID..."
                        className={`${inputClasses} flex-1`}
                    />
                    <Button type="submit" disabled={loadingRuns}>
                        {loadingRuns ? 'Searching...' : 'Search'}
                    </Button>
                </form>
            </Card>

            {/* Course Runs List */}
            <Card className="dark:bg-gray-800 dark:border-gray-700 overflow-hidden">
                {loadingRuns ? (
                    <div className="p-8 text-center text-sm text-gray-500">Loading course runs...</div>
                ) : courseRuns.length === 0 ? (
                    <div className="p-8 text-center text-sm text-gray-500">No course runs found.</div>
                ) : (
                    <div className="divide-y divide-gray-200 dark:divide-gray-700">
                        {courseRuns.map(run => {
                            const local = localAssignments[run.id];
                            const currentName = local?.name ?? run.assignedTrainerName;
                            const currentEmail = local?.email ?? run.assignedTrainerEmail;
                            const isExpanded = selectedRunId === run.id;

                            return (
                                <div key={run.id}>
                                    {/* Row */}
                                    <div
                                        className="flex items-center justify-between px-4 py-3 hover:bg-gray-50 dark:hover:bg-gray-700 cursor-pointer"
                                        onClick={() => {
                                            setSelectedRunId(isExpanded ? null : run.id);
                                            setMessage(null);
                                        }}
                                    >
                                        <div className="flex-1 min-w-0 mr-4">
                                            <p className="text-sm font-medium text-gray-900 dark:text-white truncate">{run.courseTitle}</p>
                                            <p className="text-xs text-gray-500 dark:text-gray-400">
                                                {run.courseCode}&nbsp;&nbsp;|&nbsp;&nbsp;Run: {run.courseRunId || '—'}&nbsp;&nbsp;|&nbsp;&nbsp;
                                                {run.startDate ? new Date(run.startDate).toLocaleDateString() : '—'} – {run.endDate ? new Date(run.endDate).toLocaleDateString() : '—'}
                                            </p>
                                        </div>
                                        <div className="flex items-center gap-3 shrink-0">
                                            {currentName ? (
                                                <span className="text-xs bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200 px-2 py-0.5 rounded-full">
                                                    {currentName}
                                                </span>
                                            ) : (
                                                <span className="text-xs bg-gray-100 text-gray-500 dark:bg-gray-700 dark:text-gray-400 px-2 py-0.5 rounded-full">
                                                    No trainer
                                                </span>
                                            )}
                                            <span className="text-gray-400 text-xs">{isExpanded ? '▲' : '▼'}</span>
                                        </div>
                                    </div>

                                    {/* Expanded assignment form */}
                                    {isExpanded && (
                                        <div className="bg-gray-50 dark:bg-gray-900 border-t border-gray-200 dark:border-gray-700 px-4 py-4 space-y-4">
                                            {currentName && (
                                                <p className="text-sm text-gray-600 dark:text-gray-300">
                                                    <span className="font-medium">Currently assigned:</span> {currentName}{currentEmail ? ` (${currentEmail})` : ''}
                                                </p>
                                            )}

                                            {/* Mode toggle */}
                                            <div className="flex gap-2">
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
                                                        <select
                                                            value={selectedTrainerId}
                                                            onChange={e => setSelectedTrainerId(e.target.value)}
                                                            className={inputClasses}
                                                        >
                                                            <option value="">— Select a trainer —</option>
                                                            {availableTrainers.map(t => (
                                                                <option key={t.user_id} value={t.user_id}>
                                                                    {t.trainer_name} ({t.email})
                                                                </option>
                                                            ))}
                                                        </select>
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

                                            <div className="flex justify-between items-center">
                                                {currentName ? (
                                                    <Button
                                                        onClick={() => handleRemoveTrainer(run)}
                                                        disabled={saving}
                                                        className="bg-red-600 hover:bg-red-700 text-white"
                                                    >
                                                        {saving ? 'Removing...' : 'Remove Trainer'}
                                                    </Button>
                                                ) : <span />}
                                                <Button
                                                    onClick={() => handleAssign(run)}
                                                    disabled={saving}
                                                    className="bg-green-600 hover:bg-green-700 text-white"
                                                >
                                                    {saving ? 'Saving...' : 'Assign Trainer'}
                                                </Button>
                                            </div>
                                        </div>
                                    )}
                                </div>
                            );
                        })}
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
                <Button variant="ghost" onClick={() => setAdminPage(AdminPage.Dashboard)}>Back to Dashboard</Button>
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
            const res = await fetch('https://n8n.srv1231536.hstgr.cloud/webhook/7f2f5d21-beb6-47a9-8056-e1ccf79a3ea7', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ courseRunId: form.courseRunId.trim(), courseCode: form.courseCode.trim() }),
            });
            if (!res.ok) throw new Error(`Webhook returned ${res.status}`);
            const data = await res.json();
            const run = data?.course?.run;
            if (!run) throw new Error('Invalid response from webhook');
            const startDate = run.courseStartDate ? formatDateNum(run.courseStartDate) : '';
            const endDate = run.courseEndDate ? formatDateNum(run.courseEndDate) : '';
            const digitalAttendanceId = run.qrCodeLink ? (run.qrCodeLink.split('/').pop() || '') : '';
            setForm(p => ({ ...p, startDate, endDate, digitalAttendanceId }));
            setFetchedTitle(data?.course?.title || null);
        } catch (err) {
            setMessage({ type: 'error', text: 'Failed to fetch course run info: ' + (err instanceof Error ? err.message : 'Unknown error') });
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
                <Button variant="ghost" onClick={() => setAdminPage(AdminPage.Dashboard)}>Back to Dashboard</Button>
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
