import { withAuth } from '@lib/auth/withAuth';
import { NextApiRequest, NextApiResponse } from 'next';
import pool from '../../../lib/db';
import { cors } from '../../../lib/cors';

interface LearnerAssessment {
  assessment_id: string;
  assessment_title: string;
  published: boolean;
  published_at: string | null;
  course_run_id: string;
  learner_id: string;
  category?: string;
  status?: string;
  file_url?: string;
}

interface ApiResponse {
  success: boolean;
  data?: LearnerAssessment[];
  error?: string;
}

async function handler(
  req: NextApiRequest,
  res: NextApiResponse<ApiResponse>
) {
  // Apply CORS middleware
  if (cors(req, res)) {
    return; // Preflight handled
  }

  if (req.method !== 'GET') {
    return res.status(405).json({
      success: false,
      error: 'Method not allowed. Use GET.'
    });
  }

  try {
    const { courseRunId, learnerId } = req.query;

    if (!courseRunId || !learnerId) {
      return res.status(400).json({
        success: false,
        error: 'courseRunId and learnerId are required'
      });
    }

    // Get assessments with publish status for a specific learner
    const query = `
      SELECT 
        a.id AS assessment_id,
        a.title AS assessment_title,
        a.category,
        a.status,
        a.file_url,
        COALESCE(cra.published, false) AS published,
        cra.published_at,
        cr.course_run_id,
        e.user_id AS learner_id
      FROM course_run_assessment cra
      JOIN assessment a 
        ON cra.assessment_id = a.id
      JOIN course_run cr 
        ON cra.course_run_id = cr.id
      JOIN enrollment e 
        ON e.course_run_id = cr.id
      WHERE cr.id = $1
        AND e.user_id = $2
      ORDER BY a.title;
    `;

    const result = await pool.query(query, [courseRunId, learnerId]);

    return res.status(200).json({
      success: true,
      data: result.rows
    });

  } catch (error) {
    console.error('❌ Error fetching learner assessments:', error);
    return res.status(500).json({
      success: false,
      error: 'Failed to fetch assessments'
    });
  }
}

export default withAuth(handler);
