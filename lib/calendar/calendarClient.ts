import { google, calendar_v3 } from 'googleapis';
import pool from '../db';
import { getGoogleCredentials } from '../google-auth/googleAuth';
import { calendarWritesAllowed } from './calendarGuard';

export interface CalendarClient {
  calendar: calendar_v3.Calendar;
  calendarId: string;
}

/**
 * Build an authenticated Google Calendar client for the (single-tenant) training
 * provider, resolving the target calendarId from `training_provider.google_calendar_url`.
 *
 * Returns null when `sync_google_calendar` is disabled, so callers can no-op cleanly.
 * Extracted verbatim from addTrainerToCalendar / ca-/da-calendar-sync (was duplicated 3x).
 */
async function buildCalendarClient(): Promise<CalendarClient | null> {
  const tp = (await pool.query(
    `SELECT sync_google_calendar, google_calendar_url FROM training_provider LIMIT 1`
  )).rows[0];
  if (!tp?.sync_google_calendar) return null;

  let calendarId = 'primary';
  const calUrl = tp.google_calendar_url || '';
  if (calUrl) {
    const cidMatch = calUrl.match(/[?&]cid=([^&]+)/);
    if (cidMatch) {
      try { calendarId = Buffer.from(cidMatch[1], 'base64').toString('utf-8'); }
      catch { calendarId = cidMatch[1]; }
    } else if (calUrl.includes('@')) {
      calendarId = calUrl;
    }
  }

  const credentials = await getGoogleCredentials(pool);
  const oauth = new google.auth.OAuth2(
    credentials.clientId,
    credentials.clientSecret,
    'https://developers.google.com/oauthplayground'
  );
  oauth.setCredentials({ refresh_token: credentials.refreshToken });
  const calendar = google.calendar({ version: 'v3', auth: oauth });

  return { calendar, calendarId };
}

export async function getCalendarClient(): Promise<CalendarClient | null> {
  // Hard environment guard: never WRITE to the (prod) calendar from a non-prod process.
  if (!calendarWritesAllowed()) return null;
  return buildCalendarClient();
}

/**
 * Read-only calendar client. Identical to `getCalendarClient()` but **not** gated
 * by `calendarWritesAllowed()`, because reads (events.list / events.get) are
 * non-mutating and safe in any environment — including local dev pointed at a
 * test calendar. Use this ONLY for reads; NEVER for insert/patch/delete.
 */
export async function getCalendarReadClient(): Promise<CalendarClient | null> {
  return buildCalendarClient();
}
