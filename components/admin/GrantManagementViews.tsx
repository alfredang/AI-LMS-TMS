import React, { useState, useMemo, useEffect } from 'react';
import { Card } from '../ui/Card';
import { Button } from '../ui/Button';
import { Icon, IconName } from '../ui/Icon';
import { getApiUrl } from '@/lib/urlHelpers';
import { useLms } from '@contexts/LmsContext';
import { AdminPage } from '@app-types';

// Helper functions for consistent styling
const getStatusColor = (status: string) => {
    switch (status) {
        case 'Paid':
        case 'Claimed':
        case 'Approved':
        case 'C':
        case 'Competent':
        case 'Pass':
        case 'Success':
        case 'Successful':
        case 'Full Payment':
            return 'bg-green-100 text-green-800 border-green-200';
        case 'Processing':
            return 'bg-blue-100 text-blue-800 border-blue-200';
        case 'Pending':
        case 'In Progress':
        case 'Pending Assessment':
            return 'bg-yellow-100 text-yellow-800 border-yellow-200';
        case 'Overdue':
        case 'Rejected':
        case 'Unpaid':
        case 'NYC':
        case 'Not Yet Competent':
        case 'Fail':
        case 'Failed':
            return 'bg-red-100 text-red-800 border-red-200';
        default:
            return 'bg-gray-100 text-gray-800 border-gray-200';
    }
};

const inputClasses = "block w-full px-3 py-2 text-on-surface bg-white border border-gray-300 rounded-md shadow-sm placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent dark:bg-gray-700 dark:border-gray-600 dark:text-white dark:placeholder-gray-500";

// Map common SSG/HTTP error messages to user-friendly text
const friendlyErrorMessages: Record<string, string> = {
    'Not Found': 'No results found for the given input. Please check your course reference number and try again.',
    'Bad Request': 'The request was invalid. Please check your input and try again.',
    'Unauthorized': 'Authentication failed. Please contact your administrator.',
    'Forbidden': 'You do not have permission to access this resource.',
    'Internal Server Error': 'The service is temporarily unavailable. Please try again later.',
    'Service Unavailable': 'The service is temporarily unavailable. Please try again later.',
};

// Extract a human-readable error message from any n8n/SSG error shape
const extractErrorMessage = (err: any): string => {
    if (!err) return 'Something went wrong. Please try again later.';

    // Try to parse nested JSON from n8n AxiosError message (format: "STATUS - \"{ JSON }\"")
    const msg = err.message || '';
    const jsonMatch = msg.match(/^\d+\s*-\s*"([\s\S]*)"$/);
    if (jsonMatch) {
        try {
            const inner = JSON.parse(jsonMatch[1]);
            const details = inner.error?.details;
            if (details && Array.isArray(details) && details.length > 0) {
                const msgs = details.map((d: any) => d.message).filter(Boolean);
                if (msgs.length > 0) return msgs.join('. ');
            }
            const innerMsg = inner.error?.message || inner.message;
            if (innerMsg) return friendlyErrorMessages[innerMsg] || innerMsg;
        } catch { /* fall through */ }
    }

    // Direct error object with nested error property
    if (err.error) {
        const nested = err.error;
        if (nested.details && Array.isArray(nested.details) && nested.details.length > 0) {
            const msgs = nested.details.map((d: any) => d.message).filter(Boolean);
            if (msgs.length > 0) return msgs.join('. ');
        }
        if (nested.message) return friendlyErrorMessages[nested.message] || nested.message;
    }

    // Simple message string (skip raw AxiosError stack traces)
    if (msg && !msg.includes('AxiosError') && !msg.includes('node_modules')) {
        return friendlyErrorMessages[msg] || msg;
    }

    // Friendly fallback
    return 'Unable to retrieve data from SSG. Please try again later.';
};

const PlaceholderView: React.FC<{ title: string }> = ({ title }) => (
    <div>
        <h2 className="text-3xl font-bold mb-6 dark:text-white">{title}</h2>
        <Card className="p-6 dark:bg-gray-800 dark:border-gray-700">
            <p className="text-gray-500 text-center py-12 dark:text-gray-400">
                Functionality for '{title}' will be available here.
            </p>
        </Card>
    </div>
);

export const ApplyNewGrantView: React.FC = () => {
    // No mock data - empty arrays for now
    const courses: any[] = [];

    const [selectedCourseId, setSelectedCourseId] = useState<string>('');
    const [selectedLearners, setSelectedLearners] = useState<Set<string>>(new Set());
    const [isSubmitting, setIsSubmitting] = useState(false);
    const [submissionStatus, setSubmissionStatus] = useState<string | null>(null);

    const upcomingClasses = useMemo(() => {
        const now = new Date();
        now.setHours(0, 0, 0, 0);
        return courses.filter(c => new Date(c.startDate) >= now);
    }, [courses]);

    const selectedCourse = useMemo(() => {
        return courses.find(c => c.id === selectedCourseId);
    }, [courses, selectedCourseId]);

    const handleSelectAll = (e: React.ChangeEvent<HTMLInputElement>) => {
        if (e.target.checked && selectedCourse?.learners) {
            const allLearnerEmails = new Set<string>(selectedCourse.learners.map((l: any) => l.email as string));
            setSelectedLearners(allLearnerEmails);
        } else {
            setSelectedLearners(new Set<string>());
        }
    };

    const handleSelectLearner = (email: string) => {
        const newSelection = new Set<string>(selectedLearners);
        if (newSelection.has(email)) {
            newSelection.delete(email);
        } else {
            newSelection.add(email);
        }
        setSelectedLearners(newSelection);
    };

    const handleSubmit = () => {
        if (selectedLearners.size === 0) {
            alert('Please select at least one learner to submit.');
            return;
        }
        setIsSubmitting(true);
        setSubmissionStatus(null);

        // Simulate API call to SSG
        setTimeout(() => {
            setIsSubmitting(false);
            setSubmissionStatus(`Successfully submitted grant application for ${selectedLearners.size} learner(s).`);
            setSelectedLearners(new Set<string>());
        }, 2000);
    };

    return (
        <div>
            <h2 className="text-3xl font-bold mb-6 dark:text-white">Apply New Grant</h2>
            <Card className="p-6 mb-6 dark:bg-gray-800 dark:border-gray-700">
                <div className="space-y-4">
                    <div>
                        <label htmlFor="class-select-grant" className="block text-sm font-bold text-gray-700 dark:text-gray-300 mb-1 dark:text-gray-300">
                            1. Select an Upcoming Class
                        </label>
                        <select
                            id="class-select-grant"
                            value={selectedCourseId}
                            onChange={e => {
                                setSelectedCourseId(e.target.value);
                                setSelectedLearners(new Set<string>());
                                setSubmissionStatus(null);
                            }}
                            className={inputClasses}
                        >
                            <option value="" disabled>-- Choose a class --</option>
                            {upcomingClasses.length === 0 ? (
                                <option value="" disabled>No upcoming classes available</option>
                            ) : (
                                upcomingClasses.map(c => (
                                    <option key={c.id} value={c.id}>
                                        {c.title} ({c.courseRunId}) - {new Date(c.startDate).toLocaleDateString()}
                                    </option>
                                ))
                            )}
                        </select>
                        {courses.length === 0 && (
                            <p className="text-sm text-gray-500 dark:text-gray-400 mt-2">No classes found. Please create classes first.</p>
                        )}
                        {courses.length > 0 && upcomingClasses.length === 0 && (
                            <p className="text-sm text-gray-500 dark:text-gray-400 mt-2">No upcoming classes found.</p>
                        )}
                    </div>

                    {selectedCourse && (
                        <div>
                            <h3 className="text-lg font-bold text-gray-800 mb-2 dark:text-white">2. Select Learners for Submission</h3>
                            <p className="text-sm text-gray-500 mb-4 dark:text-gray-400">
                                Select one or more learners from the list below to include in the grant application to SSG.
                            </p>
                        </div>
                    )}
                </div>
            </Card>

            {selectedCourse && (
                <Card className="p-0 dark:bg-gray-800 dark:border-gray-700">
                    <div className="overflow-x-auto">
                        <table className="min-w-full divide-y divide-gray-200 dark:divide-gray-700">
                            <thead className="bg-gray-50 dark:bg-gray-700/50">
                                <tr>
                                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                                        <input
                                            type="checkbox"
                                            onChange={handleSelectAll}
                                            checked={selectedCourse?.learners?.length > 0 && selectedLearners.size === selectedCourse.learners.length}
                                        />
                                    </th>
                                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider dark:text-gray-400">Learner</th>
                                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider dark:text-gray-400">Email</th>
                                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider dark:text-gray-400">Grant Status</th>
                                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider dark:text-gray-400">Sponsorship</th>
                                </tr>
                            </thead>
                            <tbody className="bg-white divide-y divide-gray-200 dark:bg-gray-800 dark:divide-gray-700">
                                {selectedCourse.learners && selectedCourse.learners.length > 0 ? (
                                    selectedCourse.learners.map((learner: any) => (
                                        <tr key={learner.email} className="hover:bg-gray-50 dark:hover:bg-gray-700/50">
                                            <td className="px-6 py-4 whitespace-nowrap">
                                                <input
                                                    type="checkbox"
                                                    checked={selectedLearners.has(learner.email)}
                                                    onChange={() => handleSelectLearner(learner.email)}
                                                />
                                            </td>
                                            <td className="px-6 py-4 whitespace-nowrap">
                                                <div className="font-medium text-gray-900 dark:text-white">{learner.name || 'N/A'}</div>
                                            </td>
                                            <td className="px-6 py-4 whitespace-nowrap">
                                                <div className="text-sm text-gray-900 dark:text-white">{learner.email || 'N/A'}</div>
                                            </td>
                                            <td className="px-6 py-4 whitespace-nowrap">
                                                <span className={`inline-flex px-2 py-1 text-xs font-semibold rounded-full border ${getStatusColor(learner.grantStatus || 'Pending')}`}>
                                                    {learner.grantStatus || 'Pending'}
                                                </span>
                                            </td>
                                            <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900 dark:text-white">
                                                {learner.courseSponsorship || 'N/A'}
                                            </td>
                                        </tr>
                                    ))
                                ) : (
                                    <tr>
                                        <td colSpan={5} className="px-6 py-12 text-center text-gray-500 dark:text-gray-400">
                                            No learners enrolled in this class yet.
                                        </td>
                                    </tr>
                                )}
                            </tbody>
                        </table>
                    </div>
                </Card>
            )}

            {selectedCourse && (
                <div className="mt-6 flex justify-end items-center gap-4">
                    {submissionStatus && <p className="text-green-600 font-semibold">{submissionStatus}</p>}
                    <Button onClick={handleSubmit} disabled={isSubmitting || selectedLearners.size === 0}>
                        {isSubmitting ? (
                            <div className="flex items-center">
                                <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white mr-2"></div>
                                Submitting...
                            </div>
                        ) : `Submit to SSG (${selectedLearners.size} selected)`}
                    </Button>
                </div>
            )}
        </div>
    );
};

export const ViewGrantStatusView: React.FC = () => {
    // Search functionality state
    const [searchInput, setSearchInput] = useState<string>('');
    const [isSearching, setIsSearching] = useState(false);
    const [grantData, setGrantData] = useState<any>(null);
    const [searchError, setSearchError] = useState<string | null>(null);

    const handleSearch = async () => {
        if (!searchInput.trim()) {
            setSearchError('Please enter a Grant ID');
            return;
        }

        if (!/^GRN-\d/i.test(searchInput.trim())) {
            setSearchError('Invalid Grant ID. Format should be GRN-NNNN-NNNNNN (e.g. GRN-2512-016146)');
            return;
        }

        setIsSearching(true);
        setSearchError(null);
        setGrantData(null);

        try {
            console.log('🔍 Fetching grant from SSG:', searchInput.trim());

            const response = await fetch(getApiUrl(`/api/grants/view?grantId=${encodeURIComponent(searchInput.trim())}`));
            const json = await response.json();

            if (!json.success) {
                const errMsg = typeof json.error === 'string'
                    ? json.error
                    : (json.error?.message || `SSG error ${response.status}`);
                setSearchError(errMsg);
                return;
            }

            console.log('✅ Grant data:', json.data);
            setGrantData(json.data);
        } catch (error) {
            console.error('❌ Error fetching grant:', error);
            setSearchError('Failed to connect to SSG. Please check your connection and try again.');
        } finally {
            setIsSearching(false);
        }
    };

    const handleKeyPress = (e: React.KeyboardEvent<HTMLInputElement>) => {
        if (e.key === 'Enter') {
            handleSearch();
        }
    };

    return (
        <div>
            <h2 className="text-3xl font-bold mb-6 dark:text-white">View Grant Status</h2>

            {/* Search Bar Card */}
            <Card className="p-6 mb-6 dark:bg-gray-800 dark:border-gray-700">
                <div>
                    <label htmlFor="grant-search" className="block text-sm font-bold text-gray-700 dark:text-gray-300 mb-1 dark:text-gray-300">
                        Search Grant Status
                    </label>
                    <p className="text-sm text-gray-500 mb-3 dark:text-gray-400">
                        Enter Grant ID - e.g. GRN-2512-016146
                    </p>
                    <div className="flex gap-3">
                        <input
                            id="grant-search"
                            type="text"
                            value={searchInput}
                            onChange={(e) => setSearchInput(e.target.value)}
                            onKeyPress={handleKeyPress}
                            placeholder="Enter search query..."
                            className={inputClasses}
                            disabled={isSearching}
                        />
                        <Button
                            onClick={handleSearch}
                            disabled={isSearching || !searchInput.trim()}
                            className="whitespace-nowrap"
                        >
                            {isSearching ? (
                                <div className="flex items-center">
                                    <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white mr-2"></div>
                                    Searching...
                                </div>
                            ) : (
                                <>
                                    <Icon name={IconName.Search} className="w-4 h-4 mr-2" />
                                    Search
                                </>
                            )}
                        </Button>
                    </div>
                    {searchError && (
                        <p className="text-red-500 text-sm mt-2">{searchError}</p>
                    )}
                </div>
            </Card>

            {/* Loading State */}
            {isSearching && (
                <div className="flex justify-center py-10">
                    <div className="text-center">
                        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-500 mx-auto"></div>
                        <p className="mt-4 text-gray-600 dark:text-gray-300">Fetching grant status from SSG...</p>
                    </div>
                </div>
            )}

            {/* Grant Data Display */}
            {grantData && !isSearching && (
                <Card className="p-0 dark:bg-gray-800 dark:border-gray-700">
                    <div className="p-6 border-b dark:border-gray-700">
                        <h3 className="text-xl font-bold dark:text-white">Grant Status Results</h3>
                        <p className="text-gray-500 dark:text-gray-400 mt-1">Grant ID: "{searchInput}"</p>
                    </div>
                    <div className="p-6">
                        <div className="space-y-6">
                            {/* Grant Summary */}
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                <div className="bg-white border border-gray-200 rounded-lg p-4 dark:bg-gray-700 dark:border-gray-600">
                                    <h4 className="text-sm font-medium text-gray-500 mb-2 dark:text-gray-300">Grant Reference Number</h4>
                                    <p className="text-lg font-semibold text-gray-900 dark:text-white">
                                        {grantData.referenceNumber || 'N/A'}
                                    </p>
                                </div>
                                <div className="bg-white border border-gray-200 rounded-lg p-4 dark:bg-gray-700 dark:border-gray-600">
                                    <h4 className="text-sm font-medium text-gray-500 mb-2 dark:text-gray-300">Status</h4>
                                    <span className={`inline-flex px-3 py-1 text-sm font-semibold rounded-full border ${getStatusColor(grantData.status || 'Pending')}`}>
                                        {grantData.status || 'Pending'}
                                    </span>
                                </div>
                            </div>

                            {/* Funding Information */}
                            {grantData.fundingScheme && (
                                <div className="bg-blue-50 border border-blue-200 rounded-lg p-4 dark:bg-blue-900/20 dark:border-blue-800">
                                    <h4 className="font-semibold text-blue-900 mb-3 dark:text-blue-300">Funding Information</h4>
                                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                        <div>
                                            <p className="text-sm text-blue-700 font-medium dark:text-blue-400">Funding Scheme</p>
                                            <p className="text-blue-900 dark:text-blue-200">
                                                {grantData.fundingScheme.code} - {grantData.fundingScheme.description}
                                            </p>
                                        </div>
                                        {grantData.fundingComponent && (
                                            <div>
                                                <p className="text-sm text-blue-700 font-medium dark:text-blue-400">Funding Component</p>
                                                <p className="text-blue-900 dark:text-blue-200">
                                                    {grantData.fundingComponent.code} - {grantData.fundingComponent.description}
                                                </p>
                                            </div>
                                        )}
                                    </div>
                                </div>
                            )}

                            {/* Grant Amount Details */}
                            {grantData.grantAmount && (
                                <div className="bg-green-50 border border-green-200 rounded-lg p-4 dark:bg-green-900/20 dark:border-green-800">
                                    <h4 className="font-semibold text-green-900 mb-3 dark:text-green-300">Grant Amount</h4>
                                    <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                                        <div>
                                            <p className="text-sm text-green-700 font-medium dark:text-green-400">Estimated</p>
                                            <p className="text-xl font-bold text-green-900 dark:text-green-200">
                                                ${grantData.grantAmount.estimated?.toFixed(2) || '0.00'}
                                            </p>
                                        </div>
                                        <div>
                                            <p className="text-sm text-green-700 font-medium dark:text-green-400">Paid</p>
                                            <p className="text-xl font-bold text-green-900 dark:text-green-200">
                                                ${grantData.grantAmount.paid?.toFixed(2) || '0.00'}
                                            </p>
                                        </div>
                                        <div>
                                            <p className="text-sm text-green-700 font-medium dark:text-green-400">Recovery</p>
                                            <p className="text-xl font-bold text-green-900 dark:text-green-200">
                                                ${grantData.grantAmount.recovery?.toFixed(2) || '0.00'}
                                            </p>
                                        </div>
                                    </div>
                                </div>
                            )}

                            {/* Enrolment Information */}
                            {grantData.enrolment && (
                                <div className="bg-gray-50 border border-gray-200 rounded-lg p-4 dark:bg-gray-700/30 dark:border-gray-600">
                                    <h4 className="font-semibold text-gray-900 mb-2 dark:text-white">Enrolment Reference</h4>
                                    <p className="text-gray-700 dark:text-gray-300">
                                        {grantData.enrolment.referenceNumber || 'N/A'}
                                    </p>
                                </div>
                            )}

                            {/* Raw JSON Response (Collapsible) */}
                            <details className="bg-gray-50 border border-gray-200 rounded-lg p-4 dark:bg-gray-700/30 dark:border-gray-600">
                                <summary className="font-semibold text-gray-800 cursor-pointer hover:text-gray-600 dark:text-white dark:hover:text-gray-300">
                                    View Raw JSON Response
                                </summary>
                                <pre className="mt-3 text-sm text-gray-700 whitespace-pre-wrap overflow-x-auto max-h-96 bg-white p-3 rounded border dark:bg-gray-900 dark:text-gray-300 dark:border-gray-700">
                                    {JSON.stringify(grantData, null, 2)}
                                </pre>
                            </details>
                        </div>

                        <div className="mt-6 flex justify-end">
                            <Button
                                variant="outline"
                                onClick={() => {
                                    setGrantData(null);
                                    setSearchInput('');
                                }}
                            >
                                Clear Results
                            </Button>
                        </div>
                    </div>
                </Card>
            )}

            {/* Empty State */}
            {!grantData && !isSearching && (
                <Card className="p-12">
                    <div className="text-center text-gray-500 dark:text-gray-400">
                        <Icon name={IconName.Search} className="w-16 h-16 mx-auto mb-4 text-gray-400" />
                        <p className="text-lg font-medium">No search results yet</p>
                        <p className="text-sm mt-2">Enter a search query above to fetch grant status information</p>
                    </div>
                </Card>
            )}
        </div>
    );
};

export const SubmitAssessmentView: React.FC = () => {
    const { trainingProviderProfile } = useLms();
    const [courseRunId, setCourseRunId] = useState<string>('');
    const [courseReferenceNumber, setCourseReferenceNumber] = useState<string>('');
    const [assessmentResult, setAssessmentResult] = useState<string>('Pass');
    const [traineeId, setTraineeId] = useState<string>('');
    const [traineeFullName, setTraineeFullName] = useState<string>('');
    const [skillCode, setSkillCode] = useState<string>('');
    const [assessmentDate, setAssessmentDate] = useState<string>('');
    const [trainingPartnerUen, setTrainingPartnerUen] = useState<string>(trainingProviderProfile?.uen || '');
    const [trainingPartnerCode, setTrainingPartnerCode] = useState<string>(trainingProviderProfile?.uen ? `${trainingProviderProfile.uen}-01` : '');
    const [enrolmentNumber, setEnrolmentNumber] = useState<string>('');
    const [isSubmitting, setIsSubmitting] = useState(false);
    const [result, setResult] = useState<any>(null);
    const [error, setError] = useState<string | null>(null);

    const inputClasses = "block w-full px-3 py-2 text-on-surface bg-white border border-gray-300 rounded-md shadow-sm placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent dark:bg-gray-700 dark:border-gray-600 dark:text-white dark:placeholder-gray-500";

    // Auto-determine idType based on first letter of trainee ID
    const getIdType = (id: string): string => {
        const firstLetter = id.charAt(0).toUpperCase();
        if (firstLetter === 'S' || firstLetter === 'T') {
            return 'NRIC';
        } else if (firstLetter === 'F' || firstLetter === 'G' || firstLetter === 'M') {
            return 'FIN';
        } else {
            return 'OTHERS';
        }
    };

    const handleSubmit = async () => {
        if (!courseRunId.trim()) { setError('Course Run ID is required'); return; }
        if (!courseReferenceNumber.trim()) { setError('Course Reference Number is required'); return; }
        if (!traineeId.trim()) { setError('Trainee ID is required'); return; }
        if (!traineeFullName.trim()) { setError('Trainee Full Name is required'); return; }
        if (!assessmentDate.trim()) { setError('Assessment Date is required'); return; }
        if (!skillCode.trim()) { setError('Skill Code is required'); return; }
        if (!trainingPartnerUen.trim()) { setError('Training Partner UEN is required'); return; }
        if (!trainingPartnerCode.trim()) { setError('Training Partner Code is required'); return; }

        setIsSubmitting(true);
        setError(null);
        setResult(null);

        try {
            const response = await fetch('/api/assessments/ssg-create', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    courseRunId: courseRunId.trim(),
                    courseReferenceNumber: courseReferenceNumber.trim(),
                    result: assessmentResult,
                    traineeId: traineeId.trim(),
                    traineeIdType: getIdType(traineeId),
                    traineeFullName: traineeFullName.trim(),
                    skillCode: skillCode.trim(),
                    assessmentDate: assessmentDate.trim(),
                    trainingPartnerUen: trainingPartnerUen.trim(),
                    trainingPartnerCode: trainingPartnerCode.trim(),
                    enrolmentReferenceNumber: enrolmentNumber.trim() || undefined,
                })
            });

            const data = await response.json();

            if (!data.success) {
                setError(data.details?.[0]?.message || data.error || 'Failed to submit assessment');
                setResult(data);
                return;
            }

            setResult(data.data);
        } catch (err) {
            console.error('❌ Error submitting assessment:', err);
            setError(err instanceof Error ? err.message : 'Failed to submit assessment');
        } finally {
            setIsSubmitting(false);
        }
    };

    const handleClear = () => {
        setCourseRunId('');
        setCourseReferenceNumber('');
        setAssessmentResult('Pass');
        setTraineeId('');
        setTraineeFullName('');
        setSkillCode('');
        setAssessmentDate('');
        setTrainingPartnerUen(trainingProviderProfile?.uen || '');
        setTrainingPartnerCode(trainingProviderProfile?.uen ? `${trainingProviderProfile.uen}-01` : '');
        setEnrolmentNumber('');
        setResult(null);
        setError(null);
    };

    const isFormValid = courseRunId.trim() && courseReferenceNumber.trim() &&
        traineeId.trim() && traineeFullName.trim() &&
        assessmentDate.trim() && skillCode.trim() &&
        trainingPartnerUen.trim() && trainingPartnerCode.trim();

    return (
        <div>
            <h2 className="text-3xl font-bold mb-6 dark:text-white">Submit Assessment</h2>

            {/* Input Form Card */}
            <Card className="p-6 mb-6">
                <h3 className="text-lg font-bold text-gray-700 dark:text-gray-200 mb-4">Assessment Details</h3>
                <p className="text-sm text-gray-600 dark:text-gray-400 mb-4">
                    All fields marked with * are required.
                </p>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
                    <div>
                        <label htmlFor="submit-course-run-id" className="block text-sm font-bold text-gray-700 dark:text-gray-300 mb-1">
                            Course Run ID <span className="text-red-500">*</span>
                        </label>
                        <input
                            id="submit-course-run-id"
                            type="text"
                            value={courseRunId}
                            onChange={(e) => setCourseRunId(e.target.value)}
                            placeholder="e.g. 1234567"
                            className={inputClasses}
                            disabled={isSubmitting}
                        />
                    </div>
                    <div>
                        <label htmlFor="submit-course-ref" className="block text-sm font-bold text-gray-700 dark:text-gray-300 mb-1">
                            Course Reference Number <span className="text-red-500">*</span>
                        </label>
                        <input
                            id="submit-course-ref"
                            type="text"
                            value={courseReferenceNumber}
                            onChange={(e) => setCourseReferenceNumber(e.target.value)}
                            placeholder="e.g. TGS-2024052076"
                            className={inputClasses}
                            disabled={isSubmitting}
                        />
                    </div>
                    <div>
                        <label htmlFor="submit-trainee-id" className="block text-sm font-bold text-gray-700 dark:text-gray-300 mb-1">
                            Trainee ID <span className="text-red-500">*</span>
                        </label>
                        <input
                            id="submit-trainee-id"
                            type="text"
                            value={traineeId}
                            onChange={(e) => setTraineeId(e.target.value)}
                            placeholder="e.g. S1234567A"
                            className={inputClasses}
                            disabled={isSubmitting}
                        />
                        {traineeId && (
                            <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
                                ID Type: {getIdType(traineeId)}
                            </p>
                        )}
                    </div>
                    <div>
                        <label htmlFor="submit-trainee-name" className="block text-sm font-bold text-gray-700 dark:text-gray-300 mb-1">
                            Trainee Full Name <span className="text-red-500">*</span>
                        </label>
                        <input
                            id="submit-trainee-name"
                            type="text"
                            value={traineeFullName}
                            onChange={(e) => setTraineeFullName(e.target.value)}
                            placeholder="e.g. John Doe"
                            className={inputClasses}
                            disabled={isSubmitting}
                        />
                    </div>
                    <div>
                        <label htmlFor="submit-assessment-date" className="block text-sm font-bold text-gray-700 dark:text-gray-300 mb-1">
                            Assessment Date <span className="text-red-500">*</span>
                        </label>
                        <input
                            id="submit-assessment-date"
                            type="date"
                            value={assessmentDate}
                            onChange={(e) => setAssessmentDate(e.target.value)}
                            placeholder="$$YYYY-MM-DD"
                            className={inputClasses}
                            disabled={isSubmitting}
                        />
                    </div>
                    <div>
                        <label htmlFor="submit-assessment-result" className="block text-sm font-bold text-gray-700 dark:text-gray-300 mb-1">
                            Assessment Result <span className="text-red-500">*</span>
                        </label>
                        <select
                            id="submit-assessment-result"
                            value={assessmentResult}
                            onChange={(e) => setAssessmentResult(e.target.value)}
                            className={inputClasses}
                            disabled={isSubmitting}
                        >
                            <option value="Pass">Pass</option>
                            <option value="Fail">Fail</option>
                            <option value="Exempt">Exempt</option>
                        </select>
                    </div>
                    <div>
                        <label htmlFor="submit-tp-uen" className="block text-sm font-bold text-gray-700 dark:text-gray-300 mb-1">
                            Training Partner UEN <span className="text-red-500">*</span>
                        </label>
                        <input
                            id="submit-tp-uen"
                            type="text"
                            value={trainingPartnerUen}
                            onChange={(e) => setTrainingPartnerUen(e.target.value)}
                            placeholder="e.g. 201200696W"
                            className={inputClasses}
                            disabled={isSubmitting}
                        />
                    </div>
                    <div>
                        <label htmlFor="submit-tp-code" className="block text-sm font-bold text-gray-700 dark:text-gray-300 mb-1">
                            Training Partner Code <span className="text-red-500">*</span>
                        </label>
                        <input
                            id="submit-tp-code"
                            type="text"
                            value={trainingPartnerCode}
                            onChange={(e) => setTrainingPartnerCode(e.target.value)}
                            placeholder="e.g. 201200696W-01"
                            className={inputClasses}
                            disabled={isSubmitting}
                        />
                    </div>
                    <div>
                        <label htmlFor="submit-skill-code" className="block text-sm font-bold text-gray-700 dark:text-gray-300 mb-1">
                            Skill Code <span className="text-red-500">*</span>
                        </label>
                        <input
                            id="submit-skill-code"
                            type="text"
                            value={skillCode}
                            onChange={(e) => setSkillCode(e.target.value)}
                            placeholder="e.g. ABC-123"
                            className={inputClasses}
                            disabled={isSubmitting}
                        />
                    </div>
                </div>

                <div className="flex gap-3">
                    <Button
                        onClick={handleSubmit}
                        disabled={isSubmitting || !isFormValid}
                    >
                        {isSubmitting ? (
                            <div className="flex items-center">
                                <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white mr-2"></div>
                                Submitting...
                            </div>
                        ) : (
                            <>
                                <Icon name={IconName.CheckCircle} className="w-4 h-4 mr-2" />
                                Submit Assessment
                            </>
                        )}
                    </Button>
                    <Button variant="outline" onClick={handleClear} disabled={isSubmitting}>
                        Clear
                    </Button>
                </div>

                {error && !result && (
                    <p className="text-red-500 text-sm mt-3">{error}</p>
                )}
            </Card>

            {/* Loading State */}
            {isSubmitting && (
                <div className="flex justify-center py-10">
                    <div className="text-center">
                        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-500 mx-auto"></div>
                        <p className="mt-4 text-gray-600 dark:text-gray-400">Submitting assessment...</p>
                    </div>
                </div>
            )}

            {/* Result Display */}
            {!isSubmitting && result && (
                <Card className="p-6">
                    {error ? (
                        <div className="bg-red-50 dark:bg-red-900/20 border-l-4 border-red-500 dark:border-red-600 rounded-r-lg p-4">
                            <div className="flex items-center gap-2 mb-2">
                                <Icon name={IconName.X} className="w-5 h-5 text-red-600 dark:text-red-400" />
                                <h4 className="font-semibold text-red-900 dark:text-red-200">Submission Creation Failed</h4>
                            </div>
                            <p className="text-sm text-red-800 dark:text-red-300 pl-7">{error}</p>
                        </div>
                    ) : (
                        <div className="bg-green-50 dark:bg-green-900/20 border-l-4 border-green-500 dark:border-green-600 rounded-r-lg p-4">
                            <div className="flex items-center gap-2 mb-2">
                                <Icon name={IconName.CheckCircle} className="w-5 h-5 text-green-600 dark:text-green-400" />
                                <h4 className="font-semibold text-green-900 dark:text-green-200">Assessment Submitted Successfully</h4>
                            </div>
                            <div className="pl-7 space-y-1">
                                <p className="text-sm text-green-700 dark:text-green-300">
                                    <span className="font-medium">Reference:</span>{' '}
                                    <span className="font-mono bg-green-100 dark:bg-green-900/40 px-2 py-0.5 rounded">
                                        {result?.assessment?.referenceNumber || 'N/A'}
                                    </span>
                                </p>
                                <p className="text-sm text-green-700 dark:text-green-300">
                                    <span className="font-medium">Status:</span>{' '}
                                    <span className="font-semibold">Confirmed</span>
                                </p>
                            </div>
                        </div>
                    )}

                    {/* Raw Response (collapsible) */}
                    {/* <details className="mt-4">
                        <summary className="text-sm text-gray-500 dark:text-gray-400 cursor-pointer hover:text-gray-700 dark:hover:text-gray-300">
                            View Raw Response
                        </summary>
                        <pre className="mt-2 text-xs bg-gray-100 dark:bg-gray-800 p-3 rounded overflow-auto max-h-60">
                            {JSON.stringify(result, null, 2)}
                        </pre>
                    </details> */}
                </Card>
            )}
        </div>
    );
};

