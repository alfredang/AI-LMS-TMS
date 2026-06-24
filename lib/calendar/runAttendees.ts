/**
 * View + adjust the Google Calendar ATTENDEES of a course run's event(s), for the
 * admin-facing "Calendar attendees" panel (in-app calendar modal + rescheduler).
 *
 *  - listRunAttendees(runId)            — READ: who is currently on the run's GCal
 *                                         event(s), with RSVP status + LMS classification.
 *  - patchRunAttendee(runId, email, op) — WRITE (guarded): add/remove ONE attendee on
 *                                         every matched event. sendUpdates:'none'.
 *
 * Events are located the SAME way `class-sessions` matches them (live events.list over
 * the session-date window + findEventOnDate per date), so the panel always operates on
 * exactly the events shown as "On calendar" in the modal — independent of whether the
 * durable course_run_calendar_event mapping is populated. Manual full-reconcile (which
 * also creates/drops events + syncs the whole desired set) stays in reconcileRunCalendar.
 */
import type { calendar_v3 } from 'googleapis';
import pool from '../db';
import { getCalendarReadClient, getCalendarClient } from './calendarClient';
import { findEventOnDate, eventDateIso } from './eventMatch';
import { calendarWritesAllowed, CALENDAR_WRITES_BLOCKED_MSG } from './calendarGuard';

export type AttendeeClass = 'desired' | 'departed' | 'external';
export interface RunAttendee {
  email: string;
  displayName: string | null;
  responseStatus: string | null;   // accepted | needsAction | declined | tentative
  classification: AttendeeClass;    // desired (current learner/trainer) | departed (removed in LMS) | external (manually added)
}
export interface RunEventAttendees {
  eventId: string;
  htmlLink: string | null;
  openUrl: string | null;   // htmlLink pinned to the calendar's account (authuser=) — see buildOpenUrl
  date: string | null;
  summary: string | null;
  attendees: RunAttendee[];
}
/**
 * One person in the merged reconciliation view = the union of the LMS roster (active
 * learners + trainers) and the Google Calendar attendees, keyed by email. Lets the admin
 * see, per email, where they exist (LMS vs GCal) and decide keep/remove on each side.
 */
export interface ReconPerson {
  email: string;
  name: string | null;
  isLearner: boolean;                // active enrollment on this run
  isTrainer: boolean;                // course_run_trainer on this run (local LMS trainer)
  isTpgTrainer: boolean;             // this run's tpg_assigned_trainer (SSG/TPG) — may not be local yet
  lmsStatus: string | null;          // enrolment_status for learners
  junctionId: string | null;         // course_run_trainer.id (for trainer removal)
  onGcal: boolean;
  gcalOnCount: number;               // how many of the run's day-events this person is on (per-day presence)
  responseStatus: string | null;
  userId: string | null;             // matched app_user (by primary/secondary/additional email)
  canAddLearner: boolean;            // a TMS user w/ Learner role exists for this email & not already a learner
  canAddTrainer: boolean;            // a TMS user w/ Trainer role exists for this email & not already a trainer
}
export interface ListAttendeesResult {
  status: 'ok' | 'skipped';
  reason?: string;
  writesEnabled: boolean;           // whether this env may WRITE (add/remove) — UI gates buttons on it
  courseRunUuid: string | null;     // needed for LMS removal endpoints (remove-trainer)
  events: RunEventAttendees[];
  people: ReconPerson[];            // merged LMS ∪ GCal, for the reconcile table
}
export interface PatchAttendeeResult {
  status: 'ok' | 'skipped';
  reason?: string;
  email: string;
  action: 'add' | 'remove';
  events: number;                   // events touched
  changed: number;                  // events actually modified
}

interface RunInfo { id: string; course_run_id: string; title: string; start_date: string | null; end_date: string | null; }

