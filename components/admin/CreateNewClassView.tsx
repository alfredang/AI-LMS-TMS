import { getApiUrl, getFileUrl } from '@/lib/urlHelpers';
import React, { useState } from 'react';
import { Card } from '../ui/Card';
import { Button } from '../ui/Button';
import { useLms } from '@contexts/LmsContext';
import { AdminPage } from '@app-types';

// FormSection component definition moved outside to prevent re-creation on re-renders
const FormSection: React.FC<{ title: string | React.ReactNode; children: React.ReactNode; className?: string }> = ({ title, children, className = "" }) => (
    <Card className={`p-6 ${className}`}>
        <h3 className="text-xl font-bold mb-4">{title}</h3>
        <div className="space-y-4">{children}</div>
    </Card>
);

// Success Popup Component
const SuccessPopup: React.FC<{
    isOpen: boolean;
    onClose: () => void;
    courseRunId: string;
    message: string;
}> = ({ isOpen, onClose, courseRunId, message }) => {
    if (!isOpen) return null;

    return (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
            <div className="bg-white rounded-lg shadow-xl p-6 max-w-md w-full mx-4">
                <div className="flex items-center mb-4">
                    <div className="flex-shrink-0">
                        <div className="w-8 h-8 bg-green-100 rounded-full flex items-center justify-center">
                            <svg className="w-5 h-5 text-green-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M5 13l4 4L19 7"></path>
                            </svg>
                        </div>
                    </div>
                    <div className="ml-3">
                        <h3 className="text-lg font-medium text-gray-900">Success!</h3>
                    </div>
                </div>
                
                <div className="mb-4">
                    <p className="text-sm text-gray-700 mb-3">{message}</p>
                    <div className="bg-gray-50 border border-gray-200 rounded-lg p-3">
                        <p className="text-sm font-medium text-gray-800">Course Run ID:</p>
                        <p className="text-lg font-mono text-blue-600 mt-1">{courseRunId}</p>
                    </div>
                </div>
                
                <div className="flex justify-end">
                    <Button onClick={onClose} className="bg-green-600 hover:bg-green-700 text-white">
                        Got it!
                    </Button>
                </div>
            </div>
        </div>
    );
};

