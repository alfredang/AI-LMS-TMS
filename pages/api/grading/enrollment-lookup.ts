import { NextApiRequest, NextApiResponse } from 'next';
import pool from '../../../lib/db';

interface EnrollmentLookup {
  enrollment_id: string;
  learner_email: string;
  course_run_id: string;
}

interface ApiResponse {
  success: boolean;
  data?: EnrollmentLookup;
  error?: string;
}

export default async function handler(req: NextApiRequest, res: NextApiResponse<ApiResponse>) {
  if (req.method !== 'GET') {
    return res.status(405).json({ success: false, error: 'Method not allowed' });
  }

  const { learnerEmail, courseRunId } = req.query;

  if (!learnerEmail || !courseRunId || typeof learnerEmail !== 'string' || typeof courseRunId !== 'string') {
    return res.status(400).json({ 
      success: false, 
      error: 'Missing or invalid learnerEmail and courseRunId parameters' 
    });
  }

  try {
    console.log(`🔍 Finding enrollment ID for learner: ${learnerEmail}, course run: ${courseRunId}`);

    // Both learner and trainer roles now provide courseRunId as UUID
    const actualCourseRunId = courseRunId;

    const query = `
      SELECT 
          e.id AS enrollment_id,
          u.email AS learner_email,
          cr.id AS course_run_id
      FROM enrollment e
      JOIN app_user u ON e.user_id = u.id
      JOIN course_run cr ON e.course_run_id = cr.id
      WHERE u.email = $1 AND cr.id = $2;
    `;

    const result = await pool.query(query, [learnerEmail, actualCourseRunId]);
    
    if (result.rows.length === 0) {
      console.log(`⚠️ No enrollment found for learner: ${learnerEmail}, course run: ${courseRunId}`);
      return res.status(404).json({
        success: false,
        error: 'Enrollment not found for this learner and course run'
      });
    }

    console.log(`✅ Found enrollment ID: ${result.rows[0].enrollment_id}`);

    return res.status(200).json({
      success: true,
      data: result.rows[0]
    });

  } catch (error) {
    console.error('❌ Error finding enrollment ID:', error);
    return res.status(500).json({
      success: false,
      error: 'Failed to find enrollment ID'
    });
  }
}