export const UpdateAssessmentView: React.FC = () => {
    const [referenceNumber, setReferenceNumber] = useState<string>('');
    const [action, setAction] = useState<string>('update');
    const [result, setResult] = useState<string>('Pass');
    const [grade, setGrade] = useState<string>('');
    const [score, setScore] = useState<string>('');
    const [traineeFullName, setTraineeFullName] = useState<string>('');
    const [skillCode, setSkillCode] = useState<string>('');
    const [assessmentDate, setAssessmentDate] = useState<string>('');
    const [isSubmitting, setIsSubmitting] = useState(false);
    const [apiResult, setApiResult] = useState<any>(null);
    const [error, setError] = useState<string | null>(null);

    const inputClasses = "block w-full px-3 py-2 text-on-surface bg-white border border-gray-300 rounded-md shadow-sm placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent dark:bg-gray-700 dark:border-gray-600 dark:text-white dark:placeholder-gray-500";

    const handleSubmit = async () => {
        if (!referenceNumber.trim()) { setError('Assessment Reference Number is required'); return; }
        if (!action.trim()) { setError('Action is required'); return; }
        if (action === 'update') {
            if (!result.trim()) { setError('Assessment Result is required for update action'); return; }
            if (!traineeFullName.trim()) { setError('Trainee Full Name is required for update action'); return; }
            if (!assessmentDate.trim()) { setError('Assessment Date is required for update action'); return; }
            if (!skillCode.trim()) { setError('Skill Code is required for update action'); return; }
        }

        setIsSubmitting(true);
        setError(null);
        setApiResult(null);

        try {
            const response = await fetch('/api/assessments/ssg-update', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    referenceNumber: referenceNumber.trim(),
                    action,
                    result: action === 'update' ? result : undefined,
                    traineeFullName: action === 'update' ? traineeFullName.trim() : undefined,
                    skillCode: action === 'update' ? skillCode.trim() : undefined,
                    assessmentDate: action === 'update' ? assessmentDate.trim() : undefined,
                    grade: grade.trim() || undefined,
                    score: score.trim() || undefined,
                })
            });

            const data = await response.json();

            if (!data.success) {
                setError(data.details?.[0]?.message || data.error || `Failed to ${action} assessment`);
                setApiResult(data);
                return;
            }

            setApiResult(data.data);
        } catch (err) {
            console.error('❌ Error updating assessment:', err);
            setError(err instanceof Error ? err.message : 'Failed to update assessment');
        } finally {
            setIsSubmitting(false);
        }
    };

    const handleClear = () => {
        setReferenceNumber('');
        setAction('update');
        setResult('Pass');
        setGrade('');
        setScore('');
        setTraineeFullName('');
        setSkillCode('');
        setAssessmentDate('');
        setApiResult(null);
        setError(null);
    };

    const isFormValid = referenceNumber.trim() && action.trim() &&
        (action === 'void' || (result.trim() && traineeFullName.trim() && assessmentDate.trim() && skillCode.trim()));

    return (
        <div>
            <h2 className="text-3xl font-bold mb-6 dark:text-white">Update Assessment</h2>

            {/* Input Form Card */}
            <Card className="p-6 mb-6">
                <h3 className="text-lg font-bold text-gray-700 dark:text-gray-200 mb-4">Assessment Update Details</h3>
                <p className="text-sm text-gray-600 dark:text-gray-400 mb-4">
                    Update or void an existing assessment record. For void action, only Reference Number and Action are required.
                </p>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
                    <div>
                        <label htmlFor="update-reference-number" className="block text-sm font-bold text-gray-700 dark:text-gray-300 mb-1">
                            Assessment Reference Number <span className="text-red-500">*</span>
                        </label>
                        <input
                            id="update-reference-number"
                            type="text"
                            value={referenceNumber}
                            onChange={(e) => setReferenceNumber(e.target.value)}
                            placeholder="e.g. ASM-2602-038292"
                            className={inputClasses}
                            disabled={isSubmitting}
                        />
                    </div>
                    <div>
                        <label htmlFor="update-action" className="block text-sm font-bold text-gray-700 dark:text-gray-300 mb-1">
                            Action <span className="text-red-500">*</span>
                        </label>
                        <select
                            id="update-action"
                            value={action}
                            onChange={(e) => setAction(e.target.value)}
                            className={inputClasses}
                            disabled={isSubmitting}
                        >
                            <option value="update">Update</option>
                            <option value="void">Void</option>
                        </select>
                    </div>

                    {/* Fields for update action only */}
                    {action === 'update' && (
                        <>
                            <div>
                                <label htmlFor="update-result" className="block text-sm font-bold text-gray-700 dark:text-gray-300 mb-1">
                                    Assessment Result <span className="text-red-500">*</span>
                                </label>
                                <select
                                    id="update-result"
                                    value={result}
                                    onChange={(e) => setResult(e.target.value)}
                                    className={inputClasses}
                                    disabled={isSubmitting}
                                >
                                    <option value="Pass">Pass</option>
                                    <option value="Fail">Fail</option>
                                    <option value="Exempt">Exempt</option>
                                </select>
                            </div>
                            <div>
                                <label htmlFor="update-trainee-name" className="block text-sm font-bold text-gray-700 dark:text-gray-300 mb-1">
                                    Trainee Full Name <span className="text-red-500">*</span>
                                </label>
                                <input
                                    id="update-trainee-name"
                                    type="text"
                                    value={traineeFullName}
                                    onChange={(e) => setTraineeFullName(e.target.value)}
                                    placeholder="e.g. John Doe"
                                    className={inputClasses}
                                    disabled={isSubmitting}
                                />
                            </div>
                            <div>
                                <label htmlFor="update-assessment-date" className="block text-sm font-bold text-gray-700 dark:text-gray-300 mb-1">
                                    Assessment Date <span className="text-red-500">*</span>
                                </label>
                                <input
                                    id="update-assessment-date"
                                    type="date"
                                    value={assessmentDate}
                                    onChange={(e) => setAssessmentDate(e.target.value)}
                                    placeholder="$$YYYY-MM-DD"
                                    className={inputClasses}
                                    disabled={isSubmitting}
                                />
                            </div>
                            <div>
                                <label htmlFor="update-skill-code" className="block text-sm font-bold text-gray-700 dark:text-gray-300 mb-1">
                                    Skill Code <span className="text-red-500">*</span>
                                </label>
                                <input
                                    id="update-skill-code"
                                    type="text"
                                    value={skillCode}
                                    onChange={(e) => setSkillCode(e.target.value)}
                                    placeholder="e.g. TGS-MKG-234222"
                                    className={inputClasses}
                                    disabled={isSubmitting}
                                    maxLength={30}
                                />
                            </div>
                            {/* Grade and Score fields hidden
                            <div>
                                <label htmlFor="update-grade" className="block text-sm font-bold text-gray-700 dark:text-gray-300 mb-1">
                                    Grade
                                </label>
                                <select
                                    id="update-grade"
                                    value={grade}
                                    onChange={(e) => setGrade(e.target.value)}
                                    className={inputClasses}
                                    disabled={isSubmitting}
                                >
                                    <option value="">-- Select Grade (optional) --</option>
                                    <option value="A">A</option>
                                    <option value="B">B</option>
                                    <option value="C">C</option>
                                    <option value="D">D</option>
                                    <option value="E">E</option>
                                    <option value="F">F</option>
                                </select>
                            </div>
                            <div>
                                <label htmlFor="update-score" className="block text-sm font-bold text-gray-700 dark:text-gray-300 mb-1">
                                    Score
                                </label>
                                <input
                                    id="update-score"
                                    type="number"
                                    value={score}
                                    onChange={(e) => setScore(e.target.value)}
                                    placeholder="e.g. 80 (optional)"
                                    className={inputClasses}
                                    disabled={isSubmitting}
                                    min="0"
                                    max="999"
                                />
                            </div>
                            */}
                        </>
                    )}
                </div>

                <div className="flex gap-3">
                    <Button
                        onClick={handleSubmit}
                        disabled={isSubmitting || !isFormValid}
                    >
                        {isSubmitting ? (
                            <div className="flex items-center">
                                <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white mr-2"></div>
                                {action === 'void' ? 'Voiding...' : 'Updating...'}
                            </div>
                        ) : (
                            <>
                                <Icon name={action === 'void' ? IconName.X : IconName.CheckCircle} className="w-4 h-4 mr-2" />
                                {action === 'void' ? 'Void Assessment' : 'Update Assessment'}
                            </>
                        )}
                    </Button>
                    <Button variant="outline" onClick={handleClear} disabled={isSubmitting}>
                        Clear
                    </Button>
                </div>

                {error && !apiResult && (
                    <p className="text-red-500 text-sm mt-3">{error}</p>
                )}
            </Card>

            {/* Loading State */}
            {isSubmitting && (
                <div className="flex justify-center py-10">
                    <div className="text-center">
                        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-500 mx-auto"></div>
                        <p className="mt-4 text-gray-600 dark:text-gray-400">
                            {action === 'void' ? 'Voiding assessment...' : 'Updating assessment...'}
                        </p>
                    </div>
                </div>
            )}

            {/* Result Display */}
            {!isSubmitting && apiResult && (
                <Card className="p-6">
                    {error ? (
                        <div className="bg-red-50 dark:bg-red-900/20 border-l-4 border-red-500 dark:border-red-600 rounded-r-lg p-4">
                            <div className="flex items-center gap-2 mb-2">
                                <Icon name={IconName.X} className="w-5 h-5 text-red-600 dark:text-red-400" />
                                <h4 className="font-semibold text-red-900 dark:text-red-200">
                                    Assessment {action === 'void' ? 'Voided' : 'Updated'} Unsuccessfully
                                </h4>
                            </div>
                            <div className="pl-7 space-y-1">
                                <p className="text-sm text-red-800 dark:text-red-300">{error}</p>
                            </div>
                        </div>
                    ) : (
                        <div className="bg-green-50 dark:bg-green-900/20 border-l-4 border-green-500 dark:border-green-600 rounded-r-lg p-4">
                            <div className="flex items-center gap-2 mb-2">
                                <Icon name={IconName.CheckCircle} className="w-5 h-5 text-green-600 dark:text-green-400" />
                                <h4 className="font-semibold text-green-900 dark:text-green-200">
                                    Assessment {action === 'void' ? 'Voided' : 'Updated'} Successfully
                                </h4>
                            </div>
                            <div className="pl-7 space-y-1">
                                <p className="text-sm text-green-700 dark:text-green-300">
                                    <span className="font-medium">Reference:</span>{' '}
                                    <span className="font-mono bg-green-100 dark:bg-green-900/40 px-2 py-0.5 rounded">
                                        {apiResult?.data?.assessment?.referenceNumber || referenceNumber}
                                    </span>
                                </p>
                                {apiResult?.meta?.updatedOn && (
                                    <p className="text-sm text-green-700 dark:text-green-300">
                                        <span className="font-medium">Updated On:</span>{' '}
                                        {new Date(apiResult.meta.updatedOn).toLocaleString()}
                                    </p>
                                )}
                            </div>
                        </div>
                    )}

                    {/* Raw Response (collapsible) */}
                    <details className="mt-4">
                        <summary className="text-sm text-gray-500 dark:text-gray-400 cursor-pointer hover:text-gray-700 dark:hover:text-gray-300">
                            View Raw Response
                        </summary>
                        <pre className="mt-2 text-xs bg-gray-100 dark:bg-gray-800 p-3 rounded overflow-auto max-h-60">
                            {JSON.stringify(apiResult, null, 2)}
                        </pre>
                    </details>
                </Card>
            )}
        </div>
    );
};

export const UpdateEnrolmentFeesView: React.FC = () => {
    const { trainingProviderProfile } = useLms();
    const [enrolmentReferenceNumber, setEnrolmentReferenceNumber] = useState<string>('');
    const [collectionStatus, setCollectionStatus] = useState<string>('Pending Payment');
    const [trainingPartnerUen, setTrainingPartnerUen] = useState<string>(trainingProviderProfile?.uen || '');
    const [trainingPartnerCode, setTrainingPartnerCode] = useState<string>(trainingProviderProfile?.uen ? `${trainingProviderProfile.uen}-01` : '');
    const [isSubmitting, setIsSubmitting] = useState(false);
    const [result, setResult] = useState<any>(null);
    const [error, setError] = useState<string | null>(null);

    const UPDATE_FEES_API = '/api/enrolment/update-fees';

    const inputClasses = "block w-full px-3 py-2 text-on-surface bg-white border border-gray-300 rounded-md shadow-sm placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent dark:bg-gray-700 dark:border-gray-600 dark:text-white dark:placeholder-gray-500";

    const collectionStatusOptions = [
        'Pending Payment',
        'Partial Payment',
        'Full Payment',
        'Cancelled'
    ];

    const handleSubmit = async () => {
        if (!enrolmentReferenceNumber.trim()) {
            setError('Enrolment Reference Number is required');
            return;
        }
        if (!trainingPartnerUen.trim()) {
            setError('Training Partner UEN is required');
            return;
        }
        if (!trainingPartnerCode.trim()) {
            setError('Training Partner Code is required');
            return;
        }

        setIsSubmitting(true);
        setError(null);
        setResult(null);

        try {
            console.log('📤 Update enrolment fees:', enrolmentReferenceNumber.trim(), collectionStatus);

            const response = await fetch(UPDATE_FEES_API, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    referenceNumber: enrolmentReferenceNumber.trim(),
                    collectionStatus
                })
            });

            const data = await response.json();
            console.log('✅ Update enrolment fees response:', data);

            if (!response.ok || !data.success) {
                const errorMessage = data?.error?.message || data?.error || 'Failed to update enrolment fees';
                setError(typeof errorMessage === 'string' ? errorMessage : JSON.stringify(errorMessage));
            }

            setResult(data.data ?? data);
        } catch (err) {
            console.error('❌ Error updating enrolment fees:', err);
            setError(err instanceof Error ? err.message : 'Failed to update enrolment fees');
        } finally {
            setIsSubmitting(false);
        }
    };

    const handleClear = () => {
        setEnrolmentReferenceNumber('');
        setCollectionStatus('Pending Payment');
        setTrainingPartnerUen(trainingProviderProfile?.uen || '');
        setTrainingPartnerCode(trainingProviderProfile?.uen ? `${trainingProviderProfile.uen}-01` : '');
        setResult(null);
        setError(null);
    };

    const isFormValid = enrolmentReferenceNumber.trim() && trainingPartnerUen.trim() && trainingPartnerCode.trim();

    return (
        <div>
            <h2 className="text-3xl font-bold mb-6 dark:text-white">Update Enrolment Fees</h2>

            <Card className="p-6 mb-6">
                <h3 className="text-lg font-bold text-gray-700 dark:text-gray-200 mb-4">Fee Collection Details</h3>
                <p className="text-sm text-gray-600 dark:text-gray-400 mb-4">
                    Update the fee collection status for an enrolment. All fields are required.
                </p>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div>
                        <label className="block text-sm font-medium text-gray-700 dark:text-gray-200 mb-1">
                            Enrolment Reference Number *
                        </label>
                        <input
                            type="text"
                            value={enrolmentReferenceNumber}
                            onChange={(e) => setEnrolmentReferenceNumber(e.target.value)}
                            className={inputClasses}
                            placeholder="e.g., ENR-2401-000123"
                        />
                    </div>
                    <div>
                        <label className="block text-sm font-medium text-gray-700 dark:text-gray-200 mb-1">
                            Collection Status *
                        </label>
                        <select
                            value={collectionStatus}
                            onChange={(e) => setCollectionStatus(e.target.value)}
                            className={inputClasses}
                        >
                            {collectionStatusOptions.map((status) => (
                                <option key={status} value={status}>{status}</option>
                            ))}
                        </select>
                    </div>
                    <div>
                        <label className="block text-sm font-medium text-gray-700 dark:text-gray-200 mb-1">
                            Training Partner UEN *
                        </label>
                        <input
                            type="text"
                            value={trainingPartnerUen}
                            onChange={(e) => setTrainingPartnerUen(e.target.value)}
                            className={inputClasses}
                            placeholder="e.g., 201200696W"
                        />
                    </div>
                    <div>
                        <label className="block text-sm font-medium text-gray-700 dark:text-gray-200 mb-1">
                            Training Partner Code *
                        </label>
                        <input
                            type="text"
                            value={trainingPartnerCode}
                            onChange={(e) => setTrainingPartnerCode(e.target.value)}
                            className={inputClasses}
                            placeholder="e.g., 201200696W-01"
                        />
                    </div>
                </div>

                <div className="mt-6 flex gap-3">
                    <button
                        onClick={handleSubmit}
                        disabled={!isFormValid || isSubmitting}
                        className="bg-blue-600 hover:bg-blue-700 disabled:bg-gray-400 text-white px-6 py-2 rounded-md font-medium transition-colors"
                    >
                        {isSubmitting ? 'Updating...' : 'Update Fees'}
                    </button>
                    <button
                        onClick={handleClear}
                        className="bg-gray-200 hover:bg-gray-300 dark:bg-gray-600 dark:hover:bg-gray-500 text-gray-700 dark:text-white px-6 py-2 rounded-md font-medium transition-colors"
                    >
                        Clear
                    </button>
                </div>
            </Card>

            {isSubmitting && (
                <div className="flex items-center justify-center py-8">
                    <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600"></div>
                    <span className="ml-3 text-gray-600 dark:text-gray-300">Updating enrolment fees...</span>
                </div>
            )}

            {!isSubmitting && error && (
                <Card className="p-6 mb-6">
                    <div className="bg-red-50 dark:bg-red-900/20 border-l-4 border-red-500 dark:border-red-600 rounded-r-lg p-4">
                        <div className="flex items-center gap-2 mb-2">
                            <Icon name={IconName.X} className="w-5 h-5 text-red-600 dark:text-red-400" />
                            <h4 className="font-semibold text-red-900 dark:text-red-200">Failed to Update Enrolment Fees</h4>
                        </div>
                        <p className="text-sm text-red-800 dark:text-red-300 pl-7">{error}</p>
                    </div>
                </Card>
            )}

            {!isSubmitting && result && !error && (
                <Card className="p-6 mb-6">
                    <div className="bg-green-50 dark:bg-green-900/20 border-l-4 border-green-500 dark:border-green-600 rounded-r-lg p-4">
                        <div className="flex items-center gap-2 mb-2">
                            <Icon name={IconName.CheckCircle} className="w-5 h-5 text-green-600 dark:text-green-400" />
                            <h4 className="font-semibold text-green-900 dark:text-green-200">Enrolment Fees Updated Successfully</h4>
                        </div>
                        <div className="pl-7 space-y-1">
                            <p className="text-sm text-green-700 dark:text-green-300">
                                <span className="font-medium">Reference:</span>{' '}
                                <span className="font-mono bg-green-100 dark:bg-green-900/40 px-2 py-0.5 rounded">
                                    {enrolmentReferenceNumber}
                                </span>
                            </p>
                            <p className="text-sm text-green-700 dark:text-green-300">
                                <span className="font-medium">New Collection Status:</span>{' '}
                                <span className="font-semibold">{collectionStatus}</span>
                            </p>
                        </div>
                    </div>
                </Card>
            )}

            {result && (
                <Card className="p-4">
                    <details>
                        <summary className="cursor-pointer text-sm font-medium text-gray-700 dark:text-gray-300">
                            View Raw Response
                        </summary>
                        <pre className="mt-2 text-xs bg-gray-100 dark:bg-gray-800 p-3 rounded overflow-auto max-h-60">
                            {JSON.stringify(result, null, 2)}
                        </pre>
                    </details>
                </Card>
            )}
        </div>
    );
};

