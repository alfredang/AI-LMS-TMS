import type { calendar_v3 } from 'googleapis';
import pool from '../db';
import { getCalendarClient, getCalendarReadClient } from './calendarClient';
import { findEventOnDate, stripPrefixes, eventBelongsToRun } from './eventMatch';
import { getTrainingPartnerIdentifiers } from '../trainingPartnerIdentifiers';
import { RUN_COURSE_CODE_SQL } from '../courseCode';
import { enrichCalendarCourseDescription, readCalendarCourseInfo, type CalendarCourseInfo } from './courseInfoDescription';
import { emptyCourseInfoRefresh, refreshExistingCalendarCourseInfo, type CourseInfoRun, type CourseInfoRefreshResult } from './courseInfoRefresh';

/**
 * Single, idempotent "make the class's calendar events exist" helper + its
 * counterparts (remove, attendee-sync). Replaces the fuzzy-match-only model with
 * a durable per-session-date mapping (course_run_calendar_event) guarded by a
 * Postgres advisory lock, so creation is exact and race-safe.
 *
 * NOTE: creation matches the CA/DA title/description format ("WSQ - <title>",
 * with "Course Run ID: <ssgId>" in the description) so the existing CA/DA
 * matchers adopt these events and vice-versa — they coexist without duplicating.
 */

const SGT = 'Asia/Singapore';

const sessionIso = (v: string | null): string | null => {
  if (!v) return null;
  const s = String(v).replace(/-/g, '');
  return s.length >= 8 ? `${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)}` : null;
};

const baseOf = (eventId: string | null | undefined): string | null =>
  eventId && eventId.includes('_') ? eventId.split('_')[0] : null;

interface RunMeta {
  id: string; course_run_id: string; course_code: string | null;
  title: string; start_date: string | null; end_date: string | null;
  course_code_aliases: string[];
}

async function loadRun(courseRunId: string): Promise<RunMeta | null> {
  const r = await pool.query<RunMeta>(
    `SELECT cr.id, cr.course_run_id, ${RUN_COURSE_CODE_SQL} AS course_code, c.title,
            array_remove(ARRAY[c.course_code,c.new_course_code] || ARRAY(SELECT h.code FROM course_code_history h WHERE h.course_id = c.id),NULL) AS course_code_aliases,
            cr.start_date::text AS start_date, cr.end_date::text AS end_date
       FROM course_run cr JOIN course c ON c.id = cr.course_id
      WHERE cr.id::text = $1 OR cr.course_run_id = $1 LIMIT 1`,
    [courseRunId]
  );
  return r.rows[0] ?? null;
}

async function sessionDates(runUuid: string, fallbackStart: string | null): Promise<string[]> {
  const sess = (await pool.query(
    `SELECT DISTINCT start_date FROM course_session WHERE course_run_id = $1 AND (deleted IS NOT TRUE)`,
    [runUuid]
  )).rows;
  let dates = sess.map(r => sessionIso(r.start_date)).filter(Boolean) as string[];
  if (dates.length === 0 && fallbackStart) dates = [String(fallbackStart).slice(0, 10)];
  return Array.from(new Set(dates)).sort();
}

/** Run `fn` while holding a per-course-run advisory lock (cross-request safe). */
async function withRunLock<T>(runUuid: string, fn: () => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query(`SELECT pg_advisory_lock(hashtext($1))`, [`class-cal:${runUuid}`]);
    return await fn();
  } finally {
    await client.query(`SELECT pg_advisory_unlock(hashtext($1))`, [`class-cal:${runUuid}`]).catch(() => {});
    client.release();
  }
}

export interface EnsureResult { status: 'ok' | 'skipped'; created: number; adopted: number; kept: number; errors: number; reason?: string;
  descriptionsUpdated?: number; descriptionConflicts?: number; }

