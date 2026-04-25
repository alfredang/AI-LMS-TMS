import type { NextApiRequest, NextApiResponse } from 'next';
import pool from '../../../lib/db';

/**
 * External API — List Course Runs
 *
 * GET /api/external/course-runs
 *
 * Headers:
 *   x-api-key: <EXTERNAL_API_KEY_FOR_CLAWDBOT>
 *
 * Query params (all optional):
 *   course_run_id   — exact match on SSG course_run_id
 *   course_code     — filter by course code (e.g. "TGS-2025060472")
 *   status          — filter by class_status (Confirmed | Pending | Cancelled | Reschedule)
 *   from            — start_date >= this date (YYYY-MM-DD)
 *   to              — start_date <= this date (YYYY-MM-DD)
 *   limit           — max rows (default 100, max 500)
 *   offset          — pagination offset (default 0)
 */
export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, x-api-key');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET') return res.status(405).json({ success: false, error: 'Method not allowed' });

  const apiKey = req.headers['x-api-key'];
  const validKey = process.env.EXTERNAL_API_KEY_FOR_CLAWDBOT;
  if (!validKey) return res.status(500).json({ success: false, error: 'API key not configured on server' });
  if (!apiKey || apiKey !== validKey) return res.status(401).json({ success: false, error: 'Invalid or missing API key' });

  const { course_run_id, course_code, status, from, to } = req.query;
  const limit = Math.min(Number(req.query.limit) || 100, 500);
  const offset = Number(req.query.offset) || 0;

  try {
    const conditions: string[] = [];
    const params: (string | number)[] = [];
    let idx = 1;

    if (course_run_id) {
      conditions.push(`cr.course_run_id = $${idx++}`);
      params.push(String(course_run_id));
    }
    if (course_code) {
      conditions.push(`c.course_code = $${idx++}`);
      params.push(String(course_code));
    }
    if (status) {
      conditions.push(`cr.class_status = $${idx++}`);
      params.push(String(status));
    }
    if (from) {
      conditions.push(`cr.start_date >= $${idx++}`);
      params.push(String(from));
    }
    if (to) {
      conditions.push(`cr.start_date <= $${idx++}`);
      params.push(String(to));
    }

    const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

    const result = await pool.query(
      `SELECT
         cr.id AS course_run_uuid,
         cr.course_run_id,
         cr.class_status,
         cr.start_date,
         cr.end_date,
         cr.mode_of_learning,
         cr.assigned_trainer_name,
         cr.assigned_trainer_email,
         cr.registration_opening_date,
         cr.registration_closing_date,
         cr.course_admin_email,
         cr.venue_block,
         cr.venue_street,
         cr.venue_building,
         cr.venue_floor,
         cr.venue_unit,
         cr.venue_postal_code,
         cr.venue_room,
         c.title AS course_title,
         c.course_code,
         c.course_type,
         c.course_fee,
         c.training_hours,
         c.assessment_hours,
         (SELECT COUNT(*)::int FROM enrollment e
          WHERE e.course_run_id = cr.id
            AND e.enrolment_status IS DISTINCT FROM 'Admin Removed') AS enrolled_count
       FROM course_run cr
       JOIN course c ON c.id = cr.course_id
       ${where}
       ORDER BY cr.start_date DESC
       LIMIT $${idx++} OFFSET $${idx++}`,
      [...params, limit, offset]
    );

    const countResult = await pool.query(
      `SELECT COUNT(*)::int AS total
       FROM course_run cr
       JOIN course c ON c.id = cr.course_id
       ${where}`,
      params
    );

    return res.status(200).json({
      success: true,
      total: countResult.rows[0].total,
      limit,
      offset,
      data: result.rows,
    });
  } catch (error) {
    console.error('external/course-runs error:', error);
    return res.status(500).json({ success: false, error: 'Internal server error' });
  }
}