export const ViewAssessmentsView: React.FC = () => {
    // No mock data - empty arrays for now
    const courses: any[] = [];

    const [selectedCourseId, setSelectedCourseId] = useState<string>('');
    const [isLoading, setIsLoading] = useState(false);
    const [results, setResults] = useState<any[] | null>(null);

    const allClassOptions = useMemo(() => {
        return courses.sort((a, b) => new Date(b.startDate).getTime() - new Date(a.startDate).getTime());
    }, [courses]);

    useEffect(() => {
        const handleFetchStatus = () => {
            const course = courses.find(c => c.id === selectedCourseId);
            if (!course) return;

            setIsLoading(true);
            setResults(null);

            // Simulate fetching data from TPG
            setTimeout(() => {
                const tpgResults = (course.learners || []).map((learner: any) => ({
                    courseTitle: course.title,
                    courseRunId: course.courseRunId,
                    learnerName: learner.name,
                    assessmentStatus: learner.assessmentStatus || 'Pending Assessment',
                }));
                setResults(tpgResults);
                setIsLoading(false);
            }, 1500);
        };

        if (selectedCourseId) {
            handleFetchStatus();
        }
    }, [selectedCourseId, courses]);

    return (
        <div>
            <h2 className="text-3xl font-bold mb-6">View Assessments from TPG</h2>
            <Card className="p-6 mb-6">
                <div>
                    <label htmlFor="class-select-view-assessment" className="block text-sm font-bold text-gray-700 dark:text-gray-300 mb-1">
                        Select a Class to Retrieve Assessment Status
                    </label>
                    <select
                        id="class-select-view-assessment"
                        value={selectedCourseId}
                        onChange={e => setSelectedCourseId(e.target.value)}
                        className={inputClasses}
                    >
                        <option value="" disabled>-- Choose any class --</option>
                        {allClassOptions.length === 0 ? (
                            <option value="" disabled>No classes available</option>
                        ) : (
                            allClassOptions.map(c => (
                                <option key={c.id} value={c.id}>
                                    {c.title} ({c.courseRunId})
                                </option>
                            ))
                        )}
                    </select>
                    {courses.length === 0 && (
                        <p className="text-sm text-gray-500 dark:text-gray-400 mt-2">No classes found. Please create classes first.</p>
                    )}
                </div>
            </Card>

            {isLoading && (
                <div className="flex justify-center py-10">
                    <div className="text-center">
                        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-500 mx-auto"></div>
                        <p className="mt-4 text-gray-600 dark:text-gray-300">Retrieving data from TPG...</p>
                    </div>
                </div>
            )}

            {results && (
                <Card className="p-0">
                    <div className="p-6 border-b">
                        <h3 className="text-xl font-bold">Assessment Status for {courses.find(c => c.id === selectedCourseId)?.title}</h3>
                        <p className="text-gray-500 dark:text-gray-400 mt-1">Showing official results retrieved from TPG.</p>
                    </div>
                    <div className="overflow-x-auto">
                        <table className="min-w-full divide-y divide-gray-200">
                            <thead className="bg-gray-50">
                                <tr>
                                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Learner Name</th>
                                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Course</th>
                                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Assessment Status</th>
                                </tr>
                            </thead>
                            <tbody className="bg-white divide-y divide-gray-200">
                                {results.map((result, index) => (
                                    <tr key={index} className="hover:bg-gray-50">
                                        <td className="px-6 py-4 whitespace-nowrap">
                                            <div className="font-medium text-gray-900 dark:text-white">{result.learnerName}</div>
                                        </td>
                                        <td className="px-6 py-4 whitespace-nowrap">
                                            <div className="text-sm text-gray-900 dark:text-white">{result.courseTitle}</div>
                                            <div className="text-sm text-gray-500 dark:text-gray-400">{result.courseRunId}</div>
                                        </td>
                                        <td className="px-6 py-4 whitespace-nowrap">
                                            <span className={`inline-flex px-2 py-1 text-xs font-semibold rounded-full border ${getStatusColor(result.assessmentStatus)}`}>
                                                {result.assessmentStatus}
                                            </span>
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                </Card>
            )}
        </div>
    );
};

export const ApplyNewClaimView: React.FC = () => {
    // No mock data - empty arrays for now
    const courses: any[] = [];

    const [selectedCourseId, setSelectedCourseId] = useState<string>('');
    const [selectedLearners, setSelectedLearners] = useState<Set<string>>(new Set());
    const [isSubmitting, setIsSubmitting] = useState(false);
    const [submissionStatus, setSubmissionStatus] = useState<string | null>(null);

    const allClassOptions = useMemo(() => {
        return courses.sort((a, b) => new Date(b.startDate).getTime() - new Date(a.startDate).getTime());
    }, [courses]);

    const selectedCourse = useMemo(() => {
        return courses.find(c => c.id === selectedCourseId);
    }, [courses, selectedCourseId]);

    const eligibleLearners = useMemo(() => {
        if (!selectedCourse?.learners) return [];
        return selectedCourse.learners.filter((l: any) => l.grantStatus === 'Success');
    }, [selectedCourse]);

    const handleSelectAll = (e: React.ChangeEvent<HTMLInputElement>) => {
        if (e.target.checked) {
            const allEligibleLearnerEmails = new Set<string>(eligibleLearners.map((l: any) => l.email as string));
            setSelectedLearners(allEligibleLearnerEmails);
        } else {
            setSelectedLearners(new Set<string>());
        }
    };

    const handleSelectLearner = (email: string) => {
        const newSelection = new Set<string>(selectedLearners);
        if (newSelection.has(email)) {
            newSelection.delete(email);
        } else {
            newSelection.add(email);
        }
        setSelectedLearners(newSelection);
    };

    const handleSubmit = () => {
        if (selectedLearners.size === 0) {
            alert('Please select at least one learner to submit a claim for.');
            return;
        }
        setIsSubmitting(true);
        setSubmissionStatus(null);

        // Simulate API call to SSG for claims
        setTimeout(() => {
            setIsSubmitting(false);
            setSubmissionStatus(`Successfully submitted claim application for ${selectedLearners.size} learner(s).`);
            setSelectedLearners(new Set<string>());
        }, 2000);
    };

    return (
        <div>
            <h2 className="text-3xl font-bold mb-6">Apply New Claim</h2>
            <Card className="p-6 mb-6">
                <div className="space-y-4">
                    <div>
                        <label htmlFor="class-select-claim" className="block text-sm font-bold text-gray-700 dark:text-gray-300 mb-1">
                            1. Select a Class
                        </label>
                        <select
                            id="class-select-claim"
                            value={selectedCourseId}
                            onChange={e => {
                                setSelectedCourseId(e.target.value);
                                setSelectedLearners(new Set<string>());
                                setSubmissionStatus(null);
                            }}
                            className={inputClasses}
                        >
                            <option value="" disabled>-- Choose a class --</option>
                            {allClassOptions.length === 0 ? (
                                <option value="" disabled>No classes available</option>
                            ) : (
                                allClassOptions.map(c => (
                                    <option key={c.id} value={c.id}>
                                        {c.title} ({c.courseRunId})
                                    </option>
                                ))
                            )}
                        </select>
                        {courses.length === 0 && (
                            <p className="text-sm text-gray-500 dark:text-gray-400 mt-2">No classes found. Please create classes first.</p>
                        )}
                    </div>

                    {selectedCourse && (
                        <div>
                            <h3 className="text-lg font-bold text-gray-800 mb-2">2. Select Eligible Learners for Claim Submission</h3>
                            <p className="text-sm text-gray-500 mb-4">
                                Only learners with successful grant status are eligible for claim submission.
                            </p>
                        </div>
                    )}
                </div>
            </Card>

            {selectedCourse && (
                <Card className="p-0">
                    <div className="overflow-x-auto">
                        <table className="min-w-full divide-y divide-gray-200">
                            <thead className="bg-gray-50">
                                <tr>
                                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                                        <input
                                            type="checkbox"
                                            onChange={handleSelectAll}
                                            checked={eligibleLearners.length > 0 && selectedLearners.size === eligibleLearners.length}
                                        />
                                    </th>
                                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Learner</th>
                                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Email</th>
                                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Grant Status</th>
                                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Claim Status</th>
                                </tr>
                            </thead>
                            <tbody className="bg-white divide-y divide-gray-200">
                                {selectedCourse.learners && selectedCourse.learners.length > 0 ? (
                                    selectedCourse.learners.map((learner: any) => {
                                        const isEligible = learner.grantStatus === 'Success';
                                        return (
                                            <tr key={learner.email} className={`${!isEligible ? 'bg-gray-50 opacity-60' : 'hover:bg-gray-50'}`}>
                                                <td className="px-6 py-4 whitespace-nowrap">
                                                    {isEligible && (
                                                        <input
                                                            type="checkbox"
                                                            checked={selectedLearners.has(learner.email)}
                                                            onChange={() => handleSelectLearner(learner.email)}
                                                        />
                                                    )}
                                                </td>
                                                <td className="px-6 py-4 whitespace-nowrap">
                                                    <div className="font-medium text-gray-900 dark:text-white">{learner.name || 'N/A'}</div>
                                                </td>
                                                <td className="px-6 py-4 whitespace-nowrap">
                                                    <div className="text-sm text-gray-900 dark:text-white">{learner.email || 'N/A'}</div>
                                                </td>
                                                <td className="px-6 py-4 whitespace-nowrap">
                                                    <span className={`inline-flex px-2 py-1 text-xs font-semibold rounded-full border ${getStatusColor(learner.grantStatus || 'Pending')}`}>
                                                        {learner.grantStatus || 'Pending'}
                                                    </span>
                                                </td>
                                                <td className="px-6 py-4 whitespace-nowrap">
                                                    <span className={`inline-flex px-2 py-1 text-xs font-semibold rounded-full border ${getStatusColor(learner.claimStatus || 'Pending')}`}>
                                                        {learner.claimStatus || 'Pending'}
                                                    </span>
                                                </td>
                                            </tr>
                                        );
                                    })
                                ) : (
                                    <tr>
                                        <td colSpan={5} className="px-6 py-12 text-center text-gray-500 dark:text-gray-400">
                                            No learners enrolled in this class yet.
                                        </td>
                                    </tr>
                                )}
                            </tbody>
                        </table>
                    </div>
                </Card>
            )}

            {selectedCourse && (
                <div className="mt-6 flex justify-end items-center gap-4">
                    {submissionStatus && <p className="text-green-600 font-semibold">{submissionStatus}</p>}
                    <Button onClick={handleSubmit} disabled={isSubmitting || selectedLearners.size === 0}>
                        {isSubmitting ? (
                            <div className="flex items-center">
                                <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white mr-2"></div>
                                Submitting...
                            </div>
                        ) : `Submit Claim to SSG (${selectedLearners.size} selected)`}
                    </Button>
                </div>
            )}
        </div>
    );
};

export const ViewClaimStatusView: React.FC = () => {
    // No mock data - empty arrays for now
    const courses: any[] = [];

    const [selectedCourseId, setSelectedCourseId] = useState<string>('');

    const allClassOptions = useMemo(() => {
        return courses.sort((a, b) => new Date(b.startDate).getTime() - new Date(a.startDate).getTime());
    }, [courses]);

    const selectedCourse = useMemo(() => {
        return courses.find(c => c.id === selectedCourseId);
    }, [courses, selectedCourseId]);

    return (
        <div>
            <h2 className="text-3xl font-bold mb-6">View Claim Status</h2>
            <Card className="p-6 mb-6">
                <div>
                    <label htmlFor="class-select-claim-status" className="block text-sm font-bold text-gray-700 dark:text-gray-300 mb-1">
                        Select a Class to View Claim Statuses
                    </label>
                    <select
                        id="class-select-claim-status"
                        value={selectedCourseId}
                        onChange={e => setSelectedCourseId(e.target.value)}
                        className={inputClasses}
                    >
                        <option value="" disabled>-- Choose any class --</option>
                        {allClassOptions.length === 0 ? (
                            <option value="" disabled>No classes available</option>
                        ) : (
                            allClassOptions.map(c => (
                                <option key={c.id} value={c.id}>
                                    {c.title} ({c.courseRunId})
                                </option>
                            ))
                        )}
                    </select>
                    {courses.length === 0 && (
                        <p className="text-sm text-gray-500 dark:text-gray-400 mt-2">No classes found. Please create classes first.</p>
                    )}
                </div>
            </Card>

            {selectedCourse && (
                <Card className="p-0">
                    <div className="p-6 border-b">
                        <h3 className="text-xl font-bold">Claim Status for {selectedCourse.title}</h3>
                        <p className="text-gray-500 dark:text-gray-400 mt-1">Showing all enrolled learners and their claim application status.</p>
                    </div>
                    <div className="overflow-x-auto">
                        <table className="min-w-full divide-y divide-gray-200">
                            <thead className="bg-gray-50">
                                <tr>
                                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Learner Name</th>
                                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Email</th>
                                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Grant Status</th>
                                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Claim Status</th>
                                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Claim ID</th>
                                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Last Updated</th>
                                </tr>
                            </thead>
                            <tbody className="bg-white divide-y divide-gray-200">
                                {selectedCourse.learners && selectedCourse.learners.length > 0 ? (
                                    selectedCourse.learners.map((learner: any) => (
                                        <tr key={learner.email} className="hover:bg-gray-50">
                                            <td className="px-6 py-4 whitespace-nowrap">
                                                <div className="font-medium text-gray-900 dark:text-white">{learner.name || 'N/A'}</div>
                                            </td>
                                            <td className="px-6 py-4 whitespace-nowrap">
                                                <div className="text-sm text-gray-900 dark:text-white">{learner.email || 'N/A'}</div>
                                            </td>
                                            <td className="px-6 py-4 whitespace-nowrap">
                                                <span className={`inline-flex px-2 py-1 text-xs font-semibold rounded-full border ${getStatusColor(learner.grantStatus || 'Pending')}`}>
                                                    {learner.grantStatus || 'Pending'}
                                                </span>
                                            </td>
                                            <td className="px-6 py-4 whitespace-nowrap">
                                                <span className={`inline-flex px-2 py-1 text-xs font-semibold rounded-full border ${getStatusColor(learner.claimStatus || 'Pending')}`}>
                                                    {learner.claimStatus || 'Pending'}
                                                </span>
                                            </td>
                                            <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900 dark:text-white">
                                                {learner.claimId || 'N/A'}
                                            </td>
                                            <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500 dark:text-gray-400">
                                                N/A
                                            </td>
                                        </tr>
                                    ))
                                ) : (
                                    <tr>
                                        <td colSpan={6} className="px-6 py-12 text-center text-gray-500 dark:text-gray-400">
                                            No learners enrolled in this class yet.
                                        </td>
                                    </tr>
                                )}
                            </tbody>
                        </table>
                    </div>
                </Card>
            )}
        </div>
    );
};

export const UploadCourseRunsView: React.FC = () => {
    const [file, setFile] = useState<File | null>(null);
    const [isUploading, setIsUploading] = useState(false);
    const [submissionResult, setSubmissionResult] = useState<any[] | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [isDragOver, setIsDragOver] = useState(false);
    const [progress, setProgress] = useState<{ current: number; total: number } | null>(null);

    const handleFileChange = (selectedFile: File | undefined | null) => {
        if (selectedFile) {
            if (selectedFile.type === 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' || selectedFile.type === 'application/vnd.ms-excel') {
                setFile(selectedFile);
                setError(null);
            } else {
                setError('Invalid file type. Please upload an Excel file (.xlsx, .xls).');
                setFile(null);
            }
        }
    };

    const handleDragEvents = (e: React.DragEvent<HTMLDivElement>, isOver: boolean) => {
        e.preventDefault();
        e.stopPropagation();
        setIsDragOver(isOver);
    };

    const handleDrop = (e: React.DragEvent<HTMLDivElement>) => {
        e.preventDefault();
        e.stopPropagation();
        setIsDragOver(false);
        const droppedFile = e.dataTransfer.files?.[0];
        handleFileChange(droppedFile);
    };

    // Convert any date value from Excel to YYYYMMDD integer
    const parseDateToInt = (value: any): number => {
        if (!value) return 0;
        const str = String(value).trim();
        if (/^\d{8}$/.test(str)) return parseInt(str); // already YYYYMMDD
        if (/^\d{4}-\d{2}-\d{2}$/.test(str)) return parseInt(str.replace(/-/g, '')); // YYYY-MM-DD
        const slashMatch = str.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
        if (slashMatch) return parseInt(`${slashMatch[3]}${slashMatch[2].padStart(2, '0')}${slashMatch[1].padStart(2, '0')}`);
        return 0;
    };

    // Extract leading code number from values like "1 - Classroom" → "1"
    const extractCode = (value: any, fallback = '1'): string => {
        if (!value) return fallback;
        const m = String(value).trim().match(/^(\d+)/);
        return m ? m[1] : fallback;
    };

    const isTruthy = (value: any): boolean => {
        if (!value) return false;
        const s = String(value).trim().toLowerCase();
        return s === 'yes' || s === 'true' || s === '1' || s === 'y';
    };

    const handleUpload = async () => {
        if (!file) return;
        setIsUploading(true);
        setSubmissionResult(null);
        setError(null);
        setProgress(null);

        try {
            const XLSX = await import('xlsx');
            const buffer = await file.arrayBuffer();
            const wb = XLSX.read(buffer, { type: 'array', cellDates: false, raw: false });
            const ws = wb.Sheets[wb.SheetNames[0]];
            const rows: any[] = XLSX.utils.sheet_to_json(ws, { raw: false, dateNF: 'YYYY-MM-DD', defval: '' });

            const dataRows = rows.filter(r => String(r['Course Reference Number'] ?? '').trim());
            if (dataRows.length === 0) {
                setError('No data rows found in the Excel file. Please check the format.');
                return;
            }

            // Fetch UEN once
            const uenRes = await fetch('/api/training-provider/uen');
            if (!uenRes.ok) throw new Error('Failed to fetch UEN from database');
            const { uen } = await uenRes.json();

            const results: any[] = [];
            setProgress({ current: 0, total: dataRows.length });

            for (let i = 0; i < dataRows.length; i++) {
                const row = dataRows[i];
                setProgress({ current: i + 1, total: dataRows.length });

                const courseRef = String(row['Course Reference Number']).trim();
                const startDateDisplay = row['Course Start Date'] || '';
                const endDateDisplay = row['Course End Date'] || '';

                try {
                    // Venue (with defaults matching office address)
                    const postalCode  = String(row['Venue - Postal Code'] || '737715').trim();
                    const floor       = String(row['Venue - Floor Number'] || '07').trim();
                    const unit        = String(row['Venue - Unit Number'] || '85-87').trim();
                    const room        = String(row['Venue - Room'] || 'Training room').trim();
                    const wheelchair  = !row['Wheelchair Access'] || isTruthy(row['Wheelchair Access']);

                    const venue = {
                        block: '12',
                        street: 'WOODS SQUARE',
                        building: 'WOODS SQUARE',
                        floor,
                        unit,
                        postalCode,
                        room,
                        wheelChairAccess: wheelchair,
                    };

                    const scheduleDesc = String(row['Schedule: Description'] || 'Description').trim();
                    const startInt = parseDateToInt(row['Course Start Date']);
                    const endInt   = parseDateToInt(row['Course End Date']);
                    const scheduleInfo = startDateDisplay && endDateDisplay
                        ? `${startDateDisplay} - ${endDateDisplay}`
                        : 'Course dates not specified';

                    const runObject: any = {
                        sequenceNumber: 0,
                        registrationDates: {
                            opening: parseDateToInt(row['Registration Opening Date']),
                            closing: parseDateToInt(row['Registration Closing Date']),
                        },
                        courseDates: { start: startInt, end: endInt },
                        scheduleInfoType: { code: '01', description: scheduleDesc },
                        scheduleInfo,
                        venue,
                        modeOfTraining: extractCode(row['Course Run Mode of Training']),
                        courseAdminEmail: String(row['Course Admin Email'] || '').trim(),
                        courseVacancy: {
                            code: extractCode(row['Vacancy'], 'A'),
                            description: extractCode(row['Vacancy'], 'A') === 'A' ? 'Available' : 'Full',
                        },
                        file: { Name: '' },
                    };

                    // Session (optional)
                    const sessionStart = row['Session Start Date'];
                    const sessionEnd   = row['Session End Date'];
                    if (sessionStart && sessionEnd) {
                        const sameVenue = !row['Same as Primary Venue'] || isTruthy(row['Same as Primary Venue']);
                        const sessionVenue = sameVenue ? { ...venue } : {
                            block: '12',
                            street: 'WOODS SQUARE',
                            building: 'WOODS SQUARE',
                            floor:       String(row['Session Venue - Floor Number'] || floor).trim(),
                            unit:        String(row['Session Venue - Unit Number'] || unit).trim(),
                            postalCode:  String(row['Session Venue - Postal Code'] || postalCode).trim(),
                            room:        String(row['Session Venue - Room'] || room).trim(),
                            wheelChairAccess: isTruthy(row['Session Wheelchair Access'] ?? 'yes'),
                        };
                        runObject.sessions = [{
                            startDate:      String(sessionStart).replace(/-/g, ''),
                            endDate:        String(sessionEnd).replace(/-/g, ''),
                            startTime:      String(row['Session -Start Time'] || '09:00').trim() + ':00',
                            endTime:        String(row['Session -End Time'] || '18:00').trim() + ':00',
                            modeOfTraining: extractCode(row['Session Mode of Training'], runObject.modeOfTraining),
                            venue:          sessionVenue,
                        }];
                    }

                    // Trainer (optional)
                    const trainerIdNumber = String(row['Trainer ID Number'] || '').trim();
                    if (trainerIdNumber) {
                        runObject.linkCourseRunTrainer = [{
                            trainer: {
                                trainerType: {
                                    code: extractCode(row['Trainer: Option'], '1'),
                                    description: extractCode(row['Trainer: Option'], '1') === '1' ? 'Existing' : 'New',
                                },
                                idNumber: trainerIdNumber,
                            },
                        }];
                    }

                    const requestBody = {
                        course: {
                            courseReferenceNumber: courseRef,
                            trainingProvider: { uen },
                            runs: [runObject],
                        },
                    };

                    const response = await fetch('/api/ssg/courses/courseRuns/create-new', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify(requestBody),
                    });

                    const responseData = await response.json();

                    if (!response.ok) {
                        const errMsg = responseData?.error?.details?.[0]?.message
                            || responseData?.error?.message
                            || `SSG error ${response.status}`;
                        results.push({ courseRef, startDate: startDateDisplay, endDate: endDateDisplay, status: 'Failed', error: errMsg });
                    } else {
                        const courseRunId = responseData?.data?.runs?.[0]?.id
                            || responseData?.runs?.[0]?.id
                            || responseData?.data?.run?.id;
                        results.push({ courseRef, startDate: startDateDisplay, endDate: endDateDisplay, status: 'Success', courseRunId: courseRunId?.toString() || 'N/A' });
                    }
                } catch (rowErr) {
                    results.push({
                        courseRef,
                        startDate: startDateDisplay,
                        endDate: endDateDisplay,
                        status: 'Failed',
                        error: rowErr instanceof Error ? rowErr.message : 'Unknown error',
                    });
                }
            }

            setSubmissionResult(results);
        } catch (err) {
            setError(err instanceof Error ? err.message : 'Failed to process file');
        } finally {
            setIsUploading(false);
            setProgress(null);
        }
    };

    const resetView = () => {
        setFile(null);
        setSubmissionResult(null);
        setError(null);
        setProgress(null);
    };

    const UploadStep = () => (
        <Card className="p-6">
            <div className="text-center mb-4">
                <h3 className="text-xl font-bold dark:text-white">Upload Course Runs</h3>
                <p className="text-gray-500 dark:text-gray-400 mt-1">Submit your course run details in bulk by uploading an Excel file.</p>
            </div>

            <div
                onDragOver={(e) => handleDragEvents(e, true)}
                onDragLeave={(e) => handleDragEvents(e, false)}
                onDrop={handleDrop}
                className={`p-10 border-2 border-dashed rounded-lg text-center cursor-pointer transition-colors ${isDragOver ? 'border-blue-500 bg-blue-50 dark:bg-blue-900/20' : 'border-gray-300 dark:border-gray-600 hover:border-blue-500 dark:hover:border-blue-400'}`}
            >
                <input
                    type="file"
                    id="file-upload"
                    className="hidden"
                    accept=".xlsx, .xls"
                    onChange={(e) => handleFileChange(e.target.files?.[0])}
                />
                <label htmlFor="file-upload" className="cursor-pointer">
                    <Icon name={IconName.Upload} className="w-12 h-12 mx-auto text-gray-400 dark:text-gray-500" />
                    <p className="mt-2 font-semibold text-gray-900 dark:text-white">
                        {file ? file.name : 'Drag & drop your file here, or click to browse'}
                    </p>
                    <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
                        XLSX or XLS file format
                    </p>
                </label>
            </div>
            {error && <p className="text-red-500 dark:text-red-400 text-sm mt-2 text-center">{error}</p>}

            <div className="flex justify-between items-center mt-6">
                <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => {
                        const link = document.createElement('a');
                        link.href = '/ssg_templates/Course_Run_Template.xlsx';
                        link.download = 'Course_Run_Template.xlsx';
                        document.body.appendChild(link);
                        link.click();
                        document.body.removeChild(link);
                    }}
                >
                    <Icon name={IconName.Download} className="w-4 h-4 mr-2" />
                    Course Run Template
                </Button>
                <Button onClick={handleUpload} disabled={!file || isUploading}>
                    {isUploading ? (
                        <div className="flex items-center">
                            <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white mr-2"></div>
                            Submitting...
                        </div>
                    ) : 'Submit to SSG'}
                </Button>
            </div>
        </Card>
    );

    const ResultsStep = () => (
        <Card>
            <div className="p-6 border-b dark:border-gray-700">
                <h3 className="text-xl font-bold dark:text-white">Submission Results</h3>
                <p className="text-gray-500 dark:text-gray-400 mt-1">The following results were returned from SSG.</p>
            </div>
            <div className="overflow-x-auto">
                <table className="min-w-full divide-y divide-gray-200 dark:divide-gray-600">
                    <thead className="bg-gray-50 dark:bg-gray-800">
                        <tr>
                            <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-300 uppercase tracking-wider">Course Reference</th>
                            <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-300 uppercase tracking-wider">Start Date</th>
                            <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-300 uppercase tracking-wider">End Date</th>
                            <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-300 uppercase tracking-wider">Status</th>
                            <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-300 uppercase tracking-wider">Details</th>
                        </tr>
                    </thead>
                    <tbody className="bg-white dark:bg-gray-700 divide-y divide-gray-200 dark:divide-gray-600">
                        {submissionResult?.map((result, index) => (
                            <tr key={index} className="hover:bg-gray-50 dark:hover:bg-gray-600">
                                <td className="px-6 py-4 whitespace-nowrap font-medium text-gray-900 dark:text-white">{result.courseRef}</td>
                                <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900 dark:text-gray-200">{result.startDate}</td>
                                <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900 dark:text-gray-200">{result.endDate}</td>
                                <td className="px-6 py-4 whitespace-nowrap">
                                    <span className={`inline-flex px-2 py-1 text-xs font-semibold rounded-full border ${getStatusColor(result.status)}`}>
                                        {result.status}
                                    </span>
                                </td>
                                <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900 dark:text-gray-200">
                                    {result.status === 'Success' ? `Course Run ID: ${result.courseRunId}` : result.error}
                                </td>
                            </tr>
                        ))}
                    </tbody>
                </table>
            </div>
            <div className="p-4 border-t dark:border-gray-700 text-right">
                <Button onClick={resetView}>Start a New Upload</Button>
            </div>
        </Card>
    );

    return (
        <div>
            <h2 className="text-3xl font-bold mb-6 dark:text-white">Upload Course Runs to SSG</h2>
            {isUploading ? (
                <div className="flex justify-center py-20">
                    <div className="text-center">
                        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-500 mx-auto"></div>
                        {progress ? (
                            <p className="mt-4 text-gray-600 dark:text-gray-300">
                                Submitting to SSG… {progress.current} / {progress.total}
                            </p>
                        ) : (
                            <p className="mt-4 text-gray-600 dark:text-gray-300">Parsing file…</p>
                        )}
                    </div>
                </div>
            ) : submissionResult ? (
                <ResultsStep />
            ) : (
                <UploadStep />
            )}
        </div>
    );
};

export const SearchGrantView: React.FC = () => {
    // Search functionality state
    const [courseRunId, setCourseRunId] = useState<string>('');
    const [isSearching, setIsSearching] = useState(false);
    const [grantsData, setGrantsData] = useState<{ data: any[]; meta: any } | null>(null);
    const [searchError, setSearchError] = useState<string | null>(null);
    const [currentPage, setCurrentPage] = useState<number>(0);
    const PAGE_SIZE = 10;

    // Helper functions for consistent styling
    const getStatusColor = (status: string) => {
        switch (status) {
            case 'Paid':
            case 'Claimed':
            case 'Approved':
            case 'C':
            case 'Competent':
            case 'Pass':
            case 'Success':
            case 'Successful':
            case 'Full Payment':
                return 'bg-green-100 text-green-800 border-green-200';
            case 'Processing':
                return 'bg-blue-100 text-blue-800 border-blue-200';
            case 'Pending':
            case 'In Progress':
            case 'Pending Assessment':
                return 'bg-yellow-100 text-yellow-800 border-yellow-200';
            case 'Overdue':
            case 'Rejected':
            case 'Unpaid':
            case 'NYC':
            case 'Not Yet Competent':
            case 'Fail':
            case 'Failed':
                return 'bg-red-100 text-red-800 border-red-200';
            default:
                return 'bg-gray-100 text-gray-800 border-gray-200';
        }
    };

    const inputClasses = "block w-full px-3 py-2 text-on-surface bg-white border border-gray-300 rounded-md shadow-sm placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent dark:bg-gray-700 dark:border-gray-600 dark:text-white dark:placeholder-gray-500";

    const handleSearch = async () => {
        if (!courseRunId.trim()) {
            setSearchError('Please enter Course Run ID');
            return;
        }

        setIsSearching(true);
        setSearchError(null);
        setGrantsData(null);
        setCurrentPage(0);

        try {
            console.log('🔍 Searching grants for course run:', courseRunId.trim());

            const response = await fetch(getApiUrl('/api/grants/search'), {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ courseRunId: courseRunId.trim() }),
            });

            const json = await response.json();

            if (!json.success) {
                setSearchError(json.error || `SSG error ${response.status}`);
                return;
            }

            console.log('✅ Grants data:', json);
            setGrantsData({ data: json.data ?? [], meta: json.meta ?? {} });
        } catch (error) {
            console.error('❌ Error searching grants:', error);
            setSearchError('Failed to connect to SSG. Please check your connection and try again.');
        } finally {
            setIsSearching(false);
        }
    };

    return (
        <div>
            <h2 className="text-3xl font-bold mb-6 dark:text-white">Search Grant</h2>

            {/* Search Bar Card */}
            <Card className="p-6 mb-6">
                <div>
                    <h3 className="text-lg font-bold text-gray-700 dark:text-gray-200 mb-4">Grant Search Parameters</h3>

                    <div className="mb-4">
                        <label htmlFor="course-run-id" className="block text-sm font-bold text-gray-700 dark:text-gray-300 mb-1">
                            Course Run ID
                        </label>
                        <input
                            id="course-run-id"
                            type="text"
                            value={courseRunId}
                            onChange={(e) => setCourseRunId(e.target.value)}
                            placeholder="e.g. 1234567"
                            className={inputClasses}
                            disabled={isSearching}
                        />
                    </div>

                    <div className="flex justify-end">
                        <Button
                            onClick={handleSearch}
                            disabled={isSearching || !courseRunId.trim()}
                            className="whitespace-nowrap"
                        >
                            {isSearching ? (
                                <div className="flex items-center">
                                    <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white mr-2"></div>
                                    Searching...
                                </div>
                            ) : (
                                <>
                                    <Icon name={IconName.Search} className="w-4 h-4 mr-2" />
                                    Search Grant
                                </>
                            )}
                        </Button>
                    </div>

                    {searchError && (
                        <p className="text-red-500 text-sm mt-3">{searchError}</p>
                    )}
                </div>
            </Card>

            {/* Loading State */}
            {isSearching && (
                <div className="flex justify-center py-10">
                    <div className="text-center">
                        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-500 mx-auto"></div>
                        <p className="mt-4 text-gray-600 dark:text-gray-400">Fetching grant details from SSG...</p>
                    </div>
                </div>
            )}

            {/* Results Display */}
            {grantsData && !isSearching && (
                <Card className="p-0">
                    <div className="p-6 border-b dark:border-gray-700">
                        <h3 className="text-xl font-bold dark:text-white">Grant Search Results</h3>
                        <p className="text-gray-500 dark:text-gray-400 mt-1">Course Run ID: {courseRunId}</p>
                    </div>
                    <div className="p-6">
                        {Array.isArray(grantsData.data) && grantsData.data.length > 0 ? (() => {
                            // Group grants by enrolment reference number
                            const grouped: Record<string, any[]> = {};
                            for (const item of grantsData.data) {
                                const enrolKey = item.enrolment?.referenceNumber || 'Unknown';
                                if (!grouped[enrolKey]) grouped[enrolKey] = [];
                                grouped[enrolKey].push(item);
                            }
                            const BL_CODES = ['Baseline', 'BL'];
                            const rows = Object.entries(grouped);
                            const totalPages = Math.ceil(rows.length / PAGE_SIZE);
                            const pagedRows = rows.slice(currentPage * PAGE_SIZE, (currentPage + 1) * PAGE_SIZE);

                            return (
                                <div className="space-y-3">
                                    {/* Summary */}
                                    <div className="flex items-center bg-blue-50 dark:bg-blue-900/30 px-4 py-2 rounded-lg border border-blue-100 dark:border-blue-800 text-sm">
                                        <span className="font-bold text-blue-900 dark:text-blue-300 mr-3">
                                            {rows.length} Enrolment{rows.length !== 1 ? 's' : ''} &nbsp;·&nbsp; {grantsData.meta?.totalRecords ?? grantsData.data.length} Grant{(grantsData.meta?.totalRecords ?? grantsData.data.length) !== 1 ? 's' : ''}
                                        </span>
                                        <span className="text-blue-700 dark:text-blue-400">Course Run: <span className="font-mono">{courseRunId}</span></span>
                                    </div>

                                    {/* Desktop table */}
                                    <div className="hidden md:block overflow-x-auto rounded-lg border border-gray-200 dark:border-gray-700">
                                        <table className="min-w-full divide-y divide-gray-200 dark:divide-gray-700 text-xs">
                                            <thead className="bg-gray-50 dark:bg-gray-700">
                                                <tr>
                                                    <th className="px-3 py-2 text-center text-xs font-semibold text-gray-600 dark:text-gray-300 border-r border-gray-200 dark:border-gray-600 uppercase tracking-wider">Enrolment</th>
                                                    <th colSpan={3} className="px-3 py-2 text-center text-xs font-semibold text-blue-700 dark:text-blue-400 border-r border-gray-200 dark:border-gray-600 uppercase tracking-wider bg-blue-50 dark:bg-blue-900/20">Baseline (BL)</th>
                                                    <th colSpan={4} className="px-3 py-2 text-center text-xs font-semibold text-purple-700 dark:text-purple-400 border-r border-gray-200 dark:border-gray-600 uppercase tracking-wider bg-purple-50 dark:bg-purple-900/20">MCES / SME / IBF</th>
                                                    <th className="px-3 py-2 text-center text-xs font-semibold text-green-700 dark:text-green-400 uppercase tracking-wider bg-green-50 dark:bg-green-900/20">Total</th>
                                                </tr>
                                                <tr>
                                                    <th className="px-3 py-2 text-left font-medium text-gray-500 dark:text-gray-400 whitespace-nowrap border-r border-gray-200 dark:border-gray-600">Enrolment ID</th>
                                                    <th className="px-3 py-2 text-left font-medium text-blue-600 dark:text-blue-400 whitespace-nowrap bg-blue-50 dark:bg-blue-900/20">Grant Status</th>
                                                    <th className="px-3 py-2 text-left font-medium text-blue-600 dark:text-blue-400 whitespace-nowrap bg-blue-50 dark:bg-blue-900/20">Grant ID (BL)</th>
                                                    <th className="px-3 py-2 text-left font-medium text-blue-600 dark:text-blue-400 whitespace-nowrap border-r border-gray-200 dark:border-gray-600 bg-blue-50 dark:bg-blue-900/20">Amount (BL)</th>
                                                    <th className="px-3 py-2 text-left font-medium text-purple-600 dark:text-purple-400 whitespace-nowrap bg-purple-50 dark:bg-purple-900/20">Grant Status</th>
                                                    <th className="px-3 py-2 text-left font-medium text-purple-600 dark:text-purple-400 whitespace-nowrap bg-purple-50 dark:bg-purple-900/20">Grant ID</th>
                                                    <th className="px-3 py-2 text-left font-medium text-purple-600 dark:text-purple-400 whitespace-nowrap bg-purple-50 dark:bg-purple-900/20">Scheme Code</th>
                                                    <th className="px-3 py-2 text-left font-medium text-purple-600 dark:text-purple-400 whitespace-nowrap border-r border-gray-200 dark:border-gray-600 bg-purple-50 dark:bg-purple-900/20">Amount</th>
                                                    <th className="px-3 py-2 text-left font-medium text-green-700 dark:text-green-400 whitespace-nowrap bg-green-50 dark:bg-green-900/20">TG Amount</th>
                                                </tr>
                                            </thead>
                                            <tbody className="bg-white dark:bg-gray-800 divide-y divide-gray-200 dark:divide-gray-700">
                                                {pagedRows.map(([enrolmentId, grants]) => {
                                                    const bl      = grants.find((g: any) => BL_CODES.includes(g.fundingScheme?.code));
                                                    const mces    = grants.find((g: any) => !BL_CODES.includes(g.fundingScheme?.code));
                                                    const totalTG = grants.reduce((sum: number, g: any) => sum + (g.grantAmount?.estimated ?? 0), 0);
                                                    return (
                                                        <tr key={enrolmentId} className="hover:bg-gray-50 dark:hover:bg-gray-700/50">
                                                            <td className="px-3 py-3 font-mono text-gray-800 dark:text-gray-200 whitespace-nowrap border-r border-gray-200 dark:border-gray-700">{enrolmentId}</td>
                                                            <td className="px-3 py-3 whitespace-nowrap bg-blue-50/30 dark:bg-blue-900/10">
                                                                {bl ? <span className={`inline-flex px-2 py-0.5 text-xs font-semibold rounded-full border ${getStatusColor(bl.status)}`}>{bl.status}</span> : <span className="text-gray-400">—</span>}
                                                            </td>
                                                            <td className="px-3 py-3 font-mono text-gray-700 dark:text-gray-300 whitespace-nowrap bg-blue-50/30 dark:bg-blue-900/10">{bl?.referenceNumber || '—'}</td>
                                                            <td className="px-3 py-3 text-gray-700 dark:text-gray-300 whitespace-nowrap border-r border-gray-200 dark:border-gray-700 bg-blue-50/30 dark:bg-blue-900/10">{bl ? `$${(bl.grantAmount?.estimated ?? 0).toFixed(2)}` : '—'}</td>
                                                            <td className="px-3 py-3 whitespace-nowrap bg-purple-50/30 dark:bg-purple-900/10">
                                                                {mces ? <span className={`inline-flex px-2 py-0.5 text-xs font-semibold rounded-full border ${getStatusColor(mces.status)}`}>{mces.status}</span> : <span className="text-gray-400">—</span>}
                                                            </td>
                                                            <td className="px-3 py-3 font-mono text-gray-700 dark:text-gray-300 whitespace-nowrap bg-purple-50/30 dark:bg-purple-900/10">{mces?.referenceNumber || '—'}</td>
                                                            <td className="px-3 py-3 whitespace-nowrap bg-purple-50/30 dark:bg-purple-900/10">
                                                                {mces ? <span className="font-mono text-xs bg-purple-100 dark:bg-purple-900/40 text-purple-800 dark:text-purple-300 px-1.5 py-0.5 rounded">{mces.fundingScheme?.code}</span> : '—'}
                                                            </td>
                                                            <td className="px-3 py-3 text-gray-700 dark:text-gray-300 whitespace-nowrap border-r border-gray-200 dark:border-gray-700 bg-purple-50/30 dark:bg-purple-900/10">{mces ? `$${(mces.grantAmount?.estimated ?? 0).toFixed(2)}` : '—'}</td>
                                                            <td className="px-3 py-3 font-bold text-green-700 dark:text-green-400 whitespace-nowrap bg-green-50/30 dark:bg-green-900/10">${totalTG.toFixed(2)}</td>
                                                        </tr>
                                                    );
                                                })}
                                            </tbody>
                                        </table>
                                    </div>

                                    {/* Mobile cards */}
                                    <div className="md:hidden space-y-4">
                                        {pagedRows.map(([enrolmentId, grants]) => {
                                            const bl      = grants.find((g: any) => BL_CODES.includes(g.fundingScheme?.code));
                                            const mces    = grants.find((g: any) => !BL_CODES.includes(g.fundingScheme?.code));
                                            const totalTG = grants.reduce((sum: number, g: any) => sum + (g.grantAmount?.estimated ?? 0), 0);
                                            return (
                                                <div key={enrolmentId} className="border border-gray-200 dark:border-gray-700 rounded-lg overflow-hidden">
                                                    {/* Enrolment header */}
                                                    <div className="bg-gray-50 dark:bg-gray-700 px-4 py-2 flex items-center justify-between">
                                                        <span className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase">Enrolment ID</span>
                                                        <span className="font-mono text-sm font-bold text-gray-800 dark:text-white">{enrolmentId}</span>
                                                    </div>
                                                    <div className="divide-y divide-gray-100 dark:divide-gray-700">
                                                        {/* BL section */}
                                                        <div className="bg-blue-50/50 dark:bg-blue-900/10 px-4 py-3">
                                                            <p className="text-xs font-bold text-blue-700 dark:text-blue-400 uppercase mb-2">Baseline (BL)</p>
                                                            {bl ? (
                                                                <div className="grid grid-cols-2 gap-2 text-sm">
                                                                    <div>
                                                                        <p className="text-xs text-gray-500 dark:text-gray-400">Status</p>
                                                                        <span className={`inline-flex mt-0.5 px-2 py-0.5 text-xs font-semibold rounded-full border ${getStatusColor(bl.status)}`}>{bl.status}</span>
                                                                    </div>
                                                                    <div>
                                                                        <p className="text-xs text-gray-500 dark:text-gray-400">Amount</p>
                                                                        <p className="font-semibold text-gray-800 dark:text-gray-200">${(bl.grantAmount?.estimated ?? 0).toFixed(2)}</p>
                                                                    </div>
                                                                    <div className="col-span-2">
                                                                        <p className="text-xs text-gray-500 dark:text-gray-400">Grant ID</p>
                                                                        <p className="font-mono text-xs text-gray-700 dark:text-gray-300">{bl.referenceNumber}</p>
                                                                    </div>
                                                                </div>
                                                            ) : <p className="text-sm text-gray-400">—</p>}
                                                        </div>
                                                        {/* MCES section */}
                                                        <div className="bg-purple-50/50 dark:bg-purple-900/10 px-4 py-3">
                                                            <p className="text-xs font-bold text-purple-700 dark:text-purple-400 uppercase mb-2">MCES / SME / IBF</p>
                                                            {mces ? (
                                                                <div className="grid grid-cols-2 gap-2 text-sm">
                                                                    <div>
                                                                        <p className="text-xs text-gray-500 dark:text-gray-400">Status</p>
                                                                        <span className={`inline-flex mt-0.5 px-2 py-0.5 text-xs font-semibold rounded-full border ${getStatusColor(mces.status)}`}>{mces.status}</span>
                                                                    </div>
                                                                    <div>
                                                                        <p className="text-xs text-gray-500 dark:text-gray-400">Scheme Code</p>
                                                                        <span className="inline-flex mt-0.5 font-mono text-xs bg-purple-100 dark:bg-purple-900/40 text-purple-800 dark:text-purple-300 px-1.5 py-0.5 rounded">{mces.fundingScheme?.code}</span>
                                                                    </div>
                                                                    <div>
                                                                        <p className="text-xs text-gray-500 dark:text-gray-400">Amount</p>
                                                                        <p className="font-semibold text-gray-800 dark:text-gray-200">${(mces.grantAmount?.estimated ?? 0).toFixed(2)}</p>
                                                                    </div>
                                                                    <div>
                                                                        <p className="text-xs text-gray-500 dark:text-gray-400">Grant ID</p>
                                                                        <p className="font-mono text-xs text-gray-700 dark:text-gray-300">{mces.referenceNumber}</p>
                                                                    </div>
                                                                </div>
                                                            ) : <p className="text-sm text-gray-400">—</p>}
                                                        </div>
                                                        {/* Total */}
                                                        <div className="bg-green-50/50 dark:bg-green-900/10 px-4 py-3 flex items-center justify-between">
                                                            <span className="text-xs font-bold text-green-700 dark:text-green-400 uppercase">Total TG Amount</span>
                                                            <span className="text-base font-bold text-green-700 dark:text-green-400">${totalTG.toFixed(2)}</span>
                                                        </div>
                                                    </div>
                                                </div>
                                            );
                                        })}
                                    </div>

                                    {/* Pagination */}
                                    {totalPages > 1 && (
                                        <div className="flex items-center justify-between pt-2">
                                            <p className="text-xs text-gray-500 dark:text-gray-400">
                                                Showing {currentPage * PAGE_SIZE + 1}–{Math.min((currentPage + 1) * PAGE_SIZE, rows.length)} of {rows.length} enrolments
                                            </p>
                                            <div className="flex items-center gap-1">
                                                <button
                                                    onClick={() => setCurrentPage(0)}
                                                    disabled={currentPage === 0}
                                                    className="px-2 py-1 text-xs rounded border border-gray-300 dark:border-gray-600 disabled:opacity-40 disabled:cursor-not-allowed hover:bg-gray-100 dark:hover:bg-gray-700 dark:text-gray-300"
                                                >«</button>
                                                <button
                                                    onClick={() => setCurrentPage(p => Math.max(0, p - 1))}
                                                    disabled={currentPage === 0}
                                                    className="px-2 py-1 text-xs rounded border border-gray-300 dark:border-gray-600 disabled:opacity-40 disabled:cursor-not-allowed hover:bg-gray-100 dark:hover:bg-gray-700 dark:text-gray-300"
                                                >‹</button>
                                                {Array.from({ length: totalPages }, (_, i) => i).filter(i =>
                                                    i === 0 || i === totalPages - 1 || Math.abs(i - currentPage) <= 1
                                                ).reduce<(number | string)[]>((acc, i, idx, arr) => {
                                                    if (idx > 0 && (i as number) - (arr[idx - 1] as number) > 1) acc.push('…');
                                                    acc.push(i);
                                                    return acc;
                                                }, []).map((item, idx) =>
                                                    item === '…' ? (
                                                        <span key={`ellipsis-${idx}`} className="px-1 text-xs text-gray-400">…</span>
                                                    ) : (
                                                        <button
                                                            key={item}
                                                            onClick={() => setCurrentPage(item as number)}
                                                            className={`px-2.5 py-1 text-xs rounded border ${currentPage === item ? 'bg-blue-600 text-white border-blue-600' : 'border-gray-300 dark:border-gray-600 hover:bg-gray-100 dark:hover:bg-gray-700 dark:text-gray-300'}`}
                                                        >{(item as number) + 1}</button>
                                                    )
                                                )}
                                                <button
                                                    onClick={() => setCurrentPage(p => Math.min(totalPages - 1, p + 1))}
                                                    disabled={currentPage === totalPages - 1}
                                                    className="px-2 py-1 text-xs rounded border border-gray-300 dark:border-gray-600 disabled:opacity-40 disabled:cursor-not-allowed hover:bg-gray-100 dark:hover:bg-gray-700 dark:text-gray-300"
                                                >›</button>
                                                <button
                                                    onClick={() => setCurrentPage(totalPages - 1)}
                                                    disabled={currentPage === totalPages - 1}
                                                    className="px-2 py-1 text-xs rounded border border-gray-300 dark:border-gray-600 disabled:opacity-40 disabled:cursor-not-allowed hover:bg-gray-100 dark:hover:bg-gray-700 dark:text-gray-300"
                                                >»</button>
                                            </div>
                                        </div>
                                    )}
                                </div>
                            );
                        })() : (
                            <div className="bg-yellow-50 dark:bg-yellow-900/20 border border-yellow-200 dark:border-yellow-700 rounded-lg p-8 text-center">
                                <Icon name={IconName.InfoCircle} className="w-12 h-12 mx-auto text-yellow-500 dark:text-yellow-400 mb-3" />
                                <h4 className="text-lg font-bold text-yellow-800 dark:text-yellow-300 mb-2">No Records Found</h4>
                                <p className="text-yellow-700 dark:text-yellow-400">
                                    No grant records were returned for this Course Run ID.
                                </p>
                            </div>
                        )}

                        <details className="mt-6 bg-gray-50 dark:bg-gray-700 border border-gray-200 dark:border-gray-600 rounded-lg p-4">
                            <summary className="font-semibold text-gray-800 dark:text-gray-200 cursor-pointer hover:text-gray-600 dark:hover:text-gray-400">
                                View Raw JSON Response
                            </summary>
                            <pre className="mt-3 text-sm text-gray-700 dark:text-gray-300 whitespace-pre-wrap overflow-x-auto max-h-96 bg-white dark:bg-gray-800 p-3 rounded border dark:border-gray-600">
                                {JSON.stringify(grantsData, null, 2)}
                            </pre>
                        </details>

                        <div className="mt-6 flex justify-end">
                            <Button
                                variant="outline"
                                onClick={() => {
                                    setGrantsData(null);
                                    setCourseRunId('');
                                }}
                            >
                                Clear Results
                            </Button>
                        </div>
                    </div>
                </Card>
            )}

            {/* Empty State */}
            {!grantsData && !isSearching && (
                <Card className="p-12">
                    <div className="text-center text-gray-500 dark:text-gray-400">
                        <Icon name={IconName.Search} className="w-16 h-16 mx-auto mb-4 text-gray-400" />
                        <p className="text-lg font-medium">Enter details to search</p>
                        <p className="text-sm mt-2">Provide Course Run ID to fetch grant details</p>
                    </div>
                </Card>
            )}
        </div>
    );
};

