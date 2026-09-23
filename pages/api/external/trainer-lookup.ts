import type { NextApiRequest, NextApiResponse } from 'next';
import { getCalendarReadClient } from '../../../lib/calendar/calendarClient';
import { resolveTrainerByCourseCode } from '../../../lib/calendar/resolveTrainerByCourseCode';
import { isIsoDate, normalizeSgPhone } from '../../../lib/calendar/reminderEligibilityRules';
import { ReminderSourceUnavailableError } from '../../../lib/calendar/readReminderEvents';

/** Exact course-code/date lookup; only a uniquely verified accepted Calendar guest is returned.
 * course_title is retained as an optional compatibility parameter, never used for fuzzy matching.
 */
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
  if (typeof course_code !== 'string' || !isIsoDate(date)) {
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
    const phone = normalizeSgPhone(result.trainer?.phone);

    console.log(`external/trainer-lookup: ${result.source} for course_code=${course_code} date=${date} (caller ${callerIp})`);

    return res.status(200).json({
      source: result.source,
      trainer: result.trainer
        ? { trainer_id: result.trainer.user_id, name: result.trainer.name, email: result.trainer.email, phone_e164: phone }
        : null,
      ...(result.candidates ? { candidates: result.candidates.map(t => ({ user_id: t.user_id, name: t.name, email: t.email })) } : {}),
      calendar_event_url: result.calendarEventUrl,
      admin_note: result.adminNote ?? null,
    });
  } catch (error) {
    console.error('external/trainer-lookup error:', error);
    return res.status(error instanceof ReminderSourceUnavailableError ? 503 : 500).json({ error: { code: 'source_verification_failed', message: 'Cannot verify Calendar trainer.' } });
  }
}
