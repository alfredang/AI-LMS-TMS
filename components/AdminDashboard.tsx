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
    ongoingClasses: number;
    upcomingClasses: number;
    completedClasses: number;
    assignedTrainersLocal: number;
    missingTrainersLocal: number;
    missingTrainersTPG: number;
}

export const AdminDashboard: React.FC = () => {
    const [statistics, setStatistics] = useState<AdminStatistics>({
        ongoingClasses: 0,
        upcomingClasses: 0,
        completedClasses: 0,
        assignedTrainersLocal: 0,
        missingTrainersLocal: 0,
        missingTrainersTPG: 0,
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
                    <StatCard title="Ongoing Classes" value={statistics.ongoingClasses} />
                    <StatCard title="Upcoming Classes" value={statistics.upcomingClasses} />
                    <StatCard title="Completed Classes" value={statistics.completedClasses} />
                    <StatCard title="Assigned Trainers (Local) for Upcoming" value={statistics.assignedTrainersLocal} />
                    <StatCard title="Missing Trainers (Local) for Upcoming" value={statistics.missingTrainersLocal} />
                    <StatCard title="Missing Trainers (TPG) for Upcoming" value={statistics.missingTrainersTPG} />
                </div>

                <Card className="p-4 overflow-hidden">
                    <UpcomingClassesTable showTitle={false} showFilters={true} includeOngoing={true} />
                </Card>
            </div>
    );
};