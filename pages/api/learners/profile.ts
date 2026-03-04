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
    const userResult = await pool.query(
      `SELECT id, full_name, email FROM app_user WHERE id = $1 LIMIT 1`,
      [id]
    );

    if (userResult.rows.length === 0) {
      return res.status(404).json({ success: false, message: 'Learner not found' });
    }

    const profileResult = await pool.query(
      `SELECT nric, tel, to_char(dob, 'YYYY-MM-DD') AS dob FROM learner_profile WHERE user_id = $1 LIMIT 1`,
      [id]
    );

    console.log('Profile query rows count:', profileResult.rows.length);
    console.log('Profile query raw result:', profileResult.rows[0]);

    const user = userResult.rows[0];
    const profile = profileResult.rows[0] ?? {};

    const data = {
      id: user.id,
      full_name: user.full_name,
      email: user.email,
      nric: profile.nric ?? null,
      tel: profile.tel ?? null,
      dob: profile.dob ?? null,
    };

    console.log('Learner profile data:', data);
    res.status(200).json({ success: true, data });
  } catch (error) {
    console.error('Error fetching learner profile:', error);
    res.status(500).json({ success: false, message: 'Internal server error' });
  }
}
