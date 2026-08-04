import { withAuth } from '@lib/auth/withAuth';
import { NextApiRequest, NextApiResponse } from 'next';
import pool from '../../../lib/db';
import { cors } from '../../../lib/cors';

interface TrainerAssessment {
  assessment_id: string;
  assessment_title: string;
  category: string;
  status: string;
  deadline: string | null;
  published: boolean;
  published_at: string | null;
  course_run_id: string;
  course_title: string;
  trainer_id: string;
}

interface ApiResponse {
  success: boolean;
  data?: TrainerAssessment[];
  error?: string;
}

async function handler(req: NextApiRequest, res: NextApiResponse<ApiResponse>) {
  // Enable CORS and handle preflight
  if (cors(req, res)) {
    return; // Preflight request handled
  }

  if (req.method !== 'GET') {
    return res.status(405).json({ success: false, error: 'Method not allowed' });
  }

  try {
    const { courseRunId, trainerId } = req.query;

    if (!courseRunId || !trainerId) {
      return res.status(400).json({ 
        success: false, 
        error: 'Missing required parameters: courseRunId and trainerId' 
      });
    }

    console.log(`🔍 Fetching trainer assessments for courseRunId: ${courseRunId}, trainerId: ${trainerId}`);

    // Get all assessments for the course run that the trainer is assigned to
    const query = `
      SELECT 
        a.id AS assessment_id,
        a.title AS assessment_title,
        a.category,
        a.status,
        cr.end_date as deadline,
        COALESCE(cra.published, false) AS published,
        cra.published_at,
        cr.id AS course_run_id,
        c.title AS course_title,
        t.user_id AS trainer_id
      FROM course_run cr
      JOIN course c ON cr.course_id = c.id
      JOIN trainer_profile t ON t.user_id = $2
      JOIN assessment a ON a.course_id = c.id
      LEFT JOIN course_run_assessment cra ON cra.course_run_id = cr.id AND cra.assessment_id = a.id
      WHERE cr.id = $1
        AND (
          cr.assigned_trainer_id = $2
          OR cr.tpg_assigned_trainer_id = $2
          OR EXISTS (
            SELECT 1 FROM course_run_trainer crt
            WHERE crt.course_run_id = cr.id AND crt.trainer_id = $2
          )
        )
      ORDER BY a.title;
    `;

    const result = await pool.query(query, [courseRunId, trainerId]);

    console.log(`✅ Found ${result.rows.length} assessments for trainer`);

    const assessments = result.rows.map((row: any) => ({
      assessment_id: row.assessment_id,
      assessment_title: row.assessment_title,
      category: row.category,
      status: row.status,
      deadline: row.deadline,
      published: row.published,
      published_at: row.published_at,
      course_run_id: row.course_run_id,
      course_title: row.course_title,
      trainer_id: row.trainer_id
    }));

    return res.status(200).json({
      success: true,
      data: assessments
    });

  } catch (error: any) {
    console.error('❌ Error fetching trainer assessments:', error);
    return res.status(500).json({
      success: false,
      error: `Database error: ${error.message}`
    });
  }
}

export default withAuth(handler);
