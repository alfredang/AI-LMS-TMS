import type { calendar_v3 } from 'googleapis';

/** Strip storefront/title prefixes the way the existing calendar code does. */
export function stripPrefixes(t: string): string {
  // Repeated so any order of "Day 2 - [VIRTUAL] WSQ - ..." / "*Day 2 - WSQ - ..." /
  // "[VIRTUAL] Day 1 - WSQ - ..." collapses to the bare course title. The CA/DA
  // calendar syncs title multi-day events "Day N - WSQ - <title>"; without
  // stripping "Day N" those events never title-matched, so a second event was created.
  let s = (t || '');
  for (let i = 0; i < 4; i++) {
    s = s
      .replace(/^[\s*]*\[?(WSQ|VIRTUAL|EXTERNAL|HYBRID|E-LEARNING)\s*\]?[\s-:–]*/i, '')
      .replace(/^[\s*]*Day\s*[-:]?\s*\d+[\s-:–]*/i, '');
  }
  return s.trim();
}

/** The YYYY-MM-DD date of a calendar event (timed or all-day). */
export function eventDateIso(evt: calendar_v3.Schema$Event): string {
  return evt.start?.dateTime?.slice(0, 10) || evt.start?.date || '';
}

export interface MatchTarget {
  courseRunId: string;   // SSG run id — appears in the event description/location
  courseTitle: string;
  dateIso: string;       // the session date to match (YYYY-MM-DD)
}

/**
 * True if an event clearly belongs to this run — its SSG run id appears in the
 * description or location (the "Course Run ID: <id>" line the system writes).
 * This is the EXACT, safe signal used for destructive removal (no fuzzy title
 * matching, so we never cancel an unrelated event). Date-independent, so it also
 * catches an event an admin dragged off its session date.
 */
export function eventBelongsToRun(evt: calendar_v3.Schema$Event, courseRunId: string): boolean {
  const id = (courseRunId || '').toLowerCase();
  if (!id) return false;
  return (((evt.description || '') + ' ' + (evt.location || '')).toLowerCase()).includes(id);
}

/**
 * Find the calendar event for a class on a specific date, using the canonical
 * 3-strategy match (extracted from addTrainerToCalendar). Made date-aware on
 * every strategy so it maps each session date to its own event instance:
 *   1) courseRunId substring in description/location + date
 *   2) stripped-title substring + date
 *   3) >=60% title-word overlap + date
 *
 * (For a single-day class this is identical to the old behaviour; for multi-day
 * it correctly picks the per-day instance instead of "first with the run id".)
 */
export function findEventOnDate(
  events: calendar_v3.Schema$Event[],
  { courseRunId, courseTitle, dateIso }: MatchTarget
): calendar_v3.Schema$Event | undefined {
  const strippedTitle = stripPrefixes(courseTitle).toLowerCase();
  const titleWords = new Set(strippedTitle.split(/\s+/).filter(w => w.length > 2));
  const runIdLower = (courseRunId || '').toLowerCase();

  // 1) course run id in description/location, on the target date
  let match = runIdLower
    ? events.find(evt =>
        eventDateIso(evt) === dateIso &&
        ((evt.description || '') + ' ' + (evt.location || '')).toLowerCase().includes(runIdLower))
    : undefined;

  // The fuzzy fallbacks (title) MUST NOT grab an event that explicitly belongs to a DIFFERENT run —
  // otherwise two same-course runs on the same day cross-contaminate (run B with no event of its own
  // would adopt/show run A's event + attendees). Only fuzzy-match events with no run id, or our run id.
  const notAnotherRun = (evt: calendar_v3.Schema$Event): boolean => {
    const er = extractEventRunId(evt);
    return er === null || er === runIdLower;
  };

  // 2) same title (normalised), on the target date. Was substring containment,
  //    which let "Autonomous AI Agents" claim "Build a Human–AI Workforce with
  //    Autonomous AI Agents" on the same day — and then its Meet link.
  const norm = (t: string) => t.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
  const normTitle = norm(strippedTitle);
  if (!match && normTitle) {
    match = events.find(evt =>
      eventDateIso(evt) === dateIso && notAnotherRun(evt) &&
      norm(stripPrefixes(evt.summary || '')) === normTitle);
  }

  // 3) >=60% title-word overlap IN BOTH DIRECTIONS, on the target date — so a
  //    short title fully contained in a longer, different course title fails.
  if (!match && titleWords.size > 0) {
    match = events.find(evt => {
      const s = stripPrefixes(evt.summary || '').toLowerCase();
      const evtWords = new Set(s.split(/\s+/).filter(w => w.length > 2));
      if (evtWords.size === 0) return false;
      let overlap = 0; for (const w of evtWords) if (titleWords.has(w)) overlap++;
      return eventDateIso(evt) === dateIso && notAnotherRun(evt) &&
        overlap >= Math.ceil(titleWords.size * 0.6) && overlap >= Math.ceil(evtWords.size * 0.6);
    });
  }

  return match;
}

/**
 * The SSG run id written into an event's description ("Course Run ID: <id>"), lowercased, or null
 * if absent. Used to keep the fuzzy title match from claiming another run's event (same-course,
 * same-day clash). Tolerant of the location too.
 */
export function extractEventRunId(evt: calendar_v3.Schema$Event): string | null {
  const text = (evt.description || '') + ' ' + (evt.location || '');
  const m = text.match(/course\s*run\s*id\s*:?\s*([a-z0-9-]+)/i);
  return m ? m[1].toLowerCase() : null;
}

/**
 * The course code written into an event's description, uppercased, or null if absent. Two known
 * shapes in the wild:
 *   1. Labeled — "Course Code: <code>" (the ensureClassCalendarEvent.ts / "Auto-generated by
 *      LMS" template, alongside "Course Run ID:").
 *   2. Bare — the description is JUST the course code with no label at all (e.g. "TGS-2023035977"),
 *      seen on events created by an older/different calendar-sync pathway. Detected as a
 *      standalone SSG-course-code-shaped token (no spaces — a real free-text description would
 *      have some) so this doesn't accidentally swallow unrelated text.
 */
export function extractEventCourseCode(evt: calendar_v3.Schema$Event): string | null {
  const text = (evt.description || '') + ' ' + (evt.location || '');
  const labeled = text.match(/course\s*code\s*:?\s*([a-z0-9-]+)/i);
  if (labeled) return labeled[1].toUpperCase();

  // Real course_code length range in this system is 4-14 chars (e.g. "C251", "TGS-2023035977").
  const bare = (evt.description || '').trim();
  if (/^[A-Z0-9-]{4,20}$/i.test(bare)) return bare.toUpperCase();

  return null;
}
