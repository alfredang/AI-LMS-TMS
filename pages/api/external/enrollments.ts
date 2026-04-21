import type { NextApiRequest, NextApiResponse } from 'next';
import pool from '../../../lib/db';

/**
 * External API — List Enrollments
 *
 * GET /api/external/enrollments
 *
 * Headers:
 *   x-api-key: <EXTERNAL_API_KEY_FOR_CLAWDBOT>
 *
 * Query params (all optional):
 *   course_run_id   — filter by SSG course_run_id (e.g. "1334264")
 *   course_code     — filter by course code (e.g. "TGS-2025060472")
 *   learner_email   — filter by learner email
 *   payment_status  — filter by payment status (Paid | Unpaid)
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

  const { course_run_id, course_code, learner_email, payment_status } = req.query;
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
    if (learner_email) {
      conditions.push(`LOWER(u.email) = LOWER($${idx++})`);
      params.push(String(learner_email));
    }
    if (payment_status) {
      conditions.push(`e.payment_status = $${idx++}`);
      params.push(String(payment_status));
    }

    // Exclude admin-removed enrollments
    conditions.push(`e.enrolment_status IS DISTINCT FROM 'Admin Removed'`);

    const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

    const result = await pool.query(
      `SELECT
         e.id AS enrollment_id,
         e.enrolment_id AS ssg_enrolment_id,
         e.enrolment_status,
         e.enrolment_date,
         e.payment_status,
         e.assessment_status,
         e.course_sponsorship,
         e.progress_percent,
         e.nric,
         e.grant_id,
         e.grant_amount,
         e.completion_date,
         u.full_name AS learner_name,
         u.email AS learner_email,
         c.title AS course_title,
         c.course_code,
         c.course_fee,
         cr.course_run_id,
         cr.start_date AS course_run_start,
         cr.end_date AS course_run_end,
         cr.class_status,
         cr.assigned_trainer_name
       FROM enrollment e
       LEFT JOIN app_user u ON u.id = e.user_id
       JOIN course_run cr ON cr.id = e.course_run_id
       JOIN course c ON c.id = e.course_id
       ${where}
       ORDER BY e.enrolment_date DESC
       LIMIT $${idx++} OFFSET $${idx++}`,
      [...params, limit, offset]
    );

    const countResult = await pool.query(
      `SELECT COUNT(*)::int AS total
       FROM enrollment e
       LEFT JOIN app_user u ON u.id = e.user_id
       JOIN course_run cr ON cr.id = e.course_run_id
       JOIN course c ON c.id = e.course_id
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
    console.error('external/enrollments error:', error);
    return res.status(500).json({ success: false, error: 'Internal server error' });
  }
}
