/**
 * Diagnose why a trainer who accepted was not added to the calendar.
 * Usage: node scratch/diagnose-calendar-add.js
 */
require('dotenv').config({ path: '.env.local' });
const { google } = require('googleapis');
const pool = new (require('pg').Pool)({ connectionString: process.env.DATABASE_URL });

const COURSE_RUN_ID = '1078943';
const TRAINER_NAME = 'Tan Woei Ming';

async function main() {
  console.log(`\n🔍 Diagnosing calendar add for course run ${COURSE_RUN_ID} / "${TRAINER_NAME}"\n`);

  // 1. Check trainer_invitation
  const inv = await pool.query(`
    SELECT ti.*, cr.course_run_id AS external_cr_id, c.title AS course_title,
           cr.start_date, cr.end_date
    FROM trainer_invitation ti
    JOIN course_run cr ON cr.id = ti.course_run_id
    JOIN course c ON c.id = cr.course_id
    WHERE cr.course_run_id = $1 AND ti.trainer_name ILIKE $2
    ORDER BY ti.created_at DESC
  `, [COURSE_RUN_ID, `%${TRAINER_NAME}%`]);

  if (inv.rows.length === 0) {
    console.log('❌ No trainer_invitation found for this trainer + course run');
    await pool.end();
    return;
  }

  const invitation = inv.rows[0];
  console.log('📋 Invitation record:');
  console.log(`   Status: ${invitation.status}`);
  console.log(`   Trainer: "${invitation.trainer_name}" (${invitation.trainer_email})`);
  console.log(`   Course: "${invitation.course_title}"`);
  console.log(`   Start date: ${invitation.start_date}`);
  console.log(`   End date: ${invitation.end_date}`);
  console.log(`   Created: ${invitation.created_at}`);
  console.log(`   Responded: ${invitation.responded_at}`);
  console.log('');

  // 2. Check training provider calendar settings
  const tp = await pool.query(`
    SELECT sync_google_calendar, google_calendar_url,
           google_client_id, google_client_secret, google_refresh_token
    FROM training_provider LIMIT 1
  `);
  const tpRow = tp.rows[0];
  console.log('🏢 Training Provider Calendar Settings:');
  console.log(`   sync_google_calendar: ${tpRow?.sync_google_calendar}`);
  console.log(`   google_calendar_url: ${tpRow?.google_calendar_url || '(not set)'}`);
  console.log(`   OAuth configured: ${!!(tpRow?.google_client_id && tpRow?.google_client_secret && tpRow?.google_refresh_token)}`);
  console.log('');

  if (!tpRow?.sync_google_calendar) {
    console.log('❌ REASON: sync_google_calendar is OFF — calendar add would have been skipped');
    await pool.end();
    return;
  }

  if (!tpRow?.google_client_id || !tpRow?.google_client_secret || !tpRow?.google_refresh_token) {
    console.log('❌ REASON: Google OAuth not configured');
    await pool.end();
    return;
  }

  // 3. Try to find the calendar event
  let calendarId = 'primary';
  const calUrl = tpRow.google_calendar_url || '';
  if (calUrl) {
    const cidMatch = calUrl.match(/[?&]cid=([^&]+)/);
    if (cidMatch) {
      try { calendarId = Buffer.from(cidMatch[1], 'base64').toString('utf-8'); }
      catch { calendarId = cidMatch[1]; }
    } else if (calUrl.includes('@')) { calendarId = calUrl; }
  }
  console.log(`📅 Calendar ID: ${calendarId}`);

  const oauth2 = new google.auth.OAuth2(
    tpRow.google_client_id,
    tpRow.google_client_secret,
    'https://developers.google.com/oauthplayground'
  );
  oauth2.setCredentials({ refresh_token: tpRow.google_refresh_token });
  const calendar = google.calendar({ version: 'v3', auth: oauth2 });

  const startDateIso = invitation.start_date
    ? String(invitation.start_date).slice(0, 10)
    : '';
  console.log(`   Searching around: ${startDateIso}\n`);

  const dayBefore = new Date(startDateIso);
  dayBefore.setDate(dayBefore.getDate() - 1);
  const dayAfter = new Date(startDateIso);
  dayAfter.setDate(dayAfter.getDate() + 2);

  const eventsRes = await calendar.events.list({
    calendarId,
    timeMin: dayBefore.toISOString(),
    timeMax: dayAfter.toISOString(),
    singleEvents: true,
    maxResults: 200,
  });
  const allEvents = eventsRes.data.items || [];

  console.log(`📋 Found ${allEvents.length} calendar events in the window:\n`);

  // Strip prefixes helper
  const stripPrefixes = (t) =>
    (t || '').replace(/^\s*\[?(WSQ|VIRTUAL|EXTERNAL|HYBRID)\]?\s*/gi, '')
             .replace(/^\s*\[?(WSQ|VIRTUAL|EXTERNAL|HYBRID)\]?\s*/gi, '').trim();

  const courseTitle = invitation.course_title || '';
  const strippedCourseTitle = stripPrefixes(courseTitle).toLowerCase();
  const courseTitleWords = new Set(strippedCourseTitle.split(/\s+/).filter(w => w.length > 2));

  for (const evt of allEvents) {
    const evtDate = (evt.start?.dateTime?.slice(0, 10) || evt.start?.date || '');
    const evtSummary = evt.summary || '';
    const strippedSummary = stripPrefixes(evtSummary).toLowerCase();

    // Check all 3 strategies
    const s1_desc = ((evt.description || '') + ' ' + (evt.location || '')).toLowerCase().includes(COURSE_RUN_ID.toLowerCase());
    const s2_title = strippedSummary.includes(strippedCourseTitle) || strippedCourseTitle.includes(strippedSummary);
    const s2_match = s2_title && evtDate === startDateIso;

    const evtWords = strippedSummary.split(/\s+/).filter(w => w.length > 2);
    const overlap = evtWords.filter(w => courseTitleWords.has(w));
    const s3_match = overlap.length >= Math.ceil(courseTitleWords.size * 0.6) && evtDate === startDateIso;

    const isMatch = s1_desc || s2_match || s3_match;

    // Check if trainer is already attendee
    const attendees = evt.attendees || [];
    const trainerPresent = attendees.some(a => 
      (a.email || '').toLowerCase() === (invitation.trainer_email || '').toLowerCase()
    );

    const marker = isMatch ? (trainerPresent ? '✅ MATCH+PRESENT' : '⚠️  MATCH') : '  ';
    console.log(`   ${marker} "${evtSummary}" | ${evtDate}`);
    if (isMatch) {
      console.log(`      Stripped DB title: "${strippedCourseTitle}"`);
      console.log(`      Stripped evt title: "${strippedSummary}"`);
      console.log(`      S1 (runId in desc): ${s1_desc}`);
      console.log(`      S2 (title+date):    ${s2_match} (title=${s2_title}, date=${evtDate === startDateIso})`);
      console.log(`      S3 (word overlap):  ${s3_match} (${overlap.length}/${courseTitleWords.size} words)`);
      console.log(`      Attendees: ${attendees.length} | Trainer present: ${trainerPresent}`);
      if (!trainerPresent) {
        console.log(`      → Trainer "${invitation.trainer_email}" is NOT an attendee`);
      }
    }
  }

  // If no match found, show what the titles look like
  if (!allEvents.some(evt => {
    const s = stripPrefixes(evt.summary || '').toLowerCase();
    return s.includes(strippedCourseTitle) || strippedCourseTitle.includes(s);
  })) {
    console.log('\n❌ REASON: No calendar event matched the course title.');
    console.log(`   DB course title:     "${courseTitle}"`);
    console.log(`   Stripped:            "${strippedCourseTitle}"`);
    console.log('\n   Closest event titles:');
    for (const evt of allEvents.slice(0, 10)) {
      const evtDate = (evt.start?.dateTime?.slice(0, 10) || evt.start?.date || '');
      console.log(`     "${evt.summary}" (${evtDate})`);
    }
  }

  await pool.end();
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
