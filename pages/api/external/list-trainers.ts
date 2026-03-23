import type { NextApiRequest, NextApiResponse } from 'next';
import pool from '../../../lib/db';

/**
 * External API — List Trainers
 *
 * GET /api/external/list-trainers
 * GET /api/external/list-trainers?status=Active
 *
 * Headers:
 *   x-api-key: <EXTERNAL_API_KEY_FOR_CLAWDBOT>
 */
export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') {
    return res.status(405).json({ success: false, error: 'Method not allowed' });
  }

  const apiKey = req.headers['x-api-key'];
  const validKey = process.env.EXTERNAL_API_KEY_FOR_CLAWDBOT;
  if (!validKey) return res.status(500).json({ success: false, error: 'API key not configured on server' });
  if (!apiKey || apiKey !== validKey) return res.status(401).json({ success: false, error: 'Invalid or missing API key' });

  try {
    const { status } = req.query;

    let query = `
      SELECT
        au.id AS user_id,
        au.full_name,
        au.email,
        au.secondary_email,
        tp.trainer_type,
        tp.status AS trainer_status,
        au.account_status
      FROM app_user au
      JOIN trainer_profile tp ON tp.user_id = au.id
      WHERE 1=1
    `;
    const params: any[] = [];

    if (status) {
      params.push(status);
      query += ` AND tp.status = $${params.length}`;
    }

    query += ` ORDER BY au.full_name`;

    const result = await pool.query(query, params);

    return res.status(200).json({
      success: true,
      count: result.rows.length,
      data: result.rows,
    });
  } catch (error) {
    console.error('list-trainers error:', error);
    return res.status(500).json({ success: false, error: 'Internal server error' });
  }
}
