/**
 * MoveClassModal — move a whole class's learners + trainer onto another existing
 * run of the SAME course (the "reschedule to a different run" flow), surfaced
 * inside the top-level Reschedule & Cancel page. Reuses the existing endpoints:
 *   GET  /api/admin/sibling-course-runs   (target-run picker)
 *   GET  /api/admin/reschedule-learners   (learner list, incl. removed)
 *   POST /api/admin/move-class-to-run      (the move; LOCAL DB + opt-in calendar)
 *
 * SSG/TPG enrolment + trainer re-assignment is NOT done here (KIV) — the warning
 * banner makes that explicit.
 */
import React, { useEffect, useState } from 'react';
import { Button } from '../ui/Button';
import { getApiUrl } from '@/lib/urlHelpers';

interface SiblingRun {
  id: string; courseRunId: string; startDate: string; endDate: string;
  classStatus: string; assignedTrainerName: string | null; enrolledCount: number;
}

/** YYYY-MM-DD in local TZ. Parses the full ISO value so SGT-midnight dates that the
 * API serialized to UTC don't render one day early (matches the rest of the app). */
const ymd = (s: string) => {
  const d = new Date(s);
  return isNaN(d.getTime()) ? String(s).slice(0, 10) : d.toLocaleDateString('en-CA');
};
interface Learner { learnerName: string; learnerEmail: string; isRemoved?: boolean; is_removed?: boolean; enrolment_status?: string; }

interface Props {
  run: { id: string; courseRunId: string; courseTitle: string; courseCode: string; assignedTrainerLocal?: string; assignedTrainerTpg?: string };
  defaultSyncCalendar: boolean;
  onClose: () => void;
  onDone: () => void;
  showConfirmPopup: (message: string, onConfirm: () => void, title?: string, confirmText?: string, cancelText?: string) => void;
  showSuccessPopup: (message: string) => void;
  showErrorPopup: (message: string) => void;
}

