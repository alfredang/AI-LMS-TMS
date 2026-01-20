import { NextApiRequest, NextApiResponse } from 'next';
import pool from '../../../lib/db';

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse
) {
  // Set CORS headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') {
    res.status(200).end();
    return;
  }

  if (req.method !== 'PUT') {
    return res.status(405).json({ message: 'Method not allowed' });
  }

  try {
    const { courseRunId, assessmentId, published } = req.body;

    if (!courseRunId || !assessmentId || typeof published !== 'boolean') {
      return res.status(400).json({ 
        message: 'Course Run ID, Assessment ID, and published status are required' 
      });
    }

    console.log('🔍 Developer Publish Assessment API:', { courseRunId, assessmentId, published });

    // Update the course_run_assessment table to set published status
    const updateQuery = `
      UPDATE course_run_assessment 
      SET published = $1, published_at = now()
      WHERE course_run_id = $2 AND assessment_id = $3
      RETURNING *
    `;

    const result = await pool.query(updateQuery, [published, courseRunId, assessmentId]);

    if (result.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Assessment not found for this course run'
      });
    }

    console.log('✅ Developer Publish Assessment - Updated:', result.rows[0]);

    res.status(200).json({
      success: true,
      message: `Assessment ${published ? 'published' : 'unpublished'} successfully`,
      data: result.rows[0]
    });

  } catch (error) {
    console.error('❌ Error publishing/unpublishing developer assessment:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error',
      error: process.env.NODE_ENV === 'development' ? (error as Error).message : undefined
    });
  }
}