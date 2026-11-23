/**
 * Rule (2026-11-21): for a Virtual or Hybrid class, the Google Meet link the LMS
 * shows must be the Meet link on the class's own Google Calendar event. Learners are
 * invited from that event, so any other Meet room sends them to an empty call.
 *
 * Pure module (no DB, no Google import) so the decision can be unit-tested; the
 * calendar lookup lives in ./meetLink (`runCalendarMeet`).
 */

/** What the calendar holds for a run: how many live events belong to it, and their Meet link. */
export interface RunCalendarMeet {
  eventCount: number;
  meetLink: string | null;
}

export type MeetLinkCheck =
  | { ok: true }
  | { ok: false; reason: 'mismatch' | 'not_on_calendar'; calendarLink: string | null; message: string };

const MEET_CODE_RE = /^https?:\/\/meet\.google\.com\/([a-z]{3}-[a-z]{4}-[a-z]{3})\b/i;

/** The room code of a Google Meet link ("abc-defg-hij"), or null when it is not a Meet link. */
export function meetCode(link: string | null | undefined): string | null {
  const m = (link || '').trim().match(MEET_CODE_RE);
  return m ? m[1].toLowerCase() : null;
}

/**
 * May `link` be stored on a run whose calendar state is `calendar`?
 *  - Not a Google Meet link (Zoom, Teams, empty = clear): the rule does not apply.
 *  - Calendar unknown (`null`: sync off or Google unreachable) or no event for the
 *    run yet: nothing to compare with; the calendar sync corrects it later.
 *  - Otherwise the Meet room must be the one on the run's calendar event.
 */
export function checkMeetLinkAgainstCalendar(
  link: string | null | undefined,
  calendar: RunCalendarMeet | null
): MeetLinkCheck {
  const code = meetCode(link);
  if (!code) return { ok: true };
  if (!calendar || calendar.eventCount === 0) return { ok: true };
  if (!calendar.meetLink) {
    return {
      ok: false,
      reason: 'not_on_calendar',
      calendarLink: null,
      message: "This class's Google Calendar event has no Google Meet link. Add the Meet to the calendar event first; the class then shows that link.",
    };
  }
  if (meetCode(calendar.meetLink) !== code) {
    return {
      ok: false,
      reason: 'mismatch',
      calendarLink: calendar.meetLink,
      message: `The Google Meet link must match the class's Google Calendar event: ${calendar.meetLink}`,
    };
  }
  return { ok: true };
}
