import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { getApiUrl } from '@/lib/urlHelpers';
import { type AttendeeDiffs, applyAttendeeDiffs } from '@/lib/calendar/attendeeDiffs';

/**
 * Shared "Calendar attendees" panel.
 *
 *  - VIEW mode: the run's current Google Calendar attendees (per event) + "Open in Google
 *    Calendar" links and an add-attendee box.
 *  - RECONCILE mode (opened by "Sync attendees"): a single merged per-email table combining
 *    the LMS roster (learners + trainers, a person can be BOTH) with the Google Calendar
 *    attendees. Per email the admin sets the desired end-state on each system — Learner,
 *    Trainer, Calendar — and resolves discrepancies both ways in one Apply step (with a
 *    confirmation summary). A calendar attendee not in the LMS can be added as learner and/or
 *    trainer ONLY when the email belongs to a TMS user holding that role (canAdd* flags).
 *    Nothing is changed silently; no emails are sent.
 *
 * Writes are env-guarded server-side (ENABLE_CALENDAR_WRITES). LMS ops: assign-student /
 * remove-enrollment (learner), update-trainer-info / remove-trainer (trainer); all pass
 * syncCalendar:false so the Calendar column alone owns the GCal side. GCal ops:
 * calendar-attendees.
 */
interface RunAttendee { email: string; displayName: string | null; responseStatus: string | null; classification: 'desired' | 'departed' | 'external'; }
interface RunEventAttendees { eventId: string; htmlLink: string | null; openUrl: string | null; date: string | null; summary: string | null; attendees: RunAttendee[]; }
interface ReconPerson {
  email: string; name: string | null;
  isLearner: boolean; isTrainer: boolean; isTpgTrainer: boolean; lmsStatus: string | null; junctionId: string | null;
  onGcal: boolean; gcalOnCount: number; responseStatus: string | null;
  userId: string | null; canAddLearner: boolean; canAddTrainer: boolean;
}

interface Props {
  courseRunId: string;          // uuid or SSG run id
  /** Called after any successful write so the host can refresh its own calendar view. */
  onChanged?: () => void;
  className?: string;
  /**
   * STAGED mode (used inside the reschedule confirm): don't apply immediately — render the
   * reconcile table only and emit the pending diffs to the parent, which commits them after the
   * reschedule. Standalone mode (default) applies immediately with its own Apply + confirm.
   */
  staged?: boolean;
  onStagedChange?: (diffs: AttendeeDiffs, runUuid: string | null) => void;
}

interface DraftState { isLearner: boolean; isTrainer: boolean; onTpg: boolean; onGcal: boolean; }

const RSVP_META: Record<string, { label: string; cls: string }> = {
  accepted: { label: 'Accepted', cls: 'text-green-600 dark:text-green-400' },
  declined: { label: 'Declined', cls: 'text-red-600 dark:text-red-400' },
  tentative: { label: 'Maybe', cls: 'text-amber-600 dark:text-amber-400' },
  needsAction: { label: 'No reply', cls: 'text-gray-400 dark:text-gray-500' },
};
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const keyOf = (e: string) => e.toLowerCase();

