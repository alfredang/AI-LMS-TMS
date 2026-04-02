import React, { useState, useEffect } from 'react';
import { Card } from '../ui/Card';
import { Button } from '../ui/Button';
import { useLms } from '@contexts/LmsContext';
import { AdminPage } from '@app-types';

interface SchedulerTask {
    id: string;
    name: string;
    description: string;
    cron_expression: string;
    enabled: boolean;
    api_endpoint: string;
    last_run_at: string | null;
    last_status: string | null;
    created_at: string;
    updated_at: string;
}

// ── Cron Expression Helpers ───────────────────────────────────────────────────

/** Convert a cron expression like "0 14 * * *" to a human-readable string */
function describeCron(expr: string): string {
    const parts = expr.trim().split(/\s+/);
    if (parts.length < 5) return expr;

    const [minute, hour, dayOfMonth, month, dayOfWeek] = parts;

    // Simple daily pattern: "M H * * *"
    if (dayOfMonth === '*' && month === '*' && dayOfWeek === '*') {
        const h = parseInt(hour, 10);
        const m = parseInt(minute, 10);
        if (!isNaN(h) && !isNaN(m)) {
            const period = h >= 12 ? 'PM' : 'AM';
            const displayH = h === 0 ? 12 : h > 12 ? h - 12 : h;
            const displayM = String(m).padStart(2, '0');
            return `Daily at ${displayH}:${displayM} ${period} SGT`;
        }
    }

    return expr;
}

/** Convert "HH:MM" 24-hour time to cron minute/hour parts */
function timeToCron(time: string): { minute: string; hour: string } | null {
    const match = time.match(/^(\d{1,2}):(\d{2})$/);
    if (!match) return null;
    const hour = parseInt(match[1], 10);
    const minute = parseInt(match[2], 10);
    if (hour < 0 || hour > 23 || minute < 0 || minute > 59) return null;
    return { minute: String(minute), hour: String(hour) };
}

