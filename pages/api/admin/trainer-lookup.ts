import type { NextApiRequest, NextApiResponse } from 'next';
import pool from '../../../lib/db';

/**
 * GET /api/admin/trainer-lookup?query=...
 * Returns trainers matching the query by name or email.
 */
export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') {
    return res.status(405).json({ success: false, message: 'Method not allowed' });
  }

  const { query } = req.query;
  if (!query || typeof query !== 'string') {
    return res.status(400).json({ success: false, message: 'query is required' });
  }

  const term = `%${query.trim()}%`;

  try {
    const result = await pool.query(
      `SELECT au.full_name AS name, au.email
       FROM trainer_profile tp
       JOIN app_user au ON au.id = tp.user_id
       WHERE LOWER(au.full_name) LIKE LOWER($1)
          OR LOWER(au.email)     LIKE LOWER($1)
       ORDER BY au.full_name
       LIMIT 10`,
      [term]
    );

    res.status(200).json({ success: true, data: result.rows });
  } catch (err) {
    console.error('[trainer-lookup] error:', err);
    res.status(500).json({ success: false, message: 'Internal server error' });
  }
}