export const SearchEnrolmentView: React.FC = () => {
    const [courseRunId, setCourseRunId] = useState<string>('');
    const [isSearching, setIsSearching] = useState(false);
    const [webhookResponse, setWebhookResponse] = useState<any>(null);
    const [parsedData, setParsedData] = useState<any>(null);
    const [searchError, setSearchError] = useState<string | null>(null);

    const SEARCH_ENROLMENT_API = '/api/enrolment/search';

    const inputClasses = "block w-full px-3 py-2 text-on-surface bg-white border border-gray-300 rounded-md shadow-sm placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent dark:bg-gray-700 dark:border-gray-600 dark:text-white dark:placeholder-gray-500";

    const getEnrolmentStatusColor = (status: string) => {
        switch (status) {
            case 'Confirmed':
            case 'Completed':
                return 'bg-green-100 text-green-800 border-green-200';
            case 'Pending':
            case 'Pending Payment':
                return 'bg-yellow-100 text-yellow-800 border-yellow-200';
            case 'Cancelled':
            case 'Rejected':
                return 'bg-red-100 text-red-800 border-red-200';
            default:
                return 'bg-gray-100 text-gray-800 border-gray-200';
        }
    };

    const handleSearch = async () => {
        if (!courseRunId.trim()) {
            setSearchError('Please enter Course Run ID');
            return;
        }

        setIsSearching(true);
        setSearchError(null);
        setWebhookResponse(null);
        setParsedData(null);

        try {
            const response = await fetch(SEARCH_ENROLMENT_API, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ courseRunId: courseRunId.trim() })
            });

            const json = await response.json();

            if (!response.ok || !json.success) {
                const errMsg = typeof json.error === 'string' ? json.error : (json.error?.message ?? JSON.stringify(json.error) ?? `SSG API error (${response.status})`);
                throw new Error(errMsg);
            }

            console.log('✅ Search enrolment response:', json);
            setWebhookResponse(json);

            // data is the decrypted SSG payload: { data: [...], meta: {...} }
            const resultData = json.data;
            setParsedData(resultData ?? null);
        } catch (error) {
            console.error('❌ Search enrolment error:', error);
            setSearchError(error instanceof Error ? error.message : 'Failed to fetch enrolment data');
        } finally {
            setIsSearching(false);
        }
    };

    return (
        <div>
            <h2 className="text-3xl font-bold mb-6 dark:text-white">Search Enrolment</h2>

            {/* Search Bar Card */}
            <Card className="p-6 mb-6">
                <div>
                    <h3 className="text-lg font-bold text-gray-700 dark:text-gray-200 mb-4">Enrolment Search Parameters</h3>

                    <div className="flex gap-3 items-end">
                        <div className="flex-1">
                            <label htmlFor="enrolment-course-run-id" className="block text-sm font-bold text-gray-700 dark:text-gray-300 mb-1">
                                Course Run ID
                            </label>
                            <input
                                id="enrolment-course-run-id"
                                type="text"
                                value={courseRunId}
                                onChange={(e) => setCourseRunId(e.target.value)}
                                onKeyDown={(e) => e.key === 'Enter' && !isSearching && courseRunId.trim() && handleSearch()}
                                placeholder="e.g. 1068286"
                                className={inputClasses}
                                disabled={isSearching}
                            />
                        </div>
                        <Button
                            onClick={handleSearch}
                            disabled={isSearching || !courseRunId.trim()}
                            className="whitespace-nowrap"
                        >
                            {isSearching ? (
                                <div className="flex items-center">
                                    <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white mr-2"></div>
                                    Searching...
                                </div>
                            ) : (
                                <>
                                    <Icon name={IconName.Search} className="w-4 h-4 mr-2" />
                                    Search Enrolment
                                </>
                            )}
                        </Button>
                    </div>

                    {searchError && (
                        <p className="text-red-500 text-sm mt-3">{searchError}</p>
                    )}
                </div>
            </Card>

            {/* Loading State */}
            {isSearching && (
                <div className="flex justify-center py-10">
                    <div className="text-center">
                        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-500 mx-auto"></div>
                        <p className="mt-4 text-gray-600 dark:text-gray-400">Fetching enrolment details from SSG...</p>
                    </div>
                </div>
            )}

            {/* Webhook Response Display */}
            {webhookResponse && !isSearching && (
                <Card className="p-0">
                    <div className="p-6 border-b dark:border-gray-700">
                        <h3 className="text-xl font-bold dark:text-white">Enrolment Search Results</h3>
                        <p className="text-gray-500 dark:text-gray-400 mt-1">
                            Course Run ID: {courseRunId}
                        </p>
                    </div>
                    <div className="p-6">
                        {Array.isArray(parsedData) && parsedData.length > 0 ? (
                            <div className="space-y-6">
                                <div className="flex justify-between items-center bg-blue-50 dark:bg-blue-900/30 p-4 rounded-lg border border-blue-100 dark:border-blue-800">
                                    <div>
                                        <h4 className="font-bold text-blue-900 dark:text-blue-300">Total Records Found: {parsedData.length}</h4>
                                        <p className="text-sm text-blue-700 dark:text-blue-400">Course: {parsedData[0]?.enrolment?.course?.title || 'N/A'}</p>
                                    </div>
                                </div>

                                <div className="overflow-x-auto border border-gray-200 dark:border-gray-700 rounded-lg shadow-sm">
                                    <table className="min-w-full divide-y divide-gray-200 dark:divide-gray-700">
                                        <thead className="bg-gray-50 dark:bg-gray-700">
                                            <tr>
                                                <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-300 uppercase tracking-wider">Course Run ID</th>
                                                <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-300 uppercase tracking-wider">Start Date</th>
                                                <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-300 uppercase tracking-wider">End Date</th>
                                                <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-300 uppercase tracking-wider">Enrolment Ref</th>
                                                <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-300 uppercase tracking-wider">Trainee Name</th>
                                                <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-300 uppercase tracking-wider">NRIC</th>
                                                <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-300 uppercase tracking-wider">Email</th>
                                                <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-300 uppercase tracking-wider">Sponsorship</th>
                                                <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-300 uppercase tracking-wider">Employer</th>
                                                <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-300 uppercase tracking-wider">Status</th>
                                                <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-300 uppercase tracking-wider">Payment</th>
                                                <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-300 uppercase tracking-wider">Enrolment Date</th>
                                            </tr>
                                        </thead>
                                        <tbody className="bg-white dark:bg-gray-800 divide-y divide-gray-200 dark:divide-gray-700">
                                            {parsedData.map((item: any, index: number) => {
                                                const enrolment = item.enrolment || {};
                                                const course = enrolment.course || {};
                                                const courseRun = course.run || {};
                                                const trainee = enrolment.trainee || {};
                                                const employer = trainee.employer || {};
                                                return (
                                                    <tr key={index} className="hover:bg-gray-50 dark:hover:bg-gray-700">
                                                        <td className="px-6 py-4 whitespace-nowrap text-sm font-medium text-blue-600 dark:text-blue-400">
                                                            {courseRun.id || 'N/A'}
                                                        </td>
                                                        <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500 dark:text-gray-300">
                                                            {courseRun.startDate || 'N/A'}
                                                        </td>
                                                        <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500 dark:text-gray-300">
                                                            {courseRun.endDate || 'N/A'}
                                                        </td>
                                                        <td className="px-6 py-4 whitespace-nowrap text-sm font-medium text-gray-900 dark:text-white">
                                                            {enrolment.referenceNumber || 'N/A'}
                                                        </td>
                                                        <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900 dark:text-white">
                                                            {trainee.fullName || 'N/A'}
                                                        </td>
                                                        <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500 dark:text-gray-300">
                                                            {trainee.id || 'N/A'}
                                                        </td>
                                                        <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500 dark:text-gray-300">
                                                            {trainee.email?.full || 'N/A'}
                                                        </td>
                                                        <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500 dark:text-gray-300">
                                                            {trainee.sponsorshipType || 'N/A'}
                                                        </td>
                                                        <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500 dark:text-gray-300">
                                                            {employer.name || '-'}
                                                        </td>
                                                        <td className="px-6 py-4 whitespace-nowrap">
                                                            <span className={`inline-flex px-2 text-xs leading-5 font-semibold rounded-full border ${getEnrolmentStatusColor(enrolment.status || 'Pending')}`}>
                                                                {enrolment.status || 'Pending'}
                                                            </span>
                                                        </td>
                                                        <td className="px-6 py-4 whitespace-nowrap">
                                                            <span className={`inline-flex px-2 text-xs leading-5 font-semibold rounded-full border ${getEnrolmentStatusColor(trainee.fees?.collectionStatus || 'Pending')}`}>
                                                                {trainee.fees?.collectionStatus || 'N/A'}
                                                            </span>
                                                        </td>
                                                        <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500 dark:text-gray-300">
                                                            {trainee.enrolmentDate || 'N/A'}
                                                        </td>
                                                    </tr>
                                                );
                                            })}
                                        </tbody>
                                    </table>
                                </div>
                            </div>
                        ) : (
                            <div className="bg-yellow-50 dark:bg-yellow-900/20 border border-yellow-200 dark:border-yellow-700 rounded-lg p-8 text-center">
                                <Icon name={IconName.InfoCircle} className="w-12 h-12 mx-auto text-yellow-500 dark:text-yellow-400 mb-3" />
                                <h4 className="text-lg font-bold text-yellow-800 dark:text-yellow-300 mb-2">No Records Found</h4>
                                <p className="text-yellow-700 dark:text-yellow-400">
                                    No enrolment records were returned for this Course Run ID.
                                </p>
                            </div>
                        )}

                        <details className="mt-6 bg-gray-50 dark:bg-gray-700 border border-gray-200 dark:border-gray-600 rounded-lg p-4">
                            <summary className="font-semibold text-gray-800 dark:text-gray-200 cursor-pointer hover:text-gray-600 dark:hover:text-gray-400">
                                View Raw JSON Response
                            </summary>
                            <pre className="mt-3 text-sm text-gray-700 dark:text-gray-300 whitespace-pre-wrap overflow-x-auto max-h-96 bg-white dark:bg-gray-800 p-3 rounded border dark:border-gray-600">
                                {JSON.stringify(webhookResponse, null, 2)}
                            </pre>
                        </details>

                        <div className="mt-6 flex justify-end">
                            <Button
                                variant="outline"
                                onClick={() => {
                                    setWebhookResponse(null);
                                    setParsedData(null);
                                    setCourseRunId('');
                                }}
                            >
                                Clear Results
                            </Button>
                        </div>
                    </div>
                </Card>
            )}

            {/* Empty State */}
            {!webhookResponse && !isSearching && (
                <Card className="p-12">
                    <div className="text-center text-gray-500 dark:text-gray-400">
                        <Icon name={IconName.Search} className="w-16 h-16 mx-auto mb-4 text-gray-400" />
                        <p className="text-lg font-medium">Enter Course Run ID to search</p>
                        <p className="text-sm mt-2">Provide a Course Run ID to fetch enrolment details from SSG</p>
                    </div>
                </Card>
            )}
        </div>
    );
};

