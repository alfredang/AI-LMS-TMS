import { Pool } from 'pg';
import * as dotenv from 'dotenv';
import { google } from 'googleapis';

// Use same method from codebase
async function getGoogleCredentials(pool: any) {
    const credsRes = await pool.query(`
        SELECT 
            google_client_id as "clientId",
            google_client_secret as "clientSecret",
            google_refresh_token as "refreshToken"
        FROM training_provider LIMIT 1
    `);
    if (!credsRes.rows.length) throw new Error('No Google credentials found');
    return {
        clientId: credsRes.rows[0].clientId,
        clientSecret: credsRes.rows[0].clientSecret,
        refreshToken: credsRes.rows[0].refreshToken,
    };
}

dotenv.config({ path: '.env.local' });
const pool = new Pool({
    connectionString: process.env.DATABASE_URL
});

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
    const res = await pool.query(`SELECT id, trainee_name, trainee_email, course_title, course_run_id, course_start_date FROM da_application WHERE trainee_name ILIKE '%LIM CHWEI LING%' LIMIT 1`);
    console.log("==== DA APPLICATION ====");
    console.log(res.rows[0]);

    if (res.rows.length === 0) {
        console.log("No application found for LIM CHWEI LING");
        return;
    }
    const da = res.rows[0];

    const runRes = await pool.query(`SELECT id, course_run_id, start_date FROM course_run WHERE course_run_id = $1 OR id::text = $1 LIMIT 1`, [da.course_run_id]);
    console.log("==== COURSE RUN ====");
    console.log(runRes.rows[0]);
    const crUuid = runRes.rows[0]?.id || da.course_run_id;

    const sessRes = await pool.query(`SELECT id, start_date FROM course_session WHERE course_run_id = $1 AND (deleted IS NOT TRUE)`, [crUuid]);
    console.log(`==== COURSE SESSIONS (${sessRes.rows.length} rows) ====`);
    console.log(sessRes.rows);

    let datesToSync = [];
    if (sessRes.rows.length > 0) {
        datesToSync = sessRes.rows.map(r => {
            const date = new Date(r.start_date);
            const utcMs = date.getTime();
            const utcDate = new Date(utcMs);
            return utcDate.toISOString().slice(0, 10);
        });
    } else {
        const fallBack = new Date(da.course_start_date || runRes.rows[0]?.start_date);
        datesToSync = [fallBack.toISOString().slice(0, 10)];
    }
    console.log("EXPECTED SEARCH DATES: ", Array.from(new Set(datesToSync)));

    const tpRes = await pool.query(`SELECT google_calendar_url FROM training_provider LIMIT 1`);
    const calUrl = tpRes.rows[0]?.google_calendar_url || '';
    let calendarId = 'primary';
    if (calUrl) {
      const cidMatch = calUrl.match(/[?&]cid=([^&]+)/);
      if (cidMatch) {
         try { calendarId = Buffer.from(cidMatch[1], 'base64').toString('utf-8'); } catch { calendarId = cidMatch[1]; }
      } else if (calUrl.includes('@')) {
         calendarId = calUrl;
      }
    }
    const allCals = [
        'sales@tertiarycourses.com.sg',
        'angch@tertiaryinfotech.com',
        'calendar4tertiary@gmail.com'
    ];

    try {
      const credentials = await getGoogleCredentials(pool);
      const oauth2Client = new google.auth.OAuth2(credentials.clientId, credentials.clientSecret, 'https://developers.google.com/oauthplayground');
      oauth2Client.setCredentials({ refresh_token: credentials.refreshToken });
      const calendar = google.calendar({ version: 'v3', auth: oauth2Client });

      const sortedDates = [...Array.from(new Set(datesToSync))].sort();
      const minD = new Date(sortedDates[0] + 'T00:00:00Z');
      minD.setDate(minD.getDate() - 3); 
      const maxD = new Date(sortedDates[sortedDates.length - 1] + 'T23:59:59Z');
      maxD.setDate(maxD.getDate() + 3);

      const strippedCourseTitle = stripPrefixes(da.course_title).toLowerCase();
      console.log(`We are looking for matching stripped title: "${strippedCourseTitle}"`);

      for (const cal of allCals) {
          console.log(`\n==== FETCHING CALENDAR: ${cal} ====`);
          try {
              const eventsResponse = await calendar.events.list({
                calendarId: cal,
                timeMin: minD.toISOString(),
                timeMax: maxD.toISOString(),
                singleEvents: true,
                maxResults: 2500,
              });

              const events = eventsResponse.data.items || [];
              let found = false;
              events.forEach(e => {
                const evtDate = e.start?.dateTime?.slice(0, 10) || e.start?.date;
                const evtStripped = stripPrefixes(e.summary || '').toLowerCase();
                if (evtStripped.includes('innovation') || evtStripped.includes('business')) {
                    found = true;
                    console.log(`⭐ FOUND POSSIBLE MATCH IN ${cal}: "${e.summary}" on ${evtDate}`);
                }
              });
              if (!found) console.log(`No events containing 'innovation' or 'business' found in ${cal}`);
          } catch(err: any) {
              console.log(`Failed to fetch ${cal}: ${err.message}`);
          }
      }
      
    } catch(err: any) {
      console.error("GCal Auth/Fetch error:", err.message);
    }
    
  } catch(e) {
    console.error(e);
  } finally {
    await pool.end();
  }
}
run();
