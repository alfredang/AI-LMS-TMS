require('dotenv').config({ path: '.env.local' });
const { google } = require('googleapis');
const pool = new (require('pg').Pool)({ connectionString: process.env.DATABASE_URL });

async function main() {
  const tp = await pool.query('SELECT google_calendar_url, google_client_id, google_client_secret, google_refresh_token FROM training_provider LIMIT 1');
  const tpRow = tp.rows[0];
  let calendarId = 'primary';
  if (tpRow.google_calendar_url) {
    const m = tpRow.google_calendar_url.match(/[?&]cid=([^&]+)/);
    if (m) {
        try { calendarId = Buffer.from(m[1], 'base64').toString('utf-8'); } catch(e) { calendarId = m[1]; }
    } else if (tpRow.google_calendar_url.includes('@')) {
        calendarId = tpRow.google_calendar_url;
    }
  }

  const oauth2 = new google.auth.OAuth2(tpRow.google_client_id, tpRow.google_client_secret);
  oauth2.setCredentials({ refresh_token: tpRow.google_refresh_token });
  const calendar = google.calendar({ version: 'v3', auth: oauth2 });

  // Search window for May 22 to May 24
  const res = await calendar.events.list({
    calendarId,
    timeMin: new Date('2026-05-22T00:00:00Z').toISOString(),
    timeMax: new Date('2026-05-25T00:00:00Z').toISOString(),
    singleEvents: true,
  });

  const evt = res.data.items.filter(i => (i.summary || '').toLowerCase().includes('copilot studio'));
  console.log(evt.map(e => ({ id: e.id, summary: e.summary, start: e.start, attendees: (e.attendees || []).map(a => a.email) })));
  await pool.end();
}
main();
