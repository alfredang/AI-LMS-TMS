import { google } from 'googleapis';
import pool from '../lib/db';
import { getGoogleCredentials } from '../lib/google-auth/googleAuth';

async function main() {
  const credentials = await getGoogleCredentials(pool);
  const oauth2Client = new google.auth.OAuth2(credentials.clientId, credentials.clientSecret, 'https://developers.google.com/oauthplayground');
  oauth2Client.setCredentials({ refresh_token: credentials.refreshToken });
  const calendar = google.calendar({ version: 'v3', auth: oauth2Client });

  const tpRes = await pool.query(`SELECT google_calendar_url FROM training_provider LIMIT 1`);
  const calUrl = tpRes.rows[0]?.google_calendar_url || '';
  let calendarId = 'primary';
  if (calUrl) {
    const cidMatch = calUrl.match(/[?&]cid=([^&]+)/);
    if (cidMatch) {
      try { calendarId = Buffer.from(cidMatch[1], 'base64').toString('utf-8'); } catch { calendarId = cidMatch[1]; }
    } else if (calUrl.includes('@')) { calendarId = calUrl; }
  }

  const response = await calendar.events.list({
    calendarId,
    timeMin: '2026-05-06T00:00:00Z',
    timeMax: '2026-05-09T00:00:00Z',
    singleEvents: true,
    maxResults: 50,
    q: 'Social Media Campaigns'
  });

  for (const evt of (response.data.items || [])) {
    console.log(`Title: ${evt.summary}`);
    console.log(`Created: ${evt.created}`);
    console.log(`Updated: ${evt.updated}`);
    console.log(`Start: ${evt.start?.dateTime || evt.start?.date}`);
    console.log(`Attendees: ${(evt.attendees || []).map(a => a.email).join(', ')}`);
    console.log('---');
  }

  await pool.end();
}
main().catch(e => { console.error(e); process.exit(1); });