export const ViewEnrolmentView: React.FC = () => {
    const [enrolmentId, setEnrolmentId] = useState<string>('');
    const [isSearching, setIsSearching] = useState(false);
    const [webhookResponse, setWebhookResponse] = useState<any>(null);
    const [parsedData, setParsedData] = useState<any>(null);
    const [searchError, setSearchError] = useState<string | null>(null);

    const VIEW_ENROLMENT_API = '/api/enrolment/view';

    const inputClasses = "block w-full px-3 py-2 text-on-surface bg-white border border-gray-300 rounded-md shadow-sm placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent dark:bg-gray-700 dark:border-gray-600 dark:text-white dark:placeholder-gray-500";

    const getEnrolmentStatusColor = (status: string) => {
        switch (status) {
            case 'Confirmed':
            case 'Completed':
                return 'bg-green-100 text-green-800 border-green-200';
            case 'Pending':
            case 'Pending Payment':
                return 'bg-yellow-100 text-yellow-800 border-yellow-200';
            case 'Cancelled':
            case 'Rejected':
                return 'bg-red-100 text-red-800 border-red-200';
            default:
                return 'bg-gray-100 text-gray-800 border-gray-200';
        }
    };

    const handleSearch = async () => {
        if (!enrolmentId.trim()) {
            setSearchError('Please enter Enrolment ID');
            return;
        }

        setIsSearching(true);
        setSearchError(null);
        setWebhookResponse(null);
        setParsedData(null);

        try {
            console.log('🔍 Fetching enrolment:', enrolmentId.trim());

            const response = await fetch(`${VIEW_ENROLMENT_API}?enrolmentId=${encodeURIComponent(enrolmentId.trim())}`);

            if (!response.ok) {
                const err = await response.json().catch(() => ({}));
                throw new Error(err?.error?.message || err?.error || `SSG API error (${response.status})`);
            }

            const data = await response.json();
            console.log('✅ View enrolment response:', data);
            setWebhookResponse(data);
            setParsedData(data.data ?? null);
        } catch (error) {
            console.error('❌ Error viewing enrolment:', error);
            setSearchError(error instanceof Error ? error.message : 'Failed to fetch enrolment data');
        } finally {
            setIsSearching(false);
        }
    };

    // Helper to render enrolment details
    const renderEnrolmentDetails = () => {
        if (!parsedData) return null;

        // Handle single enrolment response (data is the enrolment object directly)
        const enrolmentData = parsedData.data?.enrolment || parsedData.enrolment || parsedData.data;
        if (!enrolmentData) return null;

        const enrolment = enrolmentData.enrolment || enrolmentData;
        const course = enrolment.course || {};
        const courseRun = course.run || {};
        const trainee = enrolment.trainee || {};
        const employer = trainee.employer || {};
        const trainingPartner = enrolment.trainingPartner || {};

        return (
            <div className="space-y-6">
                {/* Enrolment Summary */}
                <div className="bg-blue-50 dark:bg-blue-900/30 p-4 rounded-lg border border-blue-100 dark:border-blue-800">
                    <h4 className="font-bold text-blue-900 dark:text-blue-300 text-lg">Enrolment: {enrolment.referenceNumber || enrolmentId}</h4>
                    <p className="text-sm text-blue-700 dark:text-blue-400 mt-1">
                        Status: <span className={`inline-flex px-2 py-0.5 text-xs font-semibold rounded-full border ${getEnrolmentStatusColor(enrolment.status || 'Pending')}`}>
                            {enrolment.status || 'Pending'}
                        </span>
                    </p>
                </div>

                {/* Course Information */}
                <Card className="p-4">
                    <h5 className="font-bold text-gray-800 dark:text-gray-200 mb-3">Course Information</h5>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-sm">
                        <div>
                            <span className="text-gray-500 dark:text-gray-400">Course Title:</span>
                            <p className="font-medium text-gray-900 dark:text-white">{course.title || 'N/A'}</p>
                        </div>
                        <div>
                            <span className="text-gray-500 dark:text-gray-400">Course Reference:</span>
                            <p className="font-medium text-gray-900 dark:text-white">{course.referenceNumber || 'N/A'}</p>
                        </div>
                        <div>
                            <span className="text-gray-500 dark:text-gray-400">Course Run ID:</span>
                            <p className="font-medium text-blue-600 dark:text-blue-400">{courseRun.id || 'N/A'}</p>
                        </div>
                        <div>
                            <span className="text-gray-500 dark:text-gray-400">Start Date:</span>
                            <p className="font-medium text-gray-900 dark:text-white">{courseRun.startDate || 'N/A'}</p>
                        </div>
                        <div>
                            <span className="text-gray-500 dark:text-gray-400">End Date:</span>
                            <p className="font-medium text-gray-900 dark:text-white">{courseRun.endDate || 'N/A'}</p>
                        </div>
                    </div>
                </Card>

                {/* Trainee Information */}
                <Card className="p-4">
                    <h5 className="font-bold text-gray-800 dark:text-gray-200 mb-3">Trainee Information</h5>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-sm">
                        <div>
                            <span className="text-gray-500 dark:text-gray-400">Full Name:</span>
                            <p className="font-medium text-gray-900 dark:text-white">{trainee.fullName || 'N/A'}</p>
                        </div>
                        <div>
                            <span className="text-gray-500 dark:text-gray-400">NRIC:</span>
                            <p className="font-medium text-gray-900 dark:text-white">{trainee.id || 'N/A'}</p>
                        </div>
                        <div>
                            <span className="text-gray-500 dark:text-gray-400">Date of Birth:</span>
                            <p className="font-medium text-gray-900 dark:text-white">{trainee.dateOfBirth || 'N/A'}</p>
                        </div>
                        <div>
                            <span className="text-gray-500 dark:text-gray-400">Email:</span>
                            <p className="font-medium text-gray-900 dark:text-white">{trainee.email?.full || 'N/A'}</p>
                        </div>
                        <div>
                            <span className="text-gray-500 dark:text-gray-400">Contact Number:</span>
                            <p className="font-medium text-gray-900 dark:text-white">
                                {trainee.contactNumber ? `${trainee.contactNumber.countryCode || ''} ${trainee.contactNumber.phoneNumber || ''}`.trim() || 'N/A' : 'N/A'}
                            </p>
                        </div>
                        <div>
                            <span className="text-gray-500 dark:text-gray-400">Sponsorship Type:</span>
                            <p className="font-medium text-gray-900 dark:text-white">{trainee.sponsorshipType || 'N/A'}</p>
                        </div>
                        <div>
                            <span className="text-gray-500 dark:text-gray-400">Enrolment Date:</span>
                            <p className="font-medium text-gray-900 dark:text-white">{trainee.enrolmentDate || 'N/A'}</p>
                        </div>
                        <div>
                            <span className="text-gray-500 dark:text-gray-400">Payment Status:</span>
                            <p className="font-medium">
                                <span className={`inline-flex px-2 py-0.5 text-xs font-semibold rounded-full border ${getEnrolmentStatusColor(trainee.fees?.collectionStatus || 'Pending')}`}>
                                    {trainee.fees?.collectionStatus || 'N/A'}
                                </span>
                            </p>
                        </div>
                    </div>
                </Card>

                {/* Employer Information (if applicable) */}
                {employer.name && (
                    <Card className="p-4">
                        <h5 className="font-bold text-gray-800 dark:text-gray-200 mb-3">Employer Information</h5>
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-sm">
                            <div>
                                <span className="text-gray-500 dark:text-gray-400">Company Name:</span>
                                <p className="font-medium text-gray-900 dark:text-white">{employer.name || 'N/A'}</p>
                            </div>
                            <div>
                                <span className="text-gray-500 dark:text-gray-400">UEN:</span>
                                <p className="font-medium text-gray-900 dark:text-white">{employer.uen || 'N/A'}</p>
                            </div>
                            {employer.contact && (
                                <>
                                    <div>
                                        <span className="text-gray-500 dark:text-gray-400">Contact Person:</span>
                                        <p className="font-medium text-gray-900 dark:text-white">{employer.contact.fullName || 'N/A'}</p>
                                    </div>
                                    <div>
                                        <span className="text-gray-500 dark:text-gray-400">Contact Email:</span>
                                        <p className="font-medium text-gray-900 dark:text-white">{employer.contact.email?.full || 'N/A'}</p>
                                    </div>
                                    <div>
                                        <span className="text-gray-500 dark:text-gray-400">Contact Phone:</span>
                                        <p className="font-medium text-gray-900 dark:text-white">
                                            {employer.contact.contactNumber ? `${employer.contact.contactNumber.countryCode || ''} ${employer.contact.contactNumber.phoneNumber || ''}`.trim() || 'N/A' : 'N/A'}
                                        </p>
                                    </div>
                                </>
                            )}
                        </div>
                    </Card>
                )}

                {/* Training Partner Information */}
                {trainingPartner.name && (
                    <Card className="p-4">
                        <h5 className="font-bold text-gray-800 dark:text-gray-200 mb-3">Training Partner</h5>
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-sm">
                            <div>
                                <span className="text-gray-500 dark:text-gray-400">Name:</span>
                                <p className="font-medium text-gray-900 dark:text-white">{trainingPartner.name || 'N/A'}</p>
                            </div>
                            <div>
                                <span className="text-gray-500 dark:text-gray-400">UEN:</span>
                                <p className="font-medium text-gray-900 dark:text-white">{trainingPartner.uen || 'N/A'}</p>
                            </div>
                            <div>
                                <span className="text-gray-500 dark:text-gray-400">Code:</span>
                                <p className="font-medium text-gray-900 dark:text-white">{trainingPartner.code || 'N/A'}</p>
                            </div>
                        </div>
                    </Card>
                )}
            </div>
        );
    };

    return (
        <div>
            <h2 className="text-3xl font-bold mb-6 dark:text-white">View Enrolment</h2>

            {/* Search Bar Card */}
            <Card className="p-6 mb-6">
                <div>
                    <h3 className="text-lg font-bold text-gray-700 dark:text-gray-200 mb-4">Enrolment Lookup</h3>

                    <div className="flex gap-3 items-end">
                        <div className="flex-1">
                            <label htmlFor="view-enrolment-id" className="block text-sm font-bold text-gray-700 dark:text-gray-300 mb-1">
                                Enrolment ID
                            </label>
                            <input
                                id="view-enrolment-id"
                                type="text"
                                value={enrolmentId}
                                onChange={(e) => setEnrolmentId(e.target.value)}
                                onKeyDown={(e) => e.key === 'Enter' && !isSearching && enrolmentId.trim() && handleSearch()}
                                placeholder="e.g. ENR-2601-094504"
                                className={inputClasses}
                                disabled={isSearching}
                            />
                        </div>
                        <Button
                            onClick={handleSearch}
                            disabled={isSearching || !enrolmentId.trim()}
                            className="whitespace-nowrap"
                        >
                            {isSearching ? (
                                <div className="flex items-center">
                                    <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white mr-2"></div>
                                    Searching...
                                </div>
                            ) : (
                                <>
                                    <Icon name={IconName.Search} className="w-4 h-4 mr-2" />
                                    View Enrolment
                                </>
                            )}
                        </Button>
                    </div>

                    {searchError && (
                        <p className="text-red-500 text-sm mt-3">{searchError}</p>
                    )}
                </div>
            </Card>

            {/* Loading State */}
            {isSearching && (
                <div className="flex justify-center py-10">
                    <div className="text-center">
                        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-500 mx-auto"></div>
                        <p className="mt-4 text-gray-600 dark:text-gray-400">Fetching enrolment details from SSG...</p>
                    </div>
                </div>
            )}

            {/* Webhook Response Display */}
            {webhookResponse && !isSearching && (
                <Card className="p-0">
                    <div className="p-6 border-b dark:border-gray-700">
                        <h3 className="text-xl font-bold dark:text-white">Enrolment Details</h3>
                        <p className="text-gray-500 dark:text-gray-400 mt-1">
                            Enrolment ID: {enrolmentId}
                        </p>
                    </div>
                    <div className="p-6">
                        {parsedData ? (
                            <>
                                {renderEnrolmentDetails()}

                                <details className="mt-6 bg-gray-50 dark:bg-gray-700 border border-gray-200 dark:border-gray-600 rounded-lg p-4">
                                    <summary className="font-semibold text-gray-800 dark:text-gray-200 cursor-pointer hover:text-gray-600 dark:hover:text-gray-400">
                                        View Raw JSON Response
                                    </summary>
                                    <pre className="mt-3 text-sm text-gray-700 dark:text-gray-300 whitespace-pre-wrap overflow-x-auto max-h-96 bg-white dark:bg-gray-800 p-3 rounded border dark:border-gray-600">
                                        {JSON.stringify(webhookResponse, null, 2)}
                                    </pre>
                                </details>

                                <div className="mt-6 flex justify-end">
                                    <Button
                                        variant="outline"
                                        onClick={() => {
                                            setWebhookResponse(null);
                                            setParsedData(null);
                                            setEnrolmentId('');
                                        }}
                                    >
                                        Clear Results
                                    </Button>
                                </div>
                            </>
                        ) : (
                            <div className="bg-yellow-50 dark:bg-yellow-900/20 border border-yellow-200 dark:border-yellow-700 rounded-lg p-8 text-center">
                                <Icon name={IconName.InfoCircle} className="w-12 h-12 mx-auto text-yellow-500 dark:text-yellow-400 mb-3" />
                                <h4 className="text-lg font-bold text-yellow-800 dark:text-yellow-300 mb-2">No Data Found</h4>
                                <p className="text-yellow-700 dark:text-yellow-400">
                                    No enrolment record was found for this Enrolment ID.
                                </p>
                            </div>
                        )}
                    </div>
                </Card>
            )}

            {/* Empty State */}
            {!webhookResponse && !isSearching && (
                <Card className="p-12">
                    <div className="text-center text-gray-500 dark:text-gray-400">
                        <Icon name={IconName.Search} className="w-16 h-16 mx-auto mb-4 text-gray-400" />
                        <p className="text-lg font-medium">Enter Enrolment ID to view details</p>
                        <p className="text-sm mt-2">Provide an Enrolment ID (e.g. ENR-2601-094504) to fetch details from SSG</p>
                    </div>
                </Card>
            )}
        </div>
    );
};

