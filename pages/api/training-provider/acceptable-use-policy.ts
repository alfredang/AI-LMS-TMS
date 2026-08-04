import { withAuth } from '@lib/auth/withAuth';
import pool from '../../../lib/db';
import { cors } from '../../../lib/cors';
import { NextApiRequest, NextApiResponse } from 'next';

async function handler(req: NextApiRequest, res: NextApiResponse) {
  await cors(req, res);

  if (req.method === 'GET') {
    try {
      let acceptableUsePolicy: string | null = null;
      try {
        const result = await pool.query('SELECT acceptable_use_policy FROM training_provider LIMIT 1');
        if (result.rows.length > 0) {
          acceptableUsePolicy = result.rows[0].acceptable_use_policy;
        }
      } catch (e) {
        console.log('acceptable_use_policy column does not exist yet');
      }

      return res.status(200).json({
        success: true,
        data: { acceptableUsePolicy }
      });
    } catch (error) {
      console.error('Error fetching acceptable use policy:', error);
      return res.status(500).json({ success: false, error: 'Failed to fetch acceptable use policy' });
    }
  }

  if (req.method === 'PUT') {
    try {
      const { acceptableUsePolicy } = req.body;

      if (typeof acceptableUsePolicy !== 'string') {
        return res.status(400).json({ success: false, error: 'acceptableUsePolicy must be a string' });
      }

      try {
        await pool.query('UPDATE training_provider SET acceptable_use_policy = $1', [acceptableUsePolicy]);
      } catch (e) {
        await pool.query('ALTER TABLE training_provider ADD COLUMN IF NOT EXISTS acceptable_use_policy TEXT');
        await pool.query('UPDATE training_provider SET acceptable_use_policy = $1', [acceptableUsePolicy]);
      }

      return res.status(200).json({ success: true, message: 'Acceptable use policy updated successfully' });
    } catch (error) {
      console.error('Error updating acceptable use policy:', error);
      return res.status(500).json({ success: false, error: 'Failed to update acceptable use policy' });
    }
  }

  return res.status(405).json({ success: false, error: 'Method not allowed' });
}

export default withAuth(handler, { roles: ['admin', 'trainingProvider'] });
