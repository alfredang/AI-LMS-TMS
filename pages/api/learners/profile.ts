import { NextApiRequest, NextApiResponse } from 'next';
import pool from '../../../lib/db';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') {
    return res.status(405).json({ message: 'Method not allowed' });
  }

  const { id } = req.query;

  if (!id || typeof id !== 'string') {
    return res.status(400).json({ message: 'User id is required' });
  }

  try {
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
        lp.pro_forma_url AS "pro_formal_url"
      FROM app_user u
      LEFT JOIN learner_profile lp ON u.id = lp.user_id
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