export const SearchCourseRunsView: React.FC = () => {
    const [courseCode, setCourseCode] = useState<string>('');
    const [isSearching, setIsSearching] = useState(false);
    const [courseRunsData, setCourseRunsData] = useState<any>(null);
    const [searchError, setSearchError] = useState<string | null>(null);
    const [currentPage, setCurrentPage] = useState(0);
    const [displayPage, setDisplayPage] = useState(0);
    const DISPLAY_PAGE_SIZE = 10;

    const inputClasses = "block w-full px-3 py-2 text-on-surface bg-white border border-gray-300 rounded-md shadow-sm placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent dark:bg-gray-700 dark:border-gray-600 dark:text-white dark:placeholder-gray-500";

    const fetchCourseRuns = async (code: string, page: number) => {
        setIsSearching(true);
        setSearchError(null);
        setCourseRunsData(null);
        setDisplayPage(0);

        try {
            const response = await fetch(
                `/api/course-runs/search?courseCode=${encodeURIComponent(code.trim())}&page=${page}&pageSize=100&includeExpired=true`
            );
            const json = await response.json();

            if (!json.success) {
                setSearchError(json.error || 'Unable to retrieve course runs. Please try again later.');
                return;
            }

            setCourseRunsData(json.data);
        } catch (error) {
            setSearchError('Something went wrong. Please try again later.');
        } finally {
            setIsSearching(false);
        }
    };

    const handleSearch = async () => {
        if (!courseCode.trim()) {
            setSearchError('Please enter a Course Code');
            return;
        }
        setCurrentPage(0);
        await fetchCourseRuns(courseCode, 0);
    };

    const handlePageChange = async (page: number) => {
        setCurrentPage(page);
        setDisplayPage(0);
        await fetchCourseRuns(courseCode, page);
    };

    // Format trainer list from linkCourseRunTrainer array
    const formatTrainers = (trainers: any[] | undefined): string => {
        if (!trainers || trainers.length === 0) return '--';
        const names = trainers
            .map((t: any) => t.trainer?.name || t.name)
            .filter(Boolean);
        return names.length > 0 ? names.join(', ') : '--';
    };

    // Format YYYYMMDD integer to readable date
    const formatDate = (dateInt: number | string | undefined): string => {
        if (!dateInt) return 'N/A';
        const str = String(dateInt);
        if (str.length !== 8) return str;
        const year = str.substring(0, 4);
        const month = str.substring(4, 6);
        const day = str.substring(6, 8);
        return `${day}/${month}/${year}`;
    };

    // Map SSG mode of training codes to labels
    const getModeLabel = (code: string | undefined): string => {
        const modes: Record<string, string> = {
            '1': 'Classroom',
            '2': 'Asynchronous eLearning',
            '3': 'In-house',
            '4': 'On-the-Job',
            '5': 'Practical / Practicum',
            '6': 'Supervised Field',
            '7': 'Traineeship',
            '8': 'Assessment',
            '9': 'Synchronous eLearning',
        };
        return code ? (modes[code] || code) : 'N/A';
    };

    // Format venue object to readable string
    const formatVenue = (venue: any): string => {
        if (!venue) return 'N/A';
        const parts = [
            venue.building,
            venue.block ? `Blk ${venue.block}` : null,
            venue.street,
            venue.floor && venue.unit ? `#${venue.floor}-${venue.unit}` : null,
            venue.postalCode ? `S(${venue.postalCode})` : null,
        ].filter(Boolean);
        return parts.length > 0 ? parts.join(', ') : 'N/A';
    };

    // Get vacancy badge color
    const getVacancyColor = (code: string): string => {
        switch (code) {
            case 'A': return 'bg-green-100 text-green-800 border-green-200';
            case 'L': return 'bg-yellow-100 text-yellow-800 border-yellow-200';
            case 'F': return 'bg-red-100 text-red-800 border-red-200';
            default: return 'bg-gray-100 text-gray-800 border-gray-200';
        }
    };

    const renderCourseRuns = () => {
        if (!courseRunsData) return null;

        // Handle SSG response: course.runs[] or fallback to runs[] / direct array
        const courseRuns = courseRunsData.course?.runs || courseRunsData.runs || (Array.isArray(courseRunsData) ? courseRunsData : null);
        const courseRef = courseRunsData.course?.referenceNumber || courseCode;

        if (courseRuns && Array.isArray(courseRuns) && courseRuns.length > 0) {
            const totalDisplayPages = Math.ceil(courseRuns.length / DISPLAY_PAGE_SIZE);
            const pagedRuns = courseRuns.slice(displayPage * DISPLAY_PAGE_SIZE, (displayPage + 1) * DISPLAY_PAGE_SIZE);

            return (
                <div className="space-y-4">
                    <div className="flex justify-between items-center bg-blue-50 dark:bg-blue-900/30 p-4 rounded-lg border border-blue-100 dark:border-blue-800">
                        <div>
                            <h4 className="font-bold text-blue-900 dark:text-blue-300">Course Runs: {courseRuns.length} results</h4>
                            <p className="text-sm text-blue-700 dark:text-blue-400">Course Reference: {courseRef}</p>
                        </div>
                        <p className="text-sm text-blue-700 dark:text-blue-400">
                            Showing {displayPage * DISPLAY_PAGE_SIZE + 1}–{Math.min((displayPage + 1) * DISPLAY_PAGE_SIZE, courseRuns.length)} of {courseRuns.length}
                        </p>
                    </div>

                    <div className="overflow-x-auto border border-gray-200 dark:border-gray-700 rounded-lg shadow-sm">
                        <table className="min-w-full divide-y divide-gray-200 dark:divide-gray-700">
                            <thead className="bg-gray-50 dark:bg-gray-700">
                                <tr>
                                    <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-300 uppercase tracking-wider">Run ID</th>
                                    <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-300 uppercase tracking-wider">Course Start Date</th>
                                    <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-300 uppercase tracking-wider">Course End Date</th>
                                    <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-300 uppercase tracking-wider">Registration Start Date</th>
                                    <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-300 uppercase tracking-wider">Registration End Date</th>
                                    <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-300 uppercase tracking-wider">QR Code Link</th>
                                    <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-300 uppercase tracking-wider">Mode</th>
                                    <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-300 uppercase tracking-wider">Venue</th>
                                    <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-300 uppercase tracking-wider">Trainer</th>
                                    <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-300 uppercase tracking-wider">Vacancy</th>
                                </tr>
                            </thead>
                            <tbody className="bg-white dark:bg-gray-800 divide-y divide-gray-200 dark:divide-gray-700">
                                {pagedRuns.map((run: any, index: number) => (
                                    <tr key={index} className="hover:bg-gray-50 dark:hover:bg-gray-700">
                                        <td className="px-6 py-4 whitespace-nowrap text-sm font-medium text-blue-600 dark:text-blue-400">
                                            {run.id || 'N/A'}
                                        </td>
                                        <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500 dark:text-gray-300">
                                            {formatDate(run.courseDates?.start)}
                                        </td>
                                        <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500 dark:text-gray-300">
                                            {formatDate(run.courseDates?.end)}
                                        </td>
                                        <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500 dark:text-gray-300">
                                            {formatDate(run.registrationDates?.opening)}
                                        </td>
                                        <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500 dark:text-gray-300">
                                            {formatDate(run.registrationDates?.closing)}
                                        </td>
                                        <td className="px-6 py-4 whitespace-nowrap text-sm">
                                            {run.qrCodeLink ? (
                                                <a
                                                    href={run.qrCodeLink}
                                                    target="_blank"
                                                    rel="noopener noreferrer"
                                                    className="text-blue-600 dark:text-blue-400 hover:underline flex items-center"
                                                >
                                                    <Icon name={IconName.ExternalLink} className="w-4 h-4 mr-1" />
                                                    View
                                                </a>
                                            ) : (
                                                <span className="text-gray-400 dark:text-gray-500">N/A</span>
                                            )}
                                        </td>
                                        <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500 dark:text-gray-300">
                                            {getModeLabel(run.modeOfTraining)}
                                        </td>
                                        <td className="px-6 py-4 text-sm text-gray-500 dark:text-gray-300 min-w-[300px]" title={formatVenue(run.venue)}>
                                            {formatVenue(run.venue)}
                                        </td>
                                        <td className="px-6 py-4 text-sm text-gray-500 dark:text-gray-300 min-w-[150px]">
                                            {formatTrainers(run.linkCourseRunTrainer)}
                                        </td>
                                        <td className="px-6 py-4 whitespace-nowrap">
                                            <span className={`inline-flex px-2 text-xs leading-5 font-semibold rounded-full border ${getVacancyColor(run.courseVacancy?.code || '')}`}>
                                                {run.courseVacancy?.description || 'N/A'}
                                            </span>
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>

                    {/* Pagination controls */}
                    {totalDisplayPages > 1 && (
                        <div className="flex items-center justify-center gap-2 pt-2">
                            <button
                                onClick={() => setDisplayPage(p => Math.max(0, p - 1))}
                                disabled={displayPage === 0}
                                className="px-3 py-1.5 text-sm border border-gray-300 dark:border-gray-600 rounded-md bg-white dark:bg-gray-700 text-gray-700 dark:text-gray-200 disabled:opacity-40 hover:bg-gray-50 dark:hover:bg-gray-600"
                            >
                                Previous
                            </button>
                            {Array.from({ length: totalDisplayPages }, (_, i) => (
                                <button
                                    key={i}
                                    onClick={() => setDisplayPage(i)}
                                    className={`px-3 py-1.5 text-sm border rounded-md ${
                                        i === displayPage
                                            ? 'bg-blue-600 border-blue-600 text-white'
                                            : 'border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-gray-600'
                                    }`}
                                >
                                    {i + 1}
                                </button>
                            ))}
                            <button
                                onClick={() => setDisplayPage(p => Math.min(totalDisplayPages - 1, p + 1))}
                                disabled={displayPage === totalDisplayPages - 1}
                                className="px-3 py-1.5 text-sm border border-gray-300 dark:border-gray-600 rounded-md bg-white dark:bg-gray-700 text-gray-700 dark:text-gray-200 disabled:opacity-40 hover:bg-gray-50 dark:hover:bg-gray-600"
                            >
                                Next
                            </button>
                        </div>
                    )}
                </div>
            );
        }

        return (
            <div className="bg-yellow-50 dark:bg-yellow-900/20 border border-yellow-200 dark:border-yellow-700 rounded-lg p-8 text-center">
                <Icon name={IconName.InfoCircle} className="w-12 h-12 mx-auto text-yellow-500 dark:text-yellow-400 mb-3" />
                <h4 className="text-lg font-bold text-yellow-800 dark:text-yellow-300 mb-2">No Course Runs Found</h4>
                <p className="text-yellow-700 dark:text-yellow-400">
                    No course runs were found for this Course Code on page {currentPage}.
                </p>
            </div>
        );
    };

    return (
        <div>
            <h2 className="text-3xl font-bold mb-6 dark:text-white">Get Course Runs By Course Code</h2>

            {/* Search Bar Card */}
            <Card className="p-6 mb-6">
                <div>
                    <h3 className="text-lg font-bold text-gray-700 dark:text-gray-200 mb-4">Course Run Search</h3>

                    <div className="flex gap-3 items-end">
                        <div className="flex-1">
                            <label htmlFor="search-course-code" className="block text-sm font-bold text-gray-700 dark:text-gray-300 mb-1">
                                Course Code
                            </label>
                            <input
                                id="search-course-code"
                                type="text"
                                value={courseCode}
                                onChange={(e) => setCourseCode(e.target.value)}
                                onKeyDown={(e) => e.key === 'Enter' && !isSearching && courseCode.trim() && handleSearch()}
                                placeholder="e.g. TGS-2024052076"
                                className={inputClasses}
                                disabled={isSearching}
                            />
                        </div>
                        <Button
                            onClick={handleSearch}
                            disabled={isSearching || !courseCode.trim()}
                            className="whitespace-nowrap"
                        >
                            {isSearching ? (
                                <div className="flex items-center">
                                    <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white mr-2"></div>
                                    Searching...
                                </div>
                            ) : (
                                <>
                                    <Icon name={IconName.Search} className="w-4 h-4 mr-2" />
                                    Search Course Runs
                                </>
                            )}
                        </Button>
                    </div>

                    {searchError && (
                        <p className="text-red-500 text-sm mt-3">{searchError}</p>
                    )}
                </div>
            </Card>

            {/* Loading State */}
            {isSearching && (
                <div className="flex justify-center py-10">
                    <div className="text-center">
                        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-500 mx-auto"></div>
                        <p className="mt-4 text-gray-600 dark:text-gray-400">Fetching course runs from SSG...</p>
                    </div>
                </div>
            )}

            {/* Results Display */}
            {courseRunsData && !isSearching && (
                <Card className="p-0">
                    <div className="p-6 border-b dark:border-gray-700 flex flex-wrap items-center justify-between gap-4">
                        <div>
                            <h3 className="text-xl font-bold dark:text-white">Course Run Results</h3>
                            <p className="text-gray-500 dark:text-gray-400 mt-1">Course Code: {courseCode}</p>
                        </div>
                        <div className="flex items-center gap-2">
                            <label htmlFor="page-select" className="text-sm font-medium text-gray-700 dark:text-gray-300 whitespace-nowrap">
                                Page:
                            </label>
                            <select
                                id="page-select"
                                value={currentPage}
                                onChange={(e) => handlePageChange(Number(e.target.value))}
                                className="px-3 py-1.5 text-sm border border-gray-300 rounded-md bg-white dark:bg-gray-700 dark:border-gray-600 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
                            >
                                {Array.from({ length: 10 }, (_, i) => (
                                    <option key={i} value={i}>Page {i}</option>
                                ))}
                            </select>
                        </div>
                    </div>
                    <div className="p-6">
                        {renderCourseRuns()}

                        <details className="mt-6 bg-gray-50 dark:bg-gray-700 border border-gray-200 dark:border-gray-600 rounded-lg p-4">
                            <summary className="font-semibold text-gray-800 dark:text-gray-200 cursor-pointer hover:text-gray-600 dark:hover:text-gray-400">
                                View Raw JSON Response
                            </summary>
                            <pre className="mt-3 text-sm text-gray-700 dark:text-gray-300 whitespace-pre-wrap overflow-x-auto max-h-96 bg-white dark:bg-gray-800 p-3 rounded border dark:border-gray-600">
                                {JSON.stringify(courseRunsData, null, 2)}
                            </pre>
                        </details>

                        <div className="mt-6 flex justify-end">
                            <Button
                                variant="outline"
                                onClick={() => {
                                    setCourseRunsData(null);
                                    setCourseCode('');
                                    setCurrentPage(0);
                                    setDisplayPage(0);
                                }}
                            >
                                Clear Results
                            </Button>
                        </div>
                    </div>
                </Card>
            )}

            {/* Empty State */}
            {!courseRunsData && !isSearching && (
                <Card className="p-12">
                    <div className="text-center text-gray-500 dark:text-gray-400">
                        <Icon name={IconName.Search} className="w-16 h-16 mx-auto mb-4 text-gray-400" />
                        <p className="text-lg font-medium">Enter Course Code to search</p>
                        <p className="text-sm mt-2">Provide a Course Code to fetch all associated course runs from SSG</p>
                    </div>
                </Card>
            )}
        </div>
    );
};

export const ViewCourseRunView: React.FC = () => {
    const { setAdminPage, setSelectedCourseRunId } = useLms();
    const [courseRunId, setCourseRunId] = useState<string>('');
    const [isSearching, setIsSearching] = useState(false);
    const [webhookResponse, setWebhookResponse] = useState<any>(null);
    const [parsedData, setParsedData] = useState<any>(null);
    const [searchError, setSearchError] = useState<string | null>(null);


    const inputClasses = "block w-full px-3 py-2 text-on-surface bg-white border border-gray-300 rounded-md shadow-sm placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent dark:bg-gray-700 dark:border-gray-600 dark:text-white dark:placeholder-gray-500";

    // Format YYYYMMDD integer to readable date
    const formatDate = (dateInt: number | string | undefined): string => {
        if (!dateInt) return 'N/A';
        const str = String(dateInt);
        if (str.length !== 8) return str;
        const year = str.substring(0, 4);
        const month = str.substring(4, 6);
        const day = str.substring(6, 8);
        return `${day}/${month}/${year}`;
    };

    // Map SSG mode of training codes to labels
    const getModeLabel = (code: string | undefined): string => {
        const modes: Record<string, string> = {
            '1': 'Classroom',
            '2': 'Asynchronous eLearning',
            '3': 'In-house',
            '4': 'On-the-Job',
            '5': 'Practical / Practicum',
            '6': 'Supervised Field',
            '7': 'Traineeship',
            '8': 'Assessment',
            '9': 'Synchronous eLearning',
        };
        return code ? (modes[code] || code) : 'N/A';
    };

    // Format venue object to readable string
    const formatVenue = (venue: any): string => {
        if (!venue) return 'N/A';
        const parts = [
            venue.building,
            venue.block ? `Blk ${venue.block}` : null,
            venue.street,
            venue.floor && venue.unit ? `#${venue.floor}-${venue.unit}` : null,
            venue.postalCode ? `S(${venue.postalCode})` : null,
        ].filter(Boolean);
        return parts.length > 0 ? parts.join(', ') : 'N/A';
    };

    // Get vacancy badge color
    const getVacancyColor = (code: string): string => {
        switch (code) {
            case 'A': return 'bg-green-100 text-green-800 border-green-200 dark:bg-green-900/30 dark:text-green-300 dark:border-green-700';
            case 'L': return 'bg-yellow-100 text-yellow-800 border-yellow-200 dark:bg-yellow-900/30 dark:text-yellow-300 dark:border-yellow-700';
            case 'F': return 'bg-red-100 text-red-800 border-red-200 dark:bg-red-900/30 dark:text-red-300 dark:border-red-700';
            default: return 'bg-gray-100 text-gray-800 border-gray-200 dark:bg-gray-900/30 dark:text-gray-300 dark:border-gray-700';
        }
    };

    const handleSearch = async () => {
        if (!courseRunId.trim()) {
            setSearchError('Please enter a Course Run ID');
            return;
        }

        setIsSearching(true);
        setSearchError(null);
        setWebhookResponse(null);
        setParsedData(null);

        try {
            const response = await fetch(`/api/course-runs/view?courseRunId=${encodeURIComponent(courseRunId.trim())}`);
            const json = await response.json();

            if (!json.success) {
                const ssgError = json.data?.error;
                if (response.status === 404 || ssgError?.code === '404') {
                    setSearchError(`Course Run ID "${courseRunId.trim()}" was not found. Please check the ID and try again.`);
                } else {
                    const detail = ssgError?.details?.[0]?.message || ssgError?.message || json.error || `SSG API error ${response.status}`;
                    setSearchError(detail);
                }
                return;
            }

            // data = { course: { run: {...}, title, referenceNumber, ... } }
            setWebhookResponse(json.data);
            setParsedData(json.data);

            if (!json.data?.course?.run) {
                console.warn('⚠️ No course run data in SSG response');
                setParsedData(null);
            }
        } catch (error) {
            console.error('❌ Error fetching course run:', error);
            setSearchError(error instanceof Error ? error.message : 'Failed to fetch course run data');
        } finally {
            setIsSearching(false);
        }
    };

    // Helper to render course run details
    const renderCourseRunDetails = () => {
        if (!parsedData) {
            console.log('❌ No parsedData available');
            return null;
        }

        console.log('📊 parsedData structure:', parsedData);

        // Handle webhook response structure: result.course.run (after extraction, parsedData = result)
        const courseData = parsedData.course;
        if (!courseData) {
            console.log('❌ No courseData found. parsedData:', parsedData);
            return null;
        }

        const run = courseData.run;
        if (!run) {
            console.log('❌ No run data found. courseData:', courseData);
            return null;
        }

        console.log('✅ Rendering course run:', run);

        return (
            <div className="space-y-6">
                {/* Course Run Summary */}
                <div className="bg-blue-50 dark:bg-blue-900/30 p-4 rounded-lg border border-blue-100 dark:border-blue-800">
                    <h4 className="font-bold text-blue-900 dark:text-blue-300 text-lg">{courseData.title || 'N/A'}</h4>
                    <p className="text-sm text-blue-700 dark:text-blue-400 mt-1">
                        Reference Number: <span className="font-semibold">{courseData.referenceNumber || 'N/A'}</span>
                    </p>
                    <p className="text-sm text-blue-700 dark:text-blue-400 mt-1">
                        Vacancy: <span className={`inline-flex px-2 py-0.5 text-xs font-semibold rounded-full border ${getVacancyColor(run.courseVacancy?.code || '')}`}>
                            {run.courseVacancy?.description || 'N/A'}
                        </span>
                    </p>
                </div>

                {/* Course Run Information Table */}
                <Card className="p-0 overflow-hidden">
                    <div className="overflow-x-auto">
                        <table className="w-full border-collapse">
                            <thead className="bg-gray-50 dark:bg-gray-800">
                                <tr>
                                    <th className="px-6 py-3 text-left text-xs font-bold text-gray-700 dark:text-gray-300 uppercase tracking-wider border-b dark:border-gray-700">
                                        Field
                                    </th>
                                    <th className="px-6 py-3 text-left text-xs font-bold text-gray-700 dark:text-gray-300 uppercase tracking-wider border-b dark:border-gray-700">
                                        Value
                                    </th>
                                </tr>
                            </thead>
                            <tbody className="bg-white dark:bg-gray-900 divide-y divide-gray-200 dark:divide-gray-700">
                                <tr className="hover:bg-gray-50 dark:hover:bg-gray-800">
                                    <td className="px-6 py-4 whitespace-nowrap text-sm font-semibold text-gray-700 dark:text-gray-300">
                                        Course Run ID
                                    </td>
                                    <td className="px-6 py-4 text-sm text-gray-900 dark:text-white">
                                        {run.id || 'N/A'}
                                    </td>
                                </tr>
                                <tr className="hover:bg-gray-50 dark:hover:bg-gray-800">
                                    <td className="px-6 py-4 whitespace-nowrap text-sm font-semibold text-gray-700 dark:text-gray-300">
                                        Course Start Date
                                    </td>
                                    <td className="px-6 py-4 text-sm text-gray-900 dark:text-white">
                                        {formatDate(run.courseStartDate)}
                                    </td>
                                </tr>
                                <tr className="hover:bg-gray-50 dark:hover:bg-gray-800">
                                    <td className="px-6 py-4 whitespace-nowrap text-sm font-semibold text-gray-700 dark:text-gray-300">
                                        Course End Date
                                    </td>
                                    <td className="px-6 py-4 text-sm text-gray-900 dark:text-white">
                                        {formatDate(run.courseEndDate)}
                                    </td>
                                </tr>
                                <tr className="hover:bg-gray-50 dark:hover:bg-gray-800">
                                    <td className="px-6 py-4 whitespace-nowrap text-sm font-semibold text-gray-700 dark:text-gray-300">
                                        Mode of Training
                                    </td>
                                    <td className="px-6 py-4 text-sm text-gray-900 dark:text-white">
                                        {getModeLabel(run.modeOfTraining)}
                                    </td>
                                </tr>
                                <tr className="hover:bg-gray-50 dark:hover:bg-gray-800">
                                    <td className="px-6 py-4 whitespace-nowrap text-sm font-semibold text-gray-700 dark:text-gray-300">
                                        Venue
                                    </td>
                                    <td className="px-6 py-4 text-sm text-gray-900 dark:text-white">
                                        {formatVenue(run.venue)}
                                    </td>
                                </tr>
                                <tr className="hover:bg-gray-50 dark:hover:bg-gray-800">
                                    <td className="px-6 py-4 whitespace-nowrap text-sm font-semibold text-gray-700 dark:text-gray-300">
                                        Registration Opening Date
                                    </td>
                                    <td className="px-6 py-4 text-sm text-gray-900 dark:text-white">
                                        {formatDate(run.registrationOpeningDate)}
                                    </td>
                                </tr>
                                <tr className="hover:bg-gray-50 dark:hover:bg-gray-800">
                                    <td className="px-6 py-4 whitespace-nowrap text-sm font-semibold text-gray-700 dark:text-gray-300">
                                        Registration Closing Date
                                    </td>
                                    <td className="px-6 py-4 text-sm text-gray-900 dark:text-white">
                                        {formatDate(run.registrationClosingDate)}
                                    </td>
                                </tr>
                                {/* <tr className="hover:bg-gray-50 dark:hover:bg-gray-800">
                                    <td className="px-6 py-4 whitespace-nowrap text-sm font-semibold text-gray-700 dark:text-gray-300">
                                        Intake Size
                                    </td>
                                    <td className="px-6 py-4 text-sm text-gray-900 dark:text-white">
                                        {run.intakeSize || 0}
                                    </td>
                                </tr> */}
                                {/* <tr className="hover:bg-gray-50 dark:hover:bg-gray-800">
                                    <td className="px-6 py-4 whitespace-nowrap text-sm font-semibold text-gray-700 dark:text-gray-300">
                                        Registered Users
                                    </td>
                                    <td className="px-6 py-4 text-sm text-gray-900 dark:text-white">
                                        {run.registeredUserCount || 0}
                                    </td>
                                </tr> */}
                                {/* <tr className="hover:bg-gray-50 dark:hover:bg-gray-800">
                                    <td className="px-6 py-4 whitespace-nowrap text-sm font-semibold text-gray-700 dark:text-gray-300">
                                        Threshold
                                    </td>
                                    <td className="px-6 py-4 text-sm text-gray-900 dark:text-white">
                                        {run.threshold || 0}
                                    </td>
                                </tr>
                                <tr className="hover:bg-gray-50 dark:hover:bg-gray-800">
                                    <td className="px-6 py-4 whitespace-nowrap text-sm font-semibold text-gray-700 dark:text-gray-300">
                                        Course Vacancy
                                    </td>
                                    <td className="px-6 py-4 text-sm text-gray-900 dark:text-white">
                                        <span className={`inline-flex px-2 py-1 text-sm font-semibold rounded-full border ${getVacancyColor(run.courseVacancy?.code || '')}`}>
                                            {run.courseVacancy?.description || 'N/A'} ({run.courseVacancy?.code || 'N/A'})
                                        </span>
                                    </td>
                                </tr> */}
                                <tr className="hover:bg-gray-50 dark:hover:bg-gray-800">
                                    <td className="px-6 py-4 whitespace-nowrap text-sm font-semibold text-gray-700 dark:text-gray-300">
                                        Course Admin Email
                                    </td>
                                    <td className="px-6 py-4 text-sm text-gray-900 dark:text-white">
                                        {run.courseAdminEmail || 'N/A'}
                                    </td>
                                </tr>
                                <tr className="hover:bg-gray-50 dark:hover:bg-gray-800">
                                    <td className="px-6 py-4 whitespace-nowrap text-sm font-semibold text-gray-700 dark:text-gray-300">
                                        Attendance Taken
                                    </td>
                                    <td className="px-6 py-4 text-sm text-gray-900 dark:text-white">
                                        {run.attendanceTaken ? 'Yes' : 'No'}
                                    </td>
                                </tr>
                                <tr className="hover:bg-gray-50 dark:hover:bg-gray-800">
                                    <td className="px-6 py-4 whitespace-nowrap text-sm font-semibold text-gray-700 dark:text-gray-300">
                                        QR Code Link
                                    </td>
                                    <td className="px-6 py-4 text-sm">
                                        {run.qrCodeLink ? (
                                            <a
                                                href={run.qrCodeLink}
                                                target="_blank"
                                                rel="noopener noreferrer"
                                                className="text-blue-600 dark:text-blue-400 hover:underline flex items-center"
                                            >
                                                <Icon name={IconName.ExternalLink} className="w-4 h-4 mr-1" />
                                                {run.qrCodeLink}
                                            </a>
                                        ) : (
                                            <span className="text-gray-500 dark:text-gray-400">N/A</span>
                                        )}
                                    </td>
                                </tr>
                                <tr className="hover:bg-gray-50 dark:hover:bg-gray-800">
                                    <td className="px-6 py-4 whitespace-nowrap text-sm font-semibold text-gray-700 dark:text-gray-300">
                                        Organization UEN
                                    </td>
                                    <td className="px-6 py-4 text-sm text-gray-900 dark:text-white">
                                        {run.organizationKey || 'N/A'}
                                    </td>
                                </tr>
                                {/* <tr className="hover:bg-gray-50 dark:hover:bg-gray-800">
                                    <td className="px-6 py-4 whitespace-nowrap text-sm font-semibold text-gray-700 dark:text-gray-300">
                                        Schedule Info Type
                                    </td>
                                    <td className="px-6 py-4 text-sm text-gray-900 dark:text-white">
                                        {run.scheduleInfoType?.description || 'N/A'} ({run.scheduleInfoType?.code || 'N/A'})
                                    </td>
                                </tr> */}
                                {/* <tr className="hover:bg-gray-50 dark:hover:bg-gray-800">
                                    <td className="px-6 py-4 whitespace-nowrap text-sm font-semibold text-gray-700 dark:text-gray-300">
                                        Schedule Info
                                    </td>
                                    <td className="px-6 py-4 text-sm text-gray-900 dark:text-white">
                                        {run.scheduleInfo || 'N/A'}
                                    </td>
                                </tr> */}
                            </tbody>
                        </table>
                    </div>
                </Card>

                {/* Trainer Section */}
                {run.linkCourseRunTrainer && run.linkCourseRunTrainer.length > 0 && (
                    <Card className="p-6">
                        <h4 className="text-base font-bold text-gray-800 dark:text-gray-200 mb-4">Assigned Trainer(s)</h4>
                        <div className="space-y-3">
                            {run.linkCourseRunTrainer.map((link: any, idx: number) => {
                                const t = link.trainer;
                                if (!t) return null;
                                return (
                                    <div key={t.id ?? idx} className="p-4 border border-gray-200 dark:border-gray-600 rounded-lg">
                                        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                                            <div>
                                                <p className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide mb-1">Name</p>
                                                <p className="text-sm font-medium text-gray-900 dark:text-white">{t.name ?? '—'}</p>
                                            </div>
                                            <div>
                                                <p className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide mb-1">ID Number</p>
                                                <p className="text-sm font-mono text-gray-900 dark:text-white">{t.idNumber ?? '—'}</p>
                                            </div>
                                            <div>
                                                <p className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide mb-1">Email</p>
                                                <p className="text-sm text-gray-900 dark:text-white">{t.email ?? '—'}</p>
                                            </div>
                                        </div>
                                    </div>
                                );
                            })}
                        </div>
                    </Card>
                )}
            </div>
        );
    };

    return (
        <div>
            <h2 className="text-3xl font-bold mb-6 dark:text-white">View Course Run</h2>

            {/* Search Bar Card */}
            <Card className="p-6 mb-6">
                <div>
                    <h3 className="text-lg font-bold text-gray-700 dark:text-gray-200 mb-4">Course Run Lookup</h3>

                    <div className="flex gap-3 items-end">
                        <div className="flex-1">
                            <label htmlFor="view-course-run-id" className="block text-sm font-bold text-gray-700 dark:text-gray-300 mb-1">
                                Course Run ID
                            </label>
                            <input
                                id="view-course-run-id"
                                type="text"
                                value={courseRunId}
                                onChange={(e) => setCourseRunId(e.target.value)}
                                onKeyDown={(e) => e.key === 'Enter' && !isSearching && courseRunId.trim() && handleSearch()}
                                placeholder="e.g. 1234567"
                                className={inputClasses}
                                disabled={isSearching}
                            />
                        </div>
                        <Button
                            onClick={handleSearch}
                            disabled={isSearching || !courseRunId.trim()}
                            className="whitespace-nowrap"
                        >
                            {isSearching ? (
                                <div className="flex items-center">
                                    <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white mr-2"></div>
                                    Searching...
                                </div>
                            ) : (
                                <>
                                    <Icon name={IconName.Search} className="w-4 h-4 mr-2" />
                                    View Course Run
                                </>
                            )}
                        </Button>
                    </div>

                    {searchError && (
                        <p className="text-red-500 text-sm mt-3">{searchError}</p>
                    )}
                </div>
            </Card>

            {/* Loading State */}
            {isSearching && (
                <div className="flex justify-center py-10">
                    <div className="text-center">
                        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-500 mx-auto"></div>
                        <p className="mt-4 text-gray-600 dark:text-gray-400">Fetching course run details from SSG...</p>
                    </div>
                </div>
            )}

            {/* Webhook Response Display */}
            {webhookResponse && !isSearching && (
                <Card className="p-0">
                    <div className="p-6 border-b dark:border-gray-700">
                        <h3 className="text-xl font-bold dark:text-white">Course Run Details</h3>
                        <p className="text-gray-500 dark:text-gray-400 mt-1">
                            Course Run ID: {courseRunId}
                        </p>
                    </div>
                    <div className="p-6">
                        {parsedData ? (
                            <>
                                {renderCourseRunDetails()}

                                <details className="mt-6 bg-gray-50 dark:bg-gray-700 border border-gray-200 dark:border-gray-600 rounded-lg p-4">
                                    <summary className="font-semibold text-gray-800 dark:text-gray-200 cursor-pointer hover:text-gray-600 dark:hover:text-gray-400">
                                        ▼ View Raw JSON Response
                                    </summary>
                                    <pre className="mt-3 text-xs text-gray-700 dark:text-gray-300 whitespace-pre-wrap overflow-x-auto max-h-96 bg-white dark:bg-gray-800 p-3 rounded border dark:border-gray-600 font-mono">
                                        {JSON.stringify(webhookResponse, null, 2)}
                                    </pre>
                                </details>

                                <details className="mt-6 bg-gray-50 dark:bg-gray-700 border border-gray-200 dark:border-gray-600 rounded-lg p-4">
                                    <summary className="font-semibold text-gray-800 dark:text-gray-200 cursor-pointer hover:text-gray-600 dark:hover:text-gray-400">
                                        ▼ View Parsed Data
                                    </summary>
                                    <pre className="mt-3 text-xs text-gray-700 dark:text-gray-300 whitespace-pre-wrap overflow-x-auto max-h-96 bg-white dark:bg-gray-800 p-3 rounded border dark:border-gray-600 font-mono">
                                        {JSON.stringify(parsedData, null, 2)}
                                    </pre>
                                </details>

                                <div className="mt-6 flex justify-end gap-3">
                                    <Button
                                        variant="outline"
                                        onClick={() => {
                                            setWebhookResponse(null);
                                            setParsedData(null);
                                            setCourseRunId('');
                                        }}
                                    >
                                        Clear Results
                                    </Button>
                                    <Button
                                        onClick={() => {
                                            setSelectedCourseRunId(courseRunId.trim());
                                            setAdminPage(AdminPage.EditCourseRun);
                                        }}
                                    >
                                        <Icon name={IconName.Edit} className="w-4 h-4 mr-2" />
                                        Edit Course Run
                                    </Button>
                                </div>
                            </>
                        ) : (
                            <div className="bg-yellow-50 dark:bg-yellow-900/20 border border-yellow-200 dark:border-yellow-700 rounded-lg p-8 text-center">
                                <Icon name={IconName.InfoCircle} className="w-12 h-12 mx-auto text-yellow-500 dark:text-yellow-400 mb-3" />
                                <h4 className="text-lg font-bold text-yellow-800 dark:text-yellow-300 mb-2">No Data Found</h4>
                                <p className="text-yellow-700 dark:text-yellow-400">
                                    No course run record was found for this Course Run ID.
                                </p>
                            </div>
                        )}
                    </div>
                </Card>
            )}

            {/* Empty State */}
            {!webhookResponse && !isSearching && (
                <Card className="p-12">
                    <div className="text-center text-gray-500 dark:text-gray-400">
                        <Icon name={IconName.Search} className="w-16 h-16 mx-auto mb-4 text-gray-400" />
                        <p className="text-lg font-medium">Enter Course Run ID to view details</p>
                        <p className="text-sm mt-2">Provide a Course Run ID (e.g. 1234567) to fetch details from SSG</p>
                    </div>
                </Card>
            )}
        </div>
    );
};

// Cancel Enrolment View
export const CancelEnrolmentView: React.FC = () => {
    const [enrolmentId, setEnrolmentId] = useState<string>('');
    const [courseRunId, setCourseRunId] = useState<string>('');
    const [isSubmitting, setIsSubmitting] = useState(false);
    const [result, setResult] = useState<any>(null);
    const [error, setError] = useState<string | null>(null);
    const [showConfirm, setShowConfirm] = useState(false);

    const CANCEL_ENROLMENT_API = '/api/enrolment/cancel';

    const inputClasses = "block w-full px-3 py-2 text-on-surface bg-white border border-gray-300 rounded-md shadow-sm placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent dark:bg-gray-700 dark:border-gray-600 dark:text-white dark:placeholder-gray-500";

    const handleSubmit = async () => {
        setShowConfirm(false);
        setIsSubmitting(true);
        setError(null);
        setResult(null);

        try {
            const response = await fetch(CANCEL_ENROLMENT_API, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ enrolmentId: enrolmentId.trim(), courseRunId: courseRunId.trim() })
            });

            const json = await response.json();

            if (!response.ok || !json.success) {
                const errMsg = typeof json.error === 'string' ? json.error : (json.error?.message ?? JSON.stringify(json.error) ?? `Error ${response.status}`);
                setError(errMsg);
                setResult(json);
                return;
            }

            console.log('✅ Cancel enrolment response:', json);
            setResult(json.data);
        } catch (err) {
            console.error('❌ Error cancelling enrolment:', err);
            setError(err instanceof Error ? err.message : 'Failed to cancel enrolment');
        } finally {
            setIsSubmitting(false);
        }
    };

    const handleClear = () => {
        setEnrolmentId('');
        setCourseRunId('');
        setResult(null);
        setError(null);
        setShowConfirm(false);
    };

    const isFormValid = enrolmentId.trim() && courseRunId.trim();

    return (
        <div>
            <h2 className="text-3xl font-bold mb-6 dark:text-white">Cancel Enrolment</h2>

            {/* Input Form Card */}
            <Card className="p-6 mb-6">
                <h3 className="text-lg font-bold text-gray-700 dark:text-gray-200 mb-4">Enrolment Details</h3>
                <p className="text-sm text-gray-600 dark:text-gray-400 mb-4">
                    Both Enrolment ID and Course Run ID are required to cancel an enrolment.
                </p>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
                    <div>
                        <label htmlFor="cancel-enrolment-id" className="block text-sm font-bold text-gray-700 dark:text-gray-300 mb-1">
                            Enrolment ID <span className="text-red-500">*</span>
                        </label>
                        <input
                            id="cancel-enrolment-id"
                            type="text"
                            value={enrolmentId}
                            onChange={(e) => setEnrolmentId(e.target.value)}
                            placeholder="e.g. ENR-2602-014784"
                            className={inputClasses}
                            disabled={isSubmitting}
                        />
                    </div>
                    <div>
                        <label htmlFor="cancel-course-run-id" className="block text-sm font-bold text-gray-700 dark:text-gray-300 mb-1">
                            Course Run ID <span className="text-red-500">*</span>
                        </label>
                        <input
                            id="cancel-course-run-id"
                            type="text"
                            value={courseRunId}
                            onChange={(e) => setCourseRunId(e.target.value)}
                            placeholder="e.g. 1225151"
                            className={inputClasses}
                            disabled={isSubmitting}
                        />
                    </div>
                </div>

                <div className="flex gap-3">
                    {!showConfirm ? (
                        <Button
                            onClick={() => setShowConfirm(true)}
                            disabled={isSubmitting || !isFormValid}
                        >
                            {isSubmitting ? (
                                <div className="flex items-center">
                                    <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white mr-2"></div>
                                    Cancelling...
                                </div>
                            ) : (
                                <>
                                    <Icon name={IconName.X} className="w-4 h-4 mr-2" />
                                    Cancel Enrolment
                                </>
                            )}
                        </Button>
                    ) : (
                        <div className="flex items-center gap-3">
                            <span className="text-sm text-red-600 dark:text-red-400 font-medium">
                                Are you sure you want to cancel this enrolment?
                            </span>
                            <Button onClick={handleSubmit}>
                                Yes, Cancel It
                            </Button>
                            <Button variant="outline" onClick={() => setShowConfirm(false)}>
                                No, Go Back
                            </Button>
                        </div>
                    )}
                    <Button variant="outline" onClick={handleClear} disabled={isSubmitting}>
                        Clear
                    </Button>
                </div>

                {error && !result && (
                    <p className="text-red-500 text-sm mt-3">{error}</p>
                )}
            </Card>

            {/* Loading State */}
            {isSubmitting && (
                <div className="flex justify-center py-10">
                    <div className="text-center">
                        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-500 mx-auto"></div>
                        <p className="mt-4 text-gray-600 dark:text-gray-400">Processing cancellation...</p>
                    </div>
                </div>
            )}

            {/* Result Display */}
            {!isSubmitting && result && (
                <Card className="p-6">
                    {error ? (
                        <div className="bg-red-50 dark:bg-red-900/20 border-l-4 border-red-500 dark:border-red-600 rounded-r-lg p-4">
                            <div className="flex items-center gap-2 mb-2">
                                <Icon name={IconName.X} className="w-5 h-5 text-red-600 dark:text-red-400" />
                                <h4 className="font-semibold text-red-900 dark:text-red-200">Cancellation Failed</h4>
                            </div>
                            <p className="text-sm text-red-800 dark:text-red-300 pl-7">{error}</p>
                        </div>
                    ) : (
                        <div className="bg-green-50 dark:bg-green-900/20 border-l-4 border-green-500 dark:border-green-600 rounded-r-lg p-4">
                            <div className="flex items-center gap-2 mb-2">
                                <Icon name={IconName.CheckCircle} className="w-5 h-5 text-green-600 dark:text-green-400" />
                                <h4 className="font-semibold text-green-900 dark:text-green-200">Enrolment Cancelled Successfully</h4>
                            </div>
                            <div className="pl-7 space-y-1">
                                {(result?.enrolment?.referenceNumber ?? result?.data?.enrolment?.referenceNumber) && (
                                    <p className="text-sm text-green-700 dark:text-green-300">
                                        <span className="font-medium">Enrolment ID:</span>{' '}
                                        <span className="font-mono bg-green-100 dark:bg-green-900/40 px-2 py-0.5 rounded">
                                            {result?.enrolment?.referenceNumber ?? result?.data?.enrolment?.referenceNumber}
                                        </span>
                                    </p>
                                )}
                                {(result?.enrolment?.status ?? result?.data?.enrolment?.status) && (
                                    <p className="text-sm text-green-700 dark:text-green-300">
                                        <span className="font-medium">Status:</span> {result?.enrolment?.status ?? result?.data?.enrolment?.status}
                                    </p>
                                )}
                            </div>
                        </div>
                    )}

                    {/* Raw Response (collapsible) */}
                    <details className="mt-4">
                        <summary className="text-sm text-gray-500 dark:text-gray-400 cursor-pointer hover:text-gray-700 dark:hover:text-gray-300">
                            View Raw Response
                        </summary>
                        <pre className="mt-2 text-xs bg-gray-100 dark:bg-gray-800 p-3 rounded overflow-auto max-h-60">
                            {JSON.stringify(result, null, 2)}
                        </pre>
                    </details>
                </Card>
            )}
        </div>
    );
};

