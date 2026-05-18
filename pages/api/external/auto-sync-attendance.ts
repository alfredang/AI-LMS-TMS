import { NextApiRequest, NextApiResponse } from 'next';
import pool from '../../../lib/db';
import { createSSGCourseAPI } from '../../../lib/ssg/api/course-api';
import { createSSGAttendanceAPI } from '../../../lib/ssg/api/attendance-api';
import { getSSGCredentialsService } from '../../../lib/ssg/services/credentials-service';
import { extractRecordsFromViewAttendance, normalizeAttendanceRecord } from '../../../lib/ssg/utils/attendance-decrypt';

const SCHEDULER_SECRET = process.env.NEXT_PUBLIC_SCHEDULER_SECRET || 'local-dev-fallback';
const RATE_LIMIT_MS = 1500;
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

const g = globalThis as unknown as { __autoSyncAttendanceRunning?: boolean };
if (g.__autoSyncAttendanceRunning === undefined) g.__autoSyncAttendanceRunning = false;

export async function runAutomation() {
    if (g.__autoSyncAttendanceRunning) {
        console.warn('[auto-sync-attendance] Another run is already in progress — skipping.');
        return { success: false, message: 'Skipped — another run is already in progress' };
    }
    g.__autoSyncAttendanceRunning = true;

    try {
        console.log(`[auto-sync-attendance] Starting run at ${new Date().toISOString()}`);

        const result = {
            courseRunsProcessed: 0,
            sessionsFetched: 0,
            sessionsSynced: 0,
            attendanceFetched: 0,
            attendanceUpserted: 0,
            errors: [] as string[],
        };

        const runsQuery = await pool.query(`
            SELECT cr.id AS uuid, cr.course_run_id AS ssg_run_id, c.course_code
            FROM course_run cr
            JOIN course c ON c.id = cr.course_id
            WHERE cr.end_date >= (NOW() AT TIME ZONE 'Asia/Singapore')::date - INTERVAL '7 days'
              AND cr.end_date <= (NOW() AT TIME ZONE 'Asia/Singapore')::date
              AND (cr.class_status IS NULL OR cr.class_status::text NOT ILIKE 'cancelled')
              AND cr.course_run_id IS NOT NULL
              AND c.course_code IS NOT NULL
        `);

        if (runsQuery.rows.length === 0) {
            console.log('[auto-sync-attendance] No eligible course runs found in the last 7 days.');
            return { success: true, ...result, message: 'No eligible course runs found' };
        }

        const ssgApp = 'app1'; // Default as used across the app
        const credentials = await getSSGCredentialsService().getSSGCredentials(undefined, ssgApp);
        if (!credentials) {
            throw new Error(`SSG credentials not found for app: ${ssgApp}`);
        }

        const ssgBaseUrl = process.env.SSG_API_URL || 'https://api.ssg-wsg.sg';
        const courseAPI = createSSGCourseAPI(ssgBaseUrl, credentials);
        const attendanceAPI = createSSGAttendanceAPI(ssgBaseUrl, credentials);

        for (const run of runsQuery.rows) {
            const { uuid: crUuid, ssg_run_id: ssgRunId, course_code: courseCode } = run;
            result.courseRunsProcessed++;

            try {
                const sessionsResult = await courseAPI.viewCourseSessions(courseCode, ssgRunId, 'Y' as any, undefined, undefined);

                if (sessionsResult.error && Object.keys(sessionsResult.error).length > 0 && sessionsResult.error.message) {
                    result.errors.push(`CourseRun ${ssgRunId} fetch sessions: ${sessionsResult.error.message}`);
                    await sleep(RATE_LIMIT_MS);
                    continue;
                }

                if (!sessionsResult.data) {
                    await sleep(RATE_LIMIT_MS);
                    continue;
                }

                const sessions = Array.isArray(sessionsResult.data)
                    ? sessionsResult.data
                    : (sessionsResult.data?.sessions || []);
                
                result.sessionsFetched += sessions.length;

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
                                result.errors.push(`Session ${sessionId}: decrypt failed — ${decErr instanceof Error ? decErr.message : 'unknown'}`);
                            }
                            result.attendanceFetched += records.length;

                            const localSession = await pool.query(
                                `SELECT id FROM course_session WHERE course_run_id = $1 AND ssg_session_id = $2 LIMIT 1`,
                                [crUuid, sessionId]
                            );
                            const localSessionUuid = localSession.rows[0]?.id;
                            if (localSessionUuid) {
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
                        }
                    } catch (attErr) {
                        result.errors.push(`Session ${sessionId}: ${attErr instanceof Error ? attErr.message : 'unknown'}`);
                    }

                    await sleep(RATE_LIMIT_MS);
                }
            } catch (runErr) {
                result.errors.push(`CourseRun ${ssgRunId} unexpected error: ${runErr instanceof Error ? runErr.message : 'unknown'}`);
            }
        }

        console.log(`[auto-sync-attendance] Run completed. Stats:`, result);
        return { success: true, ...result };
    } catch (error: any) {
        console.error('[auto-sync-attendance] Fatal Error:', error);
        return { success: false, message: 'Internal processing error', error: error.message };
    } finally {
        g.__autoSyncAttendanceRunning = false;
    }
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
    if (req.method !== 'POST') {
        return res.status(405).json({ success: false, message: 'Method not allowed' });
    }

    const { authKey } = req.body;
    if (authKey !== SCHEDULER_SECRET) {
        return res.status(401).json({ success: false, message: 'Unauthorized' });
    }

    const result = await runAutomation();
    if (result.success) {
        return res.status(200).json(result);
    } else {
        return res.status(500).json(result);
    }
}
