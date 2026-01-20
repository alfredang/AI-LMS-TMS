import { NextApiRequest, NextApiResponse } from 'next';
import pool from '../../../lib/db';

interface CourseRunAssessment {
  course_run_id: string;
  course_run_code: string;
  course_id: string;
  course_title: string;
  assessment_id: string;
  assessment_title: string;
  assessment_category: string;
  assessment_status: string;
  assessment_created_at: string;
}

interface ApiResponse {
  success: boolean;
  data?: CourseRunAssessment[];
  error?: string;
}

export default async function handler(req: NextApiRequest, res: NextApiResponse<ApiResponse>) {
  if (req.method !== 'GET') {
    return res.status(405).json({ success: false, error: 'Method not allowed' });
  }

  const { courseRunId } = req.query;

  if (!courseRunId || typeof courseRunId !== 'string') {
    return res.status(400).json({ 
      success: false, 
      error: 'Missing or invalid courseRunId parameter' 
    });
  }

  try {
    console.log(`🎯 Fetching assessments for course run: ${courseRunId}`);

    // Both learner and trainer roles now provide courseRunId as UUID
    const actualCourseRunId = courseRunId;

    const query = `
      SELECT 
          cr.id AS course_run_id,
          cr.course_run_id AS course_run_code,
          c.id AS course_id,
          c.title AS course_title,
          a.id AS assessment_id,
          a.title AS assessment_title,
          a.category AS assessment_category,
          a.status AS assessment_status,
          a.created_at AS assessment_created_at
      FROM course_run cr
      JOIN course c ON cr.course_id = c.id
      JOIN assessment a ON c.id = a.course_id
      WHERE cr.id = $1
      ORDER BY a.created_at;
    `;

    const result = await pool.query(query, [actualCourseRunId]);
    
    console.log(`✅ Found ${result.rows.length} assessments for course run ${courseRunId}`);
    
    if (result.rows.length > 0) {
      console.log(`📋 Sample assessment data:`, result.rows[0]);
    }

    return res.status(200).json({
      success: true,
      data: result.rows
    });

  } catch (error) {
    console.error('❌ Error fetching course run assessments:', error);
    return res.status(500).json({
      success: false,
      error: 'Failed to fetch course run assessments'
    });
  }
}