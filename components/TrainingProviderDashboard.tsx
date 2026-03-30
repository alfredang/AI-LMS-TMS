
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
  grantForecastMethod: 'trend+seasonal' | 'trend' | 'weighted avg' | 'none';
  grantsInPipeline: number;
  claimForecast: number;
  claimForecastMethod: 'trend+seasonal' | 'trend' | 'weighted avg' | 'none';
  claimsInPipeline: number;
  enrollmentByMonth: { label: string; value: number }[];
  courseRanking: { label: string; value: number }[];
  ageProfile: { label: string; value: number }[];
  enrolmentStatusBreakdown: { label: string; value: number }[];
  sponsorshipBreakdown: { label: string; value: number }[];
}

// Reusable Components
const StatCard: React.FC<{ title: string; value: string | number; subtext?: string }> = ({ title, value, subtext }) => (
    <Card className="p-4 sm:p-6 text-center overflow-hidden">
        <p className="text-2xl sm:text-4xl font-bold text-primary truncate">{value}</p>
        <p className="text-xs sm:text-base font-semibold text-on-surface mt-1">{title}</p>
        <p className="text-xs sm:text-sm text-subtle">{subtext || '\u00A0'}</p>
    </Card>
);

const ChartCard: React.FC<{ title: string; children: React.ReactNode }> = ({ title, children }) => (
    <Card className="p-6">
        <h3 className="text-xl font-bold mb-4">{title}</h3>
        <div>{children}</div>
    </Card>
);

const BarChart: React.FC<{ data: { label: string; value: number }[]; color: 'primary' | 'secondary'; stackLabel?: boolean }> = ({ data, color, stackLabel = false }) => {
    const maxValue = Math.max(...data.map(d => d.value), 0);
    const maxChars = maxValue.toLocaleString().length;
    const minPct = Math.max(maxChars * 5, 12);
    const colorClass = color === 'primary' ? 'bg-primary' : 'bg-secondary';
    
    if (data.length === 0) {
        return (
            <div className="flex items-center justify-center h-32 text-gray-500">
                No data available
            </div>
        );
    }
    
    return (
        <div className="space-y-4">
            {data.map(item => (
                <div key={item.label} className={stackLabel ? "flex flex-col sm:flex-row sm:items-center" : "flex items-center"}>
                    <div className={stackLabel ? "sm:w-1/3 text-sm font-semibold text-subtle pr-2 mb-1 sm:mb-0" : "w-1/3 text-sm font-semibold text-subtle pr-2"}>{item.label}</div>
                    <div className={stackLabel ? "sm:w-2/3 bg-gray-200 rounded-full h-8 relative" : "w-2/3 bg-gray-200 rounded-full h-8 relative"}>
                        {item.value > 0 ? (
                            <div
                                className={`${colorClass} h-8 rounded-full flex items-center justify-end px-3 text-white text-xs font-bold whitespace-nowrap`}
                                style={{ width: `${minPct + ((item.value / maxValue) * (100 - minPct))}%` }}
                            >
                                {item.value.toLocaleString()}
                            </div>
                        ) : (
                            <div className="bg-gray-200 h-8 rounded-full" />
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
                <h2 className="text-3xl font-bold">Training Analytics Dashboard</h2>
                <button
                    onClick={() => fetchAnalyticsData(true)}
                    disabled={refreshing}
                    className="px-4 py-2 text-sm font-medium rounded-lg border border-gray-300 dark:border-gray-600 hover:bg-gray-100 dark:hover:bg-gray-700 disabled:opacity-50 transition-colors"
                >
                    {refreshing ? 'Refreshing...' : 'Refresh'}
                </button>
            </div>

            {/* KPIs — mobile: 2 cols (actuals left, forecasts right), desktop: 3 cols */}
            <div className="grid grid-cols-2 lg:grid-cols-3 gap-4 sm:gap-6 mb-8">
                {/* Row 1: Enrollment */}
                <div className="lg:contents"><StatCard title="Total Learners Enrolled" value={analyticsData.totalLearners} /></div>
                <div className="lg:hidden"><StatCard title="Enrollment Forecast" value={`~${analyticsData.enrollmentForecast || 0}`} subtext="Next 3 Months" /></div>
                {/* Row 2: Grants */}
                <div className="lg:contents"><StatCard title="Total Grants Applied" value={`$${Math.round(analyticsData.totalGrants).toLocaleString()}`} /></div>
                <div className="lg:hidden">
                    <StatCard title="Grant Forecast" value={`~$${Math.round(analyticsData.grantForecast || 0).toLocaleString()}`} subtext="Next 3 Months" />
                </div>
                {/* Row 3: Claims */}
                <div className="lg:contents"><StatCard title="Total Claims Disbursed" value={`$${Math.round(analyticsData.totalClaims).toLocaleString()}`} /></div>
                <div className="lg:hidden">
                    <StatCard title="Claim Forecast" value={`~$${Math.round(analyticsData.claimForecast || 0).toLocaleString()}`} subtext="Next 3 Months" />
                </div>
                {/* Desktop-only: forecasts in row 2 */}
                <div className="hidden lg:block"><StatCard title="Enrollment Forecast" value={`~${analyticsData.enrollmentForecast || 0}`} subtext="Next 3 Months" /></div>
                <div className="hidden lg:block">
                    <StatCard title="Grant Forecast" value={`~$${Math.round(analyticsData.grantForecast || 0).toLocaleString()}`} subtext="Next 3 Months" />
                </div>
                <div className="hidden lg:block">
                    <StatCard title="Claim Forecast" value={`~$${Math.round(analyticsData.claimForecast || 0).toLocaleString()}`} subtext="Next 3 Months" />
                </div>
            </div>

            {/* Charts */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                <ChartCard title="Total Learners Enrolled by Month">
                    <BarChart data={analyticsData.enrollmentByMonth} color="primary" />
                </ChartCard>
                <ChartCard title="Course Ranking by Enrolment">
                    <BarChart data={analyticsData.courseRanking} color="primary" stackLabel />
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
