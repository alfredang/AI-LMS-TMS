import type { NextApiRequest, NextApiResponse } from 'next';
import pool from '../../../lib/db';

/**
 * GET /api/admin/ssg-enrolment-records?limit=500&search=...
 *
 * Returns enrolments from the local enrollment table where the enrolment_date
 * is yesterday or today AND the course start date is in the future.
 * Sorted by enrolment_date DESC (today first, then yesterday).
 */
export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') {
    return res.status(405).json({ success: false, error: 'Method not allowed' });
  }

  const limit = Math.min(parseInt(req.query.limit as string, 10) || 100, 500);
  const search = (req.query.search as string || '').trim();

  try {
    const conditions: string[] = [
      // Enrolment date = yesterday or today (include NULL dates)
      `(e.enrolment_date IS NULL OR e.enrolment_date >= CURRENT_DATE - INTERVAL '1 day')`,
      // Course starts in the future
      `cr.start_date >= CURRENT_DATE`,
      // Exclude removed/cancelled
      `LOWER(COALESCE(e.enrolment_status, '')) NOT IN ('admin removed', 'cancelled', 'withdrawn')`,
    ];
    const params: any[] = [];
    let paramIdx = 1;

    if (search) {
      conditions.push(`(
        COALESCE(au.full_name, e.nric, '') ILIKE $${paramIdx}
        OR e.nric ILIKE $${paramIdx}
        OR COALESCE(au.email, e.email, '') ILIKE $${paramIdx}
        OR e.enrolment_id ILIKE $${paramIdx}
        OR c.title ILIKE $${paramIdx}
        OR c.course_code ILIKE $${paramIdx}
        OR cr.course_run_id ILIKE $${paramIdx}
      )`);
      params.push(`%${search}%`);
      paramIdx++;
    }

    const whereClause = `WHERE ${conditions.join(' AND ')}`;

    const dataRes = await pool.query(
      `SELECT
        e.id,
        e.enrolment_id AS enrolment_reference,
        e.enrolment_date,
        COALESCE(au.full_name, e.nric) AS learner_name,
        e.nric AS learner_nric,
        COALESCE(au.email, e.email) AS learner_email,
        c.title AS course_title,
        c.course_code AS course_ref_code,
        cr.course_run_id,
        cr.start_date,
        e.enrolment_status AS status
      FROM public.enrollment AS e
      INNER JOIN public.course_run AS cr ON e.course_run_id = cr.id
      INNER JOIN public.course AS c ON cr.course_id = c.id
      LEFT JOIN public.app_user AS au ON e.user_id = au.id
      ${whereClause}
      ORDER BY e.enrolment_date DESC NULLS LAST, e.created_at DESC
      LIMIT $${paramIdx}`,
      [...params, limit]
    );

    return res.status(200).json({
      success: true,
      data: dataRes.rows,
      total: dataRes.rows.length,
    });
  } catch (err) {
    console.error('❌ ssg-enrolment-records error:', err);
    return res.status(500).json({
      success: false,
      error: err instanceof Error ? err.message : 'Internal server error',
    });
  }
}
