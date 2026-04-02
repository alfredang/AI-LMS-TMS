import React, { useState, useEffect } from 'react';
import { Card } from '../ui/Card';
import { Button } from '../ui/Button';
import { useLms } from '@contexts/LmsContext';
import { AdminPage } from '@app-types';

// ── Local enums (mirrors CreateNewClassView) ──────────────────────────────────

enum OptionalSelector {
    YES = 'true',
    NO = 'false',
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
    { value: '9', label: '9 - Virtual Classroom' },
];

const vacancyOptions = [
    { value: 'A', label: 'A - Available' },
    { value: 'F', label: 'F - Full' },
];

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Convert YYYYMMDD number/string → YYYY-MM-DD string for <input type="date"> */
const toDateInput = (val: any): string => {
    if (!val) return '';
    const s = String(val);
    if (/^\d{8}$/.test(s)) return `${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)}`;
    if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
    return '';
};

// ── FormSection ───────────────────────────────────────────────────────────────

const FormSection: React.FC<{ title: string; children: React.ReactNode }> = ({ title, children }) => (
    <Card className="p-6">
        <h3 className="text-xl font-bold mb-4 dark:text-white">{title}</h3>
        <div className="space-y-4">{children}</div>
    </Card>
);

// ── EditCourseRunView ─────────────────────────────────────────────────────────

