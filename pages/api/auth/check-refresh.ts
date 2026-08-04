import { withAuth } from '@lib/auth/withAuth';
import { NextApiRequest, NextApiResponse } from 'next';
import pool from '../../../lib/db';

// GET ?userId=X&since=ISO_TIMESTAMP
// Returns { refresh: true } if the learner's enrollments changed since `since`
async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') return res.status(405).end();

  const { userId, since } = req.query;
  if (!userId || !since) return res.status(400).json({ refresh: false });

  try {
    const result = await pool.query(
      `SELECT courses_updated_at FROM app_user WHERE id = $1`,
      [userId]
    );
    if (result.rows.length === 0) return res.status(200).json({ refresh: false });

    const updatedAt: Date | null = result.rows[0].courses_updated_at;
    const sinceDate = new Date(since as string);
    const refresh = updatedAt !== null && updatedAt > sinceDate;

    return res.status(200).json({ refresh });
  } catch {
    return res.status(200).json({ refresh: false });
  }
}

export default withAuth(handler);
