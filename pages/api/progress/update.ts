import { NextApiRequest, NextApiResponse } from 'next';
import pool from '../../../lib/db';
import { cors } from '../../../lib/cors';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (cors(req, res)) return;

  if (req.method !== 'POST') {
    return res.status(405).json({ success: false, error: 'Method not allowed' });
  }

  try {
    const { userId, courseId } = req.body;

    if (!userId || !courseId) {
      return res.status(400).json({ 
        success: false, 
        error: 'Missing required fields: userId, courseId' 
      });
    }

    // Calculate and update progress percentage
    const updateProgressQuery = `
      UPDATE enrollment
      SET progress_percent = (
        SELECT 
          CASE 
            WHEN total_subtopics > 0 
            THEN ROUND((completed_subtopics::DECIMAL / total_subtopics) * 100, 1)
            ELSE 0
          END
        FROM (
          SELECT
            COUNT(DISTINCT st.id) AS total_subtopics,
            COUNT(DISTINCT sc.subtopic_id) AS completed_subtopics
          FROM course c
          JOIN learning_unit lu ON c.id = lu.course_id
          JOIN subtopic st ON lu.id = st.learning_unit_id
          LEFT JOIN subtopic_completion sc ON st.id = sc.subtopic_id
            AND sc.enrollment_id = enrollment.id
          WHERE c.id = $2
        ) progress_stats
      )
      WHERE user_id = $1 AND course_id = $2
      RETURNING progress_percent
    `;

    const result = await pool.query(updateProgressQuery, [userId, courseId]);
    
    const newProgress = result.rows[0]?.progress_percent || 0;

    return res.status(200).json({ 
      success: true, 
      data: { progress_percent: newProgress }
    });

  } catch (error) {
    console.error('💥 Error updating progress:', error);
    return res.status(500).json({ 
      success: false, 
      error: 'Internal server error' 
    });
  }
}
