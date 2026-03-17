import type { NextApiRequest, NextApiResponse } from 'next';
import pool from '../../../lib/db';

const WEBHOOK_URL = 'https://n8n.srv1231536.hstgr.cloud/webhook/7f2f5d21-beb6-47a9-8056-e1ccf79a3ea7';

function parseToISO(d: number | string | undefined): string | null {
  if (!d) return null;
  const s = String(d).trim();
  if (/^\d{8}$/.test(s)) return `${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)}`;
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  const months: Record<string, string> = {
    Jan: '01', Feb: '02', Mar: '03', Apr: '04', May: '05', Jun: '06',
    Jul: '07', Aug: '08', Sep: '09', Oct: '10', Nov: '11', Dec: '12',
  };
  const m = s.match(/^(\d{1,2})\s+([A-Za-z]{3})\s+(\d{4})$/);
  if (m) return `${m[3]}-${months[m[2]] ?? '01'}-${m[1].padStart(2, '0')}`;
  return null;
}

function extractRaCode(qrCodeLink: string | undefined): string | null {
  if (!qrCodeLink) return null;
  const parts = qrCodeLink.split('/');
  return parts[parts.length - 1] || null;
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') { res.status(200).end(); return; }

  if (req.method !== 'POST') {
    return res.status(405).json({ success: false, error: 'Method not allowed' });
  }

  const { course_run_id } = req.body ?? {};

  if (!course_run_id || String(course_run_id).trim() === '') {
    return res.status(400).json({ success: false, error: 'course_run_id is required' });
  }

  const courseRunId = String(course_run_id).trim();

  // ── Fetch course run data from SSG via n8n webhook ──────────────────────────
  let courseCode: string;
  let courseTitle: string;
  let startDateISO: string | null;
  let endDateISO: string | null;
  let raCode: string | null;
  let modeOfLearning: string;

  try {
    const webhookRes = await fetch(WEBHOOK_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ courseRunId }),
    });

    if (!webhookRes.ok) {
      return res.status(502).json({
        success: false,
        error: `SSG data fetch failed (HTTP ${webhookRes.status}). The course run ID may not exist in SSG.`,
      });
    }

    const ssgData = await webhookRes.json();
    const run = ssgData?.result?.course?.run;
    const courseInfo = ssgData?.result?.course;

    if (!run || !courseInfo) {
      return res.status(404).json({
        success: false,
        error: `No data returned from SSG for course run ID: ${courseRunId}. Please verify the ID is correct.`,
      });
    }

    courseCode   = courseInfo.referenceNumber as string;
    courseTitle  = (courseInfo.title as string) ?? '';
    startDateISO = parseToISO(run.courseStartDate);
    endDateISO   = parseToISO(run.courseEndDate);
    raCode       = extractRaCode(run.qrCodeLink);

    const titleLower = courseTitle.toLowerCase();
    if (titleLower.includes('virtual'))       modeOfLearning = 'Virtual';
    else if (titleLower.includes('external')) modeOfLearning = 'External';
    else if (titleLower.includes('hybrid'))   modeOfLearning = 'Hybrid';
    else                                       modeOfLearning = 'Physical';

  } catch (err) {
    return res.status(502).json({
      success: false,
      error: 'Could not reach SSG webhook. Please check your network connection and try again.',
    });
  }

  // ── Upsert course run in database ───────────────────────────────────────────
  const client = await pool.connect();
  try {
    // Find course by course_code
    const courseResult = await client.query(
      `SELECT id FROM course WHERE LOWER(course_code) = LOWER($1) LIMIT 1`,
      [courseCode]
    );

    if (courseResult.rows.length === 0) {
      return res.status(404).json({
        success: false,
        error: `Course not found in database for code: ${courseCode}. Add the course first before importing the run.`,
      });
    }

    const courseId = courseResult.rows[0].id;

    // Check if course run already exists
    const existingRun = await client.query(
      `SELECT id FROM course_run WHERE course_run_id = $1`,
      [courseRunId]
    );

    let action: 'created' | 'updated';

    if (existingRun.rows.length > 0) {
      // Update existing run
      await client.query(
        `UPDATE course_run
         SET start_date       = COALESCE($1, start_date),
             end_date         = COALESCE($2, end_date),
             mode_of_learning = COALESCE($3, mode_of_learning),
             digital_attendance_id = COALESCE($4, digital_attendance_id),
             class_status     = 'Confirmed',
             updated_at       = NOW()
         WHERE id = $5`,
        [startDateISO, endDateISO, modeOfLearning, raCode, existingRun.rows[0].id]
      );
      action = 'updated';
    } else {
      // Insert new run
      await client.query(
        `INSERT INTO course_run
           (course_id, course_run_id, start_date, end_date, mode_of_learning, digital_attendance_id, class_status, created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, 'Confirmed', NOW(), NOW())`,
        [courseId, courseRunId, startDateISO, endDateISO, modeOfLearning, raCode]
      );
      action = 'created';
    }

    return res.status(200).json({
      success: true,
      action,
      data: {
        courseRunId,
        courseCode,
        courseTitle,
        startDate: startDateISO,
        endDate: endDateISO,
        modeOfLearning,
        raCode,
      },
    });

  } catch (error) {
    console.error('❌ import-course-run DB error:', error);
    return res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Database error while saving course run.',
    });
  } finally {
    client.release();
  }
}
