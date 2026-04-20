import React, { useState, useEffect, useRef } from 'react';
import { Icon, IconName } from '../ui/Icon';
import { Card } from '../ui/Card';
import { Button } from '../ui/Button';
import { useLms } from '@contexts/LmsContext';
import { AdminPage } from '@app-types';
import { SCHEDULER_FOCUS_STORAGE_KEY } from './SchedulerSummaryView';

interface SchedulerTask {
    id: string;
    name: string;
    description: string;
    cron_expression: string;
    enabled: boolean;
    api_endpoint: string;
    email_template: string | null;
    days_in_advance: number | null;
    last_run_at: string | null;
    last_status: string | null;
    created_at: string;
    updated_at: string;
}

// Tasks that support email template selection
const EMAIL_TEMPLATE_TASKS = ['auto_send_course_confirmation', 'auto_send_class_confirmation', 'auto_create_certificates', 'auto_send_courseware_attendance'];

// Tasks that support days-in-advance setting
const DAYS_IN_ADVANCE_TASKS = ['auto_send_course_confirmation', 'auto_send_class_confirmation', 'sync_google_calendar', 'auto_send_trainer_invitations'];

const EMAIL_TEMPLATES: { value: string; label: string }[] = [
    { value: 'final_course_confirmation', label: 'Final Class Confirm Email' },
    { value: 'course_confirmation', label: 'Class Confirm Email' },
    { value: 'certificate', label: 'Certificate Email' },
    { value: 'feedback', label: 'Feedback Email' },
    { value: 'trainer_invitation', label: 'Trainer Invitation Email' },
    { value: 'otp', label: 'OTP Email' },
    { value: 'password_reset', label: 'Password Reset Email' },
    { value: 'courseware_attendance', label: 'Courseware and Attendance Email' },
];

// ── Cron Expression Helpers ───────────────────────────────────────────────────

const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const DAY_ABBREVS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

/** Convert a cron expression like "0 14 * * *" to a human-readable string */
function describeCron(expr: string): string {
    const parts = expr.trim().split(/\s+/);
    if (parts.length < 5) return expr;

    const [minute, hour, dayOfMonth, month, dayOfWeek] = parts;

    const h = parseInt(hour, 10);
    const m = parseInt(minute, 10);
    if (isNaN(h) || isNaN(m)) return expr;

    const period = h >= 12 ? 'PM' : 'AM';
    const displayH = h === 0 ? 12 : h > 12 ? h - 12 : h;
    const displayM = String(m).padStart(2, '0');
    const timeStr = `${displayH}:${displayM} ${period} SGT`;

    // Daily pattern: "M H * * *"
    if (dayOfMonth === '*' && month === '*' && dayOfWeek === '*') {
        return `Daily at ${timeStr}`;
    }

    // Weekly pattern: "M H * * N" (single) or "M H * * N1,N2" (multi)
    if (dayOfMonth === '*' && month === '*' && dayOfWeek !== '*') {
        const dowList = dayOfWeek
            .split(',')
            .map((s) => parseInt(s.trim(), 10))
            .filter((d) => !isNaN(d) && d >= 0 && d <= 6)
            .sort((a, b) => a - b);

        if (dowList.length === 0) return expr;
        if (dowList.length === 1) {
            return `Every ${DAY_NAMES[dowList[0]]} at ${timeStr}`;
        }
        const dayLabels = dowList.map((d) => DAY_ABBREVS[d]).join(', ');
        return `Weekly on ${dayLabels} at ${timeStr}`;
    }

    return expr;
}

interface ParsedSchedule {
    hour: number;
    minute: number;
    frequency: 'daily' | 'weekly';
    daysOfWeek: number[]; // 0=Sun..6=Sat, empty when daily
}

