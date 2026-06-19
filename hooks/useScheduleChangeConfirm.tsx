/**
 * useScheduleChangeConfirm — one standardized confirmation step for every
 * reschedule/cancel/move action, used by BOTH the in-app calendar and the
 * Reschedule & Cancel page so the experience is identical.
 *
 * The step modal shows the change summary plus two per-step toggles that DEFAULT
 * to (inherit) the page-level "parent" config but can be overridden for this one
 * action:
 *   - Sync Google Calendar   (hidden when showSync === false)
 *   - Notify attendees        → expands the editable, branded email composer
 *
 * `confirm(args)` returns a Promise resolving to the admin's decision; the caller
 * applies the change and then sends the (composed) notification. Nothing is sent
 * from here.
 */
import React, { useCallback, useRef, useState } from 'react';
import NotifyComposer, { type NotifyPayload } from '@/components/admin/NotifyComposer';
import CalendarAttendeesPanel from '@/components/admin/CalendarAttendeesPanel';
import { type AttendeeDiffs, attendeeDiffCount } from '@/lib/calendar/attendeeDiffs';
import type { ScheduleChangeType } from '@/lib/notifications/scheduleChangeEmail';

export interface StepConfirmArgs {
  title: string;
  message: string;
  confirmLabel?: string;
  cancelLabel?: string;
  destructive?: boolean;
  defaultSync: boolean;
  defaultNotify: boolean;
  showSync?: boolean; // default true
  showAdjust?: boolean; // default true — show the "Adjust attendees" staged reconcile
  notify: { courseRunId: string; changeType: ScheduleChangeType; summary: string };
  /** Reactive hint describing what the calendar will do, given the current Sync toggle. */
  calendarImpact?: (sync: boolean) => string;
}

export interface StepConfirmResult {
  confirmed: boolean;
  sync: boolean;
  notifyPayload: NotifyPayload | null;
  /** Staged attendee/roster/TPG/calendar changes to apply AFTER the reschedule (null if Adjust off). */
  attendeeDiffs: AttendeeDiffs | null;
  attendeeRunUuid: string | null;
}

interface InternalState { args: StepConfirmArgs; sync: boolean; notify: boolean; adjust: boolean; }

