import { google } from 'googleapis';
import pool from '../db';
import { getGoogleCredentials } from '../google-auth/googleAuth';
import * as crypto from 'crypto';

/**
 * Strip common prefixes from a calendar event summary so we can match it
 * against the course title from the DA application. Known prefixes:
 * "WSQ ", "VIRTUAL ", "EXTERNAL ", "[WSQ]", "[VIRTUAL]", "[EXTERNAL]",
 * and combinations thereof.
 */
function stripPrefixes(title: string): string {
  if (!title) return '';
  return title
    // 1. Remove "Day X" prefixes (e.g. "Day 2 - ", "Day 1:", "Day 3 ")
    .replace(/^\s*Day\s*\d+[\s-:]*/gi, '')
    // 2. Remove common SSG/Methodology tags (e.g. "[WSQ]", "VIRTUAL - ")
    .replace(/^\s*\[?(WSQ|VIRTUAL|EXTERNAL|HYBRID|E-LEARNING)\]?[\s-]*/gi, '')
    // 3. Remove any remaining leading/trailing punctuation/dashes
    .replace(/^[\s-:]+|[\s-:]+$/g, '')
    // 4. Normalise remaining string: lowercase and replace non-alphanumeric with spaces
    .toLowerCase()
    .replace(/[^a-z0-9]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

// Memory cache to bypass Google Calendar eventual consistency for newly created events
const recentCreatedEventsCache = new Map<string, any>();

/**
 * Normalise database date strings (YYYYMMDD or YYYY-MM-DD) to standard YYYY-MM-DD.
 */
function formatDbDate(dateVal: string | Date): string {
  if (!dateVal) return '';
  
  if (dateVal instanceof Date) {
    // Force the JS Date object (which may be shifted to UTC inside the DB layer) 
    // into a Singapore local time string to prevent the -8 hour backwards date-drift bug
    const sgtStr = dateVal.toLocaleString("en-US", { timeZone: "Asia/Singapore" });
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
 * Adds a learner to all relevant Google Calendar events for a course run.
 * 
 * Logic:
 * 1. Fetches all active sessions from `course_session` for the courseRunUuid.
 * 2. For each session date, finds a matching event in Google Calendar by title and date.
 * 3. Fallback: If no sessions exist, it uses the fallbackStartDate (or course_run.start_date) 
 *    to find a single matching event.
 * 
 * matching is fuzzy on title but exact on date.
 */
export async function addDaLearnerToCalendar(
  learnerEmail: string,
  courseRunUuid: string,
  courseTitle: string,
  fallbackStartDate?: string | Date | null,
  fallbackCourseCode?: string,
  fallbackRunId?: string
): Promise<{ totalSessions: number; addedTo: number }> {
  const result = { totalSessions: 0, addedTo: 0 };
  if (!learnerEmail || !courseTitle) return result;

  try {
    // 1. Load Calendar Config
    const tpRes = await pool.query(
      `SELECT sync_google_calendar, google_calendar_url FROM training_provider LIMIT 1`
    );
    if (!tpRes.rows[0]?.sync_google_calendar) return result;

    // 1b. Verify the application is still active (not cancelled)
    const activeAppRes = await pool.query(
      `SELECT application_status FROM da_application 
       WHERE LOWER(trainee_email) = LOWER($1) 
         AND (course_run_id = $2 OR course_run_id = (SELECT course_run_id FROM course_run WHERE id::text = $2 LIMIT 1))
         AND LOWER(application_status) IN ('confirmed', 'confirm application')
       LIMIT 1`,
      [learnerEmail, courseRunUuid]
    );
    if (activeAppRes.rows.length === 0) {
      console.log(`📅 [addDaLearnerToCalendar] No active application for ${learnerEmail} in ${courseRunUuid} — skipping add`);
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

    // 2. Resolve Course Run dates and Metadata
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
    
    // If not found in DB, try to use the fallback values provided from the DA application
    const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(courseRunUuid);
    const inferredRunId = !isUuid ? courseRunUuid : '';
    
    const ssgRunId = runMetaRes.rows[0]?.course_run_id || fallbackRunId || inferredRunId || '';
    const courseCode = runMetaRes.rows[0]?.course_code || fallbackCourseCode || '';
    const resolvedCourseTitle = courseTitle || runMetaRes.rows[0]?.db_course_title || '';

    // Fetch all active (not deleted) session dates for this course run
    const sessionRes = await pool.query(
      `SELECT start_date::text as start_date, start_time, end_time
       FROM course_session 
       WHERE course_run_id::text = $1 AND (deleted IS NOT TRUE)
       ORDER BY start_date ASC`,
      [resolvedUuid]
    );

    let datesToSync: string[] = [];
    let sessionMap: Record<string, { startTime: string; endTime: string }> = {};

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
            // Aggregate: keep the earliest start and latest end
            if (sTime < sessionMap[d].startTime) sessionMap[d].startTime = sTime;
            if (eTime > sessionMap[d].endTime) sessionMap[d].endTime = eTime;
          }
        }
      });
    } else {
      // Fallback logic
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

    // Filter out empty/invalid and dedup to unique dates
    datesToSync = Array.from(new Set(datesToSync.filter(Boolean)));

    if (datesToSync.length === 0) return result;
    result.totalSessions = datesToSync.length;

    // 3. Fetch calendar events in bulk for the required range
    const sortedDates = [...datesToSync].sort();
    // Use a wider 3-day buffer and explicit times to avoid timezone drift
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

    // Merge API events with recently created events from cache
    const allEvents = [...(eventsResponse.data.items || []), ...Array.from(recentCreatedEventsCache.values())];
    
    const strippedCourseTitle = stripPrefixes(courseTitle).toLowerCase();
    const learnerEmailLower = learnerEmail.trim().toLowerCase();

    for (let i = 0; i < sortedDates.length; i++) {
      const targetDate = sortedDates[i];
      const dayNumber = i + 1;

      // 1. Find ALL events on this date matching the core course title string
      const dateAndTitleMatches = allEvents.filter(evt => {
        const evtTitleNormalized = stripPrefixes(evt.summary || '');
        // Search for the cleaned course title within the cleaned event title (most robust)
        const titleMatch = evtTitleNormalized.includes(strippedCourseTitle) || strippedCourseTitle.includes(evtTitleNormalized);
        if (!titleMatch) return false;

        const evtDate = (evt.start?.dateTime?.slice(0, 10) || evt.start?.date || '');
        return evtDate === targetDate;
      });

      // 2. Try to strictly differentiate parallel sessions using "Day N" in the raw summary
      // This regex matches "Day 1", "Day-1", "Day: 1", "day1", etc.
      const expectedDayRegex = new RegExp(`\\bday\\s*[-:]?\\s*${dayNumber}\\b`, 'i');
      const strictDayMatches = dateAndTitleMatches.filter(evt => {
         const rawSummary = (evt.summary || '').toLowerCase();
         return expectedDayRegex.test(rawSummary);
      });

      // 3. Prefer strictly matched "Day X" events if found. Otherwise, fallback to the generic matches
      const matchedEvents = strictDayMatches.length > 0 ? strictDayMatches : dateAndTitleMatches;

      if (matchedEvents.length > 0) {
        for (const matchedEvent of matchedEvents) {
          if (!matchedEvent.id) continue;
          const existingAttendees = matchedEvent.attendees || [];
          if (!existingAttendees.some(a => (a.email || '').toLowerCase() === learnerEmailLower)) {
            try {
              // Construct standardized title and location
              let cleanTitle = resolvedCourseTitle
                .replace(/^\s*Day\s*\d+[\s-:]*/gi, '')
                .replace(/^\s*\[?(WSQ|VIRTUAL|EXTERNAL|HYBRID|E-LEARNING)\]?[\s-]*/gi, '')
                .replace(/^[\s-:]+|[\s-:]+$/g, '')
                .trim();

              const titleParts: string[] = [];
              if (sortedDates.length > 1) titleParts.push(`Day ${dayNumber}`);
              titleParts.push("WSQ");
              titleParts.push(cleanTitle);
              if (ssgRunId) titleParts.push(ssgRunId);
              const standardizedTitle = titleParts.join(' - ');

              const isVirtual = /virtual|online|e-learning/i.test(resolvedCourseTitle);
              const physicalAddress = "12 Woodlands Square #07-85/86/87 Woods Square Tower 1, Singapore 737715 Map https://g.page/tertiarycourses-sg?share";
              const expectedLocation = isVirtual ? "Virtual / Online" : physicalAddress;

              await calendar.events.patch({
                calendarId,
                eventId: matchedEvent.id,
                requestBody: {
                  summary: standardizedTitle,
                  location: expectedLocation,
                  attendees: [
                    ...existingAttendees,
                    { email: learnerEmail, responseStatus: 'needsAction' },
                  ],
                  // Restrict guest permissions
                  guestsCanInviteOthers: false,
                  guestsCanSeeOtherGuests: false,
                },
                sendUpdates: 'none',
              });
              result.addedTo++;
            } catch (patchErr) {
              console.error(`❌ [da-calendar-sync] Patch failed for ${learnerEmail} on ${targetDate}:`, patchErr);
            }
          } else {
            // Already present
            result.addedTo++;
          }
        }
      } else {
        console.log(`ℹ️ [da-calendar-sync] No matching calendar event found for "${resolvedCourseTitle}" on ${targetDate}. Creating new event...`);
        
        // 1. Acquire advisory lock to prevent parallel workers from creating duplicates
        const lockString = `cal-create-${courseRunUuid}-${targetDate}`;
        const lockId = parseInt(crypto.createHash('sha256').update(lockString).digest('hex').slice(0, 15), 16);
        
        await pool.query('SELECT pg_advisory_lock($1)', [lockId]);
        try {
          // 2. Double check if it was created just now by a parallel process or is in cache
          const cachedMissing = !Array.from(recentCreatedEventsCache.values()).some(evt => {
            const evtTitleNormalized = stripPrefixes(evt.summary || '');
            return (evtTitleNormalized.includes(strippedCourseTitle) || strippedCourseTitle.includes(evtTitleNormalized))
              && (evt.start?.dateTime?.slice(0, 10) || evt.start?.date || '') === targetDate;
          });

          let stillMissing = cachedMissing;

          if (stillMissing) {
            const recheckResponse = await calendar.events.list({
              calendarId,
              timeMin: new Date(targetDate + 'T00:00:00Z').toISOString(),
              timeMax: new Date(targetDate + 'T23:59:59Z').toISOString(),
              singleEvents: true,
              q: resolvedCourseTitle
            });
            
            const recentEvents = recheckResponse.data.items || [];
            stillMissing = !recentEvents.some(evt => {
              const evtTitleNormalized = stripPrefixes(evt.summary || '');
              return (evtTitleNormalized.includes(strippedCourseTitle) || strippedCourseTitle.includes(evtTitleNormalized))
                && (evt.start?.dateTime?.slice(0, 10) || evt.start?.date || '') === targetDate;
            });
          }

            if (stillMissing) {
              // 3. Construct the event data
              let cleanTitle = resolvedCourseTitle
                .replace(/^\s*Day\s*\d+[\s-:]*/gi, '')
                .replace(/^\s*\[?(WSQ|VIRTUAL|EXTERNAL|HYBRID|E-LEARNING)\]?[\s-]*/gi, '')
                .replace(/^[\s-:]+|[\s-:]+$/g, '')
                .trim();

              const titleParts: string[] = [];
              if (sortedDates.length > 1) titleParts.push(`Day ${dayNumber}`);
              titleParts.push("WSQ");
              titleParts.push(cleanTitle);
              if (ssgRunId) titleParts.push(ssgRunId);
              const newTitle = titleParts.join(' - ');

              const sTime = sessionMap[targetDate]?.startTime || '09:00';
              const eTime = sessionMap[targetDate]?.endTime || '18:00';

              const startDateTime = `${targetDate}T${sTime.padStart(5, '0')}:00`;
              const endDateTime = `${targetDate}T${eTime.padStart(5, '0')}:00`;

              const isVirtual = /virtual|online|e-learning/i.test(resolvedCourseTitle);
              const physicalAddress = "12 Woodlands Square #07-85/86/87 Woods Square Tower 1, Singapore 737715 Map https://g.page/tertiarycourses-sg?share";
              const location = isVirtual ? "Virtual / Online" : physicalAddress;

              const description = `Course Title: ${resolvedCourseTitle}\nCourse Code: ${courseCode || 'N/A'}\nCourse Run ID: ${ssgRunId || 'N/A'}\n\n*Auto-generated by LMS*`;

              const newEvent = await calendar.events.insert({
                calendarId,
                requestBody: {
                  summary: newTitle,
                  description,
                  location,
                  start: { dateTime: startDateTime, timeZone: 'Asia/Singapore' },
                  end: { dateTime: endDateTime, timeZone: 'Asia/Singapore' },
                  attendees: [
                    { email: learnerEmail, responseStatus: 'needsAction' }
                  ],
                  // Restrict guest permissions
                  guestsCanInviteOthers: false,
                  guestsCanSeeOtherGuests: false,
                },
                sendUpdates: 'none'
              });

            if (newEvent.data.id) {
              console.log(`✅ [da-calendar-sync] Successfully created new event "${newTitle}" and added ${learnerEmail}`);
              result.addedTo++;
              
              // Cache to prevent duplicate creation on sequential rapid calls
              recentCreatedEventsCache.set(newEvent.data.id, {
                id: newEvent.data.id,
                summary: newTitle,
                start: { dateTime: startDateTime },
                attendees: [{ email: learnerEmail, responseStatus: 'needsAction' }]
              });
              // Clear cache entry after 30 seconds
              setTimeout(() => recentCreatedEventsCache.delete(newEvent.data.id as string), 30000);
            }
          } else {
            console.log(`ℹ️ [da-calendar-sync] Event was created concurrently by another process. Skipping creation.`);
            // It will be picked up on the next retry sweep, or we could add the attendee here.
            // Since it's an edge case, we'll let the background retry job link the attendee.
          }
        } catch (createErr) {
          console.error(`❌ [da-calendar-sync] Failed to create new event on ${targetDate}:`, createErr);
        } finally {
          await pool.query('SELECT pg_advisory_unlock($1)', [lockId]);
        }
      }
    }

    return result;
  } catch (error) {
    console.error(`❌ [da-calendar-sync] Fatal error:`, error);
    return result;
  }
}

/**
 * Removes a learner from all relevant Google Calendar events for a course run.
 * Mirrors addDaLearnerToCalendar but removes the attendee instead of adding them.
 */
export async function removeDaLearnerFromCalendar(
  learnerEmail: string,
  courseRunUuid: string,
  courseTitle: string,
  fallbackStartDate?: string | Date | null
): Promise<{ totalSessions: number; removedFrom: number }> {
  const result = { totalSessions: 0, removedFrom: 0 };
  if (!learnerEmail || !courseTitle) return result;

  try {
    // 1. Load Calendar Config
    const tpRes = await pool.query(
      `SELECT sync_google_calendar, google_calendar_url FROM training_provider LIMIT 1`
    );
    if (!tpRes.rows[0]?.sync_google_calendar) return result;

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

    // 2. Resolve Course Run dates (same logic as addDaLearnerToCalendar)
    const runMetaRes = await pool.query(
      `SELECT id as resolved_uuid FROM course_run WHERE (id::text = $1 OR course_run_id = $1) LIMIT 1`,
      [courseRunUuid]
    );
    const resolvedUuid = runMetaRes.rows[0]?.resolved_uuid || courseRunUuid;

    const sessionRes = await pool.query(
      `SELECT start_date::text as start_date 
       FROM course_session 
       WHERE course_run_id::text = $1 AND (deleted IS NOT TRUE)
       ORDER BY start_date ASC`,
      [resolvedUuid]
    );

    let datesToSync: string[] = [];
    if (sessionRes.rows.length > 0) {
      datesToSync = sessionRes.rows.map(r => formatDbDate(r.start_date));
    } else {
      if (fallbackStartDate) {
        datesToSync = [formatDbDate(fallbackStartDate)];
      } else {
        const crRes = await pool.query(
          `SELECT start_date::text FROM course_run WHERE id::text = $1 OR course_run_id = $1 LIMIT 1`,
          [courseRunUuid]
        );
        if (crRes.rows[0]?.start_date) {
          datesToSync = [formatDbDate(crRes.rows[0].start_date)];
        }
      }
    }

    datesToSync = Array.from(new Set(datesToSync.filter(Boolean)));
    if (datesToSync.length === 0) return result;
    result.totalSessions = datesToSync.length;

    // 3. Fetch calendar events in bulk
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

    const allEvents = eventsResponse.data.items || [];
    const strippedCourseTitle = stripPrefixes(courseTitle).toLowerCase();
    const learnerEmailLower = learnerEmail.trim().toLowerCase();

    for (let i = 0; i < sortedDates.length; i++) {
      const targetDate = sortedDates[i];
      const dayNumber = i + 1;

      const dateAndTitleMatches = allEvents.filter(evt => {
        const evtTitleNormalized = stripPrefixes(evt.summary || '');
        const titleMatch = evtTitleNormalized.includes(strippedCourseTitle) || strippedCourseTitle.includes(evtTitleNormalized);
        if (!titleMatch) return false;
        const evtDate = (evt.start?.dateTime?.slice(0, 10) || evt.start?.date || '');
        return evtDate === targetDate;
      });

      const expectedDayRegex = new RegExp(`\\bday\\s*[-:]?\\s*${dayNumber}\\b`, 'i');
      const strictDayMatches = dateAndTitleMatches.filter(evt => {
        const rawSummary = (evt.summary || '').toLowerCase();
        return expectedDayRegex.test(rawSummary);
      });

      const matchedEvents = strictDayMatches.length > 0 ? strictDayMatches : dateAndTitleMatches;

      if (matchedEvents.length > 0) {
        for (const matchedEvent of matchedEvents) {
          if (!matchedEvent.id) continue;
          const existingAttendees = matchedEvent.attendees || [];
          const isAttendee = existingAttendees.some(a => (a.email || '').toLowerCase() === learnerEmailLower);
          if (isAttendee) {
            try {
              const updatedAttendees = existingAttendees.filter(a => (a.email || '').toLowerCase() !== learnerEmailLower);
              await calendar.events.patch({
                calendarId,
                eventId: matchedEvent.id,
                requestBody: {
                  attendees: updatedAttendees,
                },
                sendUpdates: 'none',
              });
              result.removedFrom++;
              console.log(`🗑️ [da-calendar-sync] Removed ${learnerEmail} from "${matchedEvent.summary}" on ${targetDate}`);
            } catch (patchErr) {
              console.error(`❌ [da-calendar-sync] Failed to remove ${learnerEmail} on ${targetDate}:`, patchErr);
            }
          }
        }
      }
    }

    return result;
  } catch (error) {
    console.error(`❌ [da-calendar-sync] Fatal error removing from calendar:`, error);
    return result;
  }
}

/**
 * Syncs all confirmed DA applicants for a specific course run.
 * Triggered when a course's sessions are updated or during auto-enrollment.
 */
export async function syncAllDaApplicantsToCalendar(courseRunUuid: string): Promise<void> {
  try {
    // 1. Resolve internal course_run_id (external string) to link with da_application
    const runRes = await pool.query(
      `SELECT course_run_id, (SELECT title FROM course WHERE id = course_run.course_id) as course_title 
       FROM course_run WHERE id::text = $1 OR course_run_id = $1 LIMIT 1`,
      [courseRunUuid]
    );
    if (runRes.rows.length === 0) return;

    const ssgRunId = runRes.rows[0].course_run_id;
    const courseTitle = runRes.rows[0].course_title || '';

    // 2. Find confirmed DA apps
    // We check both internal and external IDs in da_application.course_run_id
    const daRes = await pool.query(
      `SELECT id, trainee_email, course_title 
       FROM da_application 
       WHERE (course_run_id = $1 OR course_run_id = $2)
         AND enrolment_status = 'Confirmed'
         AND LOWER(application_status) NOT IN ('cancelled', 'rejected', 'failed')
         AND trainee_email IS NOT NULL`,
      [courseRunUuid, ssgRunId]
    );

    if (daRes.rows.length === 0) return;

    console.log(`🔄 [da-calendar-sync] Syncing ${daRes.rows.length} DA applicants for course run ${courseRunUuid}`);

    for (const da of daRes.rows) {
      const result = await addDaLearnerToCalendar(
        da.trainee_email,
        courseRunUuid,
        da.course_title || courseTitle
      );
      if (result.addedTo > 0) {
        await pool.query(
          `UPDATE da_application SET calendar_added = true WHERE id = $1`,
          [da.id]
        );
      }
    }
  } catch (err) {
    console.error(`❌ [da-calendar-sync] Batch sync failed:`, err);
  }
}

/**
 * Background retry mechanism to sweep for DA applications that are confirmed 
 * but missed the calendar step (e.g. because the event didn't exist yet).
 */
export async function retryFailedCalendarSyncs(): Promise<void> {
  try {
    const daRes = await pool.query(
      `SELECT id, trainee_email, course_title, course_run_id, course_start_date 
       FROM da_application 
       WHERE enrolment_status = 'Confirmed'
         AND (calendar_added IS NOT TRUE)
         AND trainee_email IS NOT NULL
         AND LOWER(application_status) IN ('confirm application', 'confirmed')`
    );

    if (daRes.rows.length === 0) return;

    console.log(`🔄 [da-calendar-sync] Retrying ${daRes.rows.length} missing calendar syncs...`);

    let successCount = 0;
    for (const da of daRes.rows) {
      // Resolve internal course_run UUID
      const runRes = await pool.query(
        `SELECT id FROM course_run 
         WHERE (id::text = $1 OR course_run_id = $1) 
           AND is_deleted IS NOT TRUE LIMIT 1`,
        [da.course_run_id]
      );
      
      const courseRunUuid = runRes.rows[0]?.id;
      
      const calResults = await addDaLearnerToCalendar(
        da.trainee_email,
        courseRunUuid || da.course_run_id,
        da.course_title || '',
        da.course_start_date
      );
      
      if (calResults.addedTo > 0) {
        await pool.query(
          `UPDATE da_application SET calendar_added = true WHERE id = $1`,
          [da.id]
        );
        successCount++;
      }
    }
    
    if (successCount > 0) {
      console.log(`✅ [da-calendar-sync] Successfully retried and added ${successCount} learners to the calendar.`);
    }

    // NEW: Proactive removal for cancelled applications
    const cancelledRes = await pool.query(
      `SELECT id, trainee_email, course_title, course_run_id, course_start_date 
       FROM da_application 
       WHERE calendar_added IS TRUE
         AND trainee_email IS NOT NULL
         AND LOWER(application_status) IN ('cancelled', 'rejected', 'failed')`
    );

    if (cancelledRes.rows.length > 0) {
      console.log(`🗑️ [da-calendar-sync] Found ${cancelledRes.rows.length} cancelled applications still marked as on calendar. Removing...`);
      for (const da of cancelledRes.rows) {
         // Resolve internal course_run UUID
         const runRes = await pool.query(
           `SELECT id FROM course_run 
            WHERE (id::text = $1 OR course_run_id = $1) 
              AND is_deleted IS NOT TRUE LIMIT 1`,
           [da.course_run_id]
         );
         
         const courseRunUuid = runRes.rows[0]?.id || da.course_run_id;
         const removeRes = await removeDaLearnerFromCalendar(
           da.trainee_email,
           courseRunUuid,
           da.course_title || '',
           da.course_start_date
         );

         if (removeRes.removedFrom > 0 || removeRes.totalSessions > 0) {
            await pool.query(`UPDATE da_application SET calendar_added = false WHERE id = $1`, [da.id]);
         }
      }
    }
  } catch (err) {
    console.error(`❌ [da-calendar-sync] Retry sweep failed:`, err);
  }
}
