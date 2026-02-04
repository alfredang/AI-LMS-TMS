import React, { useState } from 'react';
import { Card } from '../ui/Card';
import { Button } from '../ui/Button';
import { Icon, IconName } from '../ui/Icon';

// Search Assessments View - Similar to SearchCourseRunsView
export const SearchAssessmentsView: React.FC = () => {
    const [courseRunId, setCourseRunId] = useState<string>('');
    const [courseReferenceNumber, setCourseReferenceNumber] = useState<string>('');
    const [enrolmentReferenceNumber, setEnrolmentReferenceNumber] = useState<string>('');
    const [traineeIdNumber, setTraineeIdNumber] = useState<string>('');
    const [isSearching, setIsSearching] = useState(false);
    const [searchResults, setSearchResults] = useState<any[]>([]);
    const [searchError, setSearchError] = useState<string | null>(null);
    const [currentPage, setCurrentPage] = useState(1);
    const resultsPerPage = 10;

    const WEBHOOK_URL = 'https://n8n.srv1231536.hstgr.cloud/webhook/4d22747c-8491-43f3-aa84-5111e9476ea1'; // Update with actual webhook URL

    const inputClasses = "block w-full px-3 py-2 text-on-surface bg-white border border-gray-300 rounded-md shadow-sm placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent dark:bg-gray-700 dark:border-gray-600 dark:text-white dark:placeholder-gray-500";

    const handleSearch = async () => {
        // Course Run ID and Course Reference Number are required
        if (!courseRunId.trim() || !courseReferenceNumber.trim()) {
            setSearchError('Both Course Run ID and Course Reference Number are required');
            return;
        }

        setIsSearching(true);
        setSearchError(null);
        setSearchResults([]);
        setCurrentPage(1);

        try {
            console.log('🔍 Searching assessments...');

            // Build payload - only include non-empty fields
            const payload: any = {
                timestamp: new Date().toISOString(),
                source: 'admin-search-assessments'
            };

            if (courseRunId.trim()) {
                payload.courseRunId = courseRunId.trim();
            }
            
            if (courseReferenceNumber.trim()) {
                payload.courseReferenceNumber = courseReferenceNumber.trim();
            }
            
            if (enrolmentReferenceNumber.trim()) {
                payload.enrolmentReferenceNumber = enrolmentReferenceNumber.trim();
            }
            
            if (traineeIdNumber.trim()) {
                payload.traineeIdNumber = traineeIdNumber.trim();
            }

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

            const data = await response.json();
            console.log('✅ Search response:', data);

            // Parse response
            let results = [];
            if (data?.result) {
                const parsedResult = typeof data.result === 'string' ? JSON.parse(data.result) : data.result;
                
                // Check for error status
                if (parsedResult?.status && parsedResult.status !== '200') {
                    const errorMessage = parsedResult?.error?.details?.[0]?.message || 
                                        parsedResult?.error?.message || 
                                        'No assessments found';
                    setSearchError(errorMessage);
                    setSearchResults([]);
                    return;
                }
                
                // Extract data array from result.data
                if (parsedResult?.data && Array.isArray(parsedResult.data)) {
                    results = parsedResult.data;
                } else if (Array.isArray(parsedResult)) {
                    results = parsedResult;
                }
            } else if (Array.isArray(data)) {
                results = data;
            }

            setSearchResults(results);

            if (results.length === 0) {
                setSearchError('No assessments found matching your criteria');
            }
        } catch (error) {
            console.error('❌ Error searching assessments:', error);
            setSearchError(error instanceof Error ? error.message : 'Failed to search assessments');
        } finally {
            setIsSearching(false);
        }
    };

    // Pagination
    const indexOfLastResult = currentPage * resultsPerPage;
    const indexOfFirstResult = indexOfLastResult - resultsPerPage;
    const currentResults = searchResults.slice(indexOfFirstResult, indexOfLastResult);
    const totalPages = Math.ceil(searchResults.length / resultsPerPage);

    const handleClearSearch = () => {
        setCourseRunId('');
        setCourseReferenceNumber('');
        setEnrolmentReferenceNumber('');
        setTraineeIdNumber('');
        setSearchResults([]);
        setSearchError(null);
        setCurrentPage(1);
    };

    return (
        <div>
            <h2 className="text-3xl font-bold mb-6 dark:text-white">Search Assessments</h2>

            {/* Search Filters Card */}
            <Card className="p-6 mb-6">
                <h3 className="text-lg font-bold text-gray-700 dark:text-gray-200 mb-4">Search Criteria</h3>
                <p className="text-sm text-gray-600 dark:text-gray-400 mb-4">
                    Course Run ID and Course Reference Number are required. Other fields are optional.
                </p>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
                    <div>
                        <label htmlFor="course-run-id" className="block text-sm font-bold text-gray-700 dark:text-gray-300 mb-1">
                            Course Run ID <span className="text-red-500">*</span>
                        </label>
                        <input
                            id="course-run-id"
                            type="text"
                            value={courseRunId}
                            onChange={(e) => setCourseRunId(e.target.value)}
                            placeholder="e.g. 12345"
                            className={inputClasses}
                            disabled={isSearching}
                        />
                    </div>
                    <div>
                        <label htmlFor="course-ref-number" className="block text-sm font-bold text-gray-700 dark:text-gray-300 mb-1">
                            Course Reference Number <span className="text-red-500">*</span>
                        </label>
                        <input
                            id="course-ref-number"
                            type="text"
                            value={courseReferenceNumber}
                            onChange={(e) => setCourseReferenceNumber(e.target.value)}
                            placeholder="e.g. TGS-2024052076"
                            className={inputClasses}
                            disabled={isSearching}
                        />
                    </div>
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
                    <div>
                        <label htmlFor="enrolment-ref" className="block text-sm font-bold text-gray-700 dark:text-gray-300 mb-1">
                            Enrolment Reference Number
                        </label>
                        <input
                            id="enrolment-ref"
                            type="text"
                            value={enrolmentReferenceNumber}
                            onChange={(e) => setEnrolmentReferenceNumber(e.target.value)}
                            placeholder="Optional"
                            className={inputClasses}
                            disabled={isSearching}
                        />
                    </div>
                    <div>
                        <label htmlFor="trainee-id" className="block text-sm font-bold text-gray-700 dark:text-gray-300 mb-1">
                            Trainee ID/NRIC
                        </label>
                        <input
                            id="trainee-id"
                            type="text"
                            value={traineeIdNumber}
                            onChange={(e) => setTraineeIdNumber(e.target.value)}
                            placeholder="Optional"
                            className={inputClasses}
                            disabled={isSearching}
                        />
                    </div>
                </div>

                <div className="flex gap-3">
                    <Button
                        onClick={handleSearch}
                        disabled={isSearching || !courseRunId.trim() || !courseReferenceNumber.trim()}
                    >
                        {isSearching ? (
                            <div className="flex items-center">
                                <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white mr-2"></div>
                                Searching...
                            </div>
                        ) : (
                            <>
                                <Icon name={IconName.Search} className="w-4 h-4 mr-2" />
                                Search Assessments
                            </>
                        )}
                    </Button>
                    <Button variant="outline" onClick={handleClearSearch} disabled={isSearching}>
                        Clear
                    </Button>
                </div>

                {searchError && (
                    <p className="text-red-500 text-sm mt-3">{searchError}</p>
                )}
            </Card>

            {/* Loading State */}
            {isSearching && (
                <div className="flex justify-center py-10">
                    <div className="text-center">
                        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-500 mx-auto"></div>
                        <p className="mt-4 text-gray-600 dark:text-gray-400">Searching assessments...</p>
                    </div>
                </div>
            )}

            {/* Results Table */}
            {!isSearching && searchResults.length > 0 && (
                <Card className="p-0 overflow-hidden">
                    <div className="p-6 border-b dark:border-gray-700">
                        <h3 className="text-xl font-bold dark:text-white">
                            Search Results ({searchResults.length} assessment{searchResults.length !== 1 ? 's' : ''} found)
                        </h3>
                    </div>
                    <div className="overflow-x-auto">
                        <table className="w-full border-collapse">
                            <thead className="bg-gray-50 dark:bg-gray-800">
                                <tr>
                                    <th className="px-6 py-3 text-left text-xs font-bold text-gray-700 dark:text-gray-300 uppercase tracking-wider border-b dark:border-gray-700">
                                        Reference Number
                                    </th>
                                    <th className="px-6 py-3 text-left text-xs font-bold text-gray-700 dark:text-gray-300 uppercase tracking-wider border-b dark:border-gray-700">
                                        Result
                                    </th>
                                    <th className="px-6 py-3 text-left text-xs font-bold text-gray-700 dark:text-gray-300 uppercase tracking-wider border-b dark:border-gray-700">
                                        Score
                                    </th>
                                    <th className="px-6 py-3 text-left text-xs font-bold text-gray-700 dark:text-gray-300 uppercase tracking-wider border-b dark:border-gray-700">
                                        Grade
                                    </th>
                                    <th className="px-6 py-3 text-left text-xs font-bold text-gray-700 dark:text-gray-300 uppercase tracking-wider border-b dark:border-gray-700">
                                        Assessment Date
                                    </th>
                                    <th className="px-6 py-3 text-left text-xs font-bold text-gray-700 dark:text-gray-300 uppercase tracking-wider border-b dark:border-gray-700">
                                        Skill Code
                                    </th>
                                    <th className="px-6 py-3 text-left text-xs font-bold text-gray-700 dark:text-gray-300 uppercase tracking-wider border-b dark:border-gray-700">
                                        Course Reference Number
                                    </th>
                                    <th className="px-6 py-3 text-left text-xs font-bold text-gray-700 dark:text-gray-300 uppercase tracking-wider border-b dark:border-gray-700">
                                        Course Title
                                    </th>
                                    <th className="px-6 py-3 text-left text-xs font-bold text-gray-700 dark:text-gray-300 uppercase tracking-wider border-b dark:border-gray-700">
                                        Course Run ID
                                    </th>
                                    <th className="px-6 py-3 text-left text-xs font-bold text-gray-700 dark:text-gray-300 uppercase tracking-wider border-b dark:border-gray-700">
                                        Course Start Date
                                    </th>
                                    <th className="px-6 py-3 text-left text-xs font-bold text-gray-700 dark:text-gray-300 uppercase tracking-wider border-b dark:border-gray-700">
                                        Course End Date
                                    </th>
                                    <th className="px-6 py-3 text-left text-xs font-bold text-gray-700 dark:text-gray-300 uppercase tracking-wider border-b dark:border-gray-700">
                                        Trainee ID
                                    </th>
                                    <th className="px-6 py-3 text-left text-xs font-bold text-gray-700 dark:text-gray-300 uppercase tracking-wider border-b dark:border-gray-700">
                                        Trainee Full Name
                                    </th>
                                    <th className="px-6 py-3 text-left text-xs font-bold text-gray-700 dark:text-gray-300 uppercase tracking-wider border-b dark:border-gray-700">
                                        Trainee ID Type
                                    </th>
                                    <th className="px-6 py-3 text-left text-xs font-bold text-gray-700 dark:text-gray-300 uppercase tracking-wider border-b dark:border-gray-700">
                                        Enrolment Reference Number
                                    </th>
                                    <th className="px-6 py-3 text-left text-xs font-bold text-gray-700 dark:text-gray-300 uppercase tracking-wider border-b dark:border-gray-700">
                                        Training Partner UEN
                                    </th>
                                    <th className="px-6 py-3 text-left text-xs font-bold text-gray-700 dark:text-gray-300 uppercase tracking-wider border-b dark:border-gray-700">
                                        Training Partner Code
                                    </th>
                                    <th className="px-6 py-3 text-left text-xs font-bold text-gray-700 dark:text-gray-300 uppercase tracking-wider border-b dark:border-gray-700">
                                        Training Partner Name
                                    </th>
                                    <th className="px-6 py-3 text-left text-xs font-bold text-gray-700 dark:text-gray-300 uppercase tracking-wider border-b dark:border-gray-700">
                                        Conferring Institute UEN
                                    </th>
                                    <th className="px-6 py-3 text-left text-xs font-bold text-gray-700 dark:text-gray-300 uppercase tracking-wider border-b dark:border-gray-700">
                                        Conferring Institute Code
                                    </th>
                                    <th className="px-6 py-3 text-left text-xs font-bold text-gray-700 dark:text-gray-300 uppercase tracking-wider border-b dark:border-gray-700">
                                        Conferring Institute Name
                                    </th>
                                    <th className="px-6 py-3 text-left text-xs font-bold text-gray-700 dark:text-gray-300 uppercase tracking-wider border-b dark:border-gray-700">
                                        Created On
                                    </th>
                                    <th className="px-6 py-3 text-left text-xs font-bold text-gray-700 dark:text-gray-300 uppercase tracking-wider border-b dark:border-gray-700">
                                        Updated On
                                    </th>
                                </tr>
                            </thead>
                            <tbody className="bg-white dark:bg-gray-900 divide-y divide-gray-200 dark:divide-gray-700">
                                {currentResults.map((assessment, index) => {
                                    // Helper to get result badge color
                                    const getResultColor = (result: string) => {
                                        switch (result?.toLowerCase()) {
                                            case 'pass':
                                            case 'passed':
                                            case 'competent':
                                                return 'bg-green-100 text-green-800 border-green-200 dark:bg-green-900/30 dark:text-green-300 dark:border-green-700';
                                            case 'fail':
                                            case 'failed':
                                            case 'not yet competent':
                                                return 'bg-red-100 text-red-800 border-red-200 dark:bg-red-900/30 dark:text-red-300 dark:border-red-700';
                                            case 'void':
                                                return 'bg-gray-100 text-gray-800 border-gray-200 dark:bg-gray-900/30 dark:text-gray-300 dark:border-gray-700';
                                            default:
                                                return 'bg-blue-100 text-blue-800 border-blue-200 dark:bg-blue-900/30 dark:text-blue-300 dark:border-blue-700';
                                        }
                                    };
                                    
                                    return (
                                        <tr key={index} className="hover:bg-gray-50 dark:hover:bg-gray-800">
                                            <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900 dark:text-white font-medium">
                                                {assessment.referenceNumber || 'N/A'}
                                            </td>
                                            <td className="px-6 py-4 whitespace-nowrap text-sm">
                                                <span className={`inline-flex px-2 py-1 text-xs font-semibold rounded-full border ${getResultColor(assessment.result)}`}>
                                                    {assessment.result || 'N/A'}
                                                </span>
                                            </td>
                                            <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900 dark:text-white">
                                                {assessment.score || '0'}
                                            </td>
                                            <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900 dark:text-white">
                                                {assessment.grade || '-'}
                                            </td>
                                            <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900 dark:text-white">
                                                {assessment.assessmentDate || 'N/A'}
                                            </td>
                                            <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900 dark:text-white">
                                                {assessment.skillCode || 'N/A'}
                                            </td>
                                            <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900 dark:text-white">
                                                {assessment.course?.referenceNumber || 'N/A'}
                                            </td>
                                            <td className="px-6 py-4 text-sm text-gray-900 dark:text-white">
                                                {assessment.course?.title || 'N/A'}
                                            </td>
                                            <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900 dark:text-white">
                                                {assessment.course?.run?.id || 'N/A'}
                                            </td>
                                            <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900 dark:text-white">
                                                {assessment.course?.run?.startDate || 'N/A'}
                                            </td>
                                            <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900 dark:text-white">
                                                {assessment.course?.run?.endDate || 'N/A'}
                                            </td>
                                            <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900 dark:text-white">
                                                {assessment.trainee?.id || 'N/A'}
                                            </td>
                                            <td className="px-6 py-4 text-sm text-gray-900 dark:text-white">
                                                {assessment.trainee?.fullName || 'N/A'}
                                            </td>
                                            <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900 dark:text-white">
                                                {assessment.trainee?.idType?.type || 'N/A'}
                                            </td>
                                            <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900 dark:text-white">
                                                {assessment.enrolment?.referenceNumber || 'N/A'}
                                            </td>
                                            <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900 dark:text-white">
                                                {assessment.trainingPartner?.uen || 'N/A'}
                                            </td>
                                            <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900 dark:text-white">
                                                {assessment.trainingPartner?.code || 'N/A'}
                                            </td>
                                            <td className="px-6 py-4 text-sm text-gray-900 dark:text-white">
                                                {assessment.trainingPartner?.name || 'N/A'}
                                            </td>
                                            <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900 dark:text-white">
                                                {assessment.conferringInstitute?.uen || 'N/A'}
                                            </td>
                                            <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900 dark:text-white">
                                                {assessment.conferringInstitute?.code || 'N/A'}
                                            </td>
                                            <td className="px-6 py-4 text-sm text-gray-900 dark:text-white">
                                                {assessment.conferringInstitute?.name || 'N/A'}
                                            </td>
                                            <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900 dark:text-white">
                                                {assessment.meta?.createdOn || 'N/A'}
                                            </td>
                                            <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900 dark:text-white">
                                                {assessment.meta?.updatedOn || 'N/A'}
                                            </td>
                                        </tr>
                                    );
                                })}
                            </tbody>
                        </table>
                    </div>

                    {/* Pagination */}
                    {totalPages > 1 && (
                        <div className="p-4 border-t dark:border-gray-700 flex justify-between items-center">
                            <p className="text-sm text-gray-600 dark:text-gray-400">
                                Showing {indexOfFirstResult + 1} to {Math.min(indexOfLastResult, searchResults.length)} of {searchResults.length} results
                            </p>
                            <div className="flex gap-2">
                                <Button
                                    variant="outline"
                                    onClick={() => setCurrentPage(prev => Math.max(1, prev - 1))}
                                    disabled={currentPage === 1}
                                >
                                    Previous
                                </Button>
                                <span className="px-4 py-2 text-sm text-gray-700 dark:text-gray-300">
                                    Page {currentPage} of {totalPages}
                                </span>
                                <Button
                                    variant="outline"
                                    onClick={() => setCurrentPage(prev => Math.min(totalPages, prev + 1))}
                                    disabled={currentPage === totalPages}
                                >
                                    Next
                                </Button>
                            </div>
                        </div>
                    )}
                </Card>
            )}

            {/* Empty State */}
            {!isSearching && searchResults.length === 0 && !searchError && (
                <Card className="p-12">
                    <div className="text-center text-gray-500 dark:text-gray-400">
                        <Icon name={IconName.Search} className="w-16 h-16 mx-auto mb-4 text-gray-400" />
                        <p className="text-lg font-medium">Enter search criteria to find assessments</p>
                        <p className="text-sm mt-2">Course Run ID and Course Reference Number are required. Optionally filter by enrolment number or trainee ID.</p>
                    </div>
                </Card>
            )}
        </div>
    );
};

