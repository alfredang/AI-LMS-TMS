import { NextApiRequest, NextApiResponse } from 'next';
import { Pool } from 'pg';
import { cors } from '../../../lib/cors';

const pool = new Pool({
  user: process.env.DB_USER || 'postgres',
  host: process.env.DB_HOST || 'localhost',
  database: process.env.DB_NAME || 'tertiarydb',
  password: process.env.DB_PASSWORD,
  port: parseInt(process.env.DB_PORT || '5432'),
});

async function handler(req: NextApiRequest, res: NextApiResponse) {
  // Handle CORS
  if (cors(req, res)) {
    return;
  }

  if (req.method !== 'GET') {
    return res.status(405).json({ success: false, error: 'Method not allowed' });
  }

  try {
    console.log('🔍 Checking database state...');
    
    const userId = '11111111-1111-4111-8111-111111111111';
    const courseId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
    
    // Check course runs
    const courseRunQuery = `
      SELECT id, course_id, course_run_id FROM public.course_run 
      WHERE course_id = $1
    `;
    const courseRuns = await pool.query(courseRunQuery, [courseId]);
    
    // Check enrollments
    const enrollmentQuery = `
      SELECT e.id, e.user_id, e.course_id, e.course_run_id, cr.course_run_id as course_run_code
      FROM public.enrollment e
      LEFT JOIN public.course_run cr ON cr.id = e.course_run_id
      WHERE e.user_id = $1
    `;
    const enrollments = await pool.query(enrollmentQuery, [userId]);
    
    return res.status(200).json({
      success: true,
      data: {
        courseRuns: courseRuns.rows,
        enrollments: enrollments.rows
      }
    });
  } catch (error) {
    console.error('❌ Failed to check database state:', error);
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    return res.status(500).json({
      success: false,
      error: errorMessage
    });
  }
}

export default handler;