/** Shared by existing ensure/reconcile and trainer-confirmation paths. No attendee changes. */
export async function stampCalendarCourseInfo(calendar: calendar_v3.Calendar, calendarId: string,
  eventId: string, info: CalendarCourseInfo, now = new Date()) {
  const fresh = (await calendar.events.get({ calendarId, eventId })).data;
  if (fresh.status === 'cancelled') return { status: 'conflict' as const, reason: 'event_cancelled' };
  const locationInfo = readCalendarCourseInfo(fresh.location || '');
  if (info.courseRunId && locationInfo.courseRunId.some(id => id !== info.courseRunId)) {
    return { status: 'conflict' as const, reason: 'conflicting_location_run_id' };
  }
  const update = enrichCalendarCourseDescription(fresh.description, info, now);
  if (update.status !== 'updated') return update;
  if (!fresh.etag) return { status: 'conflict' as const, reason: 'missing_event_version' };
  await calendar.events.patch({ calendarId, eventId, requestBody: { description: update.description }, sendUpdates: 'none' },
    { headers: { 'If-Match': fresh.etag } });
  const verified = (await calendar.events.get({ calendarId, eventId })).data;
  if (verified.status === 'cancelled' || verified.description !== update.description) throw new Error('Calendar description readback failed');
  return update;
}

/**
 * Ensure a calendar event exists for every session date of the class. Also
 * backfills the Course Title/Code/Run ID block onto a kept or adopted event
 * that's missing it (append-only — never overwrites existing description
 * text), which is how a pre-LMS or manually-created event picks up a
 * resolvable Run ID. Does NOT touch attendees (see syncClassAttendees).
 * Idempotent + advisory-locked.
 */