/** Extract HH:MM from a daily cron expression, or null */
function cronToTime(expr: string): string | null {
    const parts = expr.trim().split(/\s+/);
    if (parts.length < 5) return null;
    const [minute, hour, dom, mon, dow] = parts;
    if (dom !== '*' || mon !== '*' || dow !== '*') return null;
    const h = parseInt(hour, 10);
    const m = parseInt(minute, 10);
    if (isNaN(h) || isNaN(m)) return null;
    return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

// ── Status Badge ──────────────────────────────────────────────────────────────

const StatusBadge: React.FC<{ status: string | null }> = ({ status }) => {
    if (!status) {
        return (
            <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-gray-100 text-gray-600 dark:bg-gray-700 dark:text-gray-400">
                Never run
            </span>
        );
    }

    const isSuccess = status === 'success';
    const isError = status.startsWith('error');

    return (
        <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${
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

// ── Task ID → Log Page mapping ────────────────────────────────────────────────

const TASK_LOG_PAGE: Record<string, AdminPage> = {
    auto_create_learners:       AdminPage.AutomationLogs,
    auto_create_trainer_folders: AdminPage.TrainerFolderLogs,
    sync_course_run_dates:      AdminPage.CourseRunDateSyncLogs,
};

// ── Main Component ────────────────────────────────────────────────────────────

export const SchedulerView: React.FC = () => {
    const { setAdminPage } = useLms();
    const [tasks, setTasks] = useState<SchedulerTask[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [editingTaskId, setEditingTaskId] = useState<string | null>(null);
    const [editTime, setEditTime] = useState('');
    const [saving, setSaving] = useState(false);
    const [runningTaskId, setRunningTaskId] = useState<string | null>(null);
    const [actionMessage, setActionMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

    // Fetch tasks
    const fetchTasks = async () => {
        try {
            setError(null);
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
        }
    };

    useEffect(() => {
        fetchTasks();
    }, []);

    // Clear action message after 5 seconds
    useEffect(() => {
        if (actionMessage) {
            const timer = setTimeout(() => setActionMessage(null), 5000);
            return () => clearTimeout(timer);
        }
    }, [actionMessage]);

    // Toggle enabled/disabled
    const toggleEnabled = async (task: SchedulerTask) => {
        try {
            const res = await fetch('/api/admin/scheduler', {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ taskId: task.id, enabled: !task.enabled }),
            });
            const data = await res.json();
            if (data.success) {
                setTasks(prev => prev.map(t => t.id === task.id ? data.task : t));
                setActionMessage({
                    type: 'success',
                    text: `"${task.name}" ${!task.enabled ? 'enabled' : 'disabled'} successfully`,
                });
            } else {
                setActionMessage({ type: 'error', text: data.error || 'Failed to update task' });
            }
        } catch (err) {
            setActionMessage({ type: 'error', text: 'Failed to update task' });
        }
    };

    // Save time change
    const saveTimeChange = async (task: SchedulerTask) => {
        const parsed = timeToCron(editTime);
        if (!parsed) {
            setActionMessage({ type: 'error', text: 'Invalid time format. Use HH:MM (24-hour).' });
            return;
        }

        const newCron = `${parsed.minute} ${parsed.hour} * * *`;
        setSaving(true);

        try {
            const res = await fetch('/api/admin/scheduler', {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ taskId: task.id, cron_expression: newCron }),
            });
            const data = await res.json();
            if (data.success) {
                setTasks(prev => prev.map(t => t.id === task.id ? data.task : t));
                setEditingTaskId(null);
                setActionMessage({
                    type: 'success',
                    text: `Schedule for "${task.name}" updated to ${describeCron(newCron)}`,
                });
            } else {
                setActionMessage({ type: 'error', text: data.error || 'Failed to update schedule' });
            }
        } catch (err) {
            setActionMessage({ type: 'error', text: 'Failed to update schedule' });
        } finally {
            setSaving(false);
        }
    };

    // Run task immediately
    const runNow = async (task: SchedulerTask) => {
        setRunningTaskId(task.id);
        setActionMessage(null);

        try {
            const res = await fetch('/api/admin/scheduler', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ taskId: task.id }),
            });
            const data = await res.json();
            if (data.success) {
                // Navigate to the log page if one exists for this task
                const logPage = TASK_LOG_PAGE[task.id];
                if (logPage) {
                    setAdminPage(logPage);
                    return;
                }
                setActionMessage({
                    type: 'success',
                    text: `"${task.name}" executed successfully`,
                });
                // Refresh task list to get updated last_run_at
                await fetchTasks();
            } else {
                setActionMessage({
                    type: 'error',
                    text: `"${task.name}" failed: ${data.error || 'Unknown error'}`,
                });
                await fetchTasks();
            }
        } catch (err) {
            setActionMessage({
                type: 'error',
                text: `Failed to run "${task.name}"`,
            });
        } finally {
            setRunningTaskId(null);
        }
    };

    // Start editing
    const startEditing = (task: SchedulerTask) => {
        const time = cronToTime(task.cron_expression);
        setEditTime(time || '14:00');
        setEditingTaskId(task.id);
    };

    // Format date for display
    const formatDate = (dateStr: string | null): string => {
        if (!dateStr) return '—';
        const d = new Date(dateStr);
        return d.toLocaleString('en-SG', {
            day: '2-digit',
            month: 'short',
            year: 'numeric',
            hour: '2-digit',
            minute: '2-digit',
            hour12: true,
            timeZone: 'Asia/Singapore',
        });
    };

    return (
        <div>
            <h2 className="text-3xl font-bold mb-2 dark:text-white">Scheduler</h2>
            <p className="text-sm text-gray-500 dark:text-gray-400 mb-6">
                Manage automated tasks and their schedules. All times are in Singapore Time (SGT).
            </p>

            {/* Action message */}
            {actionMessage && (
                <div className={`mb-4 px-4 py-3 rounded-lg text-sm font-medium flex items-center gap-2 ${
                    actionMessage.type === 'success'
                        ? 'bg-green-50 text-green-800 border border-green-200 dark:bg-green-900/20 dark:text-green-400 dark:border-green-800'
                        : 'bg-red-50 text-red-800 border border-red-200 dark:bg-red-900/20 dark:text-red-400 dark:border-red-800'
                }`}>
                    <span>{actionMessage.type === 'success' ? '✅' : '❌'}</span>
                    {actionMessage.text}
                </div>
            )}

            {/* Loading */}
            {loading && (
                <div className="flex justify-center py-16">
                    <div className="text-center">
                        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-500 mx-auto"></div>
                        <p className="mt-4 text-gray-600 dark:text-gray-400">Loading scheduler tasks...</p>
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
                            <h3 className="text-lg font-bold text-red-700 dark:text-red-400">Failed to Load Scheduler</h3>
                            <p className="text-sm text-gray-600 dark:text-gray-400 mt-1">{error}</p>
                        </div>
                    </div>
                </Card>
            )}

            {/* Task Cards */}
            {!loading && !error && (
                <div className="space-y-4">
                    {tasks.map(task => (
                        <Card key={task.id} className="p-0 overflow-hidden">
                            {/* Card Header */}
                            <div className={`px-6 py-4 flex items-center justify-between border-b ${
                                task.enabled
                                    ? 'bg-white dark:bg-gray-800 border-gray-200 dark:border-gray-700'
                                    : 'bg-gray-50 dark:bg-gray-900 border-gray-100 dark:border-gray-800'
                            }`}>
                                <div className="flex items-center gap-3 min-w-0">
                                    {/* Enable/Disable Toggle */}
                                    <button
                                        onClick={() => toggleEnabled(task)}
                                        className={`relative inline-flex h-6 w-11 flex-shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 ${
                                            task.enabled ? 'bg-blue-600' : 'bg-gray-200 dark:bg-gray-600'
                                        }`}
                                        title={task.enabled ? 'Click to disable' : 'Click to enable'}
                                    >
                                        <span className={`pointer-events-none inline-block h-5 w-5 rounded-full bg-white shadow transform ring-0 transition-transform duration-200 ${
                                            task.enabled ? 'translate-x-5' : 'translate-x-0'
                                        }`} />
                                    </button>

                                    <div className="min-w-0">
                                        <h3 className={`font-semibold truncate ${
                                            task.enabled
                                                ? 'text-gray-900 dark:text-white'
                                                : 'text-gray-500 dark:text-gray-400'
                                        }`}>
                                            {task.name}
                                        </h3>
                                    </div>
                                </div>

                                <div className="flex items-center gap-2 flex-shrink-0">
                                    <StatusBadge status={task.last_status} />
                                </div>
                            </div>

                            {/* Card Body */}
                            <div className={`px-6 py-4 ${!task.enabled ? 'opacity-60' : ''}`}>
                                <p className="text-sm text-gray-600 dark:text-gray-400 mb-4">
                                    {task.description}
                                </p>

                                <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 text-sm">
                                    {/* Schedule */}
                                    <div>
                                        <span className="font-medium text-gray-500 dark:text-gray-400 text-xs uppercase tracking-wider">Schedule</span>
                                        {editingTaskId === task.id ? (
                                            <div className="mt-1 flex items-center gap-2">
                                                <input
                                                    type="time"
                                                    value={editTime}
                                                    onChange={e => setEditTime(e.target.value)}
                                                    className="block w-28 px-2 py-1 text-sm text-gray-900 dark:text-white bg-white dark:bg-gray-700 border border-gray-300 dark:border-gray-600 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                                                />
                                                <button
                                                    onClick={() => saveTimeChange(task)}
                                                    disabled={saving}
                                                    className="text-blue-600 hover:text-blue-800 dark:text-blue-400 dark:hover:text-blue-300 text-sm font-medium disabled:opacity-50"
                                                >
                                                    {saving ? '...' : 'Save'}
                                                </button>
                                                <button
                                                    onClick={() => setEditingTaskId(null)}
                                                    className="text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-300 text-sm"
                                                >
                                                    Cancel
                                                </button>
                                            </div>
                                        ) : (
                                            <div className="mt-1 flex items-center gap-2">
                                                <p className="text-gray-900 dark:text-white font-medium">
                                                    {describeCron(task.cron_expression)}
                                                </p>
                                                <button
                                                    onClick={() => startEditing(task)}
                                                    className="text-blue-600 hover:text-blue-800 dark:text-blue-400 dark:hover:text-blue-300 text-xs"
                                                    title="Edit schedule"
                                                >
                                                    ✏️
                                                </button>
                                            </div>
                                        )}
                                    </div>

                                    {/* Last Run */}
                                    <div>
                                        <span className="font-medium text-gray-500 dark:text-gray-400 text-xs uppercase tracking-wider">Last Run</span>
                                        <p className="mt-1 text-gray-900 dark:text-white">
                                            {formatDate(task.last_run_at)}
                                        </p>
                                    </div>

                                    {/* API Endpoint */}
                                    <div>
                                        <span className="font-medium text-gray-500 dark:text-gray-400 text-xs uppercase tracking-wider">Endpoint</span>
                                        <p className="mt-1 font-mono text-xs text-gray-600 dark:text-gray-400 truncate" title={task.api_endpoint}>
                                            {task.api_endpoint}
                                        </p>
                                    </div>
                                </div>

                                {/* Run Now Button + View Logs link */}
                                <div className="mt-4 pt-3 border-t border-gray-100 dark:border-gray-700 flex items-center justify-between">
                                    {TASK_LOG_PAGE[task.id] ? (
                                        <button
                                            onClick={() => setAdminPage(TASK_LOG_PAGE[task.id])}
                                            className="text-xs text-blue-600 hover:text-blue-800 dark:text-blue-400 dark:hover:text-blue-300 underline"
                                        >
                                            View Logs
                                        </button>
                                    ) : (
                                        <span />
                                    )}
                                    <Button
                                        onClick={() => runNow(task)}
                                        disabled={runningTaskId === task.id}
                                        className="text-sm"
                                    >
                                        {runningTaskId === task.id ? (
                                            <div className="flex items-center">
                                                <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white mr-2"></div>
                                                Running…
                                            </div>
                                        ) : (
                                            '▶ Run Now'
                                        )}
                                    </Button>
                                </div>
                            </div>
                        </Card>
                    ))}

                    {tasks.length === 0 && (
                        <Card className="p-10">
                            <div className="text-center text-gray-500 dark:text-gray-400">
                                <p className="text-lg font-medium">No scheduled tasks found</p>
                                <p className="text-sm mt-1">Tasks will appear here once the scheduler is initialised.</p>
                            </div>
                        </Card>
                    )}
                </div>
            )}
        </div>
    );
};

export default SchedulerView;
