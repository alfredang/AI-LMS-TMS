import { withAuth } from '@lib/auth/withAuth';
import type { NextApiRequest, NextApiResponse } from 'next';
import { getSSGCredentialsService } from '../../../lib/ssg/services/credentials-service';
import { createSSGCourseAPI } from '../../../lib/ssg/api/course-api';
import { OptionalSelector } from '../../../lib/ssg/models/course-runs';
import pool from '../../../lib/db';
import crypto from 'crypto';

/**
 * GET /api/course-runs/view?courseRunId=XXXXXXX&includeExpired=false
 * View a single course run from SSG by its run ID.
 * Syncs course + course_run into the local DB if not already present.
 */

// Map SSG modeOfTraining code → DB mode_of_learning enum
function mapModeOfLearning(code: string | undefined): 'Physical' | 'Virtual' | 'Hybrid' | 'External' {
  switch (code) {
    case '2': return 'Virtual';   // E-Learning
    case '4': return 'Hybrid';    // Blended
    default:  return 'Physical';  // Classroom (1), On-the-job (3), Practical (5), etc.
  }
}

// Convert SSG date number (e.g. 20261212) → 'YYYY-MM-DD' string, or null
function fmtDate(v: number | string | undefined): string | null {
  if (!v) return null;
  const s = String(v);
  if (s.length !== 8) return null;
  return `${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)}`;
}

async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { courseRunId, includeExpired } = req.query;

  if (!courseRunId || typeof courseRunId !== 'string' || !courseRunId.trim()) {
    return res.status(400).json({ success: false, error: 'courseRunId query parameter is required' });
  }

  try {
    const credentials = await getSSGCredentialsService().getSSGCredentials(undefined, (req.headers['x-ssg-app'] as string) || undefined);
    if (!credentials) {
      return res.status(500).json({ success: false, error: 'SSG credentials not found' });
    }

    const ssgBaseUrl = process.env.SSG_API_URL || 'https://api.ssg-wsg.sg';
    const api = createSSGCourseAPI(ssgBaseUrl, credentials);

    const expired = includeExpired === 'true' ? OptionalSelector.YES : OptionalSelector.NO;
    const result = await api.viewCourseRun(courseRunId.trim(), expired);

    console.log('📦 SSG viewCourseRun result:', JSON.stringify(result, null, 2));

    // SSG always returns "error": {} even on success — only treat as error if code/message present
    const hasError = result.error && (result.error.code || result.error.message);
    if (hasError) {
      return res.status(result.status || 400).json({ success: false, error: result.error!.message });
    }

    // ── Sync to DB (non-fatal) ────────────────────────────────────────────────
    const ssgCourse = (result.data as any)?.course;
    const ssgRun    = ssgCourse?.run;

    if (ssgCourse && ssgRun) {
      const runIdStr        = String(ssgRun.id ?? courseRunId.trim());
      const courseCode      = ssgCourse.referenceNumber ?? ssgCourse.externalReferenceNumber ?? '';
      const courseTitle     = ssgCourse.title ?? courseCode;
      const startDate       = fmtDate(ssgRun.courseStartDate);
      const endDate         = fmtDate(ssgRun.courseEndDate);
      const modeOfLearning  = mapModeOfLearning(ssgRun.modeOfTraining);
      const qrRaw: string   = ssgRun.qrCodeLink || ssgRun.digitalClassroomLink || '';
      const digitalAttendId = qrRaw ? (qrRaw.split('/').pop() || null) : null;

      console.log(`🔍 SSG run fields — id:${runIdStr} start:${startDate} end:${endDate} mode:${modeOfLearning} qr:${digitalAttendId}`);

      const client = await pool.connect();
      try {
        await client.query('BEGIN');

        // ── 1. Find or create course ────────────────────────────────────────
        let courseId: string | null = null;

        if (courseCode) {
          const courseRow = await client.query(
            `SELECT id FROM course WHERE course_code = $1 LIMIT 1`,
            [courseCode]
          );

          if (courseRow.rows.length > 0) {
            courseId = courseRow.rows[0].id;
          } else {
            const newCourseId = crypto.randomUUID();
            const ins = await client.query(
              `INSERT INTO course (id, course_code, title, status, enrollment_status, created_at, updated_at)
               VALUES ($1, $2, $3, 'Published', 'enrolled', NOW(), NOW())
               ON CONFLICT (course_code) DO NOTHING
               RETURNING id`,
              [newCourseId, courseCode, courseTitle]
            );
            courseId = ins.rows[0]?.id ?? null;
            if (!courseId) {
              const race = await client.query(
                `SELECT id FROM course WHERE course_code = $1 LIMIT 1`,
                [courseCode]
              );
              courseId = race.rows[0]?.id ?? null;
            }
          }
        }

        if (!courseId) {
          console.warn(`⚠️ Could not resolve courseId for course_code: ${courseCode}`);
        } else {
          // ── 2. Upsert course_run — always update dates/mode/qr from SSG ──
          const newRunUuid = crypto.randomUUID();
          const upsertResult = await client.query(
            `INSERT INTO course_run (
               id, course_id, course_run_id, class_status,
               start_date, end_date, mode_of_learning,
               digital_attendance_id, created_at, updated_at
             ) VALUES ($1, $2, $3, 'Confirmed', $4, $5, $6, $7, NOW(), NOW())
             ON CONFLICT (course_id, course_run_id) DO UPDATE SET
               start_date            = COALESCE(EXCLUDED.start_date,           course_run.start_date),
               end_date              = COALESCE(EXCLUDED.end_date,             course_run.end_date),
               mode_of_learning      = COALESCE(EXCLUDED.mode_of_learning,     course_run.mode_of_learning),
               digital_attendance_id = COALESCE(EXCLUDED.digital_attendance_id, course_run.digital_attendance_id),
               updated_at            = NOW()
             RETURNING id, xmax`,
            [newRunUuid, courseId, runIdStr, startDate, endDate, modeOfLearning, digitalAttendId]
          );

          // xmax = 0 means it was an INSERT, non-zero means UPDATE
          const wasInsert = upsertResult.rows[0]?.xmax === '0';
          console.log(`✅ course_run ${runIdStr} ${wasInsert ? 'inserted' : 'updated'} (${startDate} → ${endDate}, ${modeOfLearning}, qr:${digitalAttendId})`);
        }

        await client.query('COMMIT');
      } catch (dbErr) {
        await client.query('ROLLBACK');
        console.error('⚠️ DB sync error (non-fatal):', dbErr);
      } finally {
        client.release();
      }
    }

    return res.status(200).json({ success: true, data: result.data });
  } catch (error) {
    console.error('Error viewing course run:', error);
    return res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Internal server error',
    });
  }
}

export default withAuth(handler);
