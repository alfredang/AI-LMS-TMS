import type { calendar_v3 } from 'googleapis';
import pool from '../db';
import { eventDateIso, extractEventRunId, extractEventCourseCode, stripPrefixes } from './eventMatch';

/**
 * Event -> course_run resolution for the trainer-reminders external API. Google Calendar is the
 * source of truth for "is this class happening on date X" — this module answers "which course_run
 * (if any) does this real calendar event belong to", in priority order:
 *
 *   1. course_run_calendar_event durable mapping (already known — no guessing)
 *   2. "Course Run ID: <id>" in the event description (exact identifier)
 *   3. "Course Code: <code>" in the event description, narrowed by date plausibility
 *   4. Fuzzy title match against date-plausible candidates (last resort)
 *
 * Every event resolved via tiers 2-4 is opportunistically written into course_run_calendar_event
 * so future calls (including resolveTrainerFromCalendar.ts's GCal-attendee trainer resolution,
 * which reads the exact same table) get faster and more accurate over time. Ambiguous matches
 * (2+ plausible candidates) are never guessed — they're left unresolved and logged.
 */

export interface CandidateRun {
  runUuid: string;            // course_run.id (uuid)
  courseRunId: string;        // course_run.course_run_id (SSG text id)
  courseCode: string | null;
  courseTitle: string;
  startDate: string | null;   // ISO YYYY-MM-DD
  endDate: string | null;     // ISO YYYY-MM-DD
}

export type ResolutionTier = 'durable_mapping' | 'run_id_in_description' | 'course_code' | 'fuzzy_title';

export interface ResolvedEventRun {
  runUuid: string;
  matchedDate: string;        // ISO YYYY-MM-DD, the event's own date
  event: calendar_v3.Schema$Event;
  tier: ResolutionTier;
}

function datePlausible(candidate: CandidateRun, dateIso: string): boolean {
  if (!candidate.startDate || !candidate.endDate) return false;
  return candidate.startDate <= dateIso && candidate.endDate >= dateIso;
}

/** Fuzzy title match — reverse direction of findEventOnDate (one event, many candidate runs). */
function findRunForEventByTitle(evt: calendar_v3.Schema$Event, candidates: CandidateRun[]): CandidateRun | null {
  const s = stripPrefixes(evt.summary || '').toLowerCase();
  if (!s) return null;

  // Strategy 1: title substring, either direction.
  let matches = candidates.filter((c) => {
    const t = stripPrefixes(c.courseTitle).toLowerCase();
    return t && (s.includes(t) || t.includes(s));
  });
  if (matches.length === 1) return matches[0];
  if (matches.length >= 2) return null; // ambiguous — never guess

  // Strategy 2: >=60% title-word overlap.
  const evtWords = s.split(/\s+/).filter((w) => w.length > 2);
  if (evtWords.length === 0) return null;
  matches = candidates.filter((c) => {
    const titleWords = new Set(stripPrefixes(c.courseTitle).toLowerCase().split(/\s+/).filter((w) => w.length > 2));
    if (titleWords.size === 0) return false;
    const overlap = evtWords.filter((w) => titleWords.has(w));
    return overlap.length >= Math.ceil(titleWords.size * 0.6);
  });
  return matches.length === 1 ? matches[0] : null;
}

