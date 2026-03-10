import type { NextApiRequest, NextApiResponse } from 'next';
import pool from '../../../lib/db';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ success: false, error: 'Method not allowed' });
  }

  const { courseRunUuid, userId } = req.body;

  if (!courseRunUuid || !userId) {
    return res.status(400).json({ success: false, error: 'courseRunUuid and userId are required' });
  }

  const client = await pool.connect();
  try {
    // Fetch the course_id for this course run
    const runResult = await client.query(
      `SELECT id, course_id FROM course_run WHERE id = $1`,
      [courseRunUuid]
    );

    if (runResult.rows.length === 0) {
      return res.status(404).json({ success: false, error: 'Course run not found' });
    }

    const { course_id: courseId } = runResult.rows[0];

    // Check if enrollment already exists
    const existing = await client.query(
      `SELECT id FROM enrollment WHERE user_id = $1 AND course_run_id = $2`,
      [userId, courseRunUuid]
    );

    if (existing.rows.length > 0) {
      return res.status(409).json({ success: false, error: 'Student is already enrolled in this course run' });
    }

    // Create enrollment
    await client.query(
      `INSERT INTO enrollment (id, user_id, course_id, course_run_id, progress_percent, payment_status, assessment_status, enrolment_date, created_at, updated_at)
       VALUES (gen_random_uuid(), $1, $2, $3, 0, 'Unpaid', 'Pending', CURRENT_DATE, NOW(), NOW())`,
      [userId, courseId, courseRunUuid]
    );

    res.status(200).json({ success: true, message: 'Student enrolled successfully' });
  } catch (error) {
    console.error('Error assigning student:', error);
    res.status(500).json({ success: false, error: 'Internal server error' });
  } finally {
    client.release();
  }
}
