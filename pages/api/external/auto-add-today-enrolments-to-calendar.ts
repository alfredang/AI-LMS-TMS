import type { NextApiRequest, NextApiResponse } from 'next';
import { google } from 'googleapis';
import pool from '../../../lib/db';
import { createSSGEnrolmentAPI } from '../../../lib/ssg/api/enrolment-api';
import { getSSGCredentialsService } from '../../../lib/ssg/services/credentials-service';
import { getGoogleCredentials } from '../../../lib/google-auth/googleAuth';
import { getTrainingPartnerIdentifiers } from '../../../lib/trainingPartnerIdentifiers';

/**
 * Scheduler endpoint: pulls today's (SGT) SSG enrolments, then for each
 * Confirmed enrolment whose class has a Google Calendar event but whose
 * learner email is not yet an attendee, add the email to the event.
 */

function stripPrefixes(title: string): string {
  return (title || '')
    .replace(/^\s*\[?(WSQ|VIRTUAL|EXTERNAL|HYBRID)\]?\s*/gi, '')
    .replace(/^\s*\[?(WSQ|VIRTUAL|EXTERNAL|HYBRID)\]?\s*/gi, '')
    .trim();
}

function sgtDate(iso?: string | null): string {
  if (!iso) return '';
  const d = new Date(iso);
  return new Date(d.getTime() + 8 * 3600 * 1000).toISOString().slice(0, 10);
}

function normDate(v: any): string | null {
  if (!v) return null;
  const s = String(v);
  if (/^\d{8}$/.test(s)) return `${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)}`;
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10);
  return null;
}

// ── Global in-flight lock ─────────────────────────────────────────────────────
const gCal = globalThis as unknown as { __addTodayCalRunning?: boolean };
if (gCal.__addTodayCalRunning === undefined) gCal.__addTodayCalRunning = false;

export async function runAutomation(): Promise<{
  success: boolean;
  pulled: number;
  confirmedToday: number;
  added: number;
  alreadyAttendee: number;
  noEvent: number;
  errors: number;
}> {
  if (gCal.__addTodayCalRunning) {
    console.warn('[auto-add-today-enrolments-to-calendar] Another run is already in progress — skipping');
    return { success: false, pulled: 0, confirmedToday: 0, added: 0, alreadyAttendee: 0, noEvent: 0, errors: 0 };
  }
  gCal.__addTodayCalRunning = true;
  try {
    return await _runAutomationInner();
  } finally {
    gCal.__addTodayCalRunning = false;
  }
}

