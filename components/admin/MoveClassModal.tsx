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
import NotifyComposer, { type NotifyPayload } from './NotifyComposer';
import SearchableSelect from '../ui/SearchableSelect';
import { TPG_MANUAL_NOTICE, TPG_MANUAL_NOTICE_ENROLMENTS_ONLY } from '@/lib/ssg/tpgManualNotice';
import { type TrainerTag, TAG_SHORT, TAG_LABELS } from '@/lib/trainers/taggedTrainers';

interface CarryTrainer { name: string; email: string; hasNric: boolean; tags?: TrainerTag[]; }
const TAG_CHIP_CLS: Record<TrainerTag, string> = {
  tpg: 'bg-purple-100 text-purple-700 dark:bg-purple-900/40 dark:text-purple-300',
  accepted: 'bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-300',
  lms: 'bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300',
};
const Chip: React.FC<{ tag: TrainerTag }> = ({ tag }) => (
  <span title={TAG_LABELS[tag]} className={`text-[10px] uppercase px-1.5 py-0.5 rounded font-medium ${TAG_CHIP_CLS[tag]}`}>{TAG_SHORT[tag]}</span>
);

interface SiblingRun {
  id: string; courseRunId: string; startDate: string; endDate: string;
  classStatus: string; assignedTrainerName: string | null; enrolledCount: number; sessionCount?: number;
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
  defaultNotify?: boolean;
  onClose: () => void;
  onDone: () => void;
  showConfirmPopup: (message: string, onConfirm: () => void, title?: string, confirmText?: string, cancelText?: string, onCancel?: () => void) => void;
  showSuccessPopup: (message: string) => void;
  showErrorPopup: (message: string) => void;
}

