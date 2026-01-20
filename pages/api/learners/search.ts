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

    // Search for learners by name or email
    const learners = await pool.query(
      `SELECT 
        user_id,
        name,
        email
      FROM 
        users
      WHERE 
        user_type = 'learner' 
        AND (
          LOWER(name) LIKE LOWER($1)
          OR LOWER(email) LIKE LOWER($1)
        )
      ORDER BY name
      LIMIT 10`,
      [`%${searchQuery}%`]
    );

    res.status(200).json({
      success: true,
      data: learners.rows
    });
  } catch (error) {
    console.error('Error searching learners:', error);
    res.status(500).json({ 
      success: false, 
      message: 'Internal server error' 
    });
  }
}