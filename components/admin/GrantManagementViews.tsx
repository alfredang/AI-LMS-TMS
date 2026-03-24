import React, { useState, useMemo, useEffect } from 'react';
import { Card } from '../ui/Card';
import { Button } from '../ui/Button';
import { Icon, IconName } from '../ui/Icon';

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
    const [webhookResponse, setWebhookResponse] = useState<any>(null);
    const [searchError, setSearchError] = useState<string | null>(null);

    // Webhook URL
    const WEBHOOK_URL = 'https://n8n.srv1231536.hstgr.cloud/webhook/3ba28a37-dbfe-4c5a-8ec9-252c3d2cfc25';

    const handleSearch = async () => {
        if (!searchInput.trim()) {
            setSearchError('Please enter a search query');
            return;
        }

        setIsSearching(true);
        setSearchError(null);
        setWebhookResponse(null);

        try {
            console.log('🔍 Sending request to n8n webhook:', WEBHOOK_URL);
            console.log('📤 Search input:', searchInput);

            const response = await fetch(WEBHOOK_URL, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                    query: searchInput,
                    timestamp: new Date().toISOString(),
                    source: 'admin-grant-status'
                })
            });

            if (!response.ok) {
                if (response.status === 500) {
                    throw new Error('SSG API server error. The service may be temporarily unavailable. Please try again later.');
                }
                throw new Error(`Unable to connect to SSG API (Error ${response.status}). Please check your connection and try again.`);
            }

            // Safe JSON parsing
            const text = await response.text();
            let data;
            try {
                data = text ? JSON.parse(text) : {};
            } catch (e) {
                console.error('Failed to parse JSON response:', text);
                throw new Error(`Invalid JSON response from webhook`);
            }
            console.log('✅ Webhook response:', data);
            setWebhookResponse(data);
        } catch (error) {
            console.error('❌ Error calling webhook:', error);
            setSearchError(error instanceof Error ? error.message : 'Failed to fetch grant status');
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
                        <p className="mt-4 text-gray-600 dark:text-gray-300">Fetching grant status from n8n...</p>
                    </div>
                </div>
            )}

            {/* Webhook Response Display */}
            {webhookResponse && !isSearching && (
                <Card className="p-0 dark:bg-gray-800 dark:border-gray-700">
                    <div className="p-6 border-b dark:border-gray-700">
                        <h3 className="text-xl font-bold dark:text-white">Grant Status Results</h3>
                        <p className="text-gray-500 dark:text-gray-400 mt-1 dark:text-gray-400">Search query: "{searchInput}"</p>
                    </div>
                    <div className="p-6">
                        {/* Check if response has the expected structure */}
                        {webhookResponse.result && webhookResponse.result.data ? (
                            <div className="space-y-6">
                                {/* Grant Summary Card */}
                                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                    <div className="bg-white border border-gray-200 rounded-lg p-4 dark:bg-gray-700 dark:border-gray-600">
                                        <h4 className="text-sm font-medium text-gray-500 mb-2 dark:text-gray-300">Grant Reference Number</h4>
                                        <p className="text-lg font-semibold text-gray-900 dark:text-white">
                                            {webhookResponse.result.data.referenceNumber || 'N/A'}
                                        </p>
                                    </div>
                                    <div className="bg-white border border-gray-200 rounded-lg p-4 dark:bg-gray-700 dark:border-gray-600">
                                        <h4 className="text-sm font-medium text-gray-500 mb-2 dark:text-gray-300">Status</h4>
                                        <span className={`inline-flex px-3 py-1 text-sm font-semibold rounded-full border ${getStatusColor(webhookResponse.result.data.status || 'Pending')}`}>
                                            {webhookResponse.result.data.status || 'Pending'}
                                        </span>
                                    </div>
                                </div>

                                {/* Funding Information */}
                                {webhookResponse.result.data.fundingScheme && (
                                    <div className="bg-blue-50 border border-blue-200 rounded-lg p-4 dark:bg-blue-900/20 dark:border-blue-800">
                                        <h4 className="font-semibold text-blue-900 mb-3 dark:text-blue-300">Funding Information</h4>
                                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                            <div>
                                                <p className="text-sm text-blue-700 font-medium dark:text-blue-400">Funding Scheme</p>
                                                <p className="text-blue-900 dark:text-blue-200">
                                                    {webhookResponse.result.data.fundingScheme.code} - {webhookResponse.result.data.fundingScheme.description}
                                                </p>
                                            </div>
                                            {webhookResponse.result.data.fundingComponent && (
                                                <div>
                                                    <p className="text-sm text-blue-700 font-medium dark:text-blue-400">Funding Component</p>
                                                    <p className="text-blue-900 dark:text-blue-200">
                                                        {webhookResponse.result.data.fundingComponent.code} - {webhookResponse.result.data.fundingComponent.description}
                                                    </p>
                                                </div>
                                            )}
                                        </div>
                                    </div>
                                )}

                                {/* Grant Amount Details */}
                                {webhookResponse.result.data.grantAmount && (
                                    <div className="bg-green-50 border border-green-200 rounded-lg p-4 dark:bg-green-900/20 dark:border-green-800">
                                        <h4 className="font-semibold text-green-900 mb-3 dark:text-green-300">Grant Amount</h4>
                                        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                                            <div>
                                                <p className="text-sm text-green-700 font-medium dark:text-green-400">Estimated</p>
                                                <p className="text-xl font-bold text-green-900 dark:text-green-200">
                                                    ${webhookResponse.result.data.grantAmount.estimated?.toFixed(2) || '0.00'}
                                                </p>
                                            </div>
                                            <div>
                                                <p className="text-sm text-green-700 font-medium dark:text-green-400">Paid</p>
                                                <p className="text-xl font-bold text-green-900 dark:text-green-200">
                                                    ${webhookResponse.result.data.grantAmount.paid?.toFixed(2) || '0.00'}
                                                </p>
                                            </div>
                                            <div>
                                                <p className="text-sm text-green-700 font-medium dark:text-green-400">Recovery</p>
                                                <p className="text-xl font-bold text-green-900 dark:text-green-200">
                                                    ${webhookResponse.result.data.grantAmount.recovery?.toFixed(2) || '0.00'}
                                                </p>
                                            </div>
                                        </div>
                                    </div>
                                )}

                                {/* Enrolment Information */}
                                {webhookResponse.result.data.enrolment && (
                                    <div className="bg-gray-50 border border-gray-200 rounded-lg p-4 dark:bg-gray-700/30 dark:border-gray-600">
                                        <h4 className="font-semibold text-gray-900 mb-2 dark:text-white">Enrolment Reference</h4>
                                        <p className="text-gray-700 dark:text-gray-300">
                                            {webhookResponse.result.data.enrolment.referenceNumber || 'N/A'}
                                        </p>
                                    </div>
                                )}

                                {/* Meta Information */}
                                {webhookResponse.result.meta && (
                                    <div className="bg-gray-50 border border-gray-200 rounded-lg p-4 dark:bg-gray-700/30 dark:border-gray-600">
                                        <h4 className="font-semibold text-gray-900 mb-3 dark:text-white">Timestamps</h4>
                                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                            <div>
                                                <p className="text-sm text-gray-600 font-medium dark:text-gray-400">Created On</p>
                                                <p className="text-gray-900 dark:text-white">{webhookResponse.result.meta.createdOn || 'N/A'}</p>
                                            </div>
                                            <div>
                                                <p className="text-sm text-gray-600 font-medium dark:text-gray-400">Last Updated</p>
                                                <p className="text-gray-900 dark:text-white">{webhookResponse.result.meta.updatedOn || 'N/A'}</p>
                                            </div>
                                        </div>
                                    </div>
                                )}

                                {/* Raw JSON Response (Collapsible) */}
                                <details className="bg-gray-50 border border-gray-200 rounded-lg p-4 dark:bg-gray-700/30 dark:border-gray-600">
                                    <summary className="font-semibold text-gray-800 cursor-pointer hover:text-gray-600 dark:text-white dark:hover:text-gray-300">
                                        View Raw JSON Response
                                    </summary>
                                    <pre className="mt-3 text-sm text-gray-700 whitespace-pre-wrap overflow-x-auto max-h-96 bg-white p-3 rounded border dark:bg-gray-900 dark:text-gray-300 dark:border-gray-700">
                                        {JSON.stringify(webhookResponse, null, 2)}
                                    </pre>
                                </details>
                            </div>
                        ) : (
                            /* Fallback for unexpected response format */
                            <div className="bg-gray-50 border border-gray-200 rounded-lg p-4">
                                <h4 className="font-semibold text-gray-800 mb-3">Response Data:</h4>
                                <pre className="text-sm text-gray-700 whitespace-pre-wrap overflow-x-auto max-h-96">
                                    {JSON.stringify(webhookResponse, null, 2)}
                                </pre>
                            </div>
                        )}

                        <div className="mt-6 flex justify-end">
                            <Button
                                variant="outline"
                                onClick={() => {
                                    setWebhookResponse(null);
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
            {!webhookResponse && !isSearching && (
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
    const [courseRunId, setCourseRunId] = useState<string>('');
    const [courseReferenceNumber, setCourseReferenceNumber] = useState<string>('');
    const [assessmentResult, setAssessmentResult] = useState<string>('Pass');
    const [traineeId, setTraineeId] = useState<string>('');
    const [traineeFullName, setTraineeFullName] = useState<string>('');
    const [skillCode, setSkillCode] = useState<string>('');
    const [assessmentDate, setAssessmentDate] = useState<string>('');
    const [trainingPartnerUen, setTrainingPartnerUen] = useState<string>('201200696W');
    const [trainingPartnerCode, setTrainingPartnerCode] = useState<string>('201200696W-01');
    const [enrolmentNumber, setEnrolmentNumber] = useState<string>('');
    const [isSubmitting, setIsSubmitting] = useState(false);
    const [result, setResult] = useState<any>(null);
    const [error, setError] = useState<string | null>(null);

    const WEBHOOK_URL = 'https://n8n.srv1231536.hstgr.cloud/webhook/3955e2d7-38c5-4f06-9177-53281157763c';

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
        // Validate required fields based on SSG API
        if (!courseRunId.trim()) {
            setError('Course Run ID is required');
            return;
        }
        if (!courseReferenceNumber.trim()) {
            setError('Course Reference Number is required');
            return;
        }
        if (!traineeId.trim()) {
            setError('Trainee ID is required');
            return;
        }
        if (!traineeFullName.trim()) {
            setError('Trainee Full Name is required');
            return;
        }
        if (!assessmentDate.trim()) {
            setError('Assessment Date is required');
            return;
        }
        if (!skillCode.trim()) {
            setError('Skill Code is required');
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
            const idType = getIdType(traineeId);

            const payload: any = {
                payload: {
                    assessment: {
                        course: {
                            run: {
                                id: courseRunId.trim()
                            },
                            referenceNumber: courseReferenceNumber.trim()
                        },
                        result: assessmentResult,
                        trainee: {
                            id: traineeId.trim(),
                            idType: idType,
                            fullName: traineeFullName.trim()
                        },
                        assessmentDate: assessmentDate.trim(),
                        skillCode: skillCode.trim(),
                        trainingPartner: {
                            uen: trainingPartnerUen.trim(),
                            code: trainingPartnerCode.trim()
                        }
                    }
                }
            };

            // Add optional field if provided

            if (enrolmentNumber.trim()) {
                payload.enrolmentNumber = enrolmentNumber.trim();
            }

            console.log('📤 Submit assessment payload:', payload);

            const response = await fetch(WEBHOOK_URL, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify(payload)
            });

            if (!response.ok) {
                if (response.status === 500) {
                    throw new Error('SSG API server error. The service may be temporarily unavailable. Please try again later.');
                }
                throw new Error(`Unable to connect to SSG API (Error ${response.status}). Please check your connection and try again.`);
            }

            // Safe JSON parsing
            const text = await response.text();
            let data;
            try {
                data = text ? JSON.parse(text) : {};
            } catch (e) {
                console.error('Failed to parse JSON response:', text);
                throw new Error(`Invalid JSON response from webhook`);
            }
            console.log('✅ Submit assessment response:', data);

            // Parse response
            let parsedResult = data;
            if (data?.result !== undefined && data?.result !== null) {
                if (typeof data.result === 'string') {
                    try {
                        parsedResult = JSON.parse(data.result);
                    } catch (e) {
                        console.error('Failed to parse result string:', data.result);
                        parsedResult = { error: { message: data.result } };
                    }
                } else if (typeof data.result === 'object') {
                    parsedResult = data.result;
                } else {
                    parsedResult = { error: { message: String(data.result) } };
                }
            }

            // Check for error status - handle both nested error object and root level errors
            const hasError = (parsedResult?.error?.details?.length > 0) ||
                (parsedResult?.error?.message) ||
                (parsedResult?.status && parsedResult.status >= 400) ||
                (parsedResult?.details?.length > 0) ||
                (parsedResult?.message && parsedResult.message.toLowerCase().includes('cannot'));

            if (hasError) {
                const errorMessage = parsedResult?.error?.details?.[0]?.message ||
                    parsedResult?.error?.message ||
                    parsedResult?.details?.[0]?.message ||
                    parsedResult?.message ||
                    'Failed to submit assessment';
                setError(errorMessage);
            }

            setResult(parsedResult);
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
        setTrainingPartnerUen('201200696W');
        setTrainingPartnerCode('201200696W-01');
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
                    All fields marked with * are required. Only Enrolment Number is optional.
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
                    <div>
                        <label htmlFor="submit-enrolment-number" className="block text-sm font-bold text-gray-700 dark:text-gray-300 mb-1">
                            Enrolment Number
                        </label>
                        <input
                            id="submit-enrolment-number"
                            type="text"
                            value={enrolmentNumber}
                            onChange={(e) => setEnrolmentNumber(e.target.value)}
                            placeholder="e.g. ENR-2024-001 (optional)"
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
                            {/* <p className="text-sm text-red-800 dark:text-red-300 pl-7">{error}</p> */}
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
                                        {result?.data?.assessment?.referenceNumber || 'N/A'}
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

    const WEBHOOK_URL = 'https://n8n.srv1231536.hstgr.cloud/webhook/5a3271b2-6b10-455b-a5a1-196c5d3a6887'; // TODO: Replace with actual webhook URL

    const inputClasses = "block w-full px-3 py-2 text-on-surface bg-white border border-gray-300 rounded-md shadow-sm placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent dark:bg-gray-700 dark:border-gray-600 dark:text-white dark:placeholder-gray-500";

    const handleSubmit = async () => {
        // Validate required fields
        if (!referenceNumber.trim()) {
            setError('Assessment Reference Number is required');
            return;
        }
        if (!action.trim()) {
            setError('Action is required');
            return;
        }

        // For update action, validate required fields
        if (action === 'update') {
            if (!result.trim()) {
                setError('Assessment Result is required for update action');
                return;
            }
            if (!traineeFullName.trim()) {
                setError('Trainee Full Name is required for update action');
                return;
            }
            if (!assessmentDate.trim()) {
                setError('Assessment Date is required for update action');
                return;
            }
            if (!skillCode.trim()) {
                setError('Skill Code is required for update action');
                return;
            }
        }

        setIsSubmitting(true);
        setError(null);
        setApiResult(null);

        try {
            const payload: any = {
                referenceNumber: referenceNumber.trim(),
                assessment: {
                    action: action
                }
            };

            // Only add fields for update action (void action leaves fields blank)
            if (action === 'update') {
                payload.assessment.result = result;
                payload.assessment.trainee = {
                    fullName: traineeFullName.trim()
                };
                payload.assessment.assessmentDate = assessmentDate.trim();
                payload.assessment.skillCode = skillCode.trim();

                // Add optional fields if provided
                if (grade.trim()) {
                    payload.assessment.grade = grade.trim();
                }
                if (score.trim()) {
                    payload.assessment.score = parseInt(score.trim(), 10);
                }
            }

            console.log('📤 Update assessment payload:', payload);

            const response = await fetch(WEBHOOK_URL, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify(payload)
            });

            if (!response.ok) {
                if (response.status === 500) {
                    throw new Error('SSG API server error. The service may be temporarily unavailable. Please try again later.');
                }
                throw new Error(`Unable to connect to SSG API (Error ${response.status}). Please check your connection and try again.`);
            }

            // Safe JSON parsing
            const text = await response.text();
            let data;
            try {
                data = text ? JSON.parse(text) : {};
            } catch (e) {
                console.error('Failed to parse JSON response:', text);
                throw new Error(`Invalid JSON response from webhook`);
            }
            console.log('✅ Update assessment response:', data);

            // Parse response
            let parsedResult = data;
            if (data?.result !== undefined && data?.result !== null) {
                if (typeof data.result === 'string') {
                    try {
                        parsedResult = JSON.parse(data.result);
                    } catch (e) {
                        console.error('Failed to parse result string:', data.result);
                        parsedResult = { error: { message: data.result } };
                    }
                } else if (typeof data.result === 'object') {
                    parsedResult = data.result;
                } else {
                    parsedResult = { error: { message: String(data.result) } };
                }
            }

            // Check for error status
            const hasError = (parsedResult?.error?.details?.length > 0) ||
                (parsedResult?.error?.message) ||
                (parsedResult?.status && parsedResult.status >= 400) ||
                (parsedResult?.details?.length > 0) ||
                (parsedResult?.message && parsedResult.message.toLowerCase().includes('cannot'));

            if (hasError) {
                const errorMessage = parsedResult?.error?.details?.[0]?.message ||
                    parsedResult?.error?.message ||
                    parsedResult?.details?.[0]?.message ||
                    parsedResult?.message ||
                    `Failed to ${action} assessment`;
                setError(errorMessage);
            }

            setApiResult(parsedResult);
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
    const [enrolmentReferenceNumber, setEnrolmentReferenceNumber] = useState<string>('');
    const [collectionStatus, setCollectionStatus] = useState<string>('Pending Payment');
    const [trainingPartnerUen, setTrainingPartnerUen] = useState<string>('201200696W');
    const [trainingPartnerCode, setTrainingPartnerCode] = useState<string>('201200696W-01');
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
        setTrainingPartnerUen('201200696W');
        setTrainingPartnerCode('201200696W-01');
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

    const handleSimulateUpload = () => {
        if (!file) return;

        setIsUploading(true);
        setSubmissionResult(null);

        // Simulate a network request to SSG
        setTimeout(() => {
            const mockResults = [
                { courseRef: 'TGS-2025053174', startDate: '05/09/2025', endDate: '08/09/2025', status: 'Success', courseRunId: Math.floor(1000000 + Math.random() * 9000000).toString() },
                { courseRef: 'TGS-2024081123', startDate: '29/08/2025', endDate: '03/09/2025', status: 'Success', courseRunId: Math.floor(1000000 + Math.random() * 9000000).toString() },
                { courseRef: 'CRS-Q-0041189-2', startDate: '25/09/2025', endDate: '27/09/2025', status: 'Failed', error: 'Trainer is not qualified for this course.' },
            ];
            setSubmissionResult(mockResults);
            setIsUploading(false);
        }, 2500);
    };

    const resetView = () => {
        setFile(null);
        setSubmissionResult(null);
        setError(null);
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
                <Button onClick={handleSimulateUpload} disabled={!file || isUploading}>
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
                        <p className="mt-4 text-gray-600 dark:text-gray-300">Submitting to SSG, this may take a moment...</p>
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
    const [page, setPage] = useState<number>(0);
    const [pageSize, setPageSize] = useState<number>(30);
    const [isSearching, setIsSearching] = useState(false);
    const [webhookResponse, setWebhookResponse] = useState<any>(null);
    const [parsedData, setParsedData] = useState<any>(null);
    const [searchError, setSearchError] = useState<string | null>(null);

    // Webhook URL
    const WEBHOOK_URL = 'https://n8n.srv1231536.hstgr.cloud/webhook/350792b8-727e-4140-9c54-1363524ab248';

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
        setWebhookResponse(null);

        try {
            console.log('🔍 Sending request to n8n webhook:', WEBHOOK_URL);

            const payload = {
                courseRunId,
                page: page,
                pageSize,
                timestamp: new Date().toISOString(),
                source: 'admin-search-grant'
            };

            console.log('📤 Search payload:', payload);

            const response = await fetch(WEBHOOK_URL, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify(payload)
            });

            if (!response.ok) {
                if (response.status === 500) {
                    throw new Error('SSG API server error. The service may be temporarily unavailable. Please try again later.');
                }
                throw new Error(`Unable to connect to SSG API (Error ${response.status}). Please check your connection and try again.`);
            }

            // Safe JSON parsing
            const text = await response.text();
            let data;
            try {
                data = text ? JSON.parse(text) : {};
            } catch (e) {
                console.error('Failed to parse JSON response:', text);
                throw new Error(`Invalid JSON response from webhook`);
            }
            console.log('✅ Webhook response:', data);
            setWebhookResponse(data);

            // Parse nested JSON in result property if exists
            if (data.result) {
                try {
                    // Start parsing nested string response
                    const nested = typeof data.result === 'string' ? JSON.parse(data.result) : data.result;
                    console.log('✅ Parsed nested result:', nested);
                    setParsedData(nested);
                } catch (e) {
                    console.error('❌ Error parsing nested result JSON:', e);
                    setParsedData(null);
                }
            } else {
                setParsedData(null);
            }
        } catch (error) {
            console.error('❌ Error calling webhook:', error);
            setSearchError(error instanceof Error ? error.message : 'Failed to fetch grant status');
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

                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
                        <div>
                            <label htmlFor="page-number" className="block text-sm font-bold text-gray-700 dark:text-gray-300 mb-1">
                                Page Number
                            </label>
                            <input
                                id="page-number"
                                type="number"
                                min="0"
                                max="100"
                                value={page}
                                onChange={(e) => {
                                    const val = parseInt(e.target.value) || 0;
                                    setPage(Math.min(val, 100));
                                }}
                                className={inputClasses}
                                disabled={isSearching}
                            />
                        </div>
                        <div>
                            <label htmlFor="page-size" className="block text-sm font-bold text-gray-700 dark:text-gray-300 mb-1">
                                Page Size
                            </label>
                            <input
                                id="page-size"
                                type="number"
                                min="1"
                                max="100"
                                value={pageSize}
                                onChange={(e) => {
                                    const val = parseInt(e.target.value) || 10;
                                    setPageSize(Math.min(val, 100));
                                }}
                                className={inputClasses}
                                disabled={isSearching}
                            />
                        </div>
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
                        <p className="mt-4 text-gray-600 dark:text-gray-400">Fetching grant details from n8n...</p>
                    </div>
                </div>
            )}

            {/* Webhook Response Display */}
            {webhookResponse && !isSearching && (
                <Card className="p-0">
                    <div className="p-6 border-b dark:border-gray-700">
                        <h3 className="text-xl font-bold dark:text-white">Grant Status Results</h3>
                        <p className="text-gray-500 dark:text-gray-400 mt-1">
                            Run: {courseRunId}
                        </p>
                    </div>
                    <div className="p-6">
                        {parsedData && parsedData.data && Array.isArray(parsedData.data) && parsedData.data.length > 0 ? (
                            <div className="space-y-6">
                                <div className="flex justify-between items-center bg-blue-50 dark:bg-blue-900/30 p-4 rounded-lg border border-blue-100 dark:border-blue-800">
                                    <div>
                                        <h4 className="font-bold text-blue-900 dark:text-blue-300">Total Records Found: {parsedData.meta?.totalRecords ?? 0}</h4>
                                        <p className="text-sm text-blue-700 dark:text-blue-400">Course Run ID: {courseRunId}</p>
                                    </div>
                                </div>

                                <div className="overflow-x-auto border border-gray-200 dark:border-gray-700 rounded-lg shadow-sm">
                                    <table className="min-w-full divide-y divide-gray-200 dark:divide-gray-700">
                                        <thead className="bg-gray-50 dark:bg-gray-700">
                                            <tr>
                                                <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-300 uppercase tracking-wider">Course Run ID</th>
                                                <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-300 uppercase tracking-wider">Enrolment ID</th>
                                                <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-300 uppercase tracking-wider">Grant Ref No</th>
                                                <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-300 uppercase tracking-wider">Status</th>
                                                <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-300 uppercase tracking-wider">Estimated</th>
                                                <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-300 uppercase tracking-wider">Paid</th>
                                                <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-300 uppercase tracking-wider">Recovery</th>
                                            </tr>
                                        </thead>
                                        <tbody className="bg-white dark:bg-gray-800 divide-y divide-gray-200 dark:divide-gray-700">
                                            {parsedData.data.map((item: any, index: number) => (
                                                <tr key={index} className="hover:bg-gray-50 dark:hover:bg-gray-700">
                                                    <td className="px-6 py-4 whitespace-nowrap text-sm font-medium text-gray-900 dark:text-white">
                                                        {courseRunId}
                                                    </td>
                                                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500 dark:text-gray-300">
                                                        {item.enrolment?.referenceNumber || 'N/A'}
                                                    </td>
                                                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900 dark:text-white">
                                                        {item.referenceNumber || 'N/A'}
                                                    </td>
                                                    <td className="px-6 py-4 whitespace-nowrap">
                                                        <span className={`inline-flex px-2 text-xs leading-5 font-semibold rounded-full border ${getStatusColor(item.status || 'Pending')}`}>
                                                            {item.status || 'Pending'}
                                                        </span>
                                                    </td>
                                                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500 dark:text-gray-300">
                                                        ${item.grantAmount?.estimated?.toFixed(2) || '0.00'}
                                                    </td>
                                                    <td className="px-6 py-4 whitespace-nowrap text-sm text-green-600 dark:text-green-400 font-medium">
                                                        ${item.grantAmount?.paid?.toFixed(2) || '0.00'}
                                                    </td>
                                                    <td className="px-6 py-4 whitespace-nowrap text-sm text-red-600 dark:text-red-400">
                                                        ${item.grantAmount?.recovery?.toFixed(2) || '0.00'}
                                                    </td>
                                                </tr>
                                            ))}
                                        </tbody>
                                    </table>
                                </div>
                            </div>
                        ) : (
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
    const [webhookResponse, setWebhookResponse] = useState<any>(null);
    const [parsedData, setParsedData] = useState<any>(null);
    const [searchError, setSearchError] = useState<string | null>(null);
    const [currentPage, setCurrentPage] = useState(1);
    const itemsPerPage = 10;

    const WEBHOOK_URL = 'https://n8n.srv1231536.hstgr.cloud/webhook/c963c0c9-e1f2-4914-9b09-e957f4292fae';

    const inputClasses = "block w-full px-3 py-2 text-on-surface bg-white border border-gray-300 rounded-md shadow-sm placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent dark:bg-gray-700 dark:border-gray-600 dark:text-white dark:placeholder-gray-500";

    const handleSearch = async () => {
        if (!courseCode.trim()) {
            setSearchError('Please enter a Course Code');
            return;
        }

        setIsSearching(true);
        setSearchError(null);
        setWebhookResponse(null);
        setParsedData(null);
        setCurrentPage(1);

        try {
            const payload = {
                courseCode: courseCode.trim(),
                timestamp: new Date().toISOString(),
                source: 'admin-search-course-runs'
            };

            const response = await fetch(WEBHOOK_URL, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify(payload)
            });

            if (!response.ok) {
                if (response.status === 500) {
                    throw new Error('The service is temporarily unavailable. Please try again later.');
                }
                throw new Error('Unable to retrieve course runs. Please try again later.');
            }

            const text = await response.text();

            let data;
            try {
                data = JSON.parse(text);
            } catch {
                // Only throw error if text is truly empty or invalid
                if (!text || text.trim() === '') {
                    throw new Error('No response received from the server. Please try again later.');
                }
                throw new Error('Received an unexpected response from the server. Please try again later.');
            }

            setWebhookResponse(data);

            try {
                let resultData = null;

                // Handle results array structure (e.g., [{results: [{result: "..."}]}])
                if (Array.isArray(data) && data[0]?.results) {
                    const results = data[0].results;
                    // Find the first result with actual data
                    for (const item of results) {
                        if (item?.result) {
                            resultData = typeof item.result === 'string' ? JSON.parse(item.result) : item.result;
                            break;
                        }
                    }
                } else if (data?.result) {
                    resultData = typeof data.result === 'string' ? JSON.parse(data.result) : data.result;
                } else if (Array.isArray(data) && data[0]?.result) {
                    resultData = typeof data[0].result === 'string' ? JSON.parse(data[0].result) : data[0].result;
                }

                // Check if the result is an error object (any shape)
                const isError = resultData && (
                    resultData.name === 'AxiosError' ||
                    resultData.code?.startsWith?.('ERR_') ||
                    resultData.error ||
                    (resultData.status && resultData.status >= 400) ||
                    (typeof resultData.message === 'string' && !resultData.data)
                );

                if (isError) {
                    const errorMsg = extractErrorMessage(resultData);
                    setSearchError(errorMsg);
                    setParsedData(null);
                } else if (resultData) {
                    setParsedData(resultData);
                }
            } catch (e) {
                setParsedData(null);
            }
        } catch (error) {
            setSearchError(error instanceof Error ? error.message : 'Something went wrong. Please try again later.');
        } finally {
            setIsSearching(false);
        }
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
        if (!parsedData) return null;

        // Handle SSG response: course.runs[] or fallback to data[] / direct array
        const courseRuns = parsedData.course?.runs || parsedData.data || (Array.isArray(parsedData) ? parsedData : null);
        const courseRef = parsedData.course?.referenceNumber || courseCode;

        if (courseRuns && Array.isArray(courseRuns) && courseRuns.length > 0) {
            // Pagination calculations
            const totalItems = courseRuns.length;
            const totalPages = Math.ceil(totalItems / itemsPerPage);
            const startIndex = (currentPage - 1) * itemsPerPage;
            const endIndex = startIndex + itemsPerPage;
            const currentPageData = courseRuns.slice(startIndex, endIndex);

            return (
                <div className="space-y-6">
                    <div className="flex justify-between items-center bg-blue-50 dark:bg-blue-900/30 p-4 rounded-lg border border-blue-100 dark:border-blue-800">
                        <div>
                            <h4 className="font-bold text-blue-900 dark:text-blue-300">Total Course Runs Found: {totalItems}</h4>
                            <p className="text-sm text-blue-700 dark:text-blue-400">Course Reference: {courseRef}</p>
                        </div>
                        <div className="text-sm text-blue-700 dark:text-blue-400">
                            Showing {startIndex + 1}-{Math.min(endIndex, totalItems)} of {totalItems}
                        </div>
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
                                    <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-300 uppercase tracking-wider">Vacancy</th>
                                </tr>
                            </thead>
                            <tbody className="bg-white dark:bg-gray-800 divide-y divide-gray-200 dark:divide-gray-700">
                                {currentPageData.map((run: any, index: number) => (
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
                                                <span className="text-gray-400 dark:text-gray-500 dark:text-gray-400">N/A</span>
                                            )}
                                        </td>
                                        <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500 dark:text-gray-300">
                                            {getModeLabel(run.modeOfTraining)}
                                        </td>
                                        <td className="px-6 py-4 text-sm text-gray-500 dark:text-gray-300 min-w-[300px]" title={formatVenue(run.venue)}>
                                            {formatVenue(run.venue)}
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

                    {/* Pagination Controls */}
                    {totalPages > 1 && (
                        <div className="flex items-center justify-between border-t border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 px-4 py-3 sm:px-6 rounded-b-lg">
                            <div className="flex flex-1 justify-between sm:hidden">
                                <Button
                                    variant="outline"
                                    onClick={() => setCurrentPage(prev => Math.max(1, prev - 1))}
                                    disabled={currentPage === 1}
                                    className="relative inline-flex items-center"
                                >
                                    Previous
                                </Button>
                                <Button
                                    variant="outline"
                                    onClick={() => setCurrentPage(prev => Math.min(totalPages, prev + 1))}
                                    disabled={currentPage === totalPages}
                                    className="relative ml-3 inline-flex items-center"
                                >
                                    Next
                                </Button>
                            </div>
                            <div className="hidden sm:flex sm:flex-1 sm:items-center sm:justify-between">
                                <div>
                                    <p className="text-sm text-gray-700 dark:text-gray-300">
                                        Page <span className="font-medium">{currentPage}</span> of <span className="font-medium">{totalPages}</span>
                                    </p>
                                </div>
                                <div>
                                    <nav className="isolate inline-flex -space-x-px rounded-md shadow-sm" aria-label="Pagination">
                                        <button
                                            onClick={() => setCurrentPage(prev => Math.max(1, prev - 1))}
                                            disabled={currentPage === 1}
                                            className="relative inline-flex items-center rounded-l-md px-2 py-2 text-gray-400 ring-1 ring-inset ring-gray-300 hover:bg-gray-50 focus:z-20 focus:outline-offset-0 disabled:opacity-50 disabled:cursor-not-allowed dark:ring-gray-600 dark:hover:bg-gray-700"
                                        >
                                            <span className="sr-only">Previous</span>
                                            <Icon name={IconName.Back} className="h-5 w-5" />
                                        </button>

                                        {/* Page Numbers */}
                                        {Array.from({ length: totalPages }, (_, i) => i + 1).map((pageNum) => {
                                            // Show first page, last page, current page, and pages around current
                                            const showPage = pageNum === 1 ||
                                                pageNum === totalPages ||
                                                (pageNum >= currentPage - 1 && pageNum <= currentPage + 1);

                                            if (!showPage && pageNum === 2 && currentPage > 3) {
                                                return <span key={pageNum} className="relative inline-flex items-center px-4 py-2 text-sm font-semibold text-gray-700 dark:text-gray-300">...</span>;
                                            }
                                            if (!showPage && pageNum === totalPages - 1 && currentPage < totalPages - 2) {
                                                return <span key={pageNum} className="relative inline-flex items-center px-4 py-2 text-sm font-semibold text-gray-700 dark:text-gray-300">...</span>;
                                            }
                                            if (!showPage) return null;

                                            return (
                                                <button
                                                    key={pageNum}
                                                    onClick={() => setCurrentPage(pageNum)}
                                                    className={`relative inline-flex items-center px-4 py-2 text-sm font-semibold ${currentPage === pageNum
                                                        ? 'z-10 bg-blue-600 text-white focus:z-20 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600'
                                                        : 'text-gray-900 ring-1 ring-inset ring-gray-300 hover:bg-gray-50 focus:z-20 focus:outline-offset-0 dark:text-gray-300 dark:ring-gray-600 dark:hover:bg-gray-700'
                                                        }`}
                                                >
                                                    {pageNum}
                                                </button>
                                            );
                                        })}

                                        <button
                                            onClick={() => setCurrentPage(prev => Math.min(totalPages, prev + 1))}
                                            disabled={currentPage === totalPages}
                                            className="relative inline-flex items-center rounded-r-md px-2 py-2 text-gray-400 ring-1 ring-inset ring-gray-300 hover:bg-gray-50 focus:z-20 focus:outline-offset-0 disabled:opacity-50 disabled:cursor-not-allowed dark:ring-gray-600 dark:hover:bg-gray-700"
                                        >
                                            <span className="sr-only">Next</span>
                                            <Icon name={IconName.ChevronDown} className="h-5 w-5 rotate-[-90deg]" />
                                        </button>
                                    </nav>
                                </div>
                            </div>
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
                    No course runs were found for this Course Code.
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
            {webhookResponse && !isSearching && (
                <Card className="p-0">
                    <div className="p-6 border-b dark:border-gray-700">
                        <h3 className="text-xl font-bold dark:text-white">Course Run Results</h3>
                        <p className="text-gray-500 dark:text-gray-400 mt-1">
                            Course Code: {courseCode}
                        </p>
                    </div>
                    <div className="p-6">
                        {renderCourseRuns()}

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
                                    setCourseCode('');
                                    setCurrentPage(1);
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
                        <p className="text-lg font-medium">Enter Course Code to search</p>
                        <p className="text-sm mt-2">Provide a Course Code to fetch all associated course runs from SSG</p>
                    </div>
                </Card>
            )}
        </div>
    );
};

export const ViewCourseRunView: React.FC = () => {
    const [courseRunId, setCourseRunId] = useState<string>('');
    const [isSearching, setIsSearching] = useState(false);
    const [webhookResponse, setWebhookResponse] = useState<any>(null);
    const [parsedData, setParsedData] = useState<any>(null);
    const [searchError, setSearchError] = useState<string | null>(null);

    // Webhook URL for view course run
    const WEBHOOK_URL = 'https://n8n.srv1231536.hstgr.cloud/webhook/7f2f5d21-beb6-47a9-8056-e1ccf79a3ea7';

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
            console.log('🔍 Sending view course run request to n8n webhook:', WEBHOOK_URL);

            const payload = {
                courseRunId: courseRunId.trim(),
                timestamp: new Date().toISOString(),
                source: 'admin-view-course-run'
            };

            console.log('📤 View course run payload:', payload);

            const response = await fetch(WEBHOOK_URL, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify(payload)
            });

            if (!response.ok) {
                if (response.status === 500) {
                    throw new Error('SSG API server error. The service may be temporarily unavailable. Please try again later.');
                }
                throw new Error(`Unable to connect to SSG API (Error ${response.status}). Please check your connection and try again.`);
            }

            // Safe JSON parsing
            const text = await response.text();
            let data;
            try {
                data = text ? JSON.parse(text) : {};
            } catch (e) {
                console.error('Failed to parse JSON response:', text);
                throw new Error(`Invalid JSON response from webhook`);
            }
            console.log('✅ Webhook response:', data);
            setWebhookResponse(data);

            // Parse response - webhook returns { result: "{{ $json.data }}" }
            // The result field contains the SSG API response (array with data.course.run structure)
            try {
                let resultData = null;

                // Extract result field from webhook response
                if (data?.result) {
                    // Parse result if it's a string, otherwise use as-is
                    const parsedResult = typeof data.result === 'string' ? JSON.parse(data.result) : data.result;

                    // Handle array response from SSG
                    if (Array.isArray(parsedResult) && parsedResult.length > 0) {
                        resultData = parsedResult[0];
                    } else {
                        resultData = parsedResult;
                    }
                } else if (Array.isArray(data) && data.length > 0) {
                    // Fallback: direct array response
                    resultData = data[0];
                } else {
                    resultData = data;
                }

                if (resultData) {
                    console.log('✅ Parsed course run data:', resultData);
                    setParsedData(resultData);
                }
            } catch (e) {
                console.error('❌ Error parsing result JSON:', e);
                setParsedData(null);
            }
        } catch (error) {
            console.error('❌ Error calling webhook:', error);
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
                                <tr className="hover:bg-gray-50 dark:hover:bg-gray-800">
                                    <td className="px-6 py-4 whitespace-nowrap text-sm font-semibold text-gray-700 dark:text-gray-300">
                                        Organization UEN
                                    </td>
                                    <td className="px-6 py-4 text-sm text-gray-900 dark:text-white">
                                        {run.organizationKey || 'N/A'}
                                    </td>
                                </tr>
                            </tbody>
                        </table>
                    </div>
                </Card>
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
    const [webhookData, setWebhookData] = useState<any>(null); // Store complete webhook response
    const [error, setError] = useState<string | null>(null);
    const [showConfirm, setShowConfirm] = useState(false);

    const WEBHOOK_URL = 'https://n8n.srv1231536.hstgr.cloud/webhook/57ee587b-5e8d-4927-8717-30833ba1b7ea';

    const inputClasses = "block w-full px-3 py-2 text-on-surface bg-white border border-gray-300 rounded-md shadow-sm placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent dark:bg-gray-700 dark:border-gray-600 dark:text-white dark:placeholder-gray-500";

    const handleSubmit = async () => {
        setShowConfirm(false);
        setIsSubmitting(true);
        setError(null);
        setResult(null);

        try {
            const payload = {
                courseReferenceNumber: courseReferenceNumber.trim(),
                courseRunId: courseRunId.trim(),
                timestamp: new Date().toISOString(),
                source: 'admin-delete-course-run'
            };

            console.log('📤 Delete course run payload:', payload);

            const response = await fetch(WEBHOOK_URL, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify(payload)
            });

            if (!response.ok) {
                if (response.status === 500) {
                    throw new Error('SSG API server error. The service may be temporarily unavailable. Please try again later.');
                }
                throw new Error(`Unable to connect to SSG API (Error ${response.status}). Please check your connection and try again.`);
            }

            // Safe JSON parsing
            const text = await response.text();
            let data;
            try {
                data = text ? JSON.parse(text) : {};
            } catch (e) {
                console.error('Failed to parse JSON response:', text);
                throw new Error(`Invalid JSON response from webhook`);
            }
            console.log('✅ Delete course run response:', data);

            // Check if webhook returned empty response
            if (!data || (typeof data === 'object' && Object.keys(data).length === 0)) {
                throw new Error('Webhook returned empty response. Please check your n8n workflow configuration.');
            }

            // Store the complete webhook response for raw display (after validation)
            setWebhookData(data);

            // Parse response - handle various response formats
            let parsedResult = data;

            // If response has a 'result' property, use that
            if (data?.result !== undefined && data?.result !== null) {
                // If result is a string, try to parse it as JSON
                if (typeof data.result === 'string') {
                    try {
                        parsedResult = JSON.parse(data.result);
                    } catch (e) {
                        // If parsing fails, treat the string as error message
                        console.error('Failed to parse result string:', data.result);
                        parsedResult = { error: { message: data.result } };
                    }
                } else if (typeof data.result === 'object') {
                    // If result is already an object, check if it's an AxiosError with embedded JSON
                    if (data.result.message && typeof data.result.message === 'string') {
                        // Handle format like "400 - \"{...json...}\""
                        const match = data.result.message.match(/^\d+\s*-\s*"([\s\S]+)"$/);
                        if (match) {
                            try {
                                // Unescape the JSON string and parse it
                                const unescaped = match[1].replace(/\\n/g, '').replace(/\\"/g, '"');
                                parsedResult = JSON.parse(unescaped);
                            } catch (e) {
                                console.error('Failed to parse embedded JSON:', e);
                                parsedResult = data.result;
                            }
                        } else {
                            parsedResult = data.result;
                        }
                    } else {
                        // If result is already an object, use it directly
                        parsedResult = data.result;
                    }
                } else {
                    // For other types, treat as error
                    parsedResult = { error: { message: String(data.result) } };
                }
            }

            // Check for error status - handle both nested error object and root level errors
            const hasError = (parsedResult?.error?.details?.length > 0) ||
                (parsedResult?.error?.message) ||
                (parsedResult?.status && parsedResult.status >= 400) ||
                (parsedResult?.details?.length > 0) ||
                (parsedResult?.message && parsedResult.message.toLowerCase().includes('cannot'));

            // Check if it's a "record not found" error - this means already deleted in SSG
            const isRecordNotFound = parsedResult?.error?.details?.some(
                (detail: any) => detail.message?.toLowerCase().includes('record not found')
            ) || parsedResult?.error?.message?.toLowerCase().includes('record not found') ||
                parsedResult?.details?.some(
                    (detail: any) => detail.message?.toLowerCase().includes('record not found')
                ) || parsedResult?.message?.toLowerCase().includes('record not found');

            // Always mark as deleted in database for success OR "record not found"
            if (!hasError || isRecordNotFound) {
                // Either success OR "record not found" (already deleted) - mark as deleted in local database
                try {
                    console.log('🔄 Calling local database API to mark course run as deleted:', courseRunId.trim());

                    const dbResponse = await fetch('/api/admin/delete-course-run', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ courseRunId: courseRunId.trim() })
                    });

                    console.log('📥 Database API response status:', dbResponse.status);

                    if (dbResponse.ok) {
                        const dbData = await dbResponse.json();
                        console.log('✅ Course run marked as deleted in database:', dbData);
                    } else {
                        const dbError = await dbResponse.json().catch(() => ({}));
                        console.error('❌ Database update failed:', dbError);
                    }
                } catch (dbErr) {
                    console.error('❌ Error updating database:', dbErr);
                }
            }

            // Show error message if there's an error (including "record not found")
            if (hasError) {
                const errorMessage = parsedResult?.error?.details?.[0]?.message ||
                    parsedResult?.error?.message ||
                    parsedResult?.details?.[0]?.message ||
                    parsedResult?.message ||
                    'Failed to delete course run';
                setError(errorMessage);
            }

            setResult(parsedResult);
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
        setWebhookData(null);
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
                            {JSON.stringify(webhookData || result, null, 2)}
                        </pre>
                    </details>
                </Card>
            )}
        </div>
    );
};

// Export assessment views from separate file
export { SearchAssessmentsView, ViewAssessmentView } from './AssessmentViews';

// ─── Shared SSG error parser for n8n AxiosError responses ────────────────────

const parseSsgErrorMessage = (errObj: any): string => {
    // errObj.message format: "404 - \"{ escaped JSON }\""
    const msg: string = errObj?.message || '';
    const match = msg.match(/^\d+\s*-\s*"([\s\S]+)"$/);
    if (match) {
        try {
            const inner = JSON.parse(match[1]);
            const details = inner.error?.details;
            if (Array.isArray(details) && details.length > 0) {
                const msgs = details.map((d: any) => d.message).filter(Boolean);
                if (msgs.length > 0) return msgs.join('. ');
            }
            const innerMsg: string = inner.error?.message || '';
            if (innerMsg === 'Not Found') return 'Not Found — No record matches the provided details.';
            if (innerMsg === 'Internal Server Error') return 'Internal Server Error — The service is temporarily unavailable. Please try again later.';
            if (innerMsg === 'Bad Request') return 'Bad Request — The request was invalid. Please check your input and try again.';
            if (innerMsg) return innerMsg;
        } catch { /* fall through */ }
    }
    if (errObj?.status === 500 || msg.includes('500')) return 'Internal Server Error — The service is temporarily unavailable. Please try again later.';
    if (errObj?.status === 400 || msg.includes('400')) return 'Bad Request — The request was invalid. Please check your input and try again.';
    return msg || 'An unexpected error occurred. Please try again.';
};

// ─── Course Sessions View ─────────────────────────────────────────────────────

export const CourseSessionsView: React.FC = () => {
    const [uen, setUen] = useState<string>('201200696W');
    const [courseCode, setCourseCode] = useState<string>('');
    const [courseRunId, setCourseRunId] = useState<string>('');
    const [isSearching, setIsSearching] = useState(false);
    const [searchError, setSearchError] = useState<string | null>(null);
    const [parsedData, setParsedData] = useState<any>(null);

    const WEBHOOK_URL = 'https://n8n.srv1231536.hstgr.cloud/webhook/117adf9a-7802-439c-aa2d-7d2e0d10fe13';

    const isFormValid = uen.trim() && courseCode.trim() && courseRunId.trim();

    const handleSearch = async () => {
        if (!isFormValid) {
            setSearchError('Please fill in all fields.');
            return;
        }

        setIsSearching(true);
        setSearchError(null);
        setParsedData(null);

        try {
            const payload = {
                uen: uen.trim(),
                courseCode: courseCode.trim(),
                courseRunId: courseRunId.trim(),
            };

            const response = await fetch(WEBHOOK_URL, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload),
            });
         
            const text = await response.text();
               console.log('📤 Fetch sessions payload:', JSON.parse(text));
            let data: any;
            try {
                data = text ? JSON.parse(text) : {};
            } catch {
                throw new Error('Invalid response from server.');
            }

            // Handle array wrapper from n8n
            const item = Array.isArray(data) ? data[0] : data;

            // n8n AxiosError — SSG returned a non-2xx response
            if (item?.error && typeof item.error === 'object' && item.error.message) {
                throw new Error(parseSsgErrorMessage(item.error));
            }

            // SSG returned a non-200 status inside its own envelope
            if (item?.status && item.status !== 200) {
                const details = item.error?.details;
                if (Array.isArray(details) && details.length > 0) {
                    const msgs = details.map((d: any) => d.message).filter(Boolean);
                    if (msgs.length > 0) throw new Error(msgs.join('. '));
                }
                const statusMsg: string = item.error?.message || '';
                if (statusMsg === 'Not Found') throw new Error('Not Found — No record matches the provided details.');
                if (statusMsg === 'Internal Server Error') throw new Error('Internal Server Error — The service is temporarily unavailable. Please try again later.');
                if (statusMsg === 'Bad Request') throw new Error('Bad Request — The request was invalid. Please check your input and try again.');
                throw new Error(statusMsg || `Request failed with status ${item.status}.`);
            }

            if (!item?.result?.sessions) {
                throw new Error('Not Found — No sessions were returned for the provided details.');
            }

            setParsedData(item);
        } catch (err) {
            setSearchError(err instanceof Error ? err.message : 'Failed to fetch course sessions.');
        } finally {
            setIsSearching(false);
        }
    };

    const handleClear = () => {
        setUen('201200696W');
        setCourseCode('');
        setCourseRunId('');
        setSearchError(null);
        setParsedData(null);
    };

    const sessions: any[] = parsedData?.result?.sessions ?? [];

    return (
        <div>
            <h2 className="text-3xl font-bold mb-6 dark:text-white">Course Sessions</h2>

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
                                Fetch Sessions
                            </>
                        )}
                    </Button>
                </div>

            </Card>

            {/* Loading */}
            {isSearching && (
                <div className="flex justify-center py-10">
                    <div className="text-center">
                        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-500 mx-auto"></div>
                        <p className="mt-4 text-gray-600 dark:text-gray-400">Fetching course sessions...</p>
                    </div>
                </div>
            )}

            {/* Error Card */}
            {searchError && !isSearching && (
                <Card className="p-6 border-red-200 dark:border-red-700">
                    <div className="flex items-start gap-3 mb-4">
                        <div className="flex-shrink-0 w-10 h-10 rounded-full bg-red-100 dark:bg-red-900/40 flex items-center justify-center">
                            <Icon name={IconName.Close} className="w-5 h-5 text-red-600 dark:text-red-400" />
                        </div>
                        <div>
                            <h3 className="text-lg font-bold text-red-700 dark:text-red-400">Failed to Retrieve Sessions</h3>
                            <p className="text-sm text-gray-600 dark:text-gray-400 mt-1">{searchError}</p>
                        </div>
                    </div>
                    <div className="bg-red-50 dark:bg-red-900/20 rounded-lg p-4 grid grid-cols-1 sm:grid-cols-2 gap-3 text-sm">
                        <div>
                            <span className="font-medium text-gray-700 dark:text-gray-300">Company UEN: </span>
                            <span className="font-mono text-red-700 dark:text-red-300">{uen}</span>
                        </div>
                        <div>
                            <span className="font-medium text-gray-700 dark:text-gray-300">Course Code: </span>
                            <span className="font-mono text-red-700 dark:text-red-300">{courseCode}</span>
                        </div>
                        <div>
                            <span className="font-medium text-gray-700 dark:text-gray-300">Course Run ID: </span>
                            <span className="font-mono text-red-700 dark:text-red-300">{courseRunId}</span>
                        </div>
                    </div>
                </Card>
            )}

            {/* Success Results */}
            {parsedData && !isSearching && (
                <Card className="p-6">
                    <div className="flex items-center justify-between mb-4">
                        <h3 className="text-lg font-bold text-gray-700 dark:text-gray-200">Sessions</h3>
                        <span className="text-sm text-gray-500 dark:text-gray-400">
                            {sessions.length} session{sessions.length !== 1 ? 's' : ''}
                            {parsedData?.meta?.total != null && ` (total: ${parsedData.meta.total})`}
                        </span>
                    </div>

                    {sessions.length === 0 ? (
                        <div className="text-center py-10 text-gray-500 dark:text-gray-400">
                            <p className="font-medium">No sessions found for this course run.</p>
                        </div>
                    ) : (
                        <div className="overflow-x-auto">
                            <table className="min-w-full text-sm">
                                <thead>
                                    <tr className="border-b border-gray-200 dark:border-gray-700 text-left">
                                        <th className="pb-3 pr-4 font-semibold text-gray-600 dark:text-gray-300">#</th>
                                        <th className="pb-3 pr-4 font-semibold text-gray-600 dark:text-gray-300">Session ID</th>
                                        <th className="pb-3 pr-4 font-semibold text-gray-600 dark:text-gray-300">Date</th>
                                        <th className="pb-3 pr-4 font-semibold text-gray-600 dark:text-gray-300">Time</th>
                                        <th className="pb-3 pr-4 font-semibold text-gray-600 dark:text-gray-300">Mode</th>
                                        <th className="pb-3 pr-4 font-semibold text-gray-600 dark:text-gray-300">Venue</th>
                                        <th className="pb-3 pr-4 font-semibold text-gray-600 dark:text-gray-300">Attendance Taken</th>
                                        <th className="pb-3 font-semibold text-gray-600 dark:text-gray-300">Deleted</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {sessions.map((session: any, idx: number) => (
                                        <tr
                                            key={session.id}
                                            className="border-b border-gray-100 dark:border-gray-800 hover:bg-gray-50 dark:hover:bg-gray-800/50 align-top"
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
                                            <td className="py-3 pr-4 text-gray-600 dark:text-gray-400 text-xs">
                                                {session.venue ? (
                                                    <>
                                                        <p>{[session.venue.building, session.venue.block && `Blk ${session.venue.block}`].filter(Boolean).join(', ')}</p>
                                                        <p>{[session.venue.street, session.venue.postalCode && `S(${session.venue.postalCode})`].filter(Boolean).join(', ')}</p>
                                                    </>
                                                ) : '—'}
                                            </td>
                                            <td className="py-3 pr-4">
                                                <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium border ${session.attendanceTaken
                                                    ? 'bg-green-100 text-green-800 border-green-200'
                                                    : 'bg-gray-100 text-gray-700 border-gray-200'
                                                    }`}>
                                                    {session.attendanceTaken ? 'Yes' : 'No'}
                                                </span>
                                            </td>
                                            <td className="py-3">
                                                <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium border ${session.deleted
                                                    ? 'bg-red-100 text-red-800 border-red-200'
                                                    : 'bg-gray-100 text-gray-700 border-gray-200'
                                                    }`}>
                                                    {session.deleted ? 'Yes' : 'No'}
                                                </span>
                                            </td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
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
    const [uen, setUen] = useState<string>('201200696W');
    const [courseCode, setCourseCode] = useState<string>('');
    const [sessionId, setSessionId] = useState<string>('');
    const [courseRunId, setCourseRunId] = useState<string>('');
    const [isSearching, setIsSearching] = useState(false);
    const [searchError, setSearchError] = useState<string | null>(null);
    const [notFound, setNotFound] = useState(false);
    const [parsedData, setParsedData] = useState<any>(null);

    const WEBHOOK_URL = 'https://n8n.srv1231536.hstgr.cloud/webhook/c0d24850-9317-4ccc-b4b8-111e4c114ed8';

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
            const payload = {
                uen: uen.trim(),
                courseCode: courseCode.trim(),
                sessionId: sessionId.trim(),
                courseRunId: courseRunId.trim(),
            };

            const response = await fetch(WEBHOOK_URL, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload),
            });

            const text = await response.text();
            let data: any;
            try {
                data = text ? JSON.parse(text) : {};
            } catch {
                throw new Error('Invalid response from server.');
            }

            // Handle array wrapper from n8n
            const item = Array.isArray(data) ? data[0] : data;

            // n8n AxiosError — check HTTP status code to determine how to handle
            if (item?.error && typeof item.error === 'object' && item.error.status) {
                const httpStatus = item.error.status;
                if (httpStatus === 404) {
                    setNotFound(true);
                    return;
                }
                if (httpStatus === 500) throw new Error('Internal Server Error — The service is temporarily unavailable. Please try again later.');
                if (httpStatus === 400) throw new Error('Bad Request — The request was invalid. Please check your input and try again.');
                throw new Error(`Request failed with status ${httpStatus}. Please try again.`);
            }

            const resultRaw = item?.result;

            // Handle both formats:
            // 1. n8n wraps SSG response: { "result": "{ JSON string }" }
            // 2. n8n passes SSG response directly: { "data": { "courseRun": {...} }, ... }
            let parsedPayload: any = null;
            if (resultRaw && resultRaw !== '') {
                parsedPayload = typeof resultRaw === 'string' ? JSON.parse(resultRaw) : resultRaw;
            } else if (item?.data?.courseRun) {
                parsedPayload = item;
            }

            if (!parsedPayload) {
                setNotFound(true);
                return;
            }

            setParsedData(parsedPayload);
        } catch (err) {
            setSearchError(err instanceof Error ? err.message : 'Failed to fetch attendance data.');
        } finally {
            setIsSearching(false);
        }
    };

    const handleClear = () => {
        setUen('201200696W');
        setCourseCode('');
        setSessionId('');
        setCourseRunId('');
        setSearchError(null);
        setNotFound(false);
        setParsedData(null);
    };

    const courseRun = parsedData?.data?.courseRun;
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
                    <div className="flex items-start gap-3 mb-4">
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
                    <div className="bg-red-50 dark:bg-red-900/20 rounded-lg p-4 grid grid-cols-1 sm:grid-cols-2 gap-3 text-sm">
                        <div>
                            <span className="font-medium text-gray-700 dark:text-gray-300">Company UEN: </span>
                            <span className="font-mono text-red-700 dark:text-red-300">{uen}</span>
                        </div>
                        <div>
                            <span className="font-medium text-gray-700 dark:text-gray-300">Course Code: </span>
                            <span className="font-mono text-red-700 dark:text-red-300">{courseCode}</span>
                        </div>
                        <div>
                            <span className="font-medium text-gray-700 dark:text-gray-300">Session ID: </span>
                            <span className="font-mono text-red-700 dark:text-red-300">{sessionId}</span>
                        </div>
                        <div>
                            <span className="font-medium text-gray-700 dark:text-gray-300">Course Run ID: </span>
                            <span className="font-mono text-red-700 dark:text-red-300">{courseRunId}</span>
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