const MoveClassModal: React.FC<Props> = ({ run, defaultSyncCalendar, onClose, onDone, showConfirmPopup, showSuccessPopup, showErrorPopup }) => {
  const [siblings, setSiblings] = useState<SiblingRun[]>([]);
  const [includeHistorical, setIncludeHistorical] = useState(false);
  const [targetRunId, setTargetRunId] = useState('');
  const [trainerName, setTrainerName] = useState(run.assignedTrainerLocal || run.assignedTrainerTpg || '');
  const [learners, setLearners] = useState<Learner[]>([]);
  const [trainers, setTrainers] = useState<{ trainer_name: string }[]>([]);
  const [excluded, setExcluded] = useState<Set<string>>(new Set());
  const [syncCalendar, setSyncCalendar] = useState(defaultSyncCalendar);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const loadSiblings = async (hist: boolean) => {
    try {
      const res = await fetch(getApiUrl(`/api/admin/sibling-course-runs?courseRunUuid=${encodeURIComponent(run.id)}&includeHistorical=${hist}`));
      const data = await res.json();
      if (data?.success) setSiblings(data.data || []);
    } catch { /* non-fatal */ }
  };

  useEffect(() => {
    (async () => {
      setLoading(true);
      await loadSiblings(false);
      try {
        const lr = await fetch(getApiUrl(`/api/admin/reschedule-learners?courseRunUuid=${encodeURIComponent(run.id)}`));
        const ld = await lr.json();
        if (ld?.success) setLearners((ld.data || []).filter((l: Learner) => !(l.isRemoved ?? l.is_removed)));
      } catch { /* non-fatal */ }
      try {
        const tr = await fetch(getApiUrl('/api/admin/trainers'));
        const td = await tr.json();
        if (td?.success) setTrainers(td.data?.trainers || []);
      } catch { /* non-fatal */ }
      setLoading(false);
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [run.id]);

  const toggleExclude = (email: string) => {
    setExcluded((prev) => { const n = new Set(prev); if (n.has(email)) n.delete(email); else n.add(email); return n; });
  };

  const doMove = async (force: boolean) => {
    setSaving(true);
    try {
      const res = await fetch(getApiUrl('/api/admin/move-class-to-run'), {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sourceRunId: run.id,
          targetRunId,
          trainerName: trainerName.trim(),
          removedLearnerEmails: Array.from(excluded),
          force,
          syncCalendar,
        }),
      });
      const json = await res.json();
      if (!json?.success) {
        if (json?.code === 'SUBMISSION_EXISTS') {
          setSaving(false);
          showConfirmPopup(
            `${json.message || 'A learner has submitted assessment files for this run.'}\n\nForce the move anyway?`,
            () => { void doMove(true); }, 'Submitted assessments exist', 'Force move', 'Back',
          );
          return;
        }
        throw new Error(json?.error || 'Move failed');
      }
      const s = json.summary || {};
      let calMsg = '';
      if (syncCalendar) {
        const cal = json.calendar;
        if (cal?.error) calMsg = `\nCalendar update failed: ${cal.error}`;
        else if (cal?.target || cal?.source) {
          const srcPart = cal.sourceEventsRemoved ? `old events removed (${cal.source?.removed ?? 0})` : `−${cal.source?.removed ?? 0} attendee(s)`;
          calMsg = `\nCalendar: target +${cal.target?.added ?? 0} on new events, this run ${srcPart}.`;
        }
      }
      const summaryMsg = `Moved ${s.moved ?? 0} learner(s)${s.removed ? `, ${s.removed} removed` : ''}${s.skippedConflicts?.length ? `, ${s.skippedConflicts.length} already in target (removed from this run)` : ''}. Trainer on target: ${s.trainerTarget || 'none'}.${calMsg}`;
      onDone();
      onClose();

      // Option B: if the move VACATED the source run but calendar sync was OFF, the
      // source's old Google Calendar events are now orphaned (still on the calendar
      // with no learners/trainer). Highlight it and offer to remove them.
      if (!syncCalendar && s.sourceVacated) {
        showConfirmPopup(
          `${summaryMsg}\n\n⚠️ This run (run ${run.courseRunId}) is now vacated — all learners moved out — but its old Google Calendar events were NOT removed (calendar sync was off). Remove them now?`,
          async () => {
            try {
              const r = await fetch(getApiUrl('/api/admin/remove-run-calendar'), {
                method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ courseRunId: run.id }),
              });
              const j = await r.json();
              if (j?.success) showSuccessPopup(`Removed ${j.removed ?? 0} old calendar event(s) from the vacated run.`);
              else showErrorPopup(`Could not remove old events: ${j?.error || 'unknown'}`);
            } catch (e: any) {
              showErrorPopup('Failed to remove old events: ' + (e?.message || 'unknown error'));
            } finally {
              onDone();
            }
          },
          'Remove orphaned calendar events?', 'Remove old events', 'Keep them',
        );
      } else {
        showSuccessPopup(summaryMsg);
      }
    } catch (e: any) {
      showErrorPopup('Failed to move class: ' + (e?.message || 'unknown error'));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
      <div className="bg-white dark:bg-gray-800 rounded-lg shadow-xl max-w-2xl w-full border dark:border-gray-700 max-h-[90vh] overflow-auto">
        <div className="p-5 border-b border-gray-200 dark:border-gray-700 flex items-center justify-between">
          <div>
            <h3 className="text-lg font-semibold text-gray-900 dark:text-white">Reschedule class to another run</h3>
            <p className="text-xs text-gray-500 dark:text-gray-400">{run.courseTitle} · {run.courseCode} · run {run.courseRunId}</p>
          </div>
          <button type="button" onClick={onClose} className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 text-xl leading-none">×</button>
        </div>

        <div className="p-5 space-y-4">
          <div className="flex items-start gap-2 rounded-md border border-amber-300 dark:border-amber-700 bg-amber-50 dark:bg-amber-900/20 p-3 text-sm text-amber-800 dark:text-amber-300">
            <span aria-hidden className="mt-0.5">⚠️</span>
            <span>This moves learners + trainer in the LMS only{syncCalendar ? ' (and Google Calendar)' : ''}. It does <strong>not</strong> update SSG/TPGateway — you must still move each learner's enrolment and the trainer assignment on TPGateway manually for the new run.</span>
          </div>

          {loading ? (
            <div className="text-sm text-gray-500 dark:text-gray-400 flex items-center gap-2"><span className="animate-spin rounded-full h-4 w-4 border-b-2 border-blue-500" /> Loading…</div>
          ) : (
            <>
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Move to course run *</label>
                <select value={targetRunId} onChange={(e) => setTargetRunId(e.target.value)} className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-md text-sm dark:bg-gray-700 dark:text-white">
                  <option value="">Select a target run…</option>
                  {siblings.map((r) => (
                    <option key={r.id} value={r.id}>{r.courseRunId} · {ymd(r.startDate)}–{ymd(r.endDate)} · {r.classStatus} · {r.enrolledCount} enrolled</option>
                  ))}
                </select>
                <label className="mt-2 flex items-center gap-2 text-sm text-gray-600 dark:text-gray-400 cursor-pointer select-none">
                  <input type="checkbox" checked={includeHistorical} onChange={(e) => { setIncludeHistorical(e.target.checked); void loadSiblings(e.target.checked); }} className="h-4 w-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500" />
                  <span>Include past (historical) runs</span>
                </label>
                {siblings.length === 0 && <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">No {includeHistorical ? '' : 'upcoming '}runs for this course{includeHistorical ? '' : ' — tick "Include past runs"'}.</p>}
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Trainer on target run</label>
                <select value={trainerName} onChange={(e) => setTrainerName(e.target.value)} className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-md text-sm dark:bg-gray-700 dark:text-white">
                  <option value="">— No trainer —</option>
                  {trainerName && !trainers.some((t) => t.trainer_name === trainerName) && (
                    <option value={trainerName}>{trainerName} (current)</option>
                  )}
                  {trainers.map((t, i) => <option key={t.trainer_name || i} value={t.trainer_name}>{t.trainer_name}</option>)}
                </select>
              </div>

              <label className="flex items-center gap-2 text-sm text-gray-700 dark:text-gray-300 cursor-pointer select-none">
                <input type="checkbox" checked={syncCalendar} onChange={(e) => setSyncCalendar(e.target.checked)} className="h-4 w-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500" />
                <span>Also migrate Google Calendar (move attendees onto the target run's events; remove this run's if emptied)</span>
              </label>

              <div>
                <h4 className="text-sm font-semibold text-gray-900 dark:text-white mb-1">Learners ({learners.length})</h4>
                <p className="text-xs text-gray-500 dark:text-gray-400 mb-2">Untick a learner to exclude them from the move (e.g. a last-minute pull-out).</p>
                <div className="border border-gray-200 dark:border-gray-700 rounded-md max-h-48 overflow-auto divide-y divide-gray-100 dark:divide-gray-800">
                  {learners.length === 0 ? (
                    <div className="px-3 py-3 text-sm text-gray-400">No active learners on this run.</div>
                  ) : learners.map((l) => {
                    const email = (l.learnerEmail || '').toLowerCase();
                    const included = !excluded.has(email);
                    return (
                      <label key={email} className="flex items-center gap-2 px-3 py-2 text-sm cursor-pointer">
                        <input type="checkbox" checked={included} onChange={() => toggleExclude(email)} className="h-4 w-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500" />
                        <span className={included ? 'text-gray-800 dark:text-gray-200' : 'text-gray-400 line-through'}>{l.learnerName} <span className="text-gray-400">({l.learnerEmail})</span></span>
                      </label>
                    );
                  })}
                </div>
              </div>
            </>
          )}
        </div>

        <div className="p-5 border-t border-gray-200 dark:border-gray-700 flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <button type="button" disabled={saving || !targetRunId} onClick={() => void doMove(false)}
            className="px-4 py-2 rounded-md text-white bg-blue-600 hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed text-sm">
            {saving ? 'Rescheduling…' : 'Reschedule Class'}
          </button>
        </div>
      </div>
    </div>
  );
};

export default MoveClassModal;
