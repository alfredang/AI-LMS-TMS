import type { CalendarClient } from './calendarClient';
import { eventDateIso, extractEventCourseCode } from './eventMatch';
import { loadTrainerDirectory } from './resolveTrainerFromCalendar';
import { resolveEventTrainers, type TrainerIdentity } from './trainerIdentityRules';
import { readReminderEvents } from './readReminderEvents';

export interface CourseCodeLookupResult {
  source: 'gcal_accepted' | 'ambiguous' | 'not_found' | 'event_not_found' | 'calendar_unavailable';
  trainer: TrainerIdentity | null;
  candidates?: TrainerIdentity[];
  calendarEventUrl: string | null;
  adminNote?: string;
}

/** Calendar-only lookup for non-LMS courses: exact code/date and accepted individual guest. */
export async function resolveTrainerByCourseCode(client: CalendarClient, courseCode: string, dateIso: string, _courseTitle?: string | null): Promise<CourseCodeLookupResult> {
  const events = await readReminderEvents({
    list: params => client.calendar.events.list(params),
    get: params => client.calendar.events.get(params),
  }, client.calendarId, dateIso, dateIso);
  const matched = events.filter(e => e.status !== 'cancelled' && eventDateIso(e) === dateIso && extractEventCourseCode(e) === courseCode.trim().toUpperCase());
  if (matched.length !== 1) return {
    source: matched.length ? 'ambiguous' : 'event_not_found', trainer: null, calendarEventUrl: null,
    adminNote: `Expected one Calendar event for the exact course code/date; found ${matched.length}. Title similarity is not an operational link.`,
  };
  const resolution = resolveEventTrainers(matched[0], await loadTrainerDirectory());
  return {
    source: resolution.source === 'no_accepted_trainer' ? 'not_found' : resolution.source,
    trainer: resolution.trainer, candidates: resolution.candidates, calendarEventUrl: matched[0].htmlLink || null,
    adminNote: resolution.adminWarning || (!resolution.trainer ? 'No uniquely verified accepted trainer guest.' : undefined),
  };
}
