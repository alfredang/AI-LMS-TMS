import { Pool } from 'pg';
import { google } from 'googleapis';
import * as dotenv from 'dotenv';
import { getGoogleCredentials } from '../lib/google-auth/googleAuth';
import { removeDaLearnerFromCalendar, addDaLearnerToCalendar } from '../lib/google-calendar/da-calendar-sync';

dotenv.config({ path: '.env.local' });

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_URL && process.env.DATABASE_URL.includes('supabase')
    ? { rejectUnauthorized: false } : false,
});

function formatDbDate(dateVal: any) {
  if (!dateVal) return '';
  const clean = String(dateVal).trim();
  if (/^\d{8}$/.test(clean)) {
    return `${clean.slice(0, 4)}-${clean.slice(4, 6)}-${clean.slice(6, 8)}`;
  }
  return clean.slice(0, 10);
}

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

async function run() {
  try {
    const credentials = await getGoogleCredentials(pool);
    const oauth2Client = new google.auth.OAuth2(
      credentials.clientId,
      credentials.clientSecret,
      'https://developers.google.com/oauthplayground'
    );
    oauth2Client.setCredentials({ refresh_token: credentials.refreshToken });
    const calendar = google.calendar({ version: 'v3', auth: oauth2Client });

    const tpRes = await pool.query('SELECT google_calendar_url FROM training_provider LIMIT 1');
    let calendarId = 'primary';
    const calUrl = tpRes.rows[0]?.google_calendar_url || '';
    if (calUrl.includes('@')) calendarId = calUrl;
    else if (calUrl.match(/[?&]cid=([^&]+)/)) {
        const match = calUrl.match(/[?&]cid=([^&]+)/);
        if (match) {
            try { calendarId = Buffer.from(match[1], 'base64').toString('utf-8'); } catch { calendarId = match[1]; }
        }
    }

    console.log('--- PART 1: Comprehensive Timing Correction ---');
    const courseRunIds = ['1131713', '1077505', '1131877'];
    for (const runId of courseRunIds) {
      console.log(`Processing Run ID: ${runId}`);
      const runRes = await pool.query(
        `SELECT cr.id, c.title FROM course_run cr JOIN course c ON c.id = cr.course_id WHERE cr.course_run_id = $1`,
        [runId]
      );
      if (runRes.rows.length === 0) {
        console.log(`  Run ID ${runId} not found in DB.`);
        continue;
      }
      const { id: uuid, title: courseTitle } = runRes.rows[0];

      const sessions = await pool.query(
        `SELECT start_date::text, start_time, end_time FROM course_session WHERE course_run_id = $1 AND deleted IS NOT TRUE`,
        [uuid]
      );

      const sessionMap: Record<string, { startTime: string; endTime: string }> = {};
      sessions.rows.forEach(r => {
        const d = formatDbDate(r.start_date);
        const sTime = r.start_time || '09:00';
        const eTime = r.end_time || '18:00';
        if (!sessionMap[d]) {
          sessionMap[d] = { startTime: sTime, endTime: eTime };
        } else {
          if (sTime < sessionMap[d].startTime) sessionMap[d].startTime = sTime;
          if (eTime > sessionMap[d].endTime) sessionMap[d].endTime = eTime;
        }
      });

      const strippedTitle = stripPrefixes(courseTitle);
      for (const date in sessionMap) {
        const { startTime, endTime } = sessionMap[date];
        const expectedStart = `${date}T${startTime.padStart(5, '0')}:00`;
        const expectedEnd = `${date}T${endTime.padStart(5, '0')}:00`;

        console.log(`  Target Date ${date}: ${startTime} - ${endTime}`);
        
        // List ALL events on this date to find any that match the title
        const events = await calendar.events.list({
          calendarId,
          timeMin: new Date(date + 'T00:00:00Z').toISOString(),
          timeMax: new Date(date + 'T23:59:59Z').toISOString(),
          singleEvents: true,
          maxResults: 250
        });

        for (const evt of events.data.items || []) {
          const evtTitle = stripPrefixes(evt.summary || '');
          const isMatch = evtTitle.includes(strippedTitle) || strippedTitle.includes(evtTitle);
          
          if (isMatch) {
            const currentStart = evt.start?.dateTime?.slice(0, 16);
            const currentEnd = evt.end?.dateTime?.slice(0, 16);
            
            if (currentStart !== expectedStart.slice(0, 16) || currentEnd !== expectedEnd.slice(0, 16)) {
              console.log(`    UPDATING: "${evt.summary}" (${evt.id})`);
              console.log(`      From: ${currentStart} - ${currentEnd}`);
              console.log(`      To:   ${expectedStart} - ${expectedEnd}`);
              await calendar.events.patch({
                calendarId,
                eventId: evt.id!,
                requestBody: {
                  start: { dateTime: expectedStart, timeZone: 'Asia/Singapore' },
                  end: { dateTime: expectedEnd, timeZone: 'Asia/Singapore' },
                }
              });
            } else {
              console.log(`    CORRECT: "${evt.summary}" is already ${currentStart} - ${currentEnd}`);
            }
          }
        }
      }
    }

    console.log('\n--- PART 2: Removing ALL Cancelled Applicants ---');
    // 1. Get cancelled apps for the specific runs
    // 2. Get any cancelled apps that are marked as having been added to calendar
    // 3. Get any cancelled apps in the last 60 days
    const cancelledApps = await pool.query(
      `SELECT id, trainee_email, course_run_id, course_title, course_start_date 
       FROM da_application 
       WHERE enrolment_status = 'Cancelled' 
         AND (
           course_run_id IN ('1131713', '1077505', '1131877') 
           OR calendar_added IS TRUE
           OR created_at > NOW() - INTERVAL '60 days'
         )`
    );

    console.log(`Found ${cancelledApps.rows.length} cancelled applicants to check.`);
    for (const app of cancelledApps.rows) {
      console.log(`Checking removal for ${app.trainee_email} (Course: ${app.course_title})...`);
      
      const runRes = await pool.query(
        `SELECT id FROM course_run WHERE id::text = $1 OR course_run_id = $1 LIMIT 1`,
        [app.course_run_id]
      );
      const courseRunUuid = runRes.rows[0]?.id || app.course_run_id;

      const result = await removeDaLearnerFromCalendar(
        app.trainee_email,
        courseRunUuid,
        app.course_title,
        app.course_start_date
      );

      if (result.removedFrom > 0) {
        await pool.query(`UPDATE da_application SET calendar_added = false WHERE id = $1`, [app.id]);
        console.log(`  Successfully removed from ${result.removedFrom} sessions.`);
      } else {
        // Just mark as false anyway to be consistent
        await pool.query(`UPDATE da_application SET calendar_added = false WHERE id = $1`, [app.id]);
      }
    }

    console.log('\n--- Final Sync Sweep ---');
    // For the 3 courses, make sure all Confirmed ones are added correctly
    for (const runId of courseRunIds) {
        const confirmedApps = await pool.query(
            `SELECT trainee_email, course_title, course_run_id, course_start_date 
             FROM da_application 
             WHERE enrolment_status = 'Confirmed' AND course_run_id = $1`,
            [runId]
        );
        console.log(`Re-syncing ${confirmedApps.rows.length} confirmed apps for ${runId}...`);
        for (const app of confirmedApps.rows) {
            const runRes = await pool.query(
                `SELECT id FROM course_run WHERE id::text = $1 OR course_run_id = $1 LIMIT 1`,
                [app.course_run_id]
            );
            const courseRunUuid = runRes.rows[0]?.id || app.course_run_id;
            await addDaLearnerToCalendar(app.trainee_email, courseRunUuid, app.course_title, app.course_start_date);
        }
    }

    console.log('\n--- Correction Script Finished ---');
  } catch (err) {
    console.error('Fatal error in correction script:', err);
  } finally {
    await pool.end();
  }
}

run();