async function loadRunInfo(courseRunId: string): Promise<RunInfo | null> {
  return (await pool.query<RunInfo>(
    `SELECT cr.id, cr.course_run_id, c.title, cr.start_date::text AS start_date, cr.end_date::text AS end_date
       FROM course_run cr JOIN course c ON c.id = cr.course_id
      WHERE cr.id::text = $1 OR cr.course_run_id = $1 LIMIT 1`,
    [courseRunId]
  )).rows[0] ?? null;
}

const iso = (v: string | null): string | null => {
  if (!v) return null;
  const s = String(v).replace(/-/g, '');
  return s.length >= 8 ? `${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)}` : String(v).slice(0, 10);
};

/** Distinct session dates for the run (local course_session), falling back to the run start date. */
async function runDates(run: RunInfo): Promise<string[]> {
  const rows = (await pool.query<{ start_date: string | null }>(
    `SELECT DISTINCT start_date FROM course_session WHERE course_run_id = $1 AND COALESCE(deleted,false) = false`,
    [run.id]
  )).rows;
  let dates = rows.map(r => iso(r.start_date)).filter(Boolean) as string[];
  if (dates.length === 0 && run.start_date) dates = [iso(run.start_date)!];
  return Array.from(new Set(dates)).sort();
}

/**
 * Desired = Confirmed learners + current trainers (emails). Known = any LMS-recognized
 * email (enrolment any status + current trainers + invited trainers) — only these are
 * tagged 'departed' when not desired; everyone else on the event is 'external'.
 * Mirrors the sets in syncClassAttendees (ensureClassCalendarEvent.ts).
 */
async function loadDesiredKnown(runUuid: string): Promise<{ desired: Set<string>; known: Set<string> }> {
  const desired = new Set((await pool.query<{ email: string }>(
    `SELECT lower(btrim(au.email)) AS email
       FROM enrollment e JOIN app_user au ON au.id = e.user_id
      WHERE e.course_run_id = $1 AND e.enrolment_status = 'Confirmed' AND nullif(btrim(au.email),'') IS NOT NULL
      UNION
     SELECT lower(btrim(t.trainer_email)) FROM course_run_trainer t
      WHERE t.course_run_id = $1 AND nullif(btrim(t.trainer_email),'') IS NOT NULL
      UNION
     SELECT lower(btrim(cr.tpg_assigned_trainer_email)) FROM course_run cr
      WHERE cr.id = $1 AND nullif(btrim(cr.tpg_assigned_trainer_email),'') IS NOT NULL`,
    [runUuid]
  )).rows.map(r => r.email));
  const known = new Set((await pool.query<{ email: string }>(
    `SELECT lower(btrim(au.email)) AS email FROM enrollment e JOIN app_user au ON au.id=e.user_id WHERE e.course_run_id=$1 AND nullif(btrim(au.email),'') IS NOT NULL
     UNION SELECT lower(btrim(t.trainer_email)) FROM course_run_trainer t WHERE t.course_run_id=$1 AND nullif(btrim(t.trainer_email),'') IS NOT NULL
     UNION SELECT lower(btrim(ti.trainer_email)) FROM trainer_invitation ti WHERE ti.course_run_id=$1 AND nullif(btrim(ti.trainer_email),'') IS NOT NULL
     UNION SELECT lower(btrim(cr.tpg_assigned_trainer_email)) FROM course_run cr WHERE cr.id=$1 AND nullif(btrim(cr.tpg_assigned_trainer_email),'') IS NOT NULL`,
    [runUuid]
  )).rows.map(r => r.email));
  return { desired, known };
}

/**
 * Build a "open in Google Calendar" URL pinned to the calendar's OWN account via
 * `authuser=<email>`. Without this Google opens the link under the browser's default
 * (often the admin's personal) account, which has no access to the org calendar — so the
 * event eid fails to resolve and Google falls back to today. `authuser` forces the right
 * account so the eid resolves. Falls back to a day view (still account- + date-pinned)
 * when no event htmlLink is available.
 */
