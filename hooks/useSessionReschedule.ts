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
import { applyAttendeeDiffs } from '@/lib/calendar/attendeeDiffs';
import { verifyRunCalendarAttendees, describeVerify } from '@/lib/calendar/verifyAttendees';
import {
  buildUpdateSessionsPayload,
  buildDeleteSessionPayload,
  buildDeleteSessionsPayload,
  computeRunWindow,
  convertSsgDateToHtml,
  getModeLabel,
  type EditableSession,
  type RunFormOverrides,
} from '@/lib/ssg/sessionEditHelpers';
import type { ScheduleChangeType } from '@/lib/notifications/scheduleChangeEmail';
import type { StepConfirmArgs, StepConfirmResult } from '@/hooks/useScheduleChangeConfirm';
import type { NotifyPayload } from '@/components/admin/NotifyComposer';

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
  /**
   * Standardized step confirmation with per-step Sync + Notify toggles (inheriting
   * the page-level defaults) and an embedded email composer. When provided, it is
   * used for the apply-confirmation; the hook applies the change THEN sends the
   * composed notification. When omitted, the legacy showConfirmPopup flow runs
   * (used by older call sites that pass syncCalendar/notifyAttendees up front).
   */
  showStepConfirm?: (args: StepConfirmArgs) => Promise<StepConfirmResult>;
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
  /** Offer (after a confirmed apply) to email confirmed learners + accepted trainer(s). Manual — never auto. */
  notifyAttendees?: boolean;
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
  notifyAttendees?: boolean;
}

export interface CancelArgs extends CommonArgs {
  session: EditableSession;
  sessionLabel?: string;
  syncCalendar?: boolean;
  notifyAttendees?: boolean;
}

