import { getApiUrl } from '@/lib/urlHelpers';

/**
 * Serializable description of attendee/roster changes from the "Adjust attendees" reconcile,
 * plus the function that commits them. Shared so the panel can apply them immediately
 * (standalone use) OR stage them and have the reschedule confirm apply them after the move.
 *
 * Apply order (LMS → TPG → calendar) is deliberate: a freshly-added local trainer must exist
 * before it can be pushed to TPG, and the calendar step runs LAST so explicit calendar picks
 * override the reschedule's auto-reconcile (the "Sync auto-adds, then Adjust overrides" rule).
 */
export interface AttendeeDiffs {
  learnerAdd: Array<{ email: string; userId: string | null; name?: string | null }>;
  learnerRemove: Array<{ email: string; cancelTpg?: boolean }>;
  trainerAdd: Array<{ email: string; name: string | null; userId: string | null }>;
  trainerRemove: Array<{ email: string; junctionId: string | null }>;
  tpgPush: { email: string } | null;       // the single OFFICIAL trainer on TPG
  tpgClear: boolean;
  learnerTpgEnrol: Array<{ email: string; userId: string | null }>;   // enrol these learners on TPG
  learnerTpgCancel: Array<{ email: string; userId: string | null }>;  // cancel these learners' TPG enrolment (stay on roster)
  gcalAdd: string[];
  gcalRemove: string[];
}

export const emptyAttendeeDiffs = (): AttendeeDiffs => ({
  learnerAdd: [], learnerRemove: [], trainerAdd: [], trainerRemove: [], tpgPush: null, tpgClear: false,
  learnerTpgEnrol: [], learnerTpgCancel: [], gcalAdd: [], gcalRemove: [],
});

export const attendeeDiffCount = (d: AttendeeDiffs): number =>
  d.learnerAdd.length + d.learnerRemove.length + d.trainerAdd.length + d.trainerRemove.length +
  (d.tpgPush ? 1 : 0) + (d.tpgClear ? 1 : 0) + d.learnerTpgEnrol.length + d.learnerTpgCancel.length +
  d.gcalAdd.length + d.gcalRemove.length;

export async function applyAttendeeDiffs(
  courseRunId: string,
  runUuid: string | null,
  d: AttendeeDiffs,
): Promise<{ ok: number; fail: number; fails: string[] }> {
  const lmsRunId = runUuid || courseRunId;   // LMS endpoints need the UUID; calendar-attendees accepts either
  let ok = 0, fail = 0; const fails: string[] = [];
  const errMsg = (j: any) => j?.message || j?.error || j?.reason || 'failed';
  // On failure, append the server's reason (e.g. SSG "TGS-403 - Please verify particulars") so the
  // panel shows WHY, not just which row.
  const tally = (good: boolean, label: string, j?: any) => { if (good) ok++; else { fail++; fails.push(j !== undefined ? `${label}: ${errMsg(j)}` : label); } };
  const post = (url: string, body: any) => fetch(getApiUrl(url), {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  }).then((r) => r.json());

  // 1) LMS removals → 2) LMS adds → 3) TPG clear/push → 4) calendar removes/adds (last so it wins).
  // Removing a learner who is on TPGateway also cancels their TPG enrolment (cancelOnTpg) —
  // an explicit, confirm-shown UI action, never automatic elsewhere.
  for (const p of d.learnerRemove) { const j = await post('/api/admin/remove-enrollment', { email: p.email, courseRunId: lmsRunId, cancelOnTpg: p.cancelTpg === true }); tally(!!j?.success, `learner- ${p.email}`, j); }
  for (const p of d.trainerRemove) { const j = await post('/api/admin/remove-trainer', { courseRunUuid: lmsRunId, junctionId: p.junctionId, syncCalendar: false }); tally(!!j?.success, `trainer- ${p.email}`, j); }
  for (const p of d.learnerAdd) {
    // Existing TMS user → assign by userId; brand-new (no userId) → manual mode (name + optional email).
    const body = p.userId
      ? { courseRunUuid: lmsRunId, userId: p.userId, syncCalendar: false }
      : { courseRunUuid: lmsRunId, manualName: p.name || p.email, manualEmail: p.email || undefined, syncCalendar: false };
    const j = await post('/api/admin/assign-student', body); tally(!!j?.success, `learner+ ${p.email || p.name}`, j);
  }
  for (const p of d.trainerAdd) { const j = await post('/api/admin/update-trainer-info', { courseRunUuid: lmsRunId, courseRunId, trainerName: p.name || p.email, trainerEmail: p.email, trainerId: p.userId || undefined }); tally(!!(j?.success ?? !j?.error), `trainer+ ${p.email}`, j); }
  if (d.tpgClear) { const j = await post('/api/admin/run-trainer-tpg', { courseRunId: lmsRunId, action: 'clear' }); tally(!!j?.success, 'tpg-clear', j); }
  if (d.tpgPush) { const j = await post('/api/admin/run-trainer-tpg', { courseRunId: lmsRunId, action: 'push', email: d.tpgPush.email }); tally(!!j?.success, `tpg+ ${d.tpgPush.email}`, j); }
  // Learner TPG enrolments — enrol AFTER learnerAdd (the local enrolment must exist first); cancel keeps them on the roster.
  for (const p of d.learnerTpgCancel) { const j = await post('/api/admin/enrol-learner-tpg', { courseRunUuid: lmsRunId, userId: p.userId || undefined, email: p.email || undefined, action: 'cancel' }); tally(j?.status !== 'error', `tpg-learner- ${p.email}`, j); }
  for (const p of d.learnerTpgEnrol) { const j = await post('/api/admin/enrol-learner-tpg', { courseRunUuid: lmsRunId, userId: p.userId || undefined, email: p.email || undefined, action: 'enrol' }); tally(j?.status !== 'error', `tpg-learner+ ${p.email}`, j); }
  for (const email of d.gcalRemove) { const j = await post('/api/admin/calendar-attendees', { courseRunId, email, action: 'remove' }); tally(j?.success && j?.status === 'ok', `cal- ${email}`, j); }
  for (const email of d.gcalAdd) { const j = await post('/api/admin/calendar-attendees', { courseRunId, email, action: 'add' }); tally(j?.success && j?.status === 'ok', `cal+ ${email}`, j); }

  return { ok, fail, fails };
}