export async function ensureClassCalendarEvent(courseRunId: string): Promise<EnsureResult> {
  const out: EnsureResult = { status: 'ok', created: 0, adopted: 0, kept: 0, errors: 0, descriptionsUpdated: 0, descriptionConflicts: 0 };
  const client = await getCalendarClient();
  if (!client) return { ...out, status: 'skipped', reason: 'calendar sync disabled' };
  const run = await loadRun(courseRunId);
  if (!run) return { ...out, status: 'skipped', reason: 'course run not found' };
  const dates = await sessionDates(run.id, run.start_date);
  if (dates.length === 0) return { ...out, status: 'skipped', reason: 'no session dates' };

  const { calendar, calendarId } = client;
  const cleanTitle = stripPrefixes(run.title || '');
  const title = `WSQ - ${cleanTitle}`;

  let tpAddress = 'Office';
  try { tpAddress = (await getTrainingPartnerIdentifiers()).companyAddress || 'Office'; } catch { /* default */ }
  const isVirtual = /virtual|online|e-learning/i.test(run.title || '');
  const location = isVirtual ? 'Virtual / Online' : tpAddress;
  const info: CalendarCourseInfo = { title: run.title, courseCode: run.course_code, courseRunId: run.course_run_id,
    courseCodeAliases: run.course_code_aliases };
  const description = enrichCalendarCourseDescription('', info).description;

  return withRunLock(run.id, async () => {
    // One events.list across the whole window, reused for all dates.
    const timeMin = new Date(dates[0] + 'T00:00:00Z'); timeMin.setUTCDate(timeMin.getUTCDate() - 1);
    const timeMax = new Date(dates[dates.length - 1] + 'T00:00:00Z'); timeMax.setUTCDate(timeMax.getUTCDate() + 2);
    // No `q:` text filter — Google's full-text search silently missed events whose
    // titles differ from the run title (renamed course, "Day 2 - WSQ - …" prefixes,
    // en-dashes/parentheses), so the adopt step saw nothing and CREATED a duplicate
    // next to the CA/DA-created series. The window is a few days, so list it all.
    let events: calendar_v3.Schema$Event[] = [];
    let listFailed = false;
    try {
      events = (await calendar.events.list({ calendarId, timeMin: timeMin.toISOString(), timeMax: timeMax.toISOString(), singleEvents: true, maxResults: 2500 })).data.items || [];
    } catch (e) {
      // A failed list (rate limit / transient 5xx) must NOT fall through to create —
      // we cannot know what already exists, and a blind insert duplicates the class
      // for every attendee. Keep/adopt still work from the durable mapping; creation
      // is retried on the next run.
      listFailed = true;
      console.error(`❌ [ensureClassCalendarEvent] events.list failed for run=${run.course_run_id}; skipping event creation this pass:`, e instanceof Error ? e.message : e);
    }

    // Fill each missing field, preserving operator notes and existing valid values.
    // A description check alone must never advance the last-update timestamp.
    const stampDescriptionIfMissing = async (evt: calendar_v3.Schema$Event) => {
      if (!evt.id) return;
      const proposal = enrichCalendarCourseDescription(evt.description, info);
      if (proposal.status === 'unchanged') return;
      if (proposal.status === 'conflict') { out.descriptionConflicts!++; return; }
      try {
        const result = await stampCalendarCourseInfo(calendar, calendarId, evt.id, info);
        if (result.status === 'updated') out.descriptionsUpdated!++;
        else if (result.status === 'conflict') out.descriptionConflicts!++;
      } catch { out.errors++; }
    };

    for (const dateIso of dates) {
      try {
        // 1) exact path — stored mapping that still exists in Calendar
        const mapped = (await pool.query(
          `SELECT google_event_id FROM course_run_calendar_event WHERE course_run_id = $1 AND event_date = $2::date`,
          [run.id, dateIso]
        )).rows[0];
        if (mapped?.google_event_id) {
          // NOTE: a manually-DELETED event is not a 404 — Google's events.get returns it with
          // status:'cancelled' (and events.list excludes cancelled by default). So "get succeeded"
          // is NOT proof it's live; we must check status !== 'cancelled', else a deleted event is
          // wrongly "kept" and never recreated.
          const live = events.find(e => e.id === mapped.google_event_id)
            || await calendar.events.get({ calendarId, eventId: mapped.google_event_id }).then(r => r.data).catch(() => null);
          if (live && live.status !== 'cancelled') {
            out.kept++;
            await stampDescriptionIfMissing(live);
            continue;
          }
          // stored event vanished (404) or was deleted/cancelled — drop the stale row, fall through to adopt/create
          await pool.query(`DELETE FROM course_run_calendar_event WHERE course_run_id = $1 AND event_date = $2::date`, [run.id, dateIso]);
        }

        // 2) adopt path — an existing event matches this class+date
        const match = findEventOnDate(events, { courseRunId: run.course_run_id, courseTitle: run.title, dateIso });
        if (match?.id) {
          const ins = await pool.query(
            `INSERT INTO course_run_calendar_event (course_run_id, event_date, google_event_id, base_event_id)
             VALUES ($1, $2::date, $3, $4) ON CONFLICT (google_event_id) DO NOTHING`,
            [run.id, dateIso, match.id, baseOf(match.id)]
          );
          if (ins.rowCount && ins.rowCount > 0) out.adopted++; else out.kept++;
          await stampDescriptionIfMissing(match);
          continue;
        }

        // 3) create path — only when we could actually see the calendar window
        if (listFailed) { out.errors++; continue; }
        const created = await calendar.events.insert({
          calendarId,
          requestBody: {
            summary: title, description, location,
            start: { dateTime: `${dateIso}T09:30:00`, timeZone: SGT },
            end: { dateTime: `${dateIso}T18:30:00`, timeZone: SGT },
            guestsCanInviteOthers: false, guestsCanSeeOtherGuests: false,
          },
          sendUpdates: 'none',
        });
        if (created.data.id) {
          await pool.query(
            `INSERT INTO course_run_calendar_event (course_run_id, event_date, google_event_id, base_event_id)
             VALUES ($1, $2::date, $3, $4) ON CONFLICT (course_run_id, event_date) DO UPDATE SET google_event_id = EXCLUDED.google_event_id, updated_at = now()`,
            [run.id, dateIso, created.data.id, baseOf(created.data.id)]
          );
          out.created++;
        } else { out.errors++; }
      } catch (e) { out.errors++; }
    }
    return out;
  });
}

/** Appended to the existing three-hour job and reused after SSG imports/syncs.
 * Fully mapped/ongoing classes and classes without learners or local sessions
 * can be enriched. This path never creates/adopts events or modifies participants.
 */
