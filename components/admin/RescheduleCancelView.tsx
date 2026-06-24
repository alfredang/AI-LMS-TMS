/**
 * RescheduleCancelView — top-level admin page to reschedule or cancel CONFIRMED /
 * PENDING (and reactivate CANCELLED) classes, per SESSION or as a whole, in one
 * accessible place (no longer buried under Upcoming Classes → Edit → Sessions).
 *
 * Capabilities:
 *  - List classes filtered by status (Confirmed & Pending / Cancelled / Confirmed /
 *    Pending) with advanced filters mirroring the Upcoming Classes view.
 *  - Expand a class → live SSG sessions + live Google-Calendar match; per-session
 *    Reschedule + Cancel (via the shared useSessionReschedule hook).
 *  - Move a whole class's learners + trainer to another run (MoveClassModal).
 *  - Cancel an entire class, or reactivate a cancelled one.
 *
 * Calendar sync is opt-in, default OFF.
 */
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Card } from '../ui/Card';
import { Button } from '../ui/Button';
import { getApiUrl } from '@/lib/urlHelpers';
import { useLms } from '@contexts/LmsContext';
import { useSessionReschedule } from '@/hooks/useSessionReschedule';
import { useScheduleChangeConfirm } from '@/hooks/useScheduleChangeConfirm';
import SessionRescheduleModal from './SessionRescheduleModal';
import MoveClassModal from './MoveClassModal';
import ClassPeopleModal from './ClassPeopleModal';
import CalendarAttendeesPanel from './CalendarAttendeesPanel';
import ProcessingOverlay from '../ui/ProcessingOverlay';
import { convertSsgDateToHtml, getModeLabel, modeOfTrainingOptions } from '@/lib/ssg/sessionEditHelpers';
import { TPG_MANUAL_NOTICE } from '@/lib/ssg/tpgManualNotice';

interface ClassRow {
  id: string;            // course_run UUID
  courseRunId: string;   // SSG run id
  courseTitle: string;
  courseCode: string;    // SSG course reference number
  classStatus: string;
  startDate: string;
  endDate: string;
  numOfTrainee: number;
  assignedTrainerLocal?: string;
  assignedTrainerTpg?: string;
}

interface SessionRow {
  id?: string;
  ssgSessionId?: string;
  sessionNumber?: string | number;
  startDate: string | null;
  endDate?: string | null;
  startTime?: string | null;
  endTime?: string | null;
  modeOfTraining?: string | number | null;
  venue?: any;
  calendarMatched?: boolean;
  calendarLink?: string | null;
}

interface SessionsState { loading: boolean; sessions: SessionRow[]; calendarChecked: boolean; ssgError?: string | null; }

interface EditDraft { runUuid: string; sessionKey: string; startDate: string; startTime: string; endTime: string; modeOfTraining: string; syncCalendar: boolean; }

type PopupType = 'confirm' | 'success' | 'error';
interface PopupState { open: boolean; type: PopupType; title: string; message: string; confirmText: string; cancelText: string; onConfirm?: () => void; onCancel?: () => void; }

// Order requested: Confirmed & Pending, Cancelled, Confirmed, Pending.
const STATUS_TABS: { key: string; label: string }[] = [
  { key: 'ActiveOnly', label: 'Confirmed & Pending' },
  { key: 'Cancelled', label: 'Cancelled' },
  { key: 'Confirmed', label: 'Confirmed' },
  { key: 'Pending', label: 'Pending' },
];

const CaretIcon: React.FC<{ open: boolean }> = ({ open }) => (
  <svg className={`w-3.5 h-3.5 transition-transform ${open ? 'rotate-90' : ''}`} viewBox="0 0 20 20" fill="currentColor">
    <path fillRule="evenodd" d="M7.293 14.707a1 1 0 010-1.414L10.586 10 7.293 6.707a1 1 0 011.414-1.414l4 4a1 1 0 010 1.414l-4 4a1 1 0 01-1.414 0z" clipRule="evenodd" />
  </svg>
);

/** Compact "05 Jun – 19 Jun 26" range to keep the Dates column narrow.
 * Parse the FULL value (don't string-slice — the API serializes SGT-midnight dates
 * to UTC, so slicing the ISO yields a one-day-early date). Formatting in local TZ
 * matches the Upcoming Classes table and the Edit view (SSG truth). */
const fmtDateRange = (start: string, end: string) => {
  const a = new Date(start);
  const b = new Date(end);
  if (isNaN(a.getTime()) || isNaN(b.getTime())) return `${String(start).slice(0, 10)}–${String(end).slice(0, 10)}`;
  const d = (x: Date) => x.toLocaleDateString('en-GB', { day: '2-digit', month: 'short' });
  const yr = (x: Date) => String(x.getFullYear()).slice(2);
  return a.getTime() === b.getTime() ? `${d(a)} ${yr(a)}` : `${d(a)} – ${d(b)} ${yr(b)}`;
};

/** Friendly single-day label, e.g. "Fri, 05 Jun 2026". */
const fmtDay = (iso: string) => {
  const x = new Date(String(iso).slice(0, 10) + 'T00:00:00');
  return isNaN(x.getTime()) ? iso : x.toLocaleDateString('en-GB', { weekday: 'short', day: '2-digit', month: 'short', year: 'numeric' });
};

