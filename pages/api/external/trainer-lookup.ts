import type { NextApiRequest, NextApiResponse } from 'next';
import pool from '../../../lib/db';
import { getCalendarReadClient } from '../../../lib/calendar/calendarClient';
import { resolveTrainerByCourseCode } from '../../../lib/calendar/resolveTrainerByCourseCode';

/**
 * External API — Trainer Lookup by Course Code (Google Calendar cross-reference)
 *
 * GET /api/external/trainer-lookup?course_code=<code>&date=YYYY-MM-DD&course_title=<optional>
 *
 * Headers:
 *   x-api-key: <EXTERNAL_API_KEY_FOR_CLAWDBOT>  (same shared key as /api/external/trainer-reminders
 *   and /api/external/course-runs — ai-mms already has this configured under
 *   mmd/trainer_import/api_key, no new secret to provision)
 *
 * Purpose-built for ai-mms's /courses/api_reminders trainer-lookup fallback, opt-in there via
 * ?use_lms_trainer_lookup=1. Resolves a trainer for courses that have NO LMS course_run at all
 * (MMS-only, typically non-WSQ) — something the existing exact-SKU LMS-TMS fallback in MMS can
 * never do, since it only matches SKUs that already have a matching LMS course_run. This instead
 * goes straight to the shared Google Calendar: finds the event on `date` matching `course_code`
 * (falling back to a fuzzy title match against `course_title` if provided) and cross-references
 * its attendees against LMS's Trainer role — the same technique already proven for LMS's own
 * trainer-reminders endpoint. See lib/calendar/resolveTrainerByCourseCode.ts.
 *
 * `source` in the response:
 *   gcal_role_match  — exactly one Trainer-role attendee on the matched event (confident match)
 *   ambiguous        — event found, 2+ Trainer-role attendees, couldn't disambiguate — see `candidates`
 *   not_found        — event found, but no attendee is a known LMS Trainer-role account
 *   event_not_found  — no (or multiple, indistinguishable) calendar event matched course_code+date
 * `ambiguous`, `not_found`, and `event_not_found` all set `admin_note` with specifics.
 */

async function lookupTrainerPhone(userId: string | null): Promise<string | null> {
  if (!userId) return null;
  const row = (await pool.query<{ tel: string | null }>(
    `SELECT tel FROM trainer_profile WHERE user_id = $1 LIMIT 1`,
    [userId]
  )).rows[0];
  return row?.tel ?? null;
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, x-api-key, Authorization');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET') return res.status(405).json({ error: { code: 'method_not_allowed', message: 'Method not allowed' } });

  const apiKey = req.headers['x-api-key'] || (req.headers.authorization?.startsWith('Bearer ') ? req.headers.authorization.slice(7) : null);
  const validKey = process.env.EXTERNAL_API_KEY_FOR_CLAWDBOT;
  const callerIp = req.headers['x-forwarded-for'] || req.socket.remoteAddress || 'unknown';
  if (!validKey) return res.status(500).json({ error: { code: 'internal_error', message: 'API key not configured on server' } });
  if (!apiKey || apiKey !== validKey) {
    console.warn(`external/trainer-lookup: 401 from ${callerIp}`);
    return res.status(401).json({ error: { code: 'unauthorized', message: 'Invalid or missing API key' } });
  }

  const { course_code, date, course_title } = req.query;
  if (!course_code || !date) {
    return res.status(400).json({ error: { code: 'validation_error', message: 'course_code and date are required (date=YYYY-MM-DD)' } });
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(date))) {
    return res.status(400).json({ error: { code: 'validation_error', message: 'date must be YYYY-MM-DD' } });
  }

  try {
    const calendarClient = await getCalendarReadClient();
    if (!calendarClient) {
      console.error('external/trainer-lookup: calendar unavailable, failing request');
      return res.status(503).json({
        error: {
          code: 'calendar_unavailable',
          message: 'Google Calendar sync is required for this endpoint and is not currently available.',
        },
      });
    }

    const result = await resolveTrainerByCourseCode(
      calendarClient,
      String(course_code),
      String(date),
      course_title ? String(course_title) : null
    );
    const phone = await lookupTrainerPhone(result.trainer?.user_id ?? null);

    console.log(`external/trainer-lookup: ${result.source} for course_code=${course_code} date=${date} (caller ${callerIp})`);

    return res.status(200).json({
      source: result.source,
      trainer: result.trainer
        ? { trainer_id: result.trainer.user_id, name: result.trainer.name, email: result.trainer.email, phone_e164: phone }
        : null,
      ...(result.candidates ? { candidates: result.candidates } : {}),
      calendar_event_url: result.calendarEventUrl,
      admin_note: result.adminNote ?? null,
    });
  } catch (error) {
    console.error('external/trainer-lookup error:', error);
    return res.status(500).json({ error: { code: 'internal_error', message: 'Internal server error' } });
  }
}
