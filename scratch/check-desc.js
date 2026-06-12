require('dotenv').config({ path: '.env.local' });
const { google } = require('googleapis');
const pool = new (require('pg').Pool)({ connectionString: process.env.DATABASE_URL });
async function main() {
  const tp = await pool.query('SELECT google_calendar_url, google_client_id, google_client_secret, google_refresh_token FROM training_provider LIMIT 1');
  const tpRow = tp.rows[0];
  const oauth2 = new google.auth.OAuth2(tpRow.google_client_id, tpRow.google_client_secret);
  oauth2.setCredentials({ refresh_token: tpRow.google_refresh_token });
  const calendar = google.calendar({ version: 'v3', auth: oauth2 });
  const res = await calendar.events.get({ calendarId: 'primary', eventId: 'g8k1ukn2e1oi7kmn6kg9au3q04_20260523T013000Z' });
  console.log("Desc:", res.data.description);
  console.log("Location:", res.data.location);
  await pool.end();
}
main();
