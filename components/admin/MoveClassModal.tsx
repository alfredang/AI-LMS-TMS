/**
 * MoveClassModal — move a whole class's learners + trainer onto another existing run of the SAME
 * course, surfaced inside the top-level Reschedule & Cancel page. Uses the "Adjust attendees"
 * reconcile-table format: one row per source person with Learner / Trainer / TPG / Calendar.
 *
 *   GET  /api/admin/sibling-course-runs       (target-run picker)
 *   GET  /api/admin/calendar-attendees        (source roster — merged learners + trainers + TPG)
 *   POST /api/admin/move-class-to-run         (the move; preserves enrollment rows + enrolment_id)
 *
 * Learner/Trainer ticked = MOVE that person (via move-class-to-run, which keeps the enrollment +
 * its SSG ref) — NOT a new enrollment. TPG = the one official trainer on TPGateway. Calendar =
 * include on the destination's events (unticking removes them after the move's calendar migration).
 * SSG/TPG learner enrolment is still NOT done here (KIV) — the banner makes that explicit.
 */
import React, { useEffect, useState } from 'react';
import { Button } from '../ui/Button';
import { getApiUrl } from '@/lib/urlHelpers';
import NotifyComposer, { type NotifyPayload } from './NotifyComposer';
import SearchableSelect from '../ui/SearchableSelect';
import { TPG_MANUAL_NOTICE, TPG_MANUAL_NOTICE_ENROLMENTS_ONLY } from '@/lib/ssg/tpgManualNotice';
import { applyAttendeeDiffs, emptyAttendeeDiffs } from '@/lib/calendar/attendeeDiffs';
import { verifyRunCalendarAttendees, describeVerify } from '@/lib/calendar/verifyAttendees';

interface SiblingRun {
  id: string; courseRunId: string; startDate: string; endDate: string;
  classStatus: string; assignedTrainerName: string | null; enrolledCount: number; sessionCount?: number;
}

/** Source roster person (subset of /api/admin/calendar-attendees `people`). */
interface MovePerson { email: string; name: string | null; isLearner: boolean; isTrainer: boolean; isTpgTrainer: boolean; }
interface DraftRow { moveLearner: boolean; moveTrainer: boolean; onTpg: boolean; onCalendar: boolean; }

