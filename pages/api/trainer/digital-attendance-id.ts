import type { NextApiRequest, NextApiResponse } from 'next';
import pool from '../../../lib/db';

const COURSE_RUN_WEBHOOK = 'https://n8n.srv1231536.hstgr.cloud/webhook/7f2f5d21-beb6-47a9-8056-e1ccf79a3ea7';

// Extract the RA###### code from a qrCodeLink URL
// e.g. "https://www.myskillsfuture.gov.sg/api/take-attendance/RA740761" → "RA740761"
function extractRaCode(qrCodeLink: string): string | null {
  const match = qrCodeLink.match(/\/(RA\w+)$/);
  return match ? match[1] : null;
}

// Recursively search any JSON object for a "qrCodeLink" field or a URL/string containing an RA code
function findQrCodeLinkOrRaCode(obj: any, depth = 0): string | undefined {
  if (depth > 10 || !obj || typeof obj !== 'object') return undefined;
  for (const key of Object.keys(obj)) {
    const val = obj[key];
    if (key === 'qrCodeLink' && typeof val === 'string' && val) return val;
    // If any string value looks like an RA take-attendance URL, return it
    if (typeof val === 'string' && val.includes('take-attendance/RA')) return val;
    // If any string value is just an RA code
    if (typeof val === 'string' && /^RA\w{4,}$/.test(val)) return val;
    if (val && typeof val === 'object') {
      const found = findQrCodeLinkOrRaCode(val, depth + 1);
      if (found) return found;
    }
  }
  return undefined;
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  // PUT: manually save a digitalAttendanceId provided by the user
  if (req.method === 'PUT') {
    const { courseRunUuid, digitalAttendanceId } = req.body;
    if (!courseRunUuid || !digitalAttendanceId) {
      return res.status(400).json({ error: 'courseRunUuid and digitalAttendanceId are required' });
    }
    const raCode = digitalAttendanceId.trim().startsWith('RA') ? digitalAttendanceId.trim() : null;
    if (!raCode) {
      return res.status(422).json({ error: 'digitalAttendanceId must start with RA' });
    }
    try {
      await pool.query(
        `UPDATE course_run SET digital_attendance_id = $1 WHERE id = $2`,
        [raCode, courseRunUuid]
      );
      return res.status(200).json({ digitalAttendanceId: raCode });
    } catch (error) {
      console.error('Error saving digital attendance ID:', error);
      return res.status(500).json({ error: 'Internal server error' });
    }
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { courseRunUuid, courseRunCode } = req.body;

  if (!courseRunUuid) {
    return res.status(400).json({ error: 'courseRunUuid is required' });
  }

  try {
    // 1. Check if digital_attendance_id is already in the DB
    const existing = await pool.query(
      `SELECT digital_attendance_id FROM course_run WHERE id = $1`,
      [courseRunUuid]
    );

    if (existing.rows.length > 0 && existing.rows[0].digital_attendance_id) {
      return res.status(200).json({ digitalAttendanceId: existing.rows[0].digital_attendance_id });
    }

    // 2. Not in DB — call the n8n webhook to retrieve course run info
    if (!courseRunCode) {
      return res.status(400).json({ error: 'courseRunCode is required to fetch from SSG' });
    }

    const webhookRes = await fetch(COURSE_RUN_WEBHOOK, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ courseRunId: courseRunCode }),
    });

    if (!webhookRes.ok) {
      const errText = await webhookRes.text();
      return res.status(502).json({ error: `Webhook error: ${errText}` });
    }

    const webhookData = await webhookRes.json();

    console.log('[digital-attendance-id] Raw webhook response:', JSON.stringify(webhookData).slice(0, 2000));

    // Try multiple known paths for qrCodeLink
    const qrCodeLink: string | undefined =
      webhookData?.data?.course?.run?.qrCodeLink ??
      webhookData?.data?.courseRun?.qrCodeLink ??
      webhookData?.data?.run?.qrCodeLink ??
      webhookData?.result?.data?.course?.run?.qrCodeLink ??
      webhookData?.qrCodeLink ??
      findQrCodeLinkOrRaCode(webhookData);

    if (!qrCodeLink) {
      console.error('[digital-attendance-id] qrCodeLink not found. Full response keys:', Object.keys(webhookData || {}));
      return res.status(404).json({
        error: 'qrCodeLink not found in webhook response',
        hint: 'Check server logs for the raw webhook response structure',
      });
    }

    // If the value is already just an RA code, use it directly
    const digitalAttendanceId = qrCodeLink.startsWith('RA')
      ? qrCodeLink
      : extractRaCode(qrCodeLink);
    if (!digitalAttendanceId) {
      return res.status(422).json({ error: `Could not parse RA code from: ${qrCodeLink}` });
    }

    // 3. Save digital_attendance_id to the course_run table
    const updateResult = await pool.query(
      `UPDATE course_run SET digital_attendance_id = $1 WHERE id = $2`,
      [digitalAttendanceId, courseRunUuid]
    );

    if (updateResult.rowCount === 0) {
      // course_run row not found by UUID — attempt to save using the SSG run ID
      const updateByCode = await pool.query(
        `UPDATE course_run SET digital_attendance_id = $1 WHERE course_run_id = $2`,
        [digitalAttendanceId, courseRunCode]
      );

      if (updateByCode.rowCount === 0) {
        // course_run doesn't exist at all — insert course + course_run from webhook data
        const courseData = webhookData?.data?.course;
        const runData = courseData?.run;

        if (courseData && runData) {
          const client = await pool.connect();
          try {
            await client.query('BEGIN');

            // Upsert course
            const courseUpsert = await client.query(
              `INSERT INTO course (course_code, title, course_type, training_hours, assessment_hours)
               VALUES ($1, $2, $3, 0, 0)
               ON CONFLICT (course_code) DO UPDATE SET title = EXCLUDED.title
               RETURNING id`,
              [courseData.referenceNumber, courseData.title, 'Non-WSQ']
            );
            const courseId = courseUpsert.rows[0].id;

            // Insert course_run
            await client.query(
              `INSERT INTO course_run (course_id, course_run_id, digital_attendance_id, start_date, end_date)
               VALUES ($1, $2, $3, $4, $5)
               ON CONFLICT DO NOTHING`,
              [
                courseId,
                String(runData.id),
                digitalAttendanceId,
                String(runData.courseStartDate),
                String(runData.courseEndDate),
              ]
            );

            await client.query('COMMIT');
          } catch (insertErr) {
            await client.query('ROLLBACK');
            console.error('Failed to insert course/course_run:', insertErr);
            // Still return the ID even if DB insert failed
          } finally {
            client.release();
          }
        }
      }
    }

    return res.status(200).json({ digitalAttendanceId });
  } catch (error) {
    console.error('Error fetching digital attendance ID:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
}
