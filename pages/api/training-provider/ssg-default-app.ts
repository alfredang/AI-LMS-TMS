import type { NextApiRequest, NextApiResponse } from 'next';
import pool from '../../../lib/db';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });
  try {
    const result = await pool.query('SELECT ssg_default_app FROM training_provider LIMIT 1');
    const defaultApp = result.rows[0]?.ssg_default_app || 'app1';
    return res.status(200).json({ success: true, defaultApp });
  } catch {
    return res.status(200).json({ success: true, defaultApp: 'app1' });
  }
}
