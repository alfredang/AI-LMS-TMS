import { google } from 'googleapis';
import pool from '../db';
import { getGoogleCredentials } from '../google-auth/googleAuth';
import { getTrainingPartnerIdentifiers } from '../trainingPartnerIdentifiers';
import { calendarWritesAllowed } from '../calendar/calendarGuard';
import * as crypto from 'crypto';

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

// Words ignored when comparing titles by token overlap. "wsq/external/virtual/
// hybrid/elearning" appear mid-string in some trainer-edited event titles
// (e.g. "[EXTERNAL] WSQ - ...") and would otherwise inflate the shared-token
// count for unrelated courses. Generic English connectors do the same.
const TITLE_STOPWORDS = new Set([
  'with', 'and', 'the', 'of', 'for', 'a', 'an', 'on', 'in', 'to', 'by', 'or',
  'wsq', 'external', 'virtual', 'hybrid', 'elearning',
]);

function tokenizeTitle(normalized: string): string[] {
  return normalized.split(' ').filter(t => t.length > 1 && !TITLE_STOPWORDS.has(t));
}

/**
 * Returns true when two course titles probably refer to the same course.
 * Tries strict substring containment first (the original behaviour) then
 * falls back to a token-overlap heuristic so a trainer-renamed calendar
 * event still matches the spreadsheet title.
 *
 * Example that needed this: spreadsheet says "Agentic AI Applications with
 * Claude Code", calendar event says "[EXTERNAL] WSQ - Agentic AI with Claude
 * Code" — same course, "Applications" dropped. Strict containment fails;
 * token overlap finds 4 shared distinctive tokens (agentic, ai, claude, code)
 * and matches.
 *
 * Conservative thresholds (≥3 shared tokens AND ≥60% of the smaller tokenset)
 * stop unrelated courses with one or two words in common from false-matching.
 * Caller still enforces date equality.
 */
function titlesProbablyMatch(courseTitle: string, eventTitle: string): boolean {
  const normCourse = stripPrefixes(courseTitle);
  const normEvent = stripPrefixes(eventTitle);
  if (!normCourse || !normEvent) return false;
  if (normCourse.includes(normEvent) || normEvent.includes(normCourse)) return true;

  const tokCourse = new Set(tokenizeTitle(normCourse));
  const tokEvent = new Set(tokenizeTitle(normEvent));
  if (tokCourse.size === 0 || tokEvent.size === 0) return false;

  let shared = 0;
  tokCourse.forEach(t => { if (tokEvent.has(t)) shared++; });

  const minSize = Math.min(tokCourse.size, tokEvent.size);
  const required = Math.max(3, Math.floor(minSize * 0.6));
  return shared >= required;
}

const recentCreatedEventsCache = new Map<string, any>();

