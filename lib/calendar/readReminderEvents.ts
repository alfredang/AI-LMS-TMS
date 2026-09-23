import type { calendar_v3 } from 'googleapis';

export class ReminderSourceUnavailableError extends Error {}
export interface ReminderCalendarReader {
  list(params: { calendarId: string; timeMin: string; timeMax: string; singleEvents: boolean; maxResults: number; pageToken?: string }): Promise<{ data: calendar_v3.Schema$Events }>;
  get(params: { calendarId: string; eventId: string }): Promise<{ data: calendar_v3.Schema$Event }>;
}

/** Read every page before returning; partial results must never authorise a reminder. */
export async function readReminderEvents(reader: ReminderCalendarReader, calendarId: string, start: string, end: string) {
  const events: calendar_v3.Schema$Event[] = [];
  let pageToken: string | undefined;
  const seen = new Set<string>();
  try {
    do {
      const page = await reader.list({ calendarId, timeMin: `${start}T00:00:00+08:00`,
        timeMax: new Date(Date.parse(`${end}T00:00:00+08:00`) + 86400_000).toISOString(),
        singleEvents: true, maxResults: 2500, pageToken });
      events.push(...(page.data.items || []));
      pageToken = page.data.nextPageToken || undefined;
      if (pageToken && (seen.has(pageToken) || seen.size >= 100)) throw new Error('Incomplete Calendar pagination');
      if (pageToken) seen.add(pageToken);
    } while (pageToken);
    for (let i = 0; i < events.length; i++) {
      if (events[i].attendeesOmitted && events[i].id) {
        const original = events[i];
        const complete = (await reader.get({ calendarId, eventId: original.id! })).data;
        if (complete.id !== original.id) throw new Error('Calendar event identity changed during lookup');
        events[i] = complete;
      }
      if (events[i].attendeesOmitted) throw new Error('Incomplete Calendar attendees');
    }
    return events;
  } catch {
    throw new ReminderSourceUnavailableError('Cannot verify the complete Calendar window. No reminder decision was made.');
  }
}
