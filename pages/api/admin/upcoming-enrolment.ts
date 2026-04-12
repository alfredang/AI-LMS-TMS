import type { NextApiRequest, NextApiResponse } from 'next';
import pool from '../../../lib/db';
import { google } from 'googleapis';
import { getGoogleCredentials } from '../../../lib/google-auth/googleAuth';

/**
 * GET /api/admin/upcoming-enrolment?startDate=YYYY-MM-DD&endDate=YYYY-MM-DD
 *
 * Queries the LOCAL enrollment table (not SSG live) for confirmed enrolments
 * whose course run starts within the given date range. Uses the same date
 * range logic as Upcoming Classes so the two views are consistent.
 *
 * Also checks if each learner's email is in the matching Google Calendar
 * event (same calendar-matching logic as before).
 *
 * Defaults to today → today + 21 days if no dates are provided.
 */
export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') {
    return res.status(405).json({ success: false, error: 'Method not allowed' });
  }

  const { startDate, endDate } = req.query;
  const start = startDate
    ? (startDate as string)
    : new Intl.DateTimeFormat('en-CA', {
        year: 'numeric', month: '2-digit', day: '2-digit',
        timeZone: 'Asia/Singapore',
      }).format(new Date());
  const end = endDate
    ? (endDate as string)
    : new Intl.DateTimeFormat('en-CA', {
        year: 'numeric', month: '2-digit', day: '2-digit',
        timeZone: 'Asia/Singapore',
      }).format(new Date(Date.now() + 21 * 24 * 60 * 60 * 1000));

  try {
    // 1. Fetch enrolments from local DB
    const enrolmentsResult = await pool.query(
      `SELECT
        e.id,
        e.enrolment_id,
        e.enrolment_date,
        e.enrolment_status,
        e.nric,
        COALESCE(au.email, e.email) AS email,
        COALESCE(au.full_name, e.nric) AS learner_name,
        c.title AS course_title,
        c.course_code,
        cr.course_run_id,
        cr.start_date,
        cr.class_status,
        e.calendar_added,
        e.personal_invoice_number AS invoice_id,
        e.grant_id,
        e.grant_amount,
        e.course_sponsorship,
        e.payment_status
      FROM public.enrollment AS e
      INNER JOIN public.course_run AS cr ON e.course_run_id = cr.id
      INNER JOIN public.course AS c ON cr.course_id = c.id
      LEFT JOIN public.app_user AS au ON e.user_id = au.id
      WHERE
        LOWER(COALESCE(e.enrolment_status, '')) NOT IN ('admin removed', 'cancelled', 'withdrawn')
        AND cr.class_status <> 'Cancelled'
        AND cr.start_date BETWEEN $1 AND $2
      ORDER BY cr.start_date ASC, e.created_at DESC`,
      [start, end]
    );

    const enrolments = enrolmentsResult.rows;

    // 2. Fetch calendar events and match
    const formatSgDate = (date: any) => {
      if (!date) return '';
      return new Intl.DateTimeFormat('en-CA', {
        year: 'numeric', month: '2-digit', day: '2-digit',
        timeZone: 'Asia/Singapore',
      }).format(new Date(date));
    };

    let calendarEvents: any[] = [];
    try {
      const credentials = await getGoogleCredentials(pool);
      const tpResult = await pool.query(
        `SELECT google_calendar_url, sync_google_calendar FROM training_provider LIMIT 1`
      );
      const tpRow = tpResult.rows[0];

      if (tpRow?.sync_google_calendar) {
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

        const oauth2Client = new google.auth.OAuth2(
          credentials.clientId,
          credentials.clientSecret,
          'https://developers.google.com/oauthplayground'
        );
        oauth2Client.setCredentials({ refresh_token: credentials.refreshToken });
        const calendar = google.calendar({ version: 'v3', auth: oauth2Client });

        const eventsResponse = await calendar.events.list({
          calendarId,
          timeMin: new Date(start).toISOString(),
          timeMax: new Date(end + 'T23:59:59Z').toISOString(),
          singleEvents: true,
          maxResults: 2500,
        });

        calendarEvents = (eventsResponse.data.items || []).map(event => ({
          title: event.summary || '',
          description: event.description || '',
          start: event.start?.dateTime?.slice(0, 10) || event.start?.date || '',
          attendees: (event.attendees || []).map(a => (a.email || '').toLowerCase()),
        }));
      }
    } catch (calErr) {
      console.error('❌ Failed to fetch calendar events:', calErr);
    }

    // 3. Match enrolments with calendar events
    const stripHtml = (html: string) => html.replace(/<[^>]*>?/gm, ' ');

    const matchedEnrolments = enrolments.map(e => {
      const eEmail = (e.email || '').trim().toLowerCase();
      const eDate = formatSgDate(e.start_date);
      const eCode = (e.course_code || '').trim().toLowerCase();

      const fullMatch = calendarEvents.find(ce => {
        const hasDate = ce.start === eDate;
        let hasCode = false;
        if (eCode && ce.description) {
          const cleanDesc = stripHtml(ce.description).toLowerCase();
          hasCode = cleanDesc.includes(eCode);
        }
        const hasEmail = ce.attendees.some((email: string) => email === eEmail);
        return hasDate && hasCode && hasEmail;
      });

      if (fullMatch) {
        return { ...e, match: true, matchDetail: `Matched with: ${fullMatch.title}`, reason: null };
      }

      const eventExists = calendarEvents.find(ce => {
        const hasDate = ce.start === eDate;
        let hasCode = false;
        if (eCode && ce.description) {
          const cleanDesc = stripHtml(ce.description).toLowerCase();
          hasCode = cleanDesc.includes(eCode);
        }
        return hasDate && hasCode;
      });

      return { ...e, match: false, reason: eventExists ? 'No Email' : 'No Event' };
    });

    return res.status(200).json({
      success: true,
      data: matchedEnrolments,
      start,
      end,
    });
  } catch (error) {
    console.error('❌ Error in upcoming-enrolment API:', error);
    return res.status(500).json({ success: false, error: 'Internal server error' });
  }
}
