/**
 * Retroactive Sync: Add trainers to calendar for invitations that were
 * already accepted but failed to add the trainer (due to the date bug).
 *
 * Usage:
 *   node scratch/retro-sync-trainer-calendar.js            # dry run
 *   DRY_RUN=false node scratch/retro-sync-trainer-calendar.js  # apply
 */
require('dotenv').config({ path: '.env.local' });
const { google } = require('googleapis');
const pool = new (require('pg').Pool)({ connectionString: process.env.DATABASE_URL });

const DRY_RUN = process.env.DRY_RUN !== 'false';

// Helper to strip prefixes for matching
const stripPrefixes = (t) =>
  (t || '').replace(/^\s*\[?(WSQ|VIRTUAL|EXTERNAL|HYBRID)\]?\s*/gi, '')
           .replace(/^\s*\[?(WSQ|VIRTUAL|EXTERNAL|HYBRID)\]?\s*/gi, '').trim();

// Helper for SGT date conversion
const toSgtDate = (v) => {
  if (!v) return '';
  const d = v instanceof Date ? v : new Date(v);
  if (isNaN(d.getTime())) return '';
  return new Date(d.getTime() + 8 * 3600 * 1000).toISOString().slice(0, 10);
};

async function main() {
  console.log(`\n📅 Retro-Sync Trainer Calendar (${DRY_RUN ? 'DRY RUN' : '⚠️  LIVE MODE'})\n`);

  // 1. Get training provider settings
  const tp = await pool.query(`
    SELECT sync_google_calendar, google_calendar_url,
           google_client_id, google_client_secret, google_refresh_token
    FROM training_provider LIMIT 1
  `);
  const tpRow = tp.rows[0];

  if (!tpRow?.sync_google_calendar) {
    console.log('❌ sync_google_calendar is OFF. Aborting.');
    await pool.end();
    return;
  }

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

  // 2. Find accepted invitations for upcoming or recent classes
  // We'll check invitations accepted in the last 60 days for classes starting from 7 days ago onwards
  const accepted = await pool.query(`
    SELECT ti.id, ti.trainer_name, ti.trainer_email, cr.course_run_id as external_cr_id,
           c.title as course_title, cr.start_date, cr.end_date
    FROM trainer_invitation ti
    JOIN course_run cr ON cr.id = ti.course_run_id
    JOIN course c ON c.id = cr.course_id
    WHERE ti.status = 'accepted'
      AND cr.start_date >= (CURRENT_DATE - INTERVAL '7 days')
    ORDER BY cr.start_date ASC
  `);

  console.log(`Found ${accepted.rows.length} accepted invitation(s) to check.\n`);

  let added = 0;
  let skipped = 0;

  for (const inv of accepted.rows) {
    const startDateIso = toSgtDate(inv.start_date);
    if (!startDateIso) continue;

    console.log(`🔍 Checking "${inv.trainer_name}" for "${inv.course_title}" (${startDateIso})...`);

    // Search window
    const dayBefore = new Date(startDateIso);
    dayBefore.setDate(dayBefore.getDate() - 1);
    const dayAfter = new Date(startDateIso);
    if (inv.end_date) {
        const endIso = toSgtDate(inv.end_date);
        if (endIso) {
            const endD = new Date(endIso);
            dayAfter.setTime(Math.max(dayAfter.getTime(), endD.getTime()));
        }
    }
    dayAfter.setDate(dayAfter.getDate() + 2);

    let matchedEvent = null;
    try {
        const eventsRes = await calendar.events.list({
            calendarId,
            timeMin: dayBefore.toISOString(),
            timeMax: dayAfter.toISOString(),
            singleEvents: true,
            maxResults: 200,
        });
        const allEvents = eventsRes.data.items || [];
        const strippedTitle = stripPrefixes(inv.course_title).toLowerCase();
        const titleWords = new Set(strippedTitle.split(/\s+/).filter(w => w.length > 2));

        // Strategy 1: Match by courseRunId in description
        matchedEvent = allEvents.find(evt => {
            const desc = ((evt.description || '') + ' ' + (evt.location || '')).toLowerCase();
            return desc.includes(inv.external_cr_id.toLowerCase());
        });

        // Strategy 2: Exact title substring match + date
        if (!matchedEvent) {
            matchedEvent = allEvents.find(evt => {
                const s = stripPrefixes(evt.summary || '').toLowerCase();
                const titleMatch = s.includes(strippedTitle) || strippedTitle.includes(s);
                const d = (evt.start?.dateTime?.slice(0, 10) || evt.start?.date || '');
                return titleMatch && d === startDateIso;
            });
        }

        // Strategy 3: Word-overlap
        if (!matchedEvent && titleWords.size > 0) {
            matchedEvent = allEvents.find(evt => {
                const s = stripPrefixes(evt.summary || '').toLowerCase();
                const evtWords = s.split(/\s+/).filter(w => w.length > 2);
                const overlap = evtWords.filter(w => titleWords.has(w));
                const d = (evt.start?.dateTime?.slice(0, 10) || evt.start?.date || '');
                return overlap.length >= Math.ceil(titleWords.size * 0.6) && d === startDateIso;
            });
        }

        if (!matchedEvent) {
            console.log(`   ❌ No calendar event found.`);
            skipped++;
            continue;
        }

        const emailLower = inv.trainer_email.toLowerCase().trim();
        const attendees = matchedEvent.attendees || [];
        const alreadyPresent = attendees.some(a => (a.email || '').toLowerCase() === emailLower);

        if (alreadyPresent) {
            console.log(`   ✅ Already in calendar.`);
            if (!DRY_RUN) {
                await pool.query(
                    `UPDATE course_run SET trainer_in_calendar = true, updated_at = NOW() WHERE id = $1`,
                    [inv.course_run_id]
                );
            }
            skipped++;
            continue;
        }

        // Need to add
        console.log(`   ✨ Found match: "${matchedEvent.summary}" — adding ${inv.trainer_email}...`);
        
        if (!DRY_RUN) {
            // Check for recurring events
            const baseId = matchedEvent.id.includes('_') ? matchedEvent.id.split('_')[0] : null;
            let eventsToUpdate = [];
            if (baseId) {
                const recurringRes = await calendar.events.list({
                    calendarId,
                    timeMin: dayBefore.toISOString(),
                    timeMax: new Date(dayBefore.getTime() + 60 * 24 * 3600 * 1000).toISOString(),
                    singleEvents: true,
                    maxResults: 2500,
                });
                eventsToUpdate = (recurringRes.data.items || [])
                    .filter(evt => evt.id && evt.id.startsWith(baseId + '_'))
                    .map(evt => ({ id: evt.id, attendees: evt.attendees || [] }));
            }
            if (eventsToUpdate.length === 0) {
                eventsToUpdate = [{ id: matchedEvent.id, attendees: matchedEvent.attendees || [] }];
            }

            for (const evt of eventsToUpdate) {
                if (evt.attendees.some(a => (a.email || '').toLowerCase() === emailLower)) continue;
                await calendar.events.patch({
                    calendarId,
                    eventId: evt.id,
                    requestBody: {
                        attendees: [...evt.attendees, { email: inv.trainer_email, responseStatus: 'needsAction' }],
                    },
                    sendUpdates: 'none',
                });
            }
            await pool.query(
                `UPDATE course_run SET trainer_in_calendar = true, updated_at = NOW() WHERE id = $1`,
                [inv.course_run_id]
            );
            console.log(`   ✅ Successfully added to ${eventsToUpdate.length} event(s) and marked trainer_in_calendar=true.`);
        } else {
            console.log(`   → WOULD ADD (Dry Run)`);
        }
        added++;

    } catch (e) {
        console.error(`   ❌ Error checking/adding: ${e.message}`);
        skipped++;
    }
  }

  console.log(`\nSummary: ${added} added, ${skipped} skipped/already present.`);
  await pool.end();
}

main().catch(err => { console.error(err); process.exit(1); });
