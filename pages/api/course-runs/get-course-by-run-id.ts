import { withAuth } from '@lib/auth/withAuth';
import type { NextApiRequest, NextApiResponse } from 'next';
import pool from '@/lib/db';

async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') {
    return res.status(405).json({ success: false, error: 'Method not allowed' });
  }

  const { courseRunId } = req.query;

  if (!courseRunId || typeof courseRunId !== 'string') {
    return res.status(400).json({ success: false, error: 'Course Run ID is required' });
  }

  try {
    // Query to get course code from course run ID. Use the code currently in
    // force (COALESCE new_course_code -> course_code), matching /api/courses/list,
    // so the value auto-filled here always matches an option in the "Available
    // Courses" dropdown -- a renewed course's retired code matches nothing there
    // and silently empties the "Available Course Runs" dropdown.
    const query = `
      SELECT COALESCE(NULLIF(c.new_course_code, ''), c.course_code) as "courseCode"
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

export default withAuth(handler);
