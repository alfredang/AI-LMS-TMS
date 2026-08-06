import type { calendar_v3 } from 'googleapis';
import type { CalendarClient } from './calendarClient';
import { eventDateIso, extractEventCourseCode, stripPrefixes } from './eventMatch';
import { matchTrainerAccounts, ResolvedTrainer } from './resolveTrainerFromCalendar';

export type CourseCodeLookupSource = 'gcal_role_match' | 'ambiguous' | 'not_found' | 'event_not_found';

export interface CourseCodeLookupResult {
  source: CourseCodeLookupSource;
  trainer: ResolvedTrainer | null;
  candidates?: ResolvedTrainer[];
  calendarEventUrl: string | null;
  adminNote?: string;
}

/**
 * Resolve a trainer purely from the shared Google Calendar for a course that has NO LMS
 * course_run at all — the case for MMS-only (typically non-WSQ) courses, where MMS's own
 * trainer_user_id / trainer_option_id / course_run_trainer_invitations data is essentially
 * unpopulated. Confirmed 2026-07-23 via a 6-month backtest (126 non-WSQ occurrences): 81%
 * resolve this way, because a large share of MMS's non-WSQ trainers also teach WSQ classes
 * and are therefore Trainer-role LMS accounts discoverable through calendar attendance.
 *
 * Finds the event on `dateIso` whose description/location carries `courseCode` (exact,
 * preferred — same extractEventCourseCode used by the LMS-side trainer-reminders rewrite),
 * falling back to a fuzzy title match against `courseTitle` only when the code match finds
 * nothing. Never guesses across 2+ plausible events or 2+ Trainer-role attendees — those
 * cases come back as `event_not_found/ambiguous` with a diagnostic note instead.
 */
export async function resolveTrainerByCourseCode(
  client: CalendarClient,
  courseCode: string,
  dateIso: string,
  courseTitle?: string | null
): Promise<CourseCodeLookupResult> {
  // ±1/2 day UTC padding — same timezone-boundary-safety convention as trainer-reminders.ts.
  const timeMin = new Date(`${dateIso}T00:00:00Z`);
  timeMin.setUTCDate(timeMin.getUTCDate() - 1);
  const timeMax = new Date(`${dateIso}T00:00:00Z`);
  timeMax.setUTCDate(timeMax.getUTCDate() + 2);

  const eventsResp = await client.calendar.events.list({
    calendarId: client.calendarId,
    timeMin: timeMin.toISOString(),
    timeMax: timeMax.toISOString(),
    singleEvents: true,
    maxResults: 250,
  });
  const events: calendar_v3.Schema$Event[] = (eventsResp.data.items || []).filter(
    (e) => e.status !== 'cancelled' && eventDateIso(e) === dateIso
  );

  const codeUpper = courseCode.trim().toUpperCase();
  let matched = events.filter((e) => extractEventCourseCode(e) === codeUpper);

  if (matched.length === 0 && courseTitle) {
    const strippedTitle = stripPrefixes(courseTitle).toLowerCase();
    const titleWords = new Set(strippedTitle.split(/\s+/).filter((w) => w.length > 2));
    matched = events.filter((e) => {
      const s = stripPrefixes(e.summary || '').toLowerCase();
      if (s.includes(strippedTitle) || strippedTitle.includes(s)) return true;
      const evtWords = s.split(/\s+/).filter((w) => w.length > 2);
      const overlap = evtWords.filter((w) => titleWords.has(w));
      return titleWords.size > 0 && overlap.length >= Math.ceil(titleWords.size * 0.6);
    });
  }

  if (matched.length === 0) {
    return {
      source: 'event_not_found',
      trainer: null,
      calendarEventUrl: null,
      adminNote: `No calendar event found on ${dateIso} matching course code "${courseCode}".`,
    };
  }
  if (matched.length > 1) {
    return {
      source: 'event_not_found',
      trainer: null,
      calendarEventUrl: null,
      adminNote: `${matched.length} calendar events on ${dateIso} matched course code "${courseCode}" — cannot determine which one.`,
    };
  }

  const event = matched[0];
  const attendeeEmails = (event.attendees || [])
    .filter((a) => !a.resource && a.email)
    .map((a) => a.email!.toLowerCase());
  const candidates = await matchTrainerAccounts(attendeeEmails);
  const calendarEventUrl = event.htmlLink || null;

  if (candidates.length === 1) {
    return { source: 'gcal_role_match', trainer: candidates[0], calendarEventUrl };
  }
  if (candidates.length === 0) {
    return {
      source: 'not_found',
      trainer: null,
      calendarEventUrl,
      adminNote: 'Calendar event found, but no Trainer-role LMS account matched any attendee.',
    };
  }
  return {
    source: 'ambiguous',
    trainer: null,
    candidates,
    calendarEventUrl,
    adminNote: `Multiple Trainer-role attendees found on the calendar event (${candidates
      .map((c) => c.name || c.email)
      .join(', ')}).`,
  };
}
