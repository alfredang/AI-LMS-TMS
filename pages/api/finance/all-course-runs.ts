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
    const courseRunId = (req.query.courseRunId as string || '').trim();
    const status = (req.query.status as string || '').trim();
    const sort = req.query.sort === 'oldest' ? 'ASC' : 'DESC';
    const offset = page * limit;

    // Build WHERE conditions — always exclude incomplete rows
    const conditions: string[] = ['se.enrolment_id IS NOT NULL'];
    const params: (string | number)[] = [];
    let paramIndex = 1;

    if (search) {
      conditions.push(`(
        se.trainee_name ILIKE $${paramIndex}
        OR se.enrolment_id ILIKE $${paramIndex}
        OR se.course_title ILIKE $${paramIndex}
        OR se.course_reference ILIKE $${paramIndex}
        OR se.trainee_nric ILIKE $${paramIndex}
      )`);
      params.push(`%${search}%`);
      paramIndex++;
    }

    if (courseRunId) {
      conditions.push(`(
        se.course_run_id = $${paramIndex}
        OR se.raw_data->'course'->'run'->>'id' = $${paramIndex}
      )`);
      params.push(courseRunId);
      paramIndex++;
    }

    if (status) {
      conditions.push(`se.enrolment_status = $${paramIndex}`);
      params.push(status);
      paramIndex++;
    }

    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

    // Main query: enrolments with lateral-joined grants and claims
    const dataQuery = `
      SELECT
        se.enrolment_id,
        se.trainee_name,
        CASE WHEN se.trainee_nric IS NOT NULL AND LENGTH(se.trainee_nric) > 4
          THEN '****' || RIGHT(se.trainee_nric, 4)
          ELSE se.trainee_nric
        END AS trainee_nric,
        se.course_title,
        se.course_reference,
        se.course_run_id,
        se.enrolment_status,
        se.sponsorship_type,
        se.raw_data->'course'->'run'->>'id' AS course_run_number,
        se.raw_data->'course'->'run'->>'startDate' AS start_date,
        se.raw_data->'course'->'run'->>'endDate' AS end_date,
        se.raw_data->'trainee'->'email'->>'full' AS trainee_email,
        se.raw_data->'trainee'->'contactNumber'->>'phoneNumber' AS trainee_contact,
        se.raw_data->'trainee'->>'dateOfBirth' AS trainee_dob,
        se.raw_data->'trainee'->'employer'->>'uen' AS employer_uen,
        se.raw_data->'trainee'->'employer'->>'name' AS employer_name,
        se.raw_data->'trainee'->'employer'->'contact'->>'fullName' AS employer_contact_name,
        se.raw_data->'trainee'->'employer'->'contact'->'email'->>'full' AS employer_contact_email,
        se.raw_data->'trainee'->'employer'->'contact'->'contactNumber'->>'countryCode' AS employer_phone_country,
        se.raw_data->'trainee'->'employer'->'contact'->'contactNumber'->>'phoneNumber' AS employer_phone,
        se.raw_data->'trainee'->'fees'->>'collectionStatus' AS fee_collection_status,
        bl.grant_id AS bl_grant_id,
        bl.status AS bl_status,
        bl.estimated_grant_amount AS bl_amount,
        nbl.grant_id AS nbl_grant_id,
        nbl.status AS nbl_status,
        nbl.estimated_grant_amount AS nbl_amount,
        nbl.funding_scheme_code AS nbl_scheme,
        sc.claim_id AS sfc_claim_id,
        sc.claim_amount AS sfc_amount,
        sc.payment_date AS sfc_payment_date,
        sc.claim_status AS sfc_status
      FROM ssg_enrolments se
      LEFT JOIN LATERAL (
        SELECT grant_id, status, estimated_grant_amount
        FROM ssg_grants
        WHERE enrollment_id = se.enrolment_id AND funding_scheme_code = 'Baseline'
        ORDER BY (CASE WHEN status = 'Cancelled' THEN 1 ELSE 0 END), grant_id DESC
        LIMIT 1
      ) bl ON true
      LEFT JOIN LATERAL (
        SELECT grant_id, status, estimated_grant_amount, funding_scheme_code
        FROM ssg_grants
        WHERE enrollment_id = se.enrolment_id AND funding_scheme_code != 'Baseline'
        ORDER BY (CASE WHEN status = 'Cancelled' THEN 1 ELSE 0 END), grant_id DESC
        LIMIT 1
      ) nbl ON true
      LEFT JOIN LATERAL (
        SELECT claim_id, claim_amount, payment_date, claim_status
        FROM ssg_claims
        WHERE enrollment_id = se.enrolment_id
        ORDER BY claim_id DESC
        LIMIT 1
      ) sc ON true
      ${whereClause}
      ORDER BY se.enrolment_id ${sort}
      LIMIT $${paramIndex} OFFSET $${paramIndex + 1}
    `;
    params.push(limit, offset);

    // Count query
    const countQuery = `
      SELECT COUNT(*) AS total
      FROM ssg_enrolments se
      ${whereClause}
    `;

    // Stats query (unfiltered for KPI cards)
    const statsQuery = `
      SELECT
        (SELECT COUNT(*) FROM ssg_enrolments WHERE enrolment_id IS NOT NULL) AS total_enrolments,
        COALESCE((SELECT SUM(estimated_grant_amount) FROM ssg_grants WHERE funding_scheme_code = 'Baseline'), 0) AS total_bl,
        COALESCE((SELECT SUM(estimated_grant_amount) FROM ssg_grants WHERE funding_scheme_code != 'Baseline'), 0) AS total_nbl,
        COALESCE((SELECT SUM(claim_amount) FROM ssg_claims), 0) AS total_sfc
    `;

    const statusBreakdownQuery = `
      SELECT enrolment_status AS status, COUNT(*) AS count
      FROM ssg_enrolments
      WHERE enrolment_id IS NOT NULL
      GROUP BY enrolment_status
      ORDER BY count DESC
    `;

    // Filter params exclude the pagination params (limit, offset) added last
    const filterParams = params.slice(0, paramIndex - 1);

    const [dataResult, countResult, statsResult, statusResult] = await Promise.all([
      pool.query(dataQuery, params),
      pool.query(countQuery, filterParams),
      pool.query(statsQuery),
      pool.query(statusBreakdownQuery),
    ]);

    return res.status(200).json({
      success: true,
      data: {
        rows: dataResult.rows,
        total: parseInt(countResult.rows[0].total),
        page,
        limit,
        stats: {
          totalEnrolments: parseInt(statsResult.rows[0].total_enrolments),
          totalBL: parseFloat(statsResult.rows[0].total_bl),
          totalNBL: parseFloat(statsResult.rows[0].total_nbl),
          totalSFC: parseFloat(statsResult.rows[0].total_sfc),
          byStatus: statusResult.rows.map((r: { status: string; count: string }) => ({
            status: r.status,
            count: parseInt(r.count),
          })),
        },
      },
    });
  } catch (error) {
    console.error('[ERROR] [finance/all-course-runs] Failed to fetch:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
}
