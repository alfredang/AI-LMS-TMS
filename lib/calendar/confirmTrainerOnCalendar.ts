import crypto from 'crypto';
import type { calendar_v3 } from 'googleapis';
import pool from '../db';
import { getCalendarClient } from './calendarClient';
import { ensureClassCalendarEvent } from './ensureClassCalendarEvent';

/**
 * Everything Google-Calendar-side that must happen when a trainer ACCEPTS an
 * invitation and the class flips to Confirmed:
 *
 *   1. Make sure the class's calendar events exist (one per session date) —
 *      creates/adopts via ensureClassCalendarEvent, so a class whose event was
 *      never created still ends up on the calendar instead of being skipped.
 *   2. Stamp "Course Run ID: <ssg id>" into each event's description when
 *      missing, so every event is exactly attributable to its run.
 *   3. Add the trainer as an attendee with sendUpdates:'all' — the trainer
 *      receives a REAL Google Calendar invitation email they can RSVP to
 *      (learner adds elsewhere stay silent; this is the one deliberate invite).
 *   4. Virtual classes: generate a Google Meet on the first event when the run
 *      has no virtual_meeting_link yet, persist it to course_run, and note the
 *      link in the other session-day events' descriptions.
 *
 * Never throws — returns a summary; callers log it. Safe to re-run (idempotent:
 * existing attendee/description/meet-link states are checked first).
 */

export interface ConfirmTrainerCalendarResult {
  status: 'ok' | 'skipped';
  reason?: string;
  eventsFound: number;
  trainerAddedTo: number;
  descriptionsStamped: number;
  meetLink: string | null;
}

const isVirtualRun = (row: { class_type?: string | null; mode_of_learning?: string | null; title?: string | null }): boolean => {
  const ct = String(row.class_type || '');
  if (/virtual/i.test(ct)) return true;
  if (ct && !/physical|hybrid/i.test(ct)) return false; // explicit non-virtual class_type wins
  return /virtual/i.test(String(row.mode_of_learning || '')) || /\[VIRTUAL\]/i.test(String(row.title || ''));
};

