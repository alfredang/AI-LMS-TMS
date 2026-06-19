/**
 * NotifyComposer — the editable notification-email panel that expands inside the
 * reschedule/cancel confirmation popup when "Notify attendees" is ticked.
 *
 * Lets the admin:
 *  - see + edit the email subject and body (the change description),
 *  - see a live branded preview of exactly what will be sent,
 *  - exclude individual attendees (checkbox per recipient, all selected by default).
 *
 * Reports the current payload up via `onChange` so the parent can send it (only after
 * the schedule change itself is confirmed + applied). Nothing is sent from here.
 */
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { getApiUrl } from '@/lib/urlHelpers';
import type { ScheduleChangeType } from '@/lib/notifications/scheduleChangeEmail';

export interface NotifyPayload {
  subject: string;
  message: string;     // the editable body (maps to the email's change description)
  reason: string;      // optional admin note
  recipients: string[]; // included emails only
}
interface RecipientInfo { email: string; name: string; role: 'learner' | 'trainer'; }

interface Props {
  courseRunId: string;
  changeType: ScheduleChangeType;
  summary: string;
  onChange: (payload: NotifyPayload | null) => void;
}

const NotifyComposer: React.FC<Props> = ({ courseRunId, changeType, summary, onChange }) => {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [subject, setSubject] = useState('');
  const [message, setMessage] = useState(summary);
  const [reason, setReason] = useState('');
  const [recipients, setRecipients] = useState<RecipientInfo[]>([]);
  const [excluded, setExcluded] = useState<Set<string>>(new Set());
  const [html, setHtml] = useState('');
  const [showPreview, setShowPreview] = useState(true);
  const previewTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Build the preview (and recipient list on first load).
  const loadPreview = useCallback(async (withRecipients: boolean) => {
    const params = new URLSearchParams({ courseRunId, changeType, summary: message, reason, subject });
    try {
      const res = await fetch(getApiUrl(`/api/admin/notify-schedule-change?${params}`));
      const d = await res.json();
      if (!d?.success) { setError(d?.error || 'Could not load preview'); return; }
      setHtml(d.html || '');
      if (withRecipients) {
        setRecipients(d.recipients || []);
        if (!subject) setSubject(d.subject || '');
      }
      setError('');
    } catch {
      setError('Could not load preview');
    }
  }, [courseRunId, changeType, message, reason, subject]);

  // Initial load: recipients + defaults + preview.
  useEffect(() => {
    let alive = true;
    (async () => {
      setLoading(true);
      const params = new URLSearchParams({ courseRunId, changeType, summary: message, reason });
      try {
        const res = await fetch(getApiUrl(`/api/admin/notify-schedule-change?${params}`));
        const d = await res.json();
        if (!alive) return;
        if (!d?.success) { setError(d?.error || 'Could not load recipients'); }
        else {
          setRecipients(d.recipients || []);
          setSubject((prev) => prev || d.subject || '');
          setHtml(d.html || '');
          setError('');
        }
      } catch { if (alive) setError('Could not load recipients'); }
      finally { if (alive) setLoading(false); }
    })();
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [courseRunId, changeType]);

  // Debounced preview refresh when the editable fields change.
  useEffect(() => {
    if (loading) return;
    if (previewTimer.current) clearTimeout(previewTimer.current);
    previewTimer.current = setTimeout(() => { void loadPreview(false); }, 500);
    return () => { if (previewTimer.current) clearTimeout(previewTimer.current); };
  }, [subject, message, reason, loading, loadPreview]);

  // Report the current payload upward whenever it changes.
  useEffect(() => {
    if (loading) { onChange(null); return; }
    const included = recipients.filter((r) => !excluded.has(r.email)).map((r) => r.email);
    onChange({ subject, message, reason, recipients: included });
  }, [subject, message, reason, recipients, excluded, loading, onChange]);

  const toggle = (email: string) => setExcluded((prev) => {
    const n = new Set(prev); if (n.has(email)) n.delete(email); else n.add(email); return n;
  });
  const includedCount = recipients.length - excluded.size;
  const inputCls = 'w-full border border-gray-300 dark:border-gray-600 rounded-md px-2 py-1.5 text-sm dark:bg-gray-700 dark:text-white';

  if (loading) {
    return <div className="text-sm text-gray-500 dark:text-gray-400 flex items-center gap-2 py-2"><span className="animate-spin rounded-full h-4 w-4 border-b-2 border-blue-500" /> Loading recipients & preview…</div>;
  }

  return (
    <div className="space-y-3">
      {error && <div className="text-sm text-red-600 dark:text-red-400">{error}</div>}

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {/* Editable email */}
        <div className="space-y-2">
          <div>
            <label className="block text-xs font-medium text-gray-600 dark:text-gray-300 mb-1">Subject</label>
            <input type="text" value={subject} onChange={(e) => setSubject(e.target.value)} className={inputCls} />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-600 dark:text-gray-300 mb-1">Message</label>
            <textarea value={message} onChange={(e) => setMessage(e.target.value)} rows={3} className={inputCls} />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-600 dark:text-gray-300 mb-1">Note (optional)</label>
            <input type="text" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. trainer unavailable" className={inputCls} />
          </div>

          {/* Recipients */}
          <div>
            <div className="flex items-center justify-between mb-1">
              <label className="block text-xs font-medium text-gray-600 dark:text-gray-300">Recipients ({includedCount}/{recipients.length})</label>
              {recipients.length > 0 && (
                <button type="button" onClick={() => setExcluded((prev) => prev.size === 0 ? new Set(recipients.map((r) => r.email)) : new Set())}
                  className="text-xs text-blue-600 dark:text-blue-400 hover:underline">{excluded.size === 0 ? 'Deselect all' : 'Select all'}</button>
              )}
            </div>
            {recipients.length === 0 ? (
              <div className="text-xs text-gray-400 border border-dashed border-gray-200 dark:border-gray-700 rounded-md px-2 py-1.5">No confirmed learners or accepted trainers to notify.</div>
            ) : (
              <div className="max-h-32 overflow-auto border border-gray-200 dark:border-gray-700 rounded-md divide-y divide-gray-100 dark:divide-gray-800">
                {recipients.map((r) => (
                  <label key={r.email} className="flex items-center gap-2 px-2 py-1.5 text-sm cursor-pointer hover:bg-gray-50 dark:hover:bg-gray-700/40">
                    <input type="checkbox" checked={!excluded.has(r.email)} onChange={() => toggle(r.email)} className="h-4 w-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500" />
                    <span className="flex-1 min-w-0 truncate text-gray-800 dark:text-gray-200">{r.name}</span>
                    <span className={`text-[10px] uppercase px-1.5 py-0.5 rounded ${r.role === 'trainer' ? 'bg-purple-100 text-purple-700 dark:bg-purple-900/40 dark:text-purple-300' : 'bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300'}`}>{r.role}</span>
                    <span className="text-gray-500 dark:text-gray-400 truncate max-w-[40%]">{r.email}</span>
                  </label>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Live preview */}
        <div>
          <div className="flex items-center justify-between mb-1">
            <label className="block text-xs font-medium text-gray-600 dark:text-gray-300">Email preview</label>
            <button type="button" onClick={() => setShowPreview((s) => !s)} className="text-xs text-blue-600 dark:text-blue-400 hover:underline">{showPreview ? 'Hide' : 'Show'}</button>
          </div>
          {showPreview && (
            html ? (
              <iframe title="Email preview" srcDoc={html} sandbox="" className="w-full h-72 border border-gray-200 dark:border-gray-700 rounded-md bg-white" />
            ) : <div className="text-xs text-gray-400 h-72 flex items-center justify-center border border-dashed border-gray-200 dark:border-gray-700 rounded-md">Preview unavailable.</div>
          )}
        </div>
      </div>
    </div>
  );
};

export default NotifyComposer;
