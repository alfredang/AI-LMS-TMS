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
  learnerAdd: Array<{ email: string; userId: string | null }>;
  learnerRemove: Array<{ email: string }>;
  trainerAdd: Array<{ email: string; name: string | null; userId: string | null }>;
  trainerRemove: Array<{ email: string; junctionId: string | null }>;
  tpgPush: { email: string } | null;
  tpgClear: boolean;
  gcalAdd: string[];
  gcalRemove: string[];
}

export const emptyAttendeeDiffs = (): AttendeeDiffs => ({
  learnerAdd: [], learnerRemove: [], trainerAdd: [], trainerRemove: [], tpgPush: null, tpgClear: false, gcalAdd: [], gcalRemove: [],
});

export const attendeeDiffCount = (d: AttendeeDiffs): number =>
  d.learnerAdd.length + d.learnerRemove.length + d.trainerAdd.length + d.trainerRemove.length +
  (d.tpgPush ? 1 : 0) + (d.tpgClear ? 1 : 0) + d.gcalAdd.length + d.gcalRemove.length;

export async function applyAttendeeDiffs(
  courseRunId: string,
  runUuid: string | null,
  d: AttendeeDiffs,
): Promise<{ ok: number; fail: number; fails: string[] }> {
  const lmsRunId = runUuid || courseRunId;   // LMS endpoints need the UUID; calendar-attendees accepts either
  let ok = 0, fail = 0; const fails: string[] = [];
  const tally = (good: boolean, label: string) => { if (good) ok++; else { fail++; fails.push(label); } };
  const post = (url: string, body: any) => fetch(getApiUrl(url), {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  }).then((r) => r.json());

  // 1) LMS removals → 2) LMS adds → 3) TPG clear/push → 4) calendar removes/adds (last so it wins).
  for (const p of d.learnerRemove) { const j = await post('/api/admin/remove-enrollment', { email: p.email, courseRunId: lmsRunId }); tally(!!j?.success, `learner- ${p.email}`); }
  for (const p of d.trainerRemove) { const j = await post('/api/admin/remove-trainer', { courseRunUuid: lmsRunId, junctionId: p.junctionId, syncCalendar: false }); tally(!!j?.success, `trainer- ${p.email}`); }
  for (const p of d.learnerAdd) { const j = await post('/api/admin/assign-student', { courseRunUuid: lmsRunId, userId: p.userId, syncCalendar: false }); tally(!!j?.success, `learner+ ${p.email}`); }
  for (const p of d.trainerAdd) { const j = await post('/api/admin/update-trainer-info', { courseRunUuid: lmsRunId, courseRunId, trainerName: p.name || p.email, trainerEmail: p.email, trainerId: p.userId || undefined }); tally(!!(j?.success ?? !j?.error), `trainer+ ${p.email}`); }
  if (d.tpgClear) { const j = await post('/api/admin/run-trainer-tpg', { courseRunId: lmsRunId, action: 'clear' }); tally(!!j?.success, 'tpg-clear'); }
  if (d.tpgPush) { const j = await post('/api/admin/run-trainer-tpg', { courseRunId: lmsRunId, action: 'push', email: d.tpgPush.email }); tally(!!j?.success, `tpg+ ${d.tpgPush.email}`); }
  for (const email of d.gcalRemove) { const j = await post('/api/admin/calendar-attendees', { courseRunId, email, action: 'remove' }); tally(j?.success && j?.status === 'ok', `cal- ${email}`); }
  for (const email of d.gcalAdd) { const j = await post('/api/admin/calendar-attendees', { courseRunId, email, action: 'add' }); tally(j?.success && j?.status === 'ok', `cal+ ${email}`); }

  return { ok, fail, fails };
}
