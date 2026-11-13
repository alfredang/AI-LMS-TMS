import { withServiceAuth } from '@lib/auth/withAuth';
import type { NextApiRequest, NextApiResponse } from 'next';
import { google, type calendar_v3 } from 'googleapis';
import pool from '@lib/db';
import { collectRunCalendarEvents, isGoogleMeetLink, meetLinkOfEvent, storeRunMeetLink } from '@lib/calendar/meetLink';
import { eventDateIso, extractEventRunId } from '@lib/calendar/eventMatch';
import { getGoogleCredentials } from '@lib/google-auth/googleAuth';
import { getLocalYMD } from '../../../lib/dateHelpers';

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

export interface SyncCalendarOptions { startDate?: string; endDate?: string; /** report what would change without writing */ dryRun?: boolean }

export async function runSyncGoogleCalendar(options?: SyncCalendarOptions) {
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

async function _runSyncGoogleCalendarInner(options?: SyncCalendarOptions) {
  const dryRun = !!options?.dryRun;
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

  // Events are fetched from 60 days BEFORE the window too: a run can hold a Meet
  // link that belongs to a class that already ran (copied by the old fuzzy match),
  // and we can only prove that by seeing the owning event. Paginated — a busy
  // calendar has ~20 events/day.
  const ownershipLookbackMs = 60 * 24 * 60 * 60 * 1000;
  const events: calendar_v3.Schema$Event[] = [];
  let pageToken: string | undefined;
  do {
    const page = await calendar.events.list({
      calendarId,
      timeMin: new Date(startDate.getTime() - ownershipLookbackMs).toISOString(),
      timeMax: futureDate.toISOString(),
      singleEvents: true,
      orderBy: 'startTime',
      maxResults: 2500,
      pageToken,
    });
    events.push(...(page.data.items || []));
    pageToken = page.data.nextPageToken || undefined;
  } while (pageToken);
  console.log(`📅 [Calendar Sync] Found ${events.length} events in the next ${lookAheadDays} days`);

  // Course runs in the window. Matching is EXACT ONLY — via the durable
  // course_run_calendar_event mapping or the "Course Run ID: <id>" the LMS stamps
  // into event descriptions. The previous title-substring match ("Autonomous AI
  // Agents" ⊂ "Build a Human–AI Workforce with Autonomous AI Agents") and its
  // "same title, any date" fallback copied OTHER classes' Meet links onto runs, so
  // the TMS link disagreed with the calendar invite learners were emailed from.
  const courseRuns = await pool.query(
    `SELECT cr.id, cr.course_run_id, cr.start_date, cr.end_date, cr.class_type,
            cr.virtual_meeting_link, cr.virtual_meeting_provider,
            c.title AS course_title
       FROM course_run cr
       JOIN course c ON c.id = cr.course_id
      WHERE cr.start_date >= $1::date
        AND cr.start_date <= $2::date`,
    [getLocalYMD(startDate), getLocalYMD(futureDate)]
  );

  // Which run owns each Meet link seen on the calendar (to detect a run holding
  // ANOTHER class's link — the symptom users reported).
  const runByEventId = new Map<string, string>();
  const mappedRows = await pool.query<{ course_run_id: string; google_event_id: string }>(
    `SELECT m.course_run_id, m.google_event_id
       FROM course_run_calendar_event m
       JOIN course_run cr ON cr.id = m.course_run_id
      WHERE cr.start_date BETWEEN ($1::date - 14) AND ($2::date + 14)`,
    [getLocalYMD(startDate), getLocalYMD(futureDate)]
  );
  for (const r of mappedRows.rows) runByEventId.set(r.google_event_id, r.course_run_id);
  const ssgIdToUuid = new Map<string, string>();
  for (const cr of courseRuns.rows) if (cr.course_run_id) ssgIdToUuid.set(String(cr.course_run_id).toLowerCase(), cr.id);
  const linkOwner = new Map<string, Set<string>>(); // meet link -> run uuids whose events carry it
  const linkDates = new Map<string, Set<string>>(); // meet link -> YYYY-MM-DD of every event carrying it
  for (const e of events) {
    if (!e.id || e.status === 'cancelled') continue;
    const link = meetLinkOfEvent(e);
    if (!link) continue;
    if (!linkDates.has(link)) linkDates.set(link, new Set());
    linkDates.get(link)!.add(eventDateIso(e));
    const rid = extractEventRunId(e);
    const owner = runByEventId.get(e.id) || (rid ? ssgIdToUuid.get(rid) : undefined);
    if (!owner) continue;
    if (!linkOwner.has(link)) linkOwner.set(link, new Set());
    linkOwner.get(link)!.add(owner);
  }

  let updated = 0;
  let skipped = 0;
  const results: any[] = [];

  for (const run of courseRuns.rows) {
    const own = await collectRunCalendarEvents(calendar, calendarId, run, events);
    if (own.events.length === 0) { skipped++; continue; }

    const tagged = own.events.map(e => e.summary || '');
    const isVirtual = tagged.some(t => /\[VIRTUAL\s*\]/i.test(t));
    const isHybrid = !isVirtual && tagged.some(t => /\[HYBRID\s*\]/i.test(t));
    const classType = isVirtual ? 'Virtual' : isHybrid ? 'Hybrid' : null;

    const current = (run.virtual_meeting_link || '').trim();
    const changes: string[] = [];
    let nextLink: string | null | undefined = undefined; // undefined = leave as is

    if (own.meetLink) {
      if (current !== own.meetLink) { nextLink = own.meetLink; changes.push(`meet_link → ${own.meetLink}`); }
      if (own.meetLinks.length > 1) {
        console.warn(`  ⚠️ ${run.course_run_id}: session days carry different Meet links (${own.meetLinks.join(', ')}); using the first day's.`);
      }
    } else if (current && isGoogleMeetLink(current)) {
      // The run's own events have no Meet, but the stored link is a Meet link that
      // belongs to a DIFFERENT run's event → it was copied over by the old fuzzy
      // sync. Clear it rather than keep showing learners the wrong room.
      const owners = linkOwner.get(current);
      const dates = linkDates.get(current);
      const sd = run.start_date ? getLocalYMD(new Date(run.start_date)) : '';
      const ed = run.end_date ? getLocalYMD(new Date(run.end_date)) : sd;
      const onOwnDays = !!dates && Array.from(dates).some(d => sd && d >= sd && d <= ed);
      if (owners && owners.size > 0 && !owners.has(run.id)) {
        nextLink = null; changes.push(`meet_link cleared (belongs to another class's calendar event)`);
      } else if (dates && dates.size > 0 && !onOwnDays) {
        // Every calendar event carrying this room is on a day this class is NOT in
        // session → it is some other class's room (Meet rooms are per event).
        nextLink = null; changes.push(`meet_link cleared (calendar events with this room are on ${Array.from(dates).sort().join(', ')}, outside ${sd}..${ed})`);
      }
    }
    if (classType && run.class_type !== classType) changes.push(`class_type → ${classType}`);

    if (changes.length === 0) { skipped++; results.push({ courseRunId: run.course_run_id, status: 'no_changes' }); continue; }

    if (!dryRun && nextLink !== undefined) await storeRunMeetLink(run.id, nextLink);
    if (!dryRun && classType && run.class_type !== classType) {
      await pool.query(`UPDATE course_run SET class_type = $1, updated_at = NOW() WHERE id = $2`, [classType, run.id]);
    }
    updated++;
    console.log(`  ${dryRun ? '🔎 Would update' : '✅ Updated'} ${run.course_run_id} (${run.course_title}): ${changes.join(', ')}`);
    results.push({ courseRunId: run.course_run_id, courseTitle: run.course_title, changes, meetLink: nextLink === undefined ? current || null : nextLink });
  }

  // Tagged events that carry no resolvable run id are reported (not guessed) so
  // staff can stamp "Course Run ID: <id>" into the event — the only way a
  // calendar event is ever linked to a class.
  const unresolvedTagged = events
    .filter(e => e.status !== 'cancelled' && /\[(VIRTUAL|HYBRID)\s*\]/i.test(e.summary || ''))
    .filter(e => !(e.id && runByEventId.has(e.id)) && !(extractEventRunId(e) && ssgIdToUuid.has(extractEventRunId(e)!)))
    .filter(e => eventDateIso(e) >= getLocalYMD(startDate))
    .map(e => ({ event: e.summary, date: e.start?.dateTime || e.start?.date, status: 'no_run_id' }));
  results.push(...unresolvedTagged.slice(0, 50));

  const summary = {
    totalEvents: events.length,
    virtualEvents: events.filter(e => /\[(VIRTUAL|HYBRID)\s*\]/i.test(e.summary || '')).length,
    runsInWindow: courseRuns.rows.length,
    unresolvedTaggedEvents: unresolvedTagged.length,
    dryRun,
    updated,
    skipped,
    calendarId,
  };

  console.log(`📅 [Calendar Sync] Done:`, JSON.stringify(summary));

  return { success: true, summary, results };
}

async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ success: false, error: 'Method not allowed. Use POST.' });
  }

  try {
    const { startDate, endDate, dryRun } = req.body || {};
    const result = await runSyncGoogleCalendar({ startDate, endDate, dryRun: dryRun === true || dryRun === 'true' });
    return res.status(200).json(result);
  } catch (error) {
    console.error('❌ [Calendar Sync] Error:', error);
    return res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Failed to sync Google Calendar.',
    });
  }
}

export default withServiceAuth(handler);
