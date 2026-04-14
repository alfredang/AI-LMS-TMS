/* One-off: match today's SSG enrolments (ssg_enrolment_record) against Google Calendar.
 * Run: node scripts/ssg-today-calendar-check.js
 */
require('dotenv').config({ path: '.env.local' });
const { Pool } = require('pg');
const { google } = require('googleapis');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_URL && (process.env.NODE_ENV === 'production' || process.env.DATABASE_URL.includes('supabase'))
    ? { rejectUnauthorized: false } : false,
});

function stripPrefixes(title) {
  return (title || '').replace(/^\s*\[?(WSQ|VIRTUAL|EXTERNAL|HYBRID)\]?\s*/gi, '').replace(/^\s*\[?(WSQ|VIRTUAL|EXTERNAL|HYBRID)\]?\s*/gi, '').trim();
}

function sgtDate(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  return new Date(d.getTime() + 8 * 3600 * 1000).toISOString().slice(0, 10);
}

(async () => {
  try {
    const argDate = process.argv[2];
    const todaySgt = argDate && /^\d{4}-\d{2}-\d{2}$/.test(argDate)
      ? argDate
      : new Date(new Date().getTime() + 8 * 3600 * 1000).toISOString().slice(0, 10);

    const rows = (await pool.query(`
      SELECT enrolment_reference, enrolment_date, learner_name, learner_email,
             course_title, course_ref_code, course_run_id, start_date, status
      FROM ssg_enrolment_record
      WHERE (enrolment_date AT TIME ZONE 'Asia/Singapore')::date = $1::date
        AND status = 'Confirmed'
      ORDER BY enrolment_reference
    `, [todaySgt])).rows;

    console.log(`\n=== SSG enrolments with enrolment_date = ${todaySgt} (SGT): ${rows.length} ===\n`);
    if (rows.length === 0) { process.exit(0); }

    const tpRes = await pool.query(`SELECT sync_google_calendar, google_calendar_url FROM training_provider LIMIT 1`);
    const tp = tpRes.rows[0] || {};
    if (!tp.sync_google_calendar) throw new Error('Google Calendar sync not enabled');

    const credRes = await pool.query(`SELECT google_client_id, google_client_secret, google_refresh_token FROM training_provider LIMIT 1`);
    const cr = credRes.rows[0] || {};
    let calendarId = 'primary';
    const calUrl = tp.google_calendar_url || '';
    const cidMatch = calUrl.match(/[?&]cid=([^&]+)/);
    if (cidMatch) { try { calendarId = Buffer.from(cidMatch[1], 'base64').toString('utf-8'); } catch { calendarId = cidMatch[1]; } }
    else if (calUrl.includes('@')) { calendarId = calUrl; }

    const oauth2 = new google.auth.OAuth2(cr.google_client_id, cr.google_client_secret, 'https://developers.google.com/oauthplayground');
    oauth2.setCredentials({ refresh_token: cr.google_refresh_token });
    const calendar = google.calendar({ version: 'v3', auth: oauth2 });

    const startDates = rows.map(r => sgtDate(r.start_date)).filter(Boolean).sort();
    const minD = new Date(startDates[0]); minD.setDate(minD.getDate() - 1);
    const maxD = new Date(startDates[startDates.length - 1]); maxD.setDate(maxD.getDate() + 2);

    const evts = await calendar.events.list({ calendarId, timeMin: minD.toISOString(), timeMax: maxD.toISOString(), singleEvents: true, maxResults: 2500 });
    const events = evts.data.items || [];
    console.log(`Calendar events scanned: ${events.length} (${minD.toISOString().slice(0,10)} → ${maxD.toISOString().slice(0,10)})\n`);

    const out = rows.map(r => {
      const startIso = sgtDate(r.start_date);
      const enrolIso = sgtDate(r.enrolment_date);
      const stripped = stripPrefixes(r.course_title || '').toLowerCase();
      const emailLower = (r.learner_email || '').trim().toLowerCase();
      let inCal = 'NO';
      let evtTitle = '';
      const evt = events.find(e => {
        const t = stripPrefixes(e.summary || '').toLowerCase();
        if (!(t.includes(stripped) || (stripped && stripped.includes(t)))) return false;
        const ed = e.start?.dateTime?.slice(0, 10) || e.start?.date || '';
        return ed === startIso;
      });
      if (evt) {
        evtTitle = evt.summary || '';
        const attendeeMatch = (evt.attendees || []).some(a => (a.email || '').toLowerCase() === emailLower);
        inCal = attendeeMatch ? 'YES' : 'EVENT only (no attendee)';
      }
      return {
        ref: r.enrolment_reference,
        enrol_date: enrolIso,
        tgs: r.course_ref_code || '',
        title: r.course_title || '',
        run: r.course_run_id,
        start: startIso,
        status: r.status,
        learner: r.learner_name,
        email: r.learner_email || '',
        in_cal: inCal,
        evt: evtTitle,
      };
    });

    console.log('Ref'.padEnd(18), 'EnrolDate'.padEnd(12), 'TGS Code'.padEnd(16), 'Run'.padEnd(9), 'ClassStart'.padEnd(12), 'Status'.padEnd(10), 'InCal'.padEnd(26), 'Learner'.padEnd(32), 'Email'.padEnd(32), 'Course Title');
    out.forEach(r => console.log(
      String(r.ref).padEnd(18),
      String(r.enrol_date).padEnd(12),
      String(r.tgs).padEnd(16),
      String(r.run).padEnd(9),
      String(r.start).padEnd(12),
      String(r.status).padEnd(10),
      String(r.in_cal).padEnd(26),
      String(r.learner).padEnd(32),
      String(r.email).padEnd(32),
      r.title
    ));

    const totals = out.reduce((a, r) => { a[r.in_cal] = (a[r.in_cal] || 0) + 1; return a; }, {});
    console.log('\nTotals:', totals);
  } catch (e) {
    console.error('ERROR:', e.message);
    process.exitCode = 1;
  } finally {
    await pool.end();
  }
})();