export async function syncExistingCalendarCourseInfo(options: { courseRunId?: string; daysAhead?: number; now?: Date; dryRun?: boolean } = {}): Promise<CourseInfoRefreshResult> {
  const client = await (options.dryRun ? getCalendarReadClient() : getCalendarClient());
  if (!client) return { ...emptyCourseInfoRefresh(), status: 'skipped', reason: 'calendar sync disabled' };
  const now = options.now || new Date();
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: SGT, year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);
  const end = new Date(`${today}T00:00:00Z`);
  end.setUTCDate(end.getUTCDate() + Math.max(1, Math.min(options.daysAhead ?? 365, 730)) + 1);
  const until = end.toISOString().slice(0, 10);
  const target = options.courseRunId ? await loadRun(options.courseRunId) : null;
  if (options.courseRunId && (!target?.start_date || (target.end_date || target.start_date) < today)) {
    return { ...emptyCourseInfoRefresh(), status: 'skipped', reason: 'no upcoming course run' };
  }
  const from = target?.start_date && target.start_date > today ? target.start_date : today;
  const targetEnd = target ? new Date(`${target.end_date || target.start_date}T00:00:00Z`) : end;
  if (target) targetEnd.setUTCDate(targetEnd.getUTCDate() + 1);
  const to = target && targetEnd < end ? targetEnd.toISOString().slice(0, 10) : until;
  if (from >= to) return { ...emptyCourseInfoRefresh(), status: 'skipped', reason: 'outside upcoming window' };
  const readRuns = async (): Promise<CourseInfoRun[]> => {
    const rows = (await pool.query(`SELECT cr.id, cr.course_run_id, ${RUN_COURSE_CODE_SQL} AS course_code, c.title,
      cr.start_date::text, COALESCE(cr.end_date,cr.start_date)::text AS end_date,
      (cr.is_deleted IS NOT TRUE AND COALESCE(cr.class_status::text,'') <> 'Cancelled') AS active,
      array_remove(ARRAY[c.course_code,c.new_course_code] || ARRAY(SELECT h.code FROM course_code_history h WHERE h.course_id=c.id),NULL) AS aliases,
      ARRAY(SELECT cs.start_date::text FROM course_session cs WHERE cs.course_run_id=cr.id AND cs.deleted IS NOT TRUE AND cs.start_date IS NOT NULL) AS dates,
      COALESCE((SELECT json_agg(json_build_object('eventId',ce.google_event_id,'date',ce.event_date::text))
        FROM course_run_calendar_event ce WHERE ce.course_run_id=cr.id),'[]'::json) AS mappings
      FROM course_run cr JOIN course c ON c.id=cr.course_id
      WHERE cr.start_date < $2::date AND COALESCE(cr.end_date,cr.start_date) >= $1::date`, [from, to])).rows;
    return rows.map(row => ({ id: row.id, courseRunId: /^\d+$/.test(row.course_run_id || '') ? row.course_run_id : null, courseCode: row.course_code, title: row.title,
      courseCodeAliases: row.aliases, active: row.active, startDate: row.start_date, endDate: row.end_date,
      sessionDates: (row.dates as string[]).map(value => sessionIso(value)!).filter(Boolean), mappings: row.mappings }));
  };
  // Same Company Settings connection used by the existing website schedule reader.
  // Resolve lazily: tenants/events without C-code classes do not need MMS credentials.
  let mmsConnection: Promise<{ baseUrl: string; apiKey: string }> | undefined;
  const { calendar, calendarId } = client;
  return refreshExistingCalendarCourseInfo({
    runs: readRuns,
    mmsCourse: async code => {
      mmsConnection ||= pool.query(`SELECT tertiary_courses_sg_url, tertiary_courses_sg_api_key, magento_backend_url FROM training_provider LIMIT 1`)
        .then(result => ({ baseUrl: result.rows[0]?.tertiary_courses_sg_url || result.rows[0]?.magento_backend_url || '',
          apiKey: result.rows[0]?.tertiary_courses_sg_api_key || '' }));
      const { baseUrl, apiKey } = await mmsConnection;
      if (!baseUrl || !apiKey) throw new Error('mms_api_unconfigured');
      try {
        const url = new URL(baseUrl.replace(/\/+$/, '') + '/courses/api_schedule');
        if (url.username || url.password || url.hash || url.search || (url.protocol !== 'https:'
          && !(url.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)))) throw new Error('invalid_connection');
        url.searchParams.set('sku', code);
        const response = await fetch(url, { headers: { 'X-API-Key': apiKey, Accept: 'application/json' },
          cache: 'no-store', redirect: 'error', signal: AbortSignal.timeout(6000) });
        if (!response.ok) throw new Error('mms_api_unavailable');
        return await response.json();
      } catch { throw new Error('mms_api_unavailable'); } // Never expose keys, URLs or upstream response bodies.
    },
    events: async () => {
      const events: calendar_v3.Schema$Event[] = [], seen = new Set<string>();
      let pageToken: string | undefined;
      do {
        const page = (await calendar.events.list({ calendarId, timeMin: `${from}T00:00:00+08:00`, timeMax: `${to}T00:00:00+08:00`,
          singleEvents: true, showDeleted: false, maxResults: 2500, pageToken })).data;
        events.push(...page.items || []);
        pageToken = page.nextPageToken || undefined;
        if (pageToken && (seen.has(pageToken) || seen.size >= 100)) throw new Error('Calendar event inventory incomplete');
        if (pageToken) seen.add(pageToken);
      } while (pageToken);
      return events;
    },
    get: async eventId => (await calendar.events.get({ calendarId, eventId })).data,
    patch: async (eventId, description, etag) => {
      await calendar.events.patch({ calendarId, eventId, requestBody: { description }, sendUpdates: 'none' }, { headers: { 'If-Match': etag } });
    },
    lock: withRunLock,
  }, { courseRunId: options.courseRunId, now: options.now, dryRun: options.dryRun });
}

