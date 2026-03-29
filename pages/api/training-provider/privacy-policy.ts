import pool from '../../../lib/db';
import { cors } from '../../../lib/cors';
import { NextApiRequest, NextApiResponse } from 'next';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  await cors(req, res);

  if (req.method === 'GET') {
    try {
      // Get the privacy policy from the first training provider
      let privacyPolicy: string | null = null;
      try {
        const result = await pool.query('SELECT privacy_policy FROM training_provider LIMIT 1');
        if (result.rows.length > 0) {
          privacyPolicy = result.rows[0].privacy_policy;
        }
      } catch (e) {
        // Column doesn't exist yet, return null
        console.log('privacy_policy column does not exist yet');
      }

      return res.status(200).json({
        success: true,
        data: { privacyPolicy }
      });
    } catch (error) {
      console.error('Error fetching privacy policy:', error);
      return res.status(500).json({ success: false, error: 'Failed to fetch privacy policy' });
    }
  }

  if (req.method === 'PUT') {
    try {
      const { privacyPolicy } = req.body;

      if (typeof privacyPolicy !== 'string') {
        return res.status(400).json({ success: false, error: 'privacyPolicy must be a string' });
      }

      // Ensure column exists, then update
      try {
        await pool.query('UPDATE training_provider SET privacy_policy = $1', [privacyPolicy]);
      } catch (e) {
        // Column doesn't exist, create it and retry
        await pool.query('ALTER TABLE training_provider ADD COLUMN IF NOT EXISTS privacy_policy TEXT');
        await pool.query('UPDATE training_provider SET privacy_policy = $1', [privacyPolicy]);
      }

      return res.status(200).json({ success: true, message: 'Privacy policy updated successfully' });
    } catch (error) {
      console.error('Error updating privacy policy:', error);
      return res.status(500).json({ success: false, error: 'Failed to update privacy policy' });
    }
  }

  return res.status(405).json({ success: false, error: 'Method not allowed' });
}
