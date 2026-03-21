import { NextApiRequest, NextApiResponse } from 'next';
import pool from '../../../lib/db';
import { cors } from '../../../lib/cors';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (cors(req, res)) return;
  if (req.method !== 'GET') return res.status(405).json({ success: false, error: 'Method not allowed' });

  const { userId, courseRunId } = req.query;
  if (!userId || !courseRunId) {
    return res.status(400).json({ success: false, error: 'userId and courseRunId are required' });
  }

  try {
    const result = await pool.query(
      `SELECT topic_id FROM public.topic_completion
       WHERE user_id = $1 AND course_run_id = $2`,
      [userId, courseRunId]
    );

    return res.status(200).json({ success: true, data: result.rows });
  } catch (error: any) {
    console.error('❌ Error fetching topic completions:', error?.message);
    return res.status(500).json({ success: false, error: error?.message || 'Internal server error' });
  }
}