const CalendarAttendeesPanel: React.FC<Props> = ({ courseRunId, onChanged, className, staged = false, onStagedChange }) => {
  const [loading, setLoading] = useState(true);
  const [status, setStatus] = useState<'ok' | 'skipped'>('ok');
  const [reason, setReason] = useState<string | null>(null);
  const [writesEnabled, setWritesEnabled] = useState(false);
  const [events, setEvents] = useState<RunEventAttendees[]>([]);
  const [people, setPeople] = useState<ReconPerson[]>([]);
  const [runUuid, setRunUuid] = useState<string | null>(null);
  const [newEmail, setNewEmail] = useState('');
  const [mode, setMode] = useState<'view' | 'reconcile'>('view');
  const [draft, setDraft] = useState<Record<string, DraftState>>({});
  const [confirming, setConfirming] = useState<null | { kind: 'add'; email: string } | { kind: 'apply' }>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ text: string; ok: boolean } | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const r = await fetch(getApiUrl(`/api/admin/calendar-attendees?courseRunId=${encodeURIComponent(courseRunId)}`));
      const d = await r.json();
      if (d?.success) {
        setStatus(d.status); setReason(d.reason || null); setWritesEnabled(!!d.writesEnabled);
        setEvents(d.events || []); setPeople(d.people || []); setRunUuid(d.courseRunUuid || null);
        if (staged) {
          // Staged mode goes straight into the reconcile table, draft = current state.
          const dr: Record<string, DraftState> = {};
          for (const p of (d.people || [])) dr[keyOf(p.email)] = { isLearner: p.isLearner, isTrainer: p.isTrainer, onTpg: p.isTpgTrainer, onGcal: p.onGcal };
          setDraft(dr); setMode('reconcile');
        }
      } else {
        setStatus('skipped'); setReason(d?.error || 'Failed to load attendees'); setEvents([]); setPeople([]);
      }
    } catch (e: any) {
      setStatus('skipped'); setReason(e?.message || 'Failed to load attendees'); setEvents([]); setPeople([]);
    } finally {
      setLoading(false);
    }
  }, [courseRunId, staged]);

  useEffect(() => { void load(); }, [load]);

  const openReconcile = () => {
    const d: Record<string, DraftState> = {};
    for (const p of people) d[keyOf(p.email)] = { isLearner: p.isLearner, isTrainer: p.isTrainer, onTpg: p.isTpgTrainer, onGcal: p.onGcal };
    setDraft(d); setMsg(null); setConfirming(null); setMode('reconcile');
  };

  const diffs = useMemo(() => {
    const learnerAdd: ReconPerson[] = [], learnerRemove: ReconPerson[] = [];
    const trainerAdd: ReconPerson[] = [], trainerRemove: ReconPerson[] = [];
    const gcalAdd: string[] = [], gcalRemove: string[] = [];
    for (const p of people) {
      const d = draft[keyOf(p.email)];
      if (!d) continue;
      if (!p.isLearner && d.isLearner) learnerAdd.push(p);
      if (p.isLearner && !d.isLearner) learnerRemove.push(p);
      if (!p.isTrainer && d.isTrainer) trainerAdd.push(p);
      if (p.isTrainer && !d.isTrainer) trainerRemove.push(p);
      if (!p.onGcal && d.onGcal) gcalAdd.push(p.email);
      if (p.onGcal && !d.onGcal) gcalRemove.push(p.email);
    }
    // TPG is a single official trainer per run. Diff current official vs. the one ticked.
    const curOfficial = people.find((p) => p.isTpgTrainer) || null;
    const tgtOfficial = people.find((p) => draft[keyOf(p.email)]?.onTpg) || null;
    const tpgChanged = (curOfficial?.email.toLowerCase() || null) !== (tgtOfficial?.email.toLowerCase() || null);
    const tpgPush = tpgChanged && tgtOfficial ? tgtOfficial : null;
    const tpgClear = tpgChanged && !tgtOfficial;
    return { learnerAdd, learnerRemove, trainerAdd, trainerRemove, gcalAdd, gcalRemove, tpgPush, tpgClear };
  }, [people, draft]);
  const diffCount = diffs.learnerAdd.length + diffs.learnerRemove.length + diffs.trainerAdd.length + diffs.trainerRemove.length + diffs.gcalAdd.length + diffs.gcalRemove.length + (diffs.tpgPush ? 1 : 0) + (diffs.tpgClear ? 1 : 0);

  // Serializable form — used to apply (standalone) and to emit upward (staged).
  const serialized: AttendeeDiffs = useMemo(() => ({
    learnerAdd: diffs.learnerAdd.map((p) => ({ email: p.email, userId: p.userId })),
    learnerRemove: diffs.learnerRemove.map((p) => ({ email: p.email })),
    trainerAdd: diffs.trainerAdd.map((p) => ({ email: p.email, name: p.name, userId: p.userId })),
    trainerRemove: diffs.trainerRemove.map((p) => ({ email: p.email, junctionId: p.junctionId })),
    tpgPush: diffs.tpgPush ? { email: diffs.tpgPush.email } : null,
    tpgClear: diffs.tpgClear,
    gcalAdd: diffs.gcalAdd,
    gcalRemove: diffs.gcalRemove,
  }), [diffs]);

  // Staged mode: hand the pending diffs (+ resolved run UUID) to the parent on every change.
  useEffect(() => { if (staged) onStagedChange?.(serialized, runUuid); }, [staged, serialized, runUuid, onStagedChange]);

  const toggle = (p: ReconPerson, field: 'isLearner' | 'isTrainer' | 'onGcal') => {
    setDraft((prev) => {
      const k = keyOf(p.email);
      const cur = prev[k] || { isLearner: p.isLearner, isTrainer: p.isTrainer, onTpg: p.isTpgTrainer, onGcal: p.onGcal };
      const next = { ...cur, [field]: !cur[field] };
      // Unticking the local Trainer role also drops them from TPG (can't be the TPG trainer without being a trainer).
      if (field === 'isTrainer' && !next.isTrainer) next.onTpg = false;
      return { ...prev, [k]: next };
    });
  };

  // TPG = ONE official trainer per run; ticking one unticks the rest. Ticking implies local-trainer.
  const toggleTpg = (p: ReconPerson) => {
    setDraft((prev) => {
      const k = keyOf(p.email);
      const cur = prev[k] || { isLearner: p.isLearner, isTrainer: p.isTrainer, onTpg: p.isTpgTrainer, onGcal: p.onGcal };
      const turningOn = !cur.onTpg;
      const next: Record<string, DraftState> = {};
      for (const [kk, v] of Object.entries(prev)) next[kk] = turningOn ? { ...v, onTpg: false } : v;
      next[k] = { ...cur, onTpg: turningOn, isTrainer: turningOn ? true : cur.isTrainer };
      return next;
    });
  };

  const postJson = (url: string, body: any) => fetch(getApiUrl(url), {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  }).then((r) => r.json());

  const runApply = useCallback(async () => {
    setBusy(true); setMsg(null);
    try {
      const { ok, fail, fails } = await applyAttendeeDiffs(courseRunId, runUuid, serialized);
      setMsg({ ok: fail === 0, text: `Applied ${ok} change${ok === 1 ? '' : 's'}${fail ? `, ${fail} failed (${fails.join(', ')})` : ''}.` });
      await load(); onChanged?.(); setMode('view');
    } catch (e: any) {
      setMsg({ ok: false, text: e?.message || 'Apply failed' });
    } finally {
      setBusy(false); setConfirming(null);
    }
  }, [serialized, runUuid, courseRunId, load, onChanged]);

  const runAdd = useCallback(async (email: string) => {
    setBusy(true); setMsg(null);
    try {
      const j = await postJson('/api/admin/calendar-attendees', { courseRunId, email, action: 'add' });
      if (j?.success && j?.status === 'ok') { setMsg({ ok: true, text: `Added ${email} on ${j.changed}/${j.events} event(s).` }); setNewEmail(''); }
      else setMsg({ ok: false, text: `Not added: ${j?.reason || j?.error || 'unknown'}` });
      await load(); onChanged?.();
    } catch (e: any) {
      setMsg({ ok: false, text: e?.message || 'Add failed' });
    } finally {
      setBusy(false); setConfirming(null);
    }
  }, [courseRunId, load, onChanged]);

  const total = events.reduce((n, e) => n + e.attendees.length, 0);

  const draftOf = (p: ReconPerson): DraftState => draft[keyOf(p.email)] || { isLearner: p.isLearner, isTrainer: p.isTrainer, onTpg: p.isTpgTrainer, onGcal: p.onGcal };

  const lmsCell = (p: ReconPerson, role: 'learner' | 'trainer') => {
    const d = draftOf(p);
    const isOn = role === 'learner' ? p.isLearner : p.isTrainer;
    const canAdd = role === 'learner' ? p.canAddLearner : p.canAddTrainer;
    const field = role === 'learner' ? 'isLearner' : 'isTrainer';
    const drafted = role === 'learner' ? d.isLearner : d.isTrainer;
    if (!isOn && !canAdd) {
      return <span className="text-[10px] text-gray-300 dark:text-gray-600" title={`Not a ${role} in the system — can't add here`}>—</span>;
    }
    return (
      <input type="checkbox" disabled={!writesEnabled || busy} checked={drafted} onChange={() => toggle(p, field)}
        className="h-3.5 w-3.5 align-middle" title={isOn ? (role === 'learner' ? (p.lmsStatus || 'learner') : 'trainer') : `Add as ${role}`} />
    );
  };

  const tpgCell = (p: ReconPerson) => {
    const d = draftOf(p);
    const eligible = d.isTrainer || p.isTpgTrainer || p.canAddTrainer; // must be (becoming) a trainer to be on TPG
    if (!eligible) return <span className="text-[10px] text-gray-300 dark:text-gray-600" title="Only a trainer can be set on TPGateway">—</span>;
    return (
      <input type="checkbox" disabled={!writesEnabled || busy} checked={d.onTpg} onChange={() => toggleTpg(p)}
        className="h-3.5 w-3.5 align-middle" title={p.isTpgTrainer ? 'Trainer on TPGateway' : 'Set as the trainer on TPGateway'} />
    );
  };

  const header = staged ? null : (
    <div className="flex items-center justify-between mb-2">
      <h4 className="text-sm font-semibold text-gray-900 dark:text-white">
        {mode === 'reconcile' ? 'Adjust attendees' : `Google Calendar attendees${events.length > 0 ? ` (${total})` : ''}`}
      </h4>
      <div className="flex items-center gap-2">
        <button onClick={() => void load()} disabled={loading || busy}
          className="text-xs px-2 py-1 rounded border border-gray-300 dark:border-gray-600 text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700 disabled:opacity-50">Refresh</button>
        {mode === 'view' && status === 'ok' && writesEnabled && (
          <button onClick={openReconcile} disabled={busy}
            className="text-xs px-2 py-1 rounded bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50">Adjust attendees</button>
        )}
        {mode === 'reconcile' && (
          <button onClick={() => { setMode('view'); setConfirming(null); }} disabled={busy}
            className="text-xs px-2 py-1 rounded border border-gray-300 dark:border-gray-600 text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700 disabled:opacity-50">Back</button>
        )}
      </div>
    </div>
  );

  return (
    <div className={className}>
      {header}

      {loading ? (
        <p className="text-xs text-gray-400 dark:text-gray-500">Loading attendees…</p>
      ) : status === 'skipped' ? (
        <p className="text-xs text-amber-600 dark:text-amber-400">{reason || 'Calendar unavailable.'}</p>
      ) : mode === 'reconcile' ? (
        <>
          <p className="text-[11px] text-gray-500 dark:text-gray-400 mb-2">
            Tick to keep, untick to remove. Applies to the <strong>whole class</strong> (all its days). No emails are sent.
          </p>
          {!writesEnabled && <p className="text-[11px] text-amber-600 dark:text-amber-400 mb-2">Editing is turned off here — view only.</p>}
          {people.length === 0 ? (
            <p className="text-xs text-gray-400 dark:text-gray-500">No people found for this class.</p>
          ) : (
            <div className="rounded border border-gray-200 dark:border-gray-700 overflow-hidden">
              <table className="min-w-full text-xs">
                <thead className="bg-gray-50 dark:bg-gray-800 text-gray-500 dark:text-gray-400">
                  <tr>
                    <th className="text-left px-2 py-1 font-medium">Person</th>
                    <th className="text-center px-1 py-1 font-medium w-16">Learner<span className="block text-[9px] font-normal text-gray-400 dark:text-gray-500">LMS</span></th>
                    <th className="text-center px-1 py-1 font-medium w-16">Trainer<span className="block text-[9px] font-normal text-gray-400 dark:text-gray-500">LMS</span></th>
                    <th className="text-center px-1 py-1 font-medium w-14">TPG<span className="block text-[9px] font-normal text-gray-400 dark:text-gray-500">SSG</span></th>
                    <th className="text-center px-1 py-1 font-medium w-20">Calendar<span className="block text-[9px] font-normal text-gray-400 dark:text-gray-500">Google</span></th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
                  {people.map((p) => {
                    const d = draftOf(p);
                    const rsvp = p.onGcal ? (RSVP_META[p.responseStatus || 'needsAction'] || RSVP_META.needsAction) : null;
                    return (
                      <tr key={p.email} className="align-middle">
                        <td className="px-2 py-1.5">
                          <div className="flex items-center gap-1.5">
                            <span className="text-gray-800 dark:text-gray-100 truncate max-w-[13rem]" title={p.email}>{p.name || p.email}</span>
                            {p.isTpgTrainer && (
                              <span className={`shrink-0 px-1 py-0.5 rounded text-[9px] font-semibold ${p.isTrainer ? 'bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-300' : 'bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300'}`}
                                title={p.isTrainer ? 'Trainer on TPGateway (also added here)' : 'Trainer on TPGateway — not added here yet; tick Trainer to add'}>TPG{p.isTrainer ? '' : '!'}</span>
                            )}
                          </div>
                          {p.name && <div className="text-[10px] text-gray-400 truncate max-w-[15rem]">{p.email}</div>}
                        </td>
                        <td className="px-1 py-1.5 text-center">{lmsCell(p, 'learner')}</td>
                        <td className="px-1 py-1.5 text-center">{lmsCell(p, 'trainer')}</td>
                        <td className="px-1 py-1.5 text-center">{tpgCell(p)}</td>
                        <td className="px-1 py-1.5">
                          <div className="flex flex-col items-center justify-center leading-tight">
                            <input type="checkbox" disabled={!writesEnabled || busy} checked={d.onGcal} onChange={() => toggle(p, 'onGcal')} className="h-3.5 w-3.5 align-middle" />
                            {p.onGcal && events.length > 1 && p.gcalOnCount < events.length ? (
                              <span className="text-[9px] mt-0.5 text-amber-600 dark:text-amber-400" title={`On ${p.gcalOnCount} of ${events.length} days — ticking adds them to all days`}>{p.gcalOnCount}/{events.length} days</span>
                            ) : rsvp && <span className={`text-[9px] mt-0.5 ${rsvp.cls}`}>{rsvp.label}</span>}
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}

          {staged ? (
            <p className="text-[11px] text-gray-500 dark:text-gray-400 mt-2">
              {diffCount === 0 ? 'No changes yet.' : `${diffCount} change${diffCount === 1 ? '' : 's'} will be applied when you confirm.`}
            </p>
          ) : confirming?.kind === 'apply' ? (
            <div className="mt-3 rounded border border-blue-300 dark:border-blue-700 bg-blue-50 dark:bg-blue-900/30 p-2">
              <p className="text-xs font-medium text-gray-800 dark:text-gray-100 mb-1">Apply these changes? No emails are sent.</p>
              <ul className="text-[11px] text-gray-700 dark:text-gray-200 list-disc pl-4 mb-2 space-y-0.5">
                {diffs.learnerRemove.map((p) => <li key={`lr-${p.email}`}>Remove <strong>{p.email}</strong> as a learner</li>)}
                {diffs.trainerRemove.map((p) => <li key={`tr-${p.email}`}>Remove <strong>{p.email}</strong> as a trainer</li>)}
                {diffs.learnerAdd.map((p) => <li key={`la-${p.email}`}>Add <strong>{p.email}</strong> as a learner</li>)}
                {diffs.trainerAdd.map((p) => <li key={`ta-${p.email}`}>Add <strong>{p.email}</strong> as a trainer</li>)}
                {diffs.tpgClear && <li key="tpg-clear">Remove the trainer on TPGateway</li>}
                {diffs.tpgPush && <li key="tpg-push">Set <strong>{diffs.tpgPush.email}</strong> as the trainer on TPGateway</li>}
                {diffs.gcalRemove.map((e) => <li key={`gr-${e}`}>Remove <strong>{e}</strong> from Google Calendar</li>)}
                {diffs.gcalAdd.map((e) => <li key={`ga-${e}`}>Add <strong>{e}</strong> to Google Calendar</li>)}
              </ul>
              <div className="flex items-center justify-end gap-2">
                <button onClick={() => setConfirming(null)} disabled={busy} className="text-xs px-2 py-1 rounded border border-gray-300 dark:border-gray-600 text-gray-600 dark:text-gray-300 disabled:opacity-50">Cancel</button>
                <button onClick={() => void runApply()} disabled={busy} className="text-xs px-3 py-1 rounded bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50">{busy ? 'Applying…' : 'Confirm'}</button>
              </div>
            </div>
          ) : (
            <div className="flex items-center justify-end gap-2 mt-3">
              <span className="text-[11px] text-gray-500 dark:text-gray-400 mr-auto">{diffCount === 0 ? 'No changes' : `${diffCount} change${diffCount === 1 ? '' : 's'} pending`}</span>
              <button onClick={() => setConfirming({ kind: 'apply' })} disabled={busy || diffCount === 0 || !writesEnabled}
                className="text-xs px-3 py-1 rounded bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50">Apply changes</button>
            </div>
          )}
        </>
      ) : (
        <>
          {!writesEnabled && <p className="text-[11px] text-amber-600 dark:text-amber-400 mb-2">Editing is turned off here — view only.</p>}
          {events.length === 0 ? (
            <p className="text-xs text-gray-400 dark:text-gray-500">No Google Calendar event found for this class.</p>
          ) : (
            <div className="space-y-3">
              {events.map((ev) => (
                <div key={ev.eventId} className="rounded border border-gray-200 dark:border-gray-700 p-2">
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-xs font-medium text-gray-700 dark:text-gray-200">{ev.date || ev.summary || 'Event'}</span>
                    {(ev.openUrl || ev.htmlLink) && (
                      <a href={ev.openUrl || ev.htmlLink || undefined} target="_blank" rel="noopener noreferrer"
                        title="Opens with the class's Google account (not your personal one)"
                        className="text-[11px] text-blue-600 dark:text-blue-400 hover:underline">Open in Google Calendar ↗</a>
                    )}
                  </div>
                  {ev.attendees.length === 0 ? (
                    <p className="text-[11px] text-gray-400 dark:text-gray-500">No attendees on this event.</p>
                  ) : (
                    <ul className="space-y-1">
                      {ev.attendees.map((a) => {
                        const rsvp = RSVP_META[a.responseStatus || 'needsAction'] || RSVP_META.needsAction;
                        return (
                          <li key={a.email} className="flex items-center justify-between gap-2 text-xs">
                            <span className="min-w-0 flex-1 truncate text-gray-800 dark:text-gray-100" title={a.email}>{a.displayName ? `${a.displayName} · ` : ''}{a.email}</span>
                            {a.classification === 'external' && <span className="shrink-0 px-1.5 py-0.5 rounded text-[10px] font-medium bg-gray-100 text-gray-600 dark:bg-gray-700 dark:text-gray-300" title="On the calendar but not in this class">Not in class</span>}
                            <span className={`shrink-0 text-[10px] ${rsvp.cls}`}>{rsvp.label}</span>
                          </li>
                        );
                      })}
                    </ul>
                  )}
                </div>
              ))}
            </div>
          )}

          {writesEnabled && (
            <div className="flex items-center gap-2 mt-2">
              <input type="email" value={newEmail} onChange={(e) => setNewEmail(e.target.value)} placeholder="add attendee email…"
                className="flex-1 text-xs px-2 py-1 rounded border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100" />
              <button onClick={() => { setMsg(null); setConfirming({ kind: 'add', email: newEmail.trim() }); }} disabled={busy || !EMAIL_RE.test(newEmail.trim())}
                className="text-xs px-2 py-1 rounded bg-gray-700 text-white hover:bg-gray-800 disabled:opacity-50">Add</button>
            </div>
          )}

          {confirming?.kind === 'add' && (
            <div className="mt-3 rounded border border-blue-300 dark:border-blue-700 bg-blue-50 dark:bg-blue-900/30 p-2">
              <p className="text-xs text-gray-800 dark:text-gray-100 mb-2">Add <strong>{confirming.email}</strong> to this class's Google Calendar? No email is sent.</p>
              <div className="flex items-center justify-end gap-2">
                <button onClick={() => setConfirming(null)} disabled={busy} className="text-xs px-2 py-1 rounded border border-gray-300 dark:border-gray-600 text-gray-600 dark:text-gray-300 disabled:opacity-50">Cancel</button>
                <button onClick={() => void runAdd(confirming.email)} disabled={busy} className="text-xs px-3 py-1 rounded bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50">{busy ? 'Working…' : 'Confirm'}</button>
              </div>
            </div>
          )}
        </>
      )}

      {msg && <p className={`text-[11px] mt-2 ${msg.ok ? 'text-green-600 dark:text-green-400' : 'text-red-600 dark:text-red-400'}`}>{msg.text}</p>}
    </div>
  );
};

export default CalendarAttendeesPanel;
