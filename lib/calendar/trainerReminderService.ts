import pool from '../db';
import { getCalendarReadClient } from './calendarClient';
import { loadTrainerDirectory } from './resolveTrainerFromCalendar';
import { buildReminderSnapshot, type ReminderRun, type ReminderSnapshotInput } from './trainerReminderSnapshot';
import { type EventMapping } from './eventRunRules';
import { isIsoDate, sgtDate, type QueuedReminder } from './reminderEligibilityRules';

import { readReminderEvents, ReminderSourceUnavailableError } from './readReminderEvents';
export { ReminderSourceUnavailableError } from './readReminderEvents';

export async function readCalendarWindow(start: string, end: string) {
  const client = await getCalendarReadClient();
  if (!client) throw new ReminderSourceUnavailableError('Google Calendar is unavailable.');
  const events = await readReminderEvents({
    list: params => client.calendar.events.list(params),
    get: params => client.calendar.events.get(params),
  }, client.calendarId, start, end);
  return { events, calendarId: client.calendarId };
}

export async function loadReminderRuns(start: string, end: string): Promise<ReminderRun[]> {
  const rows = (await pool.query(`
    SELECT cr.*, cr.start_date::date::text AS start_iso, cr.end_date::date::text AS end_iso,
           c.course_code, c.title AS course_title, c.num_of_days,
           (SELECT count(*)::int FROM enrollment e WHERE e.course_run_id=cr.id) AS learner_count,
           (SELECT COALESCE(json_agg(json_build_object('user_id',t.trainer_id,'email',t.trainer_email,'name',t.trainer_name)), '[]'::json)
              FROM course_run_trainer t WHERE t.course_run_id=cr.id) AS assignments,
           (SELECT COALESCE(json_agg(json_build_object('date',cs.start_date::date::text,'trainer_id',cs.trainer_id)), '[]'::json)
              FROM course_session cs WHERE cs.course_run_id=cr.id AND NOT COALESCE(cs.deleted,false) AND cs.start_date IS NOT NULL AND cs.start_date <> '') AS sessions
      FROM course_run cr JOIN course c ON c.id=cr.course_id
     WHERE cr.end_date >= ($1::date - interval '30 days') AND cr.start_date <= ($2::date + interval '30 days')
     ORDER BY cr.start_date, cr.course_run_id`, [start, end])).rows;
  return rows.map(r => ({
    runUuid: r.id, courseRunId: r.course_run_id, courseCode: r.course_code, courseTitle: r.course_title,
    startDate: r.start_iso, endDate: r.end_iso, modeOfLearning: r.mode_of_learning,
    sessionDates: [...new Set<string>((r.sessions || []).map((s: { date: string }) => s.date))],
    classStatus: r.class_status, assignments: r.assignments || [], sessions: r.sessions || [],
    details: { ...r, session_days: new Set((r.sessions || []).map((s: { date: string }) => s.date)).size },
  }));
}

export async function loadReminderQueue(start: string, end: string): Promise<QueuedReminder[]> {
  const exists = (await pool.query("SELECT to_regclass('trainer_whatsapp_notification') AS name")).rows[0]?.name;
  if (!exists) return [];
  // to_jsonb allows read-only previews before the additive queue-column migration is applied.
  return (await pool.query(`
    SELECT n.id, n.course_run_id AS "runUuid", to_jsonb(n)->>'session_date' AS "sessionDate",
           to_jsonb(n)->>'calendar_event_id' AS "eventId", to_jsonb(n)->>'trainer_user_id' AS "trainerUserId",
           n.trainer_email AS "trainerEmail", n.trainer_phone AS "trainerPhone", n.status, cr.start_date::date::text AS "runStartDate"
      FROM trainer_whatsapp_notification n JOIN course_run cr ON cr.id=n.course_run_id
     WHERE n.kind='class_reminder'
       AND COALESCE(to_jsonb(n)->>'session_date',cr.start_date::date::text) BETWEEN $1 AND $2`, [start, end])).rows;
}

export async function getTrainerReminderSnapshot(start: string, end: string, options: { now?: Date; ignoreNotificationId?: string } = {}) {
  if (!isIsoDate(start) || !isIsoDate(end) || end < start) throw new Error('Invalid session-date range');
  const [calendar, runs, directory, queue] = await Promise.all([
    readCalendarWindow(start, end), loadReminderRuns(start, end), loadTrainerDirectory(), loadReminderQueue(start, end),
  ]);
  const ids = calendar.events.flatMap(e => e.id ? [e.id] : []);
  const mappings = ids.length ? (await pool.query<EventMapping>(
    'SELECT google_event_id, course_run_id, event_date::date::text AS event_date FROM course_run_calendar_event WHERE google_event_id=ANY($1::text[])', [ids],
  )).rows : [];
  const input: ReminderSnapshotInput = { ...calendar, runs, directory, queue, mappings, start, end, today: sgtDate(options.now), ignoreNotificationId: options.ignoreNotificationId };
  return { rows: buildReminderSnapshot(input), input, calendarId: calendar.calendarId, fetchedAt: new Date().toISOString() };
}