export interface CancelDayArgs extends CommonArgs {
  /** YYYY-MM-DD label of the day being cancelled. */
  date: string;
  /** Every session on that day (all will be deleted from SSG). */
  sessionsOnDay: EditableSession[];
  syncCalendar?: boolean;
  notifyAttendees?: boolean;
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

/**
 * Turn an SSG error response body into a readable message. SSG returns 200-with-error-body OR a
 * non-2xx with `{ code, message, details: [{ field, message }], errorId }`. The raw JSON dump is
 * useless to a non-technical admin — surface the human `details[].message` and explain the common
 * "Course Run already exist" case (SSG already has another run of this course on those dates; often
 * a sign its dates differ from ours — verify on TPGateway).
 */
/** Shown on the success popup after a Google-Calendar-affecting action — the GCal view lags a live write. */
const CAL_REFRESH_HINT = '↻ Refresh Google Calendar to see the change — it can take a moment to update.';

function friendlySsgError(status: number, text: string): string {
  try {
    const j = JSON.parse(text);
    const details = Array.isArray(j?.details) ? j.details.map((d: any) => d?.message).filter(Boolean) : [];
    const core = (details.join(' ') || j?.message || text || `HTTP ${status}`).trim();
    if (/already exist/i.test(core)) {
      return `${core}\n\nTPGateway already has another run of this course on that date, so it won't accept the change. Check that run's dates on TPGateway, or pick a different date.`;
    }
    return core;
  } catch {
    return text || `HTTP ${status}`;
  }
}

/** Apply the confirm step's STAGED attendee/roster/TPG/calendar changes (after the reschedule). */
async function applyStagedAttendees(
  courseRunId: string, dec: StepConfirmResult, baseMsg: string, busy?: (b: boolean) => void,
): Promise<string> {
  if (!dec.attendeeDiffs) return baseMsg;
  try {
    busy?.(true); // keep the processing overlay up through apply + the settle poll below
    const r = await applyAttendeeDiffs(courseRunId, dec.attendeeRunUuid, dec.attendeeDiffs);
    let line = `Attendees: applied ${r.ok}${r.fail ? `, ${r.fail} failed (${r.fails.join(', ')})` : ''}.`;
    // Don't declare done until the calendar actually reflects the override: the people we added
    // are present and the people we removed are gone (the reconcile briefly adds the whole roster
    // first, so an early read can look "wrong"). See verifyRunCalendarAttendees.
    const v = await verifyRunCalendarAttendees(courseRunId, {
      present: dec.attendeeDiffs.gcalAdd, absent: dec.attendeeDiffs.gcalRemove,
    });
    const vline = describeVerify(v);
    if (vline) line += ' ' + vline;
    // Calendar refresh hint — only if the reconcile (sync) path didn't already append it (baseMsg) and
    // the staged adjust itself touched the calendar.
    const stagedTouchedCal = (dec.attendeeDiffs.gcalAdd.length + dec.attendeeDiffs.gcalRemove.length) > 0;
    const hint = (!dec.sync && stagedTouchedCal) ? `\n\n${CAL_REFRESH_HINT}` : '';
    return `${baseMsg}\n\n${line}${hint}`;
  } catch (e) {
    return `${baseMsg}\n\n⚠ Attendee changes failed: ${e instanceof Error ? e.message : 'error'}`;
  } finally {
    busy?.(false);
  }
}

export function useSessionReschedule(cb: PopupCallbacks) {
  const [reschedulePrompt, setReschedulePrompt] = useState<ReschedulePromptState | null>(null);
  const busy = (b: boolean) => cb.setBusy?.(b);

  // Send an already-composed notification (new step-confirm flow). Returns a short
  // result line to append to the success popup. Never throws.
  const sendNotify = async (courseRunId: string, changeType: ScheduleChangeType, payload: NotifyPayload): Promise<string> => {
    if (!payload.recipients.length) return 'Notification skipped — no recipients selected.';
    try {
      const r = await fetch(getApiUrl('/api/admin/notify-schedule-change'), {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ courseRunId, changeType, summary: payload.message, subject: payload.subject, reason: payload.reason, recipients: payload.recipients }),
      });
      const j = await r.json();
      if (j?.success) return `Notified ${j.sent ?? 0} attendee(s)${j.failed ? `, ${j.failed} failed` : ''}.`;
      return `Notification failed: ${j?.error || 'unknown'}`;
    } catch (e) {
      return 'Notification failed: ' + (e instanceof Error ? e.message : 'unknown error');
    }
  };

  // Promise wrapper around the calendar-resolution modal (event dragged off its day).
  const askResolution = (a: { eventId: string; htmlLink: string | null; liveDate: string; oldDate: string; newDate: string }) =>
    new Promise<'reuse' | 'replace' | 'keepNew' | null>((resolve) => {
      setReschedulePrompt({
        eventId: a.eventId, htmlLink: a.htmlLink, liveDate: a.liveDate, oldDate: a.oldDate, newDate: a.newDate,
        onChoose: (action) => { setReschedulePrompt(null); resolve(action); },
        onCancel: () => { setReschedulePrompt(null); resolve(null); },
      });
    });

  // After a confirmed reschedule/cancel, OFFER (never auto) to email confirmed
  // attendees. The explicit "Send email" click is the admin processing step.
  // LEGACY path (call sites without showStepConfirm).
  const offerNotify = (courseRunId: string, changeType: ScheduleChangeType, summary: string, baseMsg: string) => {
    cb.showConfirmPopup(
      `${baseMsg}\n\nEmail the learners and trainer(s) about this ${changeType === 'cancel' ? 'cancellation' : 'change'}?`,
      async () => {
        try {
          const r = await fetch(getApiUrl('/api/admin/notify-schedule-change'), {
            method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ courseRunId, changeType, summary }),
          });
          const j = await r.json();
          if (j?.success) cb.showSuccessPopup(`Notified ${j.sent ?? 0} attendee(s)${j.failed ? `, ${j.failed} failed` : ''}.`);
          else cb.showErrorPopup(`Notification failed: ${j?.error || 'unknown'}${j?.failed ? ` (${j.failed} failed)` : ''}`);
        } catch (e) {
          cb.showErrorPopup('Notification failed: ' + (e instanceof Error ? e.message : 'unknown error'));
        }
      },
      'Notify attendees', 'Send email', 'Skip',
    );
  };

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
    syncCalendar: boolean;            // default for the step's Sync toggle (new flow) / fixed (legacy)
    confirmTitle: string; confirmMessage: string;
    notifyAttendees?: boolean; changeSummary?: string;  // notifyAttendees = default for Notify toggle
    changeType: ScheduleChangeType;
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

    // Applies the SSG update + local sync + (opt-in) calendar reconcile. Returns a
    // success message, or null on failure (after showing the error). No success/notify
    // popups here — the caller decides what to show.
    const doApply = async (sync: boolean, resolution?: { eventId: string; action: 'reuse' | 'replace' | 'keepNew'; newDate: string }): Promise<string | null> => {
      try {
        busy(true);
        const response = await fetch(`/api/ssg/courses/courseRuns/${p.courseRunId}?includeExpiredCourses=false&action=update-sessions`, {
          method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(requestBody),
        });
        if (!response.ok) throw new Error(friendlySsgError(response.status, await response.text()));
        const updBody = await response.json().catch(() => null);

        const extras: string[] = [];
        // The SSG session edit wipes the run's trainer; the server re-asserts it to TPG. Surface failures.
        const ra = updBody?.tpgTrainerReassert;
        if (ra && !['synced', 'skipped_no_trainer', 'skipped'].includes(ra.status)) {
          extras.push(`⚠ TPG trainer not restored (${ra.status}${ra.message ? `: ${ra.message}` : ''})`);
        }
        try {
          const sresp = await fetch(`/api/ssg/courses/runs/${p.courseRunId}/sessions?courseCode=${encodeURIComponent(p.courseReferenceNumber)}`);
          const sdata = await sresp.json();
          const fresh = sdata?.data?.result?.sessions || [];
          if (fresh.length) {
            await fetch(getApiUrl('/api/admin/course-sessions/sync-from-ssg'), {
              method: 'POST', headers: { 'Content-Type': 'application/json' },
              // sync-from-ssg re-derives course_run.start/end from these sessions (MIN/MAX),
              // so the run window tracks the actual schedule — no need to pass it here.
              body: JSON.stringify({ courseRunId: p.courseRunId, sessions: fresh }),
            });
          }
        } catch { extras.push('could not refresh the view'); }

        if (sync) {
          try {
            const mresp = await fetch(getApiUrl('/api/admin/reconcile-run-calendar'), {
              method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ courseRunId: p.courseRunId, resolution }),
            });
            const mdata = await mresp.json();
            if (mdata?.success && mdata?.status === 'ok') extras.push(`Google Calendar updated (${mdata.created ?? 0} added, ${mdata.removedStale ?? 0} removed)`);
            else extras.push(`Google Calendar not updated (${mdata?.reason || mdata?.error || 'unknown'})`);
          } catch { extras.push('Google Calendar update failed'); }
        }

        p.onApplied?.();
        return 'Class rescheduled.' + (extras.length ? ' ' + extras.join(' · ') + '.' : '') + (sync ? '\n\n' + CAL_REFRESH_HINT : '');
      } catch (error) {
        cb.showErrorPopup("Couldn't reschedule: " + (error instanceof Error ? error.message : 'something went wrong'));
        return null;
      } finally {
        busy(false);
      }
    };

    // Reactive note about what the Google Calendar will do, given the Sync toggle.
    const calendarImpact = (sync: boolean): string => {
      if (!sync) return "Google Calendar won't be changed.";
      if (!dateChanged) return 'Google Calendar will be updated to match.';
      if (othersOnOldDate > 0) return `Adds a calendar event on ${fmtShort(p.newDate)} (${fmtShort(p.oldDate)} stays — ${othersOnOldDate} other session${othersOnOldDate === 1 ? '' : 's'} there).`;
      return `Moves the ${fmtShort(p.oldDate)} event to ${fmtShort(p.newDate)}.`;
    };

    // Pre-flight (READ-ONLY): when syncing + old day empties + its event was dragged
    // off-date, ask how to resolve the calendar BEFORE applying. Returns false if cancelled.
    const resolveCalendarIfNeeded = async (sync: boolean): Promise<{ ok: true; resolution?: { eventId: string; action: 'reuse' | 'replace' | 'keepNew'; newDate: string } } | { ok: false }> => {
      if (!(sync && dateChanged && othersOnOldDate === 0 && p.oldDate)) return { ok: true };
      let detect: any = null;
      try {
        const dr = await fetch(getApiUrl(`/api/admin/preview-session-reschedule-calendar?courseRunId=${encodeURIComponent(p.courseRunId)}&oldDate=${encodeURIComponent(p.oldDate)}`));
        detect = await dr.json();
      } catch { /* fall through */ }
      if (detect?.found && detect.liveDate && detect.liveDate !== p.oldDate) {
        const currentDates = new Set(p.allSessions.map((s) => convertSsgDateToHtml(s.startDate || '')));
        if (!currentDates.has(detect.liveDate)) {
          const action = await askResolution({ eventId: detect.eventId, htmlLink: detect.htmlLink || null, liveDate: detect.liveDate, oldDate: p.oldDate, newDate: p.newDate });
          if (!action) return { ok: false };
          return { ok: true, resolution: { eventId: detect.eventId, action, newDate: p.newDate } };
        }
      }
      return { ok: true };
    };

    // NEW standardized flow: confirm (with per-step Sync + Notify) → resolve calendar → apply → notify.
    if (cb.showStepConfirm) {
      const dec = await cb.showStepConfirm({
        title: p.confirmTitle, message: p.confirmMessage, confirmLabel: 'Confirm', cancelLabel: 'Cancel',
        defaultSync: p.syncCalendar, defaultNotify: !!p.notifyAttendees,
        notify: { courseRunId: p.courseRunId, changeType: p.changeType, summary: p.changeSummary || 'Your class schedule has changed.' },
        calendarImpact,
      });
      if (!dec.confirmed) return;
      const res = await resolveCalendarIfNeeded(dec.sync);
      if (!res.ok) return;
      const baseMsg = await doApply(dec.sync, res.resolution);
      if (baseMsg == null) return;
      const msg = await applyStagedAttendees(p.courseRunId, dec, baseMsg, busy);
      if (dec.notifyPayload) { const nr = await sendNotify(p.courseRunId, p.changeType, dec.notifyPayload); cb.showSuccessPopup(`${msg}\n\n${nr}`); }
      else cb.showSuccessPopup(msg);
      return;
    }

    // LEGACY flow (no showStepConfirm): up-front resolution, fixed sync, post-apply notify offer.
    const legacyApply = async (resolution?: { eventId: string; action: 'reuse' | 'replace' | 'keepNew'; newDate: string }) => {
      const baseMsg = await doApply(p.syncCalendar, resolution);
      if (baseMsg == null) return;
      if (p.notifyAttendees) offerNotify(p.courseRunId, p.changeType, p.changeSummary || 'Your class schedule has changed.', baseMsg);
      else cb.showSuccessPopup(baseMsg);
    };
    const legacyMsg = p.confirmMessage + (p.syncCalendar ? `\n📅 ${calendarImpact(true)}` : '');
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
            onChoose: (action) => { setReschedulePrompt(null); void legacyApply({ eventId: detect.eventId, action, newDate: p.newDate }); },
            onCancel: () => setReschedulePrompt(null),
          });
          return;
        }
      }
    }
    cb.showConfirmPopup(legacyMsg, () => { void legacyApply(undefined); }, p.confirmTitle, 'Confirm', 'Cancel');
  };

  // ── Reschedule one session ──────────────────────────────────────────────────
  const rescheduleSession = async (args: RescheduleArgs) => {
    if (!args.courseRunId?.trim() || !args.courseReferenceNumber?.trim()) {
      cb.showErrorPopup('Course Run ID and Course Reference Number are required'); return;
    }
    const runData = await resolveRun(args);
    if (!runData) { cb.showErrorPopup("Couldn't load the class details. Please try again."); return; }

    const sessStart = args.session.startDate ? convertSsgDateToHtml(args.session.startDate) : '';
    const oldDate = args.originalSession?.startDate || '';
    const dateChanged = !!(oldDate && sessStart && oldDate !== sessStart);
    const othersOnOldDate = dateChanged ? args.allSessions.filter((s) => s.id !== args.session.id && convertSsgDateToHtml(s.startDate || '') === oldDate).length : 0;
    const shortMode = (m: string | number | undefined) => getModeLabel(m ?? '').replace(/^\d+\s*-\s*/, '');

    const oldLine = args.originalSession ? `Old: ${fmtD(args.originalSession.startDate)} · ${args.originalSession.startTime || 'N/A'}–${args.originalSession.endTime || 'N/A'} · ${shortMode(args.originalSession.modeOfTraining)}` : '';
    const newLine = `New: ${fmtD(sessStart)} · ${args.session.startTime || 'N/A'}–${args.session.endTime || 'N/A'} · ${shortMode(args.session.modeOfTraining)}`;
    const { origRunStart, origRunEnd, newRunStart, newRunEnd, runDatesChanged } = computeRunWindow(runData, args.overrides || {}, sessStart, args.session.endDate ? convertSsgDateToHtml(args.session.endDate) : sessStart);
    const runWarn = runDatesChanged ? `\n⚠ Course run will be extended from ${fmtRange(origRunStart, origRunEnd)} to ${fmtRange(newRunStart, newRunEnd)}` : '';
    void othersOnOldDate; // calendar impact is computed in runUpdate (reactive to the Sync toggle)
    const confirmMessage = `${args.sessionLabel ? args.sessionLabel + ' · ' : ''}run ${args.courseRunId}\n\n${oldLine ? oldLine + '\n' : ''}${newLine}${runWarn}`;

    await runUpdate({
      courseRunId: args.courseRunId, courseReferenceNumber: args.courseReferenceNumber, currentUserEmail: args.currentUserEmail,
      runData, overrides: args.overrides, sessionsToUpdate: [args.session], oldDate, newDate: sessStart,
      allSessions: args.allSessions, syncCalendar: args.syncCalendar, confirmTitle: 'Reschedule session', confirmMessage,
      notifyAttendees: args.notifyAttendees, changeType: 'session_reschedule',
      changeSummary: `Rescheduled to ${fmtD(sessStart)}${args.session.startTime ? ` (${args.session.startTime}${args.session.endTime ? '–' + args.session.endTime : ''})` : ''}.`,
      onApplied: args.onApplied,
    });
  };

  // ── Reschedule a whole day ──────────────────────────────────────────────────
  const rescheduleDay = async (args: RescheduleDayArgs) => {
    if (!args.courseRunId?.trim() || !args.courseReferenceNumber?.trim()) {
      cb.showErrorPopup('Course Run ID and Course Reference Number are required'); return;
    }
    if (!args.newDate) { cb.showErrorPopup('Pick a new date for the day.'); return; }
    const runData = await resolveRun(args);
    if (!runData) { cb.showErrorPopup("Couldn't load the class details. Please try again."); return; }

    // Move every session on the day to newDate, preserving its time/mode/venue.
    const sessionsToUpdate = args.sessionsOnDay.map((s) => ({
      id: s.id, startDate: args.newDate, endDate: args.newDate, startTime: s.startTime, endTime: s.endTime, modeOfTraining: s.modeOfTraining, venue: s.venue,
    }));

    const { origRunStart, origRunEnd, newRunStart, newRunEnd, runDatesChanged } = computeRunWindow(runData, args.overrides || {}, args.newDate, args.newDate);
    const runWarn = runDatesChanged ? `\n⚠ Course run will be extended from ${fmtRange(origRunStart, origRunEnd)} to ${fmtRange(newRunStart, newRunEnd)}` : '';
    const n = args.sessionsOnDay.length;
    const confirmMessage = `Move the whole day · run ${args.courseRunId}\n\n${n} session${n === 1 ? '' : 's'}: ${fmtD(args.oldDate)} → ${fmtD(args.newDate)}${runWarn}`;

    await runUpdate({
      courseRunId: args.courseRunId, courseReferenceNumber: args.courseReferenceNumber, currentUserEmail: args.currentUserEmail,
      runData, overrides: args.overrides, sessionsToUpdate, oldDate: args.oldDate, newDate: args.newDate,
      allSessions: args.allSessions, syncCalendar: args.syncCalendar, confirmTitle: 'Reschedule entire day', confirmMessage,
      notifyAttendees: args.notifyAttendees, changeType: 'day_reschedule',
      changeSummary: `${n} session${n === 1 ? '' : 's'} moved from ${fmtD(args.oldDate)} to ${fmtD(args.newDate)}.`,
      onApplied: args.onApplied,
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
    if (!runData) { cb.showErrorPopup("Couldn't load the class details. Please try again."); return; }

    const requestBody = buildDeleteSessionPayload({ courseReferenceNumber, runData, session, currentUserEmail, overrides: args.overrides });
    const dateLabel = convertSsgDateToHtml(session.startDate || '') || (session.startDate ?? '');

    // Deletes the session from SSG + local sync + (opt-in) calendar reconcile.
    // Returns a success message, or null on failure (after showing the error).
    const doDelete = async (sync: boolean): Promise<string | null> => {
      try {
        busy(true);
        const response = await fetch(`/api/ssg/courses/courseRuns/${courseRunId}?includeExpiredCourses=false&action=delete-sessions`, {
          method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(requestBody),
        });
        if (!response.ok) throw new Error(friendlySsgError(response.status, await response.text()));
        await response.json();

        const extras: string[] = [];
        try {
          const sresp = await fetch(`/api/ssg/courses/runs/${courseRunId}/sessions?courseCode=${encodeURIComponent(courseReferenceNumber)}`);
          const sdata = await sresp.json();
          const fresh = sdata?.data?.result?.sessions || [];
          await fetch(getApiUrl('/api/admin/course-sessions/sync-from-ssg'), {
            method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ courseRunId, sessions: fresh }),
          });
        } catch { extras.push('could not refresh the view'); }

        if (sync) {
          try {
            const mresp = await fetch(getApiUrl('/api/admin/reconcile-run-calendar'), {
              method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ courseRunId }),
            });
            const mdata = await mresp.json();
            if (mdata?.success && mdata?.status === 'ok') extras.push(`Google Calendar updated (${mdata.removedStale ?? 0} removed)`);
            else extras.push(`Google Calendar not updated (${mdata?.reason || mdata?.error || 'unknown'})`);
          } catch { extras.push('Google Calendar update failed'); }
        }

        args.onApplied?.();
        return 'Session cancelled.' + (extras.length ? ' ' + extras.join(' · ') + '.' : '') + (sync ? '\n\n' + CAL_REFRESH_HINT : '');
      } catch (error) {
        cb.showErrorPopup("Couldn't cancel the session: " + (error instanceof Error ? error.message : 'something went wrong'));
        return null;
      } finally {
        busy(false);
      }
    };

    const calendarImpact = (sync: boolean) => sync
      ? "Removes that day's Google Calendar event if no other sessions remain that day."
      : "Google Calendar won't be changed.";
    const summary = `The session on ${dateLabel} has been cancelled.`;
    const warning = `${sessionLabel ? sessionLabel + ' · ' : ''}${dateLabel}\n\n⚠️ This permanently deletes the session and can't be undone.`;

    // Standardized single confirm (warning + Sync/Notify toggles + composer).
    if (cb.showStepConfirm) {
      void (async () => {
        const dec = await cb.showStepConfirm!({
          title: 'Cancel session — permanent', message: warning, destructive: true,
          confirmLabel: 'Delete session', cancelLabel: 'Keep session',
          defaultSync: syncCalendar, defaultNotify: !!args.notifyAttendees,
          notify: { courseRunId, changeType: 'session_cancel', summary }, calendarImpact,
        });
        if (!dec.confirmed) return;
        const baseMsg = await doDelete(dec.sync);
        if (baseMsg == null) return;
        const msg = await applyStagedAttendees(courseRunId, dec, baseMsg, busy);
        if (dec.notifyPayload) { const nr = await sendNotify(courseRunId, 'session_cancel', dec.notifyPayload); cb.showSuccessPopup(`${msg}\n\n${nr}`); }
        else cb.showSuccessPopup(msg);
      })();
      return;
    }
    // LEGACY (no step confirm): two-step warning.
    cb.showConfirmPopup(
      `${warning}\n\nContinue?`,
      () => { setTimeout(() => cb.showConfirmPopup(`Permanently delete the session on ${dateLabel}? This can't be undone.`, () => { void (async () => {
        const baseMsg = await doDelete(syncCalendar);
        if (baseMsg == null) return;
        if (args.notifyAttendees) offerNotify(courseRunId, 'session_cancel', summary, baseMsg);
        else cb.showSuccessPopup(baseMsg);
      })(); }, 'Cancel session', 'Yes, delete', 'Back'), 0); },
      'Cancel session — permanent', 'Continue', 'Keep session',
    );
  };

  // ── Cancel (delete) every session on a day ──────────────────────────────────
  const cancelDay = async (args: CancelDayArgs) => {
    const { courseRunId, courseReferenceNumber, currentUserEmail, date, sessionsOnDay } = args;
    const syncCalendar = !!args.syncCalendar;
    if (!courseRunId?.trim() || !courseReferenceNumber?.trim()) {
      cb.showErrorPopup('Course Run ID and Course Reference Number are required for cancelling sessions'); return;
    }
    if (!sessionsOnDay.length) { cb.showErrorPopup('No sessions on that day to cancel.'); return; }
    const runData = await resolveRun(args);
    if (!runData) { cb.showErrorPopup("Couldn't load the class details. Please try again."); return; }

    const requestBody = buildDeleteSessionsPayload({ courseReferenceNumber, runData, sessions: sessionsOnDay, currentUserEmail, overrides: args.overrides });
    const n = sessionsOnDay.length;

    const doDelete = async (sync: boolean): Promise<string | null> => {
      try {
        busy(true);
        const response = await fetch(`/api/ssg/courses/courseRuns/${courseRunId}?includeExpiredCourses=false&action=delete-sessions`, {
          method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(requestBody),
        });
        if (!response.ok) throw new Error(friendlySsgError(response.status, await response.text()));
        await response.json();

        const extras: string[] = [];
        try {
          const sresp = await fetch(`/api/ssg/courses/runs/${courseRunId}/sessions?courseCode=${encodeURIComponent(courseReferenceNumber)}`);
          const sdata = await sresp.json();
          const fresh = sdata?.data?.result?.sessions || [];
          await fetch(getApiUrl('/api/admin/course-sessions/sync-from-ssg'), {
            method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ courseRunId, sessions: fresh }),
          });
        } catch { extras.push('could not refresh the view'); }

        if (sync) {
          try {
            const mresp = await fetch(getApiUrl('/api/admin/reconcile-run-calendar'), {
              method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ courseRunId }),
            });
            const mdata = await mresp.json();
            if (mdata?.success && mdata?.status === 'ok') extras.push(`Google Calendar updated (${mdata.removedStale ?? 0} removed)`);
            else extras.push(`Google Calendar not updated (${mdata?.reason || mdata?.error || 'unknown'})`);
          } catch { extras.push('Google Calendar update failed'); }
        }

        args.onApplied?.();
        return `${n} session${n === 1 ? '' : 's'} cancelled.` + (extras.length ? ' ' + extras.join(' · ') + '.' : '') + (sync ? '\n\n' + CAL_REFRESH_HINT : '');
      } catch (error) {
        cb.showErrorPopup("Couldn't cancel the day: " + (error instanceof Error ? error.message : 'something went wrong'));
        return null;
      } finally {
        busy(false);
      }
    };

    const calendarImpact = (sync: boolean) => sync
      ? "Removes that day's Google Calendar event."
      : "Google Calendar won't be changed.";
    const summary = `All ${n} session${n === 1 ? '' : 's'} on ${fmtD(date)} have been cancelled.`;
    const warning = `${fmtD(date)} · ${n} session${n === 1 ? '' : 's'}\n\n⚠️ This permanently deletes all ${n} session${n === 1 ? '' : 's'} on this day and can't be undone.`;

    // Standardized single confirm (warning + Sync/Notify toggles + composer).
    if (cb.showStepConfirm) {
      void (async () => {
        const dec = await cb.showStepConfirm!({
          title: 'Cancel entire day — permanent', message: warning, destructive: true,
          confirmLabel: 'Delete day', cancelLabel: 'Keep day',
          defaultSync: syncCalendar, defaultNotify: !!args.notifyAttendees,
          notify: { courseRunId, changeType: 'day_cancel', summary }, calendarImpact,
        });
        if (!dec.confirmed) return;
        const baseMsg = await doDelete(dec.sync);
        if (baseMsg == null) return;
        const msg = await applyStagedAttendees(courseRunId, dec, baseMsg, busy);
        if (dec.notifyPayload) { const nr = await sendNotify(courseRunId, 'day_cancel', dec.notifyPayload); cb.showSuccessPopup(`${msg}\n\n${nr}`); }
        else cb.showSuccessPopup(msg);
      })();
      return;
    }
    // LEGACY (no step confirm): two-step warning.
    cb.showConfirmPopup(
      `${warning}\n\nContinue?`,
      () => { setTimeout(() => cb.showConfirmPopup(`Permanently delete all ${n} session${n === 1 ? '' : 's'} on ${fmtD(date)}? This can't be undone.`, () => { void (async () => {
        const baseMsg = await doDelete(syncCalendar);
        if (baseMsg == null) return;
        if (args.notifyAttendees) offerNotify(courseRunId, 'day_cancel', summary, baseMsg);
        else cb.showSuccessPopup(baseMsg);
      })(); }, 'Cancel entire day', 'Yes, delete', 'Back'), 0); },
      'Cancel entire day — permanent', 'Continue', 'Keep day',
    );
  };

  return { reschedulePrompt, setReschedulePrompt, rescheduleSession, rescheduleDay, cancelSession, cancelDay };
}