/** Existing sync/import callers notify this helper after committing their source data.
 * Best effort; the existing three-hour job catches interrupted/failed refreshes.
 */
const pendingCourseInfoRuns = new Set<string>();
let courseInfoRefreshTail = Promise.resolve();
export function triggerCalendarCourseInfoRefresh(courseRunId: string): void {
  if (!courseRunId || pendingCourseInfoRuns.has(courseRunId)) return;
  pendingCourseInfoRuns.add(courseRunId);
  // Imports/session gap-fill can finish hundreds of runs together. Serialize
  // their existing-event checks instead of flooding Google or the five-connection DB pool.
  courseInfoRefreshTail = courseInfoRefreshTail.then(async () => {
    try {
      const result = await syncExistingCalendarCourseInfo({ courseRunId });
      console.log('[calendar-course-info]', JSON.stringify({ courseRunId, ...result }));
    } catch { console.warn('[calendar-course-info] background refresh failed'); }
    finally { pendingCourseInfoRuns.delete(courseRunId); }
  });
}

export interface RemoveResult { status: 'ok' | 'skipped'; removed: number; errors: number; reason?: string; }

/**
 * Remove all calendar events for a class (cancellation / last-learner-removed).
 *
 * Live-match based (Phase 3): removes the UNION of
 *   (a) every event in the durable mapping (by id — caught regardless of date), and
 *   (b) every event in the run's date window whose description/location carries the
 *       run id (`eventBelongsToRun`) — catches events whose map row drifted or was
 *       lost, so a cancel can't silently orphan them.
 * cancel-patches events that had attendees, hard-deletes empty ones, clears rows.
 */
