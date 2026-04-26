require('dotenv').config({ path: require('path').join(__dirname, '..', '.env.local') });
const { google } = require('googleapis');
const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_URL?.includes('supabase') ? { rejectUnauthorized: false } : false,
});

async function check() {
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

  const targetDate = '2026-04-23';
  const sTime = '09:00';
  const eTime = '18:00';
  const startDateTime = `${targetDate}T${sTime.padStart(5, '0')}:00`;
  const endDateTime = `${targetDate}T${eTime.padStart(5, '0')}:00`;

  try {
    const newEvent = await calendar.events.insert({
      calendarId,
      requestBody: {
        summary: 'Test Auto-Create Event',
        description: 'Testing',
        start: { dateTime: startDateTime, timeZone: 'Asia/Singapore' },
        end: { dateTime: endDateTime, timeZone: 'Asia/Singapore' },
        attendees: [
          { email: 'test@example.com', responseStatus: 'needsAction' }
        ]
      },
      sendUpdates: 'none'
    });
    console.log('Created event:', newEvent.data.id);
  } catch (err) {
    console.error('Error creating event:', err.message);
  }

  await pool.end();
}

check().catch(err => { console.error(err); process.exit(1); });
