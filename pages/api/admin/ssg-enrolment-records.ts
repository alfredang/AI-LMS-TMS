import type { NextApiRequest, NextApiResponse } from 'next';
import pool from '../../../lib/db';

/**
 * GET /api/admin/ssg-enrolment-records?page=0&limit=20&search=...
 *
 * Returns SSG enrolment records from the local ssg_enrolment_record table,
 * ordered by enrolment_date DESC. Supports pagination and search.
 */
export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') {
    return res.status(405).json({ success: false, error: 'Method not allowed' });
  }

  const page = parseInt(req.query.page as string, 10) || 0;
  const limit = Math.min(parseInt(req.query.limit as string, 10) || 20, 100);
  const search = (req.query.search as string || '').trim();
  const offset = page * limit;

  try {
    let whereClause = '';
    const params: any[] = [];
    let paramIdx = 1;

    if (search) {
      whereClause = `WHERE enrolment_reference ILIKE $${paramIdx}
        OR learner_name ILIKE $${paramIdx}
        OR learner_nric ILIKE $${paramIdx}
        OR learner_email ILIKE $${paramIdx}
        OR course_title ILIKE $${paramIdx}
        OR course_ref_code ILIKE $${paramIdx}
        OR course_run_id ILIKE $${paramIdx}`;
      params.push(`%${search}%`);
      paramIdx++;
    }

    const countRes = await pool.query(
      `SELECT COUNT(*)::int AS total FROM ssg_enrolment_record ${whereClause}`,
      params
    );
    const total = countRes.rows[0].total;

    const dataRes = await pool.query(
      `SELECT id, enrolment_reference, enrolment_date, learner_name, learner_nric,
              learner_email, course_title, course_ref_code, course_run_id, start_date, status
       FROM ssg_enrolment_record
       ${whereClause}
       ORDER BY enrolment_date DESC NULLS LAST, created_at DESC
       LIMIT $${paramIdx} OFFSET $${paramIdx + 1}`,
      [...params, limit, offset]
    );

    return res.status(200).json({
      success: true,
      data: dataRes.rows,
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
    });
  } catch (err) {
    console.error('❌ ssg-enrolment-records error:', err);
    return res.status(500).json({
      success: false,
      error: err instanceof Error ? err.message : 'Internal server error',
    });
  }
}
