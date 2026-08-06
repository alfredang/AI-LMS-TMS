import { withAuth } from '@lib/auth/withAuth';
import type { NextApiRequest, NextApiResponse } from 'next';
import { google } from 'googleapis';
import pool from '@lib/db';
import { getGoogleCredentials } from '@lib/google-auth/googleAuth';

/**
 * GET /api/calendar/search?q=searchTerm&startDate=YYYY-MM-DD&endDate=YYYY-MM-DD
 *
 * Searches Google Calendar events by keyword (course code, title, name, date).
 * Returns event details including attendee emails, description, location, and meet links.
 */
async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') {
    return res.status(405).json({ success: false, error: 'Method not allowed. Use GET.' });
  }

  try {
    const { q, startDate, endDate } = req.query;
    const searchQuery = (q as string || '').trim();

    if (!searchQuery) {
      return res.status(400).json({ success: false, error: 'Search query (q) is required.' });
    }

    const credentials = await getGoogleCredentials(pool);

    // Get calendar ID
    const tpResult = await pool.query(
      `SELECT google_calendar_url, sync_google_calendar FROM training_provider LIMIT 1`
    );
    const tpRow = tpResult.rows[0];
    if (!tpRow?.sync_google_calendar) {
      return res.status(400).json({ success: false, error: 'Google Calendar sync is not enabled.' });
    }

    let calendarId = 'primary';
    const calUrl = tpRow.google_calendar_url || '';
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

    // Set up Google Calendar API
    const oauth2Client = new google.auth.OAuth2(
      credentials.clientId,
      credentials.clientSecret,
      'https://developers.google.com/oauthplayground'
    );
    oauth2Client.setCredentials({ refresh_token: credentials.refreshToken });
    const calendar = google.calendar({ version: 'v3', auth: oauth2Client });

    // Default: search 6 months back to 3 months ahead
    const now = new Date();
    const defaultStart = new Date(now);
    defaultStart.setMonth(defaultStart.getMonth() - 6);
    const defaultEnd = new Date(now);
    defaultEnd.setMonth(defaultEnd.getMonth() + 3);

    const timeMin = startDate ? new Date(startDate as string).toISOString() : defaultStart.toISOString();
    const timeMax = endDate ? new Date(endDate as string + 'T23:59:59').toISOString() : defaultEnd.toISOString();

    // Fetch events using Google Calendar's built-in search
    const eventsResponse = await calendar.events.list({
      calendarId,
      q: searchQuery,
      timeMin,
      timeMax,
      singleEvents: true,
      orderBy: 'startTime',
      maxResults: 50,
    });

    const events = (eventsResponse.data.items || []).map(event => ({
      id: event.id,
      title: event.summary || '(No title)',
      description: event.description || '',
      location: event.location || '',
      start: event.start?.dateTime || event.start?.date || '',
      end: event.end?.dateTime || event.end?.date || '',
      meetLink: event.hangoutLink
        || event.conferenceData?.entryPoints?.find(ep => ep.entryPointType === 'video')?.uri
        || '',
      attendees: (event.attendees || []).map(a => ({
        email: a.email || '',
        name: a.displayName || '',
        status: a.responseStatus || 'needsAction',
        organizer: a.organizer || false,
      })),
      creator: event.creator?.email || '',
      organizer: event.organizer?.email || '',
      htmlLink: event.htmlLink || '',
      status: event.status || '',
      created: event.created || '',
      updated: event.updated || '',
    }));

    return res.status(200).json({
      success: true,
      data: events,
      count: events.length,
      query: searchQuery,
    });
  } catch (error) {
    console.error('❌ [Calendar Search] Error:', error);
    return res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Failed to search calendar events.',
    });
  }
}

export default withAuth(handler);