const MoveClassModal: React.FC<Props> = ({ run, defaultSyncCalendar, defaultNotify, onClose, onDone, showConfirmPopup, showSuccessPopup, showErrorPopup }) => {
  const [siblings, setSiblings] = useState<SiblingRun[]>([]);
  const [includeHistorical, setIncludeHistorical] = useState(false);
  const [targetRunId, setTargetRunId] = useState('');
  // Carry list = trainers to add to the target run at the LMS level. One is the "official"
  // (TPG-assigned / invite target), keyed by email.
  const [carry, setCarry] = useState<CarryTrainer[]>([]);
  const [officialEmail, setOfficialEmail] = useState('');
  const [learners, setLearners] = useState<Learner[]>([]);
  const [trainers, setTrainers] = useState<{ trainer_name: string; email?: string; has_nric?: boolean }[]>([]);
  const [excluded, setExcluded] = useState<Set<string>>(new Set());
  const [syncCalendar, setSyncCalendar] = useState(defaultSyncCalendar);
  const [syncTrainerTpg, setSyncTrainerTpg] = useState(true);
  const [notifyAttendees, setNotifyAttendees] = useState(!!defaultNotify);
  const [notifyPayload, setNotifyPayload] = useState<NotifyPayload | null>(null);
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
      let trainersList: Array<{ trainer_name: string; email?: string; has_nric?: boolean }> = [];
      try {
        const tr = await fetch(getApiUrl('/api/admin/trainers'));
        const td = await tr.json();
        if (td?.success) { trainersList = td.data?.trainers || []; setTrainers(trainersList); }
      } catch { /* non-fatal */ }
      // Prefill the carry list from the source run's CURRENT trainers (tagged), so the existing
      // trainers carry over by default; the admin can add/remove and pick the official one.
      try {
        const dr = await fetch(getApiUrl(`/api/admin/class-details?courseRunId=${encodeURIComponent(run.courseRunId)}`));
        const dd = await dr.json();
        const tagged: Array<{ name: string; email: string | null; tags?: TrainerTag[] }> = dd?.data?.taggedTrainers || [];
        const findNric = (name: string, email: string | null) => {
          const byEmail = email ? trainersList.find((t) => (t.email || '').toLowerCase() === email.toLowerCase()) : undefined;
          const byName = trainersList.find((t) => t.trainer_name === name);
          return !!((byEmail?.has_nric) ?? (byName?.has_nric));
        };
        const init: CarryTrainer[] = tagged.map((t) => ({ name: t.name, email: t.email || '', hasNric: findNric(t.name, t.email), tags: t.tags }));
        setCarry(init);
        const tpgOne = tagged.find((t) => t.tags?.includes('tpg'));
        setOfficialEmail((tpgOne?.email) || init.find((c) => c.email && c.hasNric)?.email || init.find((c) => c.email)?.email || '');
      } catch { /* non-fatal */ }
      setLoading(false);
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [run.id]);

  const toggleExclude = (email: string) => {
    setExcluded((prev) => { const n = new Set(prev); if (n.has(email)) n.delete(email); else n.add(email); return n; });
  };

  const addCarry = (key: string) => {
    const t = trainers.find((x) => (x.email || '') === key || x.trainer_name === key);
    if (!t) return;
    const e = (t.email || '').toLowerCase();
    setCarry((prev) => {
      if (prev.some((c) => (e && (c.email || '').toLowerCase() === e) || c.name === t.trainer_name)) return prev;
      return [...prev, { name: t.trainer_name, email: t.email || '', hasNric: !!t.has_nric }];
    });
  };
  const removeCarry = (idx: number) => setCarry((prev) => {
    const n = [...prev];
    const [r] = n.splice(idx, 1);
    if (r && officialEmail && (r.email || '') === officialEmail) setOfficialEmail('');
    return n;
  });

  // The official trainer (TPG / invite target) must have a usable NRIC for a TPG assignment.
  const officialTrainer = officialEmail ? carry.find((c) => (c.email || '') === officialEmail) : undefined;
  const officialEligible = !!officialTrainer?.hasNric;
  const tpgBlocked = syncTrainerTpg && (!officialTrainer || !officialEligible);

  // Add-trainer options = trainers not already in the carry list.
  const addOptions = trainers
    .filter((t) => !carry.some((c) => (t.email && c.email && c.email.toLowerCase() === t.email.toLowerCase()) || c.name === t.trainer_name))
    .map((t) => ({ value: t.email || t.trainer_name, label: `${t.trainer_name}${t.email ? ` (${t.email})` : ''}${t.has_nric === false ? ' — no NRIC' : ''}` }));

  const doMove = async (force: boolean) => {
    setSaving(true);
    try {
      const res = await fetch(getApiUrl('/api/admin/move-class-to-run'), {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sourceRunId: run.id,
          targetRunId,
          targetTrainers: carry.map((c) => ({ name: c.name, email: c.email })),
          tpgTargetEmail: officialEmail || undefined,
          removedLearnerEmails: Array.from(excluded),
          force,
          syncCalendar,
          syncTrainerToTpg: syncTrainerTpg,
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
          calMsg = `\nCalendar: new run +${cal.target?.added ?? 0}, original run ${srcPart}.`;
        }
      }
      let tpgMsg = '';
      if (syncTrainerTpg && json.tpgTrainer && !json.tpgTrainer.skipped) {
        const tgt = json.tpgTrainer.target, src = json.tpgTrainer.source;
        const describeTarget = (r: any) => {
          switch (r?.status) {
            case 'synced': return 'trainer assigned ✓';
            case 'skipped_no_trainer': return 'not assigned (no trainer selected)';
            case 'skipped_no_nric': return 'NOT assigned — trainer has no NRIC on file';
            case 'no_tpg_profile': return 'NOT assigned — trainer has no SSG TP profile';
            default: return `NOT assigned — ${r?.message || 'error'}`;
          }
        };
        const describeSource = (r: any) => {
          switch (r?.status) {
            case 'synced': return 'old trainer removed ✓';
            case 'skipped_no_trainer': case 'skipped_no_target': return 'old trainer kept';
            case 'skipped_target_failed': return 'old trainer KEPT (new run assign failed)';
            default: return `error — ${r?.message || 'unknown'}`;
          }
        };
        tpgMsg = `\n\nTPGateway — new run: ${describeTarget(tgt)}; original run: ${describeSource(src)}.`;
        if (tgt?.status !== 'synced') {
          tpgMsg += `\n⚠️ Trainer was NOT set on the new run in TPGateway — please set it there manually. The original run's trainer was left in place.`;
        }
      }
      const summaryMsg = `Moved ${s.moved ?? 0} learner(s)${s.removed ? `, ${s.removed} removed` : ''}${s.skippedConflicts?.length ? `, ${s.skippedConflicts.length} already in target (removed from this run)` : ''}. Trainer on target: ${s.trainerTarget || 'none'}.${calMsg}${tpgMsg}`;
      onDone();
      onClose();

      const orphanApplicable = !syncCalendar && !!s.sourceVacated;

      // Send the (composed, if available) class-reschedule notification. Manual: the
      // admin opted in via the checkbox + composed the email before confirming the move.
      const sendNotify = async (): Promise<string> => {
        if (!notifyAttendees) return '';
        const sib = siblings.find((r) => r.id === targetRunId);
        const where = sib ? ` to run ${sib.courseRunId} (${String(sib.startDate).slice(0, 10)}–${String(sib.endDate).slice(0, 10)})` : ' to another run';
        const body = notifyPayload
          ? { courseRunId: targetRunId, changeType: 'class_reschedule', summary: notifyPayload.message, subject: notifyPayload.subject, reason: notifyPayload.reason, recipients: notifyPayload.recipients }
          : { courseRunId: targetRunId, changeType: 'class_reschedule', summary: `Your class "${run.courseTitle}" has been moved${where}.` };
        try {
          const r = await fetch(getApiUrl('/api/admin/notify-schedule-change'), {
            method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
          });
          const j = await r.json();
          return j?.success ? `\n\nNotified ${j.sent ?? 0} attendee(s)${j.failed ? `, ${j.failed} failed` : ''}.` : `\n\nNotification failed: ${j?.error || 'unknown'}`;
        } catch (err: any) { return '\n\nNotification failed: ' + (err?.message || 'unknown error'); }
      };

      const offerOrphan = (preface: string) => {
        showConfirmPopup(
          `⚠️ This run (run ${run.courseRunId}) is now empty — all learners moved out — but its old Google Calendar events weren't removed (calendar sync was off). Remove them now?`,
          async () => {
            try {
              const r = await fetch(getApiUrl('/api/admin/remove-run-calendar'), {
                method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ courseRunId: run.id }),
              });
              const j = await r.json();
              if (j?.success) showSuccessPopup(`${preface}\n\nRemoved ${j.removed ?? 0} old calendar event(s) from the original run.`);
              else showErrorPopup(`Could not remove old events: ${j?.error || 'unknown'}`);
            } catch (e: any) {
              showErrorPopup('Failed to remove old events: ' + (e?.message || 'unknown error'));
            } finally { onDone(); }
          },
          'Remove orphaned calendar events?', 'Remove old events', 'Keep them',
          () => showSuccessPopup(preface), // skipping orphan removal still shows the move + notify result
        );
      };

      const baseMsg = summaryMsg + await sendNotify();
      if (orphanApplicable) setTimeout(() => offerOrphan(baseMsg), 0);
      else showSuccessPopup(baseMsg);
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
            <span>{syncTrainerTpg ? TPG_MANUAL_NOTICE_ENROLMENTS_ONLY : TPG_MANUAL_NOTICE}</span>
          </div>

          {loading ? (
            <div className="text-sm text-gray-500 dark:text-gray-400 flex items-center gap-2"><span className="animate-spin rounded-full h-4 w-4 border-b-2 border-blue-500" /> Loading…</div>
          ) : (
            <>
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Move to course run *</label>
                <select value={targetRunId} onChange={(e) => setTargetRunId(e.target.value)} className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-md text-sm dark:bg-gray-700 dark:text-white">
                  <option value="">Select the new run…</option>
                  {siblings.map((r) => (
                    <option key={r.id} value={r.id}>{r.courseRunId} · {ymd(r.startDate)}–{ymd(r.endDate)} · {r.classStatus} · {r.enrolledCount} enrolled · {r.sessionCount ?? 0} session{(r.sessionCount ?? 0) === 1 ? '' : 's'}</option>
                  ))}
                </select>
                {targetRunId && (siblings.find((s) => s.id === targetRunId)?.sessionCount ?? 0) === 0 && (
                  <p className="mt-1 text-xs text-amber-600 dark:text-amber-400">⚠️ This run has no scheduled sessions — the class won&apos;t appear on the calendar until it&apos;s scheduled (the move transfers people, not the dates).</p>
                )}
                <label className="mt-2 flex items-center gap-2 text-sm text-gray-600 dark:text-gray-400 cursor-pointer select-none">
                  <input type="checkbox" checked={includeHistorical} onChange={(e) => { setIncludeHistorical(e.target.checked); void loadSiblings(e.target.checked); }} className="h-4 w-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500" />
                  <span>Include past (historical) runs</span>
                </label>
                {siblings.length === 0 && <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">No {includeHistorical ? '' : 'upcoming '}runs for this course{includeHistorical ? '' : ' — tick "Include past runs"'}.</p>}
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Trainers on the new run (TMS-LMS)</label>
                <div className="border border-gray-200 dark:border-gray-700 rounded-md divide-y divide-gray-100 dark:divide-gray-800">
                  {carry.length === 0 ? (
                    <div className="px-3 py-2 text-sm text-gray-400">No trainers — add one below, or move with no trainer.</div>
                  ) : carry.map((t, i) => (
                    <div key={(t.email || t.name) + i} className="flex items-center gap-2 px-3 py-2 text-sm">
                      <label className="flex items-center gap-1 cursor-pointer shrink-0" title={!t.email ? 'No email — cannot be the official trainer' : (syncTrainerTpg && !t.hasNric) ? 'No NRIC on file — not eligible for TPGateway' : 'Official trainer (on TPGateway)'}>
                        <input type="radio" name="official-trainer" checked={!!t.email && officialEmail === t.email} disabled={!t.email || (syncTrainerTpg && !t.hasNric)} onChange={() => setOfficialEmail(t.email)} className="h-4 w-4 text-blue-600 focus:ring-blue-500 disabled:opacity-40" />
                        <span className="text-[10px] uppercase text-gray-500 dark:text-gray-400">official</span>
                      </label>
                      <span className="flex-1 min-w-0 truncate text-gray-800 dark:text-gray-200">{t.name}</span>
                      {t.tags?.map((tag) => <Chip key={tag} tag={tag} />)}
                      {!t.hasNric && <span className="text-[10px] px-1.5 py-0.5 rounded bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300">no NRIC</span>}
                      <span className="text-gray-500 dark:text-gray-400 text-xs max-w-[30%] truncate">{t.email || '—'}</span>
                      <button type="button" onClick={() => removeCarry(i)} className="text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/20 rounded px-1.5 shrink-0" title="Remove from list">×</button>
                    </div>
                  ))}
                </div>
                <div className="mt-2">
                  <SearchableSelect options={addOptions} value="" onChange={addCarry} placeholder="Add a trainer…"
                    className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-md text-sm dark:bg-gray-700 dark:text-white" />
                </div>
                <p className="text-xs text-gray-400 mt-1">Pick the <strong>official</strong> trainer (assigned on TPGateway / re-invited). The rest get TMS-LMS access only.</p>
              </div>

              <label className="flex items-center gap-2 text-sm text-gray-700 dark:text-gray-300 cursor-pointer select-none">
                <input type="checkbox" checked={syncCalendar} onChange={(e) => setSyncCalendar(e.target.checked)} className="h-4 w-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500" />
                <span>Also update Google Calendar (move attendees to the new run's events; remove this run's if it's left empty)</span>
              </label>
              <label className="flex items-center gap-2 text-sm text-gray-700 dark:text-gray-300 cursor-pointer select-none">
                <input type="checkbox" checked={syncTrainerTpg} onChange={(e) => setSyncTrainerTpg(e.target.checked)} className="h-4 w-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500" />
                <span>Set the <strong>official</strong> trainer on TPGateway (added to the new run, cleared from the original run). Needs the trainer's NRIC + SSG profile.</span>
              </label>
              {tpgBlocked && (
                <div className="-mt-2 ml-6 text-xs text-red-600 dark:text-red-400">
                  ⚠️ {officialTrainer ? `${officialTrainer.name} has no NRIC on file` : 'No eligible official trainer selected'} — pick an eligible official above or untick this. The move can still proceed (LMS only).
                </div>
              )}
              {syncTrainerTpg && !tpgBlocked && officialTrainer && (
                <div className="-mt-2 ml-6 text-xs text-gray-500 dark:text-gray-400">{officialTrainer.name} will be set as the trainer on TPGateway for the new run; the original run&apos;s trainer is cleared.</div>
              )}
              <label className="flex items-center gap-2 text-sm text-gray-700 dark:text-gray-300 cursor-pointer select-none">
                <input type="checkbox" checked={notifyAttendees} onChange={(e) => setNotifyAttendees(e.target.checked)} className="h-4 w-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500" />
                <span>Notify attendees by email — review &amp; edit the email and choose recipients below; sent after you confirm the move (never automatic)</span>
              </label>
              {notifyAttendees && (
                targetRunId ? (
                  <div className="rounded-md border border-gray-200 dark:border-gray-700 p-3">
                    <NotifyComposer courseRunId={targetRunId} changeType="class_reschedule" summary={`Your class "${run.courseTitle}" has been moved to a new run.`} onChange={setNotifyPayload} />
                  </div>
                ) : (
                  <p className="text-xs text-gray-500 dark:text-gray-400">Select the new run above to set up the email.</p>
                )
              )}

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
          <button type="button" disabled={saving || !targetRunId || tpgBlocked} onClick={() => void doMove(false)}
            className="px-4 py-2 rounded-md text-white bg-blue-600 hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed text-sm">
            {saving ? 'Rescheduling…' : 'Reschedule Class'}
          </button>
        </div>
      </div>
    </div>
  );
};

export default MoveClassModal;
