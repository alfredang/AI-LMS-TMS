import { NextApiRequest, NextApiResponse } from 'next';
import { Pool } from 'pg';

interface ApiResponse {
  success: boolean;
  data?: any;
  error?: string;
}

// Database connection
const pool = new Pool({
  user: process.env.DB_USER,
  host: process.env.DB_HOST,
  database: process.env.DB_NAME,
  password: process.env.DB_PASSWORD,
  port: parseInt(process.env.DB_PORT || '5432'),
});

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse<ApiResponse>
) {
  if (req.method !== 'GET') {
    return res.status(405).json({ 
      success: false, 
      error: 'Method not allowed' 
    });
  }

  try {
    const { courseRunId } = req.query;

    if (!courseRunId) {
      return res.status(400).json({
        success: false,
        error: 'courseRunId is required'
      });
    }

    console.log('🔍 Debug: Looking for course run with courseRunId:', courseRunId);

    // Check if course run exists
    const checkQuery = `
      SELECT 
        id,
        course_run_id,
        assigned_trainer_name,
        assigned_trainer_email,
        created_at,
        updated_at
      FROM course_run 
      WHERE course_run_id = $1
    `;

    const result = await pool.query(checkQuery, [courseRunId]);

    console.log('📊 Query result:', result.rows);

    res.status(200).json({
      success: true,
      data: {
        found: result.rows.length > 0,
        courseRuns: result.rows,
        searchedFor: courseRunId
      }
    });

  } catch (error) {
    console.error('❌ Error in debug endpoint:', error);
    
    res.status(500).json({
      success: false,
      error: 'Internal server error: ' + (error instanceof Error ? error.message : 'Unknown error')
    });
  }
}