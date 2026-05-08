/**
 * Wide search: look for any calendar event with "Robot" or "ROS" in the title
 * within May 2026 to see if it exists under a different date/title.
 */
require('dotenv').config({ path: '.env.local' });
const { google } = require('googleapis');
const pool = new (require('pg').Pool)({ connectionString: process.env.DATABASE_URL });

async function main() {
  const tp = await pool.query(`
    SELECT google_calendar_url, google_client_id, google_client_secret, google_refresh_token
    FROM training_provider LIMIT 1
  `);
  const tpRow = tp.rows[0];

  let calendarId = 'primary';
  const calUrl = tpRow.google_calendar_url || '';
  if (calUrl) {
    const cidMatch = calUrl.match(/[?&]cid=([^&]+)/);
    if (cidMatch) {
      try { calendarId = Buffer.from(cidMatch[1], 'base64').toString('utf-8'); }
      catch { calendarId = cidMatch[1]; }
    } else if (calUrl.includes('@')) { calendarId = calUrl; }
  }

  const oauth2 = new google.auth.OAuth2(
    tpRow.google_client_id, tpRow.google_client_secret,
    'https://developers.google.com/oauthplayground'
  );
  oauth2.setCredentials({ refresh_token: tpRow.google_refresh_token });
  const calendar = google.calendar({ version: 'v3', auth: oauth2 });

  // Search entire May 2026
  const res = await calendar.events.list({
    calendarId,
    timeMin: '2026-05-01T00:00:00+08:00',
    timeMax: '2026-05-31T23:59:59+08:00',
    singleEvents: true,
    maxResults: 2500,
    q: 'Robot',
  });

  const events = res.data.items || [];
  console.log(`\n🔍 Calendar events containing "Robot" in May 2026: ${events.length}\n`);
  for (const evt of events) {
    const date = evt.start?.dateTime?.slice(0, 10) || evt.start?.date || '';
    const attendees = evt.attendees || [];
    const hasTan = attendees.some(a => (a.email || '').toLowerCase().includes('tanwoeiming'));
    console.log(`  ${hasTan ? '✅' : '  '} "${evt.summary}" | ${date} | ${attendees.length} attendees`);
  }

  if (events.length === 0) {
    console.log('  (none found)');
    // Try without search query to see what's on May 9
    const res2 = await calendar.events.list({
      calendarId,
      timeMin: '2026-05-08T00:00:00+08:00',
      timeMax: '2026-05-11T00:00:00+08:00',
      singleEvents: true,
      maxResults: 50,
    });
    console.log(`\n📅 All events on May 8-10:\n`);
    for (const evt of (res2.data.items || [])) {
      const date = evt.start?.dateTime?.slice(0, 10) || evt.start?.date || '';
      console.log(`  "${evt.summary}" | ${date}`);
    }
  }

  await pool.end();
}

main().catch(err => { console.error(err); process.exit(1); });
