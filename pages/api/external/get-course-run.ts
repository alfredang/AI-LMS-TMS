import type { NextApiRequest, NextApiResponse } from 'next';
import pool from '../../../lib/db';

/**
 * External API — Get Course Run Details
 *
 * GET /api/external/get-course-run?course_run_id=1303232
 *
 * Headers:
 *   x-api-key: <EXTERNAL_API_KEY_FOR_CLAWDBOT>
 */
export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') {
    return res.status(405).json({ success: false, error: 'Method not allowed' });
  }

  const apiKey = req.headers['x-api-key'];
  const validKey = process.env.EXTERNAL_API_KEY_FOR_CLAWDBOT;
  if (!validKey) return res.status(500).json({ success: false, error: 'API key not configured on server' });
  if (!apiKey || apiKey !== validKey) return res.status(401).json({ success: false, error: 'Invalid or missing API key' });

  const { course_run_id } = req.query;
  if (!course_run_id) {
    return res.status(400).json({ success: false, error: 'Missing required query param: course_run_id' });
  }

  try {
    const result = await pool.query(
      `SELECT
        cr.id AS uuid,
        cr.course_run_id,
        cr.start_date,
        cr.end_date,
        cr.class_status,
        cr.mode_of_learning,
        cr.digital_attendance_id,
        cr.assigned_trainer_id,
        cr.assigned_trainer_name,
        cr.assigned_trainer_email,
        c.title AS course_title,
        c.course_code,
        (SELECT COUNT(*) FROM enrollment e WHERE e.course_run_id = cr.id AND e.enrolment_status IS DISTINCT FROM 'Admin Removed') AS enrolled_learners
      FROM course_run cr
      JOIN course c ON c.id = cr.course_id
      WHERE cr.course_run_id = $1`,
      [String(course_run_id)]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ success: false, error: `Course run ${course_run_id} not found` });
    }

    return res.status(200).json({
      success: true,
      data: result.rows[0],
    });
  } catch (error) {
    console.error('get-course-run error:', error);
    return res.status(500).json({ success: false, error: 'Internal server error' });
  }
}