export function useScheduleChangeConfirm() {
  const [state, setState] = useState<InternalState | null>(null);
  const [payload, setPayload] = useState<NotifyPayload | null>(null);
  const [attendeeDiffs, setAttendeeDiffs] = useState<AttendeeDiffs | null>(null);
  const [attendeeRunUuid, setAttendeeRunUuid] = useState<string | null>(null);
  const resolverRef = useRef<((r: StepConfirmResult) => void) | null>(null);

  const confirm = useCallback((args: StepConfirmArgs) => {
    setPayload(null); setAttendeeDiffs(null); setAttendeeRunUuid(null);
    setState({ args, sync: args.defaultSync, notify: args.defaultNotify, adjust: false });
    return new Promise<StepConfirmResult>((resolve) => { resolverRef.current = resolve; });
  }, []);

  const onStagedChange = useCallback((diffs: AttendeeDiffs, runUuid: string | null) => {
    setAttendeeDiffs(diffs); setAttendeeRunUuid(runUuid);
  }, []);

  const finish = (result: StepConfirmResult) => {
    const r = resolverRef.current; resolverRef.current = null;
    setState(null); setPayload(null); setAttendeeDiffs(null); setAttendeeRunUuid(null);
    r?.(result);
  };

  const node = state ? (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-[60] p-4">
      <div className={`bg-white dark:bg-gray-800 rounded-lg shadow-xl w-full border dark:border-gray-700 p-6 max-h-[90vh] overflow-auto transition-all ${(state.notify || state.adjust) ? 'max-w-4xl' : 'max-w-lg'}`}>
        <h3 className={`text-lg font-semibold mb-2 ${state.args.destructive ? 'text-red-700 dark:text-red-400' : 'text-gray-900 dark:text-white'}`}>{state.args.title}</h3>
        <p className="text-sm text-gray-600 dark:text-gray-300 mb-3 whitespace-pre-line">{state.args.message}</p>

        <div className="space-y-2 border-t border-gray-200 dark:border-gray-700 pt-3">
          {state.args.showSync !== false && (
            <div>
              <label className="flex items-center gap-2 text-sm text-gray-800 dark:text-gray-200 cursor-pointer select-none">
                <input type="checkbox" checked={state.sync} onChange={(e) => setState((s) => s && { ...s, sync: e.target.checked })} className="h-4 w-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500" />
                Sync Google Calendar
              </label>
              {state.args.calendarImpact && <p className="text-xs text-gray-500 dark:text-gray-400 ml-6">{state.args.calendarImpact(state.sync)}</p>}
            </div>
          )}
          <div>
            <label className="flex items-center gap-2 text-sm text-gray-800 dark:text-gray-200 cursor-pointer select-none">
              <input type="checkbox" checked={state.notify} onChange={(e) => setState((s) => s && { ...s, notify: e.target.checked })} className="h-4 w-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500" />
              Notify attendees by email
            </label>
            <p className="text-xs text-gray-500 dark:text-gray-400 ml-6">Email the learners and trainer(s) about this change. Tick to review and edit the email and choose who gets it.</p>
            {state.notify && (
              <div className="mt-3">
                <NotifyComposer courseRunId={state.args.notify.courseRunId} changeType={state.args.notify.changeType} summary={state.args.notify.summary} onChange={setPayload} />
              </div>
            )}
          </div>

          {/* Adjust attendees — affects LMS roster / TPG / calendar separately; applied AFTER the move. */}
          {state.args.showAdjust !== false && (
          <div>
            <label className="flex items-center gap-2 text-sm text-gray-800 dark:text-gray-200 cursor-pointer select-none">
              <input type="checkbox" checked={state.adjust} onChange={(e) => setState((s) => s && { ...s, adjust: e.target.checked })} className="h-4 w-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500" />
              Change who's on this class (learners / trainers / TPG / calendar)
            </label>
            <p className="text-xs text-gray-500 dark:text-gray-400 ml-6">Update who's on this class across the system, TPGateway and Google Calendar. Saved when you confirm — after the move, so it takes priority over the automatic calendar update. Applies to the <strong>whole class</strong> (all its days), not just the day you're moving.</p>
            {state.adjust && (
              <div className="mt-3 rounded-md border border-gray-200 dark:border-gray-700 p-3">
                <CalendarAttendeesPanel courseRunId={state.args.notify.courseRunId} staged onStagedChange={onStagedChange} />
              </div>
            )}
          </div>
          )}
        </div>

        <div className="flex justify-end gap-2 mt-4">
          <button type="button" onClick={() => finish({ confirmed: false, sync: state.sync, notifyPayload: null, attendeeDiffs: null, attendeeRunUuid: null })}
            className="px-4 py-2 text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-md">{state.args.cancelLabel || 'Cancel'}</button>
          <button type="button"
            disabled={state.notify && !payload}
            onClick={() => finish({ confirmed: true, sync: state.sync, notifyPayload: state.notify ? payload : null, attendeeDiffs: state.adjust && attendeeDiffs && attendeeDiffCount(attendeeDiffs) > 0 ? attendeeDiffs : null, attendeeRunUuid })}
            className={`px-4 py-2 rounded-md text-white disabled:opacity-50 disabled:cursor-not-allowed ${state.args.destructive ? 'bg-red-600 hover:bg-red-700' : 'bg-blue-600 hover:bg-blue-700'}`}>
            {state.args.confirmLabel || 'Confirm'}
          </button>
        </div>
      </div>
    </div>
  ) : null;

  return { confirm, node };
}
