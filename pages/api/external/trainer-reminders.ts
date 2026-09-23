import type { NextApiRequest, NextApiResponse } from 'next';
import pool from '../../../lib/db';
import { getTrainerReminderSnapshot, ReminderSourceUnavailableError } from '../../../lib/calendar/trainerReminderService';
import { reminderSessionToApi } from '../../../lib/calendar/trainerReminderSnapshot';
import { isIsoDate } from '../../../lib/calendar/reminderEligibilityRules';

/** Read-only Calendar session report. Queue and dispatch use the same decision function. */
export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, x-api-key, Authorization');
  res.setHeader('Cache-Control', 'no-store');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET') return res.status(405).json({ error: { code: 'method_not_allowed' } });
  const key = req.headers['x-api-key'] || (req.headers.authorization?.startsWith('Bearer ') ? req.headers.authorization.slice(7) : null);
  const validKey = process.env.EXTERNAL_API_KEY_FOR_CLAWDBOT;
  if (!validKey) return res.status(500).json({ error: { code: 'api_key_not_configured' } });
  if (key !== validKey) return res.status(401).json({ error: { code: 'unauthorized' } });
  try {
    const runId = typeof req.query.course_run_id === 'string' ? req.query.course_run_id : null;
    let start = req.query.session_date || req.query.start_date;
    let end = req.query.session_date || req.query.end_date;
    if (runId && !start && !end) {
      const runs = (await pool.query('SELECT start_date::date::text AS start, end_date::date::text AS end FROM course_run WHERE course_run_id=$1', [runId])).rows;
      if (!runs.length) return res.status(404).json({ error: { code: 'not_found' } });
      if (runs.length !== 1 || runs[0].start !== runs[0].end) return res.status(400).json({ error: { code: 'session_date_required', message: 'Specify session_date for a multi-day or ambiguous run.' } });
      start = runs[0].start; end = runs[0].end;
    }
    if (!isIsoDate(start) || !isIsoDate(end) || end < start || Date.parse(end) - Date.parse(start) > 366 * 86400000) {
      return res.status(400).json({ error: { code: 'validation_error', message: 'Provide a valid session_date or start_date/end_date range of at most 367 days.' } });
    }
    const snapshot = await getTrainerReminderSnapshot(start, end);
    let rows = snapshot.rows.map(row => reminderSessionToApi(row, snapshot.fetchedAt, snapshot.calendarId, process.env.NEXT_PUBLIC_BASE_URL || ''));
    if (runId) rows = rows.filter(r => r.course_run_id === runId);
    // Status filters affect display only; all operational candidates participated in matching.
    if (req.query.status && req.query.status !== 'all') rows = rows.filter(r => r.status === req.query.status);
    if (req.query.include_virtual === 'false') rows = rows.filter(r => !r.is_virtual);
    if (req.query.include_external === 'false') rows = rows.filter(r => !r.is_external);
    if (req.query.send_reminder === 'true') rows = rows.filter(r => r.send_reminder);
    if (runId) {
      if (!rows.length) return res.status(404).json({ error: { code: 'no_verified_calendar_session' } });
      if (rows.length !== 1) return res.status(409).json({ error: { code: 'multiple_sessions', message: 'Specify a single session_date.' } });
      return res.status(200).json(rows[0]);
    }
    return res.status(200).json(rows);
  } catch (error) {
    console.error('trainer-reminders source verification failed', error);
    return res.status(error instanceof ReminderSourceUnavailableError ? 503 : 500).json({ error: { code: 'source_verification_failed', message: 'Reminder sources could not be verified.' } });
  }
}