// Types and enums for form data
export enum OptionalSelector {
    YES = 'true',
    NO = 'false'
}

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
    const { setAdminPage, currentUser } = useLms();
    
    // Course Run Form State
    const [courseReferenceNumber, setCourseReferenceNumber] = useState('');
    const [availableCourses, setAvailableCourses] = useState<{id: string, title: string, courseCode: string, tscTitle: string, tscCode: string}[]>([]);
    const [loadingCourses, setLoadingCourses] = useState(false);
    const [includeExpired, setIncludeExpired] = useState(false);
    const [sequenceNumber, setSequenceNumber] = useState(0);
    
    // Registration Dates
    const [openingRegistrationDate, setOpeningRegistrationDate] = useState('');
    const [closingRegistrationDate, setClosingRegistrationDate] = useState('');
    
    // Course Dates
    const [courseStartDate, setCourseStartDate] = useState('');
    const [courseEndDate, setCourseEndDate] = useState('');
    
    // Schedule Info - Default values (not user-editable)
    const [scheduleCode] = useState('01');
    const [scheduleDescription] = useState('Description');
    // scheduleInfo will be dynamically generated from course dates
    
    // Venue Info
    const [block, setBlock] = useState('');
    const [street, setStreet] = useState('');
    const [building, setBuilding] = useState('');
    const [wheelchairAccess, setWheelchairAccess] = useState(OptionalSelector.YES);
    const [floor, setFloor] = useState('');
    const [unit, setUnit] = useState('');
    const [postalCode, setPostalCode] = useState('');
    const [room, setRoom] = useState('');
    
    // Intake Details
    const [intakeSize, setIntakeSize] = useState(0);
    const [threshold, setThreshold] = useState(0);
    const [registeredUserCount, setRegisteredUserCount] = useState(0);
    
    // Course Admin Details
    const [modeOfTraining, setModeOfTraining] = useState('1');
    const [courseAdminEmail, setCourseAdminEmail] = useState(currentUser?.email || '');
    
    // Course Vacancy
    const [courseVacancy, setCourseVacancy] = useState('A');
    
    // Sessions Form State
    const [sessionCount, setSessionCount] = useState(1);
    const [sessions, setSessions] = useState([{
        id: 0,
        modeOfTraining: '1',
        startDate: '',
        endDate: '',
        startTime: '',
        endTime: '',
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
    
    // Trainer Form State - Single existing trainer only
    const [trainers, setTrainers] = useState([{
        id: 0,
        trainerType: '1', // Always existing trainer
        trainerIdNumber: ''
    }]);
    
    // API submission state
    const [isSubmitting, setIsSubmitting] = useState(false);
    const [apiResponse, setApiResponse] = useState<any>(null);
    const [requestBody, setRequestBody] = useState<any>(null);
    
    // Success popup state
    const [showSuccessPopup, setShowSuccessPopup] = useState(false);
    const [successData, setSuccessData] = useState<{courseRunId: string, message: string} | null>(null);
    
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
    
    const inputClasses = "block w-full px-3 py-2 text-on-surface bg-white border border-gray-300 rounded-md shadow-sm placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent";
    
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
                    startTime: '',
                    endTime: '',
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
                // Reset times to allow user input
                newSessions[sessionIndex].startTime = '';
                newSessions[sessionIndex].endTime = '';
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
            console.log('🔍 Fetching course run details for ID:', courseRunId);
            
            // Fetch detailed course run data from SSG API
            const params = new URLSearchParams({
                runId: courseRunId,
                includeExpired: 'true'
            });

            const fetchResponse = await fetch(`/api/ssg/courses?${params}`, {
                method: 'GET',
                headers: {
                    'Content-Type': 'application/json'
                }
            });

            if (!fetchResponse.ok) {
                throw new Error(`Failed to fetch course run details: ${fetchResponse.status}`);
            }

            const courseRunData = await fetchResponse.json();
            console.log('📊 Fetched course run data:', courseRunData);

            // Save to database with retry logic
            let saveResponse;
            let retryCount = 0;
            const maxRetries = 3;

            while (retryCount < maxRetries) {
                try {
                    console.log(`💾 Attempting to save to database (attempt ${retryCount + 1}/${maxRetries})...`);
                    
                    saveResponse = await fetch(getApiUrl('/api/admin/save-course-run'), {
                        method: 'POST',
                        headers: {
                            'Content-Type': 'application/json',
                            'Accept': 'application/json'
                        },
                        credentials: 'include',
                        body: JSON.stringify({
                            courseRunData: courseRunData,
                            courseRunId: courseRunId
                        })
                    });

                    if (saveResponse.ok) {
                        break; // Success, exit retry loop
                    } else {
                        throw new Error(`HTTP ${saveResponse.status}: ${saveResponse.statusText}`);
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
                throw new Error(`Failed to save course run to database: ${saveResponse?.status} - ${errorText}`);
            }

            const saveResult = await saveResponse.json();
            console.log('💾 Course run saved to database:', saveResult);
            
            if (saveResult.success) {
                const status = saveResult.data?.status || 'unknown';
                console.log(`✅ Database save successful - Status: ${status}`);
                // Success is already shown in the popup, no need for additional alerts
            } else {
                throw new Error(saveResult.message || 'Failed to save to database');
            }
            
        } catch (error) {
            console.error('❌ Error fetching/saving course run data:', error);
            const errorMessage = error instanceof Error ? error.message : 'Unknown error occurred';
            alert(`Error saving course run to database: ${errorMessage}`);
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
                    if (!session.floor.trim()) missingFields.push(`${sessionPrefix} - Floor`);
                    if (!session.unit.trim()) missingFields.push(`${sessionPrefix} - Unit`);
                    if (!session.postalCode.trim()) missingFields.push(`${sessionPrefix} - Postal Code`);
                    if (!session.room.trim()) missingFields.push(`${sessionPrefix} - Room`);
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
            if (closingDate < openingDate) {
                alert('Error: Closing Registration Date cannot be earlier than Opening Registration Date');
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
            setApiResponse(null);
            setRequestBody(null);
            
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
            
            // Build request body in the complex nested structure as specified
            const requestBody = {
                course: {
                    courseReferenceNumber: courseReferenceNumber,
                    trainingProvider: {
                        uen: "" // Will be fetched from database
                    },
                    runs: [
                        {
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
                                ...(block && { block: block }),
                                ...(street && { street: street }),
                                ...(building && { building: building }),
                                ...(wheelchairAccess && { wheelChairAccess: wheelchairAccess === OptionalSelector.YES })
                            },
                            modeOfTraining: modeOfTraining,
                            courseAdminEmail: courseAdminEmail,
                            courseVacancy: {
                                code: courseVacancy,
                                description: courseVacancy === 'A' ? 'Available' : 'Full'
                            },
                            file: {
                                Name: "",
                                content: ""
                            },
                            ...(showSessions && {
                                sessions: sessions.map(session => ({
                                    startDate: session.startDate.replace(/-/g, ''), // YYYYMMDD format
                                    endDate: session.endDate.replace(/-/g, ''), // YYYYMMDD format
                                    startTime: session.startTime,
                                    endTime: session.endTime,
                                    modeOfTraining: session.modeOfTraining,
                                    venue: {
                                        floor: session.floor,
                                        unit: session.unit,
                                        postalCode: session.postalCode,
                                        room: session.room
                                    }
                                }))
                            }),
                            ...(showTrainer && {
                                linkCourseRunTrainer: trainers.map(trainer => ({
                                    trainer: {
                                        photo: {
                                            name: "",
                                            content: ""
                                        },
                                        trainerType: {
                                            code: trainer.trainerType,
                                            description: trainer.trainerType === '1' ? 'Existing' : 'New'
                                        },
                                        idNumber: trainer.trainerIdNumber
                                    }
                                }))
                            })
                        }
                    ]
                }
            };
            
            // Fetch UEN from database before sending request
            try {
                const uenResponse = await fetch('/api/training-provider/uen');
                if (!uenResponse.ok) {
                    throw new Error('Failed to fetch UEN from database');
                }
                const uenData = await uenResponse.json();
                requestBody.course.trainingProvider.uen = uenData.uen;
            } catch (uenError) {
                console.error('Error fetching UEN:', uenError);
                alert('Error fetching company UEN from database. Please try again.');
                return;
            }
            
            // Store request body for display
            setRequestBody(requestBody);
            
            console.log('Submitting course run data:', requestBody);
            
            // Call the API
            const response = await fetch('/api/ssg/courses/courseRuns/create-new?includeExpiredCourses=false', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify(requestBody)
            });
            
            const responseData = await response.json();
            setApiResponse(responseData);
            
            // Fixed response handling - properly check for success with status 200
            const isSuccess = response.ok && responseData.status === 200 && !responseData.error?.message;
            
            if (isSuccess) {
                console.log('✅ SSG API success:', responseData);
                
                // Extract course run ID from response
                const courseRunId = responseData.data?.runs?.[0]?.id;
                if (courseRunId) {
                    console.log('📝 Course Run ID from response:', courseRunId);
                    
                    // Show success popup with course run ID
                    setSuccessData({
                        courseRunId: courseRunId.toString(),
                        message: 'Course run created successfully! The data has been saved to the database.'
                    });
                    setShowSuccessPopup(true);
                    
                    // Fetch detailed course run data and save to database
                    await fetchAndSaveCourseRunData(courseRunId);
                } else {
                    console.warn('⚠️ No course run ID found in response');
                    setSuccessData({
                        courseRunId: 'Not available',
                        message: 'Course run created successfully! However, the course run ID could not be retrieved.'
                    });
                    setShowSuccessPopup(true);
                }
            } else {
                const errorMessage = responseData.error?.message || responseData.error || responseData.message || 'Unknown error';
                alert(`Error creating course run: ${errorMessage}`);
                console.error('❌ API Error:', responseData);
            }
            
        } catch (error) {
            console.error('Error submitting course run:', error);
            const errorMessage = error instanceof Error ? error.message : 'Unknown error occurred';
            setApiResponse({ error: errorMessage });
            alert(`Error creating course run: ${errorMessage}`);
        } finally {
            setIsSubmitting(false);
        }
    };
    
    return (
        <div className="max-w-6xl mx-auto p-6">
            <div className="flex justify-between items-center mb-6">
                <h2 className="text-3xl font-bold">Create New Class</h2>
                <div>
                    <Button variant="ghost" onClick={() => setAdminPage(AdminPage.Dashboard)} className="mr-2">
                        Cancel
                    </Button>
                    <Button onClick={handleSubmit} disabled={isSubmitting}>
                        {isSubmitting ? 'Creating...' : 'Create Class'}
                    </Button>
                </div>
            </div>
            
            {/* Course Run Section */}
            <div className="mb-12">
                <div className="flex items-center mb-6">
                    <h3 className="text-2xl font-bold text-gray-800">Course Run</h3>
                </div>
                <div className="space-y-6">
                    
                    {/* Basic Information */}
                    <FormSection title="Basic Information">
                        <div className="grid grid-cols-1 md:grid-cols-1 gap-4">
                            <div>
                                <label className="block text-sm font-medium text-gray-700 mb-1">
                                    * Select the Course
                                </label>
                                {loadingCourses ? (
                                    <div className="flex items-center space-x-2">
                                        <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-blue-500"></div>
                                        <span className="text-sm text-gray-500">Loading courses...</span>
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
                                        No courses found. Please create a course first.
                                    </p>
                                )}
                            </div>
                        </div>
                    </FormSection>
                    
                    {/* Registration Dates */}
                    <FormSection title="Registration Dates">
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                            <div>
                                <label className="block text-sm font-medium text-gray-700 mb-1">
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
                                <label className="block text-sm font-medium text-gray-700 mb-1">
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
                                <label className="block text-sm font-medium text-gray-700 mb-1">
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
                                <label className="block text-sm font-medium text-gray-700 mb-1">
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
                                    <label className="block text-sm font-medium text-gray-700 mb-1">
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
                                    <label className="block text-sm font-medium text-gray-700 mb-1">
                                        Venue Street
                                    </label>
                                    <input
                                        type="text"
                                        value={street}
                                        onChange={(e) => setStreet(e.target.value)}
                                        className={inputClasses}
                                        placeholder="Street 12"
                                        maxLength={32}
                                    />
                                </div>
                                
                                <div>
                                    <label className="block text-sm font-medium text-gray-700 mb-1">
                                        Venue Building
                                    </label>
                                    <input
                                        type="text"
                                        value={building}
                                        onChange={(e) => setBuilding(e.target.value)}
                                        className={inputClasses}
                                        placeholder="Building ABC"
                                        maxLength={66}
                                    />
                                </div>
                            </div>
                            
                            <div>
                                <label className="block text-sm font-medium text-gray-700 mb-1">
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
                                    <label className="block text-sm font-medium text-gray-700 mb-1">
                                        * Floor
                                    </label>
                                    <input
                                        type="text"
                                        value={floor}
                                        onChange={(e) => setFloor(e.target.value)}
                                        className={inputClasses}
                                        placeholder="12"
                                        maxLength={3}
                                    />
                                </div>
                                
                                <div>
                                    <label className="block text-sm font-medium text-gray-700 mb-1">
                                        * Unit
                                    </label>
                                    <input
                                        type="text"
                                        value={unit}
                                        onChange={(e) => setUnit(e.target.value)}
                                        className={inputClasses}
                                        placeholder="123"
                                        maxLength={5}
                                    />
                                </div>
                                
                                <div>
                                    <label className="block text-sm font-medium text-gray-700 mb-1">
                                        * Postal Code
                                    </label>
                                    <input
                                        type="text"
                                        value={postalCode}
                                        onChange={(e) => setPostalCode(e.target.value)}
                                        className={inputClasses}
                                        placeholder="123456"
                                        maxLength={6}
                                    />
                                </div>
                                
                                <div>
                                    <label className="block text-sm font-medium text-gray-700 mb-1">
                                        * Room
                                    </label>
                                    <input
                                        type="text"
                                        value={room}
                                        onChange={(e) => setRoom(e.target.value)}
                                        className={inputClasses}
                                        placeholder="12A"
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
                                <label className="block text-sm font-medium text-gray-700 mb-1">
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
                                <label className="block text-sm font-medium text-gray-700 mb-1">
                                    * Course Admin Email
                                </label>
                                <input
                                    type="email"
                                    value={courseAdminEmail}
                                    className={`${inputClasses} bg-gray-100 cursor-not-allowed`}
                                    placeholder="admin@example.com"
                                    maxLength={255}
                                    readOnly
                                />
                                <p className="text-xs text-gray-500 mt-1">
                                    Auto-filled with your account email
                                </p>
                            </div>
                        </div>
                    </FormSection>
                    
                    {/* Course Vacancy Details */}
                    <FormSection title="Course Vacancy Details">
                        <div>
                            <label className="block text-sm font-medium text-gray-700 mb-1">
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
                                    onChange={(e) => setShowSessions(e.target.checked)}
                                    className="h-4 w-4 text-blue-600 focus:ring-blue-500 border-gray-300 rounded"
                                />
                                <label htmlFor="add-sessions" className="text-sm font-medium text-gray-700">
                                    Add Sessions
                                </label>
                                <span className="text-xs text-gray-500">
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
                                <label htmlFor="assign-trainer" className="text-sm font-medium text-gray-700">
                                    Assign Trainer
                                </label>
                                <span className="text-xs text-gray-500">
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
                    <h3 className="text-2xl font-bold text-gray-800">Sessions</h3>
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
                                {sessions.length > 1 && (
                                    <Button 
                                        variant="ghost" 
                                        onClick={() => {
                                            const newSessions = sessions.filter((_, i) => i !== index);
                                            setSessions(newSessions);
                                            setSessionCount(newSessions.length);
                                        }}
                                        className="text-red-500 hover:text-red-700 px-2 py-1 text-sm"
                                    >
                                        Remove
                                    </Button>
                                )}
                            </div>
                        }>
                            <div className="space-y-4">
                                <div>
                                    <label className="block text-sm font-medium text-gray-700 mb-1">
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
                                        <label className="block text-sm font-medium text-gray-700 mb-1">
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
                                        <label className="block text-sm font-medium text-gray-700 mb-1">
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
                                        <label className="block text-sm font-medium text-gray-700 mb-1">
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
                                        <label className="block text-sm font-medium text-gray-700 mb-1">
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
                                
                                {(session.modeOfTraining === '2' || session.modeOfTraining === '4') ? (
                                    <div className="bg-blue-50 border border-blue-200 rounded-lg p-3">
                                        <p className="text-blue-700 text-sm">
                                            Start and end time are set to 12:00 AM to 11:59 PM respectively for this mode of training.
                                        </p>
                                    </div>
                                ) : (
                                    session.startDate && (
                                        <div className="bg-blue-50 border border-blue-200 rounded-lg p-3">
                                            <p className="text-blue-700 text-sm">
                                                End date of course session is automatically set to {session.startDate}
                                            </p>
                                        </div>
                                    )
                                )}
                                
                                {/* Session Venue */}
                                <div className="border-t pt-4">
                                    <h5 className="font-medium text-gray-700 mb-3">Venue Information</h5>
                                    <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
                                        <div>
                                            <label className="block text-sm font-medium text-gray-700 mb-1">
                                                * Floor
                                            </label>
                                            <input
                                                type="text"
                                                value={session.floor}
                                                onChange={(e) => updateSessionField(index, 'floor', e.target.value)}
                                                className={inputClasses}
                                                placeholder="12"
                                                maxLength={3}
                                            />
                                        </div>
                                        
                                        <div>
                                            <label className="block text-sm font-medium text-gray-700 mb-1">
                                                * Unit
                                            </label>
                                            <input
                                                type="text"
                                                value={session.unit}
                                                onChange={(e) => updateSessionField(index, 'unit', e.target.value)}
                                                className={inputClasses}
                                                placeholder="123"
                                                maxLength={5}
                                            />
                                        </div>
                                        
                                        <div>
                                            <label className="block text-sm font-medium text-gray-700 mb-1">
                                                * Postal Code
                                            </label>
                                            <input
                                                type="text"
                                                value={session.postalCode}
                                                onChange={(e) => updateSessionField(index, 'postalCode', e.target.value)}
                                                className={inputClasses}
                                                placeholder="123456"
                                                maxLength={6}
                                            />
                                        </div>
                                        
                                        <div>
                                            <label className="block text-sm font-medium text-gray-700 mb-1">
                                                * Room
                                            </label>
                                            <input
                                                type="text"
                                                value={session.room}
                                                onChange={(e) => updateSessionField(index, 'room', e.target.value)}
                                                className={inputClasses}
                                                placeholder="12A"
                                                maxLength={255}
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
                    <h3 className="text-2xl font-bold text-gray-800">Trainer</h3>
                </div>
                <div className="space-y-6">
                    
                    <FormSection title="Assign Existing Trainer">
                        <div className="space-y-4">
                            <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
                                <h4 className="font-semibold text-blue-800 mb-2">Existing Trainer Assignment</h4>
                                <p className="text-blue-700 text-sm">
                                    Enter the Trainer ID Number to assign an existing trainer to this course. 
                                    The system will automatically retrieve trainer details from the existing trainer database.
                                </p>
                            </div>
                            
                            <div>
                                <label className="block text-sm font-medium text-gray-700 mb-1">
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
                                <p className="text-xs text-gray-500 mt-1">
                                    This refers to the NRIC number of the existing trainer.
                                </p>
                            </div>
                        </div>
                    </FormSection>
                </div>
            </div>
            )}
            
            {/* API Debug Section */}
            {(requestBody || apiResponse) && (
                <div className="mb-12 border-t border-gray-200 pt-8">
                    <div className="flex items-center mb-6">
                        <h3 className="text-2xl font-bold text-gray-800">API Debug Information</h3>
                    </div>
                    <div className="space-y-6">
                        
                        {/* Request Body Display */}
                        {requestBody && (
                            <FormSection title="Request Body Sent to API">
                                <div className="bg-gray-50 border border-gray-200 rounded-lg p-4">
                                    <pre className="text-sm text-gray-700 whitespace-pre-wrap overflow-x-auto max-h-96">
                                        {JSON.stringify(requestBody, null, 2)}
                                    </pre>
                                </div>
                            </FormSection>
                        )}
                        
                        {/* API Response Display */}
                        {apiResponse && (
                            <FormSection title="API Response">
                                <div className={`border rounded-lg p-4 ${
                                    (apiResponse.status === 200 && !apiResponse.error?.message) ? 'bg-green-50 border-green-200' : 'bg-red-50 border-red-200'
                                }`}>
                                    <div className="mb-2">
                                        <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${
                                            (apiResponse.status === 200 && !apiResponse.error?.message) ? 'bg-green-100 text-green-800' : 'bg-red-100 text-red-800'
                                        }`}>
                                            {(apiResponse.status === 200 && !apiResponse.error?.message) ? 'Success' : 'Error'}
                                        </span>
                                    </div>
                                    <pre className="text-sm text-gray-700 whitespace-pre-wrap overflow-x-auto max-h-96">
                                        {JSON.stringify(apiResponse, null, 2)}
                                    </pre>
                                </div>
                            </FormSection>
                        )}
                    </div>
                </div>
            )}
            
            {/* Success Popup */}
            <SuccessPopup
                isOpen={showSuccessPopup}
                onClose={() => {
                    setShowSuccessPopup(false);
                    setSuccessData(null);
                }}
                courseRunId={successData?.courseRunId || ''}
                message={successData?.message || ''}
            />
        </div>
    );
};