export async function removeClassCalendarEvents(courseRunId: string, _opts: { reason?: string } = {}): Promise<RemoveResult> {
  const out: RemoveResult = { status: 'ok', removed: 0, errors: 0 };
  const client = await getCalendarClient();
  if (!client) return { ...out, status: 'skipped', reason: 'calendar sync disabled' };
  const run = await loadRun(courseRunId);
  if (!run) return { ...out, status: 'skipped', reason: 'course run not found' };
  const { calendar, calendarId } = client;

  return withRunLock(run.id, async () => {
    // (a) Mapped event ids — removed by id, regardless of where they now live.
    const mapped = (await pool.query<{ google_event_id: string }>(
      `SELECT google_event_id FROM course_run_calendar_event WHERE course_run_id = $1`,
      [run.id]
    )).rows;
    const ids = new Set<string>(mapped.map(r => r.google_event_id));

    // (b) Live-match: any event in the run's window carrying the run id but NOT in
    //     the map (a drifted / orphaned event). Best-effort; falls back to (a) only.
    try {
      const dates = await sessionDates(run.id, run.start_date);
      const loBase = dates[0] || (run.start_date ? String(run.start_date).slice(0, 10) : null);
      const hiBase = (run.end_date ? String(run.end_date).slice(0, 10) : null) || dates[dates.length - 1] || loBase;
      if (loBase && hiBase) {
        const lo = new Date(loBase + 'T00:00:00Z'); lo.setUTCDate(lo.getUTCDate() - 1);
        const hi = new Date(hiBase + 'T00:00:00Z'); hi.setUTCDate(hi.getUTCDate() + 2);
        const events = (await calendar.events.list({ calendarId, timeMin: lo.toISOString(), timeMax: hi.toISOString(), singleEvents: true, maxResults: 250, q: run.title })).data.items || [];
        for (const e of events) {
          if (e.id && !ids.has(e.id) && eventBelongsToRun(e, run.course_run_id)) ids.add(e.id);
        }
      }
    } catch { /* fall back to mapped-only removal */ }

    for (const eventId of ids) {
      try {
        const evt = await calendar.events.get({ calendarId, eventId }).then(r => r.data).catch(() => null);
        if (evt && evt.status !== 'cancelled') {
          if ((evt.attendees || []).length > 0) {
            await calendar.events.patch({ calendarId, eventId, requestBody: { status: 'cancelled' }, sendUpdates: 'none' });
          } else {
            await calendar.events.delete({ calendarId, eventId, sendUpdates: 'none' });
          }
          out.removed++;
        }
        await pool.query(`DELETE FROM course_run_calendar_event WHERE course_run_id = $1 AND google_event_id = $2`, [run.id, eventId]);
      } catch (e) { out.errors++; }
    }
    return out;
  });
}

export interface AttendeeSyncResult { status: 'ok' | 'skipped'; added: number; removed: number; errors: number; reason?: string; }

/**
 * Reconcile each event's attendees to the class's desired set =
 * confirmed learners + accepted trainers. Adds anyone missing; removes only
 * attendees the LMS recognizes as departed learners/trainers — never strips
 * unknown (manually-added) attendees. Patches every recurring instance.
 */
