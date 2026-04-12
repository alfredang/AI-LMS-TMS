import type { NextApiRequest, NextApiResponse } from 'next';
import pool from '../../../lib/db';
import { google } from 'googleapis';
import { getGoogleCredentials } from '../../../lib/google-auth/googleAuth';
import { createSSGEnrolmentAPI } from '../../../lib/ssg/api/enrolment-api';
import { getSSGCredentialsService } from '../../../lib/ssg/services/credentials-service';
import { getTrainingPartnerIdentifiers } from '../../../lib/trainingPartnerIdentifiers';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') {
    return res.status(405).json({ success: false, error: 'Method not allowed' });
  }

  // Accept enrolmentDate (YYYY-MM-DD), default to today in SGT
  const { enrolmentDate } = req.query;
  const dateIso: string = enrolmentDate
    ? (enrolmentDate as string)
    : new Intl.DateTimeFormat('en-CA', {
        year: 'numeric', month: '2-digit', day: '2-digit',
        timeZone: 'Asia/Singapore'
      }).format(new Date());

  // YYYYMMDD format for SSG API
  const dateCompact = dateIso.replace(/-/g, '');

  try {
    // 1. Load SSG credentials
    const credentials = await getSSGCredentialsService().getSSGCredentials();
    if (!credentials) {
      return res.status(500).json({ success: false, error: 'SSG credentials not found' });
    }

    const ssgBaseUrl = process.env.SSG_API_URL || 'https://api.ssg-wsg.sg';
    const tp = await getTrainingPartnerIdentifiers();
    const tpUen = tp.uen || credentials.uen;
    const tpCode = tp.code;

    const api = createSSGEnrolmentAPI(ssgBaseUrl, credentials);

    // 2. Search SSG for enrolments by date
    const result = await api.searchEnrolment({
      parameters: { page: 0, pageSize: 100, enrolmentDate: dateCompact },
      enrolment: {
        trainingPartner: { uen: tpUen, code: tpCode },
      },
    } as any);

    if (result.error) {
      console.error('❌ SSG searchEnrolment error:', result.error);
      return res.status(500).json({ success: false, error: result.error.message || 'SSG API error' });
    }

    const rawItems: any[] = Array.isArray(result.data) ? result.data : [];

    // 3. Filter: exact enrolmentDate match + Confirmed status
    const enrolments = rawItems
      .filter(item => {
        const enr = item?.enrolment ?? item;
        const traineeDate = enr?.trainee?.enrolmentDate;
        const status = enr?.status;
        // SSG returns enrolmentDate as YYYY-MM-DD
        return traineeDate === dateIso && status === 'Confirmed';
      })
      .map(item => {
        const enr = item?.enrolment ?? item;
        const meta = item?.meta ?? {};
        return {
          enrolment_id: enr?.referenceNumber || null,
          enrolment_date: meta?.createdOn || enr?.trainee?.enrolmentDate || null,
          email: enr?.trainee?.email?.full || null,
          title: enr?.course?.title || null,
          tgs_code: enr?.course?.referenceNumber || null,
          course_run_id: enr?.course?.run?.id || null,
          start_date: enr?.course?.run?.startDate || null,
          // Calendar matching fields (populated below)
          match: false,
          matchDetail: null,
          reason: null,
        };
      });

    // 4. Fetch calendar events and match
    try {
      const googleCreds = await getGoogleCredentials(pool);
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
          googleCreds.clientId,
          googleCreds.clientSecret,
          'https://developers.google.com/oauthplayground'
        );
        oauth2Client.setCredentials({ refresh_token: googleCreds.refreshToken });
        const calendar = google.calendar({ version: 'v3', auth: oauth2Client });

        // Normalize SSG start_date (YYYYMMDD or YYYY-MM-DD) to YYYY-MM-DD
        const toIsoStartDate = (raw: string | null): string => {
          if (!raw) return '';
          if (/^\d{8}$/.test(raw)) return `${raw.slice(0, 4)}-${raw.slice(4, 6)}-${raw.slice(6, 8)}`;
          return raw.slice(0, 10);
        };

        // Widen the calendar fetch to span all course start dates in this batch
        const startDates = enrolments
          .map(e => toIsoStartDate(e.start_date))
          .filter(Boolean)
          .sort();
        const calMin = startDates[0] || dateIso;
        const calMax = startDates[startDates.length - 1] || dateIso;

        const eventsResponse = await calendar.events.list({
          calendarId,
          timeMin: new Date(calMin).toISOString(),
          timeMax: new Date(calMax + 'T23:59:59Z').toISOString(),
          singleEvents: true,
          maxResults: 2500,
        });

        const stripHtml = (html: string) => html.replace(/<[^>]*>?/gm, ' ');

        const calendarEvents = (eventsResponse.data.items || []).map(event => ({
          title: event.summary || '',
          description: event.description || '',
          start: event.start?.dateTime?.slice(0, 10) || event.start?.date || '',
          attendees: (event.attendees || []).map(a => a.email?.toLowerCase()),
        }));

        // Match each enrolment against calendar events
        // Match criteria: attendee email + TGS code in description + course start date
        for (const e of enrolments) {
          const eEmail = e.email?.trim().toLowerCase();
          const eCode = e.tgs_code?.trim().toLowerCase();
          const eStartDate = toIsoStartDate(e.start_date);

          const fullMatch = calendarEvents.find(ce => {
            const hasDate = eStartDate ? ce.start === eStartDate : true;
            let hasCode = false;
            if (eCode && ce.description) {
              const cleanDesc = stripHtml(ce.description).toLowerCase();
              hasCode = cleanDesc.includes(eCode);
            }
            const hasEmail = ce.attendees.some(email => email?.trim().toLowerCase() === eEmail);
            return hasDate && hasCode && hasEmail;
          });

          if (fullMatch) {
            e.match = true;
            e.matchDetail = `Matched with: ${fullMatch.title}`;
            e.reason = null;
          } else {
            const eventExists = calendarEvents.find(ce => {
              const hasDate = eStartDate ? ce.start === eStartDate : true;
              let hasCode = false;
              if (eCode && ce.description) {
                const cleanDesc = stripHtml(ce.description).toLowerCase();
                hasCode = cleanDesc.includes(eCode);
              }
              return hasDate && hasCode;
            });
            e.match = false;
            e.reason = eventExists ? 'No Email' : 'No Event';
          }
        }
      }
    } catch (calErr) {
      console.error('❌ Failed to fetch calendar events:', calErr);
      // Continue without calendar matching
    }

    return res.status(200).json({
      success: true,
      data: enrolments,
      enrolmentDate: dateIso,
    });

  } catch (error) {
    console.error('❌ Error in upcoming-enrolment API:', error);
    return res.status(500).json({ success: false, error: 'Internal server error' });
  }
}