function formatDbDate(dateVal: string | Date): string {
  if (!dateVal) return '';

  if (dateVal instanceof Date) {
    if (Number.isNaN(dateVal.getTime())) return '';
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
  // Only accept YYYY-MM-DD-ish strings. Free-form text like "30/05/2026" or
  // "May 30, 2026" used to be returned as-is via slice(0, 10), which then
  // crashed downstream with `new Date(badStr + 'T00:00:00Z') → Invalid Date
  // → toISOString() throws`. Returning '' here lets the .filter(Boolean) on
  // datesToSync drop the bad value instead.
  const ymdMatch = clean.match(/^(\d{4}-\d{2}-\d{2})/);
  return ymdMatch ? ymdMatch[1] : '';
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
    if (!tpRes.rows[0]?.sync_google_calendar || !calendarWritesAllowed()) return result;

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
    const ssgRunId = runMetaRes.rows[0]?.course_run_id || '';
    const courseCode = runMetaRes.rows[0]?.course_code || '';
    const resolvedCourseTitle = courseTitle || runMetaRes.rows[0]?.db_course_title || '';

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
        if (!titlesProbablyMatch(courseTitle, evt.summary || '')) return false;
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

    // Serialize patches against the same Google Calendar event across the
    // whole batch. The upload pipeline processes 5 rows in parallel via
    // Promise.all, and without this every parallel caller would do
    // events.get → events.patch with no coordination. That produced two
    // production failure modes:
    //   1. Lost update: caller A reads attendees=[X], caller B reads
    //      attendees=[X], both compute their own new list, both patch — the
    //      second write clobbers the first. Both report success but the
    //      first learner is silently dropped from the calendar.
    //   2. 412 etag conflict / 429 rate-limit on the patch — caught and
    //      logged below, but result.addedTo never increments so the row
    //      sticks at calendar_added=false with no admin recovery path.
    // The advisory lock is keyed per Google event id (sha256 → 60-bit int)
    // so different events don't block each other. Inside the lock we
    // re-fetch attendees to read the latest committed state instead of
    // trusting the pre-lock snapshot.
    const patchAttendeeUnderLock = async (eventId: string) => {
      const lockKey = `ca-cal-evt-${eventId}`;
      const lockId = parseInt(crypto.createHash('sha256').update(lockKey).digest('hex').slice(0, 15), 16);
      const lockClient = await pool.connect();
      let locked = false;
      try {
        await lockClient.query('SELECT pg_advisory_lock($1)', [lockId]);
        locked = true;
        const fresh = await calendar.events.get({ calendarId, eventId });
        const attendees = fresh.data.attendees || [];
        if (attendees.some((a: any) => (a.email || '').toLowerCase() === learnerEmailLower)) {
          result.addedTo++;
          return;
        }
        await calendar.events.patch({
          calendarId,
          eventId,
          requestBody: {
            attendees: [
              ...attendees,
              { email: learnerEmail, responseStatus: 'needsAction' },
            ],
            guestsCanInviteOthers: false,
            guestsCanSeeOtherGuests: false,
          },
          sendUpdates: 'none',
        });
        result.addedTo++;
      } catch (patchErr) {
        console.error(`❌ [ca-calendar-sync] Patch failed for ${learnerEmail} (event ${eventId}):`, patchErr);
      } finally {
        if (locked) {
          await lockClient.query('SELECT pg_advisory_unlock($1)', [lockId]).catch(unlockErr => {
            console.warn(`[ca-calendar-sync] advisory_unlock failed:`, unlockErr instanceof Error ? unlockErr.message : unlockErr);
          });
        }
        lockClient.release();
      }
    };

    // Patch each unique recurring master once — propagates to every occurrence.
    for (const masterId of recurringMasterIds) {
      await patchAttendeeUnderLock(masterId);
    }

    // Patch each unique standalone event once.
    for (const eventId of standaloneEvents.keys()) {
      await patchAttendeeUnderLock(eventId);
    }

    // Auto-create events ONLY when zero matches landed across every session
    // date. Mirrors da-calendar-sync.ts: if any date matched but others didn't,
    // it's almost always a title/date matching glitch on an existing recurring
    // series — creating new events would duplicate it. Only-when-empty
    // preserves the "brand new course → auto-populate calendar" workflow that
    // CA admins expect when uploading the very first batch for a course.
    if (missingDates.length > 0 && result.addedTo === 0) {
      console.log(`ℹ️ [ca-calendar-sync] No existing events found for "${courseTitle}" — creating ${missingDates.length} event(s)...`);

      const firstMissing = missingDates[0];
      const lockString = `cal-create-${courseRunUuid}-${firstMissing.date}`;
      const lockId = parseInt(crypto.createHash('sha256').update(lockString).digest('hex').slice(0, 15), 16);

      // Hold the lock on a dedicated client so acquire + release run on the
      // same Postgres session. pool.query() checks out a connection per call
      // and pg_advisory_lock is session-scoped — without a dedicated client
      // the unlock would silently no-op on a different connection (leaving
      // the lock held until the connection is closed) AND a subsequent
      // pool.query lock call on the original session would just increment
      // the counter instead of blocking, defeating the lock entirely.
      const lockClient = await pool.connect();
      let lockAcquired = false;
      try {
        await lockClient.query('SELECT pg_advisory_lock($1)', [lockId]);
        lockAcquired = true;
        // Race-recovery check: the upload pipeline processes 5 rows in
        // parallel via Promise.all, and all 5 may have computed
        // missingDates BEFORE entering this lock (with zero matches each).
        // Without re-checking after acquiring the lock, every caller would
        // proceed to .events.insert and we'd get 5 duplicate events for the
        // same course+date. The advisory lock guarantees we run serially,
        // but doesn't stop us from doing the same wrong thing five times.
        // Inspecting recentCreatedEventsCache catches anything a prior
        // lock-holder just inserted, so we attach instead of duplicating.
        const cachedMatch = Array.from(recentCreatedEventsCache.values()).find(evt => {
          if (!titlesProbablyMatch(courseTitle, evt.summary || '')) return false;
          const evtDate = evt.start?.dateTime?.slice(0, 10) || evt.start?.date || '';
          return evtDate === firstMissing.date;
        });

        if (cachedMatch?.id) {
          console.log(`ℹ️ [ca-calendar-sync] Lock-race recovery: attaching ${learnerEmail} to event ${cachedMatch.id} created by a concurrent caller`);
          try {
            const fresh = await calendar.events.get({ calendarId, eventId: cachedMatch.id });
            const existingAttendees = fresh.data.attendees || [];
            const already = existingAttendees.some((a: any) => (a.email || '').toLowerCase() === learnerEmailLower);
            if (!already) {
              await calendar.events.patch({
                calendarId,
                eventId: cachedMatch.id,
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
              // Refresh cache entry so the next concurrent caller sees the
              // updated attendee list (and short-circuits on `already=true`).
              recentCreatedEventsCache.set(cachedMatch.id, {
                ...fresh.data,
                attendees: [...existingAttendees, { email: learnerEmail, responseStatus: 'needsAction' }],
              });
            }
            result.addedTo += missingDates.length;
          } catch (raceAttachErr) {
            console.error(`❌ [ca-calendar-sync] Race-recovery attach failed for ${learnerEmail} on ${cachedMatch.id}:`, raceAttachErr);
          }
          return result;
        }

        const cleanTitle = resolvedCourseTitle
          .replace(/^\s*Day\s*\d+[\s-:]*/gi, '')
          .replace(/^\s*\[?(WSQ|VIRTUAL|EXTERNAL|HYBRID|E-LEARNING)\]?[\s-]*/gi, '')
          .replace(/^[\s-:]+|[\s-:]+$/g, '')
          .trim();

        const baseTitle = `WSQ - ${cleanTitle}`;
        const isVirtual = /virtual|online|e-learning/i.test(resolvedCourseTitle);
        const tpInfo = await getTrainingPartnerIdentifiers();
        const physicalAddress = tpInfo.companyAddress || 'Office';
        const location = isVirtual ? 'Virtual / Online' : physicalAddress;
        const description = `Course Title: ${resolvedCourseTitle}\nCourse Code: ${courseCode || 'N/A'}\nCourse Run ID: ${ssgRunId || 'N/A'}\n\n*Auto-generated by LMS (Company Application)*`;

        // Default 09:30–18:30, matching da-calendar-sync.ts.
        const startDateTime = `${firstMissing.date}T09:30:00`;
        const endDateTime = `${firstMissing.date}T18:30:00`;

        if (missingDates.length === 1) {
          const newTitle = sortedDates.length > 1 ? `Day ${firstMissing.dayNumber} - ${baseTitle}` : baseTitle;
          const newEvent = await calendar.events.insert({
            calendarId,
            requestBody: {
              summary: newTitle,
              description,
              location,
              start: { dateTime: startDateTime, timeZone: 'Asia/Singapore' },
              end: { dateTime: endDateTime, timeZone: 'Asia/Singapore' },
              attendees: [{ email: learnerEmail, responseStatus: 'needsAction' }],
              guestsCanInviteOthers: false,
              guestsCanSeeOtherGuests: false,
            },
            sendUpdates: 'none',
          });
          if (newEvent.data.id) {
            recentCreatedEventsCache.set(newEvent.data.id, newEvent.data);
            result.addedTo++;
          }
        } else {
          // Multi-day course — create a recurring series anchored on the first
          // missing date with RDATEs for the rest. Then patch instance titles
          // to "Day N - ...".
          const rdates = missingDates.slice(1).map(m => m.date.replace(/-/g, '') + 'T093000');
          const recurrence = [`RDATE;TZID=Asia/Singapore:${rdates.join(',')}`];

          const newEvent = await calendar.events.insert({
            calendarId,
            requestBody: {
              summary: baseTitle,
              description,
              location,
              start: { dateTime: startDateTime, timeZone: 'Asia/Singapore' },
              end: { dateTime: endDateTime, timeZone: 'Asia/Singapore' },
              recurrence,
              attendees: [{ email: learnerEmail, responseStatus: 'needsAction' }],
              guestsCanInviteOthers: false,
              guestsCanSeeOtherGuests: false,
            },
            sendUpdates: 'none',
          });

          if (newEvent.data.id) {
            recentCreatedEventsCache.set(newEvent.data.id, newEvent.data);
            result.addedTo += missingDates.length;

            // Brief wait so Google has materialised the instances before patching.
            await new Promise(resolve => setTimeout(resolve, 1000));

            const instancesRes = await calendar.events.instances({
              calendarId,
              eventId: newEvent.data.id,
            });
            const instances = instancesRes.data.items || [];
            for (const instance of instances) {
              const instDate = instance.start?.dateTime?.slice(0, 10) || instance.start?.date || '';
              const missingObj = missingDates.find(m => m.date === instDate);
              if (missingObj && instance.id) {
                const dayTitle = `Day ${missingObj.dayNumber} - ${baseTitle}`;
                await calendar.events.patch({
                  calendarId,
                  eventId: instance.id,
                  requestBody: { summary: dayTitle },
                  sendUpdates: 'none',
                });
              }
            }
          }
        }
      } catch (createErr) {
        console.error(`❌ [ca-calendar-sync] Failed to create event for "${courseTitle}":`, createErr);
      } finally {
        if (lockAcquired) {
          await lockClient.query('SELECT pg_advisory_unlock($1)', [lockId]).catch(unlockErr => {
            console.warn(`[ca-calendar-sync] advisory_unlock failed:`, unlockErr instanceof Error ? unlockErr.message : unlockErr);
          });
        }
        lockClient.release();
      }
    } else if (missingDates.length > 0) {
      // Partial match — some dates patched, others not. Skip auto-create to
      // avoid duplicating an existing recurring series.
      console.warn(
        `⚠️ [ca-calendar-sync] ${learnerEmail}: ${missingDates.length} date(s) unmatched for "${courseTitle}" but ${result.addedTo} other date(s) DID match — skipping auto-create to avoid duplicate event. Unmatched: ${missingDates.map(m => m.date).join(', ')}`
      );
    }

    return result;
  } catch (error) {
    console.error(`❌ [ca-calendar-sync] Fatal error:`, error);
    return result;
  }
}
