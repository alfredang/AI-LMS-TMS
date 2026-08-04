import { withAuth } from '@lib/auth/withAuth';
import { NextApiRequest, NextApiResponse } from 'next';
import pool from '../../../lib/db';

/**
 * GET /api/admin/course-run-uuid?courseRunId=<ssg_course_run_id>
 * Returns the local DB UUID for a course run identified by its SSG course_run_id.
 */
async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') {
    return res.status(405).json({ success: false, error: 'Method not allowed' });
  }

  const { courseRunId } = req.query;
  if (!courseRunId || typeof courseRunId !== 'string') {
    return res.status(400).json({ success: false, error: 'courseRunId is required' });
  }

  try {
    const result = await pool.query(
      `SELECT cr.id, c.course_code, c.title
       FROM course_run cr
       JOIN course c ON c.id = cr.course_id
       WHERE cr.course_run_id = $1
       LIMIT 1`,
      [courseRunId.trim()]
    );

    if (result.rows.length === 0) {
      return res.status(200).json({ success: true, uuid: null, courseCode: null, courseTitle: null });
    }

    return res.status(200).json({
      success: true,
      uuid: result.rows[0].id,
      courseCode: result.rows[0].course_code ?? null,
      courseTitle: result.rows[0].title ?? null,
    });
  } catch (error) {
    console.error('❌ course-run-uuid error:', error);
    return res.status(500).json({ success: false, error: 'Internal server error' });
  }
}

export default withAuth(handler, { roles: ['admin', 'trainingProvider', 'developer'] });
