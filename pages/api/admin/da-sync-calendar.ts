import type { NextApiRequest, NextApiResponse } from 'next';
import pool from '../../../lib/db';
import { google } from 'googleapis';
import { getGoogleCredentials } from '../../../lib/google-auth/googleAuth';
import { removeDaLearnerFromCalendar } from '../../../lib/google-calendar/da-calendar-sync';
import { getLocalYMD } from '../../../lib/dateHelpers';

/**
 * POST /api/admin/da-sync-calendar
 *
 * Two-phase calendar sync:
 * 1. Checks unchecked DA applications against Google Calendar — if learner is 
 *    already an attendee, ticks calendar_added = true.
 * 2. Cleans up cancelled DA applications — if calendar_added is still true but
 *    application_status is Cancelled, removes the learner from the calendar event
 *    and unticks calendar_added.
 */

function stripPrefixes(title: string): string {
  return (title || '')
    .replace(/^\s*\[?(WSQ|VIRTUAL|EXTERNAL|HYBRID)\]?\s*/gi, '')
    .replace(/^\s*\[?(WSQ|VIRTUAL|EXTERNAL|HYBRID)\]?\s*/gi, '')
    .trim();
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ success: false, error: 'Method not allowed' });
  }

  try {
    const tpRes = await pool.query(`SELECT sync_google_calendar, google_calendar_url FROM training_provider LIMIT 1`);
    const tpRow = tpRes.rows[0];
    if (!tpRow?.sync_google_calendar) {
      return res.status(400).json({ success: false, error: 'Google Calendar sync is not enabled' });
    }

    const credentials = await getGoogleCredentials(pool);
    let calendarId = 'primary';
    const calUrl = tpRow.google_calendar_url || '';
    if (calUrl) {
      const cidMatch = calUrl.match(/[?&]cid=([^&]+)/);
      if (cidMatch) {
        try { calendarId = Buffer.from(cidMatch[1], 'base64').toString('utf-8'); } catch { calendarId = cidMatch[1]; }
      } else if (calUrl.includes('@')) { calendarId = calUrl; }
    }

    const oauth2Client = new google.auth.OAuth2(credentials.clientId, credentials.clientSecret, 'https://developers.google.com/oauthplayground');
    oauth2Client.setCredentials({ refresh_token: credentials.refreshToken });
    const calendar = google.calendar({ version: 'v3', auth: oauth2Client });

    // ── Phase 1: Sync unchecked DA rows (tick CAL if already in calendar) ──
    const rows = await pool.query(`
      SELECT da.id, da.trainee_email, da.course_title,
             COALESCE(cr.start_date, da.course_start_date) as course_start_date
      FROM da_application da
      LEFT JOIN course_run cr ON da.course_run_id = cr.course_run_id
      WHERE (da.calendar_added IS NULL OR da.calendar_added = false)
        AND da.trainee_email IS NOT NULL AND da.trainee_email <> ''
        AND LOWER(COALESCE(da.application_status, '')) <> 'cancelled'
        AND COALESCE(cr.start_date, da.course_start_date) >= CURRENT_DATE
    `);

    let matched = 0;
    if (rows.rows.length > 0) {
      const dates = rows.rows.map(r => r.course_start_date ? getLocalYMD(new Date(r.course_start_date)) : null).filter(Boolean) as string[];
      dates.sort();
      const minDate = new Date(dates[0]); minDate.setDate(minDate.getDate() - 1);
      const maxDate = new Date(dates[dates.length - 1]); maxDate.setDate(maxDate.getDate() + 2);

      const eventsResponse = await calendar.events.list({
        calendarId,
        timeMin: minDate.toISOString(),
        timeMax: maxDate.toISOString(),
        singleEvents: true,
        maxResults: 2500,
      });
      const events = eventsResponse.data.items || [];

      for (const row of rows.rows) {
        if (!row.trainee_email || !row.course_title) continue;
        const startDateIso = row.course_start_date ? getLocalYMD(new Date(row.course_start_date)) : '';
        const strippedTitle = stripPrefixes(row.course_title).toLowerCase();
        const emailLower = row.trainee_email.trim().toLowerCase();

        const matchedEvent = events.find(evt => {
          const evtTitle = stripPrefixes(evt.summary || '').toLowerCase();
          const titleMatch = evtTitle.includes(strippedTitle) || strippedTitle.includes(evtTitle);
          if (!titleMatch) return false;
          const evtDate = evt.start?.dateTime?.slice(0, 10) || evt.start?.date || '';
          return evtDate === startDateIso;
        });

        if (!matchedEvent) continue;

        const attendees = matchedEvent.attendees || [];
        if (attendees.some(a => (a.email || '').toLowerCase() === emailLower)) {
          await pool.query(`UPDATE da_application SET calendar_added = true, updated_at = NOW() WHERE id = $1`, [row.id]);
          matched++;
        }
      }
    }

    // ── Phase 2: Clean up cancelled applications still marked in calendar ──
    const cancelledRows = await pool.query(`
      SELECT da.id, da.application_id, da.trainee_email, da.course_title,
             da.course_run_id, da.course_start_date
      FROM da_application da
      WHERE da.calendar_added = true
        AND LOWER(COALESCE(da.application_status, '')) = 'cancelled'
        AND da.trainee_email IS NOT NULL AND da.trainee_email <> ''
    `);

    let removed = 0;
    for (const row of cancelledRows.rows) {
      try {
        // Resolve course_run UUID
        const crRes = await pool.query(
          `SELECT id FROM course_run WHERE course_run_id = $1 LIMIT 1`,
          [row.course_run_id]
        );
        const courseRunUuid = crRes.rows[0]?.id || row.course_run_id;

        const removeResult = await removeDaLearnerFromCalendar(
          row.trainee_email,
          courseRunUuid,
          row.course_title,
          row.course_start_date
        );

        // Untick regardless (if the app is cancelled, CAL should be false)
        await pool.query(
          `UPDATE da_application SET calendar_added = false, updated_at = NOW() WHERE id = $1`,
          [row.id]
        );

        if (removeResult.removedFrom > 0) {
          removed++;
          console.log(`🗑️ [da-sync-calendar] Removed cancelled learner ${row.trainee_email} from ${removeResult.removedFrom} event(s)`);
        }
      } catch (err) {
        console.error(`⚠️ [da-sync-calendar] Failed to clean up ${row.trainee_email}:`, err);
      }
    }

    console.log(`✅ [da-sync-calendar] Checked ${rows.rows.length}, matched ${matched}, cancelled cleanup: ${cancelledRows.rows.length} checked, ${removed} removed`);
    return res.status(200).json({
      success: true,
      checked: rows.rows.length,
      matched,
      cancelledCleanup: { checked: cancelledRows.rows.length, removed },
    });
  } catch (err) {
    console.error('❌ da-sync-calendar error:', err);
    return res.status(500).json({ success: false, error: err instanceof Error ? err.message : 'Internal server error' });
  }
}
