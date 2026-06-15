import type { calendar_v3 } from 'googleapis';

/** Strip storefront/title prefixes the way the existing calendar code does. */
export function stripPrefixes(t: string): string {
  return (t || '')
    .replace(/^\s*\[?(WSQ|VIRTUAL|EXTERNAL|HYBRID)\]?\s*/gi, '')
    .replace(/^\s*\[?(WSQ|VIRTUAL|EXTERNAL|HYBRID)\]?\s*/gi, '')
    .trim();
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

  // 2) title substring, on the target date
  if (!match) {
    match = events.find(evt => {
      const s = stripPrefixes(evt.summary || '').toLowerCase();
      const titleMatch = s.includes(strippedTitle) || strippedTitle.includes(s);
      return eventDateIso(evt) === dateIso && titleMatch;
    });
  }

  // 3) >=60% title-word overlap, on the target date
  if (!match && titleWords.size > 0) {
    match = events.find(evt => {
      const s = stripPrefixes(evt.summary || '').toLowerCase();
      const evtWords = s.split(/\s+/).filter(w => w.length > 2);
      const overlap = evtWords.filter(w => titleWords.has(w));
      return eventDateIso(evt) === dateIso &&
        overlap.length >= Math.ceil(titleWords.size * 0.6);
    });
  }

  return match;
}