async function _runAutomationInner(): Promise<{
  success: boolean;
  pulled: number;
  confirmedToday: number;
  added: number;
  alreadyAttendee: number;
  noEvent: number;
  errors: number;
}> {
  // 1) Pull today's (SGT) enrolments from SSG and upsert into ssg_enrolment_record
  const credentials = await getSSGCredentialsService().getSSGCredentials();
  if (!credentials) throw new Error('SSG credentials not found');

  const tp = await getTrainingPartnerIdentifiers();
  const api = createSSGEnrolmentAPI(process.env.SSG_API_URL || 'https://api.ssg-wsg.sg', credentials);
  const todaySgt = new Date(new Date().getTime() + 8 * 3600 * 1000).toISOString().slice(0, 10);
  const dateCompact = todaySgt.replace(/-/g, '');

  const result = await api.searchEnrolment({
    meta: { enrolmentDate: dateCompact },
    parameters: { page: 0, pageSize: 100 },
    enrolment: {
      trainingPartner: { uen: tp.uen || credentials.uen, code: tp.code },
    },
  } as any);

  if (result.error) {
    throw new Error(`SSG error: ${result.error.message}`);
  }
  const rawItems: any[] = Array.isArray(result.data) ? result.data : [];

  for (const item of rawItems) {
    const enr = item?.enrolment ?? item;
    const ref = enr?.referenceNumber;
    if (!ref) continue;
    try {
      await pool.query(
        `INSERT INTO ssg_enrolment_record
          (enrolment_reference, enrolment_date, learner_name, learner_nric, learner_email,
           course_title, course_ref_code, course_run_id, start_date, status, raw_data)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
         ON CONFLICT (enrolment_reference) DO UPDATE SET
           status = EXCLUDED.status,
           raw_data = EXCLUDED.raw_data`,
        [
          ref,
          normDate(enr?.trainee?.enrolmentDate) || normDate(item?.meta?.createdOn),
          enr?.trainee?.fullName || enr?.trainee?.name || null,
          enr?.trainee?.id || null,
          enr?.trainee?.email?.full || enr?.trainee?.email || null,
          enr?.course?.title || null,
          enr?.course?.referenceNumber || null,
          enr?.course?.run?.id || null,
          normDate(enr?.course?.run?.startDate),
          enr?.status || null,
          JSON.stringify(item),
        ]
      );
    } catch (e: any) {
      console.warn(`[auto-add-today-cal] upsert failed for ${ref}: ${e.message}`);
    }
  }

  // 2) Pull Confirmed today records from local staging table
  const rows = (await pool.query(
    `SELECT enrolment_reference, learner_name, learner_email, course_title,
            course_ref_code, course_run_id, start_date, status
     FROM ssg_enrolment_record
     WHERE enrolment_date = $1::date
       AND status = 'Confirmed'`,
    [todaySgt]
  )).rows;

  if (rows.length === 0) {
    console.log(`📅 [auto-add-today-cal] No confirmed enrolments today (SGT ${todaySgt})`);
    return { success: true, pulled: rawItems.length, confirmedToday: 0, added: 0, alreadyAttendee: 0, noEvent: 0, errors: 0 };
  }

  // 3) Google Calendar client
  const tpRes = await pool.query(`SELECT sync_google_calendar, google_calendar_url FROM training_provider LIMIT 1`);
  const tpRow = tpRes.rows[0];
  if (!tpRow?.sync_google_calendar) throw new Error('Google Calendar sync not enabled');
  const gcred = await getGoogleCredentials(pool);
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
  const oauth2 = new google.auth.OAuth2(gcred.clientId, gcred.clientSecret, 'https://developers.google.com/oauthplayground');
  oauth2.setCredentials({ refresh_token: gcred.refreshToken });
  const calendar = google.calendar({ version: 'v3', auth: oauth2 });

  const startDates = rows.map(r => sgtDate(r.start_date)).filter(Boolean).sort();
  const minD = new Date(startDates[0]); minD.setDate(minD.getDate() - 1);
  const maxD = new Date(startDates[startDates.length - 1]); maxD.setDate(maxD.getDate() + 2);

  const evts = await calendar.events.list({
    calendarId, timeMin: minD.toISOString(), timeMax: maxD.toISOString(),
    singleEvents: true, maxResults: 2500,
  });
  const events = evts.data.items || [];

  // 4) For each confirmed row, patch the matching event to add the learner email
  let added = 0, alreadyAttendee = 0, noEvent = 0, errors = 0;
  for (const r of rows) {
    const email = (r.learner_email || '').trim();
    if (!email || !r.course_title) { noEvent++; continue; }
    const startIso = sgtDate(r.start_date);
    const stripped = stripPrefixes(r.course_title).toLowerCase();
    const evt = events.find(e => {
      const t = stripPrefixes(e.summary || '').toLowerCase();
      if (!(t.includes(stripped) || stripped.includes(t))) return false;
      const ed = e.start?.dateTime?.slice(0, 10) || e.start?.date || '';
      return ed === startIso;
    });
    if (!evt || !evt.id) { noEvent++; continue; }
    const existing = evt.attendees || [];
    if (existing.some(a => (a.email || '').toLowerCase() === email.toLowerCase())) {
      alreadyAttendee++;
      continue;
    }
    try {
      await calendar.events.patch({
        calendarId, eventId: evt.id,
        requestBody: { attendees: [...existing, { email, responseStatus: 'needsAction' }] },
        sendUpdates: 'none',
      });
      console.log(`📅 [auto-add-today-cal] +${email} → "${evt.summary}" (${startIso})`);
      added++;
    } catch (e: any) {
      console.error(`[auto-add-today-cal] patch failed for ${r.enrolment_reference}: ${e.message}`);
      errors++;
    }
  }

  console.log(`📋 [auto-add-today-cal] Done: pulled=${rawItems.length}, confirmedToday=${rows.length}, added=${added}, alreadyAttendee=${alreadyAttendee}, noEvent=${noEvent}, errors=${errors}`);
  return { success: true, pulled: rawItems.length, confirmedToday: rows.length, added, alreadyAttendee, noEvent, errors };
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const apiKey = req.headers['x-api-key'] || req.query.apiKey;
  const expectedKey = process.env.EXTERNAL_API_KEY_FOR_CLAWDBOT;
  if (expectedKey && apiKey !== expectedKey && !req.headers['x-internal-scheduler']) {
    return res.status(401).json({ success: false, error: 'Unauthorized' });
  }
  try {
    const result = await runAutomation();
    return res.status(200).json(result);
  } catch (err) {
    console.error('❌ auto-add-today-enrolments-to-calendar error:', err);
    return res.status(500).json({
      success: false,
      error: err instanceof Error ? err.message : 'Internal server error',
    });
  }
}