export async function resolveEventsToRuns(
  events: calendar_v3.Schema$Event[],
  candidateRuns: CandidateRun[],
  windowStart: string,
  windowEnd: string
): Promise<{ resolved: ResolvedEventRun[]; unresolvedEventIds: string[] }> {
  const inWindow = events.filter((evt) => {
    const d = eventDateIso(evt);
    return d && d >= windowStart && d <= windowEnd;
  });

  const byRunUuid = new Map(candidateRuns.map((c) => [c.runUuid, c]));
  const byCourseRunId = new Map(candidateRuns.map((c) => [c.courseRunId.toLowerCase(), c]));
  const byCourseCode = new Map<string, CandidateRun[]>();
  for (const c of candidateRuns) {
    if (!c.courseCode) continue;
    const key = c.courseCode.toUpperCase();
    if (!byCourseCode.has(key)) byCourseCode.set(key, []);
    byCourseCode.get(key)!.push(c);
  }

  const resolved: ResolvedEventRun[] = [];
  const claimedRunDates = new Set<string>(); // `${runUuid}|${date}` — prevents double-assignment within this request
  const unresolvedEventIds: string[] = [];
  const toUpsert: Array<{ runUuid: string; date: string; eventId: string; baseEventId: string | null }> = [];

  // Tier 1: durable mapping, batched.
  const eventIds = inWindow.map((e) => e.id).filter((id): id is string => !!id);
  const mappingByEventId = new Map<string, string>(); // google_event_id -> course_run_id (uuid)
  if (eventIds.length > 0) {
    const rows = (await pool.query<{ google_event_id: string; course_run_id: string }>(
      `SELECT google_event_id, course_run_id FROM course_run_calendar_event WHERE google_event_id = ANY($1::text[])`,
      [eventIds]
    )).rows;
    for (const r of rows) mappingByEventId.set(r.google_event_id, r.course_run_id);
  }

  for (const evt of inWindow) {
    const dateIso = eventDateIso(evt);
    if (!evt.id || !dateIso) continue;

    let candidate: CandidateRun | undefined;
    let tier: ResolutionTier | undefined;

    // Tier 1
    const mappedRunUuid = mappingByEventId.get(evt.id);
    if (mappedRunUuid) {
      candidate = byRunUuid.get(mappedRunUuid);
      if (candidate) tier = 'durable_mapping';
    }

    // Tier 2
    if (!candidate) {
      const runId = extractEventRunId(evt);
      if (runId) {
        const c = byCourseRunId.get(runId);
        if (c) { candidate = c; tier = 'run_id_in_description'; }
      }
    }

    // Tier 3
    const eventCourseCode = extractEventCourseCode(evt);
    if (!candidate && eventCourseCode) {
      const plausible = (byCourseCode.get(eventCourseCode) || []).filter((c) => datePlausible(c, dateIso));
      if (plausible.length === 1) { candidate = plausible[0]; tier = 'course_code'; }
    }

    // Tier 4 — only when the event carries NO course code of its own. An event whose description
    // names a course code that simply isn't among our candidates almost certainly belongs to a
    // different, non-LMS course (e.g. an MMS-only course) rather than an LMS run that just wasn't
    // labeled — fuzzy-matching it to an unrelated LMS run by title alone caused a real
    // cross-contamination bug (confirmed 2026-07-23: an MMS "AI Vibe Coding for iOS Ecommerce App"
    // event, description "C141", got claimed by an unrelated WSQ run "Vibe Coding for Multi-Agent
    // AI Systems" purely from title word overlap, and the bad mapping got persisted). Only guess
    // by title when the event gives us no code-based signal to trust instead.
    if (!candidate && !eventCourseCode) {
      const plausible = candidateRuns.filter(
        (c) => datePlausible(c, dateIso) && !claimedRunDates.has(`${c.runUuid}|${dateIso}`)
      );
      const match = findRunForEventByTitle(evt, plausible);
      if (match) { candidate = match; tier = 'fuzzy_title'; }
    }

    if (!candidate || !tier) {
      unresolvedEventIds.push(evt.id);
      console.warn(
        `external/trainer-reminders: unresolved calendar event ${evt.id} on ${dateIso} — no run-id, course-code, or fuzzy title match ("${evt.summary || ''}")`
      );
      continue;
    }

    const key = `${candidate.runUuid}|${dateIso}`;
    if (claimedRunDates.has(key)) {
      // Duplicate calendar entry for the same run+day — keep the first, warn about this one.
      console.warn(`external/trainer-reminders: duplicate calendar event ${evt.id} for run ${candidate.courseRunId} on ${dateIso} — discarded`);
      continue;
    }
    claimedRunDates.add(key);

    resolved.push({ runUuid: candidate.runUuid, matchedDate: dateIso, event: evt, tier });

    if (tier !== 'durable_mapping') {
      toUpsert.push({ runUuid: candidate.runUuid, date: dateIso, eventId: evt.id, baseEventId: evt.id.includes('_') ? evt.id.split('_')[0] : null });
    }
  }

  // Opportunistic cache write-through — same "adopt" pattern as backfill-class-calendar-links.ts.
  for (const u of toUpsert) {
    try {
      const ins = await pool.query(
        `INSERT INTO course_run_calendar_event (course_run_id, event_date, google_event_id, base_event_id)
         VALUES ($1, $2::date, $3, $4)
         ON CONFLICT (google_event_id) DO NOTHING
         RETURNING id`,
        [u.runUuid, u.date, u.eventId, u.baseEventId]
      );
      if (ins.rowCount === 0) {
        // Event id already claimed by a different run — a race or a genuine data conflict.
        // Don't trust the JS-side match over the DB; drop this resolution.
        console.warn(`external/trainer-reminders: event ${u.eventId} already mapped to a different run — dropping resolution`);
        const idx = resolved.findIndex((r) => r.event.id === u.eventId);
        if (idx >= 0) resolved.splice(idx, 1);
        unresolvedEventIds.push(u.eventId);
      }
    } catch (err) {
      console.warn(`external/trainer-reminders: failed to cache mapping for event ${u.eventId}:`, err instanceof Error ? err.message : err);
    }
  }

  return { resolved, unresolvedEventIds };
}
