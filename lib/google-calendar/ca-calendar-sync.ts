import { google } from 'googleapis';
import pool from '../db';
import { getGoogleCredentials } from '../google-auth/googleAuth';

function stripPrefixes(title: string): string {
  if (!title) return '';
  return title
    .replace(/^\s*Day\s*\d+[\s-:]*/gi, '')
    .replace(/^\s*\[?(WSQ|VIRTUAL|EXTERNAL|HYBRID|E-LEARNING)\]?[\s-]*/gi, '')
    .replace(/^[\s-:]+|[\s-:]+$/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

const recentCreatedEventsCache = new Map<string, any>();

function formatDbDate(dateVal: string | Date): string {
  if (!dateVal) return '';

  if (dateVal instanceof Date) {
    const sgtStr = dateVal.toLocaleString('en-US', { timeZone: 'Asia/Singapore' });
    const localSgt = new Date(sgtStr);
    const year = localSgt.getFullYear();
    const month = String(localSgt.getMonth() + 1).padStart(2, '0');
    const day = String(localSgt.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  }

  const clean = String(dateVal).trim();
  if (/^\d{8}$/.test(clean)) {
    return `${clean.slice(0, 4)}-${clean.slice(4, 6)}-${clean.slice(6, 8)}`;
  }
  return clean.slice(0, 10);
}

/**
 * Adds a Company Application learner to all relevant Google Calendar events
 * for a course run.
 *
 * Mirrors the DA flow but the "is this application active?" guard checks
 * the `company_application` table instead of `da_application`.
 *
 * Called from the CA auto-enrol pipeline after a successful SSG enrolment.
 */
export async function addCaLearnerToCalendar(
  learnerEmail: string,
  courseRunUuid: string,
  courseTitle: string,
  fallbackStartDate?: string | Date | null
): Promise<{ totalSessions: number; addedTo: number }> {
  const result = { totalSessions: 0, addedTo: 0 };
  if (!learnerEmail || !courseTitle) return result;

  try {
    const tpRes = await pool.query(
      `SELECT sync_google_calendar, google_calendar_url FROM training_provider LIMIT 1`
    );
    if (!tpRes.rows[0]?.sync_google_calendar) return result;

    const activeAppRes = await pool.query(
      `SELECT enrolment_id FROM company_application
       WHERE LOWER(trainee_email) = LOWER($1)
         AND (course_run_id = $2 OR course_run_id = (SELECT course_run_id FROM course_run WHERE id::text = $2 LIMIT 1))
         AND enrolment_id IS NOT NULL
         AND TRIM(enrolment_id) <> ''
       LIMIT 1`,
      [learnerEmail, courseRunUuid]
    );
    if (activeAppRes.rows.length === 0) {
      console.log(`📅 [ca-calendar-sync] No active CA enrolment for ${learnerEmail} in ${courseRunUuid} — skipping add`);
      return result;
    }

    const credentials = await getGoogleCredentials(pool);
    const oauth2Client = new google.auth.OAuth2(
      credentials.clientId,
      credentials.clientSecret,
      'https://developers.google.com/oauthplayground'
    );
    oauth2Client.setCredentials({ refresh_token: credentials.refreshToken });
    const calendar = google.calendar({ version: 'v3', auth: oauth2Client });

    let calendarId = 'primary';
    const calUrl = tpRes.rows[0].google_calendar_url || '';
    if (calUrl) {
      const cidMatch = calUrl.match(/[?&]cid=([^&]+)/);
      if (cidMatch) {
        try {
          calendarId = Buffer.from(cidMatch[1], 'base64').toString('utf-8');
        } catch {
          calendarId = cidMatch[1];
        }
      } else if (calUrl.includes('@')) {
        calendarId = calUrl;
      }
    }

    const runMetaRes = await pool.query(
      `SELECT
         cr.id as resolved_uuid,
         cr.course_run_id,
         c.course_code,
         c.title as db_course_title
       FROM course_run cr
       LEFT JOIN course c ON c.id = cr.course_id
       WHERE (cr.id::text = $1 OR cr.course_run_id = $1)
       LIMIT 1`,
      [courseRunUuid]
    );
    const resolvedUuid = runMetaRes.rows[0]?.resolved_uuid || courseRunUuid;

    const sessionRes = await pool.query(
      `SELECT start_date::text as start_date, start_time, end_time
       FROM course_session
       WHERE course_run_id::text = $1 AND (deleted IS NOT TRUE)
       ORDER BY start_date ASC`,
      [resolvedUuid]
    );

    let datesToSync: string[] = [];
    const sessionMap: Record<string, { startTime: string; endTime: string }> = {};

    if (sessionRes.rows.length > 0) {
      sessionRes.rows.forEach(r => {
        const d = formatDbDate(r.start_date);
        if (d) {
          datesToSync.push(d);
          const sTime = r.start_time || '09:00';
          const eTime = r.end_time || '18:00';
          if (!sessionMap[d]) {
            sessionMap[d] = { startTime: sTime, endTime: eTime };
          } else {
            if (sTime < sessionMap[d].startTime) sessionMap[d].startTime = sTime;
            if (eTime > sessionMap[d].endTime) sessionMap[d].endTime = eTime;
          }
        }
      });
    } else {
      if (fallbackStartDate) {
        const d = formatDbDate(fallbackStartDate);
        datesToSync = [d];
        sessionMap[d] = { startTime: '09:00', endTime: '18:00' };
      } else {
        const crRes = await pool.query(
          `SELECT start_date::text FROM course_run WHERE id::text = $1 OR course_run_id = $1 LIMIT 1`,
          [courseRunUuid]
        );
        if (crRes.rows[0]?.start_date) {
          const d = formatDbDate(crRes.rows[0].start_date);
          datesToSync = [d];
          sessionMap[d] = { startTime: '09:00', endTime: '18:00' };
        }
      }
    }

    datesToSync = Array.from(new Set(datesToSync.filter(Boolean)));
    if (datesToSync.length === 0) return result;
    result.totalSessions = datesToSync.length;

    const sortedDates = [...datesToSync].sort();
    const minD = new Date(sortedDates[0] + 'T00:00:00Z');
    minD.setDate(minD.getDate() - 3);
    const maxD = new Date(sortedDates[sortedDates.length - 1] + 'T23:59:59Z');
    maxD.setDate(maxD.getDate() + 3);

    const eventsResponse = await calendar.events.list({
      calendarId,
      timeMin: minD.toISOString(),
      timeMax: maxD.toISOString(),
      singleEvents: true,
      maxResults: 2500,
    });

    const allEvents = [
      ...(eventsResponse.data.items || []),
      ...Array.from(recentCreatedEventsCache.values()),
    ];

    const strippedCourseTitle = stripPrefixes(courseTitle).toLowerCase();
    const learnerEmailLower = learnerEmail.trim().toLowerCase();

    const missingDates: { date: string; dayNumber: number }[] = [];

    // Two-pass match: first collect every matched event grouped by either
    // master (for recurring events) or by id (for one-off events). Patching
    // a recurring instance only creates a per-day exception, which left the
    // learner missing on every other day of the course — so we patch the
    // recurring master once instead, and Google propagates the new guest to
    // every occurrence.
    const recurringMasterIds = new Set<string>();
    const standaloneEvents = new Map<string, any>();

    for (let i = 0; i < sortedDates.length; i++) {
      const targetDate = sortedDates[i];
      const dayNumber = i + 1;

      const dateAndTitleMatches = allEvents.filter(evt => {
        const evtTitleNormalized = stripPrefixes(evt.summary || '');
        const titleMatch =
          evtTitleNormalized.includes(strippedCourseTitle) ||
          strippedCourseTitle.includes(evtTitleNormalized);
        if (!titleMatch) return false;

        const evtDate = evt.start?.dateTime?.slice(0, 10) || evt.start?.date || '';
        return evtDate === targetDate;
      });

      const expectedDayRegex = new RegExp(`\\bday\\s*[-:]?\\s*${dayNumber}\\b`, 'i');
      const strictDayMatches = dateAndTitleMatches.filter(evt => {
        const rawSummary = (evt.summary || '').toLowerCase();
        return expectedDayRegex.test(rawSummary);
      });

      const matchedEvents = strictDayMatches.length > 0 ? strictDayMatches : dateAndTitleMatches;

      if (matchedEvents.length === 0) {
        missingDates.push({ date: targetDate, dayNumber });
        continue;
      }

      for (const matchedEvent of matchedEvents) {
        if (matchedEvent.recurringEventId) {
          recurringMasterIds.add(matchedEvent.recurringEventId);
        } else if (matchedEvent.id) {
          standaloneEvents.set(matchedEvent.id, matchedEvent);
        }
      }
    }

    // Patch each unique recurring master once — propagates to every occurrence.
    for (const masterId of recurringMasterIds) {
      try {
        const masterRes = await calendar.events.get({ calendarId, eventId: masterId });
        const masterAttendees = masterRes.data.attendees || [];
        if (masterAttendees.some((a: any) => (a.email || '').toLowerCase() === learnerEmailLower)) {
          result.addedTo++;
          continue;
        }
        await calendar.events.patch({
          calendarId,
          eventId: masterId,
          requestBody: {
            attendees: [
              ...masterAttendees,
              { email: learnerEmail, responseStatus: 'needsAction' },
            ],
            guestsCanInviteOthers: false,
            guestsCanSeeOtherGuests: false,
          },
          sendUpdates: 'none',
        });
        result.addedTo++;
      } catch (patchErr) {
        console.error(`❌ [ca-calendar-sync] Master patch failed for ${learnerEmail} (event ${masterId}):`, patchErr);
      }
    }

    // Patch each unique standalone event once.
    for (const [eventId, evt] of standaloneEvents) {
      try {
        const existingAttendees = evt.attendees || [];
        if (existingAttendees.some((a: any) => (a.email || '').toLowerCase() === learnerEmailLower)) {
          result.addedTo++;
          continue;
        }
        await calendar.events.patch({
          calendarId,
          eventId,
          requestBody: {
            attendees: [
              ...existingAttendees,
              { email: learnerEmail, responseStatus: 'needsAction' },
            ],
            guestsCanInviteOthers: false,
            guestsCanSeeOtherGuests: false,
          },
          sendUpdates: 'none',
        });
        result.addedTo++;
      } catch (patchErr) {
        console.error(`❌ [ca-calendar-sync] Standalone patch failed for ${learnerEmail} (event ${eventId}):`, patchErr);
      }
    }

    if (missingDates.length > 0) {
      // CA pipeline only attaches learners to events the trainer/admin already
      // set up — it must not auto-create. Earlier behaviour created a fresh
      // event when matching missed, which produced a duplicate class on the
      // calendar instead of adding the learner to the existing one.
      console.warn(
        `⚠️  [ca-calendar-sync] ${learnerEmail}: ${missingDates.length} date(s) had no matching event for "${courseTitle}" — skipping (no auto-create). Dates: ${missingDates.map(m => m.date).join(', ')}`
      );
    }

    return result;
  } catch (error) {
    console.error(`❌ [ca-calendar-sync] Fatal error:`, error);
    return result;
  }
}
