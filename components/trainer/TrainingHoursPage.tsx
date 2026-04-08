import React, { useState, useEffect, useCallback } from 'react';
import { useLms } from '@contexts/LmsContext';
import { Card } from '../ui/Card';
import { Button } from '../ui/Button';
import { Icon, IconName } from '../ui/Icon';
import { getApiUrl } from '@/lib/urlHelpers';

interface CourseRecord {
    id: string;
    title: string;
    courseCode: string;
    courseType: string;
    trainingHours: number;
    assessmentHours: number;
    startDate: string;
    endDate: string;
    courseRunCode: string;
}

interface Summary {
    totalCourses: number;
    totalTrainingHours: number;
    totalAssessmentHours: number;
    totalHours: number;
}

const TrainingHoursPage: React.FC = () => {
    const { currentUser } = useLms();
    const [courses, setCourses] = useState<CourseRecord[]>([]);
    const [summary, setSummary] = useState<Summary>({ totalCourses: 0, totalTrainingHours: 0, totalAssessmentHours: 0, totalHours: 0 });
    const [loading, setLoading] = useState(false);
    const [startDate, setStartDate] = useState('2026-01-01');
    const [endDate, setEndDate] = useState(new Date().toISOString().slice(0, 10));
    const [hasFetched, setHasFetched] = useState(false);

    const fetchHours = useCallback(async () => {
        if (!currentUser?.id) return;
        setLoading(true);
        try {
            const res = await fetch(getApiUrl(`/api/courses/trainer-hours?trainerId=${currentUser.id}&startDate=${startDate}&endDate=${endDate}`));
            const data = await res.json();
            if (data.success) {
                setCourses(data.data || []);
                setSummary(data.summary || { totalCourses: 0, totalTrainingHours: 0, totalAssessmentHours: 0, totalHours: 0 });
            }
        } catch (e) {
            console.error('Failed to fetch training hours:', e);
        } finally {
            setLoading(false);
            setHasFetched(true);
        }
    }, [currentUser?.id, startDate, endDate]);

    // Auto-fetch on mount
    useEffect(() => {
        fetchHours();
    }, [fetchHours]);

    const formatDate = (dateStr: string) => {
        if (!dateStr) return '—';
        return new Date(dateStr).toLocaleDateString('en-SG', { year: 'numeric', month: 'short', day: 'numeric' });
    };

    const downloadCSV = () => {
        const headers = ['Start Date', 'End Date', 'Course Title', 'Course Ref Code', 'Course Type', 'Training Hours', 'Assessment Hours', 'Total Hours'];
        const rows = courses.map(c => {
            const total = c.trainingHours + c.assessmentHours;
            return [
                formatDate(c.startDate),
                formatDate(c.endDate),
                `"${c.title.replace(/"/g, '""')}"`,
                c.courseCode || '—',
                c.courseType || '—',
                c.trainingHours,
                c.assessmentHours,
                total,
            ].join(',');
        });

        rows.push(['', '', '', '', 'TOTAL', summary.totalTrainingHours, summary.totalAssessmentHours, summary.totalHours].join(','));

        const csv = [headers.join(','), ...rows].join('\n');
        const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `training-hours-${startDate}-to-${endDate}.csv`;
        a.click();
        URL.revokeObjectURL(url);
    };

    return (
        <div>
            <div className="flex items-center justify-between mb-6">
                <div>
                    <h2 className="text-3xl font-bold dark:text-white">Training Hours</h2>
                    <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
                        Cumulative training hours from completed courses.
                    </p>
                </div>
                {courses.length > 0 && (
                    <Button onClick={downloadCSV} className="flex items-center gap-2">
                        <Icon name={IconName.Download} className="w-4 h-4" />
                        Export CSV
                    </Button>
                )}
            </div>

            {/* Date Range Filters + Refresh */}
            <Card className="p-4 mb-6">
                <div className="flex flex-wrap items-end gap-4">
                    <div>
                        <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">From</label>
                        <input
                            type="date"
                            value={startDate}
                            onChange={(e) => setStartDate(e.target.value)}
                            className="px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 text-sm dark:bg-gray-700 dark:border-gray-600 dark:text-white"
                        />
                    </div>
                    <div>
                        <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">To</label>
                        <input
                            type="date"
                            value={endDate}
                            onChange={(e) => setEndDate(e.target.value)}
                            className="px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 text-sm dark:bg-gray-700 dark:border-gray-600 dark:text-white"
                        />
                    </div>
                    <Button onClick={fetchHours} disabled={loading} className="flex items-center gap-2">
                        {loading ? (
                            <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white" />
                        ) : (
                            <span>&#x21bb;</span>
                        )}
                        {loading ? 'Loading...' : 'Refresh'}
                    </Button>
                </div>
            </Card>

            {/* Summary Cards */}
            <div className="grid grid-cols-1 sm:grid-cols-4 gap-4 mb-6">
                <Card className="p-4 text-center">
                    <p className="text-sm text-gray-500 dark:text-gray-400">Completed Courses</p>
                    <p className="text-2xl font-bold text-gray-900 dark:text-white">{summary.totalCourses}</p>
                </Card>
                <Card className="p-4 text-center">
                    <p className="text-sm text-gray-500 dark:text-gray-400">Training Hours</p>
                    <p className="text-2xl font-bold text-blue-600 dark:text-blue-400">{summary.totalTrainingHours}</p>
                </Card>
                <Card className="p-4 text-center">
                    <p className="text-sm text-gray-500 dark:text-gray-400">Assessment Hours</p>
                    <p className="text-2xl font-bold text-purple-600 dark:text-purple-400">{summary.totalAssessmentHours}</p>
                </Card>
                <Card className="p-4 text-center">
                    <p className="text-sm text-gray-500 dark:text-gray-400">Total Hours</p>
                    <p className="text-2xl font-bold text-green-600 dark:text-green-400">{summary.totalHours}</p>
                </Card>
            </div>

            {/* Table */}
            {loading && !hasFetched ? (
                <div className="flex justify-center py-16">
                    <div className="text-center">
                        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-500 mx-auto" />
                        <p className="mt-4 text-gray-600 dark:text-gray-400">Loading training hours...</p>
                    </div>
                </div>
            ) : courses.length === 0 ? (
                <Card className="p-10">
                    <div className="text-center text-gray-500 dark:text-gray-400">
                        <Icon name={IconName.Clock} className="w-12 h-12 mx-auto mb-4 text-gray-400" />
                        <p className="text-lg font-medium">No completed courses found</p>
                        <p className="text-sm mt-1">
                            {hasFetched
                                ? 'No courses with end dates in the selected range. Try adjusting the date range.'
                                : 'Click Refresh to load training hours.'}
                        </p>
                    </div>
                </Card>
            ) : (
                <Card className="overflow-hidden">
                    <div className="overflow-x-auto">
                        <table className="min-w-full divide-y divide-gray-200 dark:divide-gray-700">
                            <thead className="bg-gray-50 dark:bg-gray-700/50">
                                <tr>
                                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">#</th>
                                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">Start Date</th>
                                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">End Date</th>
                                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">Course Title</th>
                                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">Course Ref Code</th>
                                    <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">Training Hrs</th>
                                    <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">Assessment Hrs</th>
                                    <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">Total Hrs</th>
                                </tr>
                            </thead>
                            <tbody className="bg-white dark:bg-gray-800 divide-y divide-gray-200 dark:divide-gray-700">
                                {courses.map((course, idx) => {
                                    const total = course.trainingHours + course.assessmentHours;
                                    return (
                                        <tr key={`${course.id}-${idx}`} className="hover:bg-gray-50 dark:hover:bg-gray-700/50">
                                            <td className="px-4 py-3 text-sm text-gray-500 dark:text-gray-400">{idx + 1}</td>
                                            <td className="px-4 py-3 text-sm text-gray-900 dark:text-gray-100 whitespace-nowrap">{formatDate(course.startDate)}</td>
                                            <td className="px-4 py-3 text-sm text-gray-900 dark:text-gray-100 whitespace-nowrap">{formatDate(course.endDate)}</td>
                                            <td className="px-4 py-3 text-sm text-gray-900 dark:text-gray-100">{course.title}</td>
                                            <td className="px-4 py-3 text-sm text-gray-900 dark:text-gray-100 font-mono">{course.courseCode || '—'}</td>
                                            <td className="px-4 py-3 text-sm text-gray-900 dark:text-gray-100 text-right">{course.trainingHours}</td>
                                            <td className="px-4 py-3 text-sm text-gray-900 dark:text-gray-100 text-right">{course.assessmentHours}</td>
                                            <td className="px-4 py-3 text-sm font-semibold text-gray-900 dark:text-gray-100 text-right">{total}</td>
                                        </tr>
                                    );
                                })}
                            </tbody>
                            <tfoot className="bg-gray-50 dark:bg-gray-700/50">
                                <tr>
                                    <td colSpan={5} className="px-4 py-3 text-sm font-bold text-gray-900 dark:text-gray-100 text-right">Total ({summary.totalCourses} courses)</td>
                                    <td className="px-4 py-3 text-sm font-bold text-blue-600 dark:text-blue-400 text-right">{summary.totalTrainingHours}</td>
                                    <td className="px-4 py-3 text-sm font-bold text-purple-600 dark:text-purple-400 text-right">{summary.totalAssessmentHours}</td>
                                    <td className="px-4 py-3 text-sm font-bold text-green-600 dark:text-green-400 text-right">{summary.totalHours}</td>
                                </tr>
                            </tfoot>
                        </table>
                    </div>
                </Card>
            )}
        </div>
    );
};

export default TrainingHoursPage;
