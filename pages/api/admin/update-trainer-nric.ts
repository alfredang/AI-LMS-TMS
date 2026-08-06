import { withAuth } from '@lib/auth/withAuth';
import { NextApiRequest, NextApiResponse } from 'next';
import pool from '../../../lib/db';

async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'PUT') {
    return res.status(405).json({ success: false, message: 'Method not allowed' });
  }

  try {
    const { userId, nric } = req.body;

    if (!userId) {
      return res.status(400).json({ success: false, message: 'userId is required' });
    }

    const nricValue = typeof nric === 'string' ? nric.trim() : null;

    await pool.query(`ALTER TABLE trainer_profile ADD COLUMN IF NOT EXISTS nric TEXT`);
    await pool.query(
      `UPDATE trainer_profile SET nric = $1 WHERE user_id = $2`,
      [nricValue || null, userId]
    );

    return res.status(200).json({ success: true, message: 'NRIC updated successfully' });
  } catch (error) {
    console.error('Error updating trainer NRIC:', error);
    return res.status(500).json({ success: false, message: 'Internal server error' });
  }
}

export default withAuth(handler, { roles: ['admin', 'trainingProvider', 'developer'] });
