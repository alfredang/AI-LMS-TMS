import type { NextApiRequest, NextApiResponse } from 'next';
import { google } from 'googleapis';
import pool from '../../../lib/db';
import { getGoogleCredentials } from '../../../lib/google-auth/googleAuth';

/**
 * POST /api/admin/check-calendar-trainers
 *
 * Scans Google Calendar events from today onwards, matches to local course runs
 * by title + date, checks if any calendar trainer attendee matches the local
 * assigned trainer. Writes `trainer_in_calendar` boolean to course_run.
 *
 * Body: { daysAhead?: number } — default 60
 */

function stripTitle(title: string): string {
  return (title || '')
    .replace(/\[(?:WSQ|IBF|VIRTUAL|EXTERNAL|HYBRID)\]\s*/gi, '')
    .replace(/^\*\s*/, '')
    .replace(/^Day\s+\d+\s*[-–]\s*/i, '')
    .replace(/^(?:WSQ|IBF)\s*[-–]\s*/i, '')
    .trim();
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ success: false, error: 'Method not allowed' });
  }

  const daysAhead = req.body?.daysAhead || 60;

  try {
    // Ensure column exists
    await pool.query('ALTER TABLE course_run ADD COLUMN IF NOT EXISTS trainer_in_calendar BOOLEAN');

    // 1. Get calendar client
    const credentials = await getGoogleCredentials(pool);
    const tpRes = await pool.query('SELECT google_calendar_url FROM training_provider LIMIT 1');
    const calUrl = tpRes.rows[0]?.google_calendar_url || '';
    let calendarId = 'primary';
    if (calUrl) {
      const cidMatch = calUrl.match(/[?&]cid=([^&]+)/);
      if (cidMatch) {
        try { calendarId = Buffer.from(cidMatch[1], 'base64').toString('utf-8'); }
        catch { calendarId = cidMatch[1]; }
      } else if (calUrl.includes('@')) { calendarId = calUrl; }
    }

    const oauth2Client = new google.auth.OAuth2(
      credentials.clientId, credentials.clientSecret,
      'https://developers.google.com/oauthplayground'
    );
    oauth2Client.setCredentials({ refresh_token: credentials.refreshToken });
    const calendar = google.calendar({ version: 'v3', auth: oauth2Client });

    // 2. Fetch events
    const now = new Date();
    const future = new Date(now.getTime() + daysAhead * 24 * 60 * 60 * 1000);
    const allEvents: any[] = [];
    let pageToken: string | undefined;
    do {
      const eventsRes = await calendar.events.list({
        calendarId,
        timeMin: now.toISOString(),
        timeMax: future.toISOString(),
        singleEvents: true,
        orderBy: 'startTime',
        maxResults: 500,
        pageToken,
      });
      allEvents.push(...(eventsRes.data.items || []));
      pageToken = eventsRes.data.nextPageToken || undefined;
    } while (pageToken);

    // 3. Load trainer email lookup (primary + secondary + additional)
    await pool.query('ALTER TABLE app_user ADD COLUMN IF NOT EXISTS additional_emails TEXT[] DEFAULT \'{}\'');
    const trainersRes = await pool.query(`
      SELECT au.id, au.full_name, LOWER(au.email) AS email, LOWER(au.secondary_email) AS sec,
             au.additional_emails
      FROM app_user au
      JOIN user_role_map urm ON urm.user_id = au.id
      WHERE urm.role = 'Trainer'
    `);
    const trainerEmails = new Set<string>();
    // Map any trainer email → all emails for that person (for identity resolution)
    const trainerEmailGroups = new Map<string, Set<string>>();
    for (const t of trainersRes.rows) {
      const allEmails = new Set<string>();
      if (t.email) allEmails.add(t.email);
      if (t.sec) allEmails.add(t.sec);
      if (Array.isArray(t.additional_emails)) {
        for (const ae of t.additional_emails) { if (ae) allEmails.add(ae.toLowerCase()); }
      }
      for (const e of allEmails) {
        trainerEmails.add(e);
        trainerEmailGroups.set(e, allEmails);
      }
    }

    // 4. Load upcoming + ongoing course runs with local trainer
    const crRes = await pool.query(`
      SELECT cr.id AS uuid, cr.course_run_id, cr.start_date::text, cr.end_date::text,
             cr.assigned_trainer_email,
             c.title AS course_title,
             (SELECT ARRAY_AGG(LOWER(crt.trainer_email)) FROM course_run_trainer crt WHERE crt.course_run_id = cr.id) AS junction_emails
      FROM course_run cr
      JOIN course c ON c.id = cr.course_id
      WHERE cr.start_date >= CURRENT_DATE OR cr.end_date >= CURRENT_DATE
    `);

    // Build title+date → course_run lookup
    // Key: stripped title (lowercase) + session date
    // But we don't have sessions here — use course run start_date..end_date range
    const crByTitle = new Map<string, any[]>();
    for (const cr of crRes.rows) {
      const title = stripTitle(cr.course_title).toLowerCase();
      if (!crByTitle.has(title)) crByTitle.set(title, []);
      crByTitle.get(title)!.push(cr);
    }

    // 5. Process calendar events — match to CRs and check trainers
    let matched = 0;
    let trainerFound = 0;
    let trainerNotFound = 0;
    const updatedUuids = new Set<string>();

    for (const evt of allEvents) {
      const summary = evt.summary || '';
      if (!/WSQ|IBF/i.test(summary)) continue;

      const cleanTitle = stripTitle(summary).toLowerCase();
      const eventDate = (evt.start?.dateTime || evt.start?.date || '').slice(0, 10);
      if (!eventDate) continue;

      // Find matching CRs by title where event date falls within start-end
      const candidates = crByTitle.get(cleanTitle) || [];
      const matchedCrs = candidates.filter(cr => {
        const start = cr.start_date?.slice(0, 10);
        const end = cr.end_date?.slice(0, 10);
        return start && end && eventDate >= start && eventDate <= end;
      });

      if (matchedCrs.length === 0) continue;
      matched += matchedCrs.length;

      // Check attendees for trainers
      const attendees = (evt.attendees || []).filter((a: any) => !a.organizer && !a.self);
      const calTrainerEmails = attendees
        .map((a: any) => (a.email || '').toLowerCase())
        .filter((e: string) => trainerEmails.has(e));

      for (const cr of matchedCrs) {
        if (updatedUuids.has(cr.uuid)) continue; // already processed

        // Check if any calendar trainer matches local trainer
        // Expand local emails through identity groups so different emails
        // for the same person (e.g. iris@tertiaryinfotech.com vs wangyanhong2017@gmail.com) still match
        const localEmails = new Set<string>();
        const rawLocalEmails: string[] = [];
        if (cr.assigned_trainer_email) rawLocalEmails.push(cr.assigned_trainer_email.toLowerCase());
        if (Array.isArray(cr.junction_emails)) {
          for (const e of cr.junction_emails) { if (e) rawLocalEmails.push(e); }
        }
        for (const e of rawLocalEmails) {
          localEmails.add(e);
          const group = trainerEmailGroups.get(e);
          if (group) { for (const ge of group) localEmails.add(ge); }
        }

        const hasMatch = calTrainerEmails.some((ce: string) => localEmails.has(ce));

        if (hasMatch) trainerFound++;
        else trainerNotFound++;

        await pool.query(
          'UPDATE course_run SET trainer_in_calendar = $1, updated_at = NOW() WHERE id = $2',
          [hasMatch, cr.uuid]
        );
        updatedUuids.add(cr.uuid);
      }
    }

    // 6. Set false for CRs that weren't matched to any calendar event
    const unmatchedRes = await pool.query(`
      UPDATE course_run SET trainer_in_calendar = false, updated_at = NOW()
      WHERE (start_date >= CURRENT_DATE OR end_date >= CURRENT_DATE)
        AND id != ALL($1::uuid[])
        AND trainer_in_calendar IS DISTINCT FROM false
      RETURNING id
    `, [Array.from(updatedUuids)]);

    return res.status(200).json({
      success: true,
      calendarEvents: allEvents.length,
      matchedCourseRuns: matched,
      trainerInCalendar: trainerFound,
      trainerNotInCalendar: trainerNotFound,
      unmarkedAsNotInCalendar: unmatchedRes.rowCount,
      totalProcessed: updatedUuids.size,
    });
  } catch (err) {
    console.error('❌ check-calendar-trainers error:', err);
    return res.status(500).json({
      success: false,
      error: err instanceof Error ? err.message : 'Internal server error',
    });
  }
}
