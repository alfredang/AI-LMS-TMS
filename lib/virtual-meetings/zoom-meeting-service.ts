import pool from '../db';
import { createZoomMeeting, ensureZoomColumns } from '../zoom/client';

function parseDateTime(dateValue?: string | Date | null, timeValue?: string | null): Date {
  const datePart = dateValue
    ? (dateValue instanceof Date ? dateValue.toISOString().slice(0, 10) : String(dateValue).slice(0, 10))
    : new Date().toISOString().slice(0, 10);
  const timePart = timeValue && /^\d{1,2}:\d{2}/.test(timeValue) ? timeValue.slice(0, 5) : '09:00';
  return new Date(`${datePart}T${timePart}:00+08:00`);
}

function minutesBetween(start: Date, end: Date): number {
  const diff = Math.round((end.getTime() - start.getTime()) / 60000);
  return diff > 0 ? diff : 60;
}

export async function createZoomMeetingForCourseRun(courseRunUuid: string, options: { force?: boolean } = {}) {
  await ensureZoomColumns();

  const runResult = await pool.query(
    `SELECT
       cr.id,
       cr.course_run_id,
       cr.start_date,
       cr.end_date,
       cr.class_type,
       cr.virtual_meeting_external_id,
       cr.virtual_meeting_link,
       c.title AS course_title,
       c.course_code
     FROM course_run cr
     JOIN course c ON c.id = cr.course_id
     WHERE cr.id = $1
     LIMIT 1`,
    [courseRunUuid]
  );

  const run = runResult.rows[0];
  if (!run) throw new Error('Course run not found.');

  if (!options.force && run.virtual_meeting_external_id && run.virtual_meeting_link) {
    return {
      reused: true,
      meeting: {
        id: run.virtual_meeting_external_id,
        join_url: run.virtual_meeting_link,
      },
    };
  }

  const sessionResult = await pool.query(
    `SELECT start_date, end_date, start_time, end_time
     FROM course_session
     WHERE course_run_id = $1
       AND COALESCE(deleted, false) = false
     ORDER BY start_date NULLS LAST, start_time NULLS LAST
     LIMIT 1`,
    [courseRunUuid]
  );
  const session = sessionResult.rows[0] || {};

  const start = parseDateTime(session.start_date || run.start_date, session.start_time);
  const end = parseDateTime(session.end_date || session.start_date || run.end_date || run.start_date, session.end_time || '10:00');
  const duration = minutesBetween(start, end);
  const topic = `${run.course_title || 'Course'} (${run.course_run_id || run.course_code || 'Course Run'})`;

  const meeting = await createZoomMeeting({
    topic,
    type: 2,
    start_time: start.toISOString(),
    duration,
    timezone: 'Asia/Singapore',
    settings: {
      join_before_host: false,
      waiting_room: true,
      approval_type: 2,
      registrants_email_notification: false,
    },
  });

  await pool.query(
    `UPDATE course_run
     SET virtual_meeting_provider = 'zoom',
         virtual_meeting_external_id = $1,
         virtual_meeting_link = $2,
         virtual_meeting_host_link = $3,
         virtual_meeting_password = $4,
         virtual_meeting_status = 'created',
         virtual_meeting_synced_at = NOW(),
         updated_at = NOW()
     WHERE id = $5`,
    [
      meeting.id ? String(meeting.id) : null,
      meeting.join_url || null,
      meeting.start_url || null,
      meeting.password || null,
      courseRunUuid,
    ]
  );

  return { reused: false, meeting };
}
