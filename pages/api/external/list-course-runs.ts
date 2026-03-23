import type { NextApiRequest, NextApiResponse } from 'next';
import pool from '../../../lib/db';

/**
 * External API — List Course Runs
 *
 * GET /api/external/list-course-runs
 * GET /api/external/list-course-runs?status=Confirmed
 * GET /api/external/list-course-runs?trainer_email=trainer@email.com
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

  try {
    const { status, trainer_email } = req.query;

    let query = `
      SELECT
        cr.id AS uuid,
        cr.course_run_id,
        cr.start_date,
        cr.end_date,
        cr.class_status,
        cr.mode_of_learning,
        cr.digital_attendance_id,
        cr.assigned_trainer_name,
        cr.assigned_trainer_email,
        c.title AS course_title,
        c.course_code
      FROM course_run cr
      JOIN course c ON c.id = cr.course_id
      WHERE 1=1
    `;
    const params: any[] = [];

    if (status) {
      params.push(status);
      query += ` AND cr.class_status = $${params.length}`;
    }
    if (trainer_email) {
      params.push((trainer_email as string).toLowerCase());
      query += ` AND LOWER(cr.assigned_trainer_email) = $${params.length}`;
    }

    query += ` ORDER BY cr.start_date DESC LIMIT 200`;

    const result = await pool.query(query, params);

    return res.status(200).json({
      success: true,
      count: result.rows.length,
      data: result.rows,
    });
  } catch (error) {
    console.error('list-course-runs error:', error);
    return res.status(500).json({ success: false, error: 'Internal server error' });
  }
}
