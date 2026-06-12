import type { NextApiRequest, NextApiResponse } from 'next';
import pool from '../../../lib/db';

/**
 * GET /api/admin/ssg-enrolment-records?limit=500&search=...
 *
 * Returns rows from ssg_enrolment_record (populated by sync-ssg-enrolments).
 * Filters to enrolments synced in the last 7 days; sorted newest first.
 */
export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') {
    return res.status(405).json({ success: false, error: 'Method not allowed' });
  }

  const limit = Math.min(parseInt(req.query.limit as string, 10) || 100, 500);
  const search = (req.query.search as string || '').trim();

  try {
    const conditions: string[] = [
      `(r.enrolment_date IS NULL OR r.enrolment_date >= CURRENT_DATE - INTERVAL '7 days')`,
      `LOWER(COALESCE(r.status, '')) NOT IN ('admin removed', 'cancelled', 'withdrawn')`,
    ];
    const params: any[] = [];
    let paramIdx = 1;

    if (search) {
      conditions.push(`(
        COALESCE(r.learner_name, '') ILIKE $${paramIdx}
        OR COALESCE(r.learner_nric, '') ILIKE $${paramIdx}
        OR COALESCE(r.learner_email, '') ILIKE $${paramIdx}
        OR r.enrolment_reference ILIKE $${paramIdx}
        OR COALESCE(r.course_title, '') ILIKE $${paramIdx}
        OR COALESCE(r.course_ref_code, '') ILIKE $${paramIdx}
        OR COALESCE(r.course_run_id, '') ILIKE $${paramIdx}
      )`);
      params.push(`%${search}%`);
      paramIdx++;
    }

    const whereClause = `WHERE ${conditions.join(' AND ')}`;

    const dataRes = await pool.query(
      `SELECT
        r.id,
        r.enrolment_reference,
        r.enrolment_date,
        r.learner_name,
        r.learner_nric,
        r.learner_email,
        r.course_title,
        r.course_ref_code,
        r.course_run_id,
        r.start_date,
        r.status
      FROM public.ssg_enrolment_record AS r
      ${whereClause}
      ORDER BY r.enrolment_date DESC NULLS LAST, r.created_at DESC
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
