import type { NextApiRequest, NextApiResponse } from 'next';
import { google } from 'googleapis';
import pool from '@lib/db';
import { getGoogleCredentials } from '@lib/google-auth/googleAuth';

/**
 * POST /api/external/sync-google-calendar
 *
 * Reads events from the training provider's Google Calendar (configurable days ahead, default 21).
 * For events with [VIRTUAL] or [HYBRID] in the title:
 *   - Sets class_type to Virtual or Hybrid on the matching course_run
 *   - Extracts and stores the Google Meet link
 *
 * Matching: event summary is matched to course_run by finding the course title
 * within the event summary, or by matching course_run_id in the event description.
 *
 * Runs daily at 1:00 AM SGT via scheduler.
 */

const DEFAULT_LOOK_AHEAD_DAYS = 21;

// Ensure the virtual_meeting_link column exists
async function ensureColumns() {
  await pool.query(`ALTER TABLE course_run ADD COLUMN IF NOT EXISTS virtual_meeting_link TEXT`);
}

// ── Global in-flight lock ─────────────────────────────────────────────────────
const g = globalThis as unknown as { __syncCalendarRunning?: boolean };
if (g.__syncCalendarRunning === undefined) g.__syncCalendarRunning = false;

export async function runSyncGoogleCalendar(options?: { startDate?: string; endDate?: string }) {
  if (g.__syncCalendarRunning) {
    console.warn('[sync-google-calendar] Another run is already in progress — skipping');
    return { success: false, message: 'Skipped — another run is already in progress' };
  }
  g.__syncCalendarRunning = true;
  try {
    return await _runSyncGoogleCalendarInner(options);
  } finally {
    g.__syncCalendarRunning = false;
  }
}

