
require('dotenv').config({ path: '.env.local' });
const { google } = require('googleapis');
const pool = new (require('pg').Pool)({ connectionString: process.env.DATABASE_URL });

async function findSuccessfulAdds() {
  try {
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

    const accepted = await pool.query(`
      SELECT ti.trainer_name, ti.trainer_email, cr.course_run_id as external_cr_id, 
             c.title as course_title, cr.start_date
      FROM trainer_invitation ti
      JOIN course_run cr ON cr.id = ti.course_run_id
      JOIN course c ON c.id = cr.course_id
      WHERE ti.status = 'accepted'
      ORDER BY ti.responded_at DESC
      LIMIT 100
    `);

    console.log(`Checking ${accepted.rows.length} accepted invitations...`);

    for (const row of accepted.rows) {
        // Try searching for the trainer's email in the calendar directly
        const res = await calendar.events.list({
            calendarId,
            q: row.trainer_email,
            singleEvents: true,
            maxResults: 10
        });

        const items = res.data.items || [];
        const matches = items.filter(evt => {
            const summary = (evt.summary || '').toLowerCase();
            const title = (row.course_title || '').toLowerCase();
            return summary.includes(title.slice(0, 20)); // Fuzzy match title
        });

        if (matches.length > 0) {
            console.log(`✅ FOUND SUCCESS: ${row.trainer_name} is in calendar for "${row.course_title}" (${row.external_cr_id})`);
            console.log(`   Event dates: ${matches.map(m => m.start.date || m.start.dateTime).join(', ')}`);
            console.log(`   Invite start_date: ${row.start_date}`);
        }
    }

  } catch (e) {
    console.error(e);
  } finally {
    await pool.end();
  }
}
findSuccessfulAdds();
