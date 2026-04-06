import type { NextApiRequest, NextApiResponse } from 'next';
import pool from '../../../lib/db';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', ['GET']);
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const page = parseInt(req.query.page as string) || 0;
    const limit = Math.min(parseInt(req.query.limit as string) || 20, 100);
    const search = (req.query.search as string || '').trim();
    const status = (req.query.status as string || '').trim();
    const sort = req.query.sort === 'oldest' ? 'ASC' : 'DESC';
    const offset = page * limit;

    // Build WHERE conditions
    const conditions: string[] = [];
    const params: (string | number)[] = [];
    let paramIndex = 1;

    if (search) {
      conditions.push(`(
        se.trainee_name ILIKE $${paramIndex}
        OR sg.grant_id ILIKE $${paramIndex}
        OR sg.enrollment_id ILIKE $${paramIndex}
        OR sg.funding_scheme_description ILIKE $${paramIndex}
      )`);
      params.push(`%${search}%`);
      paramIndex++;
    }

    if (status) {
      conditions.push(`sg.status = $${paramIndex}`);
      params.push(status);
      paramIndex++;
    }

    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

    // Data query with pagination
    const dataQuery = `
      SELECT
        sg.grant_id,
        sg.enrollment_id,
        sg.status,
        sg.funding_scheme_description,
        sg.component_description,
        sg.estimated_grant_amount,
        sg.approved_grant_amount,
        se.trainee_name,
        se.trainee_nric
      FROM ssg_grants sg
      LEFT JOIN ssg_enrolments se ON sg.enrollment_id = se.enrolment_id
      ${whereClause}
      ORDER BY sg.grant_id ${sort}
      LIMIT $${paramIndex} OFFSET $${paramIndex + 1}
    `;
    params.push(limit, offset);

    // Count query
    const countQuery = `
      SELECT COUNT(*) as total
      FROM ssg_grants sg
      LEFT JOIN ssg_enrolments se ON sg.enrollment_id = se.enrolment_id
      ${whereClause}
    `;

    // Stats query (always unfiltered for KPI cards)
    const statsQuery = `
      SELECT
        COUNT(*) as total_grants,
        COALESCE(SUM(estimated_grant_amount), 0) as total_estimated,
        COALESCE(SUM(approved_grant_amount), 0) as total_approved
      FROM ssg_grants
    `;

    const statusBreakdownQuery = `
      SELECT status, COUNT(*) as count
      FROM ssg_grants
      GROUP BY status
      ORDER BY count DESC
    `;

    const [dataResult, countResult, statsResult, statusResult] = await Promise.all([
      pool.query(dataQuery, params),
      pool.query(countQuery, params.slice(0, -2)),
      pool.query(statsQuery),
      pool.query(statusBreakdownQuery),
    ]);

    return res.status(200).json({
      success: true,
      data: {
        grants: dataResult.rows,
        total: parseInt(countResult.rows[0].total),
        page,
        limit,
        stats: {
          totalGrants: parseInt(statsResult.rows[0].total_grants),
          totalEstimated: parseFloat(statsResult.rows[0].total_estimated),
          totalApproved: parseFloat(statsResult.rows[0].total_approved),
          byStatus: statusResult.rows.map((r: { status: string; count: string }) => ({
            status: r.status,
            count: parseInt(r.count),
          })),
        },
      },
    });
  } catch (error) {
    console.error('Error fetching finance grants:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
}
