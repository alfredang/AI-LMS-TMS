import { withAuth } from '@lib/auth/withAuth';
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

  if (req.method !== 'POST') {
    return res.status(405).json({ success: false, error: 'Method not allowed' });
  }

  try {
    console.log('🔄 Creating test enrollment data...');
    
    const userId = '11111111-1111-4111-8111-111111111111';
    const courseId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
    
    // First, check if course_run exists for this course
    const courseRunQuery = `
      SELECT id, course_run_id FROM public.course_run 
      WHERE course_id = $1 
      LIMIT 1
    `;
    
    let courseRunResult = await pool.query(courseRunQuery, [courseId]);
    
    if (courseRunResult.rows.length === 0) {
      // Create a course run if none exists
      const createCourseRunQuery = `
        INSERT INTO public.course_run (id, course_id, course_run_id, start_date, end_date, max_capacity, current_enrollment)
        VALUES (gen_random_uuid(), $1, 'WD001-2024-Q1', '2024-01-01', '2024-03-31', 30, 1)
        RETURNING id, course_run_id
      `;
      courseRunResult = await pool.query(createCourseRunQuery, [courseId]);
      console.log('✅ Created course run');
    }
    
    const courseRunId = courseRunResult.rows[0].id;
    const courseRunCode = courseRunResult.rows[0].course_run_id;
    
    // Check if enrollment exists
    const enrollmentQuery = `
      SELECT id FROM public.enrollment 
      WHERE user_id = $1 AND course_run_id = $2
    `;
    
    let enrollmentResult = await pool.query(enrollmentQuery, [userId, courseRunId]);
    
    if (enrollmentResult.rows.length === 0) {
      // Create enrollment if none exists
      const createEnrollmentQuery = `
        INSERT INTO public.enrollment (id, user_id, course_id, course_run_id, progress_percent, payment_status, enrolment_date)
        VALUES (gen_random_uuid(), $1, $2, $3, 0, 'Completed', CURRENT_DATE)
        RETURNING id
      `;
      enrollmentResult = await pool.query(createEnrollmentQuery, [userId, courseId, courseRunId]);
      console.log('✅ Created enrollment');
    }
    
    const enrollmentId = enrollmentResult.rows[0].id;
    
    return res.status(200).json({
      success: true,
      data: {
        userId,
        courseId,
        courseRunId,
        courseRunCode,
        enrollmentId
      },
      message: 'Test enrollment data ready'
    });
  } catch (error) {
    console.error('❌ Failed to create test enrollment:', error);
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    return res.status(500).json({
      success: false,
      error: errorMessage
    });
  }
}

export default withAuth(handler, { roles: ['admin', 'trainingProvider', 'developer'] });