/**
 * useSessionReschedule — shared orchestration for rescheduling and cancelling SSG
 * course-run SESSIONS. Used by BOTH the Edit Class → Sessions tab and the
 * top-level "Reschedule & Cancel" page, so the SSG write flow, the up-front
 * Google-Calendar conflict resolution, and the opt-in calendar reconcile stay
 * identical everywhere.
 *
 *  - rescheduleSession : move one session to a new date/time/mode.
 *  - rescheduleDay     : move EVERY session on a given day to a new date (times kept).
 *  - cancelSession     : delete one session from SSG (two-step warning).
 *
 * Calendar writes are OPT-IN (syncCalendar) and the underlying helpers use
 * sendUpdates:'none'.
 */
import { useState } from 'react';
import { getApiUrl } from '@/lib/urlHelpers';
import {
  buildUpdateSessionsPayload,
  buildDeleteSessionPayload,
  computeRunWindow,
  convertSsgDateToHtml,
  getModeLabel,
  type EditableSession,
  type RunFormOverrides,
} from '@/lib/ssg/sessionEditHelpers';

export interface ReschedulePromptState {
  eventId: string;
  htmlLink: string | null;
  liveDate: string;
  oldDate: string;
  newDate: string;
  onChoose: (action: 'reuse' | 'replace' | 'keepNew') => void;
  onCancel: () => void;
}

interface PopupCallbacks {
  showConfirmPopup: (message: string, onConfirm: () => void, title?: string, confirmLabel?: string, cancelLabel?: string) => void;
  showSuccessPopup: (message: string) => void;
  showErrorPopup: (message: string) => void;
  setBusy?: (busy: boolean) => void;
}

interface CommonArgs {
  courseRunId: string;
  courseReferenceNumber: string;
  currentUserEmail: string;
  runData?: any;
  overrides?: RunFormOverrides;
  onApplied?: () => void;
}

export interface RescheduleArgs extends CommonArgs {
  session: EditableSession;
  originalSession?: { startDate: string; startTime?: string; endTime?: string; modeOfTraining?: string | number } | null;
  allSessions: EditableSession[];
  syncCalendar: boolean;
  sessionLabel?: string;
}

export interface RescheduleDayArgs extends CommonArgs {
  /** YYYY-MM-DD of the day being moved. */
  oldDate: string;
  /** YYYY-MM-DD target date. */
  newDate: string;
  /** Every session currently on `oldDate` (their times/modes are preserved). */
  sessionsOnDay: EditableSession[];
  allSessions: EditableSession[];
  syncCalendar: boolean;
}

export interface CancelArgs extends CommonArgs {
  session: EditableSession;
  sessionLabel?: string;
  syncCalendar?: boolean;
}

const fmtD = (iso: string) => {
  if (!iso) return 'N/A';
  const d = new Date(iso + 'T00:00:00');
  return isNaN(d.getTime()) ? iso : d.toLocaleDateString('en-GB', { weekday: 'short', day: '2-digit', month: 'short', year: 'numeric' });
};
const fmtShort = (iso: string) => {
  const d = new Date(iso + 'T00:00:00');
  return isNaN(d.getTime()) ? iso : d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short' });
};
const fmtRange = (a: string, b: string) => {
  const da = new Date(a + 'T00:00:00'), db = new Date(b + 'T00:00:00');
  if (isNaN(da.getTime()) || isNaN(db.getTime())) return `${a} – ${b}`;
  const sameMY = da.getMonth() === db.getMonth() && da.getFullYear() === db.getFullYear();
  return sameMY
    ? `${da.getDate()}–${db.getDate()} ${db.toLocaleDateString('en-GB', { month: 'short', year: 'numeric' })}`
    : `${da.toLocaleDateString('en-GB', { day: '2-digit', month: 'short' })} – ${db.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })}`;
};