// Update Enrolment View
export const UpdateEnrolmentView: React.FC = () => {
    const [enrolmentId, setEnrolmentId] = useState<string>('');
    const [courseRunId, setCourseRunId] = useState<string>('');
    const [isSubmitting, setIsSubmitting] = useState(false);
    const [result, setResult] = useState<any>(null);
    const [error, setError] = useState<string | null>(null);

    const UPDATE_ENROLMENT_API = '/api/enrolment/update';
    const inputClasses = "block w-full px-3 py-2 text-on-surface bg-white border border-gray-300 rounded-md shadow-sm placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent dark:bg-gray-700 dark:border-gray-600 dark:text-white dark:placeholder-gray-500";

    const handleSubmit = async () => {
        setIsSubmitting(true);
        setError(null);
        setResult(null);

        try {
            const response = await fetch(UPDATE_ENROLMENT_API, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ enrolmentId: enrolmentId.trim(), courseRunId: courseRunId.trim() })
            });

            const json = await response.json();
            console.log('✅ Update enrolment response:', json);

            if (!json.success) {
                const errMsg = typeof json.error === 'string' ? json.error : (json.error?.message ?? JSON.stringify(json.error));
                setError(errMsg || 'Failed to update enrolment');
                return;
            }

            setResult(json.data);
        } catch (err) {
            console.error('❌ Error updating enrolment:', err);
            setError(err instanceof Error ? err.message : 'Failed to update enrolment');
        } finally {
            setIsSubmitting(false);
        }
    };

    const handleClear = () => {
        setEnrolmentId('');
        setCourseRunId('');
        setResult(null);
        setError(null);
    };

    const isFormValid = enrolmentId.trim() && courseRunId.trim();

    return (
        <div>
            <h2 className="text-3xl font-bold mb-6 dark:text-white">Update Enrolment</h2>

            <Card className="p-6 mb-6">
                <h3 className="text-lg font-bold text-gray-700 dark:text-gray-200 mb-4">Enrolment Details</h3>
                <p className="text-sm text-gray-600 dark:text-gray-400 mb-4">
                    Enter the Enrolment ID and the new Course Run ID to update the enrolment on SSG.
                </p>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
                    <div>
                        <label className="block text-sm font-bold text-gray-700 dark:text-gray-300 mb-1">
                            Enrolment ID <span className="text-red-500">*</span>
                        </label>
                        <input type="text" value={enrolmentId} onChange={(e) => setEnrolmentId(e.target.value)}
                            placeholder="e.g. ENR-2602-014784" className={inputClasses} disabled={isSubmitting} />
                    </div>
                    <div>
                        <label className="block text-sm font-bold text-gray-700 dark:text-gray-300 mb-1">
                            Course Run ID <span className="text-red-500">*</span>
                        </label>
                        <input type="text" value={courseRunId} onChange={(e) => setCourseRunId(e.target.value)}
                            placeholder="e.g. 1225151" className={inputClasses} disabled={isSubmitting} />
                    </div>
                </div>

                <div className="flex gap-3">
                    <Button onClick={handleSubmit} disabled={isSubmitting || !isFormValid}>
                        {isSubmitting ? (
                            <div className="flex items-center">
                                <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white mr-2"></div>
                                Updating...
                            </div>
                        ) : (
                            <><Icon name={IconName.Edit} className="w-4 h-4 mr-2" />Update Enrolment</>
                        )}
                    </Button>
                    <Button variant="outline" onClick={handleClear} disabled={isSubmitting}>Clear</Button>
                </div>

                {error && !result && (
                    <p className="text-red-500 text-sm mt-3">{error}</p>
                )}
            </Card>

            {isSubmitting && (
                <div className="flex justify-center py-10">
                    <div className="text-center">
                        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-500 mx-auto"></div>
                        <p className="mt-4 text-gray-600 dark:text-gray-400">Processing update...</p>
                    </div>
                </div>
            )}

            {!isSubmitting && result && (
                <Card className="p-6">
                    {error ? (
                        <div className="bg-red-50 dark:bg-red-900/20 border-l-4 border-red-500 dark:border-red-600 rounded-r-lg p-4">
                            <div className="flex items-center gap-2 mb-2">
                                <Icon name={IconName.X} className="w-5 h-5 text-red-600 dark:text-red-400" />
                                <h4 className="font-semibold text-red-900 dark:text-red-200">Update Failed</h4>
                            </div>
                            <p className="text-sm text-red-800 dark:text-red-300 pl-7">{error}</p>
                        </div>
                    ) : (
                        <div className="bg-green-50 dark:bg-green-900/20 border-l-4 border-green-500 dark:border-green-600 rounded-r-lg p-4">
                            <div className="flex items-center gap-2 mb-2">
                                <Icon name={IconName.CheckCircle} className="w-5 h-5 text-green-600 dark:text-green-400" />
                                <h4 className="font-semibold text-green-900 dark:text-green-200">Enrolment Updated Successfully</h4>
                            </div>
                            <div className="pl-7 space-y-1">
                                {(result?.enrolment?.referenceNumber ?? result?.data?.enrolment?.referenceNumber) && (
                                    <p className="text-sm text-green-700 dark:text-green-300">
                                        <span className="font-medium">Reference:</span>{' '}
                                        <span className="font-mono bg-green-100 dark:bg-green-900/40 px-2 py-0.5 rounded">
                                            {result?.enrolment?.referenceNumber ?? result?.data?.enrolment?.referenceNumber}
                                        </span>
                                    </p>
                                )}
                                {(result?.enrolment?.status ?? result?.data?.enrolment?.status) && (
                                    <p className="text-sm text-green-700 dark:text-green-300">
                                        <span className="font-medium">Status:</span> {result?.enrolment?.status ?? result?.data?.enrolment?.status}
                                    </p>
                                )}
                            </div>
                        </div>
                    )}
                    <details className="mt-4">
                        <summary className="text-sm text-gray-500 dark:text-gray-400 cursor-pointer hover:text-gray-700 dark:hover:text-gray-300">
                            View Raw Response
                        </summary>
                        <pre className="mt-2 text-xs bg-gray-100 dark:bg-gray-800 p-3 rounded overflow-auto max-h-60">
                            {JSON.stringify(result, null, 2)}
                        </pre>
                    </details>
                </Card>
            )}
        </div>
    );
};

// Delete Course Run View
export const DeleteCourseRunView: React.FC = () => {
    const [courseReferenceNumber, setCourseReferenceNumber] = useState<string>('');
    const [courseRunId, setCourseRunId] = useState<string>('');
    const [isSubmitting, setIsSubmitting] = useState(false);
    const [result, setResult] = useState<any>(null);
    const [error, setError] = useState<string | null>(null);
    const [showConfirm, setShowConfirm] = useState(false);

    const inputClasses = "block w-full px-3 py-2 text-on-surface bg-white border border-gray-300 rounded-md shadow-sm placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent dark:bg-gray-700 dark:border-gray-600 dark:text-white dark:placeholder-gray-500";

    const handleSubmit = async () => {
        setShowConfirm(false);
        setIsSubmitting(true);
        setError(null);
        setResult(null);

        try {
            const response = await fetch('/api/admin/ssg-delete-course-run', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    courseReferenceNumber: courseReferenceNumber.trim(),
                    courseRunId: courseRunId.trim(),
                }),
            });

            const data = await response.json();

            if (!response.ok) {
                setError(data?.error || `Failed to delete course run (${response.status})`);
                setResult(data);
                return;
            }

            setResult(data);
        } catch (err) {
            console.error('❌ Error deleting course run:', err);
            setError(err instanceof Error ? err.message : 'Failed to delete course run');
        } finally {
            setIsSubmitting(false);
        }
    };

    const handleClear = () => {
        setCourseReferenceNumber('');
        setCourseRunId('');
        setResult(null);
        setError(null);
        setShowConfirm(false);
    };

    const isFormValid = courseReferenceNumber.trim() && courseRunId.trim();

    return (
        <div>
            <h2 className="text-3xl font-bold mb-6 dark:text-white">Delete Course Run</h2>

            {/* Input Form Card */}
            <Card className="p-6 mb-6">
                <h3 className="text-lg font-bold text-gray-700 dark:text-gray-200 mb-4">Course Run Details</h3>
                <p className="text-sm text-gray-600 dark:text-gray-400 mb-4">
                    Both Course Reference Number and Course Run ID are required to delete a course run.
                </p>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
                    <div>
                        <label htmlFor="delete-course-ref" className="block text-sm font-bold text-gray-700 dark:text-gray-300 mb-1">
                            Course Reference Number <span className="text-red-500">*</span>
                        </label>
                        <input
                            id="delete-course-ref"
                            type="text"
                            value={courseReferenceNumber}
                            onChange={(e) => setCourseReferenceNumber(e.target.value)}
                            placeholder="e.g. TGS-2024052076"
                            className={inputClasses}
                            disabled={isSubmitting}
                        />
                    </div>
                    <div>
                        <label htmlFor="delete-course-run-id" className="block text-sm font-bold text-gray-700 dark:text-gray-300 mb-1">
                            Course Run ID <span className="text-red-500">*</span>
                        </label>
                        <input
                            id="delete-course-run-id"
                            type="text"
                            value={courseRunId}
                            onChange={(e) => setCourseRunId(e.target.value)}
                            placeholder="e.g. 1225151"
                            className={inputClasses}
                            disabled={isSubmitting}
                        />
                    </div>
                </div>

                <div className="flex gap-3">
                    {!showConfirm ? (
                        <Button
                            onClick={() => setShowConfirm(true)}
                            disabled={isSubmitting || !isFormValid}
                        >
                            {isSubmitting ? (
                                <div className="flex items-center">
                                    <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white mr-2"></div>
                                    Deleting...
                                </div>
                            ) : (
                                <>
                                    <Icon name={IconName.X} className="w-4 h-4 mr-2" />
                                    Delete Course Run
                                </>
                            )}
                        </Button>
                    ) : (
                        <div className="flex items-center gap-3">
                            <span className="text-sm text-red-600 dark:text-red-400 font-medium">
                                Are you sure you want to delete this course run?
                            </span>
                            <Button onClick={handleSubmit}>
                                Yes, Delete It
                            </Button>
                            <Button variant="outline" onClick={() => setShowConfirm(false)}>
                                No, Go Back
                            </Button>
                        </div>
                    )}
                    <Button variant="outline" onClick={handleClear} disabled={isSubmitting}>
                        Clear
                    </Button>
                </div>

                {error && !result && (
                    <p className="text-red-500 text-sm mt-3">{error}</p>
                )}
            </Card>

            {/* Loading State */}
            {isSubmitting && (
                <div className="flex justify-center py-10">
                    <div className="text-center">
                        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-500 mx-auto"></div>
                        <p className="mt-4 text-gray-600 dark:text-gray-400">Processing deletion...</p>
                    </div>
                </div>
            )}

            {/* Result Display */}
            {!isSubmitting && result && (
                <Card className="p-6">
                    {error ? (
                        <div className="bg-red-50 dark:bg-red-900/20 border-l-4 border-red-500 dark:border-red-600 rounded-r-lg p-4">
                            <div className="flex items-center gap-2 mb-2">
                                <Icon name={IconName.X} className="w-5 h-5 text-red-600 dark:text-red-400" />
                                <h4 className="font-semibold text-red-900 dark:text-red-200">Fail To Delete Course Run</h4>
                            </div>
                            <p className="text-sm text-red-800 dark:text-red-300 pl-7">{error}</p>
                        </div>
                    ) : (
                        <div className="bg-green-50 dark:bg-green-900/20 border-l-4 border-green-500 dark:border-green-600 rounded-r-lg p-4">
                            <div className="flex items-center gap-2 mb-2">
                                <Icon name={IconName.CheckCircle} className="w-5 h-5 text-green-600 dark:text-green-400" />
                                <h4 className="font-semibold text-green-900 dark:text-green-200">Course Run Deleted Successfully</h4>
                            </div>
                            <div className="pl-7 space-y-1">
                                <p className="text-sm text-green-700 dark:text-green-300">
                                    <span className="font-medium">Course Reference:</span>{' '}
                                    <span className="font-mono bg-green-100 dark:bg-green-900/40 px-2 py-0.5 rounded">
                                        {courseReferenceNumber}
                                    </span>
                                </p>
                                <p className="text-sm text-green-700 dark:text-green-300">
                                    <span className="font-medium">Course Run ID:</span>{' '}
                                    <span className="font-mono bg-green-100 dark:bg-green-900/40 px-2 py-0.5 rounded">
                                        {courseRunId}
                                    </span>
                                </p>
                            </div>
                        </div>
                    )}

                    {/* Raw Response (collapsible) */}
                    <details className="mt-4">
                        <summary className="text-sm text-gray-500 dark:text-gray-400 cursor-pointer hover:text-gray-700 dark:hover:text-gray-300">
                            View Raw Response
                        </summary>
                        <pre className="mt-2 text-xs bg-gray-100 dark:bg-gray-800 p-3 rounded overflow-auto max-h-60">
                            {JSON.stringify(result, null, 2)}
                        </pre>
                    </details>
                </Card>
            )}
        </div>
    );
};

// Export assessment views from separate file
export { SearchAssessmentsView, ViewAssessmentView } from './AssessmentViews';

// ─── Course Sessions View ─────────────────────────────────────────────────────

