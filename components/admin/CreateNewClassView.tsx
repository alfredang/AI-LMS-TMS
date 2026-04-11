import { getApiUrl, getFileUrl } from '@/lib/urlHelpers';
import React, { useState } from 'react';
import { Card } from '../ui/Card';
import { Button } from '../ui/Button';
import { useLms } from '@contexts/LmsContext';
import { AdminPage } from '@app-types';

// FormSection component definition moved outside to prevent re-creation on re-renders
const FormSection: React.FC<{ title: string | React.ReactNode; children: React.ReactNode; className?: string }> = ({ title, children, className = "" }) => (
    <Card className={`p-6 ${className}`}>
        <h3 className="text-xl font-bold mb-4 dark:text-white">{title}</h3>
        <div className="space-y-4">{children}</div>
    </Card>
);



// Types and enums for form data
export enum OptionalSelector {
    YES = 'true',
    NO = 'false'
}

const modeOfTrainingOptions = [
    { value: '1', label: '1 - Classroom Facilitated Training' },
    { value: '2', label: '2 - Asynchronous E-learning' },
    { value: '4', label: '4 - On the Job Training' },
    { value: '8', label: '8 - Assessment' },
    { value: '9', label: '9 - Synchronous E-learning' },
    { value: '10', label: '10 - Work-based/Workplace Learning' },
];

const vacancyOptions = [
    { value: 'A', label: 'A - Available' },
    { value: 'F', label: 'F - Full' }
];

const optionalSelectorOptions = [
    { value: OptionalSelector.YES, label: 'Yes' },
    { value: OptionalSelector.NO, label: 'No' }
];

const trainerTypeOptions = [
    { value: '1', label: '1 - Existing' },
    { value: '2', label: '2 - New' }
];

const idTypeOptions = [
    { value: 'NRIC', label: 'NRIC' },
    { value: 'FIN', label: 'FIN' },
    { value: 'PASSPORT', label: 'Passport' },
    { value: 'OTHERS', label: 'Others' }
];

const salutationOptions = [
    { value: 'MR', label: 'Mr' },
    { value: 'MS', label: 'Ms' },
    { value: 'MRS', label: 'Mrs' },
    { value: 'DR', label: 'Dr' }
];

