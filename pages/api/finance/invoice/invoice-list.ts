import { NextApiRequest, NextApiResponse } from 'next';
import pool from '../../../../lib/db';

/**
 * GET /api/finance/invoice/proforma-invoices
 * Returns enrollments with pro forma invoice data for the finance role.
 * Supports pagination (page, limit) and filters (courseTitle, startDate, endDate).
 *
 * notGeneratedOnly=true  → only enrollments WHERE pro_forma_url IS NULL
 * generatedOnly=true     → only enrollments WHERE pro_forma_url IS NOT NULL
 */
export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') {
    return res.status(405).json({ success: false, error: 'Method not allowed' });
  }

  const {
    courseTitle, startDate, endDate, courseRun, courseCode,
    name, notGeneratedOnly, generatedOnly, search,
  } = req.query;

  const page = Math.max(1, parseInt(req.query.page as string) || 1);
  const limit = Math.min(parseInt(req.query.limit as string) || 20, 100);
  const offset = (page - 1) * limit;

  try {
    const conditions: string[] = [];
    const params: (string | number)[] = [];
    let paramIndex = 1;

    // Mutually exclusive: notGeneratedOnly takes priority if both somehow passed
    if (notGeneratedOnly === 'true') {
      conditions.push('e.pro_forma_url IS NULL');
    } else if (generatedOnly === 'true') {
      conditions.push('e.pro_forma_url IS NOT NULL');
    }

    if (search && typeof search === 'string' && search.trim()) {
      conditions.push(`(u.full_name ILIKE $${paramIndex} OR c.title ILIKE $${paramIndex} OR c.course_code ILIKE $${paramIndex} OR cr.course_run_id ILIKE $${paramIndex})`);
      params.push(`%${search.trim()}%`);
      paramIndex++;
    }
    if (courseRun && typeof courseRun === 'string' && courseRun.trim()) {
      conditions.push(`cr.course_run_id ILIKE $${paramIndex}`);
      params.push(`%${courseRun.trim()}%`);
      paramIndex++;
    }
    if (courseCode && typeof courseCode === 'string' && courseCode.trim()) {
      conditions.push(`c.course_code ILIKE $${paramIndex}`);
      params.push(`%${courseCode.trim()}%`);
      paramIndex++;
    }
    if (courseTitle && typeof courseTitle === 'string' && courseTitle.trim()) {
      conditions.push(`c.title ILIKE $${paramIndex}`);
      params.push(`%${courseTitle.trim()}%`);
      paramIndex++;
    }
    if (startDate && typeof startDate === 'string') {
      conditions.push(`cr.start_date >= $${paramIndex}::date`);
      params.push(startDate);
      paramIndex++;
    }
    if (endDate && typeof endDate === 'string') {
      conditions.push(`cr.end_date <= $${paramIndex}::date`);
      params.push(endDate);
      paramIndex++;
    }
    if (name && typeof name === 'string' && name.trim()) {
      conditions.push(`u.full_name ILIKE $${paramIndex}`);
      params.push(`%${name.trim()}%`);
      paramIndex++;
    }

    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

    // Count query
    const countResult = await pool.query(
      `SELECT COUNT(*) AS total
       FROM enrollment e
       JOIN course_run cr ON cr.id = e.course_run_id
       JOIN course c ON c.id = e.course_id
       JOIN app_user u ON u.id = e.user_id
       ${whereClause}`,
      params
    );
    const total = parseInt(countResult.rows[0].total);

    // Data query with pagination
    const dataParams = [...params, limit, offset];
    const result = await pool.query(
      `SELECT
        e.id,
        e.enrolment_id,
        u.full_name,
        c.title AS course_title,
        c.course_code,
        cr.course_run_id,
        cr.start_date::text,
        cr.end_date::text,
        e.enrolment_status,
        e.enrolment_date,
        e.payment_status,
        c.course_fees_exclude_gst,
        c.course_fees_include_gst,
        e.pro_forma_url
      FROM enrollment e
      JOIN app_user u ON u.id = e.user_id
      JOIN course_run cr ON cr.id = e.course_run_id
      JOIN course c ON c.id = e.course_id
      ${whereClause}
      ORDER BY e.enrolment_date DESC NULLS LAST, cr.start_date DESC
      LIMIT $${paramIndex} OFFSET $${paramIndex + 1}`,
      dataParams
    );

    return res.status(200).json({
      success: true,
      data: result.rows,
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
    });
  } catch (error) {
    console.error('[finance/invoice/invoice-list] Error:', error);
    return res.status(500).json({ success: false, error: 'Internal server error' });
  }
}