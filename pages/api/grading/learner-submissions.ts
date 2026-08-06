import { withAuth } from '@lib/auth/withAuth';
import { NextApiRequest, NextApiResponse } from 'next';
import pool from '../../../lib/db';

interface LearnerSubmission {
  course_run_id: string;
  course_run_code: string;
  course_id: string;
  course_title: string;
  learner_id: string;
  learner_name: string;
  learner_email: string;
  assessment_id: string;
  assessment_title: string;
  submission_id: string | null;
  submission_file: string | null;
  file_url: string | null;
  submitted_at: string | null;
  grading: string | null;
}

interface ApiResponse {
  success: boolean;
  data?: LearnerSubmission[];
  error?: string;
}

async function handler(req: NextApiRequest, res: NextApiResponse<ApiResponse>) {
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
    console.log(`📊 Fetching submissions for course run: ${courseRunId}`);

    // Both learner and trainer roles now provide courseRunId as UUID
    const actualCourseRunId = courseRunId;

    const query = `
      SELECT 
          cr.id AS course_run_id,
          cr.course_run_id AS course_run_code,
          c.id AS course_id,
          c.title AS course_title,
          u.id AS learner_id,
          u.full_name AS learner_name,
          u.email AS learner_email,
          a.id AS assessment_id,
          a.title AS assessment_title,
          sub.id AS submission_id,
          sub.file_name AS submission_file,
          sub.file_url,
          sub.submitted_at,
          sub.grading
      FROM course_run cr
      JOIN course c ON cr.course_id = c.id
      JOIN enrollment e ON cr.id = e.course_run_id
      JOIN app_user u ON e.user_id = u.id
      JOIN assessment a ON c.id = a.course_id
      LEFT JOIN submission sub ON e.id = sub.enrollment_id AND a.id = sub.assessment_id
      WHERE cr.id = $1
      ORDER BY u.full_name, a.title;
    `;

    const result = await pool.query(query, [actualCourseRunId]);
    
    console.log(`✅ Found ${result.rows.length} submission records for course run ${courseRunId}`);
    
    if (result.rows.length > 0) {
      console.log(`📋 Sample submission data:`, result.rows[0]);
    }

    return res.status(200).json({
      success: true,
      data: result.rows
    });

  } catch (error) {
    console.error('❌ Error fetching learner submissions:', error);
    return res.status(500).json({
      success: false,
      error: 'Failed to fetch learner submissions'
    });
  }
}

export default withAuth(handler, { roles: ['admin', 'trainingProvider', 'developer', 'trainer'] });
