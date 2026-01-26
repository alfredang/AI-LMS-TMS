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

const inputClasses = "block w-full px-3 py-2 text-on-surface bg-white border border-gray-300 rounded-md shadow-sm placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent";

const PlaceholderView: React.FC<{ title: string }> = ({ title }) => (
    <div>
        <h2 className="text-3xl font-bold mb-6">{title}</h2>
        <Card className="p-6">
            <p className="text-gray-500 text-center py-12">
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
            const allLearnerEmails = new Set(selectedCourse.learners.map((l: any) => l.email as string));
            setSelectedLearners(allLearnerEmails);
        } else {
            setSelectedLearners(new Set());
        }
    };

    const handleSelectLearner = (email: string) => {
        const newSelection = new Set(selectedLearners);
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
            setSelectedLearners(new Set());
        }, 2000);
    };

    return (
        <div>
            <h2 className="text-3xl font-bold mb-6">Apply New Grant</h2>
            <Card className="p-6 mb-6">
                <div className="space-y-4">
                    <div>
                        <label htmlFor="class-select-grant" className="block text-sm font-bold text-gray-700 mb-1">
                            1. Select an Upcoming Class
                        </label>
                        <select
                            id="class-select-grant"
                            value={selectedCourseId}
                            onChange={e => {
                                setSelectedCourseId(e.target.value);
                                setSelectedLearners(new Set());
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
                            <p className="text-sm text-gray-500 mt-2">No classes found. Please create classes first.</p>
                        )}
                        {courses.length > 0 && upcomingClasses.length === 0 && (
                            <p className="text-sm text-gray-500 mt-2">No upcoming classes found.</p>
                        )}
                    </div>

                    {selectedCourse && (
                        <div>
                            <h3 className="text-lg font-bold text-gray-800 mb-2">2. Select Learners for Submission</h3>
                            <p className="text-sm text-gray-500 mb-4">
                                Select one or more learners from the list below to include in the grant application to SSG.
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
                                            checked={selectedCourse?.learners?.length > 0 && selectedLearners.size === selectedCourse.learners.length}
                                        />
                                    </th>
                                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Learner</th>
                                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Email</th>
                                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Grant Status</th>
                                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Sponsorship</th>
                                </tr>
                            </thead>
                            <tbody className="bg-white divide-y divide-gray-200">
                                {selectedCourse.learners && selectedCourse.learners.length > 0 ? (
                                    selectedCourse.learners.map((learner: any) => (
                                        <tr key={learner.email} className="hover:bg-gray-50">
                                            <td className="px-6 py-4 whitespace-nowrap">
                                                <input
                                                    type="checkbox"
                                                    checked={selectedLearners.has(learner.email)}
                                                    onChange={() => handleSelectLearner(learner.email)}
                                                />
                                            </td>
                                            <td className="px-6 py-4 whitespace-nowrap">
                                                <div className="font-medium text-gray-900">{learner.name || 'N/A'}</div>
                                            </td>
                                            <td className="px-6 py-4 whitespace-nowrap">
                                                <div className="text-sm text-gray-900">{learner.email || 'N/A'}</div>
                                            </td>
                                            <td className="px-6 py-4 whitespace-nowrap">
                                                <span className={`inline-flex px-2 py-1 text-xs font-semibold rounded-full border ${getStatusColor(learner.grantStatus || 'Pending')}`}>
                                                    {learner.grantStatus || 'Pending'}
                                                </span>
                                            </td>
                                            <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                                                {learner.courseSponsorship || 'N/A'}
                                            </td>
                                        </tr>
                                    ))
                                ) : (
                                    <tr>
                                        <td colSpan={5} className="px-6 py-12 text-center text-gray-500">
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
    const WEBHOOK_URL = 'https://n8n.srv923061.hstgr.cloud/webhook/7e7f983f-a8c8-44f7-955b-291a72ae1b63';

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
                throw new Error(`HTTP error! status: ${response.status}`);
            }

            const data = await response.json();
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
            <h2 className="text-3xl font-bold mb-6">View Grant Status</h2>

            {/* Search Bar Card */}
            <Card className="p-6 mb-6">
                <div>
                    <label htmlFor="grant-search" className="block text-sm font-bold text-gray-700 mb-1">
                        Search Grant Status
                    </label>
                    <p className="text-sm text-gray-500 mb-3">
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
                        <p className="mt-4 text-gray-600">Fetching grant status from n8n...</p>
                    </div>
                </div>
            )}

            {/* Webhook Response Display */}
            {webhookResponse && !isSearching && (
                <Card className="p-0">
                    <div className="p-6 border-b">
                        <h3 className="text-xl font-bold">Grant Status Results</h3>
                        <p className="text-gray-500 mt-1">Search query: "{searchInput}"</p>
                    </div>
                    <div className="p-6">
                        {/* Check if response has the expected structure */}
                        {webhookResponse.result && webhookResponse.result.data ? (
                            <div className="space-y-6">
                                {/* Grant Summary Card */}
                                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                    <div className="bg-white border border-gray-200 rounded-lg p-4">
                                        <h4 className="text-sm font-medium text-gray-500 mb-2">Grant Reference Number</h4>
                                        <p className="text-lg font-semibold text-gray-900">
                                            {webhookResponse.result.data.referenceNumber || 'N/A'}
                                        </p>
                                    </div>
                                    <div className="bg-white border border-gray-200 rounded-lg p-4">
                                        <h4 className="text-sm font-medium text-gray-500 mb-2">Status</h4>
                                        <span className={`inline-flex px-3 py-1 text-sm font-semibold rounded-full border ${getStatusColor(webhookResponse.result.data.status || 'Pending')}`}>
                                            {webhookResponse.result.data.status || 'Pending'}
                                        </span>
                                    </div>
                                </div>

                                {/* Funding Information */}
                                {webhookResponse.result.data.fundingScheme && (
                                    <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
                                        <h4 className="font-semibold text-blue-900 mb-3">Funding Information</h4>
                                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                            <div>
                                                <p className="text-sm text-blue-700 font-medium">Funding Scheme</p>
                                                <p className="text-blue-900">
                                                    {webhookResponse.result.data.fundingScheme.code} - {webhookResponse.result.data.fundingScheme.description}
                                                </p>
                                            </div>
                                            {webhookResponse.result.data.fundingComponent && (
                                                <div>
                                                    <p className="text-sm text-blue-700 font-medium">Funding Component</p>
                                                    <p className="text-blue-900">
                                                        {webhookResponse.result.data.fundingComponent.code} - {webhookResponse.result.data.fundingComponent.description}
                                                    </p>
                                                </div>
                                            )}
                                        </div>
                                    </div>
                                )}

                                {/* Grant Amount Details */}
                                {webhookResponse.result.data.grantAmount && (
                                    <div className="bg-green-50 border border-green-200 rounded-lg p-4">
                                        <h4 className="font-semibold text-green-900 mb-3">Grant Amount</h4>
                                        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                                            <div>
                                                <p className="text-sm text-green-700 font-medium">Estimated</p>
                                                <p className="text-xl font-bold text-green-900">
                                                    ${webhookResponse.result.data.grantAmount.estimated?.toFixed(2) || '0.00'}
                                                </p>
                                            </div>
                                            <div>
                                                <p className="text-sm text-green-700 font-medium">Paid</p>
                                                <p className="text-xl font-bold text-green-900">
                                                    ${webhookResponse.result.data.grantAmount.paid?.toFixed(2) || '0.00'}
                                                </p>
                                            </div>
                                            <div>
                                                <p className="text-sm text-green-700 font-medium">Recovery</p>
                                                <p className="text-xl font-bold text-green-900">
                                                    ${webhookResponse.result.data.grantAmount.recovery?.toFixed(2) || '0.00'}
                                                </p>
                                            </div>
                                        </div>
                                    </div>
                                )}

                                {/* Enrolment Information */}
                                {webhookResponse.result.data.enrolment && (
                                    <div className="bg-gray-50 border border-gray-200 rounded-lg p-4">
                                        <h4 className="font-semibold text-gray-900 mb-2">Enrolment Reference</h4>
                                        <p className="text-gray-700">
                                            {webhookResponse.result.data.enrolment.referenceNumber || 'N/A'}
                                        </p>
                                    </div>
                                )}

                                {/* Meta Information */}
                                {webhookResponse.result.meta && (
                                    <div className="bg-gray-50 border border-gray-200 rounded-lg p-4">
                                        <h4 className="font-semibold text-gray-900 mb-3">Timestamps</h4>
                                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                            <div>
                                                <p className="text-sm text-gray-600 font-medium">Created On</p>
                                                <p className="text-gray-900">{webhookResponse.result.meta.createdOn || 'N/A'}</p>
                                            </div>
                                            <div>
                                                <p className="text-sm text-gray-600 font-medium">Last Updated</p>
                                                <p className="text-gray-900">{webhookResponse.result.meta.updatedOn || 'N/A'}</p>
                                            </div>
                                        </div>
                                    </div>
                                )}

                                {/* Raw JSON Response (Collapsible) */}
                                <details className="bg-gray-50 border border-gray-200 rounded-lg p-4">
                                    <summary className="font-semibold text-gray-800 cursor-pointer hover:text-gray-600">
                                        View Raw JSON Response
                                    </summary>
                                    <pre className="mt-3 text-sm text-gray-700 whitespace-pre-wrap overflow-x-auto max-h-96 bg-white p-3 rounded border">
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
                    <div className="text-center text-gray-500">
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
    // No mock data - empty arrays for now
    const courses: any[] = [];

    const [selectedCourseId, setSelectedCourseId] = useState<string>('');
    const [isSubmitting, setIsSubmitting] = useState(false);
    const [submissionStatus, setSubmissionStatus] = useState<string | null>(null);

    const selectedCourse = useMemo(() => {
        return courses.find(c => c.id === selectedCourseId);
    }, [courses, selectedCourseId]);

    const handleGradeChange = (learnerEmail: string, newStatus: string) => {
        // In real implementation, this would update the learner's assessment grade
        console.log(`Grade change for ${learnerEmail}: ${newStatus}`);
    };

    const allLearnersGraded = useMemo(() => {
        if (!selectedCourse || !selectedCourse.learners) return false;
        if (selectedCourse.learners.length === 0) return false;
        return selectedCourse.learners.every((learner: any) => learner.assessmentStatus !== 'Pending');
    }, [selectedCourse]);

    const handleSubmitToTPG = () => {
        setIsSubmitting(true);
        setSubmissionStatus(null);

        // Simulate API call to TPG
        setTimeout(() => {
            setIsSubmitting(false);
            setSubmissionStatus(`Successfully submitted assessment results for ${selectedCourse?.title} to TPG.`);
        }, 1500);
    };

    return (
        <div>
            <h2 className="text-3xl font-bold mb-6">Submit Assessment Results</h2>
            <Card className="p-6 mb-6">
                <div className="grid grid-cols-1">
                    <div>
                        <label htmlFor="class-select-assessment" className="block text-sm font-bold text-gray-700 mb-1">
                            1. Select a Class
                        </label>
                        <select
                            id="class-select-assessment"
                            value={selectedCourseId}
                            onChange={(e) => {
                                setSelectedCourseId(e.target.value);
                                setSubmissionStatus(null);
                            }}
                            className={inputClasses}
                        >
                            <option value="" disabled>-- Choose a class --</option>
                            {courses.length === 0 ? (
                                <option value="" disabled>No classes available</option>
                            ) : (
                                courses.map(course => (
                                    <option key={course.id} value={course.id}>
                                        {course.title} ({course.courseRunId})
                                    </option>
                                ))
                            )}
                        </select>
                        {courses.length === 0 && (
                            <p className="text-sm text-gray-500 mt-2">No classes found. Please create classes first.</p>
                        )}
                    </div>
                </div>
            </Card>

            {selectedCourse && (
                <Card className="p-0 overflow-x-auto">
                    <div className="p-6 border-b">
                        <h3 className="text-xl font-bold">Assessment Roster for "{selectedCourse.title}"</h3>
                        <p className="text-gray-500 mt-1">Update each learner's overall assessment status below. Changes are saved automatically.</p>
                    </div>
                    <table className="min-w-full divide-y divide-gray-200">
                        <thead className="bg-gray-50">
                            <tr>
                                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Learner Name</th>
                                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Email</th>
                                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Assessment Status</th>
                            </tr>
                        </thead>
                        <tbody className="bg-white divide-y divide-gray-200">
                            {selectedCourse.learners && selectedCourse.learners.length > 0 ? (
                                selectedCourse.learners.map((learner: any) => (
                                    <tr key={learner.email} className="hover:bg-gray-50">
                                        <td className="px-6 py-4 whitespace-nowrap">
                                            <div className="font-medium text-gray-900">{learner.name || 'N/A'}</div>
                                        </td>
                                        <td className="px-6 py-4 whitespace-nowrap">
                                            <div className="text-sm text-gray-900">{learner.email || 'N/A'}</div>
                                        </td>
                                        <td className="px-6 py-4 whitespace-nowrap">
                                            <select
                                                value={learner.assessmentStatus || 'Pending'}
                                                onChange={(e) => handleGradeChange(learner.email, e.target.value)}
                                                className="text-sm border border-gray-300 rounded px-2 py-1"
                                            >
                                                <option value="Pending">Pending</option>
                                                <option value="C">Competent</option>
                                                <option value="NYC">Not Yet Competent</option>
                                            </select>
                                        </td>
                                    </tr>
                                ))
                            ) : (
                                <tr>
                                    <td colSpan={3} className="px-6 py-12 text-center text-gray-500">
                                        No learners enrolled in this class yet.
                                    </td>
                                </tr>
                            )}
                        </tbody>
                    </table>
                    <div className="p-4 border-t flex justify-end items-center gap-4">
                        {submissionStatus && <p className="text-green-600 text-sm font-semibold">{submissionStatus}</p>}
                        <Button
                            onClick={handleSubmitToTPG}
                            disabled={!allLearnersGraded || isSubmitting}
                        >
                            {isSubmitting ? (
                                <div className="flex items-center">
                                    <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white mr-2"></div>
                                    Submitting...
                                </div>
                            ) : 'Submit to TPG'}
                        </Button>
                    </div>
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
                    <label htmlFor="class-select-view-assessment" className="block text-sm font-bold text-gray-700 mb-1">
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
                        <p className="text-sm text-gray-500 mt-2">No classes found. Please create classes first.</p>
                    )}
                </div>
            </Card>

            {isLoading && (
                <div className="flex justify-center py-10">
                    <div className="text-center">
                        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-500 mx-auto"></div>
                        <p className="mt-4 text-gray-600">Retrieving data from TPG...</p>
                    </div>
                </div>
            )}

            {results && (
                <Card className="p-0">
                    <div className="p-6 border-b">
                        <h3 className="text-xl font-bold">Assessment Status for {courses.find(c => c.id === selectedCourseId)?.title}</h3>
                        <p className="text-gray-500 mt-1">Showing official results retrieved from TPG.</p>
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
                                            <div className="font-medium text-gray-900">{result.learnerName}</div>
                                        </td>
                                        <td className="px-6 py-4 whitespace-nowrap">
                                            <div className="text-sm text-gray-900">{result.courseTitle}</div>
                                            <div className="text-sm text-gray-500">{result.courseRunId}</div>
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
            const allEligibleLearnerEmails = new Set(eligibleLearners.map((l: any) => l.email as string));
            setSelectedLearners(allEligibleLearnerEmails);
        } else {
            setSelectedLearners(new Set());
        }
    };

    const handleSelectLearner = (email: string) => {
        const newSelection = new Set(selectedLearners);
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
            setSelectedLearners(new Set());
        }, 2000);
    };

    return (
        <div>
            <h2 className="text-3xl font-bold mb-6">Apply New Claim</h2>
            <Card className="p-6 mb-6">
                <div className="space-y-4">
                    <div>
                        <label htmlFor="class-select-claim" className="block text-sm font-bold text-gray-700 mb-1">
                            1. Select a Class
                        </label>
                        <select
                            id="class-select-claim"
                            value={selectedCourseId}
                            onChange={e => {
                                setSelectedCourseId(e.target.value);
                                setSelectedLearners(new Set());
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
                            <p className="text-sm text-gray-500 mt-2">No classes found. Please create classes first.</p>
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
                                                    <div className="font-medium text-gray-900">{learner.name || 'N/A'}</div>
                                                </td>
                                                <td className="px-6 py-4 whitespace-nowrap">
                                                    <div className="text-sm text-gray-900">{learner.email || 'N/A'}</div>
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
                                        <td colSpan={5} className="px-6 py-12 text-center text-gray-500">
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
                    <label htmlFor="class-select-claim-status" className="block text-sm font-bold text-gray-700 mb-1">
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
                        <p className="text-sm text-gray-500 mt-2">No classes found. Please create classes first.</p>
                    )}
                </div>
            </Card>

            {selectedCourse && (
                <Card className="p-0">
                    <div className="p-6 border-b">
                        <h3 className="text-xl font-bold">Claim Status for {selectedCourse.title}</h3>
                        <p className="text-gray-500 mt-1">Showing all enrolled learners and their claim application status.</p>
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
                                                <div className="font-medium text-gray-900">{learner.name || 'N/A'}</div>
                                            </td>
                                            <td className="px-6 py-4 whitespace-nowrap">
                                                <div className="text-sm text-gray-900">{learner.email || 'N/A'}</div>
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
                                            <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                                                {learner.claimId || 'N/A'}
                                            </td>
                                            <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                                                N/A
                                            </td>
                                        </tr>
                                    ))
                                ) : (
                                    <tr>
                                        <td colSpan={6} className="px-6 py-12 text-center text-gray-500">
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
                <h3 className="text-xl font-bold">Upload Course Runs</h3>
                <p className="text-gray-500 mt-1">Submit your course run details in bulk by uploading an Excel file.</p>
            </div>

            <div
                onDragOver={(e) => handleDragEvents(e, true)}
                onDragLeave={(e) => handleDragEvents(e, false)}
                onDrop={handleDrop}
                className={`p-10 border-2 border-dashed rounded-lg text-center cursor-pointer transition-colors ${isDragOver ? 'border-blue-500 bg-blue-50' : 'border-gray-300 hover:border-blue-500'}`}
            >
                <input
                    type="file"
                    id="file-upload"
                    className="hidden"
                    accept=".xlsx, .xls"
                    onChange={(e) => handleFileChange(e.target.files?.[0])}
                />
                <label htmlFor="file-upload" className="cursor-pointer">
                    <Icon name={IconName.Upload} className="w-12 h-12 mx-auto text-gray-400" />
                    <p className="mt-2 font-semibold text-gray-900">
                        {file ? file.name : 'Drag & drop your file here, or click to browse'}
                    </p>
                    <p className="text-xs text-gray-500 mt-1">
                        XLSX or XLS file format
                    </p>
                </label>
            </div>
            {error && <p className="text-red-500 text-sm mt-2 text-center">{error}</p>}

            <div className="flex justify-between items-center mt-6">
                <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => alert('Downloading SSG Course Run template...')}
                >
                    <Icon name={IconName.Download} className="w-4 h-4 mr-2" />
                    Download Template
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
            <div className="p-6 border-b">
                <h3 className="text-xl font-bold">Submission Results</h3>
                <p className="text-gray-500 mt-1">The following results were returned from SSG.</p>
            </div>
            <div className="overflow-x-auto">
                <table className="min-w-full divide-y divide-gray-200">
                    <thead className="bg-gray-50">
                        <tr>
                            <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Course Reference</th>
                            <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Start Date</th>
                            <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">End Date</th>
                            <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Status</th>
                            <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Details</th>
                        </tr>
                    </thead>
                    <tbody className="bg-white divide-y divide-gray-200">
                        {submissionResult?.map((result, index) => (
                            <tr key={index} className="hover:bg-gray-50">
                                <td className="px-6 py-4 whitespace-nowrap font-medium text-gray-900">{result.courseRef}</td>
                                <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">{result.startDate}</td>
                                <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">{result.endDate}</td>
                                <td className="px-6 py-4 whitespace-nowrap">
                                    <span className={`inline-flex px-2 py-1 text-xs font-semibold rounded-full border ${getStatusColor(result.status)}`}>
                                        {result.status}
                                    </span>
                                </td>
                                <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                                    {result.status === 'Success' ? `Course Run ID: ${result.courseRunId}` : result.error}
                                </td>
                            </tr>
                        ))}
                    </tbody>
                </table>
            </div>
            <div className="p-4 border-t text-right">
                <Button onClick={resetView}>Start a New Upload</Button>
            </div>
        </Card>
    );

    return (
        <div>
            <h2 className="text-3xl font-bold mb-6">Upload Course Runs to SSG</h2>
            {isUploading ? (
                <div className="flex justify-center py-20">
                    <div className="text-center">
                        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-500 mx-auto"></div>
                        <p className="mt-4 text-gray-600">Submitting to SSG, this may take a moment...</p>
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