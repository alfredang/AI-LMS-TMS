import { withAuth } from '@lib/auth/withAuth';
import { NextApiRequest, NextApiResponse } from 'next';
import pool from '../../../lib/db';

async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') {
    return res.status(405).json({ message: 'Method not allowed' });
  }

  const { id } = req.query;

  if (!id || typeof id !== 'string') {
    return res.status(400).json({ message: 'User id is required' });
  }

  try {
    // Check if ssg_enrolments table exists
    const tableCheck = await pool.query(
      `SELECT EXISTS (
        SELECT FROM information_schema.tables
        WHERE table_schema = 'public'
          AND table_name = 'ssg_enrolments'
      ) AS exists`
    );
    const ssgTableExists = tableCheck.rows[0].exists as boolean;

    // Build the fallback LATERAL join only if ssg_enrolments exists
    const ssgLateral = ssgTableExists
      ? `LEFT JOIN LATERAL (
          SELECT raw_data
          FROM ssg_enrolments
          WHERE raw_data->'trainee'->'email'->>'full' = u.email
            AND raw_data IS NOT NULL
            AND raw_data != '{}'::jsonb
          ORDER BY created_at DESC
          LIMIT 1
        ) se ON true`
      : '';

    // COALESCE: prefer enrollment raw_data, fall back to ssg_enrolments if it exists
    const rawDataExpr = ssgTableExists
      ? `COALESCE(enr.raw_data, se.raw_data)`
      : `enr.raw_data`;

    const result = await pool.query(
      `SELECT
        u.id,
        u.full_name,
        u.email,
        u.email AS "loginId",
        u.profile_picture_url AS "profilePictureUrl",
        u.password,
        u.created_at AS "createdAt",
        u.updated_at AS "updatedAt",
        lp.nric,
        lp.tel,
        to_char(lp.dob, 'YYYY-MM-DD') AS dob,
        lp.gender,
        lp.nationality,
        lp.ethnicity,
        lp.company,
        lp.employment_status AS "employmentStatus",
        lp.invoice_url,
        lp.receipt_url,
        lp.pro_forma_url AS "pro_formal_url",
        -- SSG-sourced fields: enrollment is primary, ssg_enrolments is fallback
        ${rawDataExpr}->'trainee'->>'id'                                    AS ssg_nric,
        ${rawDataExpr}->'trainee'->'idType'->>'type'                        AS ssg_id_type,
        ${rawDataExpr}->'trainee'->>'dateOfBirth'                           AS ssg_dob,
        ${rawDataExpr}->'trainee'->'contactNumber'->>'countryCode'          AS ssg_country_code,
        ${rawDataExpr}->'trainee'->'contactNumber'->>'areaCode'             AS ssg_area_code,
        ${rawDataExpr}->'trainee'->'contactNumber'->>'phoneNumber'          AS ssg_phone,
        ${rawDataExpr}->'trainingPartner'->>'uen'                           AS ssg_tp_uen,
        ${rawDataExpr}->'trainingPartner'->>'code'                          AS ssg_tp_code
      FROM app_user u
      LEFT JOIN learner_profile lp ON u.id = lp.user_id
      LEFT JOIN LATERAL (
        SELECT raw_data
        FROM enrollment
        WHERE raw_data->'trainee'->'email'->>'full' = u.email
          AND raw_data IS NOT NULL
          AND raw_data != '{}'::jsonb
        ORDER BY created_at DESC
        LIMIT 1
      ) enr ON true
      ${ssgLateral}
      WHERE u.id = $1
      LIMIT 1`,
      [id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ success: false, message: 'Learner not found' });
    }

    const data = result.rows[0];

    console.log('Learner profile data:', data);
    res.status(200).json({ success: true, data });
  } catch (error) {
    console.error('Error fetching learner profile:', error);
    res.status(500).json({ success: false, message: 'Internal server error' });
  }
}

export default withAuth(handler);
