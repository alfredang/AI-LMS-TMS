
import React, { useMemo, useState, useEffect } from 'react';
import { Card } from './ui/Card';
import { getApiUrl } from '@/lib/urlHelpers';

// Types for analytics data
interface AnalyticsData {
  totalLearners: number;
  totalGrants: number;
  totalClaims: number;
  enrollmentForecast: number;
  grantForecast: number;
  grantForecastMethod: 'seasonal+growth' | 'seasonal' | 'average' | 'none';
  grantsInPipeline: number;
  claimForecast: number;
  claimForecastMethod: 'seasonal' | 'average' | 'none';
  claimsInPipeline: number;
  enrollmentByMonth: { label: string; value: number }[];
  courseRanking: { label: string; value: number }[];
  ageProfile: { label: string; value: number }[];
  enrolmentStatusBreakdown: { label: string; value: number }[];
  sponsorshipBreakdown: { label: string; value: number }[];
}

// Reusable Components
const StatCard: React.FC<{ title: string; value: string | number; subtext?: string }> = ({ title, value, subtext }) => (
    <Card className="p-6 text-center">
        <p className="text-4xl font-bold text-primary">{value}</p>
        <p className="font-semibold text-on-surface mt-1">{title}</p>
        {subtext && <p className="text-sm text-subtle">{subtext}</p>}
    </Card>
);

const ChartCard: React.FC<{ title: string; children: React.ReactNode }> = ({ title, children }) => (
    <Card className="p-6">
        <h3 className="text-xl font-bold mb-4">{title}</h3>
        <div>{children}</div>
    </Card>
);

const BarChart: React.FC<{ data: { label: string; value: number }[]; color: 'primary' | 'secondary' }> = ({ data, color }) => {
    const maxValue = Math.max(...data.map(d => d.value), 0);
    const colorClass = color === 'primary' ? 'bg-primary' : 'bg-secondary';
    
    if (data.length === 0) {
        return (
            <div className="flex items-center justify-center h-32 text-gray-500">
                No data available
            </div>
        );
    }
    
    return (
        <div className="space-y-3">
            {data.map(item => (
                <div key={item.label} className="flex items-center">
                    <div className="w-1/3 text-sm font-semibold text-subtle pr-2">{item.label}</div>
                    <div className="w-2/3 bg-gray-200 rounded-full h-6 relative">
                        {item.value > 0 ? (
                            <div 
                                className={`${colorClass} h-6 rounded-full flex items-center justify-end px-2 text-white text-xs font-bold`}
                                style={{ width: `${(item.value / maxValue) * 100}%` }}
                            >
                                {item.value}
                            </div>
                        ) : (
                            <div className="bg-gray-200 h-6 rounded-full flex items-center justify-center text-white text-xs font-bold">
                            </div>
                        )}
                    </div>
                </div>
            ))}
        </div>
    );
};

// Main Dashboard Component
const TrainingProviderDashboard: React.FC = () => {
    const [analyticsData, setAnalyticsData] = useState<AnalyticsData | null>(null);
    const [loading, setLoading] = useState(true);
    const [refreshing, setRefreshing] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const fetchAnalyticsData = async (isRefresh = false) => {
        try {
            if (isRefresh) setRefreshing(true);
            else setLoading(true);
            const response = await fetch(getApiUrl('/api/analytics/dashboard'));

            if (!response.ok) {
                throw new Error('Failed to fetch analytics data');
            }

            const result = await response.json();

            if (!result.success) {
                throw new Error(result.error || 'Failed to fetch analytics data');
            }

            setAnalyticsData(result.data);
            setError(null);
        } catch (err) {
            console.error('Error fetching analytics data:', err);
            setError(err instanceof Error ? err.message : 'Unknown error');
        } finally {
            setLoading(false);
            setRefreshing(false);
        }
    };

    useEffect(() => {
        fetchAnalyticsData();
    }, []);

    if (loading) {
        return (
            <div className="flex items-center justify-center h-64">
                <div className="text-lg">Loading analytics data...</div>
            </div>
        );
    }

    if (error) {
        return (
            <div className="flex items-center justify-center h-64">
                <div className="text-lg text-red-600">Error: {error}</div>
            </div>
        );
    }

    if (!analyticsData) {
        return (
            <div className="flex items-center justify-center h-64">
                <div className="text-lg">No analytics data available</div>
            </div>
        );
    }

    return (
        <div>
            <div className="flex items-center justify-between mb-6">
                <h2 className="text-3xl font-bold">AI Analytics Dashboard</h2>
                <button
                    onClick={() => fetchAnalyticsData(true)}
                    disabled={refreshing}
                    className="px-4 py-2 text-sm font-medium rounded-lg border border-gray-300 dark:border-gray-600 hover:bg-gray-100 dark:hover:bg-gray-700 disabled:opacity-50 transition-colors"
                >
                    {refreshing ? 'Refreshing...' : 'Refresh'}
                </button>
            </div>

            {/* KPIs */}
            <div className="grid grid-cols-2 lg:grid-cols-3 gap-6 mb-8">
                <StatCard title="Total Learners Enrolled" value={analyticsData.totalLearners} />
                <StatCard title="Total Grants Applied" value={`$${Math.round(analyticsData.totalGrants).toLocaleString()}`} />
                <StatCard title="Total Claims Disbursed" value={`$${Math.round(analyticsData.totalClaims).toLocaleString()}`} />
                <StatCard title="Enrollment Forecast" value={`~${analyticsData.enrollmentForecast || 0}`} subtext="Next 3 Months" />
                <StatCard
                    title="Grant Forecast"
                    value={`~$${Math.round(analyticsData.grantForecast || 0).toLocaleString()}`}
                    subtext={`Next 3 Months (${
                        analyticsData.grantForecastMethod === 'seasonal+growth' ? 'seasonal+growth' :
                        analyticsData.grantForecastMethod === 'seasonal' ? 'seasonal' : 'avg'
                    })`}
                />
                <StatCard
                    title="Claim Forecast"
                    value={`~$${Math.round(analyticsData.claimForecast || 0).toLocaleString()}`}
                    subtext={`Next 3 Months (${analyticsData.claimForecastMethod === 'seasonal' ? 'seasonal' : 'avg'})`}
                />
            </div>

            {/* Charts */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                <ChartCard title="Total Learners Enrolled by Month">
                    <BarChart data={analyticsData.enrollmentByMonth} color="primary" />
                </ChartCard>
                <ChartCard title="Course Ranking by Enrolment">
                    <BarChart data={analyticsData.courseRanking} color="primary" />
                </ChartCard>
                <ChartCard title="Learner Age Profile">
                     <BarChart data={analyticsData.ageProfile} color="primary" />
                </ChartCard>
                <ChartCard title="Enrolment Status">
                     <BarChart data={analyticsData.enrolmentStatusBreakdown ?? []} color="primary" />
                </ChartCard>
                <ChartCard title="Learner Sponsorship Type">
                     <BarChart data={analyticsData.sponsorshipBreakdown} color="primary" />
                </ChartCard>
            </div>
        </div>
    );
};

export default TrainingProviderDashboard;
