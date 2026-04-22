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

  const eventsResponse = await calendar.events.list({
      calendarId,
      timeMin: new Date('2026-05-24T00:00:00Z').toISOString(),
      timeMax: new Date('2026-05-26T23:59:59Z').toISOString(),
      singleEvents: true,
      q: 'Lean Six Sigma'
  });
  
  console.log('Events found:', eventsResponse.data.items.length);
  eventsResponse.data.items.forEach(e => {
    console.log(`- ID: ${e.id}\n  Title: "${e.summary}"\n  Start: ${e.start.dateTime || e.start.date}\n  Description: ${e.description}\n  Attendees:`, e.attendees?.map(a => a.email));
  });

  await pool.end();
}

check().catch(err => { console.error(err); process.exit(1); });
