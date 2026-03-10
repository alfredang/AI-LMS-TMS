import React, { useState } from 'react';
import { Card } from '../ui/Card';
import { Icon, IconName } from '../ui/Icon';

export const CourseRunView: React.FC = () => {
    const [searchTerm, setSearchTerm] = useState('');
    const [results, setResults] = useState<any>(null);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const handleSearch = async (e: React.KeyboardEvent<HTMLInputElement>) => {
        if (e.key === 'Enter') {
            setLoading(true);
            setError(null);
            setResults(null);

            try {
                // Using local API proxy to avoid CORS issues
                const apiUrl = `/api/admin/search-course-runs`;
                // Appending query parameter
                const url = `${apiUrl}?query=${encodeURIComponent(searchTerm)}`;

                console.log('Client: Initiating search request to:', url);

                const response = await fetch(url);
                console.log('Client: Response received:', response.status);

                if (!response.ok) {
                    throw new Error(`Error: ${response.status} ${response.statusText}`);
                }

                const data = await response.json();
                setResults(data);
            } catch (err) {
                console.error('Search error:', err);
                setError(err instanceof Error ? err.message : 'An unknown error occurred');
            } finally {
                setLoading(false);
            }
        }
    };

    return (
        <div>
            <div className="flex justify-between items-center mb-6">
                <h2 className="text-3xl font-bold">Course Run Management</h2>
                <div className="w-80 relative">
                    <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                        <Icon name={IconName.Search} className="h-4 w-4 text-gray-400" />
                    </div>
                    <input
                        type="text"
                        placeholder="Search Course Run (Press Enter)..."
                        className="w-full pl-10 pr-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white placeholder-gray-400 dark:placeholder-gray-500 focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none transition-all"
                        value={searchTerm}
                        onChange={(e) => setSearchTerm(e.target.value)}
                        onKeyDown={handleSearch}
                    />
                </div>
            </div>

            <Card className="p-6 min-h-[300px]">
                {loading && (
                    <div className="flex flex-col items-center justify-center py-12">
                        <Icon name={IconName.Spinner} className="h-8 w-8 text-blue-500 animate-spin mb-4" />
                        <p className="text-gray-500 dark:text-gray-400">Searching...</p>
                    </div>
                )}

                {error && (
                    <div className="text-center py-12">
                        <div className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-700 text-red-600 dark:text-red-400 p-4 rounded-md inline-block">
                            <p className="font-semibold">Search Failed</p>
                            <p className="text-sm mt-1">{error}</p>
                        </div>
                    </div>
                )}

                {!loading && !error && !results && (
                    <p className="text-gray-500 dark:text-gray-400 text-center py-12">
                        Enter a search term above to find Course Runs.
                    </p>
                )}

                {!loading && !error && results && (
                    <div className="space-y-4">
                        <div className="flex justify-between items-center">
                            <h3 className="text-lg font-medium text-gray-900 dark:text-white">Search Results</h3>
                            <span className="text-sm text-gray-500 dark:text-gray-400">
                                {Array.isArray(results?.data?.courses?.course?.runs)
                                    ? `${results.data.courses.course.runs.length} result(s)`
                                    : Array.isArray(results)
                                        ? `${results.length} result(s)`
                                        : 'Data received'}
                            </span>
                        </div>

                        <div className="overflow-x-auto border border-gray-200 dark:border-gray-700 rounded-lg">
                            <table className="min-w-full divide-y divide-gray-200 dark:divide-gray-700">
                                <thead className="bg-gray-50 dark:bg-gray-800">
                                    <tr>
                                        <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">Course Run ID</th>
                                        <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">Start Date</th>
                                        <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">End Date</th>
                                        <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">Mode</th>
                                        <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">Status</th>
                                    </tr>
                                </thead>
                                <tbody className="bg-white dark:bg-gray-900 divide-y divide-gray-200 dark:divide-gray-700">
                                    {(Array.isArray(results?.data?.courses?.course?.runs) ? results.data.courses.course.runs : (Array.isArray(results) ? results : [])).map((run: any, index: number) => (
                                        <tr key={index}>
                                            <td className="px-6 py-4 whitespace-nowrap text-sm font-medium text-gray-900 dark:text-white">{run.courseRunId || 'N/A'}</td>
                                            <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500 dark:text-gray-400">{run.startDateTime || run.startDate || 'N/A'}</td>
                                            <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500 dark:text-gray-400">{run.endDateTime || run.endDate || 'N/A'}</td>
                                            <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500 dark:text-gray-400">{run.modeOfTraining || 'N/A'}</td>
                                            <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500 dark:text-gray-400">
                                                <span className={`px-2 inline-flex text-xs leading-5 font-semibold rounded-full ${(run.runStatus || run.class_status) === 'Published' || (run.runStatus || run.class_status) === 'Confirmed' ? 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300' : 'bg-gray-100 text-gray-800 dark:bg-gray-700 dark:text-gray-300'
                                                    }`}>
                                                    {run.runStatus || run.class_status || 'Unknown'}
                                                </span>
                                            </td>
                                        </tr>
                                    ))}
                                    {(!results || (Array.isArray(results) && results.length === 0) || (results && !Array.isArray(results) && !results.data?.courses?.course?.runs)) && (
                                        <tr>
                                            <td colSpan={5} className="px-6 py-4 text-center text-sm text-gray-500 dark:text-gray-400">
                                                No course runs found.
                                            </td>
                                        </tr>
                                    )}
                                </tbody>
                            </table>
                        </div>

                        {/* Fallback raw view for debugging if needed */}
                        <div className="mt-4">
                            <details className="text-xs text-gray-500 dark:text-gray-400">
                                <summary className="cursor-pointer hover:text-blue-600 mb-2">View Raw API Response</summary>
                                <div className="bg-gray-50 dark:bg-gray-800 rounded-lg p-4 overflow-auto max-h-[200px] border border-gray-200 dark:border-gray-700 font-mono text-gray-800 dark:text-gray-200">
                                    <pre>{JSON.stringify(results, null, 2)}</pre>
                                </div>
                            </details>
                        </div>
                    </div>
                )}
            </Card>
        </div>
    );
};