export const CreateNewClassView: React.FC = () => {
    const { setAdminPage, trainingProviderProfile } = useLms();

    // Course Run Form State
    const [courseReferenceNumber, setCourseReferenceNumber] = useState('');
    const [availableCourses, setAvailableCourses] = useState<{ id: string, title: string, courseCode: string, tscTitle: string, tscCode: string }[]>([]);
    const [loadingCourses, setLoadingCourses] = useState(false);
    const [includeExpired, setIncludeExpired] = useState(false);
    const [sequenceNumber, setSequenceNumber] = useState(0);

    // Registration Dates
    const [openingRegistrationDate, setOpeningRegistrationDate] = useState(() => {
        const today = new Date();
        return today.toISOString().split('T')[0]; // Format: YYYY-MM-DD
    });
    const [closingRegistrationDate, setClosingRegistrationDate] = useState('');

    // Course Dates
    const [courseStartDate, setCourseStartDate] = useState('');
    const [courseEndDate, setCourseEndDate] = useState('');

    // Schedule Info - Default values (not user-editable)
    const [scheduleCode] = useState('01');
    const [scheduleDescription] = useState('Description');
    // scheduleInfo will be dynamically generated from course dates

    // Venue Info
    const [block, setBlock] = useState('12');
    const [street, setStreet] = useState('WOODS SQUARE');
    const [building, setBuilding] = useState('WOODS SQUARE');
    const [wheelchairAccess, setWheelchairAccess] = useState(OptionalSelector.YES);
    const [floor, setFloor] = useState('07');
    const [unit, setUnit] = useState('85-87');
    const [postalCode, setPostalCode] = useState('737715');
    const [room, setRoom] = useState('Training room');

    // Intake Details
    const [intakeSize, setIntakeSize] = useState(0);
    const [threshold, setThreshold] = useState(0);
    const [registeredUserCount, setRegisteredUserCount] = useState(0);

    // Course Admin Details
    const [modeOfTraining, setModeOfTraining] = useState('1');
    const [courseAdminEmail, setCourseAdminEmail] = useState(trainingProviderProfile?.companyEmail || '');

    // Course Vacancy
    const [courseVacancy, setCourseVacancy] = useState('A');

    // Sessions Form State
    const [sessionCount, setSessionCount] = useState(0);
    const [sessions, setSessions] = useState<any[]>([]);

    // Trainer Form State - Single existing trainer only
    const [trainers, setTrainers] = useState([{
        id: 0,
        trainerType: '1', // Always existing trainer
        trainerIdNumber: ''
    }]);

    // API submission state
    const [isSubmitting, setIsSubmitting] = useState(false);
    const [submissionResult, setSubmissionResult] = useState<{
        success: boolean;
        courseRunId?: string;
        message?: string;
        error?: any;
    } | null>(null);

    // Optional sections visibility state
    const [showSessions, setShowSessions] = useState(false);
    const [showTrainer, setShowTrainer] = useState(false);

    // Optional field visibility states (only needed for intake details now)
    const [showOptionalFields, setShowOptionalFields] = useState({
        intakeSize: false,
        threshold: false,
        registeredUserCount: false,
        fileName: false,
        fileContent: false
    });

    const inputClasses = "block w-full px-3 py-2 text-on-surface bg-white border border-gray-300 rounded-md shadow-sm placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent dark:bg-gray-700 dark:border-gray-600 dark:text-white dark:placeholder-gray-500";

    // Fetch available courses on component mount
    const fetchAvailableCourses = async () => {
        setLoadingCourses(true);
        try {
            const response = await fetch(getApiUrl('/api/courses/list'));
            if (!response.ok) {
                throw new Error('Failed to fetch courses');
            }
            const result = await response.json();
            setAvailableCourses(result.data || []);
        } catch (error) {
            console.error('Error fetching courses:', error);
            alert('Failed to load available courses. Please refresh the page.');
        } finally {
            setLoadingCourses(false);
        }
    };

    // Fetch courses when component mounts
    React.useEffect(() => {
        fetchAvailableCourses();
    }, []);

    // Update closing registration date and first session when course start date changes
    React.useEffect(() => {
        if (courseStartDate) {
            // Set closing registration date to course start date - 1 day
            const startDate = new Date(courseStartDate);
            startDate.setDate(startDate.getDate() - 1);
            setClosingRegistrationDate(startDate.toISOString().split('T')[0]);

            // Update first session's start date
            if (sessions.length > 0) {
                const newSessions = [...sessions];
                newSessions[0].startDate = courseStartDate;
                // For non-async modes, end date should match start date
                if (newSessions[0].modeOfTraining !== '2' && newSessions[0].modeOfTraining !== '4') {
                    newSessions[0].endDate = courseStartDate;
                }
                setSessions(newSessions);
            }
        }
    }, [courseStartDate]);

    // Helper functions
    const updateSessionCount = (count: number) => {
        const newSessions = [...sessions];
        if (count > sessions.length) {
            // Add new sessions
            for (let i = sessions.length; i < count; i++) {
                newSessions.push({
                    id: i,
                    modeOfTraining: '1',
                    startDate: '',
                    endDate: '',
                    startTime: '09:15',
                    endTime: '13:15',
                    useDefaultVenue: true,
                    block: '',
                    street: '',
                    building: '',
                    wheelchairAccess: OptionalSelector.YES,
                    primaryVenue: OptionalSelector.YES,
                    floor: '',
                    unit: '',
                    postalCode: '',
                    room: ''
                });
            }
        } else if (count < sessions.length) {
            // Remove sessions
            newSessions.splice(count);
        }
        setSessions(newSessions);
        setSessionCount(count);
    };

    const updateSessionField = (sessionIndex: number, field: string, value: any) => {
        const newSessions = [...sessions];
        newSessions[sessionIndex] = { ...newSessions[sessionIndex], [field]: value };

        // Handle automatic time setting for mode of training 2 and 4
        if (field === 'modeOfTraining') {
            if (value === '2' || value === '4') {
                newSessions[sessionIndex].startTime = '00:00';
                newSessions[sessionIndex].endTime = '23:59';
                // For mode 2 and 4, end date is based on user input, so don't auto-set it
            } else {
                // For other modes, set end date same as start date
                newSessions[sessionIndex].endDate = newSessions[sessionIndex].startDate;
                // Reset times to default values
                newSessions[sessionIndex].startTime = '09:15';
                newSessions[sessionIndex].endTime = '13:15';
            }
        }

        // When start date changes for non-2/4 modes, update end date to match
        if (field === 'startDate' && value !== '2' && value !== '4') {
            const currentMode = newSessions[sessionIndex].modeOfTraining;
            if (currentMode !== '2' && currentMode !== '4') {
                newSessions[sessionIndex].endDate = value;
            }
        }

        setSessions(newSessions);
    };



    const updateTrainerField = (trainerIndex: number, field: string, value: any) => {
        const newTrainers = [...trainers];
        newTrainers[trainerIndex] = { ...newTrainers[trainerIndex], [field]: value };
        setTrainers(newTrainers);
    };

    // Function to fetch course run details from SSG API and save to database
    const fetchAndSaveCourseRunData = async (courseRunId: string) => {
        try {
            const fetchResponse = await fetch(`/api/admin/ssg-get-course-run?courseRunId=${encodeURIComponent(courseRunId)}`);

            if (!fetchResponse.ok) {
                console.warn(`⚠️ Could not fetch course run details: ${fetchResponse.status}`);
                console.log('ℹ️ Course run created successfully in SSG but details could not be fetched for database sync');
                return;
            }

            const response = await fetchResponse.json();

            // response shape: { data: { course: { referenceNumber, title, run: {...} } } }
            const dataWrapper = response.data;

            if (!dataWrapper?.course) {
                console.warn('⚠️ No course data in SSG response');
                return;
            }

            const courseData = dataWrapper.course;
            const runData = courseData.run;

            // Step 1: Save course run to database with retry logic
            // The API endpoint handles course creation if needed
            let saveResponse;
            let retryCount = 0;
            const maxRetries = 3;

            while (retryCount < maxRetries) {
                try {
                    console.log(`💾 Attempting to save course run to database (attempt ${retryCount + 1}/${maxRetries})...`);

                    saveResponse = await fetch(getApiUrl('/api/admin/save-course-run'), {
                        method: 'POST',
                        headers: {
                            'Content-Type': 'application/json',
                            'Accept': 'application/json'
                        },
                        credentials: 'include',
                        body: JSON.stringify({
                            courseRunData: response,
                            courseRunId: courseRunId
                        })
                    });

                    if (saveResponse.ok) {
                        break; // Success, exit retry loop
                    } else {
                        // Try to get error details from response
                        const errorText = await saveResponse.text();
                        console.error('❌ Save API error response:', errorText);
                        throw new Error(`HTTP ${saveResponse.status}: ${saveResponse.statusText} - ${errorText}`);
                    }
                } catch (fetchError) {
                    retryCount++;
                    console.warn(`⚠️ Save attempt ${retryCount} failed:`, fetchError);

                    if (retryCount >= maxRetries) {
                        throw fetchError; // Final attempt failed
                    }

                    // Wait before retry (exponential backoff)
                    await new Promise(resolve => setTimeout(resolve, 1000 * retryCount));
                }
            }

            if (!saveResponse || !saveResponse.ok) {
                const errorText = await saveResponse?.text() || 'Unknown error';
                console.error('❌ Save API error details:', errorText);
                console.warn(`⚠️ Could not save course run to database: ${saveResponse?.status}`);
                console.log('ℹ️ Course run created successfully in SSG but could not be saved to local database');
                return;
            }

            const saveResult = await saveResponse.json();
            console.log('💾 Course run saved to database:', saveResult);

            if (saveResult.success) {
                const status = saveResult.data?.status || 'unknown';
                console.log(`✅ Database save successful - Status: ${status}`);
            } else {
                console.warn('⚠️ Database save returned unsuccessful:', saveResult.message);
                console.log('ℹ️ Course run created successfully in SSG but database save reported an issue');
            }

        } catch (error) {
            console.error('❌ Error fetching/saving course run data:', error);
            const errorMessage = error instanceof Error ? error.message : 'Unknown error occurred';
            console.warn(`⚠️ Database sync error: ${errorMessage}`);
            console.log('ℹ️ Course run created successfully in SSG, database sync can be performed later');
            // Don't show alert - just log the warning
        }
    };

    const handleSubmit = async () => {
        // Field validation before submission
        const missingFields: string[] = [];

        // 1. Course Run section validation (always required)
        if (!courseReferenceNumber.trim()) missingFields.push('Course Reference Number');
        if (!openingRegistrationDate) missingFields.push('Opening Registration Date');
        if (!closingRegistrationDate) missingFields.push('Closing Registration Date');
        if (!courseStartDate) missingFields.push('Course Start Date');
        if (!courseEndDate) missingFields.push('Course End Date');
        if (!floor.trim()) missingFields.push('Floor');
        if (!unit.trim()) missingFields.push('Unit');
        if (!postalCode.trim()) missingFields.push('Postal Code');
        if (!room.trim()) missingFields.push('Room');
        if (!modeOfTraining) missingFields.push('Mode of Training');
        if (!courseAdminEmail.trim()) missingFields.push('Course Admin Email');
        if (!courseVacancy) missingFields.push('Course Vacancy');

        // 2. Sessions section validation (if enabled)
        if (showSessions) {
            if (sessions.length === 0) {
                missingFields.push('At least one Session (since Add Sessions is selected)');
            } else {
                sessions.forEach((session, index) => {
                    const sessionPrefix = `Session ${index + 1}`;
                    if (!session.modeOfTraining) missingFields.push(`${sessionPrefix} - Mode of Training`);
                    if (!session.startDate) missingFields.push(`${sessionPrefix} - Start Date`);
                    if (!session.endDate) missingFields.push(`${sessionPrefix} - End Date`);
                    if (!session.startTime) missingFields.push(`${sessionPrefix} - Start Time`);
                    if (!session.endTime) missingFields.push(`${sessionPrefix} - End Time`);
                    // Check venue fields - use primary venue if useDefaultVenue is true
                    const sessionFloor = session.useDefaultVenue ? floor : session.floor;
                    const sessionUnit = session.useDefaultVenue ? unit : session.unit;
                    const sessionPostalCode = session.useDefaultVenue ? postalCode : session.postalCode;
                    const sessionRoom = session.useDefaultVenue ? room : session.room;
                    if (!sessionFloor.trim()) missingFields.push(`${sessionPrefix} - Floor`);
                    if (!sessionUnit.trim()) missingFields.push(`${sessionPrefix} - Unit`);
                    if (!sessionPostalCode.trim()) missingFields.push(`${sessionPrefix} - Postal Code`);
                    if (!sessionRoom.trim()) missingFields.push(`${sessionPrefix} - Room`);
                });
            }
        }

        // 3. Trainer section validation (if enabled)
        if (showTrainer) {
            if (!trainers[0]?.trainerIdNumber?.trim()) {
                missingFields.push('Trainer ID Number (since Assign Trainer is selected)');
            }
        }

        // If there are missing fields, show error and stop submission
        if (missingFields.length > 0) {
            const errorMessage = `Please fill in the following required fields:\n\n${missingFields.map(field => `• ${field}`).join('\n')}`;
            alert(errorMessage);
            return;
        }

        // Date validation checks (only if all required fields are filled)

        // 1. Check Registration Dates
        if (openingRegistrationDate && closingRegistrationDate) {
            const openingDate = new Date(openingRegistrationDate);
            const closingDate = new Date(closingRegistrationDate);
            if (closingDate <= openingDate) {
                alert('Error: Closing Registration Date must be after Opening Registration Date');
                return;
            }
        }

        // 2. Check Course Dates
        if (courseStartDate && courseEndDate) {
            const startDate = new Date(courseStartDate);
            const endDate = new Date(courseEndDate);
            if (endDate < startDate) {
                alert('Error: Course End Date cannot be earlier than Course Start Date');
                return;
            }
        }

        // 3. Check Sessions Date validation (only if sessions are enabled)
        if (showSessions) {
            for (let i = 0; i < sessions.length; i++) {
                const session = sessions[i];
                if (session.startDate && session.endDate) {
                    const sessionStartDate = new Date(session.startDate);
                    const sessionEndDate = new Date(session.endDate);
                    if (sessionEndDate < sessionStartDate) {
                        alert(`Error: Session ${i + 1} End Date cannot be earlier than Start Date`);
                        return;
                    }
                }
            }
        }

        // If all validations pass, proceed with submission
        try {
            setIsSubmitting(true);

            // Transform form data to API payload structure
            const formatDateForAPI = (dateStr: string) => {
                if (!dateStr) return '';
                return parseInt(dateStr.replace(/-/g, '')); // Convert YYYY-MM-DD to YYYYMMDD integer
            };

            // Generate schedule info from course dates
            const generateScheduleInfo = (startDate: string, endDate: string) => {
                if (!startDate || !endDate) return 'Course dates not specified';
                if (startDate === endDate) {
                    return `${startDate} - ${endDate}`; // Single day course
                } else {
                    return `${startDate} - ${endDate}`; // Multi-day course
                }
            };

            const scheduleInfo = generateScheduleInfo(courseStartDate, courseEndDate);

            // Fetch UEN from database before building request
            let uen = '';
            try {
                const uenResponse = await fetch('/api/training-provider/uen');
                if (!uenResponse.ok) {
                    throw new Error('Failed to fetch UEN from database');
                }
                const uenData = await uenResponse.json();
                uen = uenData.uen;
            } catch (uenError) {
                console.error('Error fetching UEN:', uenError);
                alert('Error fetching company UEN from database. Please try again.');
                return;
            }

            // Build the run object
            const runObject: any = {
                sequenceNumber: parseInt(String(sequenceNumber)) || 0,
                registrationDates: {
                    opening: formatDateForAPI(openingRegistrationDate),
                    closing: formatDateForAPI(closingRegistrationDate)
                },
                courseDates: {
                    start: formatDateForAPI(courseStartDate),
                    end: formatDateForAPI(courseEndDate)
                },
                scheduleInfoType: {
                    code: scheduleCode,
                    description: scheduleDescription
                },
                scheduleInfo: scheduleInfo,
                venue: {
                    floor: floor,
                    unit: unit,
                    postalCode: postalCode,
                    room: room,
                    wheelChairAccess: wheelchairAccess === OptionalSelector.YES,
                    ...(block && { block: block }),
                    ...(street && { street: street }),
                    ...(building && { building: building })
                },
                modeOfTraining: modeOfTraining,
                courseAdminEmail: courseAdminEmail,
                courseVacancy: {
                    code: courseVacancy,
                    description: courseVacancy === 'A' ? 'Available' : 'Full'
                },
                file: {
                    Name: ""
                }
            };

            // Add sessions only if enabled and has sessions
            if (showSessions && sessions.length > 0) {
                runObject.sessions = sessions.map(session => ({
                    startDate: session.startDate.replace(/-/g, ''),
                    endDate: session.endDate.replace(/-/g, ''),
                    startTime: session.startTime + ':00',
                    endTime: session.endTime + ':00',
                    modeOfTraining: session.modeOfTraining,
                    venue: {
                        floor: session.useDefaultVenue ? floor : session.floor,
                        unit: session.useDefaultVenue ? unit : session.unit,
                        postalCode: session.useDefaultVenue ? postalCode : session.postalCode,
                        room: session.useDefaultVenue ? room : session.room,
                        wheelChairAccess: true,
                        ...(block && { block: block }),
                        ...(street && { street: street }),
                        ...(building && { building: building })
                    }
                }));
            }

            // Add trainer only if enabled
            if (showTrainer && trainers[0]?.trainerIdNumber?.trim()) {
                runObject.linkCourseRunTrainer = [{
                    trainer: {
                        trainerType: {
                            code: trainers[0].trainerType,
                            description: trainers[0].trainerType === '1' ? 'Existing' : 'New'
                        },
                        idNumber: trainers[0].trainerIdNumber
                    }
                }];
            }

            // Build request body
            const requestBody = {
                course: {
                    courseReferenceNumber: courseReferenceNumber,
                    trainingProvider: {
                        uen: uen
                    },
                    runs: [runObject]
                }
            };

            const response = await fetch('/api/ssg/courses/courseRuns/create-new', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(requestBody)
            });

            const responseData = await response.json();

            if (!response.ok) {
                const errorDetails = responseData?.error?.details || [];
                const userFriendlyMessage = errorDetails[0]?.message
                    || responseData?.error?.message
                    || `SSG error ${response.status}`;

                setSubmissionResult({
                    success: false,
                    courseRunId: 'N/A',
                    message: userFriendlyMessage,
                    error: { message: userFriendlyMessage, details: errorDetails, status: response.status }
                });
            } else {
                const courseRunId = responseData?.data?.runs?.[0]?.id
                    || responseData?.runs?.[0]?.id
                    || responseData?.data?.run?.id;

                if (courseRunId) {
                    await fetchAndSaveCourseRunData(courseRunId);
                    setSubmissionResult({
                        success: true,
                        courseRunId: courseRunId.toString(),
                        message: 'Course run created successfully! The data has been saved to the database.'
                    });
                } else {
                    setSubmissionResult({
                        success: true,
                        courseRunId: 'Not available',
                        message: 'Course run created successfully! However, the course run ID could not be retrieved.'
                    });
                }
            }

        } catch (error) {
            console.error('Error submitting course run:', error);
            let errorMessage = 'Unknown error occurred';
            if (error instanceof TypeError && error.message.includes('fetch')) {
                errorMessage = 'Network error - please check your internet connection or CORS settings';
            } else if (error instanceof Error) {
                errorMessage = error.message;
            }
            
            setSubmissionResult({
                success: false,
                message: errorMessage,
                error: { message: errorMessage }
            });
        } finally {
            setIsSubmitting(false);
        }
    };

    const resetForm = () => {
        setSubmissionResult(null);
        setIsSubmitting(false);
    };

    // Show results view if submission completed
    if (submissionResult) {
        // Helper function to format date to YYYYMMDD
        const formatDateToYYYYMMDD = (dateStr: string) => {
            if (!dateStr) return 'N/A';
            return dateStr.replace(/-/g, '');
        };

        return (
            <div className="max-w-6xl mx-auto p-6">
                <Card>
                    <div className="p-6 border-b dark:border-gray-700">
                        <div className="flex items-center gap-3 mb-2">
                            {submissionResult.success ? (
                                <div className="w-10 h-10 bg-green-100 dark:bg-green-900/30 rounded-full flex items-center justify-center">
                                    <svg className="w-5 h-5 text-green-600 dark:text-green-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M5 13l4 4L19 7"></path>
                                    </svg>
                                </div>
                            ) : (
                                <div className="w-10 h-10 bg-red-100 dark:bg-red-900/30 rounded-full flex items-center justify-center">
                                    <svg className="w-5 h-5 text-red-600 dark:text-red-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M6 18L18 6M6 6l12 12"></path>
                                    </svg>
                                </div>
                            )}
                            <div>
                                <h2 className="text-2xl font-bold text-gray-900 dark:text-white">
                                    {submissionResult.success ? 'Class Creation Result' : 'Class Creation Result'}
                                </h2>
                                <p className="text-sm text-gray-600 dark:text-gray-400">
                                    {submissionResult.success ? 'Successfully created course run' : 'Failed to create course run'}
                                </p>
                            </div>
                        </div>
                    </div>

                    <div className="p-6">
                        <div className="overflow-x-auto">
                            <table className="min-w-full divide-y divide-gray-200 dark:divide-gray-600">
                                <thead className="bg-gray-50 dark:bg-gray-800">
                                    <tr>
                                        <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-300 uppercase tracking-wider">
                                            Course Reference Number
                                        </th>
                                        <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-300 uppercase tracking-wider">
                                            Course Start Date
                                        </th>
                                        <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-300 uppercase tracking-wider">
                                            Course End Date
                                        </th>
                                        <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-300 uppercase tracking-wider">
                                            Status
                                        </th>
                                        <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-300 uppercase tracking-wider">
                                            Course Run ID
                                        </th>
                                        <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-300 uppercase tracking-wider">
                                            Response
                                        </th>
                                    </tr>
                                </thead>
                                <tbody className="bg-white dark:bg-gray-700 divide-y divide-gray-200 dark:divide-gray-600">
                                    <tr className="hover:bg-gray-50 dark:hover:bg-gray-600">
                                        <td className="px-4 py-4 whitespace-nowrap text-sm font-medium text-gray-900 dark:text-white">
                                            {courseReferenceNumber}
                                        </td>
                                        <td className="px-4 py-4 whitespace-nowrap text-sm text-gray-500 dark:text-gray-300">
                                            {formatDateToYYYYMMDD(courseStartDate)}
                                        </td>
                                        <td className="px-4 py-4 whitespace-nowrap text-sm text-gray-500 dark:text-gray-300">
                                            {formatDateToYYYYMMDD(courseEndDate)}
                                        </td>
                                        <td className="px-4 py-4 whitespace-nowrap">
                                            <span className={`inline-flex px-2.5 py-1 text-xs font-semibold rounded-full ${
                                                submissionResult.success
                                                    ? 'bg-green-100 text-green-800 border border-green-200 dark:bg-green-900/30 dark:text-green-300 dark:border-green-700'
                                                    : 'bg-red-100 text-red-800 border border-red-200 dark:bg-red-900/30 dark:text-red-300 dark:border-red-700'
                                            }`}>
                                                {submissionResult.success ? 'Success' : 'Error'}
                                            </span>
                                        </td>
                                        <td className="px-4 py-4 whitespace-nowrap text-sm font-mono text-gray-900 dark:text-white">
                                            {submissionResult.courseRunId || 'N/A'}
                                        </td>
                                        <td className="px-4 py-4 text-sm text-gray-700 dark:text-gray-300">
                                            <div className="max-w-md">
                                                {submissionResult.success ? (
                                                    <div className="flex items-start gap-2">
                                                        <span className="text-green-600 dark:text-green-400">✓</span>
                                                        <span>Success</span>
                                                    </div>
                                                ) : (
                                                    <div className="flex items-start gap-2 text-red-700 dark:text-red-400">
                                                        <span>❌</span>
                                                        <span>{submissionResult.message || 'An unknown error occurred'}</span>
                                                    </div>
                                                )}
                                            </div>
                                        </td>
                                    </tr>
                                </tbody>
                            </table>
                        </div>

                        {/* Action buttons */}
                        <div className="flex gap-3 pt-6 mt-6 border-t dark:border-gray-700">
                            <Button onClick={resetForm} variant="outline" className="flex-1">
                                {submissionResult.success ? 'Create Another Class' : 'Try Again'}
                            </Button>
                            <Button onClick={() => setAdminPage(AdminPage.Dashboard)} className="flex-1">
                                Back to Dashboard
                            </Button>
                        </div>
                    </div>
                </Card>
            </div>
        );
    }

    // Show form
    return (
        <div className="max-w-6xl mx-auto p-6">
            <div className="flex justify-between items-center mb-6">
                <h2 className="text-3xl font-bold dark:text-white">Create New Class</h2>
            </div>

            {/* Course Run Section */}
            <div className="mb-12">
                <div className="flex items-center mb-6">
                    <h3 className="text-2xl font-bold text-gray-800 dark:text-white">Course Run</h3>
                </div>
                <div className="space-y-6">

                    {/* Basic Information */}
                    <FormSection title="Basic Information">
                        <div className="grid grid-cols-1 md:grid-cols-1 gap-4">
                            <div>
                                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                                    * Course Reference Number
                                </label>
                                <input
                                    type="text"
                                    value={courseReferenceNumber}
                                    onChange={(e) => setCourseReferenceNumber(e.target.value)}
                                    className={inputClasses}
                                    placeholder="Enter course code (e.g., TGS-2024001234)"
                                />
                                <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
                                    Enter the course code manually or select from available courses below
                                </p>
                            </div>
                            <div>
                                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                                    Or Select from Available Courses
                                </label>
                                {loadingCourses ? (
                                    <div className="flex items-center space-x-2">
                                        <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-blue-500"></div>
                                        <span className="text-sm text-gray-500 dark:text-gray-400">Loading courses...</span>
                                    </div>
                                ) : (
                                    <select
                                        value={courseReferenceNumber}
                                        onChange={(e) => setCourseReferenceNumber(e.target.value)}
                                        className={inputClasses}
                                    >
                                        <option value="">Select a course...</option>
                                        {availableCourses.map((course) => (
                                            <option key={course.courseCode} value={course.courseCode}>
                                                {course.title} ({course.courseCode})
                                            </option>
                                        ))}
                                    </select>
                                )}
                                {availableCourses.length === 0 && !loadingCourses && (
                                    <p className="text-xs text-amber-600 mt-1">
                                        No courses found in the database. You can still enter a course code manually above.
                                    </p>
                                )}
                            </div>
                        </div>
                    </FormSection>

                    {/* Registration Dates */}
                    <FormSection title="Registration Dates">
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                            <div>
                                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                                    * Opening Registration Date
                                </label>
                                <input
                                    type="date"
                                    value={openingRegistrationDate}
                                    onChange={(e) => setOpeningRegistrationDate(e.target.value)}
                                    className={inputClasses}
                                />
                            </div>

                            <div>
                                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                                    * Closing Registration Date
                                </label>
                                <input
                                    type="date"
                                    value={closingRegistrationDate}
                                    onChange={(e) => setClosingRegistrationDate(e.target.value)}
                                    className={inputClasses}
                                />
                            </div>
                        </div>
                    </FormSection>

                    {/* Course Dates */}
                    <FormSection title="Course Dates">
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                            <div>
                                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                                    * Course Start Date
                                </label>
                                <input
                                    type="date"
                                    value={courseStartDate}
                                    onChange={(e) => setCourseStartDate(e.target.value)}
                                    className={inputClasses}
                                />
                            </div>

                            <div>
                                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                                    * Course End Date
                                </label>
                                <input
                                    type="date"
                                    value={courseEndDate}
                                    onChange={(e) => setCourseEndDate(e.target.value)}
                                    className={inputClasses}
                                />
                            </div>
                        </div>
                    </FormSection>

                    {/* Venue Information */}
                    <FormSection title="Venue Information">
                        <div className="space-y-4">
                            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                                <div>
                                    <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                                        Venue Block
                                    </label>
                                    <input
                                        type="text"
                                        value={block}
                                        onChange={(e) => setBlock(e.target.value)}
                                        className={inputClasses}
                                        placeholder="12"
                                        maxLength={10}
                                    />
                                </div>

                                <div>
                                    <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                                        Venue Street
                                    </label>
                                    <input
                                        type="text"
                                        value={street}
                                        onChange={(e) => setStreet(e.target.value)}
                                        className={inputClasses}
                                        placeholder="WOODS SQUARE"
                                        maxLength={32}
                                    />
                                </div>

                                <div>
                                    <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                                        Venue Building
                                    </label>
                                    <input
                                        type="text"
                                        value={building}
                                        onChange={(e) => setBuilding(e.target.value)}
                                        className={inputClasses}
                                        placeholder="WOODS SQUARE"
                                        maxLength={66}
                                    />
                                </div>
                            </div>

                            <div>
                                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                                    Wheelchair Accessible
                                </label>
                                <select
                                    value={wheelchairAccess}
                                    onChange={(e) => setWheelchairAccess(e.target.value as OptionalSelector)}
                                    className={inputClasses}
                                >
                                    {optionalSelectorOptions.map(option => (
                                        <option key={option.value} value={option.value}>
                                            {option.label}
                                        </option>
                                    ))}
                                </select>
                            </div>

                            <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
                                <div>
                                    <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                                        * Floor
                                    </label>
                                    <input
                                        type="text"
                                        value={floor}
                                        onChange={(e) => setFloor(e.target.value)}
                                        className={inputClasses}
                                        placeholder="07"
                                        maxLength={3}
                                    />
                                </div>

                                <div>
                                    <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                                        * Unit
                                    </label>
                                    <input
                                        type="text"
                                        value={unit}
                                        onChange={(e) => setUnit(e.target.value)}
                                        className={inputClasses}
                                        placeholder="85-87"
                                        maxLength={5}
                                    />
                                </div>

                                <div>
                                    <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                                        * Postal Code
                                    </label>
                                    <input
                                        type="text"
                                        value={postalCode}
                                        onChange={(e) => setPostalCode(e.target.value)}
                                        className={inputClasses}
                                        placeholder="737715"
                                        maxLength={6}
                                    />
                                </div>

                                <div>
                                    <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                                        * Room
                                    </label>
                                    <input
                                        type="text"
                                        value={room}
                                        onChange={(e) => setRoom(e.target.value)}
                                        className={inputClasses}
                                        placeholder="Training room"
                                        maxLength={255}
                                    />
                                </div>
                            </div>
                        </div>
                    </FormSection>

                    {/* Course Admin Details */}
                    <FormSection title="Course Admin Details">
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                            <div>
                                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                                    * Mode of Training
                                </label>
                                <select
                                    value={modeOfTraining}
                                    onChange={(e) => setModeOfTraining(e.target.value)}
                                    className={inputClasses}
                                >
                                    {modeOfTrainingOptions.map(option => (
                                        <option key={option.value} value={option.value}>
                                            {option.label}
                                        </option>
                                    ))}
                                </select>
                            </div>

                            <div>
                                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                                    * Course Admin Email
                                </label>
                                <input
                                    type="email"
                                    value={courseAdminEmail}
                                    onChange={(e) => setCourseAdminEmail(e.target.value)}
                                    className={inputClasses}
                                    placeholder="admin@example.com"
                                    maxLength={255}
                                />
                            </div>
                        </div>
                    </FormSection>

                    {/* Course Vacancy Details */}
                    <FormSection title="Course Vacancy Details">
                        <div>
                            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                                * Course Vacancy
                            </label>
                            <select
                                value={courseVacancy}
                                onChange={(e) => setCourseVacancy(e.target.value)}
                                className={inputClasses}
                            >
                                {vacancyOptions.map(option => (
                                    <option key={option.value} value={option.value}>
                                        {option.label}
                                    </option>
                                ))}
                            </select>
                        </div>
                    </FormSection>
                </div>
            </div>

            {/* Optional Sections Checkboxes */}
            <div className="mb-12 border-t border-gray-200 pt-8">
                <div className="space-y-4">
                    <FormSection title="Optional Sections">
                        <div className="space-y-4">
                            <div className="flex items-center space-x-3">
                                <input
                                    type="checkbox"
                                    id="add-sessions"
                                    checked={showSessions}
                                    onChange={(e) => {
                                        const isChecked = e.target.checked;
                                        setShowSessions(isChecked);
                                        // If checking the box and no sessions exist, add one
                                        if (isChecked && sessions.length === 0) {
                                            setSessions([{
                                                id: 0,
                                                modeOfTraining: '1',
                                                startDate: '',
                                                endDate: '',
                                                startTime: '09:15',
                                                endTime: '13:15',
                                                useDefaultVenue: true,
                                                block: '',
                                                street: '',
                                                building: '',
                                                wheelchairAccess: OptionalSelector.YES,
                                                primaryVenue: OptionalSelector.YES,
                                                floor: '',
                                                unit: '',
                                                postalCode: '',
                                                room: ''
                                            }]);
                                            setSessionCount(1);
                                        }
                                    }}
                                    className="h-4 w-4 text-blue-600 focus:ring-blue-500 border-gray-300 rounded"
                                />
                                <label htmlFor="add-sessions" className="text-sm font-medium text-gray-700 dark:text-gray-300">
                                    Add Sessions
                                </label>
                                <span className="text-xs text-gray-500 dark:text-gray-400">
                                    (Add specific session details with dates, times, and venues)
                                </span>
                            </div>

                            <div className="flex items-center space-x-3">
                                <input
                                    type="checkbox"
                                    id="assign-trainer"
                                    checked={showTrainer}
                                    onChange={(e) => setShowTrainer(e.target.checked)}
                                    className="h-4 w-4 text-blue-600 focus:ring-blue-500 border-gray-300 rounded"
                                />
                                <label htmlFor="assign-trainer" className="text-sm font-medium text-gray-700 dark:text-gray-300">
                                    Assign Trainer
                                </label>
                                <span className="text-xs text-gray-500 dark:text-gray-400">
                                    (Assign an existing trainer to this course)
                                </span>
                            </div>
                        </div>
                    </FormSection>
                </div>
            </div>

            {/* Sessions Section */}
            {showSessions && (
                <div className="mb-12 border-t border-gray-200 pt-8">
                    <div className="flex items-center justify-between mb-6">
                        <h3 className="text-2xl font-bold text-gray-800 dark:text-white">Sessions</h3>
                        <Button
                            variant="outline"
                            onClick={() => updateSessionCount(sessions.length + 1)}
                            className="flex items-center space-x-2"
                        >
                            <span>Add New Session</span>
                        </Button>
                    </div>
                    <div className="space-y-6">

                        {sessions.map((session, index) => (
                            <FormSection key={session.id} title={
                                <div className="flex items-center justify-between">
                                    <span>Session {index + 1}</span>
                                    <Button
                                        variant="ghost"
                                        onClick={() => {
                                            const newSessions = sessions.filter((_, i) => i !== index);
                                            setSessions(newSessions);
                                            setSessionCount(newSessions.length);
                                            // Uncheck "Add Sessions" if no sessions left
                                            if (newSessions.length === 0) {
                                                setShowSessions(false);
                                            }
                                        }}
                                        className="text-red-500 hover:text-red-700 px-2 py-1 text-sm"
                                    >
                                        Remove
                                    </Button>
                                </div>
                            }>
                                <div className="space-y-4">
                                    <div>
                                        <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                                            * Mode of Training
                                        </label>
                                        <select
                                            value={session.modeOfTraining}
                                            onChange={(e) => updateSessionField(index, 'modeOfTraining', e.target.value)}
                                            className={inputClasses}
                                        >
                                            {modeOfTrainingOptions.map(option => (
                                                <option key={option.value} value={option.value}>
                                                    {option.label}
                                                </option>
                                            ))}
                                        </select>
                                    </div>

                                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                        <div>
                                            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                                                * Start Date
                                            </label>
                                            <input
                                                type="date"
                                                value={session.startDate}
                                                onChange={(e) => updateSessionField(index, 'startDate', e.target.value)}
                                                className={inputClasses}
                                            />
                                        </div>

                                        <div>
                                            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                                                * End Date
                                            </label>
                                            <input
                                                type="date"
                                                value={session.modeOfTraining === '2' || session.modeOfTraining === '4' ? session.endDate : session.startDate}
                                                onChange={(e) => updateSessionField(index, 'endDate', e.target.value)}
                                                className={`${inputClasses} ${session.modeOfTraining !== '2' && session.modeOfTraining !== '4' ? 'bg-gray-100 cursor-not-allowed' : ''}`}
                                                disabled={session.modeOfTraining !== '2' && session.modeOfTraining !== '4'}
                                            />
                                        </div>
                                    </div>

                                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                        <div>
                                            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                                                * Start Time
                                            </label>
                                            <input
                                                type="time"
                                                value={session.modeOfTraining === '2' || session.modeOfTraining === '4' ? '00:00' : session.startTime}
                                                onChange={(e) => updateSessionField(index, 'startTime', e.target.value)}
                                                className={`${inputClasses} ${session.modeOfTraining === '2' || session.modeOfTraining === '4' ? 'bg-gray-100 cursor-not-allowed' : ''}`}
                                                disabled={session.modeOfTraining === '2' || session.modeOfTraining === '4'}
                                            />
                                        </div>

                                        <div>
                                            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                                                * End Time
                                            </label>
                                            <input
                                                type="time"
                                                value={session.modeOfTraining === '2' || session.modeOfTraining === '4' ? '23:59' : session.endTime}
                                                onChange={(e) => updateSessionField(index, 'endTime', e.target.value)}
                                                className={`${inputClasses} ${session.modeOfTraining === '2' || session.modeOfTraining === '4' ? 'bg-gray-100 cursor-not-allowed' : ''}`}
                                                disabled={session.modeOfTraining === '2' || session.modeOfTraining === '4'}
                                            />
                                        </div>
                                    </div>

                                    {(session.modeOfTraining === '2' || session.modeOfTraining === '4') && (
                                        <div className="bg-blue-50 border border-blue-200 rounded-lg p-3">
                                            <p className="text-blue-700 text-sm">
                                                Start and end time are set to 12:00 AM to 11:59 PM respectively for this mode of training.
                                            </p>
                                        </div>
                                    )}

                                    {/* Session Venue */}
                                    <div className="border-t pt-4">
                                        <div className="flex items-center justify-between mb-3">
                                            <h5 className="font-medium text-gray-700 dark:text-gray-300">Venue Information</h5>
                                            <div className="flex items-center space-x-2">
                                                <input
                                                    type="checkbox"
                                                    id={`use-default-venue-${index}`}
                                                    checked={session.useDefaultVenue}
                                                    onChange={(e) => updateSessionField(index, 'useDefaultVenue', e.target.checked)}
                                                    className="h-4 w-4 text-blue-600 focus:ring-blue-500 border-gray-300 rounded"
                                                />
                                                <label htmlFor={`use-default-venue-${index}`} className="text-sm text-gray-600 dark:text-gray-400">
                                                    Use default primary venue
                                                </label>
                                            </div>
                                        </div>
                                        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
                                            <div>
                                                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                                                    * Floor
                                                </label>
                                                <input
                                                    type="text"
                                                    value={session.useDefaultVenue ? floor : session.floor}
                                                    onChange={(e) => updateSessionField(index, 'floor', e.target.value)}
                                                    className={`${inputClasses} ${session.useDefaultVenue ? 'bg-gray-100 dark:bg-gray-600 cursor-not-allowed' : ''}`}
                                                    placeholder="12"
                                                    maxLength={3}
                                                    disabled={session.useDefaultVenue}
                                                />
                                            </div>

                                            <div>
                                                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                                                    * Unit
                                                </label>
                                                <input
                                                    type="text"
                                                    value={session.useDefaultVenue ? unit : session.unit}
                                                    onChange={(e) => updateSessionField(index, 'unit', e.target.value)}
                                                    className={`${inputClasses} ${session.useDefaultVenue ? 'bg-gray-100 dark:bg-gray-600 cursor-not-allowed' : ''}`}
                                                    placeholder="123"
                                                    maxLength={5}
                                                    disabled={session.useDefaultVenue}
                                                />
                                            </div>

                                            <div>
                                                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                                                    * Postal Code
                                                </label>
                                                <input
                                                    type="text"
                                                    value={session.useDefaultVenue ? postalCode : session.postalCode}
                                                    onChange={(e) => updateSessionField(index, 'postalCode', e.target.value)}
                                                    className={`${inputClasses} ${session.useDefaultVenue ? 'bg-gray-100 dark:bg-gray-600 cursor-not-allowed' : ''}`}
                                                    placeholder="123456"
                                                    maxLength={6}
                                                    disabled={session.useDefaultVenue}
                                                />
                                            </div>

                                            <div>
                                                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                                                    * Room
                                                </label>
                                                <input
                                                    type="text"
                                                    value={session.useDefaultVenue ? room : session.room}
                                                    onChange={(e) => updateSessionField(index, 'room', e.target.value)}
                                                    className={`${inputClasses} ${session.useDefaultVenue ? 'bg-gray-100 dark:bg-gray-600 cursor-not-allowed' : ''}`}
                                                    placeholder="12A"
                                                    maxLength={255}
                                                    disabled={session.useDefaultVenue}
                                                />
                                            </div>
                                        </div>
                                    </div>
                                </div>
                            </FormSection>
                        ))}
                    </div>
                </div>
            )}

            {/* Trainer Section */}
            {showTrainer && (
                <div className="mb-12 border-t border-gray-200 pt-8">
                    <div className="flex items-center mb-6">
                        <h3 className="text-2xl font-bold text-gray-800 dark:text-white">Trainer</h3>
                    </div>
                    <div className="space-y-6">

                        <FormSection title="Assign Existing Trainer">
                            <div className="space-y-4">
                                <div className="bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded-lg p-4">
                                    <h4 className="font-semibold text-blue-800 dark:text-blue-300 mb-2">Existing Trainer Assignment</h4>
                                    <p className="text-blue-700 dark:text-blue-400 text-sm">
                                        Enter the Trainer ID Number to assign an existing trainer to this course.
                                        The system will automatically retrieve trainer details from the existing trainer database.
                                    </p>
                                </div>

                                <div>
                                    <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                                        * Trainer ID Number
                                    </label>
                                    <input
                                        type="text"
                                        value={trainers[0]?.trainerIdNumber || ''}
                                        onChange={(e) => updateTrainerField(0, 'trainerIdNumber', e.target.value)}
                                        className={inputClasses}
                                        placeholder="S1234567A"
                                        maxLength={50}
                                    />
                                    <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
                                        This refers to the NRIC number of the existing trainer.
                                    </p>
                                </div>
                            </div>
                        </FormSection>
                    </div>
                </div>
            )}

            {/* Action Buttons */}
            <div className="mt-8 mb-12 flex justify-end space-x-4">
                <Button variant="ghost" onClick={() => setAdminPage(AdminPage.Dashboard)}>
                    Cancel
                </Button>
                <Button onClick={handleSubmit} disabled={isSubmitting}>
                    {isSubmitting ? 'Creating...' : 'Create Class'}
                </Button>
            </div>
        </div>
    );
};