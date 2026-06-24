import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { getApiUrl } from '@/lib/urlHelpers';
import { type AttendeeDiffs, applyAttendeeDiffs } from '@/lib/calendar/attendeeDiffs';
import SearchableSelect from '../ui/SearchableSelect';

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
  /**
   * Whether Google Calendar will actually be synced by the host action (the confirm's "Sync Google
   * Calendar" toggle). When false the Calendar column is disabled and emits NO calendar diffs — the
   * reschedule/move isn't touching the calendar, so adjusting calendar attendees would be incoherent
   * (it'd patch stale old-date events). Defaults true (standalone immediate mode patches directly).
   */
  calendarSync?: boolean;
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
// Shown alongside the panel's inline success when a Google Calendar change was applied (the GCal view lags).
const CAL_REFRESH_HINT = '↻ Refresh Google Calendar to see the change — it can take a moment to update.';
// Draft key — email when present, else the name. Manually-added people may have no email (a brand-new
// learner/trainer), so keying on email alone would drop their draft row. Roster people always have email.
const rowKey = (p: { email: string; name: string | null }) => (p.email || p.name || '').toLowerCase();

const CalendarAttendeesPanel: React.FC<Props> = ({ courseRunId, onChanged, className, staged = false, onStagedChange, calendarSync = true }) => {
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
  // Global pools (for adding someone not already on the run) + a role-aware manual-entry sub-form.
  const [trainerPool, setTrainerPool] = useState<{ user_id: string; trainer_name: string; email?: string; nric?: string | null }[]>([]);
  const [learnerPool, setLearnerPool] = useState<{ user_id: string; full_name: string; email?: string }[]>([]);
  const [manualRole, setManualRole] = useState<'trainer' | 'learner' | null>(null);
  const [manualName, setManualName] = useState('');
  const [manualEmail, setManualEmail] = useState('');
  // Immediate (standalone) mode has no host Sync toggle, so the panel owns one — inheriting the parent
  // setting (calendarSync prop) by default but overridable here, mirroring the staged confirm's checkbox.
  // In staged mode the confirm's own Sync toggle governs (via the calendarSync prop), so this is unused.
  const [localSync, setLocalSync] = useState(calendarSync);
  const effectiveCalendarSync = staged ? calendarSync : localSync;

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const r = await fetch(getApiUrl(`/api/admin/calendar-attendees?courseRunId=${encodeURIComponent(courseRunId)}`));
      const d = await r.json();
      if (d?.success) {
        setStatus(d.status); setReason(d.reason || null); setWritesEnabled(!!d.writesEnabled);
        setEvents(d.events || []); setPeople(d.people || []); setRunUuid(d.courseRunUuid || null);
        if (staged) {
          // Staged mode goes straight into the reconcile table. The reschedule/move's calendar sync
          // will put the DESIRED roster (learners/trainers/TPG) onto the NEW date's event, so default
          // their Calendar box to ON regardless of whether they're on the CURRENT (old-date) event —
          // otherwise someone who isn't on the old event (e.g. removed on a prior move) shows unticked,
          // the sync silently re-adds them, and the exclusion never sticks (the 29->30 re-add bug).
          // Externals (not in the roster) default to their current presence.
          const dr: Record<string, DraftState> = {};
          for (const p of (d.people || [])) {
            const desired = p.isLearner || p.isTrainer || p.isTpgTrainer;
            dr[rowKey(p)] = { isLearner: p.isLearner, isTrainer: p.isTrainer, onTpg: p.isTpgTrainer, onGcal: desired ? true : p.onGcal };
          }
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

  // Global trainer + learner pools — let the admin add someone who isn't on the run yet (same sources
  // the Edit-Class tabs use). Fetched once; failure is non-fatal (the picker just stays empty).
  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const [tr, lr] = await Promise.all([
          fetch(getApiUrl('/api/admin/trainers-detail')).then((r) => r.json()).catch(() => null),
          fetch(getApiUrl('/api/admin/learners')).then((r) => r.json()).catch(() => null),
        ]);
        if (!alive) return;
        if (tr?.success) setTrainerPool(tr.data?.trainers || []);
        if (lr?.success) setLearnerPool(lr.data || []);
      } catch { /* non-fatal */ }
    })();
    return () => { alive = false; };
  }, []);

  const openReconcile = () => {
    const d: Record<string, DraftState> = {};
    for (const p of people) d[rowKey(p)] = { isLearner: p.isLearner, isTrainer: p.isTrainer, onTpg: p.isTpgTrainer, onGcal: p.onGcal };
    setDraft(d); setMsg(null); setConfirming(null); setLocalSync(calendarSync); setMode('reconcile');
  };

  // Add someone who isn't already on the run. Inserts a roster row (isLearner/isTrainer=false so the
  // diff emits the matching add) with the draft role ticked. Reuses assign-student / update-trainer-info
  // via applyAttendeeDiffs (trainer-add also auto-confirms the class + shares Drive server-side).
  const addPersonRow = (role: 'trainer' | 'learner', email: string, name: string | null, userId: string | null) => {
    const k = keyOf(email || name || '');
    if (!k) return;
    setPeople((prev) => prev.some((p) => keyOf(p.email || p.name || '') === k) ? prev : [...prev, {
      email: email || '', name: name || null, isLearner: false, isTrainer: false, isTpgTrainer: false,
      lmsStatus: null, junctionId: null, onGcal: false, gcalOnCount: 0, responseStatus: null,
      userId, canAddLearner: role === 'learner', canAddTrainer: role === 'trainer',
    }]);
    setDraft((prev) => ({ ...prev, [k]: {
      isLearner: role === 'learner', isTrainer: role === 'trainer', onTpg: false, onGcal: calendarSync && !!email,
    } }));
  };
  const addTrainerFromPool = (key: string) => { const t = trainerPool.find((x) => x.user_id === key); if (t) addPersonRow('trainer', t.email || '', t.trainer_name, t.user_id); };
  const addLearnerFromPool = (key: string) => { const l = learnerPool.find((x) => x.user_id === key); if (l) addPersonRow('learner', l.email || '', l.full_name, l.user_id); };
  const addManual = () => {
    const name = manualName.trim(); const email = manualEmail.trim();
    if (!name || !manualRole) return;
    addPersonRow(manualRole, email, name, null);
    setManualName(''); setManualEmail(''); setManualRole(null);
  };

  const diffs = useMemo(() => {
    const learnerAdd: ReconPerson[] = [], learnerRemove: ReconPerson[] = [];
    const trainerAdd: ReconPerson[] = [], trainerRemove: ReconPerson[] = [];
    const gcalAdd: string[] = [], gcalRemove: string[] = [];
    for (const p of people) {
      const d = draft[rowKey(p)];
      if (!d) continue;
      if (!p.isLearner && d.isLearner) learnerAdd.push(p);
      if (p.isLearner && !d.isLearner) learnerRemove.push(p);
      if (!p.isTrainer && d.isTrainer) trainerAdd.push(p);
      if (p.isTrainer && !d.isTrainer) trainerRemove.push(p);
      // Calendar diff. In STAGED mode a reschedule/move sync re-adds the desired roster to the NEW
      // event, so an exclusion must be an explicit remove even when the person isn't on the CURRENT
      // event (the 29->30 re-add bug); desired people default to ON (see load), so only a deliberate
      // untick removes them. In immediate mode there's no sync — diff against current presence.
      const isDesired = p.isLearner || p.isTrainer || p.isTpgTrainer;
      // No calendar diffs when the host isn't syncing the calendar, OR (immediate mode) there's no
      // event to patch — adding/removing would just error ("no matching event"). Staged reschedule is
      // exempt: it CREATES the event, so calendar overrides remain valid.
      if (effectiveCalendarSync && (staged || events.length > 0)) {
        if (!p.onGcal && d.onGcal) gcalAdd.push(p.email);
        if (!d.onGcal && (staged ? (p.onGcal || isDesired) : p.onGcal)) gcalRemove.push(p.email);
      }
    }
    // TPG is a single official trainer per run. Diff current official vs. the one ticked.
    const curOfficial = people.find((p) => p.isTpgTrainer) || null;
    const tgtOfficial = people.find((p) => draft[rowKey(p)]?.onTpg) || null;
    const tpgChanged = (curOfficial?.email.toLowerCase() || null) !== (tgtOfficial?.email.toLowerCase() || null);
    const tpgPush = tpgChanged && tgtOfficial ? tgtOfficial : null;
    const tpgClear = tpgChanged && !tgtOfficial;
    return { learnerAdd, learnerRemove, trainerAdd, trainerRemove, gcalAdd, gcalRemove, tpgPush, tpgClear };
  }, [people, draft, staged, effectiveCalendarSync, events.length]);
  const diffCount = diffs.learnerAdd.length + diffs.learnerRemove.length + diffs.trainerAdd.length + diffs.trainerRemove.length + diffs.gcalAdd.length + diffs.gcalRemove.length + (diffs.tpgPush ? 1 : 0) + (diffs.tpgClear ? 1 : 0);

  // Serializable form — used to apply (standalone) and to emit upward (staged).
  const serialized: AttendeeDiffs = useMemo(() => ({
    learnerAdd: diffs.learnerAdd.map((p) => ({ email: p.email, userId: p.userId, name: p.name })),
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
      const k = rowKey(p);
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
      const k = rowKey(p);
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
      const touchedCal = serialized.gcalAdd.length > 0 || serialized.gcalRemove.length > 0;
      setMsg({ ok: fail === 0, text: `Applied ${ok} change${ok === 1 ? '' : 's'}${fail ? `, ${fail} failed (${fails.join(', ')})` : ''}.${touchedCal && fail === 0 ? `\n${CAL_REFRESH_HINT}` : ''}` });
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
      if (j?.success && j?.status === 'ok') { setMsg({ ok: true, text: `Added ${email} on ${j.changed}/${j.events} event(s).\n${CAL_REFRESH_HINT}` }); setNewEmail(''); }
      else setMsg({ ok: false, text: `Not added: ${j?.reason || j?.error || 'unknown'}` });
      await load(); onChanged?.();
    } catch (e: any) {
      setMsg({ ok: false, text: e?.message || 'Add failed' });
    } finally {
      setBusy(false); setConfirming(null);
    }
  }, [courseRunId, load, onChanged]);

  const total = events.reduce((n, e) => n + e.attendees.length, 0);
  // Calendar column is editable only when the host syncs calendar AND there's an event to patch.
  // Immediate mode with no event → disable (can't add to a non-existent event). Staged is exempt
  // (the reschedule creates the event). noCalEvent drives the "create it first" hint.
  const noCalEvent = !staged && events.length === 0;
  const canEditCalendar = effectiveCalendarSync && !noCalEvent;

  const draftOf = (p: ReconPerson): DraftState => draft[rowKey(p)] || { isLearner: p.isLearner, isTrainer: p.isTrainer, onTpg: p.isTpgTrainer, onGcal: p.onGcal };

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
          {/* Immediate mode: own Sync toggle (inherits the page setting, overridable) so the Calendar column
              behaves consistently with the staged confirm flows. Staged mode is governed by the confirm above. */}
          {!staged && writesEnabled && (
            <label className="flex items-center gap-2 text-[11px] text-gray-700 dark:text-gray-300 mb-2 cursor-pointer select-none">
              <input type="checkbox" checked={localSync} onChange={(e) => setLocalSync(e.target.checked)} className="h-3.5 w-3.5 rounded border-gray-300 text-blue-600 focus:ring-blue-500" />
              <span><strong>Sync Google Calendar</strong> — apply Calendar-column changes to the Google event(s). Inherits the page setting; off = Calendar column disabled.</span>
            </label>
          )}
          {staged && !effectiveCalendarSync && <p className="text-[11px] text-gray-400 dark:text-gray-500 mb-2">Calendar column is off — turn on <strong>Sync Google Calendar</strong> above to adjust who&apos;s on the Google Calendar.</p>}
          {effectiveCalendarSync && noCalEvent && <p className="text-[11px] text-amber-600 dark:text-amber-400 mb-2">No Google Calendar event for this class yet — use <strong>Create missing calendar events</strong> above first, then adjust the Calendar column.</p>}
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
                    <th className={`text-center px-1 py-1 font-medium w-20 ${canEditCalendar ? '' : 'opacity-40'}`}>Calendar<span className="block text-[9px] font-normal text-gray-400 dark:text-gray-500">Google</span></th>
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
                            <input type="checkbox" disabled={!writesEnabled || busy || !canEditCalendar} checked={d.onGcal && canEditCalendar} onChange={() => toggle(p, 'onGcal')} title={!effectiveCalendarSync ? "Turn on 'Sync Google Calendar' to adjust the calendar" : noCalEvent ? "No calendar event yet — use 'Create missing calendar events' first" : undefined} className="h-3.5 w-3.5 align-middle" />
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

          {/* Add someone not on the run yet — pick from the global pool (search) or enter manually. */}
          {writesEnabled && (
            <div className="mt-2 space-y-1.5">
              {manualRole ? (
                <div className="flex items-center gap-2">
                  <span className="text-[11px] text-gray-500 dark:text-gray-400 w-14 shrink-0">New {manualRole}</span>
                  <input type="text" value={manualName} onChange={(e) => setManualName(e.target.value)} placeholder="Name *"
                    className="flex-1 min-w-0 text-xs px-2 py-1 rounded border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100" />
                  <input type="email" value={manualEmail} onChange={(e) => setManualEmail(e.target.value)} placeholder="email (optional)"
                    className="flex-1 min-w-0 text-xs px-2 py-1 rounded border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100" />
                  <button onClick={addManual} disabled={busy || !manualName.trim()} className="shrink-0 text-xs px-2 py-1 rounded bg-gray-700 text-white hover:bg-gray-800 disabled:opacity-50">Add</button>
                  <button onClick={() => { setManualRole(null); setManualName(''); setManualEmail(''); }} className="shrink-0 text-xs px-2 py-1 rounded border border-gray-300 dark:border-gray-600 text-gray-600 dark:text-gray-300">Cancel</button>
                </div>
              ) : (
                <>
                  <div className="flex items-center gap-2">
                    <span className="text-[11px] text-gray-500 dark:text-gray-400 w-14 shrink-0">Trainer</span>
                    <div className="flex-1 min-w-0">
                      <SearchableSelect
                        options={trainerPool
                          .filter((t) => !people.some((p) => (t.email && p.email && rowKey(p) === keyOf(t.email)) || (p.name && p.name === t.trainer_name)))
                          .map((t) => ({ value: t.user_id, label: `${t.trainer_name}${t.email ? ` (${t.email})` : ''}${!t.nric || t.nric === 'NA' ? ' — no NRIC' : ''}` }))}
                        value="" onChange={addTrainerFromPool} placeholder="Add a trainer not on this run…"
                        className="w-full text-xs px-2 py-1 rounded border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100"
                      />
                    </div>
                    <button onClick={() => { setManualRole('trainer'); setMsg(null); }} className="shrink-0 text-xs px-2 py-1 rounded border border-gray-300 dark:border-gray-600 text-gray-600 dark:text-gray-300 whitespace-nowrap">+ New</button>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="text-[11px] text-gray-500 dark:text-gray-400 w-14 shrink-0">Learner</span>
                    <div className="flex-1 min-w-0">
                      <SearchableSelect
                        options={learnerPool
                          .filter((l) => !people.some((p) => (l.email && p.email && rowKey(p) === keyOf(l.email)) || (p.name && p.name === l.full_name)))
                          .map((l) => ({ value: l.user_id, label: `${l.full_name}${l.email ? ` (${l.email})` : ''}` }))}
                        value="" onChange={addLearnerFromPool} placeholder="Add a learner not on this run…"
                        className="w-full text-xs px-2 py-1 rounded border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100"
                      />
                    </div>
                    <button onClick={() => { setManualRole('learner'); setMsg(null); }} className="shrink-0 text-xs px-2 py-1 rounded border border-gray-300 dark:border-gray-600 text-gray-600 dark:text-gray-300 whitespace-nowrap">+ New</button>
                  </div>
                </>
              )}
              <p className="text-[10px] text-gray-400 dark:text-gray-500">Trainer-add auto-confirms the class &amp; shares courseware; tick TPG to set on TPGateway. New learner/trainer is created locally (no SSG enrolment yet).</p>
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
                {diffs.learnerAdd.map((p) => <li key={`la-${p.email || p.name}`}>Add <strong>{p.email || p.name}</strong> as a learner</li>)}
                {diffs.trainerAdd.map((p) => <li key={`ta-${p.email || p.name}`}>Add <strong>{p.email || p.name}</strong> as a trainer</li>)}
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

      {msg && <p className={`text-[11px] mt-2 whitespace-pre-line ${msg.ok ? 'text-green-600 dark:text-green-400' : 'text-red-600 dark:text-red-400'}`}>{msg.text}</p>}
    </div>
  );
};

export default CalendarAttendeesPanel;
