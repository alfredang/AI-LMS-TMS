import type { NextApiRequest, NextApiResponse } from 'next';
import pool from '@/lib/db';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') {
    return res.status(405).json({ success: false, error: 'Method not allowed' });
  }

  const { courseRunId } = req.query;

  if (!courseRunId || typeof courseRunId !== 'string') {
    return res.status(400).json({ success: false, error: 'Course Run ID is required' });
  }

  try {
    // Query to get course code from course run ID
    const query = `
      SELECT c.course_code as "courseCode"
      FROM course_run cr
      JOIN course c ON cr.course_id = c.id
      WHERE cr.course_run_id = $1
      AND (cr.is_deleted IS NULL OR cr.is_deleted = false)
      LIMIT 1
    `;

    const result = await pool.query(query, [courseRunId]);

    if (result.rows.length === 0) {
      return res.status(404).json({ 
        success: false, 
        error: 'Course run not found' 
      });
    }

    return res.status(200).json({
      success: true,
      data: {
        courseCode: result.rows[0].courseCode
      }
    });

  } catch (error) {
    console.error('Error fetching course by run ID:', error);
    return res.status(500).json({
      success: false,
      error: 'Internal server error'
    });
  }
}
