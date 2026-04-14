import type { NextApiRequest, NextApiResponse } from 'next';
import pool from '../../../lib/db';
import { google } from 'googleapis';
import { getGoogleCredentials } from '../../../lib/google-auth/googleAuth';

/**
 * POST /api/admin/da-add-to-calendar
 *
 * Body: { applicationIds: string[] }
 *
 * For each selected DA application, finds the matching Google Calendar
 * event (by course title ignoring WSQ/VIRTUAL/EXTERNAL prefixes + course
 * start date) and adds the learner email as an attendee if not present.
 * Updates calendar_added = true on success.
 *
 * Returns per-row results so the UI can update checkboxes.
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

  const { applicationIds } = req.body || {};
  if (!Array.isArray(applicationIds) || applicationIds.length === 0) {
    return res.status(400).json({ success: false, error: 'applicationIds array is required' });
  }

  try {
    // Load calendar config
    const tpRes = await pool.query(
      `SELECT sync_google_calendar, google_calendar_url FROM training_provider LIMIT 1`
    );
    const tpRow = tpRes.rows[0];
    if (!tpRow?.sync_google_calendar) {
      return res.status(400).json({ success: false, error: 'Google Calendar sync is not enabled in Company Settings' });
    }

    const credentials = await getGoogleCredentials(pool);
    let calendarId = 'primary';
    const calUrl = tpRow.google_calendar_url || '';
    if (calUrl) {
      const cidMatch = calUrl.match(/[?&]cid=([^&]+)/);
      if (cidMatch) {
        try { calendarId = Buffer.from(cidMatch[1], 'base64').toString('utf-8'); } catch { calendarId = cidMatch[1]; }
      } else if (calUrl.includes('@')) {
        calendarId = calUrl;
      }
    }

    const oauth2Client = new google.auth.OAuth2(credentials.clientId, credentials.clientSecret, 'https://developers.google.com/oauthplayground');
    oauth2Client.setCredentials({ refresh_token: credentials.refreshToken });
    const calendar = google.calendar({ version: 'v3', auth: oauth2Client });

    // Load DA rows
    const rows = await pool.query(
      `SELECT da.id, da.trainee_email, da.course_title,
              COALESCE(cr.start_date, da.course_start_date) as course_start_date,
              da.calendar_added
       FROM da_application da
       LEFT JOIN course_run cr ON da.course_run_id = cr.course_run_id
       WHERE da.id = ANY($1::uuid[])`,
      [applicationIds]
    );

    // Get date range for calendar fetch
    const dates = rows.rows
      .map(r => r.course_start_date ? new Date(r.course_start_date).toISOString().slice(0, 10) : null)
      .filter(Boolean) as string[];
    if (dates.length === 0) {
      return res.status(200).json({ success: true, results: [] });
    }
    dates.sort();
    const minDate = new Date(dates[0]);
    minDate.setDate(minDate.getDate() - 1);
    const maxDate = new Date(dates[dates.length - 1]);
    maxDate.setDate(maxDate.getDate() + 2);

    const eventsResponse = await calendar.events.list({
      calendarId,
      timeMin: minDate.toISOString(),
      timeMax: maxDate.toISOString(),
      singleEvents: true,
      maxResults: 500,
    });
    const events = eventsResponse.data.items || [];

    const results: { id: string; success: boolean; error?: string }[] = [];
    const { addDaLearnerToCalendar } = await import('../../../lib/google-calendar/da-calendar-sync');

    for (const row of rows.rows) {
      if (!row.trainee_email || !row.course_title) {
        results.push({ id: row.id, success: false, error: 'Missing email or course title' });
        continue;
      }
      
      try {
        const syncResult = await addDaLearnerToCalendar(
          row.trainee_email,
          row.id, // This is the internal DA application ID, the service will resolve the run UUID
          row.course_title,
          row.course_start_date
        );

        if (syncResult.addedTo > 0 || syncResult.totalSessions > 0) {
          await pool.query(`UPDATE da_application SET calendar_added = true, updated_at = NOW() WHERE id = $1`, [row.id]);
          results.push({ id: row.id, success: true });
        } else {
          results.push({ id: row.id, success: false, error: `No matching calendar events found for "${row.course_title}"` });
        }
      } catch (err: any) {
        results.push({ id: row.id, success: false, error: err.message || 'Calendar sync error' });
      }
    }

    return res.status(200).json({ success: true, results });
  } catch (err) {
    console.error('❌ da-add-to-calendar error:', err);
    return res.status(500).json({ success: false, error: err instanceof Error ? err.message : 'Internal server error' });
  }
}
