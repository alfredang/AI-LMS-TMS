import { withAuth } from '@lib/auth/withAuth';
import { NextApiRequest, NextApiResponse } from 'next';
import pool from '../../../lib/db';
import { cors } from '../../../lib/cors';

interface PublishAssessmentRequest {
  courseRunId: string;
  assessmentId: string;
  published: boolean;
}

interface ApiResponse {
  success: boolean;
  message?: string;
  error?: string;
}

async function handler(req: NextApiRequest, res: NextApiResponse<ApiResponse>) {
  // Enable CORS and handle preflight
  if (cors(req, res)) {
    return; // Preflight request handled
  }

  if (req.method !== 'PUT') {
    return res.status(405).json({ success: false, error: 'Method not allowed' });
  }

  try {
    const { courseRunId, assessmentId, published }: PublishAssessmentRequest = req.body;

    if (!courseRunId || !assessmentId || typeof published !== 'boolean') {
      return res.status(400).json({ 
        success: false, 
        error: 'Missing required fields: courseRunId, assessmentId, published' 
      });
    }

    console.log(`🔍 Publishing assessment: courseRunId=${courseRunId}, assessmentId=${assessmentId}, published=${published}`);

    // Update the publish status for the assessment
    const query = `
      INSERT INTO course_run_assessment (course_run_id, assessment_id, published, published_at)
      VALUES ($1, $2, $3, NOW())
      ON CONFLICT (course_run_id, assessment_id)
      DO UPDATE SET 
        published = EXCLUDED.published,
        published_at = EXCLUDED.published_at
      RETURNING *;
    `;

    const result = await pool.query(query, [courseRunId, assessmentId, published]);
    
    if (result.rowCount === 0) {
      return res.status(404).json({
        success: false,
        error: `No assessment found for courseRunId=${courseRunId}, assessmentId=${assessmentId}`
      });
    }

    console.log(`✅ Assessment publish status updated successfully`);

    return res.status(200).json({
      success: true,
      message: `Assessment ${published ? 'published' : 'unpublished'} successfully`
    });

  } catch (error: any) {
    console.error('❌ Error updating assessment publish status:', error);
    return res.status(500).json({
      success: false,
      error: `Database error: ${error.message}`
    });
  }
}

export default withAuth(handler);
