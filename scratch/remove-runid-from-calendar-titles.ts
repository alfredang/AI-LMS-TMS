/**
 * One-time script: Remove course_run_id from existing calendar event titles.
 * 
 * Scans all future Google Calendar events and removes the trailing course run ID
 * from titles that follow the pattern: "Day X - WSQ - Course Title - RUNID"
 * 
 * The run ID is identified as the last segment after " - " that matches a
 * course_run_id in the database.
 * 
 * Usage: npx ts-node scratch/remove-runid-from-calendar-titles.ts
 */

import { google } from 'googleapis';
import pool from '../lib/db';
import { getGoogleCredentials } from '../lib/google-auth/googleAuth';

async function main() {
  try {
    // 1. Load calendar config
    const tpRes = await pool.query(
      `SELECT sync_google_calendar, google_calendar_url FROM training_provider LIMIT 1`
    );
    if (!tpRes.rows[0]?.sync_google_calendar) {
      console.log('❌ Google Calendar sync is not enabled. Exiting.');
      process.exit(0);
    }

    // 2. Get all known course_run_ids from the database
    const runIdRes = await pool.query(`SELECT DISTINCT course_run_id FROM course_run WHERE course_run_id IS NOT NULL`);
    const knownRunIds = new Set(runIdRes.rows.map(r => r.course_run_id));
    
    // Also get from da_application
    const daRunIdRes = await pool.query(`SELECT DISTINCT course_run_id FROM da_application WHERE course_run_id IS NOT NULL`);
    daRunIdRes.rows.forEach(r => knownRunIds.add(r.course_run_id));
    
    console.log(`📋 Found ${knownRunIds.size} known course run IDs in the database.`);

    // 3. Connect to Google Calendar
    const credentials = await getGoogleCredentials(pool);
    const oauth2Client = new google.auth.OAuth2(
      credentials.clientId,
      credentials.clientSecret,
      'https://developers.google.com/oauthplayground'
    );
    oauth2Client.setCredentials({ refresh_token: credentials.refreshToken });
    const calendar = google.calendar({ version: 'v3', auth: oauth2Client });

    let calendarId = 'primary';
    const calUrl = tpRes.rows[0].google_calendar_url || '';
    if (calUrl) {
      const cidMatch = calUrl.match(/[?&]cid=([^&]+)/);
      if (cidMatch) {
        try {
          calendarId = Buffer.from(cidMatch[1], 'base64').toString('utf-8');
        } catch {
          calendarId = cidMatch[1];
        }
      } else if (calUrl.includes('@')) {
        calendarId = calUrl;
      }
    }

    // 4. Fetch all future events (next 6 months)
    const now = new Date();
    const sixMonthsLater = new Date();
    sixMonthsLater.setMonth(sixMonthsLater.getMonth() + 6);

    let allEvents: any[] = [];
    let pageToken: string | undefined;

    do {
      const response: any = await calendar.events.list({
        calendarId,
        timeMin: new Date('2020-01-01').toISOString(), // Include past events too
        timeMax: sixMonthsLater.toISOString(),
        singleEvents: true,
        maxResults: 2500,
        pageToken,
      });
      allEvents.push(...(response.data.items || []));
      pageToken = response.data.nextPageToken;
    } while (pageToken);

    console.log(`📅 Fetched ${allEvents.length} calendar events.`);

    // 5. Find events with course run IDs in the title
    let updatedCount = 0;
    let skippedCount = 0;

    for (const evt of allEvents) {
      if (!evt.summary || !evt.id) continue;

      const summary = evt.summary as string;
      
      // Split by " - " and check if the last segment is a known course run ID
      const parts = summary.split(' - ');
      if (parts.length < 3) continue; // Need at least "WSQ - Title - RunID"

      const lastPart = parts[parts.length - 1].trim();
      
      if (knownRunIds.has(lastPart)) {
        // Remove the last segment (the run ID)
        const newTitle = parts.slice(0, -1).join(' - ');
        
        console.log(`  🔄 "${summary}" → "${newTitle}"`);

        try {
          await calendar.events.patch({
            calendarId,
            eventId: evt.id,
            requestBody: {
              summary: newTitle,
            },
            sendUpdates: 'none',
          });
          updatedCount++;
          
          // Rate limiting - small delay between API calls
          await new Promise(resolve => setTimeout(resolve, 200));
        } catch (err) {
          console.error(`  ❌ Failed to update "${summary}":`, err);
        }
      } else {
        skippedCount++;
      }
    }

    console.log(`\n✅ Done! Updated ${updatedCount} events. Skipped ${skippedCount} events (no run ID in title).`);
  } catch (err) {
    console.error('❌ Fatal error:', err);
  } finally {
    await pool.end();
  }
}

main();
