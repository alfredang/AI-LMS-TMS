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

  const { userId, courseId } = req.query;

  if (!userId || !courseId) {
    return res.status(400).json({ 
      success: false, 
      error: 'Missing required parameters: userId and courseId' 
    });
  }

  try {
    const query = `
      SELECT 
        e.id          AS enrollment_id,
        e.certificate AS certificate_url,
        c.id          AS course_id,
        c.title       AS course_title,
        cr.course_run_id,
        c.course_code
      FROM public.enrollment e
      JOIN public.course c      ON c.id = e.course_id
      JOIN public.course_run cr ON cr.id = e.course_run_id
      WHERE e.user_id  = $1
        AND e.course_id = $2
    `;

    const result = await pool.query(query, [userId, courseId]);

    return res.status(200).json({
      success: true,
      data: result.rows[0] || null
    });
  } catch (error) {
    console.error('Error fetching certificate:', error);
    return res.status(500).json({
      success: false,
      error: 'Internal server error'
    });
  }
}

export default withAuth(handler);