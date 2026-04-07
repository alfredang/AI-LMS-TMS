import React, { useState, useEffect } from 'react';
import { Card } from './ui/Card';
import { UpcomingClassesTable } from './UpcomingClassesTable';
import { getApiUrl } from '@/lib/urlHelpers';

const StatCard: React.FC<{ title: string; value: string | number }> = ({ title, value }) => (
    <Card className="p-6 text-center">
        <p className="text-4xl font-bold text-primary">{value}</p>
        <p className="font-semibold text-on-surface mt-1">{title}</p>
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
        <div className="w-full">
                <h1 className="text-3xl font-bold mb-6">{pageTitle}</h1>

                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6 mb-10 w-full">
                    <StatCard title="Total Learners" value={statistics.totalLearners} />
                    <StatCard title="Total Trainers" value={statistics.totalTrainers} />
                    <StatCard title="Ongoing Classes" value={statistics.ongoingClasses} />
                    <StatCard title="Classes (Next 7 Days)" value={statistics.classesNext7Days} />
                    <StatCard title="Classes (Next 30 Days)" value={statistics.classesNext30Days} />
                    <StatCard title="Completed Classes" value={statistics.completedClasses} />
                </div>

                <Card className="p-4 overflow-hidden">
                    <UpcomingClassesTable showTitle={false} showFilters={true} />
                </Card>
            </div>
    );
};