function buildOpenUrl(htmlLink: string | null, calendarId: string, dateIso: string | null): string | null {
  const acct = calendarId && calendarId.includes('@') ? calendarId : null; // authuser needs an email
  if (htmlLink) {
    if (!acct) return htmlLink;
    return `${htmlLink}${htmlLink.includes('?') ? '&' : '?'}authuser=${encodeURIComponent(acct)}`;
  }
  if (dateIso) {
    const [y, m, d] = dateIso.split('-');
    const day = `https://calendar.google.com/calendar/r/day/${y}/${Number(m)}/${Number(d)}`;
    return acct ? `${day}?authuser=${encodeURIComponent(acct)}` : day;
  }
  return null;
}

/** Locate the run's GCal event instances (one per session date), de-duplicated by id. */
async function findRunEvents(
  calendar: calendar_v3.Calendar,
  calendarId: string,
  run: RunInfo,
): Promise<calendar_v3.Schema$Event[]> {
  const dates = await runDates(run);
  if (dates.length === 0) return [];
  const sorted = [...dates].sort();
  const lo = new Date(sorted[0] + 'T00:00:00Z'); lo.setUTCDate(lo.getUTCDate() - 1);
  const hi = new Date(sorted[sorted.length - 1] + 'T00:00:00Z'); hi.setUTCDate(hi.getUTCDate() + 2);
  const resp = await calendar.events.list({
    calendarId, timeMin: lo.toISOString(), timeMax: hi.toISOString(), singleEvents: true, maxResults: 250,
  });
  const all = resp.data.items || [];
  const byId = new Map<string, calendar_v3.Schema$Event>();
  for (const d of dates) {
    const ev = findEventOnDate(all, { courseRunId: run.course_run_id, courseTitle: run.title, dateIso: d });
    if (ev?.id) byId.set(ev.id, ev);
  }
  // Also resolve via the durable mapping with events.get (immediately consistent). events.list LAGS for
  // just-created/moved events — e.g. right after a reschedule's calendar reconcile — so a staged attendee
  // removal would otherwise miss the new event and silently no-op (the "everyone stays on the calendar" bug).
  try {
    const mapped = (await pool.query<{ google_event_id: string }>(
      `SELECT google_event_id FROM course_run_calendar_event WHERE course_run_id = $1`, [run.id]
    )).rows;
    for (const m of mapped) {
      if (!m.google_event_id || byId.has(m.google_event_id)) continue;
      const ev = await calendar.events.get({ calendarId, eventId: m.google_event_id }).then((r) => r.data).catch(() => null);
      if (ev?.id && ev.status !== 'cancelled') byId.set(ev.id, ev);
    }
  } catch { /* mapping is a best-effort supplement to the live match */ }
  return [...byId.values()];
}

/**
 * Merge the LMS roster (active learners + trainers) with the GCal attendees, keyed by email.
 * A person can be learner, trainer, or BOTH. Then enrich every email with the matched TMS
 * user + roles so GCal-only attendees can be added to the LMS in the role(s) they're eligible
 * for (the email must belong to a TMS user holding that role).
 */
