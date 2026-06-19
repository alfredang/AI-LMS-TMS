/**
 * Blocking modal shown when a session's Google Calendar event was manually dragged
 * off its date and the admin reschedules that session WITH calendar sync on. Lets the
 * admin decide how the calendar should be handled (reuse / replace / keep+new).
 *
 * Shared by the in-app calendar, the Edit Class → Sessions tab, and the
 * "Reschedule & Cancel" page. Driven by the `reschedulePrompt` state from
 * useSessionReschedule. (Notify-attendees is handled in the standardized step
 * confirmation, not here.)
 */
import React from 'react';
import type { ReschedulePromptState } from '@/hooks/useSessionReschedule';

interface Props {
  prompt: ReschedulePromptState | null;
}

const SessionRescheduleModal: React.FC<Props> = ({ prompt }) => {
  if (!prompt) return null;
  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-[60] p-4">
      <div className="bg-white dark:bg-gray-800 rounded-lg shadow-xl max-w-lg w-full border dark:border-gray-700 p-6">
        <h3 className="text-lg font-semibold text-gray-900 dark:text-white mb-2">Calendar event was moved manually</h3>
        <p className="text-sm text-gray-600 dark:text-gray-300 mb-4">
          This session's Google Calendar event was manually moved to <strong>{prompt.liveDate}</strong>, which isn't a session date. You're rescheduling the session to <strong>{prompt.newDate}</strong>. How should the calendar be handled?
          {prompt.htmlLink && (
            <> <a href={prompt.htmlLink} target="_blank" rel="noopener noreferrer" className="text-blue-600 dark:text-blue-400 hover:underline">View the event ↗</a></>
          )}
        </p>
        <div className="space-y-2">
          <button type="button" onClick={() => prompt.onChoose('reuse')} className="w-full text-left px-3 py-2 rounded-md border border-gray-200 dark:border-gray-700 hover:bg-blue-50 dark:hover:bg-blue-900/20">
            <div className="font-medium text-gray-900 dark:text-white">Reuse it</div>
            <div className="text-xs text-gray-500 dark:text-gray-400">Move that event to {prompt.newDate} (keeps its edits / attendees).</div>
          </button>
          <button type="button" onClick={() => prompt.onChoose('replace')} className="w-full text-left px-3 py-2 rounded-md border border-gray-200 dark:border-gray-700 hover:bg-blue-50 dark:hover:bg-blue-900/20">
            <div className="font-medium text-gray-900 dark:text-white">Replace it</div>
            <div className="text-xs text-gray-500 dark:text-gray-400">Delete that event and create a fresh one on {prompt.newDate}.</div>
          </button>
          <button type="button" onClick={() => prompt.onChoose('keepNew')} className="w-full text-left px-3 py-2 rounded-md border border-gray-200 dark:border-gray-700 hover:bg-blue-50 dark:hover:bg-blue-900/20">
            <div className="font-medium text-gray-900 dark:text-white">Keep it + create new</div>
            <div className="text-xs text-gray-500 dark:text-gray-400">Leave that event where it is and create a new one on {prompt.newDate}.</div>
          </button>
        </div>
        <div className="mt-4 flex justify-end">
          <button type="button" onClick={() => prompt.onCancel()} className="px-4 py-2 text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-md">Cancel</button>
        </div>
      </div>
    </div>
  );
};

export default SessionRescheduleModal;
