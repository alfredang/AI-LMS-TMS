const { google } = require('googleapis');
const { Pool } = require('pg');
require('dotenv').config({ path: '.env.local' });
const pool = new Pool({ connectionString: process.env.DATABASE_URL });

async function run() {
  try {
    const tpRes = await pool.query("SELECT google_refresh_token FROM training_provider LIMIT 1");
    if (!tpRes.rows[0]?.google_refresh_token) { console.log('No token'); return; }
    
    // We need clientId/clientSecret but since we don't have them easily accessible here, I will just parse the googleAuth file
    const { getGoogleCredentials } = require('./lib/google-auth/googleAuth');
    const creds = await getGoogleCredentials(pool);
    
    const oauth2Client = new google.auth.OAuth2(creds.clientId, creds.clientSecret);
    oauth2Client.setCredentials({ refresh_token: creds.refreshToken });
    const calendar = google.calendar({ version: 'v3', auth: oauth2Client });
    
    const res = await calendar.events.insert({
      calendarId: 'primary',
      requestBody: {
        summary: "WSQ Test Recurring",
        start: { dateTime: '2026-05-15T09:30:00+08:00', timeZone: 'Asia/Singapore' },
        end: { dateTime: '2026-05-15T18:30:00+08:00', timeZone: 'Asia/Singapore' },
        recurrence: [
          'RDATE;TZID=Asia/Singapore:20260520T093000,20260525T093000'
        ]
      }
    });
    console.log('Created:', res.data.id);
    
    // Fetch instances
    const inst = await calendar.events.instances({
      calendarId: 'primary',
      eventId: res.data.id
    });
    console.log('Instances:', inst.data.items.length);
    for (const item of inst.data.items) {
      console.log(' - ', item.id, item.start.dateTime);
    }
    
    // Delete test event
    await calendar.events.delete({ calendarId: 'primary', eventId: res.data.id });
    console.log('Deleted test event');
  } catch (e) {
    console.error(e);
  } finally {
    pool.end();
  }
}
run();
