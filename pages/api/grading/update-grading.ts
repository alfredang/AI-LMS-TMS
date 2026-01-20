import { NextApiRequest, NextApiResponse } from 'next';
import pool from '../../../lib/db';
import { cors } from '../../../lib/cors';

interface UpdateGradingRequest {
  enrollmentId: string;
  assessmentId: string;
  grading: 'Competent' | 'Pending' | 'Not Yet Competent';
}

interface ApiResponse {
  success: boolean;
  message?: string;
  error?: string;
}

export default async function handler(req: NextApiRequest, res: NextApiResponse<ApiResponse>) {
  // Enable CORS and handle preflight
  if (cors(req, res)) {
    return; // Preflight request handled
  }

  if (req.method !== 'PUT') {
    return res.status(405).json({ success: false, error: 'Method not allowed' });
  }

  try {
    const { enrollmentId, assessmentId, grading }: UpdateGradingRequest = req.body;

    if (!enrollmentId || !assessmentId || !grading) {
      return res.status(400).json({ 
        success: false, 
        error: 'Missing required fields: enrollmentId, assessmentId, grading' 
      });
    }

    // Validate grading value
    if (!['Competent', 'Pending', 'Not Yet Competent'].includes(grading)) {
      return res.status(400).json({ 
        success: false, 
        error: 'Invalid grading value. Must be one of: Competent, Pending, Not Yet Competent' 
      });
    }

    // Test database connection first
    await pool.query('SELECT 1');

    const query = `
      UPDATE submission
      SET grading = $1
      WHERE enrollment_id = $2
        AND assessment_id = $3;
    `;

    const result = await pool.query(query, [grading, enrollmentId, assessmentId]);
    
    if (result.rowCount === 0) {
      return res.status(404).json({
        success: false,
        error: `No submission found for enrollmentId=${enrollmentId}, assessmentId=${assessmentId}`
      });
    }

    return res.status(200).json({
      success: true,
      message: `Grading updated to '${grading}' successfully. Rows affected: ${result.rowCount}`
    });

  } catch (error: any) {
    const errorMessage = error?.message || 'Unknown error';
    return res.status(500).json({
      success: false,
      error: `Database error: ${errorMessage}`
    });
  }
}