export const EditCourseRunView: React.FC = () => {
    const { setAdminPage, selectedCourseRunId, setSelectedCourseRunId } = useLms();

    const inputClasses = 'block w-full px-3 py-2 text-on-surface bg-white border border-gray-300 rounded-md shadow-sm placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent dark:bg-gray-700 dark:border-gray-600 dark:text-white dark:placeholder-gray-500';
    const readonlyClasses = 'block w-full px-3 py-2 bg-gray-100 border border-gray-200 rounded-md text-gray-600 dark:bg-gray-800 dark:border-gray-700 dark:text-gray-400 cursor-not-allowed';

    // ── Course Run ID input ──────────────────────────────────────────────────
    const [courseRunId, setCourseRunId] = useState(selectedCourseRunId || '');
    const [isFetching, setIsFetching] = useState(false);
    const [fetchError, setFetchError] = useState<string | null>(null);
    const [isDataLoaded, setIsDataLoaded] = useState(false);

    // ── Read-only info ───────────────────────────────────────────────────────
    const [courseReferenceNumber, setCourseReferenceNumber] = useState('');
    const [courseTitle, setCourseTitle] = useState('');

    // ── Editable form fields ─────────────────────────────────────────────────
    const [sequenceNumber, setSequenceNumber] = useState(0);
    const [openingRegistrationDate, setOpeningRegistrationDate] = useState('');
    const [closingRegistrationDate, setClosingRegistrationDate] = useState('');
    const [courseStartDate, setCourseStartDate] = useState('');
    const [courseEndDate, setCourseEndDate] = useState('');

    const [block, setBlock] = useState('');
    const [street, setStreet] = useState('');
    const [building, setBuilding] = useState('');
    const [floor, setFloor] = useState('');
    const [unit, setUnit] = useState('');
    const [postalCode, setPostalCode] = useState('');
    const [room, setRoom] = useState('');
    const [wheelchairAccess, setWheelchairAccess] = useState(OptionalSelector.YES);

    const [modeOfTraining, setModeOfTraining] = useState('1');
    const [courseAdminEmail, setCourseAdminEmail] = useState('');
    const [courseVacancy, setCourseVacancy] = useState('A');

    // ── Sessions (optional) ──────────────────────────────────────────────────
    const [showSessions, setShowSessions] = useState(false);
    const [sessionCount, setSessionCount] = useState(0);
    const [sessions, setSessions] = useState<any[]>([]);

    // ── Trainer (optional) ───────────────────────────────────────────────────
    const [showTrainer, setShowTrainer] = useState(false);
    const [trainers, setTrainers] = useState([{ id: 0, trainerType: '1', trainerIdNumber: '' }]);

    // ── Submission ───────────────────────────────────────────────────────────
    const [isSubmitting, setIsSubmitting] = useState(false);
    const [submissionResult, setSubmissionResult] = useState<{
        success: boolean;
        message?: string;
        error?: any;
    } | null>(null);

    // ── Auto-fetch if navigated from ViewCourseRun ───────────────────────────
    useEffect(() => {
        if (selectedCourseRunId) {
            setCourseRunId(selectedCourseRunId);
            handleFetch(selectedCourseRunId);
        }
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    // ── Fetch + populate form ────────────────────────────────────────────────
    const handleFetch = async (idOverride?: string) => {
        const id = (idOverride ?? courseRunId).trim();
        if (!id) {
            setFetchError('Please enter a Course Run ID');
            return;
        }

        setIsFetching(true);
        setFetchError(null);
        setIsDataLoaded(false);

        try {
            const res = await fetch(`/api/course-runs/view?courseRunId=${encodeURIComponent(id)}`);
            const json = await res.json();

            if (!json.success) throw new Error(json.error || `SSG API error ${res.status}`);

            // data = { course: { referenceNumber, title, run: {...} } }
            const courseData = json.data?.course;
            const run = courseData?.run;

            if (!courseData || !run) throw new Error('No course run data returned from SSG');

            // Populate read-only info
            setCourseReferenceNumber(courseData.referenceNumber ?? courseData.externalReferenceNumber ?? '');
            setCourseTitle(courseData.title ?? '');

            // Populate form fields
            setSequenceNumber(run.sequenceNumber ?? 0);
            setCourseStartDate(toDateInput(run.courseStartDate ?? run.courseDates?.start));
            setCourseEndDate(toDateInput(run.courseEndDate ?? run.courseDates?.end));
            setOpeningRegistrationDate(toDateInput(run.registrationOpeningDate ?? run.registrationDates?.opening));
            setClosingRegistrationDate(toDateInput(run.registrationClosingDate ?? run.registrationDates?.closing));

            const venue = run.venue ?? {};
            setBlock(venue.block ?? '');
            setStreet(venue.street ?? '');
            setBuilding(venue.building ?? '');
            setFloor(venue.floor ?? '');
            setUnit(venue.unit ?? '');
            setPostalCode(venue.postalCode ?? '');
            setRoom(venue.room ?? '');
            setWheelchairAccess(venue.wheelChairAccess ? OptionalSelector.YES : OptionalSelector.NO);

            setModeOfTraining(run.modeOfTraining ?? '1');
            setCourseAdminEmail(run.courseAdminEmail ?? '');
            setCourseVacancy(run.courseVacancy?.code ?? 'A');

            setIsDataLoaded(true);
        } catch (err) {
            setFetchError(err instanceof Error ? err.message : 'Failed to fetch course run data');
        } finally {
            setIsFetching(false);
        }
    };

    // ── Session helpers ──────────────────────────────────────────────────────
    const updateSessionCount = (count: number) => {
        const newSessions = [...sessions];
        if (count > sessions.length) {
            for (let i = sessions.length; i < count; i++) {
                newSessions.push({
                    id: i, modeOfTraining: '1',
                    startDate: '', endDate: '', startTime: '09:15', endTime: '13:15',
                    useDefaultVenue: true, block: '', street: '', building: '',
                    wheelchairAccess: OptionalSelector.YES, floor: '', unit: '', postalCode: '', room: '',
                });
            }
        } else {
            newSessions.splice(count);
        }
        setSessions(newSessions);
        setSessionCount(count);
    };

    const updateSessionField = (idx: number, field: string, value: any) => {
        const updated = [...sessions];
        updated[idx] = { ...updated[idx], [field]: value };
        if (field === 'modeOfTraining') {
            if (value === '2' || value === '4') {
                updated[idx].startTime = '00:00';
                updated[idx].endTime = '23:59';
            } else {
                updated[idx].endDate = updated[idx].startDate;
                updated[idx].startTime = '09:15';
                updated[idx].endTime = '13:15';
            }
        }
        if (field === 'startDate') {
            const mode = updated[idx].modeOfTraining;
            if (mode !== '2' && mode !== '4') updated[idx].endDate = value;
        }
        setSessions(updated);
    };

    const updateTrainerField = (idx: number, field: string, value: any) => {
        const updated = [...trainers];
        updated[idx] = { ...updated[idx], [field]: value };
        setTrainers(updated);
    };

    // ── Submit ───────────────────────────────────────────────────────────────
    const handleSubmit = async () => {
        const missing: string[] = [];
        if (!courseRunId.trim()) missing.push('Course Run ID');
        if (!courseReferenceNumber.trim()) missing.push('Course Reference Number (fetch data first)');
        if (!openingRegistrationDate) missing.push('Opening Registration Date');
        if (!closingRegistrationDate) missing.push('Closing Registration Date');
        if (!courseStartDate) missing.push('Course Start Date');
        if (!courseEndDate) missing.push('Course End Date');
        if (!floor.trim()) missing.push('Floor');
        if (!unit.trim()) missing.push('Unit');
        if (!postalCode.trim()) missing.push('Postal Code');
        if (!room.trim()) missing.push('Room');
        if (!modeOfTraining) missing.push('Mode of Training');
        if (!courseAdminEmail.trim()) missing.push('Course Admin Email');
        if (!courseVacancy) missing.push('Course Vacancy');

        if (showSessions && sessions.length === 0) missing.push('At least one Session');
        if (showTrainer && !trainers[0]?.trainerIdNumber?.trim()) missing.push('Trainer ID Number');

        if (missing.length > 0) {
            alert(`Please fill in the following required fields:\n\n${missing.map(f => `• ${f}`).join('\n')}`);
            return;
        }

        // Date validation
        if (new Date(closingRegistrationDate) < new Date(openingRegistrationDate)) {
            alert('Closing Registration Date cannot be earlier than Opening Registration Date');
            return;
        }
        if (new Date(courseEndDate) < new Date(courseStartDate)) {
            alert('Course End Date cannot be earlier than Course Start Date');
            return;
        }

        try {
            setIsSubmitting(true);

            const scheduleInfo = courseStartDate === courseEndDate
                ? courseStartDate
                : `${courseStartDate} - ${courseEndDate}`;

            const body: any = {
                courseReferenceNumber,
                sequenceNumber,
                openingRegistrationDate,
                closingRegistrationDate,
                courseStartDate,
                courseEndDate,
                scheduleInfoTypeCode: '01',
                scheduleInfoTypeDescription: 'Description',
                scheduleInfo,
                block,
                street,
                floor,
                unit,
                building,
                postalCode,
                room,
                wheelChairAccess: wheelchairAccess,
                modeOfTraining,
                courseAdminEmail,
                courseVacancy: {
                    code: courseVacancy,
                    description: courseVacancy === 'A' ? 'Available' : 'Full',
                },
                fileName: '',
                fileContent: '',
            };

            if (showSessions && sessions.length > 0) {
                body.sessions = sessions.map(s => ({
                    startDate: s.startDate.replace(/-/g, ''),
                    endDate: s.endDate.replace(/-/g, ''),
                    startTime: s.startTime + ':00',
                    endTime: s.endTime + ':00',
                    modeOfTraining: s.modeOfTraining,
                    venue: {
                        floor: s.useDefaultVenue ? floor : s.floor,
                        unit: s.useDefaultVenue ? unit : s.unit,
                        postalCode: s.useDefaultVenue ? postalCode : s.postalCode,
                        room: s.useDefaultVenue ? room : s.room,
                        wheelChairAccess: true,
                        ...(block && { block }),
                        ...(street && { street }),
                        ...(building && { building }),
                    },
                }));
            }

            if (showTrainer && trainers[0]?.trainerIdNumber?.trim()) {
                body.linkCourseRunTrainer = [{
                    trainerTypeCode: trainers[0].trainerType,
                    trainerTypeDescription: trainers[0].trainerType === '1' ? 'Existing' : 'New',
                    trainerIdNumber: trainers[0].trainerIdNumber,
                }];
            }

            const res = await fetch(
                `/api/ssg/courses/courseRuns/${encodeURIComponent(courseRunId.trim())}?action=edit`,
                { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }
            );

            const data = await res.json();

            if (!res.ok) {
                const msg = data?.details?.[0] || data?.message || data?.error?.message || `SSG error ${res.status}`;
                setSubmissionResult({ success: false, message: typeof msg === 'string' ? msg : JSON.stringify(msg), error: data });
            } else {
                setSubmissionResult({ success: true, message: 'Course run updated successfully in SSG.' });
                // Clear the context ID so navigating back doesn't re-trigger auto-fetch
                setSelectedCourseRunId(null);
            }
        } catch (err) {
            setSubmissionResult({
                success: false,
                message: err instanceof Error ? err.message : 'Unknown error occurred',
            });
        } finally {
            setIsSubmitting(false);
        }
    };

    // ── Result screen ────────────────────────────────────────────────────────
    if (submissionResult) {
        return (
            <div className="max-w-4xl mx-auto p-6">
                <Card className="p-6">
                    <div className="flex items-center gap-3 mb-6">
                        {submissionResult.success ? (
                            <div className="w-10 h-10 bg-green-100 dark:bg-green-900/30 rounded-full flex items-center justify-center">
                                <svg className="w-5 h-5 text-green-600 dark:text-green-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M5 13l4 4L19 7" />
                                </svg>
                            </div>
                        ) : (
                            <div className="w-10 h-10 bg-red-100 dark:bg-red-900/30 rounded-full flex items-center justify-center">
                                <svg className="w-5 h-5 text-red-600 dark:text-red-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M6 18L18 6M6 6l12 12" />
                                </svg>
                            </div>
                        )}
                        <div>
                            <h2 className="text-2xl font-bold text-gray-900 dark:text-white">Edit Course Run Result</h2>
                            <p className="text-sm text-gray-500 dark:text-gray-400">
                                {submissionResult.success ? 'Course run updated successfully' : 'Failed to update course run'}
                            </p>
                        </div>
                    </div>

                    <div className="bg-gray-50 dark:bg-gray-800 rounded-lg p-4 mb-6 space-y-2 text-sm">
                        <div><span className="font-medium text-gray-600 dark:text-gray-400">Course Run ID: </span><span className="font-mono text-gray-900 dark:text-white">{courseRunId}</span></div>
                        <div><span className="font-medium text-gray-600 dark:text-gray-400">Course Reference: </span><span className="text-gray-900 dark:text-white">{courseReferenceNumber}</span></div>
                        <div><span className="font-medium text-gray-600 dark:text-gray-400">Status: </span>
                            <span className={`inline-flex px-2 py-0.5 text-xs font-semibold rounded-full ${submissionResult.success ? 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300' : 'bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-300'}`}>
                                {submissionResult.success ? 'Success' : 'Error'}
                            </span>
                        </div>
                        {!submissionResult.success && submissionResult.message && (
                            <div className="mt-2 text-red-700 dark:text-red-400">{submissionResult.message}</div>
                        )}
                    </div>

                    <div className="flex gap-3">
                        <Button variant="outline" onClick={() => setSubmissionResult(null)} className="flex-1">
                            {submissionResult.success ? 'Edit Another' : 'Try Again'}
                        </Button>
                        <Button onClick={() => setAdminPage(AdminPage.ViewCourseRun)} className="flex-1">
                            View Course Run
                        </Button>
                        <Button variant="outline" onClick={() => setAdminPage(AdminPage.Dashboard)} className="flex-1">
                            Dashboard
                        </Button>
                    </div>
                </Card>
            </div>
        );
    }

    // ── Main form ────────────────────────────────────────────────────────────
    return (
        <div className="max-w-6xl mx-auto p-6">
            <div className="flex justify-between items-center mb-6">
                <h2 className="text-3xl font-bold dark:text-white">Edit Course Run</h2>
            </div>

            {/* Step 1 — Course Run ID Lookup */}
            <Card className="p-6 mb-6">
                <h3 className="text-lg font-bold text-gray-700 dark:text-gray-200 mb-4">Course Run Lookup</h3>
                <div className="flex gap-3 items-end">
                    <div className="flex-1">
                        <label className="block text-sm font-bold text-gray-700 dark:text-gray-300 mb-1">
                            * Course Run ID
                        </label>
                        <input
                            type="text"
                            value={courseRunId}
                            onChange={e => { setCourseRunId(e.target.value); setIsDataLoaded(false); }}
                            onKeyDown={e => e.key === 'Enter' && !isFetching && courseRunId.trim() && handleFetch()}
                            placeholder="e.g. 1234567"
                            className={inputClasses}
                            disabled={isFetching}
                        />
                    </div>
                    <Button onClick={() => handleFetch()} disabled={isFetching || !courseRunId.trim()} className="whitespace-nowrap">
                        {isFetching ? (
                            <div className="flex items-center">
                                <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white mr-2" />
                                Fetching...
                            </div>
                        ) : 'Fetch Data'}
                    </Button>
                </div>
                {fetchError && <p className="text-red-500 text-sm mt-3">{fetchError}</p>}
                {isDataLoaded && (
                    <div className="mt-3 p-3 bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-700 rounded-lg text-sm text-green-800 dark:text-green-300">
                        ✓ Data loaded for <strong>{courseTitle || courseReferenceNumber}</strong> — edit the fields below and click Save.
                    </div>
                )}
            </Card>

            {/* Step 2 — Editable form (only shown after fetch) */}
            {isDataLoaded && (
                <div className="space-y-6">

                    {/* Basic Information (read-only) */}
                    <FormSection title="Course Information">
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                            <div>
                                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Course Reference Number</label>
                                <input type="text" value={courseReferenceNumber} readOnly className={readonlyClasses} />
                            </div>
                            <div>
                                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Course Title</label>
                                <input type="text" value={courseTitle} readOnly className={readonlyClasses} />
                            </div>
                            <div>
                                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Sequence Number</label>
                                <input
                                    type="number" min="0"
                                    value={sequenceNumber}
                                    onChange={e => setSequenceNumber(parseInt(e.target.value) || 0)}
                                    className={inputClasses}
                                />
                            </div>
                        </div>
                    </FormSection>

                    {/* Registration Dates */}
                    <FormSection title="Registration Dates">
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                            <div>
                                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">* Opening Registration Date</label>
                                <input type="date" value={openingRegistrationDate} onChange={e => setOpeningRegistrationDate(e.target.value)} className={inputClasses} />
                            </div>
                            <div>
                                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">* Closing Registration Date</label>
                                <input type="date" value={closingRegistrationDate} onChange={e => setClosingRegistrationDate(e.target.value)} className={inputClasses} />
                            </div>
                        </div>
                    </FormSection>

                    {/* Course Dates */}
                    <FormSection title="Course Dates">
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                            <div>
                                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">* Course Start Date</label>
                                <input type="date" value={courseStartDate} onChange={e => setCourseStartDate(e.target.value)} className={inputClasses} />
                            </div>
                            <div>
                                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">* Course End Date</label>
                                <input type="date" value={courseEndDate} onChange={e => setCourseEndDate(e.target.value)} className={inputClasses} />
                            </div>
                        </div>
                    </FormSection>

                    {/* Venue */}
                    <FormSection title="Venue">
                        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                            <div>
                                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Block</label>
                                <input type="text" value={block} onChange={e => setBlock(e.target.value)} className={inputClasses} />
                            </div>
                            <div>
                                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Street</label>
                                <input type="text" value={street} onChange={e => setStreet(e.target.value)} className={inputClasses} />
                            </div>
                            <div>
                                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Building</label>
                                <input type="text" value={building} onChange={e => setBuilding(e.target.value)} className={inputClasses} />
                            </div>
                            <div>
                                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">* Floor</label>
                                <input type="text" value={floor} onChange={e => setFloor(e.target.value)} className={inputClasses} />
                            </div>
                            <div>
                                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">* Unit</label>
                                <input type="text" value={unit} onChange={e => setUnit(e.target.value)} className={inputClasses} />
                            </div>
                            <div>
                                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">* Postal Code</label>
                                <input type="text" value={postalCode} onChange={e => setPostalCode(e.target.value)} className={inputClasses} />
                            </div>
                            <div>
                                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">* Room</label>
                                <input type="text" value={room} onChange={e => setRoom(e.target.value)} className={inputClasses} />
                            </div>
                            <div>
                                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Wheelchair Access</label>
                                <select value={wheelchairAccess} onChange={e => setWheelchairAccess(e.target.value as OptionalSelector)} className={inputClasses}>
                                    <option value={OptionalSelector.YES}>Yes</option>
                                    <option value={OptionalSelector.NO}>No</option>
                                </select>
                            </div>
                        </div>
                    </FormSection>

                    {/* Course Admin */}
                    <FormSection title="Course Admin Details">
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                            <div>
                                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">* Mode of Training</label>
                                <select value={modeOfTraining} onChange={e => setModeOfTraining(e.target.value)} className={inputClasses}>
                                    {modeOfTrainingOptions.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                                </select>
                            </div>
                            <div>
                                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">* Course Admin Email</label>
                                <input type="email" value={courseAdminEmail} onChange={e => setCourseAdminEmail(e.target.value)} className={inputClasses} />
                            </div>
                            <div>
                                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">* Course Vacancy</label>
                                <select value={courseVacancy} onChange={e => setCourseVacancy(e.target.value)} className={inputClasses}>
                                    {vacancyOptions.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                                </select>
                            </div>
                        </div>
                    </FormSection>

                    {/* Optional: Sessions */}
                    <Card className="p-6">
                        <div className="flex items-center justify-between mb-4">
                            <h3 className="text-xl font-bold dark:text-white">Sessions (Optional)</h3>
                            <label className="flex items-center gap-2 cursor-pointer">
                                <input
                                    type="checkbox"
                                    checked={showSessions}
                                    onChange={e => { setShowSessions(e.target.checked); if (!e.target.checked) { setSessions([]); setSessionCount(0); } }}
                                    className="w-4 h-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                                />
                                <span className="text-sm font-medium text-gray-700 dark:text-gray-300">Update Sessions</span>
                            </label>
                        </div>
                        {showSessions && (
                            <div className="space-y-4">
                                <div className="flex items-center gap-3">
                                    <label className="text-sm font-medium text-gray-700 dark:text-gray-300">Session Count:</label>
                                    <div className="flex items-center gap-2">
                                        <button onClick={() => updateSessionCount(Math.max(0, sessionCount - 1))} className="w-8 h-8 flex items-center justify-center bg-gray-200 dark:bg-gray-700 rounded-full text-gray-700 dark:text-gray-300 hover:bg-gray-300 dark:hover:bg-gray-600">-</button>
                                        <span className="w-8 text-center font-medium dark:text-white">{sessionCount}</span>
                                        <button onClick={() => updateSessionCount(sessionCount + 1)} className="w-8 h-8 flex items-center justify-center bg-gray-200 dark:bg-gray-700 rounded-full text-gray-700 dark:text-gray-300 hover:bg-gray-300 dark:hover:bg-gray-600">+</button>
                                    </div>
                                </div>
                                {sessions.map((session, idx) => (
                                    <Card key={idx} className="p-4 border dark:border-gray-700">
                                        <h4 className="font-semibold mb-3 dark:text-white">Session {idx + 1}</h4>
                                        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                                            <div>
                                                <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">Mode of Training</label>
                                                <select value={session.modeOfTraining} onChange={e => updateSessionField(idx, 'modeOfTraining', e.target.value)} className={inputClasses}>
                                                    {modeOfTrainingOptions.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                                                </select>
                                            </div>
                                            <div>
                                                <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">Start Date</label>
                                                <input type="date" value={session.startDate} onChange={e => updateSessionField(idx, 'startDate', e.target.value)} className={inputClasses} />
                                            </div>
                                            <div>
                                                <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">End Date</label>
                                                <input type="date" value={session.endDate} onChange={e => updateSessionField(idx, 'endDate', e.target.value)} className={inputClasses} />
                                            </div>
                                            <div>
                                                <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">Start Time</label>
                                                <input type="time" value={session.startTime} onChange={e => updateSessionField(idx, 'startTime', e.target.value)} className={inputClasses} />
                                            </div>
                                            <div>
                                                <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">End Time</label>
                                                <input type="time" value={session.endTime} onChange={e => updateSessionField(idx, 'endTime', e.target.value)} className={inputClasses} />
                                            </div>
                                            <div className="flex items-center gap-2 pt-5">
                                                <input type="checkbox" id={`default-venue-${idx}`} checked={session.useDefaultVenue} onChange={e => updateSessionField(idx, 'useDefaultVenue', e.target.checked)} className="w-4 h-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500" />
                                                <label htmlFor={`default-venue-${idx}`} className="text-sm text-gray-700 dark:text-gray-300">Use primary venue</label>
                                            </div>
                                        </div>
                                        {!session.useDefaultVenue && (
                                            <div className="grid grid-cols-1 md:grid-cols-3 gap-3 mt-3">
                                                {(['floor', 'unit', 'postalCode', 'room'] as const).map(f => (
                                                    <div key={f}>
                                                        <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1 capitalize">{f}</label>
                                                        <input type="text" value={session[f]} onChange={e => updateSessionField(idx, f, e.target.value)} className={inputClasses} />
                                                    </div>
                                                ))}
                                            </div>
                                        )}
                                    </Card>
                                ))}
                            </div>
                        )}
                    </Card>

                    {/* Optional: Trainer */}
                    <Card className="p-6">
                        <div className="flex items-center justify-between mb-4">
                            <h3 className="text-xl font-bold dark:text-white">Trainer Assignment (Optional)</h3>
                            <label className="flex items-center gap-2 cursor-pointer">
                                <input
                                    type="checkbox"
                                    checked={showTrainer}
                                    onChange={e => setShowTrainer(e.target.checked)}
                                    className="w-4 h-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                                />
                                <span className="text-sm font-medium text-gray-700 dark:text-gray-300">Assign Trainer</span>
                            </label>
                        </div>
                        {showTrainer && (
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                <div>
                                    <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Trainer Type</label>
                                    <select value={trainers[0].trainerType} onChange={e => updateTrainerField(0, 'trainerType', e.target.value)} className={inputClasses}>
                                        <option value="1">1 - Existing</option>
                                    </select>
                                </div>
                                <div>
                                    <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">* Trainer ID Number</label>
                                    <input type="text" value={trainers[0].trainerIdNumber} onChange={e => updateTrainerField(0, 'trainerIdNumber', e.target.value)} className={inputClasses} placeholder="Enter trainer NRIC / FIN" />
                                </div>
                            </div>
                        )}
                    </Card>

                    {/* Action buttons */}
                    <div className="flex gap-3 pb-6">
                        <Button variant="outline" onClick={() => setAdminPage(AdminPage.ViewCourseRun)} className="flex-1">
                            Cancel
                        </Button>
                        <Button onClick={handleSubmit} disabled={isSubmitting} className="flex-1">
                            {isSubmitting ? (
                                <div className="flex items-center justify-center">
                                    <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white mr-2" />
                                    Saving...
                                </div>
                            ) : 'Save Changes'}
                        </Button>
                    </div>
                </div>
            )}
        </div>
    );
};

export default EditCourseRunView;