async function _runSyncGoogleCalendarInner(options?: { startDate?: string; endDate?: string }) {
  await ensureColumns();

  // Read configurable look-ahead days from scheduler_config
  let lookAheadDays = DEFAULT_LOOK_AHEAD_DAYS;
  try {
    const configRes = await pool.query(
      `SELECT days_in_advance FROM scheduler_config WHERE id = 'sync_google_calendar' LIMIT 1`
    );
    if (configRes.rows[0]?.days_in_advance != null) {
      lookAheadDays = configRes.rows[0].days_in_advance;
    }
  } catch { /* table or column may not exist yet */ }

  const credentials = await getGoogleCredentials(pool);

  // Get calendar URL from training_provider
  const tpResult = await pool.query(
    `SELECT google_calendar_url, sync_google_calendar FROM training_provider LIMIT 1`
  );
  const tpRow = tpResult.rows[0];
  if (!tpRow?.sync_google_calendar) {
    return { success: true, message: 'Google Calendar sync is disabled.', updated: 0 };
  }

  // Extract calendar ID from the URL or use the stored value
  let calendarId = 'primary';
  const calUrl = tpRow.google_calendar_url || '';
  if (calUrl) {
    // Handle encoded calendar URLs like ?cid=base64encoded
    const cidMatch = calUrl.match(/[?&]cid=([^&]+)/);
    if (cidMatch) {
      try {
        calendarId = Buffer.from(cidMatch[1], 'base64').toString('utf-8');
      } catch {
        calendarId = cidMatch[1];
      }
    } else if (calUrl.includes('@')) {
      // Direct email-style calendar ID
      calendarId = calUrl;
    }
  }

  console.log(`📅 [Calendar Sync] Calendar ID: ${calendarId}`);

  // Set up Google Calendar API
  const oauth2Client = new google.auth.OAuth2(
    credentials.clientId,
    credentials.clientSecret,
    'https://developers.google.com/oauthplayground'
  );
  oauth2Client.setCredentials({ refresh_token: credentials.refreshToken });
  const calendar = google.calendar({ version: 'v3', auth: oauth2Client });

  // Fetch events for the date range
  const now = new Date();
  const startDate = options?.startDate ? new Date(options.startDate) : now;
  const futureDate = options?.endDate ? new Date(options.endDate + 'T23:59:59') : new Date(startDate.getTime() + lookAheadDays * 24 * 60 * 60 * 1000);

  const eventsResponse = await calendar.events.list({
    calendarId,
    timeMin: startDate.toISOString(),
    timeMax: futureDate.toISOString(),
    singleEvents: true,
    orderBy: 'startTime',
    maxResults: 500,
  });

  const events = eventsResponse.data.items || [];
  console.log(`📅 [Calendar Sync] Found ${events.length} events in the next ${lookAheadDays} days`);

  // Get all course runs in the date range for matching
  const courseRuns = await pool.query(
    `SELECT cr.id, cr.course_run_id, cr.start_date, cr.end_date, cr.class_type, cr.virtual_meeting_link,
            c.title AS course_title
     FROM course_run cr
     JOIN course c ON c.id = cr.course_id
     WHERE cr.start_date >= $1::date
       AND cr.start_date <= $2::date`,
    [startDate.toISOString().slice(0, 10), futureDate.toISOString().slice(0, 10)]
  );

  // Build lookup maps
  const courseRunsByTitle = new Map<string, any[]>();
  const courseRunsById = new Map<string, any>();
  for (const cr of courseRuns.rows) {
    courseRunsById.set(cr.course_run_id, cr);
    const titleLower = (cr.course_title || '').toLowerCase().trim();
    if (titleLower) {
      if (!courseRunsByTitle.has(titleLower)) courseRunsByTitle.set(titleLower, []);
      courseRunsByTitle.get(titleLower)!.push(cr);
    }
  }

  let updated = 0;
  let skipped = 0;
  const results: any[] = [];

  for (const event of events) {
    const summary = event.summary || '';
    const description = event.description || '';
    const isVirtual = /\[VIRTUAL\]/i.test(summary);
    const isHybrid = /\[HYBRID\]/i.test(summary);

    if (!isVirtual && !isHybrid) continue;

    // Extract Google Meet link from event
    const meetLink = event.hangoutLink
      || event.conferenceData?.entryPoints?.find(ep => ep.entryPointType === 'video')?.uri
      || '';

    // Also check description for meet links
    const meetFromDesc = !meetLink
      ? (description.match(/https:\/\/meet\.google\.com\/[a-z-]+/i)?.[0] || '')
      : meetLink;

    const finalMeetLink = meetLink || meetFromDesc;

    const classType = isVirtual ? 'Virtual' : 'Hybrid';

    // Remove [VIRTUAL]/[HYBRID] tag to get the course title for matching
    const cleanTitle = summary.replace(/\[(VIRTUAL|HYBRID)\]\s*/i, '').trim().toLowerCase();

    // Try to match to a course run:
    // 1. Check if course_run_id appears in description
    let matched: any = null;
    const runIdMatch = description.match(/\b(\d{6,})\b/);
    if (runIdMatch && courseRunsById.has(runIdMatch[1])) {
      matched = courseRunsById.get(runIdMatch[1]);
    }

    // 2. Match by event start date + course title
    if (!matched) {
      const eventStart = event.start?.dateTime || event.start?.date || '';
      const eventDate = eventStart.slice(0, 10); // YYYY-MM-DD

      // Find course runs whose title is contained in the event summary and start on the same date
      for (const [title, runs] of courseRunsByTitle) {
        if (cleanTitle.includes(title) || title.includes(cleanTitle)) {
          const dateMatch = runs.find(r => {
            const crDate = r.start_date ? new Date(r.start_date).toISOString().slice(0, 10) : '';
            return crDate === eventDate;
          });
          if (dateMatch) { matched = dateMatch; break; }
          // If no date match, try first run with matching title
          if (!matched && runs.length === 1) matched = runs[0];
        }
      }
    }

    if (!matched) {
      skipped++;
      console.log(`  ⏭️ No match for: "${summary}" (${event.start?.dateTime || event.start?.date})`);
      results.push({ event: summary, status: 'no_match' });
      continue;
    }

    // Update the course run
    const changes: string[] = [];
    if (matched.class_type !== classType) changes.push(`class_type → ${classType}`);
    if (finalMeetLink && matched.virtual_meeting_link !== finalMeetLink) changes.push(`meet_link → ${finalMeetLink}`);

    if (changes.length > 0) {
      await pool.query(
        `UPDATE course_run SET
           class_type = $1,
           virtual_meeting_link = COALESCE($2, virtual_meeting_link),
           updated_at = NOW()
         WHERE id = $3`,
        [classType, finalMeetLink || null, matched.id]
      );
      updated++;
      console.log(`  ✅ Updated ${matched.course_run_id} (${matched.course_title}): ${changes.join(', ')}`);
      results.push({ courseRunId: matched.course_run_id, courseTitle: matched.course_title, changes, meetLink: finalMeetLink });
    } else {
      skipped++;
      results.push({ courseRunId: matched.course_run_id, status: 'no_changes' });
    }
  }

  const summary = {
    totalEvents: events.length,
    virtualEvents: events.filter(e => /\[(VIRTUAL|HYBRID)\]/i.test(e.summary || '')).length,
    updated,
    skipped,
    calendarId,
  };

  console.log(`📅 [Calendar Sync] Done:`, JSON.stringify(summary));

  return { success: true, summary, results };
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ success: false, error: 'Method not allowed. Use POST.' });
  }

  try {
    const { startDate, endDate } = req.body || {};
    const result = await runSyncGoogleCalendar({ startDate, endDate });
    return res.status(200).json(result);
  } catch (error) {
    console.error('❌ [Calendar Sync] Error:', error);
    return res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Failed to sync Google Calendar.',
    });
  }
}
