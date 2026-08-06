import { withAuth } from '@lib/auth/withAuth';
import { NextApiRequest, NextApiResponse } from 'next';
import pool from '../../../lib/db';

async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ success: false, error: 'Method not allowed' });
  }

  const { courseCode, courseRunId, startDate, endDate, classStatus, digitalAttendanceId } = req.body;

  if (!courseCode || !courseRunId) {
    return res.status(400).json({ success: false, error: 'courseCode and courseRunId are required' });
  }

  try {
    // Resolve course_id from course_code
    const courseRow = await pool.query(
      `SELECT id FROM course WHERE course_code = $1`,
      [courseCode.trim()]
    );

    if (courseRow.rows.length === 0) {
      return res.status(404).json({ success: false, error: `No course found with code "${courseCode}".` });
    }

    const courseId = courseRow.rows[0].id;

    const result = await pool.query(
      `INSERT INTO course_run (course_id, course_run_id, start_date, end_date, class_status, digital_attendance_id, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, NOW(), NOW())
       ON CONFLICT (course_id, course_run_id) DO NOTHING
       RETURNING id`,
      [
        courseId,
        courseRunId.trim(),
        startDate || null,
        endDate || null,
        classStatus || 'Confirmed',
        digitalAttendanceId || null,
      ]
    );

    if (result.rowCount === 0) {
      return res.status(409).json({ success: false, error: `A course run "${courseRunId}" already exists for this course.` });
    }

    return res.status(200).json({ success: true, message: 'Course run added successfully', id: result.rows[0].id });
  } catch (error) {
    return res.status(500).json({
      success: false,
      error: 'Internal server error: ' + (error instanceof Error ? error.message : 'Unknown error'),
    });
  }
}

export default withAuth(handler, { roles: ['admin', 'trainingProvider', 'developer'] });
