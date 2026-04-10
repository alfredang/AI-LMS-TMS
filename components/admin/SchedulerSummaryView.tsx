import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Icon, IconName } from '../ui/Icon';
import { Card } from '../ui/Card';
import { useLms } from '@contexts/LmsContext';
import { View, AdminPage, UserRole } from '@app-types';

interface SchedulerTask {
    id: string;
    name: string;
    description: string;
    cron_expression: string;
    enabled: boolean;
    api_endpoint: string;
    last_run_at: string | null;
    last_status: string | null;
}

const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const DAY_ABBREVS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

// Shared key used by SchedulerView to know which task to scroll/highlight
// when arriving from Schedule Summary. Scoped to sessionStorage so it
// doesn't leak across browser restarts.
export const SCHEDULER_FOCUS_STORAGE_KEY = 'scheduler_focus_task_id';

interface ParsedSchedule {
    hour: number;        // 24h
    minute: number;
    frequency: 'daily' | 'weekly' | 'other';
    daysOfWeek: number[]; // 0=Sun..6=Sat, empty when daily
}

function parseCron(expr: string): ParsedSchedule | null {
    const parts = expr.trim().split(/\s+/);
    if (parts.length < 5) return null;
    const [minute, hour, dom, mon, dow] = parts;
    const h = parseInt(hour, 10);
    const m = parseInt(minute, 10);
    if (isNaN(h) || isNaN(m)) return null;

    if (dom === '*' && mon === '*' && dow === '*') {
        return { hour: h, minute: m, frequency: 'daily', daysOfWeek: [] };
    }
    if (dom === '*' && mon === '*') {
        const days = dow
            .split(',')
            .map(s => parseInt(s.trim(), 10))
            .filter(d => !isNaN(d) && d >= 0 && d <= 6);
        if (days.length === 0) return null;
        const unique = Array.from(new Set(days)).sort((a, b) => a - b);
        return { hour: h, minute: m, frequency: 'weekly', daysOfWeek: unique };
    }
    return { hour: h, minute: m, frequency: 'other', daysOfWeek: [] };
}

function formatTime(hour: number, minute: number): string {
    const period = hour >= 12 ? 'PM' : 'AM';
    const displayH = hour === 0 ? 12 : hour > 12 ? hour - 12 : hour;
    const displayM = String(minute).padStart(2, '0');
    return `${displayH}:${displayM} ${period}`;
}

function formatFrequency(parsed: ParsedSchedule | null, cronExpr: string): string {
    if (!parsed) return cronExpr;
    if (parsed.frequency === 'daily') return 'Daily';
    if (parsed.frequency === 'weekly') {
        if (parsed.daysOfWeek.length === 1) {
            return `Weekly · ${DAY_NAMES[parsed.daysOfWeek[0]]}`;
        }
        return `Weekly · ${parsed.daysOfWeek.map(d => DAY_ABBREVS[d]).join(', ')}`;
    }
    return cronExpr;
}