// View Assessment View - Similar to ViewCourseRunView
export const ViewAssessmentView: React.FC = () => {
    const [assessmentId, setAssessmentId] = useState<string>('');
    const [isSearching, setIsSearching] = useState(false);
    const [webhookResponse, setWebhookResponse] = useState<any>(null);
    const [parsedData, setParsedData] = useState<any>(null);
    const [searchError, setSearchError] = useState<string | null>(null);

    const WEBHOOK_URL = 'https://n8n.srv1231536.hstgr.cloud/webhook/69dcd934-3667-4556-8aef-8d62faba6f95';

    const inputClasses = "block w-full px-3 py-2 text-on-surface bg-white border border-gray-300 rounded-md shadow-sm placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent dark:bg-gray-700 dark:border-gray-600 dark:text-white dark:placeholder-gray-500";

    const handleSearch = async () => {
        if (!assessmentId.trim()) {
            setSearchError('Please enter an Assessment ID');
            return;
        }

        setIsSearching(true);
        setSearchError(null);
        setWebhookResponse(null);
        setParsedData(null);

        try {
            console.log('🔍 Fetching assessment details...');

            const payload = {
                assessmentReferenceNumber: assessmentId.trim(),
                timestamp: new Date().toISOString(),
                source: 'admin-view-assessment'
            };

            console.log('📤 View assessment payload:', payload);

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

            const data = await response.json();
            console.log('✅ Webhook response:', data);
            setWebhookResponse(data);

            // Parse response
            try {
                let resultData = null;
                let parsedResult = null;

                if (data?.result) {
                    parsedResult = typeof data.result === 'string' ? JSON.parse(data.result) : data.result;
                    
                    // Check for error status
                    if (parsedResult?.status && parsedResult.status !== '200') {
                        // Handle error response
                        const errorMessage = parsedResult?.error?.details?.[0]?.message || parsedResult?.error?.message || 'An error occurred';
                        setSearchError(errorMessage);
                        setParsedData(null);
                        return;
                    }
                    
                    // Extract data from result.data structure if status is 200
                    if (parsedResult?.data) {
                        resultData = parsedResult.data;
                    } else if (Array.isArray(parsedResult) && parsedResult.length > 0) {
                        resultData = parsedResult[0];
                    } else {
                        resultData = parsedResult;
                    }
                } else if (Array.isArray(data) && data.length > 0) {
                    resultData = data[0];
                } else {
                    resultData = data;
                }

                if (resultData) {
                    console.log('✅ Parsed assessment data:', resultData);
                    setParsedData(resultData);
                }
            } catch (e) {
                console.error('❌ Error parsing result JSON:', e);
                setParsedData(null);
                setSearchError('Failed to parse response data');
            }
        } catch (error) {
            console.error('❌ Error fetching assessment:', error);
            setSearchError(error instanceof Error ? error.message : 'Failed to fetch assessment data');
        } finally {
            setIsSearching(false);
        }
    };

    const renderAssessmentDetails = () => {
        if (!parsedData) return null;

        const assessment = parsedData;
        if (!assessment) return null;

        // Helper to get status badge color
        const getResultColor = (result: string) => {
            switch (result?.toLowerCase()) {
                case 'pass':
                case 'passed':
                case 'competent':
                    return 'bg-green-100 text-green-800 border-green-200 dark:bg-green-900/30 dark:text-green-300 dark:border-green-700';
                case 'fail':
                case 'failed':
                case 'not yet competent':
                    return 'bg-red-100 text-red-800 border-red-200 dark:bg-red-900/30 dark:text-red-300 dark:border-red-700';
                default:
                    return 'bg-gray-100 text-gray-800 border-gray-200 dark:bg-gray-900/30 dark:text-gray-300 dark:border-gray-700';
            }
        };

        return (
            <div className="space-y-6">
                {/* Assessment Summary */}
                <div className="bg-blue-50 dark:bg-blue-900/30 p-4 rounded-lg border border-blue-100 dark:border-blue-800">
                    <h4 className="font-bold text-blue-900 dark:text-blue-300 text-lg">
                        {assessment.course?.title || 'Assessment Details'}
                    </h4>
                    <p className="text-sm text-blue-700 dark:text-blue-400 mt-1">
                        Reference: <span className="font-semibold">{assessment.referenceNumber || assessmentId}</span>
                    </p>
                    <p className="text-sm text-blue-700 dark:text-blue-400 mt-1">
                        Result: <span className={`inline-flex px-2 py-0.5 text-xs font-semibold rounded-full border ${getResultColor(assessment.result)}`}>
                            {assessment.result || 'N/A'}
                        </span>
                    </p>
                </div>

                {/* Assessment Information Table */}
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
                                        Assessment Reference Number
                                    </td>
                                    <td className="px-6 py-4 text-sm text-gray-900 dark:text-white">
                                        {assessment.referenceNumber || 'N/A'}
                                    </td>
                                </tr>
                                <tr className="hover:bg-gray-50 dark:hover:bg-gray-800">
                                    <td className="px-6 py-4 whitespace-nowrap text-sm font-semibold text-gray-700 dark:text-gray-300">
                                        Assessment Date
                                    </td>
                                    <td className="px-6 py-4 text-sm text-gray-900 dark:text-white">
                                        {assessment.assessmentDate || 'N/A'}
                                    </td>
                                </tr>
                                <tr className="hover:bg-gray-50 dark:hover:bg-gray-800">
                                    <td className="px-6 py-4 whitespace-nowrap text-sm font-semibold text-gray-700 dark:text-gray-300">
                                        Result
                                    </td>
                                    <td className="px-6 py-4 text-sm text-gray-900 dark:text-white">
                                        <span className={`inline-flex px-2 py-1 text-sm font-semibold rounded-full border ${getResultColor(assessment.result)}`}>
                                            {assessment.result || 'N/A'}
                                        </span>
                                    </td>
                                </tr>
                                <tr className="hover:bg-gray-50 dark:hover:bg-gray-800">
                                    <td className="px-6 py-4 whitespace-nowrap text-sm font-semibold text-gray-700 dark:text-gray-300">
                                        Skill Code
                                    </td>
                                    <td className="px-6 py-4 text-sm text-gray-900 dark:text-white">
                                        {assessment.skillCode || 'N/A'}
                                    </td>
                                </tr>
                                <tr className="hover:bg-gray-50 dark:hover:bg-gray-800">
                                    <td className="px-6 py-4 whitespace-nowrap text-sm font-semibold text-gray-700 dark:text-gray-300">
                                        Course Reference Number
                                    </td>
                                    <td className="px-6 py-4 text-sm text-gray-900 dark:text-white">
                                        {assessment.course?.referenceNumber || 'N/A'}
                                    </td>
                                </tr>
                                <tr className="hover:bg-gray-50 dark:hover:bg-gray-800">
                                    <td className="px-6 py-4 whitespace-nowrap text-sm font-semibold text-gray-700 dark:text-gray-300">
                                        Course Title
                                    </td>
                                    <td className="px-6 py-4 text-sm text-gray-900 dark:text-white">
                                        {assessment.course?.title || 'N/A'}
                                    </td>
                                </tr>
                                <tr className="hover:bg-gray-50 dark:hover:bg-gray-800">
                                    <td className="px-6 py-4 whitespace-nowrap text-sm font-semibold text-gray-700 dark:text-gray-300">
                                        Course Run ID
                                    </td>
                                    <td className="px-6 py-4 text-sm text-gray-900 dark:text-white">
                                        {assessment.course?.run?.id || 'N/A'}
                                    </td>
                                </tr>
                                <tr className="hover:bg-gray-50 dark:hover:bg-gray-800">
                                    <td className="px-6 py-4 whitespace-nowrap text-sm font-semibold text-gray-700 dark:text-gray-300">
                                        Course Start Date
                                    </td>
                                    <td className="px-6 py-4 text-sm text-gray-900 dark:text-white">
                                        {assessment.course?.run?.startDate || 'N/A'}
                                    </td>
                                </tr>
                                <tr className="hover:bg-gray-50 dark:hover:bg-gray-800">
                                    <td className="px-6 py-4 whitespace-nowrap text-sm font-semibold text-gray-700 dark:text-gray-300">
                                        Course End Date
                                    </td>
                                    <td className="px-6 py-4 text-sm text-gray-900 dark:text-white">
                                        {assessment.course?.run?.endDate || 'N/A'}
                                    </td>
                                </tr>
                                <tr className="hover:bg-gray-50 dark:hover:bg-gray-800">
                                    <td className="px-6 py-4 whitespace-nowrap text-sm font-semibold text-gray-700 dark:text-gray-300">
                                        Trainee ID
                                    </td>
                                    <td className="px-6 py-4 text-sm text-gray-900 dark:text-white">
                                        {assessment.trainee?.id || 'N/A'}
                                    </td>
                                </tr>
                                <tr className="hover:bg-gray-50 dark:hover:bg-gray-800">
                                    <td className="px-6 py-4 whitespace-nowrap text-sm font-semibold text-gray-700 dark:text-gray-300">
                                        Trainee ID Type
                                    </td>
                                    <td className="px-6 py-4 text-sm text-gray-900 dark:text-white">
                                        {assessment.trainee?.idType?.type || 'N/A'}
                                    </td>
                                </tr>
                                <tr className="hover:bg-gray-50 dark:hover:bg-gray-800">
                                    <td className="px-6 py-4 whitespace-nowrap text-sm font-semibold text-gray-700 dark:text-gray-300">
                                        Trainee Full Name
                                    </td>
                                    <td className="px-6 py-4 text-sm text-gray-900 dark:text-white">
                                        {assessment.trainee?.fullName || 'N/A'}
                                    </td>
                                </tr>
                                <tr className="hover:bg-gray-50 dark:hover:bg-gray-800">
                                    <td className="px-6 py-4 whitespace-nowrap text-sm font-semibold text-gray-700 dark:text-gray-300">
                                        Enrolment Reference Number
                                    </td>
                                    <td className="px-6 py-4 text-sm text-gray-900 dark:text-white">
                                        {assessment.enrolment?.referenceNumber || 'N/A'}
                                    </td>
                                </tr>
                                <tr className="hover:bg-gray-50 dark:hover:bg-gray-800">
                                    <td className="px-6 py-4 whitespace-nowrap text-sm font-semibold text-gray-700 dark:text-gray-300">
                                        Training Partner UEN
                                    </td>
                                    <td className="px-6 py-4 text-sm text-gray-900 dark:text-white">
                                        {assessment.trainingPartner?.uen || 'N/A'}
                                    </td>
                                </tr>
                                <tr className="hover:bg-gray-50 dark:hover:bg-gray-800">
                                    <td className="px-6 py-4 whitespace-nowrap text-sm font-semibold text-gray-700 dark:text-gray-300">
                                        Training Partner Name
                                    </td>
                                    <td className="px-6 py-4 text-sm text-gray-900 dark:text-white">
                                        {assessment.trainingPartner?.name || 'N/A'}
                                    </td>
                                </tr>
                                <tr className="hover:bg-gray-50 dark:hover:bg-gray-800">
                                    <td className="px-6 py-4 whitespace-nowrap text-sm font-semibold text-gray-700 dark:text-gray-300">
                                        Training Partner Code
                                    </td>
                                    <td className="px-6 py-4 text-sm text-gray-900 dark:text-white">
                                        {assessment.trainingPartner?.code || 'N/A'}
                                    </td>
                                </tr>
                                <tr className="hover:bg-gray-50 dark:hover:bg-gray-800">
                                    <td className="px-6 py-4 whitespace-nowrap text-sm font-semibold text-gray-700 dark:text-gray-300">
                                        Conferring Institute UEN
                                    </td>
                                    <td className="px-6 py-4 text-sm text-gray-900 dark:text-white">
                                        {assessment.conferringInstitute?.uen || 'N/A'}
                                    </td>
                                </tr>
                                <tr className="hover:bg-gray-50 dark:hover:bg-gray-800">
                                    <td className="px-6 py-4 whitespace-nowrap text-sm font-semibold text-gray-700 dark:text-gray-300">
                                        Conferring Institute Name
                                    </td>
                                    <td className="px-6 py-4 text-sm text-gray-900 dark:text-white">
                                        {assessment.conferringInstitute?.name || 'N/A'}
                                    </td>
                                </tr>
                                <tr className="hover:bg-gray-50 dark:hover:bg-gray-800">
                                    <td className="px-6 py-4 whitespace-nowrap text-sm font-semibold text-gray-700 dark:text-gray-300">
                                        Conferring Institute Code
                                    </td>
                                    <td className="px-6 py-4 text-sm text-gray-900 dark:text-white">
                                        {assessment.conferringInstitute?.code || 'N/A'}
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
            <h2 className="text-3xl font-bold mb-6 dark:text-white">View Assessment</h2>

            {/* Search Bar Card */}
            <Card className="p-6 mb-6">
                <div>
                    {/* <h3 className="text-lg font-bold text-gray-700 dark:text-gray-200 mb-4">Assessment Lookup</h3> */}

                    <div className="flex gap-3 items-end">
                        <div className="flex-1">
                            <label htmlFor="assessment-id" className="block text-sm font-bold text-gray-700 dark:text-gray-300 mb-1">
                                Assessment ID
                            </label>
                            <input
                                id="assessment-id"
                                type="text"
                                value={assessmentId}
                                onChange={(e) => setAssessmentId(e.target.value)}
                                onKeyDown={(e) => e.key === 'Enter' && !isSearching && assessmentId.trim() && handleSearch()}
                                placeholder="e.g. ASM-2002-123456"
                                className={inputClasses}
                                disabled={isSearching}
                            />
                        </div>
                        <Button
                            onClick={handleSearch}
                            disabled={isSearching || !assessmentId.trim()}
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
                                    View Assessment
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
                        <p className="mt-4 text-gray-600 dark:text-gray-400">Fetching assessment details...</p>
                    </div>
                </div>
            )}

            {/* Assessment Details */}
            {webhookResponse && !isSearching && !searchError && parsedData && (
                <Card className="p-0">
                    <div className="p-6 border-b dark:border-gray-700">
                        <h3 className="text-xl font-bold dark:text-white">Assessment Details</h3>
                        <p className="text-gray-500 dark:text-gray-400 mt-1">
                            Assessment ID: {assessmentId}
                        </p>
                    </div>
                    <div className="p-6">
                        {renderAssessmentDetails()}

                        <details className="mt-6 bg-gray-50 dark:bg-gray-700 border border-gray-200 dark:border-gray-600 rounded-lg p-4">
                            <summary className="font-semibold text-gray-800 dark:text-gray-200 cursor-pointer hover:text-gray-600 dark:hover:text-gray-400">
                                ▼ View Raw JSON Response
                            </summary>
                            <pre className="mt-3 text-xs text-gray-700 dark:text-gray-300 whitespace-pre-wrap overflow-x-auto max-h-96 bg-white dark:bg-gray-800 p-3 rounded border dark:border-gray-600 font-mono">
{JSON.stringify(webhookResponse, null, 2)}
                            </pre>
                        </details>

                        <div className="mt-6 flex justify-end">
                            <Button
                                variant="outline"
                                onClick={() => {
                                    setWebhookResponse(null);
                                    setParsedData(null);
                                    setAssessmentId('');
                                    setSearchError(null);
                                }}
                            >
                                Clear Results
                            </Button>
                        </div>
                    </div>
                </Card>
            )}

            {/* Error State */}
            {webhookResponse && !isSearching && searchError && (
                <Card className="p-0">
                    <div className="p-6 border-b dark:border-gray-700 bg-red-50 dark:bg-red-900/20">
                        <h3 className="text-xl font-bold text-red-800 dark:text-red-300">Error</h3>
                        <p className="text-gray-500 dark:text-gray-400 mt-1">
                            Assessment ID: {assessmentId}
                        </p>
                    </div>
                    <div className="p-6">
                        <div className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-700 rounded-lg p-8 text-center">
                            <Icon name={IconName.AlertTriangle} className="w-12 h-12 mx-auto text-red-500 dark:text-red-400 mb-3" />
                            <h4 className="text-lg font-bold text-red-800 dark:text-red-300 mb-2">Assessment Not Found</h4>
                            <p className="text-red-700 dark:text-red-400 mb-4">
                                {searchError}
                            </p>
                        </div>

                        <details className="mt-6 bg-gray-50 dark:bg-gray-700 border border-gray-200 dark:border-gray-600 rounded-lg p-4">
                            <summary className="font-semibold text-gray-800 dark:text-gray-200 cursor-pointer hover:text-gray-600 dark:hover:text-gray-400">
                                ▼ View Raw JSON Response
                            </summary>
                            <pre className="mt-3 text-xs text-gray-700 dark:text-gray-300 whitespace-pre-wrap overflow-x-auto max-h-96 bg-white dark:bg-gray-800 p-3 rounded border dark:border-gray-600 font-mono">
{JSON.stringify(webhookResponse, null, 2)}
                            </pre>
                        </details>

                        <div className="mt-6 flex justify-end">
                            <Button
                                variant="outline"
                                onClick={() => {
                                    setWebhookResponse(null);
                                    setParsedData(null);
                                    setAssessmentId('');
                                    setSearchError(null);
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
                        <p className="text-lg font-medium">Enter Assessment ID to view details</p>
                        <p className="text-sm mt-2">Provide an Assessment ID (e.g. ASM-2601-159004) to fetch details from SSG</p>
                    </div>
                </Card>
            )}
        </div>
    );
};
