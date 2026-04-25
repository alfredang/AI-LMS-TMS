import { google } from 'googleapis';
import { Pool } from 'pg';
import * as dotenv from 'dotenv';
import { getGoogleCredentials } from '../lib/google-auth/googleAuth';

dotenv.config({ path: '.env.local' });

async function run() {
  const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false }
  });
  const credentials = await getGoogleCredentials(pool);
  const oauth2Client = new google.auth.OAuth2(credentials.clientId, credentials.clientSecret);
  oauth2Client.setCredentials({ refresh_token: credentials.refreshToken });
  const calendar = google.calendar({ version: 'v3', auth: oauth2Client });

  const tpRes = await pool.query('SELECT google_calendar_url FROM training_provider LIMIT 1');
  let calendarId = 'primary';
  const calUrl = tpRes.rows[0]?.google_calendar_url || '';
  if (calUrl.includes('@')) calendarId = calUrl;
  
  const res = await calendar.events.list({
    calendarId,
    q: '1131713',
    timeMin: '2026-04-20T00:00:00Z',
    singleEvents: true
  });
  
  console.log(JSON.stringify(res.data.items?.map(i => ({ summary: i.summary, start: i.start, end: i.end })), null, 2));
  await pool.end();
}

run();
