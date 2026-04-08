import React, { useState, useEffect, useMemo } from 'react';
import { useLms } from '@contexts/LmsContext';
import { Card } from '../ui/Card';
import { Button } from '../ui/Button';
import { Icon, IconName } from '../ui/Icon';
import { getApiUrl } from '@/lib/urlHelpers';

interface CourseRecord {
    id: string;
    title: string;
    courseCode: string;
    trainingHours: number;
    assessmentHours: number;
    startDate: string;
    endDate: string;
    courseRunCode: string;
}

const TrainingHoursPage: React.FC = () => {
    const { currentUser } = useLms();
    const [courses, setCourses] = useState<CourseRecord[]>([]);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        if (!currentUser?.id) return;
        const fetchCourses = async () => {
            setLoading(true);
            try {
                const res = await fetch(getApiUrl(`/api/courses/trainer-search?trainerId=${currentUser.id}`));
                const data = await res.json();
                if (data.success) {
                    setCourses(data.data || []);
                }
            } catch (e) {
                console.error('Failed to fetch trainer courses:', e);
            } finally {
                setLoading(false);
            }
        };
        fetchCourses();
    }, [currentUser?.id]);

    const completedCourses = useMemo(() => {
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        return courses
            .filter(c => {
                if (!c.endDate) return false;
                const end = new Date(c.endDate);
                end.setHours(0, 0, 0, 0);
                return end < today;
            })
            .sort((a, b) => new Date(b.endDate).getTime() - new Date(a.endDate).getTime());
    }, [courses]);

    const totalTrainingHours = useMemo(() =>
        completedCourses.reduce((sum, c) => sum + Number(c.trainingHours || 0), 0),
        [completedCourses]
    );

    const totalAssessmentHours = useMemo(() =>
        completedCourses.reduce((sum, c) => sum + Number(c.assessmentHours || 0), 0),
        [completedCourses]
    );

    const totalHours = totalTrainingHours + totalAssessmentHours;

    const formatDate = (dateStr: string) => {
        if (!dateStr) return '—';
        return new Date(dateStr).toLocaleDateString('en-SG', { year: 'numeric', month: 'short', day: 'numeric' });
    };

    const downloadCSV = () => {
        const headers = ['Start Date', 'End Date', 'Course Title', 'Course Ref Code', 'Training Hours', 'Assessment Hours', 'Total Hours'];
        const rows = completedCourses.map(c => {
            const total = Number(c.trainingHours || 0) + Number(c.assessmentHours || 0);
            return [
                formatDate(c.startDate),
                formatDate(c.endDate),
                `"${c.title.replace(/"/g, '""')}"`,
                c.courseCode || '—',
                c.trainingHours,
                c.assessmentHours,
                total,
            ].join(',');
        });

        rows.push(['', '', '', 'TOTAL', totalTrainingHours, totalAssessmentHours, totalHours].join(','));

        const csv = [headers.join(','), ...rows].join('\n');
        const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `training-hours-${new Date().toISOString().slice(0, 10)}.csv`;
        a.click();
        URL.revokeObjectURL(url);
    };

    if (loading) {
        return (
            <div className="flex justify-center py-16">
                <div className="text-center">
                    <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-500 mx-auto" />
                    <p className="mt-4 text-gray-600 dark:text-gray-400">Loading training hours...</p>
                </div>
            </div>
        );
    }

    return (
        <div>
            <div className="flex items-center justify-between mb-6">
                <div>
                    <h2 className="text-3xl font-bold dark:text-white">Training Hours</h2>
                    <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
                        Cumulative training hours from completed courses.
                    </p>
                </div>
                {completedCourses.length > 0 && (
                    <Button onClick={downloadCSV} className="flex items-center gap-2">
                        <Icon name={IconName.Download} className="w-4 h-4" />
                        Download CSV
                    </Button>
                )}
            </div>

            {/* Summary Cards */}
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-6">
                <Card className="p-4 text-center">
                    <p className="text-sm text-gray-500 dark:text-gray-400">Training Hours</p>
                    <p className="text-2xl font-bold text-blue-600 dark:text-blue-400">{totalTrainingHours}</p>
                </Card>
                <Card className="p-4 text-center">
                    <p className="text-sm text-gray-500 dark:text-gray-400">Assessment Hours</p>
                    <p className="text-2xl font-bold text-purple-600 dark:text-purple-400">{totalAssessmentHours}</p>
                </Card>
                <Card className="p-4 text-center">
                    <p className="text-sm text-gray-500 dark:text-gray-400">Total Hours</p>
                    <p className="text-2xl font-bold text-green-600 dark:text-green-400">{totalHours}</p>
                </Card>
            </div>

            {/* Table */}
            {completedCourses.length === 0 ? (
                <Card className="p-10">
                    <div className="text-center text-gray-500 dark:text-gray-400">
                        <Icon name={IconName.Clock} className="w-12 h-12 mx-auto mb-4 text-gray-400" />
                        <p className="text-lg font-medium">No completed courses yet</p>
                        <p className="text-sm mt-1">Training hours will appear here once your courses have ended.</p>
                    </div>
                </Card>
            ) : (
                <Card className="overflow-hidden">
                    <div className="overflow-x-auto">
                        <table className="min-w-full divide-y divide-gray-200 dark:divide-gray-700">
                            <thead className="bg-gray-50 dark:bg-gray-700/50">
                                <tr>
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
                                {completedCourses.map((course, idx) => {
                                    const total = Number(course.trainingHours || 0) + Number(course.assessmentHours || 0);
                                    return (
                                        <tr key={`${course.id}-${idx}`} className="hover:bg-gray-50 dark:hover:bg-gray-700/50">
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
                                    <td colSpan={4} className="px-4 py-3 text-sm font-bold text-gray-900 dark:text-gray-100 text-right">Total</td>
                                    <td className="px-4 py-3 text-sm font-bold text-blue-600 dark:text-blue-400 text-right">{totalTrainingHours}</td>
                                    <td className="px-4 py-3 text-sm font-bold text-purple-600 dark:text-purple-400 text-right">{totalAssessmentHours}</td>
                                    <td className="px-4 py-3 text-sm font-bold text-green-600 dark:text-green-400 text-right">{totalHours}</td>
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