async function buildReconPeople(runUuid: string, events: calendar_v3.Schema$Event[]): Promise<ReconPerson[]> {
  const map = new Map<string, ReconPerson>();
  const put = (rawEmail: string, patch: Partial<ReconPerson>) => {
    const k = (rawEmail || '').toLowerCase();
    if (!k) return;
    const ex = map.get(k) || { email: rawEmail, name: null, isLearner: false, isTrainer: false, isTpgTrainer: false, lmsStatus: null, junctionId: null, onGcal: false, gcalOnCount: 0, responseStatus: null, userId: null, canAddLearner: false, canAddTrainer: false };
    map.set(k, { ...ex, ...patch, email: ex.email || rawEmail, name: patch.name ?? ex.name });
  };

  const learners = (await pool.query<{ email: string; name: string | null; status: string | null; user_id: string }>(
    `SELECT lower(btrim(au.email)) AS email, au.full_name AS name, e.enrolment_status AS status, au.id AS user_id
       FROM enrollment e JOIN app_user au ON au.id = e.user_id
      WHERE e.course_run_id = $1 AND nullif(btrim(au.email),'') IS NOT NULL
        AND lower(coalesce(e.enrolment_status,'')) NOT IN ('admin removed','cancelled','withdrawn')`,
    [runUuid]
  )).rows;
  for (const l of learners) put(l.email, { name: l.name, isLearner: true, lmsStatus: l.status, userId: l.user_id });

  const trainers = (await pool.query<{ junction_id: string; email: string; name: string | null; user_id: string | null }>(
    `SELECT id AS junction_id, lower(btrim(trainer_email)) AS email, trainer_name AS name, trainer_id AS user_id
       FROM course_run_trainer WHERE course_run_id = $1 AND nullif(btrim(trainer_email),'') IS NOT NULL`,
    [runUuid]
  )).rows;
  for (const t of trainers) put(t.email, { name: t.name, isTrainer: true, junctionId: t.junction_id, userId: t.user_id || undefined });

  // The run's TPG-assigned trainer (may not be a local course_run_trainer yet → reconcilable).
  const tpg = (await pool.query<{ email: string; name: string | null }>(
    `SELECT lower(btrim(tpg_assigned_trainer_email)) AS email, tpg_assigned_trainer_name AS name
       FROM course_run WHERE id = $1 AND nullif(btrim(tpg_assigned_trainer_email),'') IS NOT NULL`,
    [runUuid]
  )).rows;
  for (const t of tpg) put(t.email, { name: t.name || undefined, isTpgTrainer: true });

  const gcalCount = new Map<string, number>();
  for (const ev of events) {
    for (const a of (ev.attendees || [])) {
      if (a.resource || !a.email) continue;
      const k = a.email.toLowerCase();
      gcalCount.set(k, (gcalCount.get(k) || 0) + 1);
      put(a.email, { onGcal: true, responseStatus: a.responseStatus || null, name: a.displayName || undefined });
    }
  }
  for (const [k, n] of gcalCount) { const p = map.get(k); if (p) p.gcalOnCount = n; }

  // Enrich with the matched TMS user + roles (match on primary/secondary/additional email).
  const emails = [...map.keys()];
  if (emails.length) {
    const rows = (await pool.query<{ email: string; user_id: string; full_name: string | null; roles: string[] }>(
      `SELECT lower(btrim(cand.em)) AS email, au.id AS user_id, au.full_name,
              array_remove(array_agg(DISTINCT urm.role::text), NULL) AS roles
         FROM app_user au
         JOIN LATERAL (
                SELECT au.email AS em
                UNION SELECT au.secondary_email
                UNION SELECT unnest(au.additional_emails)
              ) cand ON cand.em IS NOT NULL
         LEFT JOIN user_role_map urm ON urm.user_id = au.id
        WHERE lower(btrim(cand.em)) = ANY($1::text[])
        GROUP BY cand.em, au.id, au.full_name`,
      [emails]
    )).rows;
    const byEmail = new Map<string, { userId: string; fullName: string | null; roles: string[] }>();
    for (const r of rows) if (!byEmail.has(r.email)) byEmail.set(r.email, { userId: r.user_id, fullName: r.full_name, roles: r.roles || [] });
    for (const [k, p] of map) {
      const m = byEmail.get(k);
      if (m) {
        p.userId = p.userId || m.userId;
        if (!p.name) p.name = m.fullName;
        p.canAddLearner = !p.isLearner && !!m.userId && m.roles.includes('Learner');
        p.canAddTrainer = !p.isTrainer && !!m.userId && m.roles.includes('Trainer');
      }
      // The TPG-assigned trainer can always be reconciled into the local roster — TPG already
      // designates them the trainer, so allow "add as trainer" even without a Trainer-role match
      // (update-trainer-info creates/links the account).
      if (p.isTpgTrainer && !p.isTrainer) p.canAddTrainer = true;
    }
  }

  return [...map.values()].sort((a, b) => a.email.localeCompare(b.email));
}

