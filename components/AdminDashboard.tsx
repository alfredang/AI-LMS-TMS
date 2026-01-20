import React, { useState, useEffect } from 'react';
import { useLms } from '@contexts/LmsContext';
import { Card } from './ui/Card';
import { Button } from './ui/Button';
import { Icon, IconName } from './ui/Icon';
import { AdminPage } from '@app-types';
import { UpcomingClassesTable } from './UpcomingClassesTable';
import { getApiUrl } from '@/lib/urlHelpers';

const StatCard: React.FC<{ title: string; value: string | number }> = ({ title, value }) => (
    <Card className="p-6 text-center">
        <p className="text-4xl font-bold text-blue-600">{value}</p>
        <p className="text-gray-600 mt-1">{title}</p>
    </Card>
);

const getStatusColor = (status: string) => {
    switch (status) {
        case 'Paid':
        case 'Claimed':
        case 'Approved':
        case 'Completed':
        case 'Competent':
        case 'Pass':
        case 'Success':
        case 'Successful':
        case 'Full Payment':
        case 'Confirmed':
            return 'bg-green-100 text-green-800';
        case 'Processing':
        case 'Reschedule':
             return 'bg-blue-100 text-blue-800';
        case 'Pending':
        case 'In Progress':
            return 'bg-yellow-100 text-yellow-800';
        case 'Overdue':
        case 'Rejected':
        case 'Unpaid':
        case 'Not Yet Competent':
        case 'Fail':
        case 'Failed':
        case 'Cancelled':
            return 'bg-red-100 text-red-800';
        default:
            return 'bg-gray-100 text-gray-800';
    }
};

interface AdminStatistics {
    totalLearners: number;
    totalTrainers: number;
    ongoingClasses: number;
    classesNext7Days: number;
    classesNext30Days: number;
    completedClasses: number;
}

export const AdminDashboard: React.FC = () => {
    // Data states
    const [statistics, setStatistics] = useState<AdminStatistics>({
        totalLearners: 0,
        totalTrainers: 0,
        ongoingClasses: 0,
        classesNext7Days: 0,
        classesNext30Days: 0,
        completedClasses: 0,
    });
    
    const pageTitle = 'Admin Dashboard';

    // Fetch statistics from API
    const fetchStatistics = async () => {
        try {
            console.log('🔄 Fetching statistics...');
            const response = await fetch(getApiUrl('/api/admin/statistics'));
            const result = await response.json();
            
            console.log('📊 Statistics API response:', result);
            
            if (result.success) {
                console.log('✅ Statistics loaded:', result.data);
                setStatistics(result.data);
            } else {
                console.error('❌ Error fetching statistics:', result.message);
            }
        } catch (error) {
            console.error('❌ Error fetching statistics:', error);
        }
    };

    // Initial data fetch
    useEffect(() => {
        console.log('🚀 AdminDashboard mounted - fetching initial data');
        fetchStatistics();
    }, []);

    return (
        <div>
            <h2 className="text-3xl font-bold mb-6">{pageTitle}</h2>
            
            {/* Statistics Grid */}
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6 mb-8">
                <StatCard title="Total Learners" value={statistics.totalLearners} />
                <StatCard title="Total Trainers" value={statistics.totalTrainers} />
                <StatCard title="Ongoing Classes" value={statistics.ongoingClasses} />
                <StatCard title="Classes (Next 7 Days)" value={statistics.classesNext7Days} />
                <StatCard title="Classes (Next 30 Days)" value={statistics.classesNext30Days} />
                <StatCard title="Completed Classes" value={statistics.completedClasses} />
            </div>

            {/* Upcoming Classes Table Component */}
            <UpcomingClassesTable showTitle={true} showFilters={true} />
        </div>
    );
};
