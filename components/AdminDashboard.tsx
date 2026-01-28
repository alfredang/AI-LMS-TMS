import React, { useState, useEffect } from 'react';
import { Card } from './ui/Card';
import { UpcomingClassesTable } from './UpcomingClassesTable';
import { getApiUrl } from '@/lib/urlHelpers';

const StatCard: React.FC<{ title: string; value: string | number }> = ({ title, value }) => (
    <Card className="p-6 text-center shadow-sm hover:shadow-md transition-shadow dark:bg-gray-800 dark:border-gray-700">
        <p className="text-4xl font-bold text-blue-600 dark:text-blue-400">{value}</p>
        <p className="text-gray-600 mt-1 font-medium dark:text-gray-400">{title}</p>
    </Card>
);

interface AdminStatistics {
    totalLearners: number;
    totalTrainers: number;
    ongoingClasses: number;
    classesNext7Days: number;
    classesNext30Days: number;
    completedClasses: number;
}

export const AdminDashboard: React.FC = () => {
    const [statistics, setStatistics] = useState<AdminStatistics>({
        totalLearners: 0,
        totalTrainers: 0,
        ongoingClasses: 0,
        classesNext7Days: 0,
        classesNext30Days: 0,
        completedClasses: 0,
    });

    const pageTitle = 'Admin Dashboard';

    const fetchStatistics = async () => {
        try {
            const response = await fetch(getApiUrl('/api/admin/statistics'));
            const result = await response.json();
            if (result.success) {
                setStatistics(result.data);
            }
        } catch (error) {
            console.error('❌ Error fetching statistics:', error);
        }
    };

    useEffect(() => {
        fetchStatistics();
    }, []);

    return (
        /* flex-1 tells this component to take all space to the right of your sidebar */
        <main className="flex-1 min-w-0 overflow-x-hidden min-h-screen bg-[#F8F9FB] dark:bg-gray-900 p-4 lg:p-6">
            {/* Remove 'mx-auto' and 'max-w-7xl' if they exist in your parent tags */}
            <div className="w-full">

                {/* 1. Header Section */}
                <h1 className="text-3xl font-bold text-gray-900 dark:text-white mb-8">{pageTitle}</h1>

                {/* 2. Statistics Grid: Forced to 3 columns to fill the horizontal space */}
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6 mb-10 w-full">
                    <StatCard title="Total Learners" value={statistics.totalLearners} />
                    <StatCard title="Total Trainers" value={statistics.totalTrainers} />
                    <StatCard title="Ongoing Classes" value={statistics.ongoingClasses} />
                    <StatCard title="Classes (Next 7 Days)" value={statistics.classesNext7Days} />
                    <StatCard title="Classes (Next 30 Days)" value={statistics.classesNext30Days} />
                    <StatCard title="Completed Classes" value={statistics.completedClasses} />
                </div>

                {/* 3. Upcoming Classes Section: Set to w-full to prevent white space on right */}
                <div className="w-full bg-white dark:bg-gray-800 rounded-2xl shadow-sm border border-gray-200 dark:border-gray-700 overflow-hidden">
                    <div className="p-4">
                        <UpcomingClassesTable showTitle={true} showFilters={true} />
                    </div>
                </div>
            </div>
        </main>
    );
};