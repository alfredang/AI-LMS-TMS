import type { NextApiRequest, NextApiResponse } from 'next';
import pool from '../../../lib/db';

const COURSE_RUN_WEBHOOK = 'https://n8n.srv1231536.hstgr.cloud/webhook/7f2f5d21-beb6-47a9-8056-e1ccf79a3ea7';

function extractRaCode(qrCodeLink: string): string | null {
  if (!qrCodeLink) return null;
  if (/^RA\w{4,}$/.test(qrCodeLink)) return qrCodeLink;
  const match = qrCodeLink.match(/\/(RA\w+)$/);
  return match ? match[1] : null;
}

// Format SSG 8-digit date (e.g. 20260319) → "2026-03-19"
function formatSsgDate(d: number | string): string {
  const s = String(d);
  if (s.length === 8) return `${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)}`;
  return s;
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { courseRunCode } = req.query;
  if (!courseRunCode || typeof courseRunCode !== 'string') {
    return res.status(400).json({ error: 'courseRunCode is required' });
  }

  const code = courseRunCode.trim();

  try {
    // 1. Try DB first
    const dbResult = await pool.query(
      `SELECT
         cr.id                      AS "courseRunId",
         cr.course_run_id           AS "courseRunCode",
         cr.digital_attendance_id   AS "digitalAttendanceId",
         cr.start_date              AS "startDate",
         cr.end_date                AS "endDate",
         cr.assigned_trainer_name   AS "assignedTrainerName",
         c.id                       AS "id",
         c.title                    AS "title",
         c.course_code              AS "courseCode",
         c.tsc_code                 AS "tscCode",
         c.tsc_title                AS "tscTitle"
       FROM course_run cr
       JOIN course c ON c.id = cr.course_id
       WHERE cr.course_run_id = $1
       LIMIT 1`,
      [code]
    );

    if (dbResult.rows.length > 0) {
      return res.status(200).json({ success: true, data: dbResult.rows[0], source: 'db' });
    }

    // 2. Not in DB — call n8n webhook to fetch from SSG
    const webhookRes = await fetch(COURSE_RUN_WEBHOOK, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ courseRunId: code }),
    });

    if (!webhookRes.ok) {
      const errText = await webhookRes.text();
      return res.status(502).json({ error: `SSG webhook error: ${errText}` });
    }

    const webhookData = await webhookRes.json();

    // Webhook may return an array [ { result: { course } } ] or { data: { course } }
    const root = Array.isArray(webhookData) ? webhookData[0] : webhookData;
    const courseData =
      root?.result?.course ??
      root?.data?.course ??
      root?.course ??
      null;
    const runData = courseData?.run;

    if (!courseData || !runData) {
      console.error('[lookup-course-run] Unexpected webhook shape:', JSON.stringify(webhookData).slice(0, 500));
      return res.status(404).json({ error: `Course run ${code} not found in SSG.` });
    }

    const digitalAttendanceId = extractRaCode(runData.qrCodeLink ?? '');
    const startDate = formatSsgDate(runData.courseStartDate);
    const endDate   = formatSsgDate(runData.courseEndDate);

    // 3. Upsert into DB so future lookups are instant
    const client = await pool.connect();
    let courseRunUuid: string | null = null;
    try {
      await client.query('BEGIN');

      const courseUpsert = await client.query(
        `INSERT INTO course (course_code, title, course_type, training_hours, assessment_hours)
         VALUES ($1, $2, $3, 0, 0)
         ON CONFLICT (course_code) DO UPDATE SET title = EXCLUDED.title
         RETURNING id`,
        [courseData.referenceNumber, courseData.title, 'Non-WSQ']
      );
      const courseId = courseUpsert.rows[0].id;

      const runUpsert = await client.query(
        `INSERT INTO course_run (course_id, course_run_id, digital_attendance_id, start_date, end_date, mode_of_learning, class_status)
         VALUES ($1, $2, $3, $4, $5, 'Physical', 'Confirmed')
         ON CONFLICT (course_id, course_run_id) DO UPDATE
           SET digital_attendance_id = COALESCE(EXCLUDED.digital_attendance_id, course_run.digital_attendance_id)
         RETURNING id`,
        [courseId, String(runData.id), digitalAttendanceId, startDate, endDate]
      );
      courseRunUuid = runUpsert.rows[0].id;

      await client.query('COMMIT');
    } catch (insertErr) {
      await client.query('ROLLBACK');
      console.error('[lookup-course-run] DB upsert failed:', insertErr);
      // Non-fatal — still return SSG data below
    } finally {
      client.release();
    }

    const courseObject = {
      courseRunId:          courseRunUuid,
      courseRunCode:        String(runData.id),
      digitalAttendanceId,
      startDate,
      endDate,
      assignedTrainerName:  null,
      id:                   null,
      title:                courseData.title,
      courseCode:           courseData.referenceNumber,
      tscCode:              null,
      tscTitle:             null,
    };

    return res.status(200).json({ success: true, data: courseObject, source: 'ssg' });

  } catch (error) {
    console.error('[lookup-course-run] Error:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
}
