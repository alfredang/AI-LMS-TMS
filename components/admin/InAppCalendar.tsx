/**
 * InAppCalendar — Google-Calendar-like view of TMS class data (FullCalendar).
 *
 * All-classes view: one block per (course run, day with >=1 session), coloured by
 * status, labelled "<course> · Day k/n", earliest→latest time. Source: classes-by-date.
 *
 * Click an event → a popup modal with the **event details** (course run, trainer(s),
 * learners) PLUS that run's **sessions grouped by day** (like the "+ N more" popover).
 * Reschedule by DRAG: drag a run-day block (whole day) on the grid, or drag a session
 * out of the modal onto a day. While dragging, the modal + "+more" popover hide so the
 * target day is visible, and a coloured hint shows "release outside to cancel"; dropping
 * outside a cell cancels and re-shows the modal. Click a session = cancel it (guarded).
 *
 * All writes route through useSessionReschedule (SSG + opt-in calendar sync + notify).
 */
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import FullCalendar from '@fullcalendar/react';
import dayGridPlugin from '@fullcalendar/daygrid';
import timeGridPlugin from '@fullcalendar/timegrid';
import listPlugin from '@fullcalendar/list';
import interactionPlugin, { Draggable } from '@fullcalendar/interaction';
import type { EventClickArg, EventInput, DatesSetArg } from '@fullcalendar/core';
import { getApiUrl } from '@/lib/urlHelpers';
import { useLms } from '@contexts/LmsContext';
import { useSessionReschedule } from '@/hooks/useSessionReschedule';
import SessionRescheduleModal from './SessionRescheduleModal';
import MoveClassModal from './MoveClassModal';
import { useScheduleChangeConfirm } from '@/hooks/useScheduleChangeConfirm';
import { convertSsgDateToHtml, getModeLabel } from '@/lib/ssg/sessionEditHelpers';
import { type TaggedTrainer, type TrainerTag, TAG_SHORT, TAG_LABELS, hasAnyTag } from '@/lib/trainers/taggedTrainers';
import CalendarAttendeesPanel from './CalendarAttendeesPanel';
import ProcessingOverlay from '../ui/ProcessingOverlay';

interface ClassDayEvent {
  courseRunUuid: string; courseRunId: string; courseCode: string; courseTitle: string;
  classStatus: string; sessionDate: string; startTime: string; endTime: string;
  dayNumber: number; allSessionDates: string[]; numLearners: number;
  tpgTrainerName?: string; localTrainerName?: string; localTrainers?: Array<{ name: string; email: string }>;
  taggedTrainers?: TaggedTrainer[]; // merged LMS + accepted + TPG trainers with tags
  noSessions?: boolean; // run has no scheduled sessions (all-day block on its start date)
}
interface DrillSession {
  ssgSessionId?: string; id?: string; sessionNumber?: string | number;
  startDate: string | null; endDate?: string | null; startTime?: string | null; endTime?: string | null;
  modeOfTraining?: string | number | null; venue?: any;
  calendarMatched?: boolean; calendarLink?: string | null;
}
interface Learner { learnerName: string; learnerEmail: string; sponsorship?: string; }
interface EventModalState {
  run: { courseRunUuid: string; courseRunId: string; courseCode: string; courseTitle: string; classStatus: string; startDate?: string; endDate?: string };
  loading: boolean;
  taggedTrainers: TaggedTrainer[]; learners: Learner[];
  sessions: DrillSession[];
}
type PopupType = 'confirm' | 'success' | 'error';
interface PopupState { open: boolean; type: PopupType; title: string; message: string; confirmText: string; cancelText: string; onConfirm?: () => void; onCancel?: () => void; }

const STATUS_COLORS: Record<string, string> = { Confirmed: '#16a34a', Pending: '#d97706', Cancelled: '#dc2626' };
const colorFor = (s: string) => STATUS_COLORS[s] || '#2563eb';
const to24h = (t?: string | null): string => {
  if (!t) return '';
  const m = String(t).trim().match(/^(\d{1,2}):(\d{2})(?::\d{2})?\s*(am|pm)?$/i);
  if (!m) return '';
  let h = parseInt(m[1], 10);
  const ap = m[3]?.toLowerCase();
  if (ap === 'pm' && h < 12) h += 12;
  if (ap === 'am' && h === 12) h = 0;
  return `${String(h).padStart(2, '0')}:${m[2]}:00`;
};
const pad = (n: number) => String(n).padStart(2, '0');
const hhmm = (d: Date) => `${pad(d.getHours())}:${pad(d.getMinutes())}`;
const ymd = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const fmtDay = (iso: string) => {
  const x = new Date(String(iso).slice(0, 10) + 'T00:00:00');
  return isNaN(x.getTime()) ? iso : x.toLocaleDateString('en-GB', { weekday: 'short', day: '2-digit', month: 'short', year: 'numeric' });
};
const STATUS_TABS = ['Confirmed', 'Pending', 'Cancelled'];
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

const TAG_CHIP_CLS: Record<TrainerTag, string> = {
  tpg: 'bg-purple-100 text-purple-700 dark:bg-purple-900/40 dark:text-purple-300',
  accepted: 'bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-300',
  lms: 'bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300',
};
const TrainerTagChip: React.FC<{ tag: TrainerTag }> = ({ tag }) => (
  <span title={TAG_LABELS[tag]} className={`text-[10px] uppercase px-1.5 py-0.5 rounded font-medium ${TAG_CHIP_CLS[tag]}`}>{TAG_SHORT[tag]}</span>
);

