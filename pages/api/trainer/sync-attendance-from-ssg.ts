import { withAuth } from '@lib/auth/withAuth';
import type { NextApiRequest, NextApiResponse } from 'next';
import pool from '../../../lib/db';
import { createSSGCourseAPI } from '../../../lib/ssg/api/course-api';
import { createSSGAttendanceAPI } from '../../../lib/ssg/api/attendance-api';
import { getSSGCredentialsService } from '../../../lib/ssg/services/credentials-service';
import { extractRecordsFromViewAttendance, normalizeAttendanceRecord } from '../../../lib/ssg/utils/attendance-decrypt';

/**
 * POST /api/trainer/sync-attendance-from-ssg
 * Body: { courseRunId: string (UUID) }
 *
 * Pulls the latest sessions + attendance for a single course run from SSG and
 * upserts into course_session / course_attendance. Used by the trainer's
 * Past Attendance refresh button.
 */

const RATE_LIMIT_MS = 1500;
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ success: false, error: 'Method not allowed. Use POST.' });
  }

  const body = typeof req.body === 'string' ? JSON.parse(req.body) : (req.body || {});
  const courseRunId: string | undefined = body.courseRunId;
  if (!courseRunId) {
    return res.status(400).json({ success: false, error: 'courseRunId is required' });
  }

  // Look up SSG run code and course code
  const lookup = await pool.query(
    `SELECT cr.id AS uuid, cr.course_run_id AS ssg_run_id, c.course_code
     FROM course_run cr
     JOIN course c ON c.id = cr.course_id
     WHERE cr.id = $1
     LIMIT 1`,
    [courseRunId]
  );
  if (lookup.rows.length === 0) {
    return res.status(404).json({ success: false, error: 'Course run not found' });
  }
  const { uuid: crUuid, ssg_run_id: ssgRunId, course_code: courseCode } = lookup.rows[0];
  if (!ssgRunId || !courseCode) {
    return res.status(400).json({
      success: false,
      error: 'Missing SSG run code or course code on this run — cannot sync from SSG.',
    });
  }

  const ssgApp = (req.query.app as string) || 'app1';
  const credentials = await getSSGCredentialsService().getSSGCredentials(undefined, ssgApp);
  if (!credentials) {
    return res.status(500).json({ success: false, error: `SSG credentials not found for app: ${ssgApp}` });
  }

  const ssgBaseUrl = process.env.SSG_API_URL || 'https://api.ssg-wsg.sg';
  const courseAPI = createSSGCourseAPI(ssgBaseUrl, credentials);
  const attendanceAPI = createSSGAttendanceAPI(ssgBaseUrl, credentials);

  const result = {
    sessionsFetched: 0,
    sessionsSynced: 0,
    attendanceFetched: 0,
    attendanceUpserted: 0,
    errors: [] as string[],
  };

  try {
    const sessionsResult = await courseAPI.viewCourseSessions(courseCode, ssgRunId, 'Y' as any, undefined, undefined);

    if (sessionsResult.error && Object.keys(sessionsResult.error).length > 0 && sessionsResult.error.message) {
      return res.status(502).json({
        success: false,
        error: `SSG sessions fetch failed: ${sessionsResult.error.message}`,
      });
    }
    if (!sessionsResult.data) {
      return res.status(502).json({ success: false, error: 'SSG returned no session data.' });
    }

    const sessions = Array.isArray(sessionsResult.data)
      ? sessionsResult.data
      : (sessionsResult.data?.sessions || []);
    result.sessionsFetched = sessions.length;

    for (const session of sessions) {
      const sessionId = session?.id || session?.sessionId;
      if (!sessionId) continue;

      const sessionStartDate = session?.startDate || session?.modeOfTraining?.startDate || null;
      const sessionEndDate = session?.endDate || session?.modeOfTraining?.endDate || null;
      const sessionStartTime = session?.startTime || null;
      const sessionEndTime = session?.endTime || null;
      const modeOfTraining = session?.modeOfTraining?.code || session?.modeOfTraining || null;
      const sessionTitle = session?.title || null;

      await pool.query(
        `INSERT INTO course_session (course_run_id, ssg_session_id, title, start_date, end_date, start_time, end_time, mode_of_training)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
         ON CONFLICT (course_run_id, ssg_session_id) DO UPDATE SET
           title = COALESCE(EXCLUDED.title, course_session.title),
           start_date = COALESCE(EXCLUDED.start_date, course_session.start_date),
           end_date = COALESCE(EXCLUDED.end_date, course_session.end_date),
           start_time = COALESCE(EXCLUDED.start_time, course_session.start_time),
           end_time = COALESCE(EXCLUDED.end_time, course_session.end_time),
           mode_of_training = COALESCE(EXCLUDED.mode_of_training, course_session.mode_of_training),
           updated_at = NOW()`,
        [crUuid, sessionId, sessionTitle, sessionStartDate, sessionEndDate, sessionStartTime, sessionEndTime, modeOfTraining]
      );
      result.sessionsSynced++;

      try {
        const attResult = await attendanceAPI.viewAttendance(ssgRunId, courseCode, sessionId);
        if (attResult.error && Object.keys(attResult.error).length > 0 && attResult.error.message) {
          result.errors.push(`Session ${sessionId}: ${attResult.error.message}`);
        } else if (attResult.data) {
          let records: any[] = [];
          try {
            records = extractRecordsFromViewAttendance(attResult.data, credentials.encryptionKey, sessionId);
          } catch (decErr) {
            result.errors.push(
              `Session ${sessionId}: decrypt failed — ${decErr instanceof Error ? decErr.message : 'unknown'}`
            );
          }
          result.attendanceFetched += records.length;

          const localSession = await pool.query(
            `SELECT id FROM course_session WHERE course_run_id = $1 AND ssg_session_id = $2 LIMIT 1`,
            [crUuid, sessionId]
          );
          const localSessionUuid = localSession.rows[0]?.id;
          if (!localSessionUuid) continue;

          for (const att of records) {
            const normalized = normalizeAttendanceRecord(att);
            if (!normalized) continue;
            const { nric: traineeNric, isPresent } = normalized;

            const userByNric = await pool.query(
              `SELECT au.id FROM app_user au
               JOIN learner_profile lp ON lp.user_id = au.id
               WHERE lp.nric = $1
               LIMIT 1`,
              [traineeNric]
            );
            const userId = userByNric.rows[0]?.id || null;

            await pool.query(
              `INSERT INTO course_attendance (session_id, user_id, nric, is_present)
               VALUES ($1, $2, $3, $4)
               ON CONFLICT (session_id, nric) DO UPDATE SET
                 is_present = EXCLUDED.is_present,
                 user_id = COALESCE(EXCLUDED.user_id, course_attendance.user_id),
                 updated_at = NOW()`,
              [localSessionUuid, userId, traineeNric, isPresent]
            );
            result.attendanceUpserted++;
          }
        }
      } catch (attErr) {
        result.errors.push(
          `Session ${sessionId}: ${attErr instanceof Error ? attErr.message : 'unknown'}`
        );
      }

      await sleep(RATE_LIMIT_MS);
    }

    return res.status(200).json({ success: true, ssgRunId, courseCode, ...result });
  } catch (err) {
    console.error('Error in sync-attendance-from-ssg:', err);
    return res.status(500).json({
      success: false,
      error: err instanceof Error ? err.message : 'Internal server error',
      partial: result,
    });
  }
}

export default withAuth(handler, { roles: ['admin', 'trainingProvider', 'developer', 'trainer'] });