/** Parse a cron expression into structured schedule data */
function parseCron(expr: string): ParsedSchedule | null {
    const parts = expr.trim().split(/\s+/);
    if (parts.length < 5) return null;
    const [minute, hour, dom, mon, dow] = parts;
    if (dom !== '*' || mon !== '*') return null;
    const h = parseInt(hour, 10);
    const m = parseInt(minute, 10);
    if (isNaN(h) || isNaN(m)) return null;

    if (dow !== '*') {
        const parsedDays = dow
            .split(',')
            .map((s) => parseInt(s.trim(), 10))
            .filter((d) => !isNaN(d) && d >= 0 && d <= 6);
        if (parsedDays.length === 0) return null;
        const unique = Array.from(new Set(parsedDays)).sort((a, b) => a - b);
        return { hour: h, minute: m, frequency: 'weekly', daysOfWeek: unique };
    }
    return { hour: h, minute: m, frequency: 'daily', daysOfWeek: [] };
}

/** Build a cron expression from structured schedule data */
function buildCron(schedule: ParsedSchedule): string {
    if (schedule.frequency === 'weekly') {
        const dow = schedule.daysOfWeek.length > 0
            ? Array.from(new Set(schedule.daysOfWeek)).sort((a, b) => a - b).join(',')
            : '1'; // Safety fallback: Monday
        return `${schedule.minute} ${schedule.hour} * * ${dow}`;
    }
    return `${schedule.minute} ${schedule.hour} * * *`;
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
    auto_create_learners:             AdminPage.AutomationLogs,
    auto_create_trainer_folders:      AdminPage.TrainerFolderLogs,
    sync_course_run_dates:            AdminPage.CourseRunDateSyncLogs,
    upcoming_course_runs:             AdminPage.UpcomingCourseRunsLog,
    auto_send_course_confirmation:    AdminPage.CourseConfirmationEmailLogs,
    auto_send_class_confirmation:     AdminPage.CourseConfirmationEmailLogs,
    auto_send_trainer_invitations:    AdminPage.AutoSendTrainerInvitationLog,
    auto_sanitise_data:               AdminPage.AutoSanitiseDataLog,
    auto_create_certificates:         AdminPage.AutoCreateCertificatesLog,
};

// ── Main Component ────────────────────────────────────────────────────────────

