import type { NextApiRequest, NextApiResponse } from 'next';
import pool from '../../../lib/db';
import { queueClassReminderWhatsApp } from '../../../lib/trainerWhatsapp';
import { getTrainerReminderSnapshot, ReminderSourceUnavailableError } from '../../../lib/calendar/trainerReminderService';
import { reminderSessionToApi } from '../../../lib/calendar/trainerReminderSnapshot';
import { normalizeSgPhone, sgtDate } from '../../../lib/calendar/reminderEligibilityRules';

export async function runAutomation(options: { dryRun?: boolean; now?: Date } = {}) {
  const configured = (await pool.query("SELECT days_in_advance FROM scheduler_config WHERE id='auto_queue_class_reminder_whatsapp' LIMIT 1")).rows[0]?.days_in_advance;
  const daysInAdvance = configured == null ? 3 : Number(configured);
  if (!Number.isInteger(daysInAdvance) || daysInAdvance < 0 || daysInAdvance > 365) throw new Error('Invalid reminder lead time');
  const targetDate = sgtDate(options.now, daysInAdvance);
  const snapshot = await getTrainerReminderSnapshot(targetDate, targetDate, { now: options.now });
  const summary = {
    runId: `class_reminder_wa_${Date.now()}`, startedAt: new Date().toISOString(), daysInAdvance, targetDate,
    dryRun: !!options.dryRun, classes: snapshot.rows.length, queued: 0, wouldQueue: 0,
    skippedDuplicates: 0, skippedAcknowledgedSessions: 0, skippedAcknowledgedTgs: 0, noPhone: 0, errors: 0,
    details: [] as Array<{ courseRunId: string | null; sessionDate: string; calendarEventId: string | null; trainer: string | null; result: string }>,
  };
  const baseUrl = process.env.NEXT_PUBLIC_BASE_URL || process.env.NEXT_PUBLIC_APP_URL || 'https://lms-tms.tertiaryinfotech.com';
  for (const row of snapshot.rows) {
    let result = row.decision.reason;
    const trainer = row.decision.recipient;
    if (row.decision.eligible && trainer && row.run && row.eventId) {
      const api = reminderSessionToApi(row, snapshot.fetchedAt, snapshot.calendarId, baseUrl);
      const message = `Dear ${trainer.name}\nThis is a gentle reminder for your upcoming training below.\n\n` +
        `Course Title: ${api.course_title}\nCourse Code: ${api.course_code || 'N/A'}\nCourse Run ID: ${api.course_run_id}\n` +
        `Session Date: ${api.session_date}\nRun Start Date: ${api.run_start_date}\nRun End Date: ${api.run_end_date}\n` +
        `Course Duration: ${api.duration_label}\nMode of Training: ${api.mode_of_training || 'N/A'}\n` +
        (api.is_virtual ? `Meeting: ${api.google_meet_url || 'See LMS'}\n` : `Venue: ${api.venue || 'See LMS'}\n`) +
        `\nTo view E-Attendance and course-related materials, please log in below:\n${api.lms_login_url}\n\nTraining Admin, Tertiary Infotech Academy`;
      result = options.dryRun ? 'would_queue' : await queueClassReminderWhatsApp({
        courseRunUuid: row.runUuid!, sessionDate: row.sessionDate, calendarEventId: row.eventId,
        trainerUserId: trainer.user_id, trainerName: trainer.name || trainer.email, trainerEmail: trainer.email,
        trainerEmails: trainer.emails, trainerPhone: normalizeSgPhone(trainer.phone), message,
      });
    }
    if (result === 'queued') summary.queued++;
    if (result === 'would_queue') summary.wouldQueue++;
    if (['skipped_duplicate', 'already_queued', 'already_sent', 'previous_reminder_requires_review'].includes(result)) summary.skippedDuplicates++;
    if (result === 'trainer_accepted_this_session') summary.skippedAcknowledgedSessions++;
    if (result === 'no_usable_phone') summary.noPhone++;
    if (result === 'error') summary.errors++;
    summary.details.push({ courseRunId: row.run?.courseRunId || null, sessionDate: row.sessionDate, calendarEventId: row.eventId, trainer: trainer?.name || row.resolution.trainer?.name || null, result });
  }
  // Deprecated compatibility counter: now counts exact sessions, never TGS-wide acknowledgements.
  summary.skippedAcknowledgedTgs = summary.skippedAcknowledgedSessions;
  return summary;
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') return res.status(405).json({ success: false, error: 'Method not allowed' });
  const validKey = process.env.EXTERNAL_API_KEY_FOR_CLAWDBOT;
  if (!validKey) return res.status(500).json({ success: false, error: 'API key not configured' });
  if (req.headers['x-api-key'] !== validKey) return res.status(401).json({ success: false, error: 'Unauthorized' });
  try {
    return res.status(200).json({ success: true, ...await runAutomation({ dryRun: req.query.dry_run === 'true' }) });
  } catch (error) {
    console.error('class reminder source verification failed', error);
    return res.status(error instanceof ReminderSourceUnavailableError ? 503 : 500).json({ success: false, error: 'Reminder sources could not be verified; no release authorised.' });
  }
}
