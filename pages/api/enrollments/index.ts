import { withAuth } from '@lib/auth/withAuth';
import { NextApiRequest, NextApiResponse } from 'next';
import pool from '../../../lib/db';
import { cors } from '../../../lib/cors';

async function handler(req: NextApiRequest, res: NextApiResponse) {
  // Handle CORS
  if (cors(req, res)) {
    return;
  }

  if (req.method !== 'GET') {
    return res.status(405).json({ success: false, error: 'Method not allowed' });
  }

  const { userId, courseRunId } = req.query;

  if (!userId || !courseRunId) {
    return res.status(400).json({ 
      success: false, 
      error: 'Missing required parameters: userId and courseRunId' 
    });
  }

  try {
    const query = `
      SELECT 
        e.id,
        e.user_id,
        e.course_run_id
      FROM public.enrollment e
      WHERE e.user_id = $1 AND e.course_run_id = $2
    `;

    const result = await pool.query(query, [userId, courseRunId]);

    return res.status(200).json({
      success: true,
      data: result.rows
    });
  } catch (error) {
    console.error('Error fetching enrollment:', error);
    return res.status(500).json({
      success: false,
      error: 'Internal server error'
    });
  }
}

export default withAuth(handler);