export const SchedulerView: React.FC = () => {
    const { setAdminPage } = useLms();
    const [tasks, setTasks] = useState<SchedulerTask[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [editingTaskId, setEditingTaskId] = useState<string | null>(null);
    const [editHour, setEditHour] = useState(2);
    const [editMinute, setEditMinute] = useState(0);
    const [editPeriod, setEditPeriod] = useState<'AM' | 'PM'>('PM');
    const [editFrequency, setEditFrequency] = useState<'daily' | 'weekly'>('daily');
    const [editDaysOfWeek, setEditDaysOfWeek] = useState<number[]>([1]); // 0=Sun..6=Sat, multi-select

    const toggleEditDay = (idx: number) => {
        setEditDaysOfWeek(prev => {
            if (prev.includes(idx)) {
                // Don't allow clearing all days — at least one must remain selected
                if (prev.length <= 1) return prev;
                return prev.filter(d => d !== idx);
            }
            return [...prev, idx].sort((a, b) => a - b);
        });
    };
    const [saving, setSaving] = useState(false);
    const [runningTaskId, setRunningTaskId] = useState<string | null>(null);
    const [actionMessage, setActionMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
    const [templateDropdownOpen, setTemplateDropdownOpen] = useState<string | null>(null);
    const [searchQuery, setSearchQuery] = useState('');
    const [currentPage, setCurrentPage] = useState(0);
    const ITEMS_PER_PAGE = 10;
    const templateDropdownRef = useRef<HTMLDivElement>(null);

    // Cross-page navigation: when user clicks a row in Schedule Summary, the
    // target task id is stashed in sessionStorage. On mount we read it, clear
    // it, and trigger a brief highlight + scroll on the matching task card.
    const [focusedTaskId, setFocusedTaskId] = useState<string | null>(null);
    const taskCardRefs = useRef<Record<string, HTMLDivElement | null>>({});

    useEffect(() => {
        let pending: string | null = null;
        try {
            pending = sessionStorage.getItem(SCHEDULER_FOCUS_STORAGE_KEY);
            if (pending) sessionStorage.removeItem(SCHEDULER_FOCUS_STORAGE_KEY);
        } catch {
            // ignore (incognito/quota)
        }
        if (pending) setFocusedTaskId(pending);
    }, []);

    // When tasks load (or the focus request lands first), flip to the page
    // that contains the focused task, clear the search filter so it's visible,
    // then scroll its card into view and apply a brief highlight ring. Ring
    // is auto-cleared after a short delay so it doesn't stay forever.
    useEffect(() => {
        if (!focusedTaskId || tasks.length === 0) return;

        const idx = tasks.findIndex(t => t.id === focusedTaskId);
        if (idx === -1) return;

        // Clear any active filter so the target row isn't hidden.
        setSearchQuery('');
        const targetPage = Math.floor(idx / ITEMS_PER_PAGE);
        setCurrentPage(targetPage);

        // Wait for React to render the target page before scrolling.
        const scrollTimer = setTimeout(() => {
            const el = taskCardRefs.current[focusedTaskId];
            if (el) {
                el.scrollIntoView({ behavior: 'smooth', block: 'center' });
            }
        }, 50);

        // Clear the highlight after the user has had time to see it.
        const clearTimer = setTimeout(() => {
            setFocusedTaskId(null);
        }, 2500);

        return () => {
            clearTimeout(scrollTimer);
            clearTimeout(clearTimer);
        };
    }, [focusedTaskId, tasks]);

    // Fetch tasks
    // Close template dropdown on outside click
    useEffect(() => {
        const handleClickOutside = (event: MouseEvent) => {
            if (templateDropdownRef.current && !templateDropdownRef.current.contains(event.target as Node)) {
                setTemplateDropdownOpen(null);
            }
        };
        if (templateDropdownOpen) {
            document.addEventListener('mousedown', handleClickOutside);
        }
        return () => document.removeEventListener('mousedown', handleClickOutside);
    }, [templateDropdownOpen]);

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
        // Convert 12-hour to 24-hour
        let hour24 = editHour;
        if (editPeriod === 'AM') {
            hour24 = editHour === 12 ? 0 : editHour;
        } else {
            hour24 = editHour === 12 ? 12 : editHour + 12;
        }

        const newCron = buildCron({
            hour: hour24,
            minute: editMinute,
            frequency: editFrequency,
            daysOfWeek: editDaysOfWeek,
        });
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
        const parsed = parseCron(task.cron_expression);
        if (parsed) {
            const h24 = parsed.hour;
            const period = h24 >= 12 ? 'PM' : 'AM';
            const h12 = h24 === 0 ? 12 : h24 > 12 ? h24 - 12 : h24;
            setEditHour(h12);
            setEditMinute(parsed.minute);
            setEditPeriod(period as 'AM' | 'PM');
            setEditFrequency(parsed.frequency);
            setEditDaysOfWeek(parsed.daysOfWeek.length > 0 ? parsed.daysOfWeek : [1]);
        } else {
            setEditHour(2);
            setEditMinute(0);
            setEditPeriod('PM');
            setEditFrequency('daily');
            setEditDaysOfWeek([1]);
        }
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
            <h2 className="text-3xl font-bold mb-2 dark:text-white">Task Scheduler</h2>
            <p className="text-sm text-gray-500 dark:text-gray-400 mb-6">
                Manage automated tasks and their schedules. All times are in Singapore Time (SGT).
            </p>

            {/* Search Bar */}
            <div className="relative mb-6">
                <Icon name={IconName.Search} className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-gray-400" />
                <input
                    type="text"
                    placeholder="Search tasks..."
                    value={searchQuery}
                    onChange={(e) => { setSearchQuery(e.target.value); setCurrentPage(0); }}
                    className="w-full pl-10 pr-4 py-2.5 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 text-sm dark:bg-gray-700 dark:border-gray-600 dark:text-white dark:placeholder-gray-400"
                />
            </div>

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
            {!loading && !error && (() => {
                const filteredTasks = tasks.filter(task => {
                    if (!searchQuery.trim()) return true;
                    const q = searchQuery.toLowerCase();
                    return task.name.toLowerCase().includes(q)
                        || task.description.toLowerCase().includes(q)
                        || task.api_endpoint.toLowerCase().includes(q);
                });
                const totalPages = Math.ceil(filteredTasks.length / ITEMS_PER_PAGE);
                const paginatedTasks = filteredTasks.slice(currentPage * ITEMS_PER_PAGE, (currentPage + 1) * ITEMS_PER_PAGE);

                return (
                <div className="space-y-4">
                    {paginatedTasks.map(task => (
                        <div
                            key={task.id}
                            ref={(el) => { taskCardRefs.current[task.id] = el; }}
                            className={`rounded-lg transition-all duration-500 ${
                                focusedTaskId === task.id
                                    ? 'ring-4 ring-blue-400 dark:ring-blue-500 ring-offset-2 ring-offset-background'
                                    : ''
                            }`}
                        >
                        <Card className="p-0 overflow-visible">
                            {/* Card Header */}
                            <div className={`px-6 py-4 flex items-center justify-between border-b rounded-t-lg ${
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

                                {/* Email Template & Days in Advance Settings */}
                                {(EMAIL_TEMPLATE_TASKS.includes(task.id) || DAYS_IN_ADVANCE_TASKS.includes(task.id)) && (() => {
                                    const showTemplate = EMAIL_TEMPLATE_TASKS.includes(task.id);
                                    const showDays = DAYS_IN_ADVANCE_TASKS.includes(task.id);
                                    const currentTemplate = task.email_template || 'final_course_confirmation';
                                    const currentLabel = EMAIL_TEMPLATES.find(t => t.value === currentTemplate)?.label || currentTemplate;
                                    const isOpen = templateDropdownOpen === task.id;

                                    const handleSelect = async (newTemplate: string) => {
                                        setTemplateDropdownOpen(null);
                                        if (newTemplate === currentTemplate) return;
                                        try {
                                            const res = await fetch('/api/admin/scheduler', {
                                                method: 'PUT',
                                                headers: { 'Content-Type': 'application/json' },
                                                body: JSON.stringify({ taskId: task.id, email_template: newTemplate }),
                                            });
                                            const data = await res.json();
                                            if (data.success) {
                                                setTasks(prev => prev.map(t => t.id === task.id ? data.task : t));
                                                setActionMessage({ type: 'success', text: `Email template updated to "${EMAIL_TEMPLATES.find(t => t.value === newTemplate)?.label}"` });
                                            } else {
                                                setActionMessage({ type: 'error', text: data.error || 'Failed to update template' });
                                            }
                                        } catch {
                                            setActionMessage({ type: 'error', text: 'Failed to update template' });
                                        }
                                    };

                                    const isCalendarSync = task.id === 'sync_google_calendar';
                                    const isTrainerInvitations = task.id === 'auto_send_trainer_invitations';
                                    const defaultDays = isCalendarSync ? 21 : isTrainerInvitations ? 30 : 3;
                                    const maxDays = isCalendarSync ? 90 : isTrainerInvitations ? 180 : 30;

                                    const handleDaysChange = async (delta: number) => {
                                        const current = task.days_in_advance ?? defaultDays;
                                        const newVal = current + delta;
                                        if (newVal < 1 || newVal > maxDays) return;
                                        try {
                                            const res = await fetch('/api/admin/scheduler', {
                                                method: 'PUT',
                                                headers: { 'Content-Type': 'application/json' },
                                                body: JSON.stringify({ taskId: task.id, days_in_advance: newVal }),
                                            });
                                            const data = await res.json();
                                            if (data.success) setTasks(prev => prev.map(t => t.id === task.id ? data.task : t));
                                        } catch { /* silent */ }
                                    };

                                    return (
                                        <div className="mb-4 flex flex-wrap items-end gap-6">
                                            {showTemplate && (
                                                <div>
                                                    <label className="font-medium text-gray-500 dark:text-gray-400 text-xs uppercase tracking-wider block mb-1.5">Email Template</label>
                                                    <div className="relative w-72" ref={isOpen ? templateDropdownRef : undefined}>
                                                        <button
                                                            onClick={() => setTemplateDropdownOpen(isOpen ? null : task.id)}
                                                            className="w-full flex items-center justify-between px-3 py-2 text-sm font-medium text-gray-900 dark:text-white bg-white dark:bg-gray-700 border border-gray-300 dark:border-gray-600 rounded-lg hover:border-blue-400 dark:hover:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500 transition-colors"
                                                        >
                                                            <div className="flex items-center gap-2">
                                                                <Icon name={IconName.Mail} className="w-4 h-4 text-blue-500" />
                                                                <span>{currentLabel}</span>
                                                            </div>
                                                            <svg className={`w-4 h-4 text-gray-400 transition-transform ${isOpen ? 'rotate-180' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                                                            </svg>
                                                        </button>

                                                        {isOpen && (
                                                            <div className="absolute z-50 mt-1 w-full bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-600 rounded-lg shadow-xl max-h-60 overflow-y-auto">
                                                                {EMAIL_TEMPLATES.map(t => {
                                                                    const isSelected = t.value === currentTemplate;
                                                                    return (
                                                                        <button
                                                                            key={t.value}
                                                                            onClick={() => handleSelect(t.value)}
                                                                            className={`w-full flex items-center gap-3 px-3 py-2.5 text-sm transition-colors ${
                                                                                isSelected
                                                                                    ? 'bg-blue-50 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300 font-semibold'
                                                                                    : 'text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700'
                                                                            }`}
                                                                        >
                                                                            <Icon name={IconName.Mail} className={`w-4 h-4 flex-shrink-0 ${isSelected ? 'text-blue-500' : 'text-gray-400 dark:text-gray-500'}`} />
                                                                            <span className="flex-1 text-left">{t.label}</span>
                                                                            {isSelected && (
                                                                                <svg className="w-4 h-4 text-blue-500 flex-shrink-0" fill="currentColor" viewBox="0 0 20 20">
                                                                                    <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                                                                                </svg>
                                                                            )}
                                                                        </button>
                                                                    );
                                                                })}
                                                            </div>
                                                        )}
                                                    </div>
                                                </div>
                                            )}

                                            {showDays && (
                                                <div>
                                                    <label className="font-medium text-gray-500 dark:text-gray-400 text-xs uppercase tracking-wider block mb-1.5">Days in Advance</label>
                                                    <div className="flex items-center gap-2">
                                                        <div className="flex items-center bg-gray-100 dark:bg-gray-700 rounded-lg p-1 gap-1">
                                                            <button onClick={() => handleDaysChange(-1)} className="w-7 h-7 flex items-center justify-center rounded-md bg-white dark:bg-gray-800 text-gray-700 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-600 font-bold transition-colors">−</button>
                                                            <span className="w-8 text-center text-sm font-bold text-gray-900 dark:text-white">{task.days_in_advance ?? defaultDays}</span>
                                                            <button onClick={() => handleDaysChange(1)} className="w-7 h-7 flex items-center justify-center rounded-md bg-white dark:bg-gray-800 text-gray-700 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-600 font-bold transition-colors">+</button>
                                                        </div>
                                                        <span className="text-xs text-gray-500 dark:text-gray-400">day{(task.days_in_advance ?? defaultDays) !== 1 ? 's' : ''} {isCalendarSync ? 'ahead' : 'before class'}</span>
                                                    </div>
                                                </div>
                                            )}
                                        </div>
                                    );
                                })()}

                                <div className={`grid grid-cols-1 ${editingTaskId === task.id ? 'sm:grid-cols-1' : 'sm:grid-cols-3'} gap-4 text-sm`}>
                                    {/* Schedule */}
                                    <div className={editingTaskId === task.id ? 'sm:col-span-3' : ''}>
                                        <span className="font-medium text-gray-500 dark:text-gray-400 text-xs uppercase tracking-wider">Schedule</span>
                                        {editingTaskId === task.id ? (
                                            <div className="mt-2 space-y-3">
                                                {/* Frequency Toggle */}
                                                <div className="flex items-center gap-1 p-1 bg-gray-100 dark:bg-gray-700 rounded-lg w-fit">
                                                    {(['daily', 'weekly'] as const).map(f => (
                                                        <button
                                                            key={f}
                                                            onClick={() => setEditFrequency(f)}
                                                            className={`px-4 py-1.5 text-sm font-medium rounded-md transition-colors ${
                                                                editFrequency === f
                                                                    ? 'bg-blue-600 text-white shadow-sm'
                                                                    : 'text-gray-600 dark:text-gray-300 hover:text-gray-900 dark:hover:text-white'
                                                            }`}
                                                        >
                                                            {f.charAt(0).toUpperCase() + f.slice(1)}
                                                        </button>
                                                    ))}
                                                </div>

                                                {/* Day of Week Selector (weekly only) — multi-select */}
                                                {editFrequency === 'weekly' && (
                                                    <div>
                                                        <div className="flex items-center gap-1.5 flex-wrap">
                                                            {DAY_ABBREVS.map((day, idx) => {
                                                                const selected = editDaysOfWeek.includes(idx);
                                                                return (
                                                                    <button
                                                                        key={day}
                                                                        onClick={() => toggleEditDay(idx)}
                                                                        className={`w-10 h-10 rounded-full text-xs font-semibold transition-colors ${
                                                                            selected
                                                                                ? 'bg-blue-600 text-white shadow-sm'
                                                                                : 'bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-600'
                                                                        }`}
                                                                        title={DAY_NAMES[idx]}
                                                                    >
                                                                        {day}
                                                                    </button>
                                                                );
                                                            })}
                                                        </div>
                                                        <p className="mt-1.5 text-xs text-gray-500 dark:text-gray-400">
                                                            Click multiple days to run weekly on each (e.g. Mon + Thu).
                                                        </p>
                                                    </div>
                                                )}

                                                {/* Time Picker */}
                                                <div className="flex items-center gap-2">
                                                    <div className="flex items-center bg-gray-100 dark:bg-gray-700 rounded-lg p-1 gap-1">
                                                        {/* Hour */}
                                                        <select
                                                            value={editHour}
                                                            onChange={e => setEditHour(parseInt(e.target.value, 10))}
                                                            className="bg-white dark:bg-gray-800 text-gray-900 dark:text-white text-sm font-medium rounded-md px-2 py-1.5 border-0 focus:ring-2 focus:ring-blue-500 appearance-none cursor-pointer"
                                                        >
                                                            {Array.from({ length: 12 }, (_, i) => i + 1).map(h => (
                                                                <option key={h} value={h}>{String(h).padStart(2, '0')}</option>
                                                            ))}
                                                        </select>
                                                        <span className="text-gray-400 dark:text-gray-500 font-bold text-lg">:</span>
                                                        {/* Minute */}
                                                        <select
                                                            value={editMinute}
                                                            onChange={e => setEditMinute(parseInt(e.target.value, 10))}
                                                            className="bg-white dark:bg-gray-800 text-gray-900 dark:text-white text-sm font-medium rounded-md px-2 py-1.5 border-0 focus:ring-2 focus:ring-blue-500 appearance-none cursor-pointer"
                                                        >
                                                            {Array.from({ length: 60 }, (_, i) => i).map(m => (
                                                                <option key={m} value={m}>{String(m).padStart(2, '0')}</option>
                                                            ))}
                                                        </select>
                                                        {/* AM/PM */}
                                                        <div className="flex rounded-md overflow-hidden ml-1">
                                                            {(['AM', 'PM'] as const).map(p => (
                                                                <button
                                                                    key={p}
                                                                    onClick={() => setEditPeriod(p)}
                                                                    className={`px-3 py-1.5 text-xs font-semibold transition-colors ${
                                                                        editPeriod === p
                                                                            ? 'bg-blue-600 text-white'
                                                                            : 'bg-white dark:bg-gray-800 text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200'
                                                                    }`}
                                                                >
                                                                    {p}
                                                                </button>
                                                            ))}
                                                        </div>
                                                    </div>

                                                    {/* Save / Cancel */}
                                                    <button
                                                        onClick={() => saveTimeChange(task)}
                                                        disabled={saving}
                                                        className="px-4 py-1.5 bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium rounded-lg transition-colors disabled:opacity-50"
                                                    >
                                                        {saving ? 'Saving...' : 'Save'}
                                                    </button>
                                                    <button
                                                        onClick={() => setEditingTaskId(null)}
                                                        className="px-4 py-1.5 text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200 text-sm font-medium rounded-lg hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors"
                                                    >
                                                        Cancel
                                                    </button>
                                                </div>
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

                                    {/* Last Run & Endpoint - shown below when editing */}
                                    {editingTaskId !== task.id && (
                                        <>
                                            <div>
                                                <span className="font-medium text-gray-500 dark:text-gray-400 text-xs uppercase tracking-wider">Last Run</span>
                                                <p className="mt-1 text-gray-900 dark:text-white">
                                                    {formatDate(task.last_run_at)}
                                                </p>
                                            </div>
                                            <div>
                                                <span className="font-medium text-gray-500 dark:text-gray-400 text-xs uppercase tracking-wider">Endpoint</span>
                                                <p className="mt-1 font-mono text-xs text-gray-600 dark:text-gray-400 truncate" title={task.api_endpoint}>
                                                    {task.api_endpoint}
                                                </p>
                                            </div>
                                        </>
                                    )}
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
                                            '▶ Run Once'
                                        )}
                                    </Button>
                                </div>
                            </div>
                        </Card>
                        </div>
                    ))}

                    {filteredTasks.length === 0 && (
                        <Card className="p-10">
                            <div className="text-center text-gray-500 dark:text-gray-400">
                                <p className="text-lg font-medium">{searchQuery ? 'No matching tasks found' : 'No scheduled tasks found'}</p>
                                <p className="text-sm mt-1">{searchQuery ? 'Try adjusting your search query' : 'Tasks will appear here once the scheduler is initialised.'}</p>
                            </div>
                        </Card>
                    )}

                    {/* Pagination */}
                    {totalPages > 1 && (
                        <div className="flex items-center justify-between pt-4">
                            <p className="text-sm text-gray-500 dark:text-gray-400">
                                Showing {currentPage * ITEMS_PER_PAGE + 1}–{Math.min((currentPage + 1) * ITEMS_PER_PAGE, filteredTasks.length)} of {filteredTasks.length} tasks
                            </p>
                            <div className="flex items-center gap-1">
                                <button
                                    onClick={() => setCurrentPage(0)}
                                    disabled={currentPage === 0}
                                    className="px-3 py-1.5 text-xs font-medium rounded-md border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                                >
                                    First
                                </button>
                                <button
                                    onClick={() => setCurrentPage(p => Math.max(0, p - 1))}
                                    disabled={currentPage === 0}
                                    className="px-3 py-1.5 text-xs font-medium rounded-md border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                                >
                                    Prev
                                </button>
                                {Array.from({ length: totalPages }, (_, i) => i)
                                    .filter(i => i === 0 || i === totalPages - 1 || Math.abs(i - currentPage) <= 1)
                                    .reduce<(number | 'ellipsis')[]>((acc, i, idx, arr) => {
                                        if (idx > 0 && i - (arr[idx - 1] as number) > 1) acc.push('ellipsis');
                                        acc.push(i);
                                        return acc;
                                    }, [])
                                    .map((item, idx) =>
                                        item === 'ellipsis' ? (
                                            <span key={`e${idx}`} className="px-2 text-gray-400">...</span>
                                        ) : (
                                            <button
                                                key={item}
                                                onClick={() => setCurrentPage(item)}
                                                className={`px-3 py-1.5 text-xs font-medium rounded-md border transition-colors ${
                                                    currentPage === item
                                                        ? 'bg-blue-600 text-white border-blue-600'
                                                        : 'border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700'
                                                }`}
                                            >
                                                {item + 1}
                                            </button>
                                        )
                                    )}
                                <button
                                    onClick={() => setCurrentPage(p => Math.min(totalPages - 1, p + 1))}
                                    disabled={currentPage === totalPages - 1}
                                    className="px-3 py-1.5 text-xs font-medium rounded-md border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                                >
                                    Next
                                </button>
                                <button
                                    onClick={() => setCurrentPage(totalPages - 1)}
                                    disabled={currentPage === totalPages - 1}
                                    className="px-3 py-1.5 text-xs font-medium rounded-md border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                                >
                                    Last
                                </button>
                            </div>
                        </div>
                    )}
                </div>
                );
            })()}
        </div>
    );
};

export default SchedulerView;
