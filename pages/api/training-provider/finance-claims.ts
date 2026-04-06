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
        sc.trainee_name ILIKE $${paramIndex}
        OR sc.claim_id ILIKE $${paramIndex}
        OR sc.grant_id ILIKE $${paramIndex}
        OR sc.enrollment_id ILIKE $${paramIndex}
      )`);
      params.push(`%${search}%`);
      paramIndex++;
    }

    if (status) {
      conditions.push(`sc.claim_status = $${paramIndex}`);
      params.push(status);
      paramIndex++;
    }

    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

    // Data query with pagination
    const dataQuery = `
      SELECT
        sc.claim_id,
        sc.grant_id,
        sc.enrollment_id,
        sc.trainee_name,
        sc.individual_nric,
        sc.course_reference,
        sc.claim_status,
        sc.claim_amount,
        sc.submission_date,
        sc.approval_date,
        sc.payment_date
      FROM ssg_claims sc
      ${whereClause}
      ORDER BY sc.submission_date ${sort} NULLS LAST
      LIMIT $${paramIndex} OFFSET $${paramIndex + 1}
    `;
    params.push(limit, offset);

    // Count query
    const countQuery = `
      SELECT COUNT(*) as total
      FROM ssg_claims sc
      ${whereClause}
    `;

    // Stats query (always unfiltered for KPI cards)
    const statsQuery = `
      SELECT
        COUNT(*) as total_claims,
        COALESCE(SUM(claim_amount), 0) as total_amount,
        COALESCE(SUM(CASE WHEN claim_status = 'Disbursed' THEN claim_amount ELSE 0 END), 0) as total_disbursed
      FROM ssg_claims
    `;

    const statusBreakdownQuery = `
      SELECT claim_status as status, COUNT(*) as count
      FROM ssg_claims
      GROUP BY claim_status
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
        claims: dataResult.rows,
        total: parseInt(countResult.rows[0].total),
        page,
        limit,
        stats: {
          totalClaims: parseInt(statsResult.rows[0].total_claims),
          totalAmount: parseFloat(statsResult.rows[0].total_amount),
          totalDisbursed: parseFloat(statsResult.rows[0].total_disbursed),
          byStatus: statusResult.rows.map((r: { status: string; count: string }) => ({
            status: r.status,
            count: parseInt(r.count),
          })),
        },
      },
    });
  } catch (error) {
    console.error('Error fetching finance claims:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
}
