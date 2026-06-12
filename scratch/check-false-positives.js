const { google } = require('googleapis');
const { Pool } = require('pg');
require('dotenv').config({ path: '.env.local' });

function stripPrefixes(title) {
  if (!title) return '';
  return title
    .replace(/^\s*Day\s*\d+[\s-:]*/gi, '')
    .replace(/^\s*\[?[\s\w-]*TGS-[\w-]*\]?[\s-:]*/i, '')
    .trim();
}

async function run() {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  
  const credentialsText = process.env.GOOGLE_CREDENTIALS;
  if (!credentialsText) throw new Error('Missing GOOGLE_CREDENTIALS');
  
  let credentials;
  try {
    credentials = JSON.parse(credentialsText);
  } catch (err) {
    if (typeof credentialsText === 'string') {
      const decoded = Buffer.from(credentialsText, 'base64').toString('utf8');
      credentials = JSON.parse(decoded);
    }
  }

  const calendarId = process.env.GOOGLE_CALENDAR_ID || 'primary';
  const oauth2Client = new google.auth.OAuth2();
  oauth2Client.setCredentials({ refresh_token: credentials.refreshToken });
  const auth = oauth2Client;
  const calendar = google.calendar({ version: 'v3', auth });

  const res = await pool.query(`
    SELECT da.id, da.trainee_name, da.trainee_email, da.course_title, 
           da.calendar_added,
           COALESCE(cr.id::text, da.course_run_id) as internal_run_id
    FROM da_application da
    LEFT JOIN course_run cr ON da.course_run_id = cr.course_run_id
    WHERE da.calendar_added = true
      AND da.updated_at >= NOW() - INTERVAL '7 days'
      AND da.enrolment_status = 'Confirmed'
  `);

  console.log(`Checking ${res.rows.length} recently added applications marked as calendar_added=true...`);

  const falsePositives = [];

  for (const row of res.rows) {
    const sessionRes = await pool.query(
      `SELECT start_date FROM course_session WHERE course_run_id = $1 ORDER BY start_date ASC`,
      [row.internal_run_id]
    );
    
    let datesToSync = [];
    if (sessionRes.rows.length > 0) {
      datesToSync = sessionRes.rows.map(r => new Date(r.start_date).toISOString().slice(0, 10));
    } 
    
    if (datesToSync.length === 0) {
        console.log(`⚠️ Skipping ${row.trainee_name} - no valid sessions found for run ID: ${row.internal_run_id}`);
        falsePositives.push(row);
        continue;
    }
    
    const sortedDates = [...new Set(datesToSync)].sort();
    
    const minD = new Date(sortedDates[0] + 'T00:00:00Z');
    minD.setDate(minD.getDate() - 3); 
    const maxD = new Date(sortedDates[sortedDates.length - 1] + 'T23:59:59Z');
    maxD.setDate(maxD.getDate() + 3);

    const eventsResponse = await calendar.events.list({
      calendarId, timeMin: minD.toISOString(), timeMax: maxD.toISOString(), singleEvents: true, maxResults: 1000,
    });
    const allEvents = eventsResponse.data.items || [];
    
    const learnerEmailLower = (row.trainee_email || '').trim().toLowerCase();
    const strippedCourseTitle = stripPrefixes(row.course_title || '').toLowerCase();

    let foundInAnyEvent = false;

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
        const strictDayMatches = dateAndTitleMatches.filter(evt => expectedDayRegex.test((evt.summary || '').toLowerCase()));
        
        const matchedEvents = strictDayMatches.length > 0 ? strictDayMatches : dateAndTitleMatches;
        
        for (const evt of matchedEvents) {
            const attendees = evt.attendees || [];
            if (attendees.some(a => (a.email || '').toLowerCase() === learnerEmailLower)) {
                foundInAnyEvent = true;
                break;
            }
        }
    }

    if (!foundInAnyEvent) {
        console.log(`❌ FALSE POSITIVE: ${row.trainee_name} (${row.trainee_email}) for ${row.course_title}`);
        falsePositives.push(row);
    }
  }

  console.log(`\n=== Report ===`);
  console.log(`Total Checked: ${res.rows.length}`);
  console.log(`False Positives Found: ${falsePositives.length}`);
  
  if (falsePositives.length > 0) {
      console.log('\\nYou can run this query to reset them:');
      const ids = falsePositives.map(fp => `'${fp.id}'`).join(', ');
      console.log(`UPDATE da_application SET calendar_added = false WHERE id IN (${ids});`);
  }

  process.exit(0);
}

run().catch(console.error);
