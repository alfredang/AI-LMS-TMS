import type { NextApiRequest, NextApiResponse } from 'next';
import pool from '../../../lib/db';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') {
    return res.status(405).json({ success: false, error: 'Method not allowed' });
  }

  try {
    const { search } = req.query;

    let query = `
      SELECT
        u.id AS user_id,
        u.full_name,
        u.email
      FROM app_user u
      JOIN user_role_map r ON r.user_id = u.id AND r.role = 'Learner'
    `;

    const params: any[] = [];

    if (search && search !== '') {
      query += ` WHERE (u.full_name ILIKE $1 OR u.email ILIKE $1)`;
      params.push(`%${search}%`);
    }

    query += ` ORDER BY u.full_name LIMIT 5000`;

    const result = await pool.query(query, params);

    res.status(200).json({
      success: true,
      data: result.rows,
    });
  } catch (error) {
    console.error('Error fetching learners:', error);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
}