const InAppCalendar: React.FC = () => {
  const calRef = useRef<FullCalendar>(null);
  const { currentUser } = useLms();
  const currentUserEmail = currentUser?.email || '';

  const [rawEvents, setRawEvents] = useState<ClassDayEvent[]>([]);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [range, setRange] = useState<{ start: string; end: string } | null>(null);

  // Click-the-title month/year quick-jump.
  const [pickerOpen, setPickerOpen] = useState(false);
  const [viewYM, setViewYM] = useState<{ y: number; m: number }>(() => { const n = new Date(); return { y: n.getFullYear(), m: n.getMonth() }; });
  const jumpTo = (y: number, m: number) => { calRef.current?.getApi().gotoDate(new Date(y, m, 1)); setPickerOpen(false); };
  const pickerYears = useMemo(() => {
    const nowY = new Date().getFullYear();
    const s = new Set<number>(); for (let y = nowY - 5; y <= nowY + 5; y++) s.add(y); s.add(viewYM.y);
    return Array.from(s).sort((a, b) => a - b);
  }, [viewYM.y]);

  // Unified filters — every facet NARROWS; an empty facet imposes NO constraint. The default
  // shows "classes that are definitely happening" (Google-Calendar-like): Confirmed + a TPG
  // trainer + has learners + scheduled. "Show all" clears every facet.
  const [enabledStatuses, setEnabledStatuses] = useState<Set<string>>(new Set(['Confirmed']));
  const [trainerTags, setTrainerTags] = useState<Set<TrainerTag | 'none'>>(new Set<TrainerTag | 'none'>(['tpg']));
  const [learnerStates, setLearnerStates] = useState<Set<'has' | 'none'>>(new Set<'has' | 'none'>(['has']));
  const [scheduleStates, setScheduleStates] = useState<Set<'scheduled' | 'nosession'>>(new Set<'scheduled' | 'nosession'>(['scheduled']));
  const [trainerFilter, setTrainerFilter] = useState('');
  const [search, setSearch] = useState('');
  const [trainers, setTrainers] = useState<{ trainer_name: string }[]>([]);

  const [eventModal, setEventModal] = useState<EventModalState | null>(null);
  const eventModalRef = useRef<EventModalState | null>(null);
  useEffect(() => { eventModalRef.current = eventModal; }, [eventModal]);

  const [dragging, setDragging] = useState(false);
  // Page-level "parent" defaults — each reschedule/cancel step inherits these but
  // can override them in its confirmation.
  const [syncCalendar, setSyncCalendar] = useState(false);
  const [notifyAttendees, setNotifyAttendees] = useState(false);
  const [moveTarget, setMoveTarget] = useState<{ id: string; courseRunId: string; courseTitle: string; courseCode: string } | null>(null);
  // A translucent "where it's trying to go" preview shown while a reschedule is pending
  // (through the confirmation modals). The original event stays put until applied.
  const [pendingGhost, setPendingGhost] = useState<{ date: string; title: string; color: string } | null>(null);

  const [popup, setPopup] = useState<PopupState>({ open: false, type: 'success', title: '', message: '', confirmText: 'OK', cancelText: '' });
  const closePopup = () => setPopup((p) => ({ ...p, open: false }));
  const showConfirmPopup = (message: string, onConfirm: () => void, title = 'Confirm', confirmText = 'Confirm', cancelText = 'Cancel', onCancel?: () => void) =>
    setPopup({ open: true, type: 'confirm', title, message, confirmText, cancelText, onConfirm, onCancel });
  const showSuccessPopup = (message: string) => { setPendingGhost(null); setPopup({ open: true, type: 'success', title: 'Success', message, confirmText: 'OK', cancelText: '' }); };
  const showErrorPopup = (message: string) => { setPendingGhost(null); setPopup({ open: true, type: 'error', title: 'Error', message, confirmText: 'OK', cancelText: '' }); };

  // Standardized per-step confirm (Sync + Notify toggles + composer), shared with the Reschedule & Cancel page.
  const { confirm: showStepConfirm, node: stepConfirmNode } = useScheduleChangeConfirm();
  const { reschedulePrompt, rescheduleSession, rescheduleDay, cancelSession, cancelDay } = useSessionReschedule({ showConfirmPopup, showSuccessPopup, showErrorPopup, setBusy, showStepConfirm });

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch(getApiUrl('/api/admin/trainers'));
        const d = await res.json();
        if (d?.success) setTrainers(d.data?.trainers || []);
      } catch { /* non-fatal */ }
    })();
  }, []);

  const fetchRange = useCallback(async (startIso: string, endIso: string) => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ monthStart: startIso, monthEnd: endIso });
      const res = await fetch(getApiUrl(`/api/admin/classes-by-date?${params}`));
      const data = await res.json();
      setRawEvents(data?.success ? (data.data?.events || []) : []);
    } catch { setRawEvents([]); } finally { setLoading(false); }
  }, []);

  const handleDatesSet = useCallback((arg: DatesSetArg) => {
    const start = arg.startStr.slice(0, 10);
    const end = arg.endStr.slice(0, 10);
    setRange({ start, end });
    const cur = arg.view.currentStart;
    setViewYM({ y: cur.getFullYear(), m: cur.getMonth() });
    void fetchRange(start, end);
  }, [fetchRange]);

  const allEvents = useMemo<EventInput[]>(() => {
    const q = search.trim().toLowerCase();
    // Each facet NARROWS; an empty facet imposes no constraint. A run shows iff it passes all.
    const evs = rawEvents
      .filter((r) => enabledStatuses.size === 0 || enabledStatuses.has(r.classStatus))
      .filter((r) => {
        if (trainerTags.size === 0) return true;
        const tags = r.taggedTrainers || [];
        if (trainerTags.has('none') && tags.length === 0) return true;
        const wanted = Array.from(trainerTags).filter((t): t is TrainerTag => t !== 'none');
        return wanted.length > 0 && hasAnyTag(tags, wanted);
      })
      .filter((r) => {
        if (learnerStates.size === 0) return true;
        const has = (r.numLearners || 0) > 0;
        return (has && learnerStates.has('has')) || (!has && learnerStates.has('none'));
      })
      .filter((r) => {
        if (scheduleStates.size === 0) return true;
        return r.noSessions ? scheduleStates.has('nosession') : scheduleStates.has('scheduled');
      })
      .filter((r) => !trainerFilter || (r.taggedTrainers || []).some((t) => t.name === trainerFilter))
      .filter((r) => !q || r.courseTitle.toLowerCase().includes(q) || (r.courseRunId || '').toLowerCase().includes(q))
      .map((r) => {
        const t = to24h(r.startTime);
        const te = to24h(r.endTime);
        if (r.noSessions) {
          return {
            id: `${r.courseRunUuid}|nosession`,
            title: `${r.courseTitle} · (no sessions)`,
            start: r.sessionDate, allDay: true,
            editable: false, startEditable: false, durationEditable: false,
            classNames: ['fc-nosession'],
            backgroundColor: 'transparent', borderColor: '#94a3b8', textColor: '#94a3b8',
            extendedProps: { kind: 'runDay', ...r },
          } as EventInput;
        }
        return {
          id: `${r.courseRunUuid}|${r.sessionDate}`,
          title: `${r.courseTitle} · Day ${r.dayNumber}/${r.allSessionDates?.length || 1}`,
          start: t ? `${r.sessionDate}T${t}` : r.sessionDate,
          end: te ? `${r.sessionDate}T${te}` : undefined,
          allDay: !t,
          backgroundColor: colorFor(r.classStatus),
          borderColor: colorFor(r.classStatus),
          extendedProps: { kind: 'runDay', ...r },
        } as EventInput;
      });
    // Pending-move preview: translucent dashed block at the target while the
    // confirmation is open. The real event stays in its original cell until applied.
    if (pendingGhost) {
      evs.push({
        id: '__pending_ghost__',
        title: `${pendingGhost.title} (pending…)`,
        start: pendingGhost.date,
        allDay: true,
        editable: false,
        startEditable: false,
        durationEditable: false,
        classNames: ['fc-ghost-pending'],
        backgroundColor: 'transparent',
        borderColor: pendingGhost.color,
        textColor: pendingGhost.color,
        extendedProps: { kind: 'ghost' },
      } as EventInput);
    }
    return evs;
  }, [rawEvents, enabledStatuses, trainerTags, learnerStates, scheduleStates, trainerFilter, search, pendingGhost]);

  // ── Open the event details + sessions modal ─────────────────────────────────
  const openEventModal = useCallback(async (ev: ClassDayEvent) => {
    setEventModal({ run: { courseRunUuid: ev.courseRunUuid, courseRunId: ev.courseRunId, courseCode: ev.courseCode, courseTitle: ev.courseTitle, classStatus: ev.classStatus }, loading: true, taggedTrainers: ev.taggedTrainers || [], learners: [], sessions: [] });
    try {
      const [detRes, sesRes] = await Promise.all([
        fetch(getApiUrl(`/api/admin/class-details?courseRunId=${encodeURIComponent(ev.courseRunId)}`)).then((r) => r.json()).catch(() => null),
        fetch(getApiUrl(`/api/admin/class-sessions?courseRunId=${encodeURIComponent(ev.courseRunId)}`)).then((r) => r.json()).catch(() => null),
      ]);
      const d = detRes?.data;
      setEventModal((prev) => prev && {
        ...prev,
        loading: false,
        taggedTrainers: d?.taggedTrainers || ev.taggedTrainers || [],
        learners: d?.enrolledLearners || [],
        run: { ...prev.run, startDate: d?.operationalSummary?.startDate, endDate: d?.operationalSummary?.endDate },
        sessions: sesRes?.sessions || [],
      });
    } catch {
      setEventModal((prev) => prev && { ...prev, loading: false });
    }
    // Freshness: refresh THIS run's TPG assignment live (per-run, on-demand) and update the tags.
    try {
      const pr = await fetch(getApiUrl('/api/admin/pull-run-trainer'), {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ courseRunId: ev.courseRunId }),
      });
      const pd = await pr.json();
      if (pd?.success) {
        setEventModal((prev) => (prev && prev.run.courseRunId === ev.courseRunId) ? { ...prev, taggedTrainers: pd.taggedTrainers || prev.taggedTrainers } : prev);
      }
    } catch { /* keep cached tags */ }
    // If this was a "no sessions" run, viewing just synced its SSG sessions into local —
    // refresh the grid so it now renders as a normal scheduled block.
    if (ev.noSessions && range) void fetchRange(range.start, range.end);
  }, [range, fetchRange]);

  const refetchModalSessions = useCallback(async () => {
    const m = eventModalRef.current;
    if (!m) return;
    try {
      const r = await fetch(getApiUrl(`/api/admin/class-sessions?courseRunId=${encodeURIComponent(m.run.courseRunId)}`));
      const data = await r.json();
      setEventModal((prev) => prev && { ...prev, sessions: data?.sessions || [] });
    } catch { /* keep */ }
  }, []);

  // Create any missing Google Calendar events for this run's sessions (+ sync attendees), like the rescheduler.
  const [creatingEvents, setCreatingEvents] = useState(false);
  const createMissingEvents = useCallback(async () => {
    const m = eventModalRef.current;
    if (!m) return;
    setCreatingEvents(true);
    try {
      const r = await fetch(getApiUrl('/api/admin/reconcile-run-calendar'), {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ courseRunId: m.run.courseRunId }),
      });
      const j = await r.json();
      if (j?.success && j?.status === 'ok') showSuccessPopup(`Google Calendar updated — ${j.created ?? 0} event(s) created, ${j.attendeesAdded ?? 0} added, ${j.attendeesRemoved ?? 0} removed.`);
      else showErrorPopup(`Google Calendar not updated: ${j?.reason || j?.error || 'unknown'}`);
      await refetchModalSessions();
      if (range) void fetchRange(range.start, range.end);
    } catch (e) { showErrorPopup('Calendar sync failed: ' + (e instanceof Error ? e.message : 'unknown error')); }
    finally { setCreatingEvents(false); }
  }, [refetchModalSessions, range, fetchRange]);

  // Re-pull the open modal's learners + trainers (e.g. after the attendee reconcile changes the LMS roster).
  const refreshModalDetails = useCallback(async () => {
    const m = eventModalRef.current;
    if (!m) return;
    try {
      const r = await fetch(getApiUrl(`/api/admin/class-details?courseRunId=${encodeURIComponent(m.run.courseRunId)}`));
      const d = (await r.json())?.data;
      setEventModal((prev) => (prev && prev.run.courseRunId === m.run.courseRunId)
        ? { ...prev, run: { ...prev.run, classStatus: d?.classStatus || prev.run.classStatus }, taggedTrainers: d?.taggedTrainers || prev.taggedTrainers, learners: d?.enrolledLearners || prev.learners }
        : prev);
    } catch { /* keep */ }
  }, []);

  // Quick "assign a TPG-only trainer into the LMS" from the modal's Trainers list (confirm-gated).
  const handleEventClick = useCallback((arg: EventClickArg) => {
    const props: any = arg.event.extendedProps;
    if (props?.kind === 'runDay') void openEventModal(props as ClassDayEvent);
  }, [openEventModal]);

  // ── Grid drag: a run-day block → reschedule the whole day ───────────────────
  const handleRunDayDrop = useCallback(async (arg: any) => {
    const p: any = arg.event.extendedProps;
    if (p?.kind !== 'runDay' || !arg.event?.start) { arg.revert?.(); return; }
    const oldDate = p.sessionDate;
    const newDate = ymd(arg.event.start);
    arg.revert?.();
    if (oldDate === newDate) return;
    try {
      const res = await fetch(getApiUrl(`/api/admin/class-sessions?courseRunId=${encodeURIComponent(p.courseRunId)}`));
      const data = await res.json();
      const sessions: DrillSession[] = data?.sessions || [];
      const onDay = sessions.filter((s) => convertSsgDateToHtml(s.startDate || '') === oldDate);
      if (onDay.length === 0) { showErrorPopup('No sessions found on that day to move.'); return; }
      setPendingGhost({ date: newDate, title: `${p.courseTitle} · Day move`, color: colorFor(p.classStatus) });
      await rescheduleDay({
        courseRunId: p.courseRunId, courseReferenceNumber: p.courseCode, currentUserEmail, oldDate, newDate,
        sessionsOnDay: onDay.map((s) => ({ id: s.ssgSessionId || s.id, startDate: convertSsgDateToHtml(s.startDate || ''), endDate: convertSsgDateToHtml(s.endDate || s.startDate || ''), startTime: s.startTime || '', endTime: s.endTime || '', modeOfTraining: s.modeOfTraining ?? '', venue: s.venue })),
        allSessions: sessions.map((s) => ({ id: s.ssgSessionId || s.id, startDate: convertSsgDateToHtml(s.startDate || '') })),
        syncCalendar, notifyAttendees,
        onApplied: () => { setPendingGhost(null); if (range) void fetchRange(range.start, range.end); },
      });
    } catch (e: any) { showErrorPopup('Failed to reschedule the day: ' + (e?.message || 'unknown error')); }
    finally { setPendingGhost(null); }
  }, [rescheduleDay, currentUserEmail, syncCalendar, notifyAttendees, range, fetchRange]);

  // ── External drag: a session from the modal → reschedule that session ───────
  const sessionListRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!eventModal || !sessionListRef.current) return;
    const d = new Draggable(sessionListRef.current, {
      itemSelector: '.fc-ext-session, .fc-ext-day',
      eventData: (el) => ({ title: (el as HTMLElement).dataset.title || 'Session', duration: '01:00' }),
    });
    return () => d.destroy();
  }, [eventModal]);

  const handleExternalDrop = useCallback(async (info: any) => {
    const el: HTMLElement = info.draggedEl;
    const m = eventModalRef.current;
    if (!m) return;
    const newDate = String(info.dateStr || '').slice(0, 10);
    if (!newDate) return;

    // Whole-day row dropped → move every session on that day (mirrors the grid day-drag).
    const dayDate = el?.dataset?.dayDate;
    if (dayDate) {
      if (dayDate === newDate) return;
      const onDay = m.sessions.filter((x) => convertSsgDateToHtml(x.startDate || '') === dayDate);
      if (!onDay.length) return;
      setPendingGhost({ date: newDate, title: `${m.run.courseTitle} · Day move`, color: colorFor(m.run.classStatus) });
      await rescheduleDay({
        courseRunId: m.run.courseRunId, courseReferenceNumber: m.run.courseCode, currentUserEmail, oldDate: dayDate, newDate,
        sessionsOnDay: onDay.map((s) => ({ id: s.ssgSessionId || s.id, startDate: convertSsgDateToHtml(s.startDate || ''), endDate: convertSsgDateToHtml(s.endDate || s.startDate || ''), startTime: s.startTime || '', endTime: s.endTime || '', modeOfTraining: s.modeOfTraining ?? '', venue: s.venue })),
        allSessions: m.sessions.map((x) => ({ id: x.ssgSessionId || x.id, startDate: convertSsgDateToHtml(x.startDate || '') })),
        syncCalendar, notifyAttendees,
        onApplied: () => { setPendingGhost(null); void refetchModalSessions(); if (range) void fetchRange(range.start, range.end); },
      });
      setPendingGhost(null);
      return;
    }

    const sid = el?.dataset?.sessionId;
    if (!sid) return;
    const s = m.sessions.find((x) => String(x.ssgSessionId || x.id) === sid);
    if (!s) return;
    setPendingGhost({ date: newDate, title: `${m.run.courseTitle} · Session ${s.sessionNumber ?? ''}`.trim(), color: colorFor(m.run.classStatus) });
    await rescheduleSession({
      courseRunId: m.run.courseRunId, courseReferenceNumber: m.run.courseCode, currentUserEmail,
      session: { id: s.ssgSessionId || s.id, startDate: newDate, endDate: newDate, startTime: s.startTime || '', endTime: s.endTime || '', modeOfTraining: s.modeOfTraining ?? '', venue: s.venue },
      originalSession: { startDate: convertSsgDateToHtml(s.startDate || ''), startTime: s.startTime || '', endTime: s.endTime || '', modeOfTraining: s.modeOfTraining ?? '' },
      allSessions: m.sessions.map((x) => ({ id: x.ssgSessionId || x.id, startDate: convertSsgDateToHtml(x.startDate || '') })),
      syncCalendar, notifyAttendees,
      sessionLabel: `Session ${s.sessionNumber ?? ''}`.trim(),
      onApplied: () => { setPendingGhost(null); void refetchModalSessions(); if (range) void fetchRange(range.start, range.end); },
    });
    setPendingGhost(null);
  }, [rescheduleSession, rescheduleDay, currentUserEmail, syncCalendar, notifyAttendees, refetchModalSessions, range, fetchRange]);

  // Reschedule a session to an explicitly picked date — the reliable way to move
  // across months (drag, in any calendar, can only reach currently-visible cells).
  // Routes through the same confirm + notify-composer flow as drag.
  const rescheduleSessionToDate = useCallback(async (s: DrillSession, newDate: string) => {
    const m = eventModalRef.current;
    if (!m || !newDate) return;
    const cur = convertSsgDateToHtml(s.startDate || '');
    if (cur === newDate) return;
    setPendingGhost({ date: newDate, title: `${m.run.courseTitle} · Session ${s.sessionNumber ?? ''}`.trim(), color: colorFor(m.run.classStatus) });
    await rescheduleSession({
      courseRunId: m.run.courseRunId, courseReferenceNumber: m.run.courseCode, currentUserEmail,
      session: { id: s.ssgSessionId || s.id, startDate: newDate, endDate: newDate, startTime: s.startTime || '', endTime: s.endTime || '', modeOfTraining: s.modeOfTraining ?? '', venue: s.venue },
      originalSession: { startDate: cur, startTime: s.startTime || '', endTime: s.endTime || '', modeOfTraining: s.modeOfTraining ?? '' },
      allSessions: m.sessions.map((x) => ({ id: x.ssgSessionId || x.id, startDate: convertSsgDateToHtml(x.startDate || '') })),
      syncCalendar, notifyAttendees,
      sessionLabel: `Session ${s.sessionNumber ?? ''}`.trim(),
      onApplied: () => { setPendingGhost(null); void refetchModalSessions(); if (range) void fetchRange(range.start, range.end); },
    });
    setPendingGhost(null);
  }, [rescheduleSession, currentUserEmail, syncCalendar, notifyAttendees, refetchModalSessions, range, fetchRange]);

  // Reschedule an ENTIRE day to an explicitly picked date (the day counterpart of the
  // per-session date picker — reaches any month, unlike drag).
  const rescheduleDayToDate = useCallback(async (oldDate: string, items: DrillSession[], newDate: string) => {
    const m = eventModalRef.current;
    if (!m || !newDate || newDate === oldDate || !items.length) return;
    setPendingGhost({ date: newDate, title: `${m.run.courseTitle} · Day move`, color: colorFor(m.run.classStatus) });
    await rescheduleDay({
      courseRunId: m.run.courseRunId, courseReferenceNumber: m.run.courseCode, currentUserEmail, oldDate, newDate,
      sessionsOnDay: items.map((s) => ({ id: s.ssgSessionId || s.id, startDate: convertSsgDateToHtml(s.startDate || ''), endDate: convertSsgDateToHtml(s.endDate || s.startDate || ''), startTime: s.startTime || '', endTime: s.endTime || '', modeOfTraining: s.modeOfTraining ?? '', venue: s.venue })),
      allSessions: m.sessions.map((x) => ({ id: x.ssgSessionId || x.id, startDate: convertSsgDateToHtml(x.startDate || '') })),
      syncCalendar, notifyAttendees,
      onApplied: () => { setPendingGhost(null); void refetchModalSessions(); if (range) void fetchRange(range.start, range.end); },
    });
    setPendingGhost(null);
  }, [rescheduleDay, currentUserEmail, syncCalendar, notifyAttendees, refetchModalSessions, range, fetchRange]);

  // Hide modal while dragging a session out of it; restore on release (outside = cancel).
  const onSessionPointerDown = useCallback((e: React.PointerEvent) => {
    if (!(e.target as HTMLElement).closest('.fc-ext-session, .fc-ext-day')) return;
    const sx = e.clientX, sy = e.clientY;
    const move = (ev: PointerEvent) => { if (Math.abs(ev.clientX - sx) + Math.abs(ev.clientY - sy) > 6) { setDragging(true); window.removeEventListener('pointermove', move); } };
    const up = () => { window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up); setTimeout(() => setDragging(false), 0); };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  }, []);

  const cancelWholeDay = useCallback((date: string, items: DrillSession[]) => {
    const m = eventModalRef.current;
    if (!m || !items.length) return;
    void cancelDay({
      courseRunId: m.run.courseRunId, courseReferenceNumber: m.run.courseCode, currentUserEmail,
      date,
      sessionsOnDay: items.map((s) => ({ id: s.ssgSessionId || s.id, startDate: convertSsgDateToHtml(s.startDate || ''), endDate: convertSsgDateToHtml(s.endDate || s.startDate || ''), startTime: s.startTime || '', endTime: s.endTime || '', modeOfTraining: s.modeOfTraining ?? '', venue: s.venue })),
      syncCalendar, notifyAttendees,
      onApplied: () => { void refetchModalSessions(); if (range) void fetchRange(range.start, range.end); },
    });
  }, [cancelDay, currentUserEmail, syncCalendar, notifyAttendees, refetchModalSessions, range, fetchRange]);

  const cancelOneSession = useCallback((s: DrillSession) => {
    const m = eventModalRef.current;
    if (!m) return;
    void cancelSession({
      courseRunId: m.run.courseRunId, courseReferenceNumber: m.run.courseCode, currentUserEmail,
      session: { id: s.ssgSessionId || s.id, startDate: convertSsgDateToHtml(s.startDate || ''), endDate: convertSsgDateToHtml(s.endDate || s.startDate || ''), startTime: s.startTime || '', endTime: s.endTime || '', modeOfTraining: s.modeOfTraining ?? '', venue: s.venue },
      sessionLabel: `Session ${s.sessionNumber ?? ''}`.trim(), syncCalendar, notifyAttendees,
      onApplied: () => { void refetchModalSessions(); if (range) void fetchRange(range.start, range.end); },
    });
  }, [cancelSession, currentUserEmail, syncCalendar, notifyAttendees, refetchModalSessions, range, fetchRange]);

  const toggleStatus = (s: string) => setEnabledStatuses((prev) => { const n = new Set(prev); if (n.has(s)) n.delete(s); else n.add(s); return n; });
  const toggleTag = (t: TrainerTag | 'none') => setTrainerTags((prev) => { const n = new Set(prev); if (n.has(t)) n.delete(t); else n.add(t); return n; });
  const toggleLearner = (s: 'has' | 'none') => setLearnerStates((prev) => { const n = new Set(prev); if (n.has(s)) n.delete(s); else n.add(s); return n; });
  const toggleSchedule = (s: 'scheduled' | 'nosession') => setScheduleStates((prev) => { const n = new Set(prev); if (n.has(s)) n.delete(s); else n.add(s); return n; });
  // "Show all" = clear every facet (no constraints) → every class on every day.
  const showAll = () => { setEnabledStatuses(new Set()); setTrainerTags(new Set()); setLearnerStates(new Set()); setScheduleStates(new Set()); setTrainerFilter(''); setSearch(''); };
  const resetDefault = () => { setEnabledStatuses(new Set(['Confirmed'])); setTrainerTags(new Set<TrainerTag | 'none'>(['tpg'])); setLearnerStates(new Set<'has' | 'none'>(['has'])); setScheduleStates(new Set<'scheduled' | 'nosession'>(['scheduled'])); };
  const inputCls = 'border border-gray-300 dark:border-gray-600 rounded-md px-2 py-1 text-sm dark:bg-gray-700 dark:text-white';
  const chipCls = (active: boolean) => `px-2 py-1 rounded-md text-xs font-medium border transition-colors ${active ? 'bg-blue-600 text-white border-blue-600' : 'border-gray-300 dark:border-gray-600 text-gray-600 dark:text-gray-300 opacity-70'}`;

  // Group modal sessions by day.
  const sessionGroups = useMemo(() => {
    const out: { date: string; items: DrillSession[] }[] = [];
    for (const s of (eventModal?.sessions || [])) {
      const d = convertSsgDateToHtml(s.startDate || '') || '—';
      const g = out.find((x) => x.date === d);
      if (g) g.items.push(s); else out.push({ date: d, items: [s] });
    }
    return out;
  }, [eventModal]);

  return (
    <div className="space-y-3">
      <style jsx global>{`
        .fc-tms .fc-col-header-cell-cushion, .fc-tms .fc-daygrid-day-number { color: #374151; text-decoration: none; }
        .fc-tms .fc-daygrid-more-link { color: #2563eb; }
        .fc-tms.is-dragging .fc-popover { display: none !important; }
        /* Title is a clickable month/year quick-jump. */
        .fc-tms .fc-toolbar-title { cursor: pointer; }
        .fc-tms .fc-toolbar-title:hover { text-decoration: underline; }
        .fc-tms .fc-toolbar-title::after { content: ' ▾'; font-size: 0.7em; opacity: 0.55; vertical-align: middle; }
        /* Make adjacent-month days clearly droppable (Google-style cross-month drop). */
        .fc-tms .fc-day-other .fc-daygrid-day-top { opacity: 0.75; }

        /* Pending-move preview block (translucent + dashed, non-interactive). */
        .fc-tms .fc-ghost-pending { opacity: 0.85; pointer-events: none; border-style: dashed !important; border-width: 2px !important;
          background: repeating-linear-gradient(45deg, rgba(148,163,184,0.18), rgba(148,163,184,0.18) 5px, transparent 5px, transparent 10px) !important; }
        .fc-tms .fc-ghost-pending .fc-event-title { font-style: italic; }

        /* No-session run block (dashed grey all-day marker). */
        .fc-tms .fc-nosession { border-style: dashed !important; opacity: 0.9;
          background: repeating-linear-gradient(45deg, rgba(148,163,184,0.10), rgba(148,163,184,0.10) 5px, transparent 5px, transparent 10px) !important; }
        .fc-tms .fc-nosession .fc-event-title { font-style: italic; }

        /* Grid dark theme (scoped to the calendar container). Duplicate selectors
           instead of :is() — styled-jsx is unreliable with :is() in some builds. */
        [data-theme='dark'] .fc-tms, .dark .fc-tms {
          --fc-border-color: #334155; --fc-page-bg-color: #1e293b; --fc-neutral-bg-color: #0f172a;
          --fc-today-bg-color: rgba(59,130,246,0.14); --fc-list-event-hover-bg-color: #334155; color: #e5e7eb;
        }
        [data-theme='dark'] .fc-tms .fc-col-header-cell, .dark .fc-tms .fc-col-header-cell { background: #0f172a; }
        [data-theme='dark'] .fc-tms .fc-col-header-cell-cushion, .dark .fc-tms .fc-col-header-cell-cushion { color: #e5e7eb; }
        [data-theme='dark'] .fc-tms .fc-daygrid-day-number, .dark .fc-tms .fc-daygrid-day-number { color: #cbd5e1; }
        [data-theme='dark'] .fc-tms .fc-toolbar-title, .dark .fc-tms .fc-toolbar-title { color: #f1f5f9; }
        [data-theme='dark'] .fc-tms .fc-daygrid-more-link, .dark .fc-tms .fc-daygrid-more-link { color: #93c5fd; }

        /* "+ N more" day popover — FullCalendar renders it OUTSIDE .fc-tms, so it
           never inherits the dark --fc vars above. Target it globally + !important. */
        [data-theme='dark'] .fc-popover, .dark .fc-popover { background: #1e293b !important; border-color: #334155 !important; color: #e5e7eb !important; box-shadow: 0 12px 28px rgba(0,0,0,0.55); }
        [data-theme='dark'] .fc-popover .fc-popover-body, .dark .fc-popover .fc-popover-body { background: #1e293b !important; }
        [data-theme='dark'] .fc-popover .fc-popover-header, .dark .fc-popover .fc-popover-header { background: #0f172a !important; }
        [data-theme='dark'] .fc-popover .fc-popover-title, .dark .fc-popover .fc-popover-title { color: #f1f5f9 !important; }
        [data-theme='dark'] .fc-popover .fc-icon, .dark .fc-popover .fc-icon { color: #e5e7eb !important; }
        [data-theme='dark'] .fc-popover .fc-event-title, .dark .fc-popover .fc-event-title,
        [data-theme='dark'] .fc-popover .fc-event-time, .dark .fc-popover .fc-event-time,
        [data-theme='dark'] .fc-popover a, .dark .fc-popover a { color: #e5e7eb !important; }
      `}</style>

      {/* Filters — every facet NARROWS; an empty facet = no limit. "Show all" clears everything. */}
      <div className="flex items-center gap-x-3 gap-y-2 flex-wrap">
        <div className="flex items-center gap-1">
          <span className="text-xs text-gray-500 dark:text-gray-400">Status:</span>
          {STATUS_TABS.map((s) => (
            <button key={s} type="button" onClick={() => toggleStatus(s)}
              className={`px-2 py-1 rounded-md text-xs font-medium border transition-colors ${enabledStatuses.has(s) ? 'bg-white dark:bg-gray-900 border-gray-300 dark:border-gray-600 shadow-sm' : 'border-transparent opacity-50'}`}
              style={enabledStatuses.has(s) ? { color: colorFor(s) } : undefined}>{s}</button>
          ))}
        </div>
        <div className="flex items-center gap-1" title="Show runs whose trainer carries a selected tag. 'None' = runs with no trainer.">
          <span className="text-xs text-gray-500 dark:text-gray-400">Trainer:</span>
          {(['tpg', 'accepted', 'lms'] as TrainerTag[]).map((tag) => (
            <button key={tag} type="button" onClick={() => toggleTag(tag)} title={TAG_LABELS[tag]} className={chipCls(trainerTags.has(tag))}>{TAG_SHORT[tag]}</button>
          ))}
          <button type="button" onClick={() => toggleTag('none')} title="Runs with no trainer" className={chipCls(trainerTags.has('none'))}>None</button>
        </div>
        <div className="flex items-center gap-1">
          <span className="text-xs text-gray-500 dark:text-gray-400">Learners:</span>
          <button type="button" onClick={() => toggleLearner('has')} className={chipCls(learnerStates.has('has'))}>Has</button>
          <button type="button" onClick={() => toggleLearner('none')} className={chipCls(learnerStates.has('none'))}>None</button>
        </div>
        <div className="flex items-center gap-1">
          <span className="text-xs text-gray-500 dark:text-gray-400">Sessions:</span>
          <button type="button" onClick={() => toggleSchedule('scheduled')} className={chipCls(scheduleStates.has('scheduled'))}>Scheduled</button>
          <button type="button" onClick={() => toggleSchedule('nosession')} title="Runs with no scheduled sessions" className={chipCls(scheduleStates.has('nosession'))}>No sessions</button>
        </div>
        <div className="flex items-center gap-1">
          <button type="button" onClick={showAll} title="Clear all filters — show every class on every day" className="px-2 py-1 rounded-md text-xs font-medium border border-blue-300 dark:border-blue-700 text-blue-700 dark:text-blue-300 hover:bg-blue-50 dark:hover:bg-blue-900/20">Show all</button>
          <button type="button" onClick={resetDefault} title="Back to the default 'definitely happening' view" className="px-2 py-1 rounded-md text-xs text-gray-500 dark:text-gray-400 hover:underline">Default</button>
        </div>
        <select value={trainerFilter} onChange={(e) => setTrainerFilter(e.target.value)} className={inputCls}>
          <option value="">All trainers</option>
          {trainers.map((t, i) => <option key={t.trainer_name || i} value={t.trainer_name}>{t.trainer_name}</option>)}
        </select>
        <input type="text" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search title / run id…" className={`${inputCls} flex-1 min-w-[160px]`} />
        <label
          className="flex items-center gap-1.5 text-xs text-gray-700 dark:text-gray-300 cursor-pointer select-none whitespace-nowrap"
          title="Default for each reschedule/cancel. When on, changes also update the matching Google Calendar event. You can change this for each action.">
          <input type="checkbox" checked={syncCalendar} onChange={(e) => setSyncCalendar(e.target.checked)} className="h-4 w-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500" /> Sync Google Calendar
        </label>
        <label
          className="flex items-center gap-1.5 text-xs text-gray-700 dark:text-gray-300 cursor-pointer select-none whitespace-nowrap"
          title="Default for each reschedule/cancel. When on, the confirmation opens the email ready to send to the learners and trainer. You can change this for each action.">
          <input type="checkbox" checked={notifyAttendees} onChange={(e) => setNotifyAttendees(e.target.checked)} className="h-4 w-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500" /> Notify attendees
        </label>
        {(loading || busy) && <span className="text-xs text-blue-600 dark:text-blue-400 flex items-center gap-1"><span className="animate-spin rounded-full h-3 w-3 border-b-2 border-blue-500" /> {busy ? 'working…' : 'loading…'}</span>}
      </div>

      <div className={`relative bg-white dark:bg-slate-800 rounded-lg border border-gray-200 dark:border-gray-700 p-3 fc-tms ${dragging ? 'is-dragging' : ''}`}
        onClick={(e) => { if ((e.target as HTMLElement).closest('.fc-toolbar-title')) setPickerOpen((o) => !o); }}>
        {/* Month/year quick-jump (click the title) */}
        {pickerOpen && (
          <>
            <div className="fixed inset-0 z-20" onClick={() => setPickerOpen(false)} />
            <div className="absolute z-30 left-1/2 -translate-x-1/2 top-14 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg shadow-xl p-3 flex items-center gap-2">
              <select value={viewYM.m} onChange={(e) => jumpTo(viewYM.y, Number(e.target.value))} className={inputCls}>
                {MONTHS.map((mn, i) => <option key={mn} value={i}>{mn}</option>)}
              </select>
              <select value={viewYM.y} onChange={(e) => jumpTo(Number(e.target.value), viewYM.m)} className={inputCls}>
                {pickerYears.map((y) => <option key={y} value={y}>{y}</option>)}
              </select>
              <button type="button" onClick={() => { calRef.current?.getApi().today(); setPickerOpen(false); }}
                className="px-2 py-1 text-xs rounded-md border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-700">Today</button>
            </div>
          </>
        )}
        <FullCalendar
          ref={calRef}
          plugins={[dayGridPlugin, timeGridPlugin, listPlugin, interactionPlugin]}
          initialView="dayGridMonth"
          headerToolbar={{ left: 'prev,next today', center: 'title', right: 'dayGridMonth,timeGridWeek,timeGridDay,listWeek' }}
          events={allEvents}
          eventClick={handleEventClick}
          datesSet={handleDatesSet}
          editable
          eventStartEditable
          eventDurationEditable={false}
          droppable
          eventDragStart={() => setDragging(true)}
          eventDragStop={() => setDragging(false)}
          eventDrop={handleRunDayDrop}
          drop={handleExternalDrop}
          eventReceive={(info) => info.event.remove()}
          height="auto"
          timeZone="local"
          nowIndicator
          fixedWeekCount
          showNonCurrentDates
          dayMaxEvents={4}
          eventTimeFormat={{ hour: '2-digit', minute: '2-digit', hour12: false }}
        />
      </div>
      <p className="text-xs text-gray-400">Drag a day to reschedule it, or click a class to see details and move single sessions (use a session's <strong>date picker</strong> to reach another month). By default this shows classes that are <strong>going ahead</strong> (confirmed, with a trainer, learners and scheduled dates). Each filter narrows the view; <strong>Show all</strong> shows everything.</p>
      <p className="text-xs text-gray-400 leading-relaxed">
        <span className="font-medium text-gray-500 dark:text-gray-300">Sync Google Calendar</span>: also move/remove the matching Google Calendar event when you apply a change (off = SSG/LMS only).{' '}
        <span className="font-medium text-gray-500 dark:text-gray-300">Notify attendees</span>: offered inside each reschedule/cancel confirmation — tick it there to review &amp; edit the email and pick which attendees receive it. Both only ever act on your explicit confirmation — never automatically.
      </p>

      {/* Drag hint */}
      {dragging && (
        <div className="fixed top-4 left-1/2 -translate-x-1/2 z-[60] px-4 py-2 rounded-full bg-amber-500 text-white text-sm font-medium shadow-lg pointer-events-none">
          Drop on any visible day to reschedule · for another month, use a session's date picker · release outside the calendar to cancel
        </div>
      )}

      {/* Event details + sessions modal (hidden while dragging so the grid is reachable) */}
      {eventModal && (
        <div className={`fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4 ${dragging ? 'hidden' : ''}`}>
          <div className="bg-white dark:bg-gray-800 rounded-lg shadow-xl max-w-2xl w-full border dark:border-gray-700 max-h-[88vh] overflow-auto">
            <div className="p-4 border-b border-gray-200 dark:border-gray-700 flex items-start justify-between gap-3">
              <div className="min-w-0">
                <h3 className="text-lg font-semibold text-gray-900 dark:text-white truncate">{eventModal.run.courseTitle}</h3>
                <p className="text-xs text-gray-500 dark:text-gray-400">
                  {eventModal.run.courseCode} · run {eventModal.run.courseRunId}
                  {eventModal.run.startDate ? ` · ${eventModal.run.startDate}${eventModal.run.endDate ? `–${eventModal.run.endDate}` : ''}` : ''}
                  {' · '}<span style={{ color: colorFor(eventModal.run.classStatus) }}>{eventModal.run.classStatus}</span>
                </p>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                <button type="button" onClick={() => setMoveTarget({ id: eventModal.run.courseRunUuid, courseRunId: eventModal.run.courseRunId, courseTitle: eventModal.run.courseTitle, courseCode: eventModal.run.courseCode })}
                  className="px-2 py-1 rounded-md text-xs font-medium bg-blue-600 text-white hover:bg-blue-700">Move class to another course run</button>
                <button type="button" onClick={() => setEventModal(null)} className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 text-xl leading-none">×</button>
              </div>
            </div>

            <div className="p-4 space-y-4">
              {eventModal.loading ? (
                <div className="text-sm text-gray-500 dark:text-gray-400 flex items-center gap-2"><span className="animate-spin rounded-full h-4 w-4 border-b-2 border-blue-500" /> Loading…</div>
              ) : (
                <>
                  {/* Trainers — tagged list (TMS-LMS / Accepted Email / Assigned in TPG) */}
                  <div>
                    <h4 className="text-sm font-semibold text-gray-900 dark:text-white mb-1">Trainer{eventModal.taggedTrainers.length === 1 ? '' : 's'} ({eventModal.taggedTrainers.length})</h4>
                    {eventModal.taggedTrainers.length > 0 ? (
                      <ul className="text-sm divide-y divide-gray-100 dark:divide-gray-800 border border-gray-200 dark:border-gray-700 rounded-md">
                        {eventModal.taggedTrainers.map((t, i) => (
                          <li key={i} className="px-3 py-1.5 flex items-center justify-between gap-2">
                            <span className="min-w-0 truncate text-gray-800 dark:text-gray-200">{t.name}</span>
                            <span className="flex items-center gap-1.5 shrink-0">
                              {t.tags.map((tag) => <TrainerTagChip key={tag} tag={tag} />)}
                              <span className="text-gray-500 dark:text-gray-400 text-xs max-w-[40%] truncate">{t.email || '—'}</span>
                            </span>
                          </li>
                        ))}
                      </ul>
                    ) : <div className="text-sm text-gray-400 border border-dashed border-gray-200 dark:border-gray-700 rounded-md px-3 py-1.5">No trainer assigned.</div>}
                  </div>

                  {/* Learners */}
                  <div>
                    <h4 className="text-sm font-semibold text-gray-900 dark:text-white mb-1">Learners ({eventModal.learners.length})</h4>
                    {eventModal.learners.length > 0 ? (
                      <div className="max-h-32 overflow-auto border border-gray-200 dark:border-gray-700 rounded-md divide-y divide-gray-100 dark:divide-gray-800">
                        {eventModal.learners.map((l, i) => (
                          <div key={i} className="px-3 py-1.5 text-sm flex items-center justify-between"><span className="text-gray-800 dark:text-gray-200">{l.learnerName}</span><span className="text-gray-500 dark:text-gray-400">{l.learnerEmail}</span></div>
                        ))}
                      </div>
                    ) : <div className="text-sm text-gray-400 border border-dashed border-gray-200 dark:border-gray-700 rounded-md px-3 py-1.5">No learners enrolled.</div>}
                  </div>

                  {/* Sessions grouped by day — draggable onto the calendar */}
                  <div ref={sessionListRef} onPointerDown={onSessionPointerDown}>
                    <div className="flex items-center justify-between gap-2 mb-1">
                      <h4 className="text-sm font-semibold text-gray-900 dark:text-white">Sessions ({eventModal.sessions.length})</h4>
                      <button type="button" onClick={() => void createMissingEvents()} disabled={creatingEvents}
                        className="text-xs px-2 py-1 rounded-md border border-blue-300 dark:border-blue-700 text-blue-700 dark:text-blue-300 hover:bg-blue-50 dark:hover:bg-blue-900/20 disabled:opacity-50 whitespace-nowrap"
                        title="Add Google Calendar events for any sessions that don't have one (and update attendees)">{creatingEvents ? 'Creating…' : '🗓️ Create missing calendar events'}</button>
                    </div>
                    <p className="text-xs text-gray-400 mb-2">Drag a session (or the whole-day row) onto a day to reschedule — or use the <strong>date picker</strong> on a day or session to move it to any month · ✕ cancels.</p>
                    {sessionGroups.length === 0 ? (
                      <div className="text-sm text-gray-400">No sessions found.</div>
                    ) : (
                      <div className="space-y-2">
                        {sessionGroups.map((g) => (
                          <div key={g.date} className="rounded-md border border-gray-200 dark:border-gray-700 overflow-hidden">
                            <div className="px-3 py-1.5 bg-gray-100 dark:bg-gray-800 text-xs font-medium text-gray-700 dark:text-gray-200 flex items-center justify-between gap-2">
                              <span className="flex items-center gap-2 min-w-0">
                                {/* Drag the whole-day row onto a calendar day to move every session on this day. */}
                                <span className="fc-ext-day cursor-grab active:cursor-grabbing rounded px-1 -mx-1 hover:bg-blue-50 dark:hover:bg-blue-900/20 whitespace-nowrap"
                                  data-day-date={g.date} data-title={`${eventModal.run.courseTitle} · ${fmtDay(g.date)} (${g.items.length} session${g.items.length === 1 ? '' : 's'})`}
                                  title="Drag onto a day to reschedule ALL sessions on this day">
                                  📅 {fmtDay(g.date)} · {g.items.length} session{g.items.length === 1 ? '' : 's'}
                                </span>
                                {(() => {
                                  const link = g.items.find((it) => it.calendarMatched && it.calendarLink)?.calendarLink;
                                  const matched = g.items.some((it) => it.calendarMatched);
                                  return link ? (
                                    <a href={link} target="_blank" rel="noopener noreferrer" onPointerDown={(e) => e.stopPropagation()}
                                      className="text-[11px] font-normal text-green-600 dark:text-green-400 hover:underline whitespace-nowrap" title="Opens under the class calendar's Google account">On calendar ↗</a>
                                  ) : matched ? (
                                    <span className="text-[11px] font-normal text-green-600 dark:text-green-400 whitespace-nowrap">On calendar</span>
                                  ) : (
                                    <span className="text-[11px] font-normal text-amber-600 dark:text-amber-400 whitespace-nowrap">Not on calendar</span>
                                  );
                                })()}
                              </span>
                              <span className="flex items-center gap-2 shrink-0">
                                <input type="date" defaultValue={g.date} onPointerDown={(e) => e.stopPropagation()}
                                  onChange={(e) => { const v = e.target.value; if (v) void rescheduleDayToDate(g.date, g.items, v); }}
                                  className="text-xs border border-gray-300 dark:border-gray-600 rounded px-1 py-0.5 dark:bg-gray-700 dark:text-white w-36" title="Reschedule the whole day to any date (works across months)" />
                                <button type="button" onClick={() => cancelWholeDay(g.date, g.items)} className="text-xs text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/20 rounded px-1.5 py-0.5 w-32 text-left whitespace-nowrap" title="Cancel all sessions on this day">✕ Cancel day</button>
                              </span>
                            </div>
                            <ul>
                              {g.items.map((s, i) => {
                                const sid = String(s.ssgSessionId || s.id || i);
                                const label = `${eventModal.run.courseTitle} · Session ${s.sessionNumber ?? i + 1}`;
                                return (
                                  <li key={sid} className="flex items-center justify-between px-3 py-2 text-sm border-t border-gray-100 dark:border-gray-800">
                                    {/* Only this label is the draggable item, so the drag mirror shows just the session info. */}
                                    <span className="fc-ext-session flex-1 min-w-0 rounded px-1 -mx-1 cursor-grab active:cursor-grabbing hover:bg-blue-50 dark:hover:bg-blue-900/20 text-gray-800 dark:text-gray-200"
                                      data-session-id={sid} data-title={label} title="Drag onto a day to reschedule">
                                      Session {s.sessionNumber ?? i + 1}
                                      <span className="text-gray-500 dark:text-gray-400"> · {s.startTime || '—'}{s.endTime ? `–${s.endTime}` : ''}{s.modeOfTraining ? ` · ${getModeLabel(s.modeOfTraining).replace(/^\d+\s*-\s*/, '')}` : ''}</span>
                                    </span>
                                    <span className="flex items-center gap-2 ml-2 shrink-0">
                                      <input type="date" defaultValue={convertSsgDateToHtml(s.startDate || '')} onPointerDown={(e) => e.stopPropagation()}
                                        onChange={(e) => { const v = e.target.value; if (v) void rescheduleSessionToDate(s, v); }}
                                        className="text-xs border border-gray-300 dark:border-gray-600 rounded px-1 py-0.5 dark:bg-gray-700 dark:text-white w-36" title="Reschedule to any date (works across months)" />
                                      <button type="button" onPointerDown={(e) => e.stopPropagation()} onClick={() => cancelOneSession(s)} className="text-xs text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/20 rounded px-1.5 py-0.5 w-32 text-left whitespace-nowrap" title="Cancel this session">✕ Cancel session</button>
                                    </span>
                                  </li>
                                );
                              })}
                            </ul>
                          </div>
                        ))}
                      </div>
                    )}
                    <p className="text-xs text-gray-400 mt-2">Shows the LMS (local) trainer/enrolment. Rescheduling pushes to SSG; cancelling deletes the session from SSG.</p>
                  </div>

                  {/* Google Calendar attendees — view + confirmation-gated adjust */}
                  <div className="pt-2 border-t border-gray-200 dark:border-gray-700">
                    <CalendarAttendeesPanel
                      courseRunId={eventModal.run.courseRunId}
                      calendarSync={syncCalendar}
                      onChanged={() => { void refreshModalDetails(); if (range) void fetchRange(range.start, range.end); }}
                    />
                  </div>
                </>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Move class to another run */}
      {moveTarget && (
        <MoveClassModal run={moveTarget} defaultSyncCalendar={syncCalendar} defaultNotify={notifyAttendees}
          onClose={() => setMoveTarget(null)}
          onDone={() => { setEventModal(null); if (range) void fetchRange(range.start, range.end); }}
          showConfirmPopup={showConfirmPopup} showSuccessPopup={showSuccessPopup} showErrorPopup={showErrorPopup} />
      )}

      {/* Calendar-resolution modal (shared, calendar choice only) */}
      <SessionRescheduleModal prompt={reschedulePrompt} />

      {/* Standardized step confirmation (Sync + Notify toggles + email composer) */}
      {stepConfirmNode}

      {/* Pending overlay while a reschedule/cancel/sync is in flight */}
      <ProcessingOverlay show={busy} />

      {/* Popup (confirm / success / error) */}
      {popup.open && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-[55] p-4">
          <div className="bg-white dark:bg-gray-800 rounded-lg shadow-xl w-full max-w-lg border dark:border-gray-700 p-6 max-h-[90vh] overflow-auto">
            <h3 className={`text-lg font-semibold mb-2 ${popup.type === 'error' ? 'text-red-700 dark:text-red-400' : 'text-gray-900 dark:text-white'}`}>{popup.title}</h3>
            <p className="text-sm text-gray-600 dark:text-gray-300 mb-4 whitespace-pre-line">{popup.message}</p>
            <div className="flex justify-end gap-2">
              {popup.type === 'confirm' && popup.cancelText && (
                <button type="button" onClick={() => { const fn = popup.onCancel; closePopup(); setPendingGhost(null); fn?.(); }} className="px-4 py-2 text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-md">{popup.cancelText}</button>
              )}
              <button type="button"
                onClick={() => { const fn = popup.onConfirm; closePopup(); if (popup.type === 'confirm' && fn) fn(); }}
                className={`px-4 py-2 rounded-md text-white ${popup.type === 'error' ? 'bg-red-600 hover:bg-red-700' : 'bg-blue-600 hover:bg-blue-700'}`}>{popup.confirmText}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default InAppCalendar;
