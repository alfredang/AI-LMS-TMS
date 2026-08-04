import { withAuth } from '@lib/auth/withAuth';
import type { NextApiRequest, NextApiResponse } from 'next';
import pool from '../../../lib/db';
import { getSSGCredentialsService } from '../../../lib/ssg/services/credentials-service';
import { createSSGCourseAPI } from '../../../lib/ssg/api/course-api';

/**
 * GET /api/admin/add-sessions-info?courseRunId=<id>
 *
 * Returns:
 *   - SSG course run data (same structure as course-runs/view)
 *   - hasEveningClass: whether the associated course allows evening sessions
 *
 * Also ensures the has_evening_class column exists on the course table.
 */
async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') {
    return res.status(405).json({ success: false, error: 'Method not allowed' });
  }

  const { courseRunId } = req.query;
  if (!courseRunId || typeof courseRunId !== 'string') {
    return res.status(400).json({ success: false, error: 'courseRunId is required' });
  }

  // Ensure the has_evening_class column exists
  await pool.query(
    `ALTER TABLE course ADD COLUMN IF NOT EXISTS has_evening_class BOOLEAN DEFAULT false`
  );

  try {
    const credentials = await getSSGCredentialsService().getSSGCredentials(undefined, (req.headers['x-ssg-app'] as string) || undefined);
    if (!credentials) throw new Error('SSG credentials not found');

    const ssgBaseUrl = process.env.SSG_API_URL || 'https://api.ssg-wsg.sg';
    const api = createSSGCourseAPI(ssgBaseUrl, credentials);

    const ssgResult = await api.viewCourseRun(courseRunId.trim());

    const hasError = ssgResult.error && (
      ssgResult.error.code || ssgResult.error.message ||
      (ssgResult.error.details && ssgResult.error.details.length > 0)
    );
    if (hasError) {
      throw new Error(ssgResult.error?.message ?? `SSG error ${ssgResult.status}`);
    }

    const courseData = (ssgResult.data as any)?.course;
    const run = courseData?.run;

    if (!courseData || !run) {
      throw new Error('No course run data returned from SSG');
    }

    // Ensure course_session_timing table exists (full schema)
    await pool.query(`
      CREATE TABLE IF NOT EXISTS course_session_timing (
        id                                  SERIAL PRIMARY KEY,
        course_code                         TEXT UNIQUE NOT NULL,
        session_1_start_time                TEXT,
        session_1_end_time                  TEXT,
        session_1_mode_of_training          TEXT,
        session_2_start_time                TEXT,
        session_2_end_time                  TEXT,
        session_2_mode_of_training          TEXT,
        session_3_start_time                TEXT,
        session_3_end_time                  TEXT,
        session_3_mode_of_training          TEXT,
        session_4_start_time                TEXT,
        session_4_end_time                  TEXT,
        session_4_mode_of_training          TEXT,
        session_5_start_time                TEXT,
        session_5_end_time                  TEXT,
        session_5_mode_of_training          TEXT,
        session_6_start_time                TEXT,
        session_6_end_time                  TEXT,
        session_6_mode_of_training          TEXT,
        session_7_start_time                TEXT,
        session_7_end_time                  TEXT,
        session_7_mode_of_training          TEXT,
        session_8_start_time                TEXT,
        session_8_end_time                  TEXT,
        session_8_mode_of_training          TEXT,
        session_9_start_time                TEXT,
        session_9_end_time                  TEXT,
        session_9_mode_of_training          TEXT,
        session_10_start_time               TEXT,
        session_10_end_time                 TEXT,
        session_10_mode_of_training         TEXT,
        session_11_start_time               TEXT,
        session_11_end_time                 TEXT,
        session_11_mode_of_training         TEXT,
        session_1_evening_start_time        TEXT,
        session_1_evening_end_time          TEXT,
        session_1_evening_mode_of_training  TEXT,
        session_2_evening_start_time        TEXT,
        session_2_evening_end_time          TEXT,
        session_2_evening_mode_of_training  TEXT,
        session_3_evening_start_time        TEXT,
        session_3_evening_end_time          TEXT,
        session_3_evening_mode_of_training  TEXT,
        created_at                          TIMESTAMPTZ DEFAULT NOW(),
        updated_at                          TIMESTAMPTZ DEFAULT NOW()
      )
    `);

    // Look up has_evening_class + course_code from local DB via course_run_id
    const dbResult = await pool.query<{ has_evening_class: boolean; course_code: string }>(
      `SELECT c.has_evening_class, c.course_code
       FROM course_run cr
       JOIN course c ON c.id = cr.course_id
       WHERE cr.course_run_id = $1
       LIMIT 1`,
      [courseRunId.trim()]
    );

    const hasEveningClass: boolean = dbResult.rows[0]?.has_evening_class ?? false;

    // Fall back to SSG referenceNumber if course_run not yet in local DB
    const courseCode: string =
      dbResult.rows[0]?.course_code ||
      courseData.referenceNumber ||
      courseData.externalReferenceNumber ||
      '';

    // Look up session timing template for this course code
    let sessionTiming: Record<string, any> | null = null;
    if (courseCode) {
      const timingResult = await pool.query(
        `SELECT * FROM course_session_timing WHERE course_code = $1 LIMIT 1`,
        [courseCode.trim().toUpperCase()]
      );
      sessionTiming = timingResult.rows[0] ?? null;
    }

    return res.status(200).json({
      success: true,
      courseData,
      run,
      hasEveningClass,
      courseCode,
      sessionTiming,
    });
  } catch (err) {
    console.error('❌ add-sessions-info error:', err);
    return res.status(500).json({
      success: false,
      error: err instanceof Error ? err.message : 'Failed to fetch course run data',
    });
  }
}

export default withAuth(handler, { roles: ['admin', 'trainingProvider', 'developer'] });