export async function confirmTrainerOnCalendar(
  courseRunUuid: string,
  trainerEmail: string
): Promise<ConfirmTrainerCalendarResult> {
  const out: ConfirmTrainerCalendarResult = {
    status: 'ok', eventsFound: 0, trainerAddedTo: 0, descriptionsStamped: 0, meetLink: null,
  };

  const client = await getCalendarClient();
  if (!client) return { ...out, status: 'skipped', reason: 'calendar sync disabled' };
  const { calendar, calendarId } = client;

  const runRes = await pool.query(
    `SELECT cr.id, cr.course_run_id, cr.class_type, cr.mode_of_learning::text AS mode_of_learning,
            cr.virtual_meeting_link, c.title
       FROM course_run cr JOIN course c ON c.id = cr.course_id
      WHERE cr.id = $1 LIMIT 1`,
    [courseRunUuid]
  );
  const run = runRes.rows[0];
  if (!run) return { ...out, status: 'skipped', reason: 'course run not found' };

  // 1) Make the events exist (create/adopt, durable per-date mapping).
  try {
    const ensure = await ensureClassCalendarEvent(run.id);
    console.log(
      `📅 [confirmTrainerOnCalendar] ensure events for run=${run.course_run_id}: ` +
      `created=${ensure.created} adopted=${ensure.adopted} kept=${ensure.kept} errors=${ensure.errors}`
    );
  } catch (e) {
    console.error(`❌ [confirmTrainerOnCalendar] ensureClassCalendarEvent failed:`, e);
  }

  const mapped = await pool.query<{ google_event_id: string; event_date: string }>(
    `SELECT google_event_id, event_date::text AS event_date
       FROM course_run_calendar_event
      WHERE course_run_id = $1
      ORDER BY event_date ASC`,
    [run.id]
  );
  if (mapped.rows.length === 0) {
    return { ...out, status: 'skipped', reason: 'no calendar events mapped for this run' };
  }
  out.eventsFound = mapped.rows.length;

  const emailLower = trainerEmail.trim().toLowerCase();
  const runIdStr = String(run.course_run_id || '');
  const virtual = isVirtualRun(run);
  let meetLink: string | null = (run.virtual_meeting_link || '').trim() || null;
  let meetGenerated = false;

  for (let i = 0; i < mapped.rows.length; i++) {
    const eventId = mapped.rows[i].google_event_id;
    try {
      let evt: calendar_v3.Schema$Event | null =
        await calendar.events.get({ calendarId, eventId }).then(r => r.data).catch(() => null);
      if (!evt || evt.status === 'cancelled') continue;

      // 2) Course Run ID in the description
      const descText = ((evt.description || '') + ' ' + (evt.location || '')).toLowerCase();
      if (runIdStr && !descText.includes(runIdStr.toLowerCase())) {
        const newDesc = `${evt.description ? evt.description + '\n' : ''}Course Run ID: ${runIdStr}`;
        await calendar.events.patch({
          calendarId, eventId,
          requestBody: { description: newDesc },
          sendUpdates: 'none',
        });
        evt.description = newDesc;
        out.descriptionsStamped++;
      }

      // 4) Google Meet for virtual classes — generate once, on the first live event.
      if (virtual && !meetLink && !meetGenerated) {
        try {
          await calendar.events.patch({
            calendarId, eventId,
            conferenceDataVersion: 1,
            requestBody: {
              conferenceData: {
                createRequest: {
                  requestId: crypto.randomUUID(),
                  conferenceSolutionKey: { type: 'hangoutsMeet' },
                },
              },
            },
            sendUpdates: 'none',
          });
          meetGenerated = true;
          // The create request can resolve asynchronously — re-read the event.
          for (let attempt = 0; attempt < 3 && !meetLink; attempt++) {
            const fresh = await calendar.events.get({ calendarId, eventId }).then(r => r.data).catch(() => null);
            const link = fresh?.hangoutLink
              || fresh?.conferenceData?.entryPoints?.find(ep => ep.entryPointType === 'video')?.uri
              || null;
            if (link) { meetLink = link; evt = fresh; break; }
            await new Promise(r => setTimeout(r, 1500));
          }
          if (meetLink) {
            await pool.query(
              `UPDATE course_run
                  SET virtual_meeting_link = $2,
                      virtual_meeting_provider = 'google_meet',
                      updated_at = NOW()
                WHERE id = $1`,
              [run.id, meetLink]
            );
            console.log(`📹 [confirmTrainerOnCalendar] Google Meet generated for run=${runIdStr}: ${meetLink}`);
          } else {
            console.warn(`⚠️ [confirmTrainerOnCalendar] Meet create request sent but no link resolved for run=${runIdStr}`);
          }
        } catch (meetErr) {
          console.error(`❌ [confirmTrainerOnCalendar] Meet generation failed for run=${runIdStr}:`, meetErr);
        }
      } else if (virtual && meetLink && !(evt.hangoutLink || '').trim() && !((evt.description || '').includes(meetLink))) {
        // Other session-day events: note the shared Meet link in the description.
        try {
          await calendar.events.patch({
            calendarId, eventId,
            requestBody: { description: `${evt.description ? evt.description + '\n' : ''}Google Meet: ${meetLink}` },
            sendUpdates: 'none',
          });
        } catch { /* cosmetic — ignore */ }
      }

      // 3) Trainer as attendee — with a real Google Calendar invite email.
      const attendees = evt.attendees || [];
      if (!attendees.some(a => (a.email || '').toLowerCase() === emailLower)) {
        await calendar.events.patch({
          calendarId, eventId,
          requestBody: {
            attendees: [...attendees, { email: trainerEmail, responseStatus: 'needsAction' }],
          },
          // 'all' so the TRAINER receives the Google Calendar invitation email
          // and can accept the RSVP (the confirmation email asks them to).
          sendUpdates: 'all',
        });
      }
      out.trainerAddedTo++;
    } catch (e) {
      console.error(`❌ [confirmTrainerOnCalendar] event ${eventId} failed:`, e);
    }
  }

  out.meetLink = meetLink;

  if (out.trainerAddedTo > 0) {
    await pool.query(
      `UPDATE course_run SET trainer_in_calendar = true, updated_at = NOW() WHERE id = $1`,
      [run.id]
    ).catch(() => { /* column may not exist on older tenants */ });
  }

  return out;
}