/** YYYY-MM-DD in local TZ (matches the rest of the app — avoids the UTC off-by-one). */
const ymd = (s: string) => {
  const d = new Date(s);
  return isNaN(d.getTime()) ? String(s).slice(0, 10) : d.toLocaleDateString('en-CA');
};
const keyOf = (e: string) => (e || '').toLowerCase();

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
  const [people, setPeople] = useState<MovePerson[]>([]);
  const [draft, setDraft] = useState<Record<string, DraftRow>>({});
  const [trainers, setTrainers] = useState<{ trainer_name: string; email?: string; has_nric?: boolean }[]>([]);
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
        const tr = await fetch(getApiUrl('/api/admin/trainers'));
        const td = await tr.json();
        if (td?.success) setTrainers(td.data?.trainers || []);
      } catch { /* non-fatal */ }
      try {
        const r = await fetch(getApiUrl(`/api/admin/calendar-attendees?courseRunId=${encodeURIComponent(run.courseRunId)}`));
        const d = await r.json();
        const all: MovePerson[] = (d?.people || []).filter((p: MovePerson) => p.isLearner || p.isTrainer);
        setPeople(all);
        const dr: Record<string, DraftRow> = {};
        for (const p of all) dr[keyOf(p.email)] = { moveLearner: p.isLearner, moveTrainer: p.isTrainer, onTpg: p.isTpgTrainer, onCalendar: true };
        setDraft(dr);
      } catch { /* non-fatal */ }
      setLoading(false);
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [run.id]);

  const draftOf = (p: MovePerson): DraftRow => draft[keyOf(p.email)] || { moveLearner: p.isLearner, moveTrainer: p.isTrainer, onTpg: p.isTpgTrainer, onCalendar: true };
  const hasNric = (email: string) => !!trainers.find((t) => (t.email || '').toLowerCase() === keyOf(email))?.has_nric;

  const toggle = (p: MovePerson, field: 'moveLearner' | 'moveTrainer' | 'onCalendar') => {
    setDraft((prev) => {
      const k = keyOf(p.email);
      const cur = prev[k] || draftOf(p);
      const next = { ...cur, [field]: !cur[field] };
      if (field === 'moveTrainer' && !next.moveTrainer) next.onTpg = false; // can't be the TPG trainer if not carried
      return { ...prev, [k]: next };
    });
  };
  // TPG = ONE official trainer; ticking one unticks the rest and implies the person is carried.
  const toggleTpg = (p: MovePerson) => {
    setDraft((prev) => {
      const k = keyOf(p.email);
      const cur = prev[k] || draftOf(p);
      const turningOn = !cur.onTpg;
      const next: Record<string, DraftRow> = {};
      for (const [kk, v] of Object.entries(prev)) next[kk] = turningOn ? { ...v, onTpg: false } : v;
      next[k] = { ...cur, onTpg: turningOn, moveTrainer: turningOn ? true : cur.moveTrainer };
      return next;
    });
  };
  // Add a trainer who isn't on the source roster (carried onto the destination at the LMS level).
  const addTrainer = (key: string) => {
    const t = trainers.find((x) => (x.email || '') === key || x.trainer_name === key);
    if (!t) return;
    const k = keyOf(t.email || t.trainer_name);
    setPeople((prev) => prev.some((p) => keyOf(p.email || p.name || '') === k) ? prev : [...prev, { email: t.email || '', name: t.trainer_name, isLearner: false, isTrainer: false, isTpgTrainer: false }]);
    setDraft((prev) => ({ ...prev, [k]: { moveLearner: false, moveTrainer: true, onTpg: false, onCalendar: true } }));
  };

  const movingTrainers = people.filter((p) => draftOf(p).moveTrainer);
  const official = people.find((p) => draftOf(p).onTpg) || null;
  const officialEligible = !!official && hasNric(official.email);
  const tpgBlocked = syncTrainerTpg && movingTrainers.length > 0 && (!official || !officialEligible);

  const addOptions = trainers
    .filter((t) => !people.some((p) => (t.email && p.email && keyOf(p.email) === keyOf(t.email)) || p.name === t.trainer_name))
    .map((t) => ({ value: t.email || t.trainer_name, label: `${t.trainer_name}${t.email ? ` (${t.email})` : ''}${t.has_nric === false ? ' — no NRIC' : ''}` }));

  const doMove = async (force: boolean) => {
    setSaving(true);
    try {
      const targetTrainers = people.filter((p) => draftOf(p).moveTrainer).map((p) => ({ name: p.name || p.email, email: p.email }));
      const removedLearnerEmails = people.filter((p) => p.isLearner && !draftOf(p).moveLearner).map((p) => keyOf(p.email));
      const calendarExclude = people.filter((p) => { const d = draftOf(p); return (d.moveLearner || d.moveTrainer) && !d.onCalendar; }).map((p) => p.email);

      const res = await fetch(getApiUrl('/api/admin/move-class-to-run'), {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sourceRunId: run.id,
          targetRunId,
          targetTrainers,
          tpgTargetEmail: official?.email || undefined,
          removedLearnerEmails,
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
      // Per-person calendar exclusions: the move migrates everyone onto the new run's events when Sync
      // is on; remove the people whose Calendar box was unticked (runs after — finds the new event via
      // the durable mapping, so it isn't missed by events.list propagation lag).
      let layerMsg = '';
      if (syncCalendar && calendarExclude.length) {
        try {
          const r = await applyAttendeeDiffs(targetRunId, targetRunId, { ...emptyAttendeeDiffs(), gcalRemove: calendarExclude });
          layerMsg = `\nCalendar: kept ${calendarExclude.length} person(s) off the new run's events (${r.ok} applied${r.fail ? `, ${r.fail} failed` : ''}).`;
        } catch { layerMsg = '\nCalendar: could not apply the per-person calendar exclusions.'; }
      }
      // Don't report done until the new run's calendar reflects the final state — the people kept on
      // calendar are present and the unticked ones are gone. The migration adds the whole roster first,
      // so an early peek can look wrong; this poll waits for it to settle (saving stays true meanwhile).
      let verifyMsg = '';
      if (syncCalendar) {
        const present = people.filter((p) => { const d = draftOf(p); return (d.moveLearner || d.moveTrainer) && d.onCalendar; }).map((p) => p.email);
        const v = await verifyRunCalendarAttendees(targetRunId, { present, absent: calendarExclude });
        const vline = describeVerify(v);
        if (vline) verifyMsg = '\n' + vline;
      }
      let tpgMsg = '';
      if (syncTrainerTpg && json.tpgTrainer && !json.tpgTrainer.skipped) {
        const tgt = json.tpgTrainer.target, src = json.tpgTrainer.source;
        const describeTarget = (rr: any) => {
          switch (rr?.status) {
            case 'synced': return 'trainer assigned ✓';
            case 'skipped_no_trainer': return 'not assigned (no trainer selected)';
            case 'skipped_no_nric': return 'NOT assigned — trainer has no NRIC on file';
            case 'no_tpg_profile': return 'NOT assigned — trainer has no SSG TP profile';
            default: return `NOT assigned — ${rr?.message || 'error'}`;
          }
        };
        const describeSource = (rr: any) => {
          switch (rr?.status) {
            case 'synced': return 'old trainer removed ✓';
            case 'skipped_no_trainer': case 'skipped_no_target': return 'old trainer kept';
            case 'skipped_target_failed': return 'old trainer KEPT (new run assign failed)';
            default: return `error — ${rr?.message || 'unknown'}`;
          }
        };
        tpgMsg = `\n\nTPGateway — new run: ${describeTarget(tgt)}; original run: ${describeSource(src)}.`;
        if (tgt?.status !== 'synced') {
          tpgMsg += `\n⚠️ Trainer was NOT set on the new run in TPGateway — please set it there manually. The original run's trainer was left in place.`;
        }
      }
      const summaryMsg = `Moved ${s.moved ?? 0} learner(s)${s.removed ? `, ${s.removed} removed` : ''}${s.skippedConflicts?.length ? `, ${s.skippedConflicts.length} already in target (removed from this run)` : ''}. Trainer on target: ${s.trainerTarget || 'none'}.${calMsg}${layerMsg}${verifyMsg}${tpgMsg}${syncCalendar ? '\n\n↻ Refresh Google Calendar to see the change — it can take a moment to update.' : ''}`;
      onDone();
      onClose();

      const orphanApplicable = !syncCalendar && !!s.sourceVacated;

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
          () => showSuccessPopup(preface),
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

  const cell = (on: boolean, checked: boolean, onChange: () => void, disabled = false, title?: string) =>
    on ? <input type="checkbox" checked={checked} disabled={saving || disabled} onChange={onChange} className="h-3.5 w-3.5 align-middle" title={title} />
       : <span className="text-[10px] text-gray-300 dark:text-gray-600">—</span>;

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
      <div className="bg-white dark:bg-gray-800 rounded-lg shadow-xl max-w-2xl w-full border dark:border-gray-700 max-h-[90vh] overflow-auto">
        <div className="p-5 border-b border-gray-200 dark:border-gray-700 flex items-center justify-between">
          <div>
            <h3 className="text-lg font-semibold text-gray-900 dark:text-white">Move class to another run</h3>
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

              {/* Sync options — set these first; they enable the matching columns in the table below. */}
              <div className="space-y-2 rounded-md border border-gray-200 dark:border-gray-700 p-3">
                <label className="flex items-center gap-2 text-sm text-gray-700 dark:text-gray-300 cursor-pointer select-none">
                  <input type="checkbox" checked={syncCalendar} onChange={(e) => setSyncCalendar(e.target.checked)} className="h-4 w-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500" />
                  <span>Also update Google Calendar (move attendees to the new run's events; remove this run's if it's left empty) — enables the <strong>Calendar</strong> column</span>
                </label>
                <label className="flex items-center gap-2 text-sm text-gray-700 dark:text-gray-300 cursor-pointer select-none">
                  <input type="checkbox" checked={syncTrainerTpg} onChange={(e) => setSyncTrainerTpg(e.target.checked)} className="h-4 w-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500" />
                  <span>Set the <strong>official</strong> trainer on TPGateway (added to the new run, cleared from the original run) — enables the <strong>TPG</strong> column. Needs the trainer's NRIC + SSG profile.</span>
                </label>
                {tpgBlocked && (
                  <div className="ml-6 text-xs text-red-600 dark:text-red-400">
                    ⚠️ {official ? `${official.name || official.email} has no NRIC on file` : 'No official trainer selected (tick the TPG box for one)'} — pick an eligible official or untick this. The move can still proceed (LMS only).
                  </div>
                )}
                {syncTrainerTpg && !tpgBlocked && official && (
                  <div className="ml-6 text-xs text-gray-500 dark:text-gray-400">{official.name || official.email} will be set as the trainer on TPGateway for the new run; the original run&apos;s trainer is cleared.</div>
                )}
              </div>

              {/* Unified "Adjust attendees" roster table for the move */}
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">People to move</label>
                <p className="text-[11px] text-gray-500 dark:text-gray-400 mb-2">
                  Ticked people move to the new run (keeping their existing enrolment). <strong>Untick to drop someone</strong> —
                  they aren't moved and are removed from the original run, which is being vacated. <strong>TPG</strong> = the one
                  official trainer on TPGateway. <strong>Calendar</strong> = include on the new run's events.
                </p>
                <div className="rounded border border-gray-200 dark:border-gray-700 overflow-hidden">
                  <table className="min-w-full text-xs">
                    <thead className="bg-gray-50 dark:bg-gray-800 text-gray-500 dark:text-gray-400">
                      <tr>
                        <th className="text-left px-2 py-1 font-medium">Person</th>
                        <th className="text-center px-1 py-1 font-medium w-16">Learner</th>
                        <th className="text-center px-1 py-1 font-medium w-16">Trainer</th>
                        <th className={`text-center px-1 py-1 font-medium w-14 ${syncTrainerTpg ? '' : 'opacity-40'}`}>TPG</th>
                        <th className={`text-center px-1 py-1 font-medium w-20 ${syncCalendar ? '' : 'opacity-40'}`}>Calendar</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
                      {people.length === 0 ? (
                        <tr><td colSpan={5} className="px-3 py-3 text-sm text-gray-400">No learners or trainers on this run.</td></tr>
                      ) : people.map((p, i) => {
                        const d = draftOf(p);
                        const isTrainerRow = p.isTrainer || d.moveTrainer;
                        const nric = hasNric(p.email);
                        return (
                          <tr key={p.email || p.name || i} className="align-middle">
                            <td className="px-2 py-1.5">
                              <div className="text-gray-800 dark:text-gray-100 truncate max-w-[15rem]" title={p.email}>{p.name || p.email}</div>
                              {p.name && <div className="text-[10px] text-gray-400 truncate max-w-[15rem]">{p.email || '—'}{isTrainerRow && !nric && <span className="ml-1 text-amber-600 dark:text-amber-400">· no NRIC</span>}</div>}
                            </td>
                            <td className="px-1 py-1.5 text-center">{cell(p.isLearner, d.moveLearner, () => toggle(p, 'moveLearner'), false, 'Move this learner')}</td>
                            <td className="px-1 py-1.5 text-center">{cell(isTrainerRow, d.moveTrainer, () => toggle(p, 'moveTrainer'), false, 'Carry this trainer')}</td>
                            <td className="px-1 py-1.5 text-center">{cell(isTrainerRow, d.onTpg, () => toggleTpg(p), !syncTrainerTpg || !nric, !syncTrainerTpg ? 'Turn on "Set the official trainer on TPGateway" above to choose' : (!nric ? 'No NRIC — not eligible for TPGateway' : 'Official trainer on TPGateway'))}</td>
                            <td className="px-1 py-1.5 text-center">{cell(true, d.onCalendar, () => toggle(p, 'onCalendar'), !syncCalendar, !syncCalendar ? 'Turn on "Also update Google Calendar" above to adjust' : 'Include on the new run\'s Google Calendar events')}</td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
                <div className="mt-2">
                  <SearchableSelect options={addOptions} value="" onChange={addTrainer} placeholder="Add a trainer not on this run…"
                    className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-md text-sm dark:bg-gray-700 dark:text-white" />
                </div>
              </div>

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
            </>
          )}
        </div>

        <div className="p-5 border-t border-gray-200 dark:border-gray-700 flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <button type="button" disabled={saving || !targetRunId || tpgBlocked} onClick={() => void doMove(false)}
            className="px-4 py-2 rounded-md text-white bg-blue-600 hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed text-sm">
            {saving ? 'Moving…' : 'Move class'}
          </button>
        </div>
      </div>
    </div>
  );
};

export default MoveClassModal;
