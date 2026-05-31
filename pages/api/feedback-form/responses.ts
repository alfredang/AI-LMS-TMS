import { NextApiRequest, NextApiResponse } from 'next';
import pool from '../../../lib/db';
import { cors } from '../../../lib/cors';

// Public read-only endpoint for tertiarycourses.com.sg staff to extract feedback.
// Per product decision: no authentication. Beware PII exposure.
export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  await cors(req, res);
  if (req.method !== 'GET') return res.status(405).json({ success: false, error: 'Method not allowed' });

  const { course_run_id, from, to, limit } = req.query;
  const parsedLimit = Math.min(parseInt(String(limit || '500'), 10) || 500, 5000);

  const where: string[] = [];
  const params: any[] = [];
  if (typeof course_run_id === 'string') {
    params.push(course_run_id);
    where.push(`r.course_run_id = $${params.length}`);
  }
  if (typeof from === 'string') {
    params.push(from);
    where.push(`r.submitted_at >= $${params.length}`);
  }
  if (typeof to === 'string') {
    params.push(to);
    where.push(`r.submitted_at <= $${params.length}`);
  }
  params.push(parsedLimit);

  const sql = `
    SELECT r.id, r.template_id, r.course_run_id, r.user_id,
           r.learner_email, r.learner_name, r.answers, r.submitted_at,
           cr.course_run_id AS course_run_code, cr.start_date, cr.end_date,
           c.title AS course_title, c.course_code,
           (
             SELECT string_agg(DISTINCT crt.trainer_name, ', ' ORDER BY crt.trainer_name)
             FROM course_run_trainer crt
             WHERE crt.course_run_id = cr.id
           ) AS trainer_name
    FROM feedback_form_response r
    LEFT JOIN course_run cr ON cr.id = r.course_run_id
    LEFT JOIN course c ON c.id = cr.course_id
    ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
    ORDER BY r.submitted_at DESC
    LIMIT $${params.length}
  `;

  try {
    const result = await pool.query(sql, params);
    return res.status(200).json({ success: true, count: result.rowCount, data: result.rows });
  } catch (error) {
    return res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Internal server error',
    });
  }
}