export async function syncClassAttendees(
  courseRunId: string,
  opts: { includeTpgTrainer?: boolean } = {}
): Promise<AttendeeSyncResult> {
  const out: AttendeeSyncResult = { status: 'ok', added: 0, removed: 0, errors: 0 };
  const client = await getCalendarClient();
  if (!client) return { ...out, status: 'skipped', reason: 'calendar sync disabled' };
  const run = await loadRun(courseRunId);
  if (!run) return { ...out, status: 'skipped', reason: 'course run not found' };
  const { calendar, calendarId } = client;
  // The TPG trainer is left out of BOTH sets by default (neither added nor removed):
  // trainers are assigned only in the LMS (course_run_trainer), and on classes filled
  // by the old 02:00 auto-assign TPG still holds an unconfirmed approved-list #1,
  // which this sync used to add to the event. includeTpgTrainer:true restores it.
  const tpg = opts.includeTpgTrainer === true;

  // Desired = confirmed learners + local trainers (+ the TPG trainer only if opted in).
  const desiredRows = await pool.query<{ email: string }>(
    `SELECT lower(btrim(au.email)) AS email
       FROM enrollment e JOIN app_user au ON au.id = e.user_id
      WHERE e.course_run_id = $1 AND e.enrolment_status = 'Confirmed' AND nullif(btrim(au.email),'') IS NOT NULL
      UNION
     SELECT lower(btrim(t.trainer_email)) AS email
       FROM course_run_trainer t WHERE t.course_run_id = $1 AND nullif(btrim(t.trainer_email),'') IS NOT NULL
      UNION
     SELECT lower(btrim(cr.tpg_assigned_trainer_email)) AS email
       FROM course_run cr WHERE cr.id = $1 AND $2::boolean AND nullif(btrim(cr.tpg_assigned_trainer_email),'') IS NOT NULL`,
    [run.id, tpg]
  );
  const desired = new Set(desiredRows.rows.map(r => r.email));

  // Known LMS-managed emails (any enrollment status + any current/invited trainer)
  // — only these may be removed if not desired; everyone else on the event is left
  // alone. trainer_invitation is included so a trainer who was REMOVED (their
  // course_run_trainer row is hard-deleted, e.g. on Unconfirm or remove-trainer)
  // is still recognized as departed and dropped from the event.
  const knownRows = await pool.query<{ email: string }>(
    `SELECT lower(btrim(au.email)) AS email FROM enrollment e JOIN app_user au ON au.id=e.user_id WHERE e.course_run_id=$1 AND nullif(btrim(au.email),'') IS NOT NULL
     UNION SELECT lower(btrim(t.trainer_email)) FROM course_run_trainer t WHERE t.course_run_id=$1 AND nullif(btrim(t.trainer_email),'') IS NOT NULL
     UNION SELECT lower(btrim(ti.trainer_email)) FROM trainer_invitation ti WHERE ti.course_run_id=$1 AND nullif(btrim(ti.trainer_email),'') IS NOT NULL
     UNION SELECT lower(btrim(cr.tpg_assigned_trainer_email)) FROM course_run cr WHERE cr.id=$1 AND $2::boolean AND nullif(btrim(cr.tpg_assigned_trainer_email),'') IS NOT NULL
     -- Learners who MOVED to another current/upcoming run of the same course: their
     -- enrolment row no longer points here, so without this they'd never be dropped
     -- from this event (and admins' manual removals didn't stick). They're only
     -- removed when not also Confirmed in this run (the desired set wins).
     UNION SELECT lower(btrim(au.email)) FROM enrollment e
             JOIN app_user au ON au.id = e.user_id
             JOIN course_run cr2 ON cr2.id = e.course_run_id
            WHERE cr2.course_id = (SELECT course_id FROM course_run WHERE id = $1)
              AND cr2.id <> $1 AND e.enrolment_status = 'Confirmed'
              AND cr2.end_date >= (NOW() AT TIME ZONE 'Asia/Singapore')::date
              AND nullif(btrim(au.email),'') IS NOT NULL`,
    [run.id, tpg]
  );
  const known = new Set(knownRows.rows.map(r => r.email));

  return withRunLock(run.id, async () => {
    const eventIds = (await pool.query<{ google_event_id: string }>(
      `SELECT google_event_id FROM course_run_calendar_event WHERE course_run_id = $1`, [run.id]
    )).rows.map(r => r.google_event_id);

    for (const eventId of eventIds) {
      try {
        const evt = await calendar.events.get({ calendarId, eventId }).then(r => r.data).catch(() => null);
        if (!evt) continue;
        const current = evt.attendees || [];
        const currentEmails = new Set(current.map(a => (a.email || '').toLowerCase()));

        const toAdd = [...desired].filter(e => !currentEmails.has(e));
        // Keep attendees that are still desired OR are unknown (externally-added).
        // This drops only known-LMS emails that are no longer desired (departed).
        const kept = current.filter(a => {
          const em = (a.email || '').toLowerCase();
          return desired.has(em) || !known.has(em);
        });
        const removedCount = current.length - kept.length;
        if (toAdd.length === 0 && removedCount === 0) continue; // no change

        const next: calendar_v3.Schema$EventAttendee[] = [...kept];
        for (const email of toAdd) next.push({ email, responseStatus: 'needsAction' });

        await calendar.events.patch({ calendarId, eventId, requestBody: { attendees: next }, sendUpdates: 'none' });
        out.added += toAdd.length;
        out.removed += removedCount;
      } catch (e) { out.errors++; }
    }
    return out;
  });
}