const StatusPill: React.FC<{ status: string | null; enabled: boolean }> = ({ status, enabled }) => {
    if (!enabled) {
        return (
            <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-gray-100 text-gray-600 dark:bg-gray-700 dark:text-gray-400">
                Disabled
            </span>
        );
    }
    if (!status) {
        return (
            <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-gray-100 text-gray-500 dark:bg-gray-700 dark:text-gray-400">
                Never run
            </span>
        );
    }
    const isSuccess = status === 'success';
    const isError = status.startsWith('error');
    return (
        <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${
            isSuccess
                ? 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400'
                : isError
                    ? 'bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400'
                    : 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-400'
        }`}>
            {isSuccess ? '✓ Success' : isError ? '✗ Error' : status}
        </span>
    );
};

export const SchedulerSummaryView: React.FC = () => {
    const { handleNavigation, setAdminPage, role } = useLms();
    const [tasks, setTasks] = useState<SchedulerTask[]>([]);
    const [loading, setLoading] = useState(true);
    const [refreshing, setRefreshing] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [search, setSearch] = useState('');
    const [onlyEnabled, setOnlyEnabled] = useState(false);

    const fetchTasks = useCallback(async (opts: { isRefresh?: boolean } = {}) => {
        try {
            setError(null);
            if (opts.isRefresh) setRefreshing(true);
            const res = await fetch('/api/admin/scheduler');
            const data = await res.json();
            if (data.success) {
                setTasks(data.tasks);
            } else {
                setError(data.error || 'Failed to fetch scheduler tasks');
            }
        } catch (err) {
            setError(err instanceof Error ? err.message : 'Failed to fetch scheduler tasks');
        } finally {
            setLoading(false);
            setRefreshing(false);
        }
    }, []);

    useEffect(() => {
        fetchTasks();
    }, [fetchTasks]);

    /**
     * Navigate to the Task Scheduler page with the clicked task focused.
     * We stash the target task id in sessionStorage and let SchedulerView
     * pick it up on mount to scroll/highlight the matching card.
     *
     * AdminLayout dispatches on `adminPage`; TrainingProviderLayout dispatches
     * on `currentView`. Calling both at once causes a race because the
     * wrapped `setAdminPage` (navigateAdminPage in LmsContext) pushes a URL
     * without the `view` param, and the route-change listener then resets
     * `currentView` to Dashboard. So we branch on the active role and only
     * trigger the navigation the current layout actually responds to.
     */
    const handleRowClick = useCallback((taskId: string) => {
        try {
            sessionStorage.setItem(SCHEDULER_FOCUS_STORAGE_KEY, taskId);
        } catch {
            // sessionStorage can throw in incognito / quota — fall through silently.
        }
        if (role === UserRole.Admin) {
            setAdminPage(AdminPage.Scheduler);
        } else {
            handleNavigation(View.Scheduler);
        }
    }, [handleNavigation, setAdminPage, role]);

    const sortedRows = useMemo(() => {
        const rows = tasks
            .map(task => {
                const parsed = parseCron(task.cron_expression);
                return {
                    task,
                    parsed,
                    sortKey: parsed ? parsed.hour * 60 + parsed.minute : Number.MAX_SAFE_INTEGER,
                    timeStr: parsed ? formatTime(parsed.hour, parsed.minute) : '—',
                    frequencyStr: formatFrequency(parsed, task.cron_expression),
                };
            })
            .filter(row => {
                if (onlyEnabled && !row.task.enabled) return false;
                if (!search.trim()) return true;
                const q = search.toLowerCase();
                return (
                    row.task.name.toLowerCase().includes(q) ||
                    row.task.description.toLowerCase().includes(q) ||
                    row.frequencyStr.toLowerCase().includes(q) ||
                    row.timeStr.toLowerCase().includes(q)
                );
            });

        rows.sort((a, b) => {
            if (a.sortKey !== b.sortKey) return a.sortKey - b.sortKey;
            // Tie-breaker: daily before weekly at same time, then first dayOfWeek, then name
            const aFreq = a.parsed?.frequency === 'daily' ? 0 : 1;
            const bFreq = b.parsed?.frequency === 'daily' ? 0 : 1;
            if (aFreq !== bFreq) return aFreq - bFreq;
            const aDow = a.parsed?.daysOfWeek[0] ?? 0;
            const bDow = b.parsed?.daysOfWeek[0] ?? 0;
            if (aDow !== bDow) return aDow - bDow;
            return a.task.name.localeCompare(b.task.name);
        });

        return rows;
    }, [tasks, search, onlyEnabled]);

    const enabledCount = tasks.filter(t => t.enabled).length;
    const disabledCount = tasks.length - enabledCount;

    return (
        <div>
            <div className="flex items-start justify-between gap-4 mb-2">
                <div className="min-w-0">
                    <h2 className="text-3xl font-bold dark:text-white">Schedule Summary</h2>
                    <p className="mt-2 text-sm text-gray-500 dark:text-gray-400">
                        Compact view of all scheduler tasks sorted by run time. Click any row to jump to that task in the Task Scheduler. All times in Singapore Time (SGT).
                    </p>
                </div>
                <button
                    onClick={() => fetchTasks({ isRefresh: true })}
                    disabled={refreshing || loading}
                    className="flex-shrink-0 inline-flex items-center gap-2 px-3 py-2 text-sm font-medium rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-gray-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                    title="Refresh schedule list"
                >
                    <svg
                        xmlns="http://www.w3.org/2000/svg"
                        fill="none"
                        viewBox="0 0 24 24"
                        strokeWidth={2}
                        stroke="currentColor"
                        className={`w-4 h-4 ${refreshing ? 'animate-spin' : ''}`}
                    >
                        <path strokeLinecap="round" strokeLinejoin="round" d="M16.023 9.348h4.992V4.356m0 4.992-3.181-3.183a8.25 8.25 0 0 0-13.803 3.7M4.031 9.865a8.25 8.25 0 0 0 13.803 3.7l3.181-3.182m-4.991 0h4.991v-4.99" />
                    </svg>
                    <span>{refreshing ? 'Refreshing…' : 'Refresh'}</span>
                </button>
            </div>

            {/* Summary chips */}
            <div className="flex flex-wrap items-center gap-3 mt-4 mb-6">
                <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-medium bg-blue-50 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300">
                    Total: {tasks.length}
                </span>
                <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-medium bg-green-50 text-green-700 dark:bg-green-900/30 dark:text-green-300">
                    Enabled: {enabledCount}
                </span>
                <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-medium bg-gray-100 text-gray-700 dark:bg-gray-700 dark:text-gray-300">
                    Disabled: {disabledCount}
                </span>
            </div>

            {/* Controls */}
            <div className="flex flex-col sm:flex-row gap-3 mb-4">
                <div className="relative flex-1">
                    <Icon name={IconName.Search} className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-gray-400" />
                    <input
                        type="text"
                        placeholder="Search schedules..."
                        value={search}
                        onChange={(e) => setSearch(e.target.value)}
                        className="w-full pl-10 pr-4 py-2.5 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 text-sm dark:bg-gray-700 dark:border-gray-600 dark:text-white dark:placeholder-gray-400"
                    />
                </div>
                <label className="inline-flex items-center gap-2 px-3 py-2.5 border border-gray-300 rounded-lg cursor-pointer dark:border-gray-600 dark:text-gray-300">
                    <input
                        type="checkbox"
                        checked={onlyEnabled}
                        onChange={(e) => setOnlyEnabled(e.target.checked)}
                        className="w-4 h-4 text-blue-600 rounded border-gray-300 focus:ring-blue-500"
                    />
                    <span className="text-sm">Only enabled</span>
                </label>
            </div>

            {/* Loading */}
            {loading && (
                <div className="flex justify-center py-16">
                    <div className="text-center">
                        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-500 mx-auto"></div>
                        <p className="mt-4 text-gray-600 dark:text-gray-400">Loading schedule summary...</p>
                    </div>
                </div>
            )}

            {/* Error */}
            {error && !loading && (
                <Card className="p-6 border-red-200 dark:border-red-700">
                    <div className="flex items-center gap-3">
                        <div className="flex-shrink-0 w-10 h-10 rounded-full bg-red-100 dark:bg-red-900/40 flex items-center justify-center">
                            <span className="text-red-600 dark:text-red-400 text-lg">✗</span>
                        </div>
                        <div>
                            <h3 className="text-lg font-bold text-red-700 dark:text-red-400">Failed to Load Summary</h3>
                            <p className="text-sm text-gray-600 dark:text-gray-400 mt-1">{error}</p>
                        </div>
                    </div>
                </Card>
            )}

            {/* Table */}
            {!loading && !error && (
                <Card className="p-0 overflow-hidden">
                    <div className="overflow-x-auto">
                        <table className="min-w-full divide-y divide-gray-200 dark:divide-gray-700">
                            <thead className="bg-gray-50 dark:bg-gray-800">
                                <tr>
                                    <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 dark:text-gray-300 uppercase tracking-wider w-24">Time</th>
                                    <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 dark:text-gray-300 uppercase tracking-wider w-36">Frequency</th>
                                    <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 dark:text-gray-300 uppercase tracking-wider">Schedule Title</th>
                                    <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 dark:text-gray-300 uppercase tracking-wider w-32">Status</th>
                                </tr>
                            </thead>
                            <tbody className="bg-white dark:bg-gray-800 divide-y divide-gray-200 dark:divide-gray-700">
                                {sortedRows.length === 0 ? (
                                    <tr>
                                        <td colSpan={4} className="px-4 py-8 text-center text-sm text-gray-500 dark:text-gray-400">
                                            No scheduler tasks match the current filter.
                                        </td>
                                    </tr>
                                ) : (
                                    sortedRows.map(row => (
                                        <tr
                                            key={row.task.id}
                                            onClick={() => handleRowClick(row.task.id)}
                                            className={`cursor-pointer hover:bg-blue-50 dark:hover:bg-blue-900/20 transition-colors ${!row.task.enabled ? 'opacity-60' : ''}`}
                                            title="Open in Task Scheduler"
                                        >
                                            <td className="px-4 py-3 whitespace-nowrap text-sm font-mono font-medium text-gray-900 dark:text-white">
                                                {row.timeStr}
                                            </td>
                                            <td className="px-4 py-3 whitespace-nowrap text-sm text-gray-600 dark:text-gray-300">
                                                {row.frequencyStr}
                                            </td>
                                            <td className="px-4 py-3 text-sm">
                                                <div className="font-medium text-gray-900 dark:text-white">{row.task.name}</div>
                                                {row.task.description && (
                                                    <div className="text-xs text-gray-500 dark:text-gray-400 mt-0.5 line-clamp-1">
                                                        {row.task.description}
                                                    </div>
                                                )}
                                            </td>
                                            <td className="px-4 py-3 whitespace-nowrap">
                                                <StatusPill status={row.task.last_status} enabled={row.task.enabled} />
                                            </td>
                                        </tr>
                                    ))
                                )}
                            </tbody>
                        </table>
                    </div>
                </Card>
            )}
        </div>
    );
};

export default SchedulerSummaryView;
