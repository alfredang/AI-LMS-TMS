import { NextApiRequest, NextApiResponse } from 'next';
import pool from '../../../lib/db';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') {
    return res.status(405).json({ message: 'Method not allowed' });
  }

  try {
    const { query: searchQuery } = req.query;

    if (!searchQuery || typeof searchQuery !== 'string') {
      return res.status(400).json({ message: 'Search query is required' });
    }

    const term = `%${searchQuery}%`;

    // Search app_user by full_name or email, restricted to Learner role
    const result = await pool.query(
      `SELECT
         u.id,
         u.full_name AS name,
         u.email
       FROM app_user u
       JOIN user_role_map r ON r.user_id = u.id AND r.role = 'Learner'
       WHERE
         LOWER(u.full_name) LIKE LOWER($1)
         OR LOWER(u.email)  LIKE LOWER($1)
       ORDER BY u.full_name
       LIMIT 20`,
      [term]
    );

    res.status(200).json({
      success: true,
      data: result.rows,
    });
  } catch (error) {
    console.error('Error searching learners:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error',
    });
  }
}