export async function listRunAttendees(courseRunId: string): Promise<ListAttendeesResult> {
  const writesEnabled = calendarWritesAllowed();
  const run = await loadRunInfo(courseRunId);
  if (!run) return { status: 'skipped', reason: 'Course run not found', writesEnabled, courseRunUuid: null, events: [], people: [] };
  const client = await getCalendarReadClient();
  if (!client) {
    // Calendar unavailable, but the merged LMS roster (learners/trainers/TPG) is calendar-independent —
    // still return `people` (with onGcal=false) so callers like the move flow get the roster.
    const people = await buildReconPeople(run.id, []).catch(() => []);
    return { status: 'skipped', reason: 'Google Calendar sync is disabled', writesEnabled, courseRunUuid: run.id, events: [], people };
  }

  try {
    const events = await findRunEvents(client.calendar, client.calendarId, run);
    const { desired, known } = await loadDesiredKnown(run.id);
    const people = await buildReconPeople(run.id, events);
    const out: RunEventAttendees[] = events.map((ev) => ({
      eventId: ev.id!,
      htmlLink: ev.htmlLink || null,
      openUrl: buildOpenUrl(ev.htmlLink || null, client.calendarId, eventDateIso(ev) || null),
      date: eventDateIso(ev) || null,
      summary: ev.summary || null,
      attendees: (ev.attendees || [])
        .filter((a) => !a.resource)   // skip rooms/resources
        .map((a): RunAttendee => {
          const em = (a.email || '').toLowerCase();
          const classification: AttendeeClass = desired.has(em) ? 'desired' : known.has(em) ? 'departed' : 'external';
          return { email: a.email || '', displayName: a.displayName || null, responseStatus: a.responseStatus || null, classification };
        }),
    }));
    return { status: 'ok', writesEnabled, courseRunUuid: run.id, events: out, people };
  } catch (e) {
    return { status: 'skipped', reason: e instanceof Error ? e.message : 'Failed to read calendar', writesEnabled, courseRunUuid: run.id, events: [], people: [] };
  }
}

export async function patchRunAttendee(courseRunId: string, email: string, action: 'add' | 'remove'): Promise<PatchAttendeeResult> {
  const base: PatchAttendeeResult = { status: 'ok', email, action, events: 0, changed: 0 };
  const target = (email || '').trim();
  if (!target) return { ...base, status: 'skipped', reason: 'Email is required' };
  const client = await getCalendarClient();   // hard write-guard (env)
  if (!client) return { ...base, status: 'skipped', reason: CALENDAR_WRITES_BLOCKED_MSG };
  const run = await loadRunInfo(courseRunId);
  if (!run) return { ...base, status: 'skipped', reason: 'Course run not found' };

  const { calendar, calendarId } = client;
  const targetLower = target.toLowerCase();
  try {
    const events = await findRunEvents(calendar, calendarId, run);
    base.events = events.length;
    if (events.length === 0) return { ...base, status: 'skipped', reason: 'No matching Google Calendar event found for this run' };

    for (const ev of events) {
      // Re-fetch each event fresh to avoid clobbering concurrent attendee edits.
      const fresh = await calendar.events.get({ calendarId, eventId: ev.id! }).then(r => r.data).catch(() => null);
      if (!fresh) continue;
      const current = fresh.attendees || [];
      const present = current.some(a => (a.email || '').toLowerCase() === targetLower);
      let next: calendar_v3.Schema$EventAttendee[] | null = null;
      if (action === 'add' && !present) {
        next = [...current, { email: target, responseStatus: 'needsAction' }];
      } else if (action === 'remove' && present) {
        next = current.filter(a => (a.email || '').toLowerCase() !== targetLower);
      }
      if (!next) continue;   // no-op for this event
      await calendar.events.patch({ calendarId, eventId: ev.id!, requestBody: { attendees: next }, sendUpdates: 'none' });
      base.changed++;
    }
    return base;
  } catch (e) {
    return { ...base, status: 'skipped', reason: e instanceof Error ? e.message : 'Failed to update calendar' };
  }
}
