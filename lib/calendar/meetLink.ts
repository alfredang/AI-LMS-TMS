import type { calendar_v3 } from 'googleapis';
import pool from '../db';
import { eventDateIso, extractEventRunId } from './eventMatch';

/**
 * Google Meet link helpers. The Google Calendar event is the ONLY source of
 * truth for a class's Meet link: learners' confirmation emails are sent from
 * the calendar invite, so whatever the LMS shows must be read back from the
 * event that actually belongs to the run — never guessed from a title match.
 */

const MEET_RE = /https:\/\/meet\.google\.com\/[a-z]{3}-[a-z]{4}-[a-z]{3}\b/i;

export const isGoogleMeetLink = (s: string | null | undefined): boolean =>
  !!s && /^https:\/\/meet\.google\.com\//i.test(s.trim());

/** The Meet link carried by an event: native conference first, then a link pasted in the description. */
export function meetLinkOfEvent(evt: calendar_v3.Schema$Event | null | undefined): string | null {
  if (!evt) return null;
  const native = evt.hangoutLink
    || evt.conferenceData?.entryPoints?.find(ep => ep.entryPointType === 'video')?.uri
    || '';
  if (native) return native.trim();
  const m = (evt.description || '').match(MEET_RE);
  return m ? m[0] : null;
}

export interface RunCalendarEvents {
  /** Live (non-cancelled) events that belong to the run, earliest session first. */
  events: calendar_v3.Schema$Event[];
  /** Meet link of the earliest event that has one — the link learners were emailed. */
  meetLink: string | null;
  /** Every distinct Meet link across the run's events (>1 means the days disagree). */
  meetLinks: string[];
}

/**
 * Collect the calendar events that EXACTLY belong to a run and derive its Meet link.
 * An event belongs to the run when either
 *   (a) it is in the durable mapping `course_run_calendar_event`, or
 *   (b) its description/location carries the run's SSG Course Run ID.
 * No title matching: a title substring ("Autonomous AI Agents" ⊂ "Build a Human–AI
 * Workforce with Autonomous AI Agents") is how the wrong class's Meet link ended up
 * on a run in production.
 *
 * `events` is an optional pre-fetched window (events.list with singleEvents) used to
 * avoid per-event GETs; mapped ids missing from it are fetched individually.
 */
export async function collectRunCalendarEvents(
  calendar: calendar_v3.Calendar,
  calendarId: string,
  run: { id: string; course_run_id: string | null },
  events?: calendar_v3.Schema$Event[]
): Promise<RunCalendarEvents> {
  const byId = new Map<string, calendar_v3.Schema$Event>();
  const runIdLower = String(run.course_run_id || '').trim().toLowerCase();

  const mapped = (await pool.query<{ google_event_id: string }>(
    `SELECT google_event_id FROM course_run_calendar_event WHERE course_run_id = $1 ORDER BY event_date ASC`,
    [run.id]
  )).rows;
  for (const m of mapped) {
    const fromList = events?.find(e => e.id === m.google_event_id);
    const evt = fromList
      || await calendar.events.get({ calendarId, eventId: m.google_event_id }).then(r => r.data).catch(() => null);
    if (evt?.id && evt.status !== 'cancelled') byId.set(evt.id, evt);
  }
  if (runIdLower && events) {
    for (const e of events) {
      if (e.id && e.status !== 'cancelled' && extractEventRunId(e) === runIdLower) byId.set(e.id, e);
    }
  }

  const sorted = Array.from(byId.values()).sort((a, b) => eventDateIso(a).localeCompare(eventDateIso(b)));
  const meetLinks: string[] = [];
  for (const e of sorted) {
    const l = meetLinkOfEvent(e);
    if (l && !meetLinks.includes(l)) meetLinks.push(l);
  }
  return { events: sorted, meetLink: meetLinks[0] || null, meetLinks };
}

/** Persist the calendar's Meet link on the run (no-op when unchanged). Returns true when written. */
export async function storeRunMeetLink(runUuid: string, meetLink: string | null): Promise<boolean> {
  const r = await pool.query(
    `UPDATE course_run
        SET virtual_meeting_link = $2,
            virtual_meeting_provider = CASE WHEN $2 IS NULL THEN NULL ELSE 'google_meet' END,
            virtual_meeting_synced_at = NOW(),
            updated_at = NOW()
      WHERE id = $1 AND virtual_meeting_link IS DISTINCT FROM $2`,
    [runUuid, meetLink]
  );
  return (r.rowCount || 0) > 0;
}
