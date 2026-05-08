/**
 * Check: Did the calendar event exist when the trainer accepted?
 * Compare acceptance date vs calendar event creation date.
 */
require('dotenv').config({ path: '.env.local' });
const { google } = require('googleapis');
const pool = new (require('pg').Pool)({ connectionString: process.env.DATABASE_URL });

async function main() {
  // 1. Get all accepted invitations and check their calendar event
  const accepted = await pool.query(`
    SELECT ti.trainer_name, ti.trainer_email, ti.responded_at, ti.created_at AS invited_at,
           cr.course_run_id AS external_cr_id, c.title AS course_title,
           cr.start_date, cr.end_date
    FROM trainer_invitation ti
    JOIN course_run cr ON cr.id = ti.course_run_id
    JOIN course c ON c.id = cr.course_id
    WHERE ti.status = 'accepted'
    ORDER BY ti.responded_at DESC
    LIMIT 30
  `);

  console.log(`\n📋 Last 30 accepted invitations:\n`);

  // Setup calendar
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

  const stripPrefixes = (t) =>
    (t || '').replace(/^\s*\[?(WSQ|VIRTUAL|EXTERNAL|HYBRID)\]?\s*/gi, '')
             .replace(/^\s*\[?(WSQ|VIRTUAL|EXTERNAL|HYBRID)\]?\s*/gi, '').trim();

  for (const row of accepted.rows) {
    const startDate = row.start_date instanceof Date
      ? row.start_date.toISOString().slice(0, 10)
      : String(row.start_date || '').slice(0, 10);
    
    // Check if ISO or locale
    const isIso = /^\d{4}-\d{2}-\d{2}/.test(startDate);
    const actualStart = isIso ? startDate : (row.start_date ? new Date(row.start_date).toISOString().slice(0, 10) : '??');

    const dayBefore = new Date(actualStart);
    dayBefore.setDate(dayBefore.getDate() - 1);
    const dayAfter = new Date(actualStart);
    dayAfter.setDate(dayAfter.getDate() + 2);

    let eventFound = '❌ NO EVENT';
    let trainerPresent = false;
    let eventCreated = '';
    try {
      const evts = await calendar.events.list({
        calendarId,
        timeMin: dayBefore.toISOString(),
        timeMax: dayAfter.toISOString(),
        singleEvents: true,
        maxResults: 100,
      });
      const strippedTitle = stripPrefixes(row.course_title || '').toLowerCase();
      const match = (evts.data.items || []).find(evt => {
        const s = stripPrefixes(evt.summary || '').toLowerCase();
        return (s.includes(strippedTitle) || strippedTitle.includes(s)) &&
               (evt.start?.dateTime?.slice(0, 10) || evt.start?.date || '') === actualStart;
      });
      if (match) {
        eventFound = `✅ "${match.summary}"`;
        eventCreated = match.created || '??';
        trainerPresent = (match.attendees || []).some(
          a => (a.email || '').toLowerCase() === (row.trainer_email || '').toLowerCase()
        );
      }
    } catch (e) {
      eventFound = `⚠️ Error: ${e.message}`;
    }

    const respondedAt = row.responded_at ? new Date(row.responded_at).toISOString().slice(0, 10) : '??';
    const eventCreatedDate = eventCreated ? eventCreated.slice(0, 10) : '??';
    const acceptedBeforeEvent = eventCreated && row.responded_at
      ? new Date(row.responded_at) < new Date(eventCreated)
      : null;

    console.log(`${row.external_cr_id} | "${row.trainer_name}" | class: ${actualStart}`);
    console.log(`  Accepted: ${respondedAt} | Event created: ${eventCreatedDate} | ${acceptedBeforeEvent === true ? '⚠️  ACCEPTED BEFORE EVENT CREATED' : acceptedBeforeEvent === false ? '✅ Event existed at accept time' : '?? Unknown'}`);
    console.log(`  Event: ${eventFound}`);
    console.log(`  Trainer in attendees: ${trainerPresent ? '✅ YES' : '❌ NO'}`);
    console.log('');
  }

  await pool.end();
}

main().catch(err => { console.error(err); process.exit(1); });
