import type { NextApiRequest, NextApiResponse } from 'next';
import pool from '../../../lib/db';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const result = await pool.query(
      `SELECT id, company_name FROM training_provider ORDER BY company_name ASC`
    );
    return res.status(200).json({ success: true, companies: result.rows });
  } catch (error: any) {
    console.error('Failed to fetch companies:', error);
    return res.status(500).json({ error: 'Failed to fetch companies' });
  }
}
