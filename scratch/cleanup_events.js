require('dotenv').config({ path: require('path').join(__dirname, '..', '.env.local') });
const { google } = require('googleapis');
const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_URL?.includes('supabase') ? { rejectUnauthorized: false } : false,
});

async function cleanup() {
  const result = await pool.query(`
        SELECT 
            google_client_id as "clientId",
            google_client_secret as "clientSecret",
            google_refresh_token as "refreshToken",
            google_calendar_url
        FROM training_provider
        LIMIT 1
  `);
  const credentials = result.rows[0];

  const oauth2Client = new google.auth.OAuth2(
    credentials.clientId,
    credentials.clientSecret,
    'https://developers.google.com/oauthplayground'
  );
  oauth2Client.setCredentials({ refresh_token: credentials.refreshToken });
  const calendar = google.calendar({ version: 'v3', auth: oauth2Client });

  let calendarId = 'primary';
  const calUrl = credentials.google_calendar_url || '';
  if (calUrl) {
    const cidMatch = calUrl.match(/[?&]cid=([^&]+)/);
    if (cidMatch) {
      try { calendarId = Buffer.from(cidMatch[1], 'base64').toString('utf-8'); } catch { calendarId = cidMatch[1]; }
    } else if (calUrl.includes('@')) {
      calendarId = calUrl;
    }
  }

  const daRes = await pool.query(`
    SELECT trainee_email, course_title, course_run_id, course_reference_number
    FROM da_application 
    WHERE calendar_added = true 
    ORDER BY updated_at DESC 
    LIMIT 20
  `);

  const courses = Array.from(new Set(daRes.rows.map(r => r.course_title)));
  console.log(`Checking ${courses.length} recent course titles...`);

  for (const title of courses) {
    const daRow = daRes.rows.find(r => r.course_title === title);
    
    // Find events
    const eventsResponse = await calendar.events.list({
        calendarId,
        timeMin: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString(),
        timeMax: new Date(Date.now() + 180 * 24 * 60 * 60 * 1000).toISOString(),
        singleEvents: true,
        q: title.replace(/[^a-zA-Z0-9 ]/g, ' ').trim()
    });
    
    const events = eventsResponse.data.items || [];
    
    // Group by title + date
    const groups = {};
    for (const evt of events) {
      const summary = (evt.summary || '').trim();
      const date = evt.start?.dateTime?.slice(0, 10) || evt.start?.date;
      const key = `${summary}|${date}`;
      if (!groups[key]) groups[key] = [];
      groups[key].push(evt);
    }
    
    for (const [key, evts] of Object.entries(groups)) {
      const [summary, date] = key.split('|');
      
      // Update N/A description if needed
      let primaryEvt = evts[0];
      if (primaryEvt.description && primaryEvt.description.includes('Course Code: N/A')) {
        let newDesc = primaryEvt.description
            .replace('Course Code: N/A', `Course Code: ${daRow.course_reference_number || 'N/A'}`)
            .replace('Course Run ID: N/A', `Course Run ID: ${daRow.course_run_id || 'N/A'}`);
            
        await calendar.events.patch({
            calendarId,
            eventId: primaryEvt.id,
            requestBody: { description: newDesc },
            sendUpdates: 'none'
        });
        console.log(`✅ Fixed N/A description for event: ${summary} on ${date}`);
      }

      // Delete duplicates
      if (evts.length > 1) {
        console.log(`⚠️ Found ${evts.length} duplicated events for: ${summary} on ${date}`);
        
        // Merge attendees into the primary event
        const allAttendees = new Map();
        for (const evt of evts) {
          (evt.attendees || []).forEach(a => allAttendees.set(a.email, a));
        }
        
        await calendar.events.patch({
            calendarId,
            eventId: primaryEvt.id,
            requestBody: { attendees: Array.from(allAttendees.values()) },
            sendUpdates: 'none'
        });
        
        // Delete the rest
        for (let i = 1; i < evts.length; i++) {
           await calendar.events.delete({
             calendarId,
             eventId: evts[i].id,
             sendUpdates: 'none'
           });
           console.log(`🗑️ Deleted duplicate event ID: ${evts[i].id}`);
        }
      }
    }
  }

  await pool.end();
}

cleanup().catch(err => { console.error(err); process.exit(1); });
