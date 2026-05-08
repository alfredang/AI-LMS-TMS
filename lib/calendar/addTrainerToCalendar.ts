import { google } from 'googleapis';
import pool from '../db';
import { getGoogleCredentials } from '../google-auth/googleAuth';

const stripPrefixes = (t: string) =>
  (t || '').replace(/^\s*\[?(WSQ|VIRTUAL|EXTERNAL|HYBRID)\]?\s*/gi, '')
           .replace(/^\s*\[?(WSQ|VIRTUAL|EXTERNAL|HYBRID)\]?\s*/gi, '').trim();

const toSgtDate = (v: any) => {
  if (!v) return '';
  const d = v instanceof Date ? v : new Date(v);
  if (isNaN(d.getTime())) return '';
  return new Date(d.getTime() + 8 * 3600 * 1000).toISOString().slice(0, 10);
};

export async function addTrainerToCalendar(courseRunId: string, trainerEmail: string): Promise<{ success: boolean; addedCount: number; message: string }> {
  try {
    const classResult = await pool.query(
      `SELECT cr.id, cr.course_run_id, c.title AS course_title, cr.start_date, cr.end_date
       FROM course_run cr
       JOIN course c ON c.id = cr.course_id
       WHERE cr.id = $1 OR cr.course_run_id = $1 LIMIT 1`,
      [courseRunId]
    );

    const cr = classResult.rows[0];
    if (!cr) {
      return { success: false, addedCount: 0, message: 'Course run not found' };
    }

    const startDateIso = toSgtDate(cr.start_date);
    if (!startDateIso) {
      return { success: false, addedCount: 0, message: 'Course run has no start date' };
    }

    const tpCalRow = (await pool.query(
      `SELECT sync_google_calendar, google_calendar_url FROM training_provider LIMIT 1`
    )).rows[0];

    if (!tpCalRow?.sync_google_calendar) {
      return { success: false, addedCount: 0, message: 'Google Calendar sync is disabled' };
    }

    let calendarId = 'primary';
    const calUrl = tpCalRow.google_calendar_url || '';
    if (calUrl) {
      const cidMatch = calUrl.match(/[?&]cid=([^&]+)/);
      if (cidMatch) {
        try { calendarId = Buffer.from(cidMatch[1], 'base64').toString('utf-8'); }
        catch { calendarId = cidMatch[1]; }
      } else if (calUrl.includes('@')) {
        calendarId = calUrl;
      }
    }

    const credentials = await getGoogleCredentials(pool);
    const calOAuth = new google.auth.OAuth2(
      credentials.clientId,
      credentials.clientSecret,
      'https://developers.google.com/oauthplayground'
    );
    calOAuth.setCredentials({ refresh_token: credentials.refreshToken });
    const calendar = google.calendar({ version: 'v3', auth: calOAuth });

    const dayBefore = new Date(startDateIso);
    dayBefore.setDate(dayBefore.getDate() - 1);
    const dayAfter = new Date(startDateIso);
    if (cr.end_date) {
      const endIso = toSgtDate(cr.end_date);
      if (endIso) {
        const endD = new Date(endIso);
        dayAfter.setTime(Math.max(dayAfter.getTime(), endD.getTime()));
      }
    }
    dayAfter.setDate(dayAfter.getDate() + 2);

    const eventsRes = await calendar.events.list({
      calendarId,
      timeMin: dayBefore.toISOString(),
      timeMax: dayAfter.toISOString(),
      singleEvents: true,
      maxResults: 200,
    });

    const allEvents = eventsRes.data.items || [];
    const strippedTitle = stripPrefixes(cr.course_title).toLowerCase();
    const titleWords = new Set(strippedTitle.split(/\s+/).filter(w => w.length > 2));

    let matchedEvent = allEvents.find((evt) => {
      const desc = ((evt.description || '') + ' ' + (evt.location || '')).toLowerCase();
      return desc.includes(cr.course_run_id.toLowerCase());
    });

    if (!matchedEvent) {
      matchedEvent = allEvents.find((evt) => {
        const s = stripPrefixes(evt.summary || '').toLowerCase();
        const titleMatch = s.includes(strippedTitle) || strippedTitle.includes(s);
        const evtDate = evt.start?.dateTime?.slice(0, 10) || evt.start?.date || '';
        return titleMatch && evtDate === startDateIso;
      });
    }

    if (!matchedEvent && titleWords.size > 0) {
      matchedEvent = allEvents.find((evt) => {
        const s = stripPrefixes(evt.summary || '').toLowerCase();
        const evtWords = s.split(/\s+/).filter(w => w.length > 2);
        const overlap = evtWords.filter(w => titleWords.has(w));
        const evtDate = evt.start?.dateTime?.slice(0, 10) || evt.start?.date || '';
        return overlap.length >= Math.ceil(titleWords.size * 0.6) && evtDate === startDateIso;
      });
    }

    if (!matchedEvent) {
      return { success: false, addedCount: 0, message: 'Matching calendar event not found for this course run' };
    }

    const emailLower = trainerEmail.toLowerCase().trim();
    const attendees = matchedEvent.attendees || [];
    const alreadyPresent = attendees.some((a: any) => (a.email || '').toLowerCase() === emailLower);

    if (alreadyPresent) {
      // Just ensure the DB flag is true if they are already in the calendar
      await pool.query(
        `UPDATE course_run SET trainer_in_calendar = true, updated_at = NOW() WHERE id = $1`,
        [cr.id]
      );
      return { success: true, addedCount: 0, message: 'Trainer is already an attendee on this calendar event' };
    }

    const baseId = matchedEvent.id?.includes('_') ? matchedEvent.id.split('_')[0] : null;
    let eventsToUpdate = [];
    if (baseId) {
      const recurringRes = await calendar.events.list({
        calendarId,
        timeMin: dayBefore.toISOString(),
        timeMax: new Date(dayBefore.getTime() + 60 * 24 * 3600 * 1000).toISOString(),
        singleEvents: true,
        maxResults: 2500,
      });
      eventsToUpdate = (recurringRes.data.items || [])
        .filter((evt) => evt.id && evt.id.startsWith(baseId + '_'))
        .map((evt) => ({ id: evt.id, attendees: evt.attendees || [] }));
    }
    if (eventsToUpdate.length === 0) {
      eventsToUpdate = [
        { id: matchedEvent.id, attendees: matchedEvent.attendees || [] },
      ];
    }

    let addedCount = 0;
    for (const evt of eventsToUpdate) {
      if (evt.attendees.some((a: any) => (a.email || '').toLowerCase() === emailLower)) {
        continue;
      }
      await calendar.events.patch({
        calendarId,
        eventId: evt.id,
        requestBody: {
          attendees: [...evt.attendees, { email: trainerEmail, responseStatus: 'needsAction' }],
        },
        sendUpdates: 'none',
      });
      addedCount++;
    }

    if (addedCount > 0) {
      await pool.query(
        `UPDATE course_run SET trainer_in_calendar = true, updated_at = NOW() WHERE id = $1`,
        [cr.id]
      );
    }

    return { success: true, addedCount, message: `Successfully added to ${addedCount} calendar event(s)` };
  } catch (error: any) {
    console.error('❌ [addTrainerToCalendar] Error:', error);
    return { success: false, addedCount: 0, message: error.message || 'Unknown calendar API error' };
  }
}
