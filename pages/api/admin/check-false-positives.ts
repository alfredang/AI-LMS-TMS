import { withAuth } from '@lib/auth/withAuth';
import { NextApiRequest, NextApiResponse } from 'next';
import { google } from 'googleapis';
import pool from '../../../lib/db';
import { getLocalYMD } from '../../../lib/dateHelpers';

function stripPrefixes(title: string): string {
  if (!title) return '';
  return title
    .replace(/^\s*Day\s*\d+[\s-:]*/gi, '')
    .replace(/^\s*\[?(WSQ|VIRTUAL|EXTERNAL|HYBRID|E-LEARNING)\]?[\s-]*/gi, '')
    .replace(/^[\s-:]+|[\s-:]+$/g, '')
    .replace(/[^\w\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

// Clean NextJS handler

async function handler(req: NextApiRequest, res: NextApiResponse) {
  try {
    const { getGoogleCredentials } = await import('../../../lib/google-auth/googleAuth');
    const credentials = await getGoogleCredentials(pool as any);
    const calendarId = process.env.GOOGLE_CALENDAR_ID || 'primary';
    const oauth2Client = new google.auth.OAuth2(credentials.clientId, credentials.clientSecret);
    oauth2Client.setCredentials({ refresh_token: credentials.refreshToken });
    const auth = oauth2Client;
    const calendar = google.calendar({ version: 'v3', auth });

    // Get recently added DA applications that supposedly have calendar_added = true
    const result = await pool.query(`
      SELECT da.id, da.trainee_name, da.trainee_email, da.course_title, 
             da.calendar_added,
             COALESCE(cr.id::text, da.course_run_id) as internal_run_id,
             COALESCE(cr.start_date, da.course_start_date) as course_start_date
      FROM da_application da
      LEFT JOIN course_run cr ON da.course_run_id = cr.course_run_id
      WHERE da.calendar_added = true
        AND da.updated_at >= NOW() - INTERVAL '7 days'
        AND da.enrolment_status = 'Confirmed'
    `);

    const falsePositives: any[] = [];
    const valid: any[] = [];

    for (const row of result.rows) {
      // 1. Get dates for the course session
      const sessionRes = await pool.query(
        `SELECT start_date FROM course_session WHERE course_run_id = $1 ORDER BY start_date ASC`,
        [row.internal_run_id]
      );
      
      let datesToSync: string[] = [];
      
      if (sessionRes.rows.length > 0) {
        datesToSync = sessionRes.rows
          .filter(r => r.start_date && !isNaN(new Date(r.start_date).getTime()))
          .map(r => getLocalYMD(new Date(r.start_date)));
      } 
      
      if (datesToSync.length === 0 && row.course_start_date) {
        const bd = new Date(row.course_start_date);
        if (!isNaN(bd.getTime())) {
           datesToSync = [getLocalYMD(bd)];
        }
      }
      
      if (datesToSync.length === 0) {
          falsePositives.push({ ...row, reason: "No valid sessions or fallback date found" });
          continue;
      }
      
      const sortedDates = [...new Set(datesToSync)].sort();
      
      const minD = new Date(sortedDates[0] + 'T00:00:00Z');
      minD.setDate(minD.getDate() - 3); 
      const maxD = new Date(sortedDates[sortedDates.length - 1] + 'T23:59:59Z');
      maxD.setDate(maxD.getDate() + 3);

      const eventsResponse = await calendar.events.list({
        calendarId, timeMin: minD.toISOString(), timeMax: maxD.toISOString(), singleEvents: true, maxResults: 1000,
      });
      const allEvents = eventsResponse.data.items || [];
      
      const learnerEmailLower = (row.trainee_email || '').trim().toLowerCase();
      const strippedCourseTitle = stripPrefixes(row.course_title || '').toLowerCase();

      let foundInAnyEvent = false;

      for (let i = 0; i < sortedDates.length; i++) {
          const targetDate = sortedDates[i];
          const dayNumber = i + 1;

          const dateAndTitleMatches = allEvents.filter(evt => {
              const evtTitleNormalized = stripPrefixes(evt.summary || '');
              const titleMatch = evtTitleNormalized.includes(strippedCourseTitle) || strippedCourseTitle.includes(evtTitleNormalized);
              if (!titleMatch) return false;
              const evtDate = (evt.start?.dateTime?.slice(0, 10) || evt.start?.date || '');
              return evtDate === targetDate;
          });

          const expectedDayRegex = new RegExp(`\\bday\\s*[-:]?\\s*${dayNumber}\\b`, 'i');
          const strictDayMatches = dateAndTitleMatches.filter(evt => expectedDayRegex.test((evt.summary || '').toLowerCase()));
          
          const matchedEvents = strictDayMatches.length > 0 ? strictDayMatches : dateAndTitleMatches;
          
          for (const evt of matchedEvents) {
              const attendees = evt.attendees || [];
              if (attendees.some(a => (a.email || '').toLowerCase() === learnerEmailLower)) {
                  foundInAnyEvent = true;
                  break;
              }
          }
      }

      if (!foundInAnyEvent) {
          falsePositives.push(row);
      } else {
          valid.push(row);
      }
    }

    if (req.query.fix === 'true' && falsePositives.length > 0) {
      const ids = falsePositives.map(fp => fp.id).filter(Boolean);
      await pool.query(`UPDATE da_application SET calendar_added = false WHERE id = ANY($1::uuid[])`, [ids]);
    }

    res.status(200).json({
      checked: result.rows.length,
      valid_count: valid.length,
      false_positives_count: falsePositives.length,
      false_positives: falsePositives,
      message: req.query.fix === 'true' ? "Fixed false positives." : "Run with ?fix=true to fix"
    });
  } catch (error: any) {
    res.status(500).json({ error: error.message, stack: error.stack });
  }
}

export default withAuth(handler, { roles: ['admin', 'trainingProvider', 'developer'] });
