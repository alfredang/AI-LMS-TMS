import { withAuth } from '@lib/auth/withAuth';
import { NextApiRequest, NextApiResponse } from 'next';
import { getSSGCredentialsService } from '../../../lib/ssg/services/credentials-service';
import { createSSGCourseAPI } from '../../../lib/ssg/api/course-api';
import { HttpClient, HTTPRequestBuilder, HttpMethod } from '../../../lib/ssg/utils/http-utils';
import { OptionalSelector } from '../../../lib/ssg/models/course-runs';
import pool from '../../../lib/db';
import crypto from 'crypto';
import { COURSE_ID_BY_ANY_CODE_SQL } from '../../../lib/courseCode';

/**
 * POST /api/enrolment/update
 * Update an enrolment on SSG (e.g. move trainee to another course run).
 * Body: { enrolmentId, courseRunId }
 *
 * After SSG success:
 *  - Finds enrollment row by enrolment_id (ignores if not found)
 *  - Ensures the new course_run exists in DB (fetches from SSG if missing)
 *  - Updates enrollment: course_run_id + raw_data.course.run fields
 */
async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { enrolmentId, courseRunId } = req.body;
  if (!enrolmentId || !courseRunId) {
    return res.status(400).json({ success: false, error: 'enrolmentId and courseRunId are required' });
  }

  try {
    const credentials = await getSSGCredentialsService().getSSGCredentials(undefined, (req.headers['x-ssg-app'] as string) || undefined);
    if (!credentials) {
      return res.status(500).json({ success: false, error: 'SSG credentials not found' });
    }

    const ssgBaseUrl = process.env.SSG_API_URL || 'https://api.ssg-wsg.sg';

    // ── 1. Call SSG update enrolment ─────────────────────────────────────────
    const payload = {
      enrolment: {
        action: 'update',
        course: { run: { id: String(courseRunId) } }
      }
    };

    const encKey = Buffer.from(credentials.encryptionKey, 'base64');
    const iv = Buffer.from('SSGAPIInitVector', 'utf8');

    const cipher = crypto.createCipheriv('aes-256-cbc', encKey, iv);
    let encryptedPayload = cipher.update(JSON.stringify(payload), 'utf8', 'base64');
    encryptedPayload += cipher.final('base64');

    const builder = new HTTPRequestBuilder()
      .withEndpoint(ssgBaseUrl, `/tpg/enrolments/details/${enrolmentId}`)
      .withMethod(HttpMethod.POST)
      .withBody(encryptedPayload);

    if (credentials.certificateContent && credentials.privateKeyContent) {
      builder.withCertificate(credentials.certificateContent, credentials.privateKeyContent);
    }

    const httpClient = new HttpClient(ssgBaseUrl, { 'Content-Type': 'application/json', 'Accept': 'application/json' });
    const httpResponse = await httpClient.request(builder.build());

    if (httpResponse.status !== 200) {
      console.error(`❌ SSG update enrolment error [${httpResponse.status}]:`, JSON.stringify(httpResponse.data));
      return res.status(httpResponse.status).json({ success: false, error: `SSG error ${httpResponse.status}`, details: httpResponse.data });
    }

    // Decrypt SSG response
    const rawBody = typeof httpResponse.data === 'string' ? httpResponse.data : JSON.stringify(httpResponse.data);
    const decipher = crypto.createDecipheriv('aes-256-cbc', encKey, iv);
    let decrypted = decipher.update(rawBody, 'base64', 'utf8');
    decrypted += decipher.final('utf8');
    const parsed = JSON.parse(decrypted);
    console.log('📦 Update enrolment SSG response:', JSON.stringify(parsed));

    if (parsed?.status && String(parsed.status) !== '200') {
      return res.status(Number(parsed.status) || 400).json({ success: false, error: parsed?.error ?? `SSG status ${parsed.status}` });
    }

    // ── 2. Sync DB ────────────────────────────────────────────────────────────
    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      // Find enrollment row — ignore if not found
      const enrolRow = await client.query(
        `SELECT id, raw_data FROM enrollment WHERE enrolment_id = $1 LIMIT 1`,
        [enrolmentId]
      );

      if (enrolRow.rows.length === 0) {
        console.log(`ℹ️ enrolment_id ${enrolmentId} not found in DB — skipping`);
      } else {
        const enrollmentUuid = enrolRow.rows[0].id;

        // ── 2a. Resolve course_run UUID, fetching from SSG if missing ─────────
        const fmtDate = (v: number | string | undefined): string | null => {
          if (!v) return null;
          const s = String(v);
          return s.length === 8 ? `${s.slice(0,4)}-${s.slice(4,6)}-${s.slice(6,8)}` : null;
        };

        let courseRunUuid: string | null = null;
        let runStartDate: string | null = null;
        let runEndDate:   string | null = null;

        const existingRunRow = await client.query(
          `SELECT id, start_date, end_date FROM course_run WHERE course_run_id = $1 LIMIT 1`,
          [String(courseRunId)]
        );

        if (existingRunRow.rows.length > 0) {
          // Already in DB — also grab dates so raw_data stays accurate
          courseRunUuid = existingRunRow.rows[0].id;
          runStartDate  = existingRunRow.rows[0].start_date ?? null;
          runEndDate    = existingRunRow.rows[0].end_date   ?? null;
        } else {
          // Not in DB — fetch from SSG and upsert
          console.log(`🔍 course_run ${courseRunId} not in DB — fetching from SSG`);
          const courseApi = createSSGCourseAPI(ssgBaseUrl, credentials);
          const runResult = await courseApi.viewCourseRun(String(courseRunId), OptionalSelector.NO);

          const runHasError = runResult.error && (runResult.error.code || runResult.error.message);
          const ssgData     = (runResult.data as any);
          const ssgCourse   = ssgData?.course;
          const ssgRun      = ssgCourse?.run;

          if (!runHasError && ssgCourse && ssgRun) {
            runStartDate = fmtDate(ssgRun.courseStartDate);
            runEndDate   = fmtDate(ssgRun.courseEndDate);
            const qrRaw: string   = ssgRun.qrCodeLink || ssgRun.digitalClassroomLink || '';
            const digitalAttendId = qrRaw ? (qrRaw.split('/').pop() || null) : null;
            const modeMap: Record<string, string> = { '2': 'Virtual', '4': 'Hybrid' };
            const modeOfLearning  = modeMap[ssgRun.modeOfTraining] ?? 'Physical';
            const courseCode      = ssgCourse.referenceNumber ?? ssgCourse.externalReferenceNumber ?? '';

            // Find or create course
            let courseId: string | null = null;
            if (courseCode) {
              const courseRow = await client.query(
                COURSE_ID_BY_ANY_CODE_SQL,
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
                  [newCourseId, courseCode, ssgCourse.title ?? courseCode]
                );
                courseId = ins.rows[0]?.id ?? null;
                if (!courseId) {
                  const race = await client.query(
                    COURSE_ID_BY_ANY_CODE_SQL,
                    [courseCode]
                  );
                  courseId = race.rows[0]?.id ?? null;
                }
              }
            }

            if (courseId) {
              // Upsert course_run — always update with SSG values
              const newRunUuid = crypto.randomUUID();
              const upsert = await client.query(
                `INSERT INTO course_run (id, course_id, course_run_id, class_status,
                   start_date, end_date, mode_of_learning, digital_attendance_id,
                   created_at, updated_at)
                 VALUES ($1,$2,$3,'Confirmed',$4,$5,$6,$7,NOW(),NOW())
                 ON CONFLICT (course_id, course_run_id) DO UPDATE SET
                   start_date            = COALESCE(EXCLUDED.start_date,            course_run.start_date),
                   end_date              = COALESCE(EXCLUDED.end_date,              course_run.end_date),
                   mode_of_learning      = COALESCE(EXCLUDED.mode_of_learning,      course_run.mode_of_learning),
                   digital_attendance_id = COALESCE(EXCLUDED.digital_attendance_id, course_run.digital_attendance_id),
                   updated_at            = NOW()
                 RETURNING id`,
                [newRunUuid, courseId, String(courseRunId), runStartDate, runEndDate, modeOfLearning, digitalAttendId]
              );
              courseRunUuid = upsert.rows[0]?.id ?? null;

              // Fallback if ON CONFLICT returned nothing (shouldn't happen but safety net)
              if (!courseRunUuid) {
                const race = await client.query(
                  `SELECT id FROM course_run WHERE course_run_id = $1 LIMIT 1`,
                  [String(courseRunId)]
                );
                courseRunUuid = race.rows[0]?.id ?? null;
              }
            }
          }
        }

        // ── 2b. Patch raw_data ────────────────────────────────────────────────
        let rawData: any = null;
        try {
          const stored = enrolRow.rows[0].raw_data;
          rawData = typeof stored === 'string' ? JSON.parse(stored) : stored;
        } catch { /* leave null */ }

        if (rawData) {
          if (!rawData.course) rawData.course = {};
          if (!rawData.course.run) rawData.course.run = {};
          rawData.course.run.id = String(courseRunId);
          if (runStartDate) rawData.course.run.startDate = runStartDate;
          if (runEndDate)   rawData.course.run.endDate   = runEndDate;
        }

        // ── 2c. Update enrollment row ─────────────────────────────────────────
        if (courseRunUuid) {
          await client.query(
            `UPDATE enrollment
                SET course_run_id = $1,
                    raw_data      = $2,
                    updated_at    = NOW()
              WHERE id = $3`,
            [courseRunUuid, rawData ? JSON.stringify(rawData) : enrolRow.rows[0].raw_data, enrollmentUuid]
          );
          console.log(`✅ Enrollment ${enrolmentId} updated → course_run ${courseRunId}`);
        } else {
          await client.query(`UPDATE enrollment SET updated_at = NOW() WHERE id = $1`, [enrollmentUuid]);
          console.warn(`⚠️ Could not resolve course_run UUID for run ${courseRunId}`);
        }
      }

      await client.query('COMMIT');
    } catch (dbErr) {
      await client.query('ROLLBACK');
      console.error('⚠️ DB sync error (non-fatal):', dbErr);
    } finally {
      client.release();
    }

    return res.status(200).json({ success: true, data: parsed?.data ?? parsed });

  } catch (error) {
    console.error('❌ Update enrolment error:', error);
    return res.status(500).json({ success: false, error: error instanceof Error ? error.message : 'Internal server error' });
  }
}

export default withAuth(handler);
