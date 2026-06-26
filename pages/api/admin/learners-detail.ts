import type { NextApiRequest, NextApiResponse } from 'next';
import pool from '../../../lib/db';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET') return res.status(405).json({ success: false, message: 'Method not allowed' });

  try {
    const result = await pool.query(`
      SELECT
        au.id AS user_id,
        au.full_name AS learner_name,
        au.email,
        au.secondary_email,
        au.profile_picture_url AS profile_picture,
        au.account_status,
        lp.tel AS telephone,
        lp.nric,
        lp.gender,
        lp.company,
        lp.employment_status,
        lp.nationality,
        lp.ethnicity,
        to_char(lp.dob, 'YYYY-MM-DD') AS dob,  -- plain date string; a raw date column serializes as UTC and drifts a day in SGT (corrupts the edit round-trip)
        (SELECT e.course_sponsorship FROM enrollment e WHERE e.user_id = au.id AND e.course_sponsorship IS NOT NULL ORDER BY e.created_at DESC LIMIT 1) AS sponsorship_type
      FROM app_user au
      LEFT JOIN learner_profile lp ON lp.user_id = au.id
      WHERE au.id IN (
        SELECT DISTINCT user_id FROM user_role_map WHERE role = 'Learner'
      )
      ORDER BY au.full_name;
    `);

    return res.status(200).json({
      success: true,
      data: { learners: result.rows }
    });
  } catch (error) {
    console.error('Error fetching learners:', error);
    return res.status(500).json({ success: false, message: 'Internal server error' });
  }
}