export function useSessionReschedule(cb: PopupCallbacks) {
  const [reschedulePrompt, setReschedulePrompt] = useState<ReschedulePromptState | null>(null);
  const busy = (b: boolean) => cb.setBusy?.(b);

  const fetchRunDetail = async (runId: string): Promise<any | null> => {
    try {
      const params = new URLSearchParams({ runId, includeExpired: 'false' });
      const res = await fetch(`/api/ssg/courses?${params}`, { headers: { 'Content-Type': 'application/json' } });
      const data = await res.json();
      return data?.data?.course?.run ?? null;
    } catch { return null; }
  };
  const resolveRun = async (args: CommonArgs): Promise<any | null> => {
    if (args.runData?.courseStartDate || args.runData?.courseDates || args.runData?.venue) return args.runData;
    return fetchRunDetail(args.courseRunId);
  };

  /**
   * Core: push an update for one or more sessions to SSG, reflect to local DB,
   * and (opt-in) reconcile the calendar — with the up-front "event dragged off
   * its day" resolution prompt when the old day empties.
   */
  const runUpdate = async (p: {
    courseRunId: string; courseReferenceNumber: string; currentUserEmail: string;
    runData: any; overrides?: RunFormOverrides;
    sessionsToUpdate: EditableSession[];  // carry NEW values
    oldDate: string; newDate: string;
    allSessions: EditableSession[];
    syncCalendar: boolean;
    confirmTitle: string; confirmMessage: string;
    onApplied?: () => void;
  }) => {
    // New window = encompass all updated sessions' new dates.
    const newStarts = p.sessionsToUpdate.map((s) => convertSsgDateToHtml(s.startDate || '')).filter(Boolean).sort();
    const newEnds = p.sessionsToUpdate.map((s) => convertSsgDateToHtml(s.endDate || s.startDate || '')).filter(Boolean).sort();
    const spanStart = newStarts[0] || '';
    const spanEnd = newEnds[newEnds.length - 1] || spanStart;
    const { newRunStart, newRunEnd } = computeRunWindow(p.runData, p.overrides || {}, spanStart, spanEnd);

    const requestBody = buildUpdateSessionsPayload({
      courseReferenceNumber: p.courseReferenceNumber, runData: p.runData, sessions: p.sessionsToUpdate,
      currentUserEmail: p.currentUserEmail, overrides: p.overrides, newRunStart, newRunEnd,
    });

    const updatedIds = new Set(p.sessionsToUpdate.map((s) => s.id));
    const dateChanged = !!(p.oldDate && p.newDate && p.oldDate !== p.newDate);
    const othersOnOldDate = dateChanged
      ? p.allSessions.filter((s) => !updatedIds.has(s.id) && convertSsgDateToHtml(s.startDate || '') === p.oldDate).length
      : 0;

    const doApply = async (resolution?: { eventId: string; action: 'reuse' | 'replace' | 'keepNew'; newDate: string }) => {
      try {
        busy(true);
        const response = await fetch(`/api/ssg/courses/courseRuns/${p.courseRunId}?includeExpiredCourses=false&action=update-sessions`, {
          method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(requestBody),
        });
        if (!response.ok) throw new Error(`HTTP error! status: ${response.status}, message: ${await response.text()}`);
        await response.json();

        const extras: string[] = [];
        try {
          const sresp = await fetch(`/api/ssg/courses/runs/${p.courseRunId}/sessions?courseCode=${encodeURIComponent(p.courseReferenceNumber)}`);
          const sdata = await sresp.json();
          const fresh = sdata?.data?.result?.sessions || [];
          if (fresh.length) {
            await fetch(getApiUrl('/api/admin/course-sessions/sync-from-ssg'), {
              method: 'POST', headers: { 'Content-Type': 'application/json' },
              // Also reflect the (possibly widened) run window so local course_run never drifts from SSG.
              body: JSON.stringify({ courseRunId: p.courseRunId, sessions: fresh, courseStartDate: newRunStart, courseEndDate: newRunEnd }),
            });
            extras.push('local DB synced');
          }
        } catch { extras.push('local DB sync failed'); }

        if (p.syncCalendar) {
          try {
            const mresp = await fetch(getApiUrl('/api/admin/reconcile-run-calendar'), {
              method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ courseRunId: p.courseRunId, resolution }),
            });
            const mdata = await mresp.json();
            if (mdata?.success && mdata?.status === 'ok') extras.push(`calendar reconciled (created ${mdata.created ?? 0}, removed ${mdata.removedStale ?? 0})`);
            else extras.push(`calendar not updated (${mdata?.reason || mdata?.error || 'unknown'})`);
          } catch { extras.push('calendar update failed'); }
        }

        cb.showSuccessPopup('Updated in SSG.' + (extras.length ? ' ' + extras.join(' · ') + '.' : ''));
        p.onApplied?.();
      } catch (error) {
        cb.showErrorPopup('Failed to update: ' + (error instanceof Error ? error.message : 'unknown error'));
      } finally {
        busy(false);
      }
    };

    // Pre-flight (READ-ONLY): old day emptying + its event dragged off-date → ask up front.
    if (p.syncCalendar && dateChanged && othersOnOldDate === 0 && p.oldDate) {
      let detect: any = null;
      try {
        const dr = await fetch(getApiUrl(`/api/admin/preview-session-reschedule-calendar?courseRunId=${encodeURIComponent(p.courseRunId)}&oldDate=${encodeURIComponent(p.oldDate)}`));
        detect = await dr.json();
      } catch { /* fall through */ }
      if (detect?.found && detect.liveDate && detect.liveDate !== p.oldDate) {
        const currentDates = new Set(p.allSessions.map((s) => convertSsgDateToHtml(s.startDate || '')));
        if (!currentDates.has(detect.liveDate)) {
          setReschedulePrompt({
            eventId: detect.eventId, htmlLink: detect.htmlLink || null, liveDate: detect.liveDate, oldDate: p.oldDate, newDate: p.newDate,
            onChoose: (action) => { setReschedulePrompt(null); void doApply({ eventId: detect.eventId, action, newDate: p.newDate }); },
            onCancel: () => setReschedulePrompt(null),
          });
          return;
        }
      }
    }

    cb.showConfirmPopup(p.confirmMessage, () => { void doApply(undefined); }, p.confirmTitle, 'Confirm', 'Cancel');
  };

  // ── Reschedule one session ──────────────────────────────────────────────────
  const rescheduleSession = async (args: RescheduleArgs) => {
    if (!args.courseRunId?.trim() || !args.courseReferenceNumber?.trim()) {
      cb.showErrorPopup('Course Run ID and Course Reference Number are required'); return;
    }
    const runData = await resolveRun(args);
    if (!runData) { cb.showErrorPopup('Could not load course run details from SSG. Please try again.'); return; }

    const sessStart = args.session.startDate ? convertSsgDateToHtml(args.session.startDate) : '';
    const oldDate = args.originalSession?.startDate || '';
    const dateChanged = !!(oldDate && sessStart && oldDate !== sessStart);
    const othersOnOldDate = dateChanged ? args.allSessions.filter((s) => s.id !== args.session.id && convertSsgDateToHtml(s.startDate || '') === oldDate).length : 0;
    const shortMode = (m: string | number | undefined) => getModeLabel(m ?? '').replace(/^\d+\s*-\s*/, '');

    const oldLine = args.originalSession ? `Old: ${fmtD(args.originalSession.startDate)} · ${args.originalSession.startTime || 'N/A'}–${args.originalSession.endTime || 'N/A'} · ${shortMode(args.originalSession.modeOfTraining)}` : '';
    const newLine = `New: ${fmtD(sessStart)} · ${args.session.startTime || 'N/A'}–${args.session.endTime || 'N/A'} · ${shortMode(args.session.modeOfTraining)}`;
    const { origRunStart, origRunEnd, newRunStart, newRunEnd, runDatesChanged } = computeRunWindow(runData, args.overrides || {}, sessStart, args.session.endDate ? convertSsgDateToHtml(args.session.endDate) : sessStart);
    const runWarn = runDatesChanged ? `\n⚠ Course run will be extended from ${fmtRange(origRunStart, origRunEnd)} to ${fmtRange(newRunStart, newRunEnd)}` : '';
    let calLine = '';
    if (args.syncCalendar) {
      if (!dateChanged) calLine = '\n📅 Calendar reconciled to current sessions';
      else if (othersOnOldDate > 0) calLine = `\n📅 New calendar event on ${fmtShort(sessStart)} (${fmtShort(oldDate)} kept · ${othersOnOldDate} session${othersOnOldDate === 1 ? '' : 's'})`;
      else calLine = `\n📅 New calendar event on ${fmtShort(sessStart)}; ${fmtShort(oldDate)}'s event removed`;
    }
    const confirmMessage = `${args.sessionLabel ? args.sessionLabel + ' · ' : ''}run ${args.courseRunId}\n\n${oldLine ? oldLine + '\n' : ''}${newLine}${runWarn}${calLine}`;

    await runUpdate({
      courseRunId: args.courseRunId, courseReferenceNumber: args.courseReferenceNumber, currentUserEmail: args.currentUserEmail,
      runData, overrides: args.overrides, sessionsToUpdate: [args.session], oldDate, newDate: sessStart,
      allSessions: args.allSessions, syncCalendar: args.syncCalendar, confirmTitle: 'Update Session', confirmMessage, onApplied: args.onApplied,
    });
  };

  // ── Reschedule a whole day ──────────────────────────────────────────────────
  const rescheduleDay = async (args: RescheduleDayArgs) => {
    if (!args.courseRunId?.trim() || !args.courseReferenceNumber?.trim()) {
      cb.showErrorPopup('Course Run ID and Course Reference Number are required'); return;
    }
    if (!args.newDate) { cb.showErrorPopup('Pick a new date for the day.'); return; }
    const runData = await resolveRun(args);
    if (!runData) { cb.showErrorPopup('Could not load course run details from SSG. Please try again.'); return; }

    // Move every session on the day to newDate, preserving its time/mode/venue.
    const sessionsToUpdate = args.sessionsOnDay.map((s) => ({
      id: s.id, startDate: args.newDate, endDate: args.newDate, startTime: s.startTime, endTime: s.endTime, modeOfTraining: s.modeOfTraining, venue: s.venue,
    }));

    const { origRunStart, origRunEnd, newRunStart, newRunEnd, runDatesChanged } = computeRunWindow(runData, args.overrides || {}, args.newDate, args.newDate);
    const runWarn = runDatesChanged ? `\n⚠ Course run will be extended from ${fmtRange(origRunStart, origRunEnd)} to ${fmtRange(newRunStart, newRunEnd)}` : '';
    const n = args.sessionsOnDay.length;
    const calLine = args.syncCalendar ? `\n📅 ${fmtShort(args.oldDate)}'s event moved to ${fmtShort(args.newDate)}` : '';
    const confirmMessage = `Move the whole day · run ${args.courseRunId}\n\n${n} session${n === 1 ? '' : 's'}: ${fmtD(args.oldDate)} → ${fmtD(args.newDate)}${runWarn}${calLine}`;

    await runUpdate({
      courseRunId: args.courseRunId, courseReferenceNumber: args.courseReferenceNumber, currentUserEmail: args.currentUserEmail,
      runData, overrides: args.overrides, sessionsToUpdate, oldDate: args.oldDate, newDate: args.newDate,
      allSessions: args.allSessions, syncCalendar: args.syncCalendar, confirmTitle: 'Reschedule entire day', confirmMessage, onApplied: args.onApplied,
    });
  };

  // ── Cancel (delete) one session ─────────────────────────────────────────────
  const cancelSession = async (args: CancelArgs) => {
    const { courseRunId, courseReferenceNumber, currentUserEmail, session, sessionLabel } = args;
    const syncCalendar = !!args.syncCalendar;
    if (!courseRunId?.trim() || !courseReferenceNumber?.trim()) {
      cb.showErrorPopup('Course Run ID and Course Reference Number are required for cancelling sessions'); return;
    }
    const runData = await resolveRun(args);
    if (!runData) { cb.showErrorPopup('Could not load course run details from SSG. Please try again.'); return; }

    const requestBody = buildDeleteSessionPayload({ courseReferenceNumber, runData, session, currentUserEmail, overrides: args.overrides });
    const dateLabel = convertSsgDateToHtml(session.startDate || '') || (session.startDate ?? '');

    const doDelete = async () => {
      try {
        busy(true);
        const response = await fetch(`/api/ssg/courses/courseRuns/${courseRunId}?includeExpiredCourses=false&action=delete-sessions`, {
          method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(requestBody),
        });
        if (!response.ok) throw new Error(`HTTP error! status: ${response.status}, message: ${await response.text()}`);
        await response.json();

        const extras: string[] = [];
        try {
          const sresp = await fetch(`/api/ssg/courses/runs/${courseRunId}/sessions?courseCode=${encodeURIComponent(courseReferenceNumber)}`);
          const sdata = await sresp.json();
          const fresh = sdata?.data?.result?.sessions || [];
          await fetch(getApiUrl('/api/admin/course-sessions/sync-from-ssg'), {
            method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ courseRunId, sessions: fresh }),
          });
          extras.push('local DB synced');
        } catch { extras.push('local DB sync failed'); }

        if (syncCalendar) {
          try {
            const mresp = await fetch(getApiUrl('/api/admin/reconcile-run-calendar'), {
              method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ courseRunId }),
            });
            const mdata = await mresp.json();
            if (mdata?.success && mdata?.status === 'ok') extras.push(`calendar reconciled (removed ${mdata.removedStale ?? 0})`);
            else extras.push(`calendar not updated (${mdata?.reason || mdata?.error || 'unknown'})`);
          } catch { extras.push('calendar update failed'); }
        }

        cb.showSuccessPopup('Session deleted from SSG.' + (extras.length ? ' ' + extras.join(' · ') + '.' : ''));
        args.onApplied?.();
      } catch (error) {
        cb.showErrorPopup('Failed to delete session: ' + (error instanceof Error ? error.message : 'unknown error'));
      } finally {
        busy(false);
      }
    };

    const warn1 = `${sessionLabel ? sessionLabel + ' · ' : ''}${dateLabel}\n\n⚠️ Cancelling this session will PERMANENTLY DELETE it from SSG / TPGateway — not just hide it in the LMS.${syncCalendar ? "\n📅 Its Google Calendar event for that day will also be removed." : ''}\n\nThis cannot be undone. Continue?`;
    const warn2 = `Final confirmation\n\nDelete session ${dateLabel} from SSG for run ${courseRunId}? This is irreversible.`;
    cb.showConfirmPopup(
      warn1,
      () => { setTimeout(() => cb.showConfirmPopup(warn2, () => { void doDelete(); }, 'Cancel Session', 'Yes, delete from SSG', 'Back'), 0); },
      'Cancel Session — permanent', 'Continue', 'Keep session',
    );
  };

  return { reschedulePrompt, setReschedulePrompt, rescheduleSession, rescheduleDay, cancelSession };
}
