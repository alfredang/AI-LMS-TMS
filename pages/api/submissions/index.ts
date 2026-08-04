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
        s.id              AS submission_id,
        s.file_name,
        s.submitted_at,
        s.file_url,
        a.id              AS assessment_id,
        a.title           AS assessment_title,
        a.category        AS assessment_category,
        a.status          AS assessment_status,
        a.file_url        AS assessment_file_url,
        e.id              AS enrollment_id,
        cr.course_run_id,
        c.id              AS course_id,
        c.title           AS course_title
      FROM public.submission s
      JOIN public.enrollment e   ON e.id = s.enrollment_id
      JOIN public.assessment a   ON a.id = s.assessment_id
      JOIN public.course c       ON c.id = e.course_id
      JOIN public.course_run cr  ON cr.id = e.course_run_id
      WHERE e.user_id = $1
        AND c.id = $2
      ORDER BY s.submitted_at DESC
    `;

    const result = await pool.query(query, [userId, courseId]);

    return res.status(200).json({
      success: true,
      data: result.rows
    });
  } catch (error) {
    console.error('Error fetching submissions:', error);
    return res.status(500).json({
      success: false,
      error: 'Internal server error'
    });
  }
}

export default withAuth(handler);