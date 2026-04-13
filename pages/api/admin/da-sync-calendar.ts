import type { NextApiRequest, NextApiResponse } from 'next';
import pool from '../../../lib/db';
import { google } from 'googleapis';
import { getGoogleCredentials } from '../../../lib/google-auth/googleAuth';

/**
 * POST /api/admin/da-sync-calendar
 *
 * Checks all DA applications (where calendar_added is false/null) against
 * Google Calendar events. If the learner email is already an attendee of
 * the matching event, sets calendar_added = true.
 *
 * Does NOT add attendees — only syncs existing state.
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

    // Load unchecked DA rows with future start dates
    const rows = await pool.query(`
      SELECT da.id, da.trainee_email, da.course_title,
             COALESCE(cr.start_date, da.course_start_date) as course_start_date
      FROM da_application da
      LEFT JOIN course_run cr ON da.course_run_id = cr.course_run_id
      WHERE (da.calendar_added IS NULL OR da.calendar_added = false)
        AND da.trainee_email IS NOT NULL AND da.trainee_email <> ''
        AND COALESCE(cr.start_date, da.course_start_date) >= CURRENT_DATE
    `);

    if (rows.rows.length === 0) {
      return res.status(200).json({ success: true, checked: 0, matched: 0 });
    }

    // Get date range
    const dates = rows.rows.map(r => r.course_start_date ? new Date(r.course_start_date).toISOString().slice(0, 10) : null).filter(Boolean) as string[];
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

    let matched = 0;
    for (const row of rows.rows) {
      if (!row.trainee_email || !row.course_title) continue;
      const startDateIso = row.course_start_date ? new Date(row.course_start_date).toISOString().slice(0, 10) : '';
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

    console.log(`✅ [da-sync-calendar] Checked ${rows.rows.length} rows, matched ${matched}`);
    return res.status(200).json({ success: true, checked: rows.rows.length, matched });
  } catch (err) {
    console.error('❌ da-sync-calendar error:', err);
    return res.status(500).json({ success: false, error: err instanceof Error ? err.message : 'Internal server error' });
  }
}