export const CourseSessionsView: React.FC = () => {
    const { trainingProviderProfile, selectedCourseRunId, setSelectedCourseRunId } = useLms();
    const [courseRunId, setCourseRunId] = useState<string>(selectedCourseRunId || '');
    const [isSearching, setIsSearching] = useState(false);
    const [searchError, setSearchError] = useState<string | null>(null);
    const [sessions, setSessions] = useState<any[]>([]);
    const [runInfo, setRunInfo] = useState<any>(null);
    const [courseTitle, setCourseTitle] = useState<string>('');

    // Delete state
    const [deletingSessionId, setDeletingSessionId] = useState<string | null>(null);
    const [isDeletingAll, setIsDeletingAll] = useState(false);
    const [deleteResults, setDeleteResults] = useState<{ success: number; failed: number; message: string } | null>(null);

    const activeSessions = sessions.filter(s => !s.deleted);

    useEffect(() => {
        if (selectedCourseRunId) {
            setCourseRunId(selectedCourseRunId);
            fetchSessions(selectedCourseRunId);
            setSelectedCourseRunId(null);
        }
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    const toDateStr = (v: any): string => {
        if (!v) return '';
        const s = String(v);
        if (/^\d{8}$/.test(s)) return `${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)}`;
        return s;
    };

    const buildDeleteBody = (sessionsToDelete: any[], info: any) => {
        const run = info.run;
        return {
            courseReferenceNumber: info.courseData?.referenceNumber || info.courseData?.externalReferenceNumber || '',
            openingRegistrationDate: toDateStr(run?.registrationOpeningDate ?? run?.registrationDates?.opening),
            closingRegistrationDate: toDateStr(run?.registrationClosingDate ?? run?.registrationDates?.closing),
            courseStartDate: toDateStr(run?.courseStartDate ?? run?.courseDates?.start),
            courseEndDate: toDateStr(run?.courseEndDate ?? run?.courseDates?.end),
            scheduleInfoTypeCode: '01',
            scheduleInfoTypeDescription: 'Description',
            block: run?.venue?.block || '',
            street: run?.venue?.street || '',
            floor: run?.venue?.floor || '',
            unit: run?.venue?.unit || '',
            building: run?.venue?.building || '',
            postalCode: run?.venue?.postalCode || '',
            room: run?.venue?.room || '',
            wheelChairAccess: run?.venue?.wheelChairAccess ?? false,
            courseAdminEmail: run?.courseAdminEmail || '',
            courseVacancy: run?.courseVacancy || { code: 'A', description: 'Available' },
            fileName: '',
            fileContent: '',
            sessions: sessionsToDelete.map(s => ({
                sessionId: s.id,
                startDate: String(s.startDate || ''),
                endDate: String(s.endDate || ''),
                startTime: s.startTime || '',
                endTime: s.endTime || '',
                modeOfTraining: String(s.modeOfTraining || ''),
                venue: s.venue || {},
            })),
        };
    };

    const fetchSessions = async (runId: string) => {
        setIsSearching(true);
        setSearchError(null);
        setSessions([]);
        setRunInfo(null);
        setCourseTitle('');
        setDeleteResults(null);

        try {
            // Step 1: SSG viewCourseRun → get course reference number + full run details
            const viewRes = await fetch(`/api/course-runs/view?courseRunId=${encodeURIComponent(runId)}`);
            const viewData = await viewRes.json();
            if (!viewData?.success || !viewData?.data?.course) {
                throw new Error(viewData?.error || `Course run ${runId} not found in SSG.`);
            }

            const courseData = viewData.data.course;
            const run = courseData.run;
            const courseCode = courseData.referenceNumber || courseData.externalReferenceNumber || '';
            const title = courseData.title || courseCode;

            if (!courseCode) throw new Error('Could not determine course reference number from SSG response.');

            setCourseTitle(title);
            setRunInfo({ courseData, run });

            // Step 2: fetch sessions using course code + UEN
            const uen = trainingProviderProfile?.uen || '';
            const params = new URLSearchParams({ courseCode, uen });
            const sessRes = await fetch(`/api/ssg/courses/runs/${encodeURIComponent(runId)}/sessions?${params}`);
            const sessData = await sessRes.json();

            if (!sessRes.ok) {
                if (sessRes.status === 404) {
                    // No sessions registered yet — show empty state, not error
                    setSessions([]);
                } else {
                    throw new Error(sessData.error || `Sessions fetch failed (${sessRes.status})`);
                }
            } else {
                const sessionList = sessData?.data?.result?.sessions ?? sessData?.data?.sessions ?? [];
                setSessions(sessionList);
            }
        } catch (err) {
            setSearchError(err instanceof Error ? err.message : 'Failed to fetch sessions.');
        } finally {
            setIsSearching(false);
        }
    };

    const handleFetch = () => {
        if (!courseRunId.trim()) return;
        fetchSessions(courseRunId.trim());
    };

    const handleDeleteOne = async (session: any) => {
        if (!confirm(`Delete session ${session.id}?\n\nDate: ${formatDate(session.startDate)}  ${session.startTime} – ${session.endTime}\n\nThis cannot be undone.`)) return;

        setDeletingSessionId(session.id);
        setDeleteResults(null);
        try {
            if (!runInfo) {
                setDeleteResults({ success: 0, failed: 1, message: 'Run info not loaded. Please fetch sessions again.' });
                return;
            }
            const body = buildDeleteBody([session], runInfo);
            const res = await fetch(
                `/api/ssg/courses/courseRuns/${encodeURIComponent(courseRunId.trim())}?action=delete-sessions`,
                { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }
            );
            const result = await res.json();
            if (!res.ok) {
                const msg = result?.details?.[0] || result?.message || result?.error?.message || `SSG error ${res.status}`;
                setDeleteResults({ success: 0, failed: 1, message: typeof msg === 'string' ? msg : JSON.stringify(msg) });
            } else {
                setDeleteResults({ success: 1, failed: 0, message: `Session ${session.id} deleted successfully.` });
                await fetchSessions(courseRunId.trim());
            }
        } catch (err) {
            setDeleteResults({ success: 0, failed: 1, message: err instanceof Error ? err.message : 'Unknown error' });
        } finally {
            setDeletingSessionId(null);
        }
    };

    const handleDeleteAll = async () => {
        if (activeSessions.length === 0) return;
        if (!confirm(`Delete ALL ${activeSessions.length} active session(s) for this course run?\n\nThis cannot be undone.`)) return;

        setIsDeletingAll(true);
        setDeleteResults(null);
        try {
            if (!runInfo) {
                setDeleteResults({ success: 0, failed: activeSessions.length, message: 'Run info not loaded. Please fetch sessions again.' });
                return;
            }
            const body = buildDeleteBody(activeSessions, runInfo);
            const res = await fetch(
                `/api/ssg/courses/courseRuns/${encodeURIComponent(courseRunId.trim())}?action=delete-sessions`,
                { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }
            );
            const result = await res.json();
            if (!res.ok) {
                const msg = result?.details?.[0] || result?.message || result?.error?.message || `SSG error ${res.status}`;
                setDeleteResults({ success: 0, failed: activeSessions.length, message: typeof msg === 'string' ? msg : JSON.stringify(msg) });
            } else {
                setDeleteResults({ success: activeSessions.length, failed: 0, message: `All ${activeSessions.length} session(s) deleted successfully.` });
                await fetchSessions(courseRunId.trim());
            }
        } catch (err) {
            setDeleteResults({ success: 0, failed: activeSessions.length, message: err instanceof Error ? err.message : 'Unknown error' });
        } finally {
            setIsDeletingAll(false);
        }
    };

    const isDeleting = !!deletingSessionId || isDeletingAll;

    return (
        <div className="max-w-7xl mx-auto p-6">
            <h2 className="text-3xl font-bold mb-6 dark:text-white">Course Sessions</h2>

            {/* Lookup */}
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
                            onChange={e => { setCourseRunId(e.target.value); setSessions([]); setRunInfo(null); setSearchError(null); }}
                            onKeyDown={e => e.key === 'Enter' && !isSearching && courseRunId.trim() && handleFetch()}
                            placeholder="e.g. 1289568"
                            className={inputClasses}
                            disabled={isSearching}
                        />
                    </div>
                    <Button onClick={handleFetch} disabled={isSearching || !courseRunId.trim()}>
                        {isSearching ? (
                            <div className="flex items-center gap-2">
                                <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white" />
                                Fetching...
                            </div>
                        ) : (
                            <><Icon name={IconName.Search} className="w-4 h-4 mr-2" />Fetch Sessions</>
                        )}
                    </Button>
                </div>

                {courseTitle && !isSearching && (
                    <div className="mt-3 p-3 bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-700 rounded-lg text-sm text-green-800 dark:text-green-300">
                        ✓ <strong>{courseTitle}</strong> — {sessions.length} session{sessions.length !== 1 ? 's' : ''} found
                        {activeSessions.length < sessions.length && ` (${activeSessions.length} active)`}
                    </div>
                )}
            </Card>

            {/* Error */}
            {searchError && !isSearching && (
                <Card className="p-6 mb-6 border-red-200 dark:border-red-700">
                    <div className="flex items-start gap-3">
                        <div className="flex-shrink-0 w-10 h-10 rounded-full bg-red-100 dark:bg-red-900/40 flex items-center justify-center">
                            <Icon name={IconName.Close} className="w-5 h-5 text-red-600 dark:text-red-400" />
                        </div>
                        <div>
                            <h3 className="text-lg font-bold text-red-700 dark:text-red-400">Failed to Retrieve Sessions</h3>
                            <p className="text-sm text-gray-600 dark:text-gray-400 mt-1">{searchError}</p>
                        </div>
                    </div>
                </Card>
            )}

            {/* Delete result banner */}
            {deleteResults && (
                <div className={`mb-4 p-4 rounded-lg border text-sm flex items-start gap-3 ${deleteResults.failed === 0 ? 'bg-green-50 border-green-200 dark:bg-green-900/20 dark:border-green-700' : 'bg-red-50 border-red-200 dark:bg-red-900/20 dark:border-red-700'}`}>
                    <span className={deleteResults.failed === 0 ? 'text-green-600 dark:text-green-400' : 'text-red-600 dark:text-red-400'}>
                        {deleteResults.failed === 0 ? '✓' : '✗'}
                    </span>
                    <span className={deleteResults.failed === 0 ? 'text-green-800 dark:text-green-300' : 'text-red-800 dark:text-red-300'}>
                        {deleteResults.message}
                    </span>
                    <button onClick={() => setDeleteResults(null)} className="ml-auto text-gray-400 hover:text-gray-600 dark:hover:text-gray-300">✕</button>
                </div>
            )}

            {/* Course run info summary */}
            {runInfo && !isSearching && !searchError && (
                <Card className="p-5 mb-6">
                    <h3 className="text-sm font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide mb-3">Course Run Details</h3>
                    <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
                        <div>
                            <p className="text-xs text-gray-500 dark:text-gray-400">Course Reference</p>
                            <p className="font-mono font-medium text-gray-900 dark:text-white">{runInfo.courseData?.referenceNumber || '—'}</p>
                        </div>
                        <div>
                            <p className="text-xs text-gray-500 dark:text-gray-400">Mode of Training</p>
                            <p className="font-medium text-gray-900 dark:text-white">{modeOfTrainingLabel(runInfo.run?.modeOfTraining)}</p>
                        </div>
                        <div>
                            <p className="text-xs text-gray-500 dark:text-gray-400">Course Start</p>
                            <p className="font-medium text-gray-900 dark:text-white">{formatDate(String(runInfo.run?.courseStartDate || ''))}</p>
                        </div>
                        <div>
                            <p className="text-xs text-gray-500 dark:text-gray-400">Course End</p>
                            <p className="font-medium text-gray-900 dark:text-white">{formatDate(String(runInfo.run?.courseEndDate || ''))}</p>
                        </div>
                        <div>
                            <p className="text-xs text-gray-500 dark:text-gray-400">Venue</p>
                            <p className="font-medium text-gray-900 dark:text-white">
                                {[runInfo.run?.venue?.floor && `Floor ${runInfo.run.venue.floor}`, runInfo.run?.venue?.unit && `#${runInfo.run.venue.unit}`, runInfo.run?.venue?.building].filter(Boolean).join(' · ') || '—'}
                            </p>
                        </div>
                        <div>
                            <p className="text-xs text-gray-500 dark:text-gray-400">Vacancy</p>
                            <p className="font-medium text-gray-900 dark:text-white">{runInfo.run?.courseVacancy?.description || '—'}</p>
                        </div>
                        <div>
                            <p className="text-xs text-gray-500 dark:text-gray-400">Admin Email</p>
                            <p className="font-medium text-gray-900 dark:text-white truncate">{runInfo.run?.courseAdminEmail || '—'}</p>
                        </div>
                        <div>
                            <p className="text-xs text-gray-500 dark:text-gray-400">Registered</p>
                            <p className="font-medium text-gray-900 dark:text-white">{runInfo.run?.registeredUserCount ?? '—'}</p>
                        </div>
                    </div>
                </Card>
            )}

            {/* No sessions state */}
            {sessions.length === 0 && courseTitle && !isSearching && !searchError && (
                <Card className="p-6 mb-6">
                    <div className="text-center py-6 text-gray-500 dark:text-gray-400">
                        <p className="font-medium text-gray-700 dark:text-gray-300 mb-1">No Sessions Found</p>
                        <p className="text-sm">No sessions have been registered for this course run in SSG yet.</p>
                    </div>
                </Card>
            )}

            {/* Sessions table */}
            {sessions.length > 0 && !isSearching && (
                <Card className="p-6">
                    <div className="flex items-center justify-between mb-4">
                        <h3 className="text-lg font-bold text-gray-700 dark:text-gray-200">Sessions</h3>
                        <span className="text-sm text-gray-500 dark:text-gray-400">
                            {sessions.length} total · {activeSessions.length} active
                        </span>
                    </div>

                    <div className="overflow-x-auto">
                        <table className="min-w-full text-sm">
                            <thead>
                                <tr className="border-b border-gray-200 dark:border-gray-700 text-left">
                                    <th className="pb-3 pr-4 font-semibold text-gray-600 dark:text-gray-300">#</th>
                                    <th className="pb-3 pr-4 font-semibold text-gray-600 dark:text-gray-300">Session ID</th>
                                    <th className="pb-3 pr-4 font-semibold text-gray-600 dark:text-gray-300">Date</th>
                                    <th className="pb-3 pr-4 font-semibold text-gray-600 dark:text-gray-300">Time</th>
                                    <th className="pb-3 pr-4 font-semibold text-gray-600 dark:text-gray-300">Mode</th>
                                    <th className="pb-3 pr-4 font-semibold text-gray-600 dark:text-gray-300">Attendance</th>
                                    <th className="pb-3 pr-4 font-semibold text-gray-600 dark:text-gray-300">Status</th>
                                    <th className="pb-3 font-semibold text-gray-600 dark:text-gray-300">Action</th>
                                </tr>
                            </thead>
                            <tbody>
                                {sessions.map((session: any, idx: number) => (
                                    <tr
                                        key={session.id}
                                        className={`border-b border-gray-100 dark:border-gray-800 align-top ${session.deleted ? 'opacity-40' : 'hover:bg-gray-50 dark:hover:bg-gray-800/50'}`}
                                    >
                                        <td className="py-3 pr-4 text-gray-500 dark:text-gray-400">{idx + 1}</td>
                                        <td className="py-3 pr-4 font-mono text-xs text-gray-700 dark:text-gray-300">{session.id}</td>
                                        <td className="py-3 pr-4 text-gray-900 dark:text-white whitespace-nowrap">
                                            {formatDate(session.startDate)}
                                            {session.startDate !== session.endDate && (
                                                <span className="text-gray-500"> – {formatDate(session.endDate)}</span>
                                            )}
                                        </td>
                                        <td className="py-3 pr-4 text-gray-900 dark:text-white whitespace-nowrap">
                                            {session.startTime} – {session.endTime}
                                        </td>
                                        <td className="py-3 pr-4 text-gray-700 dark:text-gray-300 whitespace-nowrap">
                                            {modeOfTrainingLabel(session.modeOfTraining)}
                                        </td>
                                        <td className="py-3 pr-4">
                                            <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium border ${session.attendanceTaken ? 'bg-green-100 text-green-800 border-green-200' : 'bg-gray-100 text-gray-700 border-gray-200'}`}>
                                                {session.attendanceTaken ? 'Taken' : 'Not Taken'}
                                            </span>
                                        </td>
                                        <td className="py-3 pr-4">
                                            <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium border ${session.deleted ? 'bg-red-100 text-red-800 border-red-200' : 'bg-blue-100 text-blue-800 border-blue-200'}`}>
                                                {session.deleted ? 'Deleted' : 'Active'}
                                            </span>
                                        </td>
                                        <td className="py-3">
                                            {!session.deleted && (
                                                <button
                                                    onClick={() => handleDeleteOne(session)}
                                                    disabled={isDeleting}
                                                    className="inline-flex items-center px-2 py-1 rounded text-xs font-medium bg-red-50 text-red-700 border border-red-200 hover:bg-red-100 disabled:opacity-50 disabled:cursor-not-allowed dark:bg-red-900/20 dark:text-red-400 dark:border-red-700 dark:hover:bg-red-900/40"
                                                >
                                                    {deletingSessionId === session.id ? (
                                                        <div className="flex items-center gap-1">
                                                            <div className="animate-spin rounded-full h-3 w-3 border-b-2 border-red-600" />
                                                            Deleting...
                                                        </div>
                                                    ) : 'Delete'}
                                                </button>
                                            )}
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>

                    {/* Delete All */}
                    {activeSessions.length > 0 && (
                        <div className="mt-6 pt-4 border-t border-gray-200 dark:border-gray-700 flex items-center justify-between">
                            <p className="text-sm text-gray-500 dark:text-gray-400">
                                {activeSessions.length} active session{activeSessions.length !== 1 ? 's' : ''} will be deleted
                            </p>
                            <button
                                onClick={handleDeleteAll}
                                disabled={isDeleting}
                                className="inline-flex items-center px-4 py-2 rounded-lg text-sm font-medium bg-red-600 text-white hover:bg-red-700 disabled:opacity-50 disabled:cursor-not-allowed"
                            >
                                {isDeletingAll ? (
                                    <div className="flex items-center gap-2">
                                        <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white" />
                                        Deleting All...
                                    </div>
                                ) : `Delete All ${activeSessions.length} Sessions`}
                            </button>
                        </div>
                    )}
                </Card>
            )}
        </div>
    );
};

// ─── Course Session Attendance View ───────────────────────────────────────────

const formatDate = (yyyymmdd: string): string => {
    if (!yyyymmdd || yyyymmdd.length !== 8) return yyyymmdd;
    return `${yyyymmdd.slice(6, 8)}/${yyyymmdd.slice(4, 6)}/${yyyymmdd.slice(0, 4)}`;
};

const modeOfTrainingLabel = (code: string): string => {
    const map: Record<string, string> = {
        '1': 'Classroom',
        '2': 'Asynchronous eLearning',
        '3': 'In-house',
        '4': 'On-the-Job',
        '5': 'Practical / Practicum',
        '6': 'Supervised Field',
        '7': 'Traineeship',
        '8': 'Assessment',
        '9': 'Synchronous eLearning',
    };
    return map[code] || code;
};

export const CourseSessionAttendanceView: React.FC = () => {
    const { trainingProviderProfile } = useLms();
    const [uen, setUen] = useState<string>(trainingProviderProfile?.uen || '');
    const [courseCode, setCourseCode] = useState<string>('');
    const [sessionId, setSessionId] = useState<string>('');
    const [courseRunId, setCourseRunId] = useState<string>('');
    const [isSearching, setIsSearching] = useState(false);
    const [searchError, setSearchError] = useState<string | null>(null);
    const [notFound, setNotFound] = useState(false);
    const [parsedData, setParsedData] = useState<any>(null);

    const isFormValid = uen.trim() && courseCode.trim() && sessionId.trim() && courseRunId.trim();

    const handleSearch = async () => {
        if (!isFormValid) {
            setSearchError('Please fill in all fields.');
            return;
        }

        setIsSearching(true);
        setSearchError(null);
        setNotFound(false);
        setParsedData(null);

        try {
            const params = new URLSearchParams({
                uen: uen.trim(),
                courseCode: courseCode.trim(),
                courseRunId: courseRunId.trim(),
                sessionId: sessionId.trim(),
            });

            const response = await fetch(`/api/ssg/session-attendance?${params}`);
            const data = await response.json();

            if (!data.success) {
                if (response.status === 404) {
                    setNotFound(true);
                } else {
                    setSearchError(data.error || 'Failed to fetch attendance data.');
                }
                return;
            }

            setParsedData(data.data);
        } catch (err) {
            setSearchError(err instanceof Error ? err.message : 'Failed to fetch attendance data.');
        } finally {
            setIsSearching(false);
        }
    };

    const handleClear = () => {
        setUen(trainingProviderProfile?.uen || '');
        setCourseCode('');
        setSessionId('');
        setCourseRunId('');
        setSearchError(null);
        setNotFound(false);
        setParsedData(null);
    };

    // API returns decrypted SSG data directly — handle both possible nesting levels
    const courseRun = parsedData?.data?.courseRun ?? parsedData?.courseRun;
    const session = courseRun?.sessions?.[0];
    const attendance: any[] = session?.attendance ?? [];
    const trainees = attendance.filter((a) => a.trainee?.attendeeType === 'Trainee');
    const trainers = attendance.filter((a) => a.trainee?.attendeeType === 'Trainer');

    return (
        <div>
            <h2 className="text-3xl font-bold mb-6 dark:text-white">Course Session Attendance</h2>

            {/* Search Parameters Card */}
            <Card className="p-6 mb-6">
                <h3 className="text-lg font-bold text-gray-700 dark:text-gray-200 mb-4">Search Parameters</h3>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
                    <div>
                        <label className="block text-sm font-bold text-gray-700 dark:text-gray-300 mb-1">
                            Company UEN <span className="text-red-500">*</span>
                        </label>
                        <input
                            type="text"
                            value={uen}
                            onChange={(e) => setUen(e.target.value)}
                            placeholder="e.g. 201200696W"
                            className={inputClasses}
                            disabled={isSearching}
                        />
                    </div>
                    <div>
                        <label className="block text-sm font-bold text-gray-700 dark:text-gray-300 mb-1">
                            Course Code <span className="text-red-500">*</span>
                        </label>
                        <input
                            type="text"
                            value={courseCode}
                            onChange={(e) => setCourseCode(e.target.value)}
                            placeholder="e.g. TGS-2019503161"
                            className={inputClasses}
                            disabled={isSearching}
                        />
                    </div>
                    <div>
                        <label className="block text-sm font-bold text-gray-700 dark:text-gray-300 mb-1">
                            Session ID <span className="text-red-500">*</span>
                        </label>
                        <input
                            type="text"
                            value={sessionId}
                            onChange={(e) => setSessionId(e.target.value)}
                            placeholder="e.g. TGS-2019503161-1289568-S1"
                            className={inputClasses}
                            disabled={isSearching}
                        />
                    </div>
                    <div>
                        <label className="block text-sm font-bold text-gray-700 dark:text-gray-300 mb-1">
                            Course Run ID <span className="text-red-500">*</span>
                        </label>
                        <input
                            type="text"
                            value={courseRunId}
                            onChange={(e) => setCourseRunId(e.target.value)}
                            placeholder="e.g. 1289568"
                            className={inputClasses}
                            disabled={isSearching}
                        />
                    </div>
                </div>

                <div className="flex gap-3 justify-end">
                    <Button
                        onClick={handleClear}
                        disabled={isSearching}
                        className="bg-gray-100 text-gray-700 hover:bg-gray-200 dark:bg-gray-700 dark:text-gray-200 dark:hover:bg-gray-600"
                    >
                        Clear
                    </Button>
                    <Button
                        onClick={handleSearch}
                        disabled={isSearching || !isFormValid}
                    >
                        {isSearching ? (
                            <div className="flex items-center">
                                <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white mr-2"></div>
                                Fetching...
                            </div>
                        ) : (
                            <>
                                <Icon name={IconName.Search} className="w-4 h-4 mr-2" />
                                Fetch Attendance
                            </>
                        )}
                    </Button>
                </div>

                {searchError && (
                    <p className="text-red-500 text-sm mt-3">{searchError}</p>
                )}
            </Card>

            {/* Loading */}
            {isSearching && (
                <div className="flex justify-center py-10">
                    <div className="text-center">
                        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-500 mx-auto"></div>
                        <p className="mt-4 text-gray-600 dark:text-gray-400">Fetching attendance data...</p>
                    </div>
                </div>
            )}

            {/* Not Found Error */}
            {notFound && !parsedData && !isSearching && (
                <Card className="p-6 border-red-200 dark:border-red-700">
                    <div className="flex items-start gap-3">
                        <div className="flex-shrink-0 w-10 h-10 rounded-full bg-red-100 dark:bg-red-900/40 flex items-center justify-center">
                            <Icon name={IconName.Close} className="w-5 h-5 text-red-600 dark:text-red-400" />
                        </div>
                        <div>
                            <h3 className="text-lg font-bold text-red-700 dark:text-red-400">Attendance Not Found</h3>
                            <p className="text-sm text-gray-600 dark:text-gray-400 mt-1">
                                No course session attendance record could be found for the provided details.
                            </p>
                        </div>
                    </div>
                </Card>
            )}

            {/* Success Results */}
            {parsedData && !isSearching && (
                <div className="space-y-6">
                    {/* Course Run Info */}
                    {courseRun && (
                    <Card className="p-6">
                        <h3 className="text-lg font-bold text-gray-700 dark:text-gray-200 mb-4">Course Run Details</h3>
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-sm">
                            <div>
                                <span className="font-medium text-gray-500 dark:text-gray-400">Title</span>
                                <p className="text-gray-900 dark:text-white font-semibold mt-0.5">{courseRun.title}</p>
                            </div>
                            <div>
                                <span className="font-medium text-gray-500 dark:text-gray-400">Reference Number</span>
                                <p className="text-gray-900 dark:text-white font-mono mt-0.5">{courseRun.referenceNumber}</p>
                            </div>
                            <div>
                                <span className="font-medium text-gray-500 dark:text-gray-400">Course Run ID</span>
                                <p className="text-gray-900 dark:text-white font-mono mt-0.5">{courseRun.id}</p>
                            </div>
                            <div>
                                <span className="font-medium text-gray-500 dark:text-gray-400">Mode of Training</span>
                                <p className="text-gray-900 dark:text-white mt-0.5">{modeOfTrainingLabel(courseRun.modeOfTraining)}</p>
                            </div>
                            <div>
                                <span className="font-medium text-gray-500 dark:text-gray-400">Course Start Date</span>
                                <p className="text-gray-900 dark:text-white mt-0.5">{formatDate(courseRun.courseDates?.start)}</p>
                            </div>
                            <div>
                                <span className="font-medium text-gray-500 dark:text-gray-400">Course End Date</span>
                                <p className="text-gray-900 dark:text-white mt-0.5">{formatDate(courseRun.courseDates?.end)}</p>
                            </div>
                        </div>
                    </Card>
                    )}

                    {/* Session Info */}
                    {session && (
                        <Card className="p-6">
                            <h3 className="text-lg font-bold text-gray-700 dark:text-gray-200 mb-4">Session Details</h3>
                            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-sm mb-4">
                                <div>
                                    <span className="font-medium text-gray-500 dark:text-gray-400">Session ID</span>
                                    <p className="text-gray-900 dark:text-white font-mono mt-0.5">{session.id}</p>
                                </div>
                                <div>
                                    <span className="font-medium text-gray-500 dark:text-gray-400">Date</span>
                                    <p className="text-gray-900 dark:text-white mt-0.5">
                                        {formatDate(session.startDate)}{session.startDate !== session.endDate ? ` – ${formatDate(session.endDate)}` : ''}
                                    </p>
                                </div>
                                <div>
                                    <span className="font-medium text-gray-500 dark:text-gray-400">Time</span>
                                    <p className="text-gray-900 dark:text-white mt-0.5">{session.startTime} – {session.endTime}</p>
                                </div>
                                <div>
                                    <span className="font-medium text-gray-500 dark:text-gray-400">Mode of Training</span>
                                    <p className="text-gray-900 dark:text-white mt-0.5">{modeOfTrainingLabel(session.modeOfTraining)}</p>
                                </div>
                            </div>
                            {session.venue && (
                                <div className="bg-gray-50 dark:bg-gray-800 rounded-lg p-4 text-sm">
                                    <p className="font-medium text-gray-600 dark:text-gray-300 mb-1">Venue</p>
                                    <p className="text-gray-900 dark:text-white">
                                        {[
                                            session.venue.building,
                                            session.venue.block && `Blk ${session.venue.block}`,
                                            session.venue.floor && session.venue.floor !== '-' && `Floor ${session.venue.floor}`,
                                            session.venue.unit && session.venue.unit !== '-' && `Unit ${session.venue.unit}`,
                                            session.venue.room && session.venue.room !== '-' && session.venue.room,
                                        ].filter(Boolean).join(', ')}
                                    </p>
                                    <p className="text-gray-600 dark:text-gray-400">
                                        {[session.venue.street, session.venue.postalCode && `S(${session.venue.postalCode})`].filter(Boolean).join(', ')}
                                    </p>
                                    {session.venue.wheelChairAccess && (
                                        <p className="text-green-600 dark:text-green-400 text-xs mt-1">Wheelchair accessible</p>
                                    )}
                                </div>
                            )}
                        </Card>
                    )}

                    {/* Attendance Table */}
                    <Card className="p-6">
                        <div className="flex items-center justify-between mb-4">
                            <h3 className="text-lg font-bold text-gray-700 dark:text-gray-200">
                                Attendance Records
                            </h3>
                            <span className="text-sm text-gray-500 dark:text-gray-400">
                                Total: {attendance.length} ({trainees.length} trainee{trainees.length !== 1 ? 's' : ''}, {trainers.length} trainer{trainers.length !== 1 ? 's' : ''})
                            </span>
                        </div>

                        {attendance.length === 0 ? (
                            <div className="text-center py-10 text-gray-500 dark:text-gray-400">
                                <p className="font-medium">No attendance records yet.</p>
                                <p className="text-sm mt-1">Attendance will appear here once participants have checked in.</p>
                            </div>
                        ) : (
                            <div className="overflow-x-auto">
                                <table className="min-w-full text-sm">
                                    <thead>
                                        <tr className="border-b border-gray-200 dark:border-gray-700 text-left">
                                            <th className="pb-3 pr-4 font-semibold text-gray-600 dark:text-gray-300">#</th>
                                            <th className="pb-3 pr-4 font-semibold text-gray-600 dark:text-gray-300">Name</th>
                                            <th className="pb-3 pr-4 font-semibold text-gray-600 dark:text-gray-300">NRIC</th>
                                            <th className="pb-3 pr-4 font-semibold text-gray-600 dark:text-gray-300">Type</th>
                                            <th className="pb-3 pr-4 font-semibold text-gray-600 dark:text-gray-300">Status</th>
                                            <th className="pb-3 pr-4 font-semibold text-gray-600 dark:text-gray-300">Entry Mode</th>
                                            <th className="pb-3 font-semibold text-gray-600 dark:text-gray-300">TRAQOM</th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {attendance.map((record: any, idx: number) => (
                                            <tr
                                                key={record.id}
                                                className="border-b border-gray-100 dark:border-gray-800 hover:bg-gray-50 dark:hover:bg-gray-800/50"
                                            >
                                                <td className="py-3 pr-4 text-gray-500 dark:text-gray-400">{idx + 1}</td>
                                                <td className="py-3 pr-4 font-medium text-gray-900 dark:text-white">{record.trainee?.name ?? '—'}</td>
                                                <td className="py-3 pr-4 font-mono text-gray-700 dark:text-gray-300">{record.nric}</td>
                                                <td className="py-3 pr-4">
                                                    <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium border ${record.trainee?.attendeeType === 'Trainer'
                                                        ? 'bg-purple-100 text-purple-800 border-purple-200'
                                                        : 'bg-blue-100 text-blue-800 border-blue-200'
                                                        }`}>
                                                        {record.trainee?.attendeeType ?? '—'}
                                                    </span>
                                                </td>
                                                <td className="py-3 pr-4">
                                                    <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium border ${getStatusColor(record.status)}`}>
                                                        {record.status}
                                                    </span>
                                                </td>
                                                <td className="py-3 pr-4 text-gray-600 dark:text-gray-400">{record.entryMode}</td>
                                                <td className="py-3 text-gray-600 dark:text-gray-400 text-xs">{record.sentToTraqom}</td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                            </div>
                        )}
                    </Card>
                </div>
            )}
        </div>
    );
};