/** Group sessions by their start date (YYYY-MM-DD), preserving first-seen order. */
const groupByDay = (sessions: SessionRow[]): { date: string; sessions: SessionRow[] }[] => {
  const out: { date: string; sessions: SessionRow[] }[] = [];
  for (const s of sessions) {
    const d = convertSsgDateToHtml(s.startDate || '') || '—';
    const g = out.find((x) => x.date === d);
    if (g) g.sessions.push(s); else out.push({ date: d, sessions: [s] });
  }
  return out;
};

const RescheduleCancelView: React.FC = () => {
  const { currentUser } = useLms();
  const currentUserEmail = currentUser?.email || '';

  const [classes, setClasses] = useState<ClassRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('ActiveOnly');
  const [page, setPage] = useState(0);
  const [totalPages, setTotalPages] = useState(1);

  // Advanced filters (mirror Upcoming Classes)
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [fCourseTitle, setFCourseTitle] = useState('');
  const [fCourseCode, setFCourseCode] = useState('');
  const [fCourseRunId, setFCourseRunId] = useState('');
  const [fTrainer, setFTrainer] = useState('');
  const [fClassType, setFClassType] = useState('');
  const [trainers, setTrainers] = useState<{ trainer_name: string }[]>([]);
  const isInitialMount = useRef(true);

  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [sessionsByRun, setSessionsByRun] = useState<Record<string, SessionsState>>({});
  const [syncCalendar, setSyncCalendar] = useState(false);
  const [notifyAttendees, setNotifyAttendees] = useState(false);
  const [busy, setBusy] = useState(false);
  const [edit, setEdit] = useState<EditDraft | null>(null);
  const [moveTarget, setMoveTarget] = useState<ClassRow | null>(null);
  const [peopleTarget, setPeopleTarget] = useState<ClassRow | null>(null);

  const [popup, setPopup] = useState<PopupState>({ open: false, type: 'success', title: '', message: '', confirmText: 'OK', cancelText: 'Cancel' });

  const closePopup = () => setPopup((p) => ({ ...p, open: false }));
  const showConfirmPopup = (message: string, onConfirm: () => void, title = 'Confirm', confirmText = 'Confirm', cancelText = 'Cancel', onCancel?: () => void) =>
    setPopup({ open: true, type: 'confirm', title, message, confirmText, cancelText, onConfirm, onCancel });
  const showSuccessPopup = (message: string) => setPopup({ open: true, type: 'success', title: 'Success', message, confirmText: 'OK', cancelText: '' });
  const showErrorPopup = (message: string) => setPopup({ open: true, type: 'error', title: 'Error', message, confirmText: 'OK', cancelText: '' });

  const { confirm: showStepConfirm, node: stepConfirmNode } = useScheduleChangeConfirm();
  const { reschedulePrompt, rescheduleSession, rescheduleDay, cancelSession, cancelDay } = useSessionReschedule({ showConfirmPopup, showSuccessPopup, showErrorPopup, setBusy, showStepConfirm });

  // Per-day reschedule (move every session on a day to a new date).
  const [dayEdit, setDayEdit] = useState<{ runUuid: string; date: string; newDate: string; syncCalendar: boolean } | null>(null);

  const fetchClasses = useCallback(async (opts?: { page?: number }) => {
    const pg = opts?.page ?? page;
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({ classStatus: statusFilter, includeOngoing: 'true', page: String(pg), limit: '20' });
      if (search.trim()) params.set('search', search.trim());
      if (fCourseTitle.trim()) params.set('courseTitle', fCourseTitle.trim());
      if (fCourseCode.trim()) params.set('courseCode', fCourseCode.trim());
      if (fCourseRunId.trim()) params.set('courseRunId', fCourseRunId.trim());
      if (fTrainer.trim()) params.set('trainer', fTrainer.trim());
      if (fClassType) params.set('classType', fClassType);
      const res = await fetch(getApiUrl(`/api/admin/upcoming-classes?${params}`));
      const data = await res.json();
      if (!data?.success) throw new Error(data?.error || 'Failed to load classes');
      setClasses(data.data?.classes || []);
      setTotalPages(data.data?.totalPages || 1);
    } catch (e: any) {
      setError(e?.message || 'Failed to load classes');
      setClasses([]);
    } finally {
      setLoading(false);
    }
  }, [search, statusFilter, page, fCourseTitle, fCourseCode, fCourseRunId, fTrainer, fClassType]);

  useEffect(() => { setPage(0); void fetchClasses({ page: 0 }); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [statusFilter]);

  // Trainers list for the Trainer filter dropdown (same source as Assign Trainers).
  useEffect(() => {
    (async () => {
      try {
        const res = await fetch(getApiUrl('/api/admin/trainers'));
        const data = await res.json();
        if (data?.success) setTrainers(data.data?.trainers || []);
      } catch { /* non-fatal */ }
    })();
  }, []);

  // Debounce text/filter inputs (300ms) — auto-search like the other TMS lists.
  useEffect(() => {
    if (isInitialMount.current) { isInitialMount.current = false; return; }
    const t = setTimeout(() => { setPage(0); void fetchClasses({ page: 0 }); }, 300);
    return () => clearTimeout(t);
    /* eslint-disable-next-line react-hooks/exhaustive-deps */
  }, [search, fCourseTitle, fCourseCode, fCourseRunId, fTrainer, fClassType]);

  const applyFilters = () => { setPage(0); void fetchClasses({ page: 0 }); };
  const clearFilters = () => {
    // Clearing the inputs triggers the debounced effect, which refetches.
    setSearch(''); setFCourseTitle(''); setFCourseCode(''); setFCourseRunId(''); setFTrainer(''); setFClassType('');
    setPage(0);
  };

  const loadSessions = useCallback(async (run: ClassRow, force = false) => {
    if (!force && sessionsByRun[run.id] && !sessionsByRun[run.id].loading) return;
    setSessionsByRun((prev) => ({ ...prev, [run.id]: { loading: true, sessions: [], calendarChecked: false } }));
    try {
      const res = await fetch(getApiUrl(`/api/admin/class-sessions?courseRunId=${encodeURIComponent(run.courseRunId)}`));
      const data = await res.json();
      setSessionsByRun((prev) => ({ ...prev, [run.id]: { loading: false, sessions: data?.sessions || [], calendarChecked: !!data?.calendarChecked, ssgError: data?.ssgError || null } }));
    } catch {
      setSessionsByRun((prev) => ({ ...prev, [run.id]: { loading: false, sessions: [], calendarChecked: false, ssgError: 'Failed to load sessions' } }));
    }
  }, [sessionsByRun]);

  const toggleExpand = (run: ClassRow) => {
    setExpanded((prev) => {
      const next = { ...prev, [run.id]: !prev[run.id] };
      if (next[run.id]) void loadSessions(run);
      return next;
    });
    setEdit(null);
  };

  const sessionKeyOf = (s: SessionRow) => String(s.ssgSessionId || s.id || '');

  const startEdit = (run: ClassRow, s: SessionRow) => setEdit({
    runUuid: run.id, sessionKey: sessionKeyOf(s),
    startDate: convertSsgDateToHtml(s.startDate || ''), startTime: s.startTime || '', endTime: s.endTime || '', modeOfTraining: String(s.modeOfTraining ?? ''),
    syncCalendar, // follows the main page checkbox, but visible + togglable per reschedule
  });

  const saveReschedule = async (run: ClassRow, s: SessionRow) => {
    if (!edit) return;
    await rescheduleSession({
      courseRunId: run.courseRunId, courseReferenceNumber: run.courseCode, currentUserEmail,
      session: { id: s.ssgSessionId || s.id, startDate: edit.startDate, endDate: edit.startDate, startTime: edit.startTime, endTime: edit.endTime, modeOfTraining: edit.modeOfTraining, venue: s.venue },
      originalSession: { startDate: convertSsgDateToHtml(s.startDate || ''), startTime: s.startTime || '', endTime: s.endTime || '', modeOfTraining: s.modeOfTraining ?? '' },
      allSessions: (sessionsByRun[run.id]?.sessions || []).map((x) => ({ id: x.ssgSessionId || x.id, startDate: x.startDate || '' })),
      syncCalendar, notifyAttendees, sessionLabel: `S${s.sessionNumber ?? ''}`.trim(),
      onApplied: () => { setEdit(null); void loadSessions(run, true); },
    });
  };

  const cancelOneSession = async (run: ClassRow, s: SessionRow) => {
    await cancelSession({
      courseRunId: run.courseRunId, courseReferenceNumber: run.courseCode, currentUserEmail,
      session: { id: s.ssgSessionId || s.id, startDate: convertSsgDateToHtml(s.startDate || ''), endDate: convertSsgDateToHtml(s.endDate || s.startDate || ''), startTime: s.startTime || '', endTime: s.endTime || '', modeOfTraining: s.modeOfTraining ?? '', venue: s.venue },
      sessionLabel: `S${s.sessionNumber ?? ''}`.trim(), syncCalendar, notifyAttendees,
      onApplied: () => { void loadSessions(run, true); },
    });
  };

  // Create/sync the run's calendar events for its CURRENT sessions (no reschedule).
  // Reconciles: creates missing day events, adopts matches, syncs attendees, drops stale.
  const [calBusyRun, setCalBusyRun] = useState<string | null>(null);
  const syncRunCalendar = async (run: ClassRow) => {
    setCalBusyRun(run.id);
    try {
      const res = await fetch(getApiUrl('/api/admin/reconcile-run-calendar'), {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ courseRunId: run.courseRunId }),
      });
      const j = await res.json();
      if (j?.success && j?.status === 'ok') {
        showSuccessPopup(`Google Calendar updated — ${j.created ?? 0} event(s) created, ${j.removedStale ?? 0} removed.`);
      } else {
        showErrorPopup(`Calendar not updated: ${j?.reason || j?.error || 'unknown'}`);
      }
      void loadSessions(run, true);
    } catch (e: any) {
      showErrorPopup('Calendar sync failed: ' + (e?.message || 'unknown error'));
    } finally {
      setCalBusyRun(null);
    }
  };

  const saveDayReschedule = async (run: ClassRow, group: { date: string; sessions: SessionRow[] }) => {
    if (!dayEdit) return;
    const all = sessionsByRun[run.id]?.sessions || [];
    await rescheduleDay({
      courseRunId: run.courseRunId, courseReferenceNumber: run.courseCode, currentUserEmail,
      oldDate: group.date, newDate: dayEdit.newDate,
      sessionsOnDay: group.sessions.map((s) => ({
        id: s.ssgSessionId || s.id, startDate: convertSsgDateToHtml(s.startDate || ''), endDate: convertSsgDateToHtml(s.endDate || s.startDate || ''),
        startTime: s.startTime || '', endTime: s.endTime || '', modeOfTraining: s.modeOfTraining ?? '', venue: s.venue,
      })),
      allSessions: all.map((x) => ({ id: x.ssgSessionId || x.id, startDate: x.startDate || '' })),
      syncCalendar, notifyAttendees,
      onApplied: () => { setDayEdit(null); void loadSessions(run, true); },
    });
  };

  const cancelEntireDay = async (run: ClassRow, group: { date: string; sessions: SessionRow[] }) => {
    await cancelDay({
      courseRunId: run.courseRunId, courseReferenceNumber: run.courseCode, currentUserEmail,
      date: group.date,
      sessionsOnDay: group.sessions.map((s) => ({
        id: s.ssgSessionId || s.id, startDate: convertSsgDateToHtml(s.startDate || ''), endDate: convertSsgDateToHtml(s.endDate || s.startDate || ''),
        startTime: s.startTime || '', endTime: s.endTime || '', modeOfTraining: s.modeOfTraining ?? '', venue: s.venue,
      })),
      syncCalendar, notifyAttendees,
      onApplied: () => { setDayEdit(null); void loadSessions(run, true); },
    });
  };

  const setClassStatus = async (run: ClassRow, status: 'Cancelled' | 'Confirmed'): Promise<boolean> => {
    try {
      setBusy(true);
      const res = await fetch(getApiUrl('/api/admin/upcoming-classes'), {
        method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: run.id, class_status: status }),
      });
      const data = await res.json();
      if (!data?.success) throw new Error(data?.error || 'Failed to update class status');
      void fetchClasses();
      return true;
    } catch (e: any) {
      showErrorPopup('Failed to update class: ' + (e?.message || 'unknown error'));
      return false;
    } finally {
      setBusy(false);
    }
  };

  // Cancel an entire class — standardized step confirm with the Notify composer
  // (calendar removal is automatic for a class cancel, so no Sync toggle).
  const cancelEntireClass = (run: ClassRow) => { void (async () => {
    const dec = await showStepConfirm({
      title: 'Cancel entire class', destructive: true, confirmLabel: 'Cancel class', cancelLabel: 'Keep class',
      message: `Cancel the ENTIRE class "${run.courseTitle}" (run ${run.courseRunId})?\n\nThis marks the class as Cancelled and removes all its Google Calendar events. The sessions themselves aren't deleted.\n\n${TPG_MANUAL_NOTICE}`,
      defaultSync: false, showSync: false, showAdjust: false, defaultNotify: notifyAttendees,
      notify: { courseRunId: run.courseRunId, changeType: 'class_cancel', summary: `The class "${run.courseTitle}" (run ${run.courseRunId}) has been cancelled.` },
    });
    if (!dec.confirmed) return;
    const ok = await setClassStatus(run, 'Cancelled');
    if (!ok) return;
    if (dec.notifyPayload) {
      const p = dec.notifyPayload;
      try {
        const r = await fetch(getApiUrl('/api/admin/notify-schedule-change'), {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ courseRunId: run.courseRunId, changeType: 'class_cancel', summary: p.message, subject: p.subject, reason: p.reason, recipients: p.recipients }),
        });
        const j = await r.json();
        showSuccessPopup(`Class cancelled.\n\n${j?.success ? `Notified ${j.sent ?? 0} attendee(s)${j.failed ? `, ${j.failed} failed` : ''}.` : `Notification failed: ${j?.error || 'unknown'}`}`);
      } catch (err: any) { showErrorPopup('Class cancelled, but notification failed: ' + (err?.message || 'unknown error')); }
    } else {
      showSuccessPopup('Class cancelled.');
    }
  })(); };

  const reactivateClass = (run: ClassRow) => showConfirmPopup(
    `Reactivate "${run.courseTitle}" (run ${run.courseRunId})?\n\nThis sets the class status back to Confirmed and (if it has learners) restores its Google Calendar events.`,
    () => { void (async () => { const ok = await setClassStatus(run, 'Confirmed'); if (ok) showSuccessPopup('Class reactivated (Confirmed).'); })(); }, 'Reactivate class', 'Reactivate', 'Keep cancelled',
  );

  const statusBadge = (status: string) => {
    const map: Record<string, string> = {
      Confirmed: 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300',
      Pending: 'bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-300',
      Cancelled: 'bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-300',
    };
    return <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${map[status] || 'bg-gray-100 text-gray-700 dark:bg-gray-700 dark:text-gray-300'}`}>{status}</span>;
  };

  const inputCls = 'w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 text-sm dark:bg-gray-700 dark:border-gray-600 dark:text-white';

  return (
    <div>
      <div className="mb-3">
        <h2 className="text-3xl font-bold dark:text-white">Reschedule &amp; Cancel</h2>
        <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">Reschedule or cancel individual sessions, move a class to another run, or cancel / reactivate a whole class.</p>
      </div>

      {/* Calendar sync + notify opt-ins */}
      <div className="mb-4 rounded-md border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800/40 p-3 text-sm space-y-2">
        <p className="text-xs text-gray-500 dark:text-gray-400 -mb-1">Defaults for this page — every reschedule, cancel and move uses these, and you can change either one when you confirm.</p>
        <label className="flex items-center gap-2 cursor-pointer select-none text-gray-700 dark:text-gray-300">
          <input type="checkbox" checked={syncCalendar} onChange={(e) => setSyncCalendar(e.target.checked)} className="h-4 w-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500" />
          <span><strong>Sync Google Calendar</strong> — also move or remove the matching Google Calendar event when a change is applied. Off by default.</span>
        </label>
        <label className="flex items-center gap-2 cursor-pointer select-none text-gray-700 dark:text-gray-300">
          <input type="checkbox" checked={notifyAttendees} onChange={(e) => setNotifyAttendees(e.target.checked)} className="h-4 w-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500" />
          <span><strong>Notify attendees by email</strong> — open each confirmation with the email ready to send to the learners and trainer(s). Off by default; never automatic.</span>
        </label>
      </div>

      {/* Filters */}
      <Card className="p-4 mb-4 dark:bg-gray-800 dark:border-gray-700">
        <div className="flex flex-wrap gap-3 items-center mb-3">
          <div className="flex gap-1 p-1 bg-gray-100 dark:bg-gray-700 rounded-lg">
            {STATUS_TABS.map((t) => (
              <button key={t.key} type="button" onClick={() => setStatusFilter(t.key)}
                className={`px-3 py-1.5 rounded-md text-sm font-medium transition-colors ${statusFilter === t.key ? 'bg-white dark:bg-gray-900 text-blue-600 dark:text-blue-400 shadow-sm' : 'text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200'}`}>
                {t.label}
              </button>
            ))}
          </div>
          <div className="flex gap-2 ml-auto">
            <Button variant="primary" size="sm" onClick={() => setShowAdvanced(!showAdvanced)}>{showAdvanced ? 'Hide Advanced Filters' : 'Show Advanced Filters'}</Button>
            <Button variant="ghost" size="sm" onClick={clearFilters}>Clear</Button>
          </div>
        </div>

        <form className="flex gap-2" onSubmit={(e) => { e.preventDefault(); applyFilters(); }}>
          <input type="text" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search title, code, run id, trainer…" className={`flex-1 ${inputCls}`} />
          <Button type="submit" variant="ghost">Search</Button>
        </form>

        {showAdvanced && (
          <div className="mt-3 bg-gray-50 dark:bg-gray-900/50 p-4 rounded-lg">
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Course Title</label>
                <input type="text" value={fCourseTitle} onChange={(e) => setFCourseTitle(e.target.value)} placeholder="Enter course title…" className={inputCls} />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Course Code</label>
                <input type="text" value={fCourseCode} onChange={(e) => setFCourseCode(e.target.value)} placeholder="Enter course code…" className={inputCls} />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Course Run ID</label>
                <input type="text" value={fCourseRunId} onChange={(e) => setFCourseRunId(e.target.value)} placeholder="Enter run ID…" className={inputCls} />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Trainer</label>
                <select value={fTrainer} onChange={(e) => setFTrainer(e.target.value)} className={inputCls}>
                  <option value="">All trainers</option>
                  {trainers.map((t, i) => <option key={t.trainer_name || i} value={t.trainer_name}>{t.trainer_name}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Class Type</label>
                <select value={fClassType} onChange={(e) => setFClassType(e.target.value)} className={inputCls}>
                  <option value="">All types</option>
                  <option value="Physical">Physical</option>
                  <option value="Virtual">Virtual</option>
                  <option value="Hybrid">Hybrid</option>
                  <option value="External">External</option>
                </select>
              </div>
            </div>
            <div className="mt-3 flex justify-end">
              <Button variant="primary" size="sm" onClick={applyFilters}>Apply Filters</Button>
            </div>
          </div>
        )}
      </Card>

      {busy && <div className="mb-3 text-sm text-blue-600 dark:text-blue-400 flex items-center gap-2"><span className="animate-spin rounded-full h-4 w-4 border-b-2 border-blue-500" /> Working…</div>}
      {error && <div className="mb-3 p-3 rounded-md text-sm bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-700 text-red-800 dark:text-red-300">{error}</div>}

      {loading ? (
        <div className="flex items-center gap-2 text-gray-500 dark:text-gray-400"><span className="animate-spin rounded-full h-5 w-5 border-b-2 border-blue-500" /> Loading classes…</div>
      ) : classes.length === 0 ? (
        <Card className="p-6 text-center text-gray-500 dark:text-gray-400 dark:bg-gray-800 dark:border-gray-700">No classes found for this filter.</Card>
      ) : (
        <Card className="dark:bg-gray-800 dark:border-gray-700 overflow-hidden">
          <div className="overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead className="bg-gray-50 dark:bg-gray-700/50">
                <tr>
                  <th className="px-2 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider"></th>
                  <th className="px-2 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider whitespace-nowrap">Run ID</th>
                  <th className="px-2 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">Course</th>
                  <th className="px-2 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider whitespace-nowrap">Dates</th>
                  <th className="px-2 py-3 text-center text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">Lrn</th>
                  <th className="px-2 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">Status</th>
                  <th className="px-2 py-3 text-right text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
                {classes.map((run) => {
                  const sx = sessionsByRun[run.id];
                  const isOpen = !!expanded[run.id];
                  const isCancelled = run.classStatus === 'Cancelled';
                  return (
                    <React.Fragment key={run.id}>
                      <tr className="hover:bg-gray-50 dark:hover:bg-gray-700/30 align-middle">
                        <td className="px-2 py-2">
                          <div className="flex flex-col gap-1 items-start">
                            <button type="button" onClick={() => toggleExpand(run)} title="Show sessions for this class"
                              className={`inline-flex items-center gap-1 px-2 py-1 rounded-md border text-xs font-medium transition-colors focus:outline-none focus:ring-2 focus:ring-blue-400 whitespace-nowrap ${isOpen ? 'bg-blue-100 border-blue-300 text-blue-700 dark:bg-blue-900/40 dark:border-blue-700 dark:text-blue-300' : 'bg-gray-100 border-gray-300 text-gray-700 hover:bg-blue-50 hover:text-blue-600 hover:border-blue-300 dark:bg-gray-700 dark:border-gray-600 dark:text-gray-200'}`}>
                              <CaretIcon open={isOpen} />
                              {isOpen ? 'Hide' : 'View Sessions'}
                            </button>
                            <button type="button" onClick={() => setPeopleTarget(run)} title="View trainer & learners for this class"
                              className="inline-flex items-center gap-1 px-2 py-1 rounded-md border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-700 text-xs font-medium whitespace-nowrap">
                              👥 People
                            </button>
                          </div>
                        </td>
                        <td className="px-2 py-2 whitespace-nowrap text-gray-700 dark:text-gray-300">{run.courseRunId}</td>
                        <td className="px-2 py-2 max-w-[260px]">
                          <div className="font-medium text-gray-900 dark:text-white truncate" title={run.courseTitle}>{run.courseTitle}</div>
                          <div className="text-xs text-gray-400 truncate">{run.courseCode}</div>
                        </td>
                        <td className="px-2 py-2 whitespace-nowrap text-gray-600 dark:text-gray-400">{fmtDateRange(run.startDate, run.endDate)}</td>
                        <td className="px-2 py-2 text-center text-gray-600 dark:text-gray-400">{run.numOfTrainee}</td>
                        <td className="px-2 py-2 whitespace-nowrap">{statusBadge(run.classStatus)}</td>
                        <td className="px-2 py-2 text-right">
                          {isCancelled ? (
                            <button type="button" onClick={() => reactivateClass(run)} className="px-2 py-1 rounded-md text-xs font-medium text-white bg-green-600 hover:bg-green-700 whitespace-nowrap">Reactivate</button>
                          ) : (
                            <div className="flex flex-col gap-1 items-end">
                              <button type="button" onClick={() => setMoveTarget(run)} className="w-full px-2 py-1 rounded-md text-xs font-medium bg-blue-600 text-white hover:bg-blue-700 whitespace-nowrap">Move class to another course run</button>
                              <button type="button" onClick={() => cancelEntireClass(run)} className="w-full px-2 py-1 rounded-md text-xs font-medium text-white bg-red-600 hover:bg-red-700 whitespace-nowrap">Cancel Class</button>
                            </div>
                          )}
                        </td>
                      </tr>
                      {isOpen && (
                        <tr className="bg-gray-50/50 dark:bg-gray-900/30">
                          <td colSpan={7} className="px-4 py-3 border-t border-gray-100 dark:border-gray-800">
                            {sx?.loading ? (
                              <div className="text-sm text-gray-500 dark:text-gray-400 flex items-center gap-2"><span className="animate-spin rounded-full h-4 w-4 border-b-2 border-blue-500" /> Loading sessions…</div>
                            ) : sx?.ssgError ? (
                              <div className="text-sm text-amber-600 dark:text-amber-400">Couldn't load sessions from SSG: {sx.ssgError}</div>
                            ) : (sx?.sessions || []).length === 0 ? (
                              <div className="text-sm text-gray-500 dark:text-gray-400">No sessions found for this run.</div>
                            ) : (
                              <div className="space-y-3">
                                <div className="flex items-center justify-end">
                                  <button type="button" onClick={() => void syncRunCalendar(run)} disabled={calBusyRun === run.id}
                                    title="Add Google Calendar events for any sessions that don't have one (and update attendees)"
                                    className="px-2 py-1 rounded-md text-xs font-medium border border-blue-300 dark:border-blue-700 text-blue-700 dark:text-blue-300 hover:bg-blue-50 dark:hover:bg-blue-900/20 disabled:opacity-50 whitespace-nowrap">
                                    {calBusyRun === run.id ? 'Creating…' : '🗓️ Create missing calendar events'}
                                  </button>
                                </div>
                                {groupByDay(sx?.sessions || []).map((group) => {
                                  const dayEditing = dayEdit && dayEdit.runUuid === run.id && dayEdit.date === group.date;
                                  return (
                                    <div key={group.date} className="rounded-md border border-gray-200 dark:border-gray-700 overflow-hidden">
                                      <div className="flex items-center justify-between gap-2 px-3 py-2 bg-gray-100 dark:bg-gray-800 border-b border-gray-200 dark:border-gray-700">
                                        <div className="text-sm font-medium text-gray-800 dark:text-gray-200">📅 {fmtDay(group.date)} <span className="text-xs font-normal text-gray-500 dark:text-gray-400">· {group.sessions.length} session{group.sessions.length === 1 ? '' : 's'}</span></div>
                                        {dayEditing ? (
                                          <div className="flex items-center gap-2">
                                            <input type="date" value={dayEdit!.newDate} onChange={(e) => setDayEdit({ ...dayEdit!, newDate: e.target.value })} className="border border-gray-300 dark:border-gray-600 rounded px-2 py-1 text-xs dark:bg-gray-700 dark:text-white" />
                                            <button type="button" onClick={() => void saveDayReschedule(run, group)} className="px-2 py-1 rounded-md text-xs font-medium text-white bg-blue-600 hover:bg-blue-700">Save day</button>
                                            <button type="button" onClick={() => setDayEdit(null)} className="px-2 py-1 rounded-md text-xs font-medium border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-700">Cancel</button>
                                          </div>
                                        ) : (
                                          <div className="flex items-center gap-2">
                                            <button type="button" onClick={() => setDayEdit({ runUuid: run.id, date: group.date, newDate: group.date, syncCalendar })} className="px-2 py-1 rounded-md text-xs font-medium border border-blue-300 dark:border-blue-700 text-blue-700 dark:text-blue-300 hover:bg-blue-50 dark:hover:bg-blue-900/20 whitespace-nowrap">Reschedule entire day</button>
                                            <button type="button" onClick={() => void cancelEntireDay(run, group)} className="px-2 py-1 rounded-md text-xs font-medium border border-red-300 dark:border-red-700 text-red-700 dark:text-red-300 hover:bg-red-50 dark:hover:bg-red-900/20 whitespace-nowrap">Cancel entire day</button>
                                          </div>
                                        )}
                                      </div>
                                      <table className="min-w-full text-sm">
                                        <tbody>
                                          {group.sessions.map((s, i) => {
                                            const key = sessionKeyOf(s);
                                            const editing = edit && edit.runUuid === run.id && edit.sessionKey === key;
                                            return (
                                              <tr key={key || i} className="border-b border-gray-100 dark:border-gray-800 align-middle last:border-0">
                                                <td className="py-2 px-3 text-gray-500 dark:text-gray-400 w-10">S{s.sessionNumber ?? i + 1}</td>
                                                {editing ? (
                                                  <>
                                                    <td className="py-2 px-2"><input type="date" value={edit!.startDate} onChange={(e) => setEdit({ ...edit!, startDate: e.target.value })} className="border border-gray-300 dark:border-gray-600 rounded px-2 py-1 text-sm dark:bg-gray-700 dark:text-white" /></td>
                                                    <td className="py-2 px-2">
                                                      <div className="flex items-center gap-1">
                                                        <input type="time" value={edit!.startTime} onChange={(e) => setEdit({ ...edit!, startTime: e.target.value })} className="border border-gray-300 dark:border-gray-600 rounded px-1 py-1 text-sm dark:bg-gray-700 dark:text-white" />
                                                        <span>–</span>
                                                        <input type="time" value={edit!.endTime} onChange={(e) => setEdit({ ...edit!, endTime: e.target.value })} className="border border-gray-300 dark:border-gray-600 rounded px-1 py-1 text-sm dark:bg-gray-700 dark:text-white" />
                                                      </div>
                                                    </td>
                                                    <td className="py-2 px-2">
                                                      <select value={edit!.modeOfTraining} onChange={(e) => setEdit({ ...edit!, modeOfTraining: e.target.value })} className="border border-gray-300 dark:border-gray-600 rounded px-2 py-1 text-sm dark:bg-gray-700 dark:text-white">
                                                        <option value="">—</option>
                                                        {modeOfTrainingOptions.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                                                      </select>
                                                    </td>
                                                    <td className="py-2 px-2 text-right whitespace-nowrap">
                                                      <button type="button" onClick={() => void saveReschedule(run, s)} className="px-2.5 py-1 rounded-md text-xs font-medium text-white bg-blue-600 hover:bg-blue-700">Save</button>
                                                      <button type="button" onClick={() => setEdit(null)} className="ml-2 px-2.5 py-1 rounded-md text-xs font-medium border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-700">Cancel</button>
                                                    </td>
                                                  </>
                                                ) : (
                                                  <>
                                                    <td className="py-2 px-2 text-gray-700 dark:text-gray-300 whitespace-nowrap">{convertSsgDateToHtml(s.startDate || '') || '—'}</td>
                                                    <td className="py-2 px-2 text-gray-700 dark:text-gray-300 whitespace-nowrap">{s.startTime || '—'}{s.endTime ? `–${s.endTime}` : ''}</td>
                                                    <td className="py-2 px-2 text-gray-700 dark:text-gray-300">{s.modeOfTraining ? getModeLabel(s.modeOfTraining).replace(/^\d+\s*-\s*/, '') : '—'}</td>
                                                    <td className="py-2 px-2">
                                                      {!sx?.calendarChecked ? (
                                                        <span className="text-gray-400" title="Google Calendar wasn't reachable in this environment.">not checked</span>
                                                      ) : s.calendarMatched && s.calendarLink ? (
                                                        <a href={s.calendarLink} target="_blank" rel="noopener noreferrer" className="text-green-600 dark:text-green-400 hover:underline">On calendar ↗</a>
                                                      ) : (
                                                        <span className="text-amber-600 dark:text-amber-400">Not on calendar</span>
                                                      )}
                                                    </td>
                                                    <td className="py-2 px-2 text-right whitespace-nowrap">
                                                      <button type="button" onClick={() => startEdit(run, s)} className="px-2.5 py-1 rounded-md text-xs font-medium text-white bg-blue-600 hover:bg-blue-700">Reschedule Session</button>
                                                      <button type="button" onClick={() => void cancelOneSession(run, s)} className="ml-2 px-2.5 py-1 rounded-md text-xs font-medium text-white bg-red-600 hover:bg-red-700">Cancel Session</button>
                                                    </td>
                                                  </>
                                                )}
                                              </tr>
                                            );
                                          })}
                                        </tbody>
                                      </table>
                                    </div>
                                  );
                                })}
                                <p className="text-xs text-gray-400">Sessions are grouped by day. Rescheduling moves the session; cancelling permanently deletes it.</p>
                                <div className="pt-3 border-t border-gray-200 dark:border-gray-700">
                                  <CalendarAttendeesPanel courseRunId={run.courseRunId} calendarSync={syncCalendar} onChanged={() => { void loadSessions(run, true); void fetchClasses(); }} />
                                </div>
                              </div>
                            )}
                          </td>
                        </tr>
                      )}
                    </React.Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      {/* Pagination */}
      {!loading && totalPages > 1 && (
        <div className="flex items-center justify-center gap-3 mt-4 text-sm">
          <Button variant="ghost" disabled={page <= 0} onClick={() => { const p = page - 1; setPage(p); void fetchClasses({ page: p }); }}>Prev</Button>
          <span className="text-gray-500 dark:text-gray-400">Page {page + 1} of {totalPages}</span>
          <Button variant="ghost" disabled={page >= totalPages - 1} onClick={() => { const p = page + 1; setPage(p); void fetchClasses({ page: p }); }}>Next</Button>
        </div>
      )}

      {/* Move class modal */}
      {moveTarget && (
        <MoveClassModal
          run={moveTarget}
          defaultSyncCalendar={syncCalendar}
          defaultNotify={notifyAttendees}
          onClose={() => setMoveTarget(null)}
          onDone={() => {
            void fetchClasses();
            // The move changed both runs' rosters/calendars — refresh any expanded
            // run's live sessions + Calendar column so it doesn't show stale state.
            classes.forEach((c) => { if (expanded[c.id]) void loadSessions(c, true); });
          }}
          showConfirmPopup={showConfirmPopup}
          showSuccessPopup={showSuccessPopup}
          showErrorPopup={showErrorPopup}
        />
      )}

      {/* Trainer & learners modal */}
      {peopleTarget && (
        <ClassPeopleModal run={peopleTarget} onClose={() => setPeopleTarget(null)} />
      )}

      {/* Calendar-resolution modal (shared) */}
      <SessionRescheduleModal prompt={reschedulePrompt} />

      {/* Standardized step confirmation (Sync + Notify toggles + email composer) */}
      {stepConfirmNode}

      {/* Pending overlay while a reschedule/cancel/sync is in flight */}
      <ProcessingOverlay show={busy} />

      {/* Popup (confirm / success / error) */}
      {popup.open && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
          <div className="bg-white dark:bg-gray-800 rounded-lg shadow-xl max-w-lg w-full border dark:border-gray-700 p-6">
            <h3 className={`text-lg font-semibold mb-2 ${popup.type === 'error' ? 'text-red-700 dark:text-red-400' : 'text-gray-900 dark:text-white'}`}>{popup.title}</h3>
            <p className="text-sm text-gray-600 dark:text-gray-300 mb-4 whitespace-pre-line">{popup.message}</p>
            <div className="flex justify-end gap-2">
              {popup.type === 'confirm' && popup.cancelText && (
                <button type="button" onClick={() => { const fn = popup.onCancel; closePopup(); fn?.(); }} className="px-4 py-2 text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-md">{popup.cancelText}</button>
              )}
              <button type="button" onClick={() => { const fn = popup.onConfirm; closePopup(); if (popup.type === 'confirm' && fn) fn(); }}
                className={`px-4 py-2 rounded-md text-white ${popup.type === 'error' ? 'bg-red-600 hover:bg-red-700' : 'bg-blue-600 hover:bg-blue-700'}`}>
                {popup.confirmText}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default RescheduleCancelView;
