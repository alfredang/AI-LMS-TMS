import type { NextApiRequest, NextApiResponse } from 'next';
import pool from '../../../lib/db';

/**
 * GET /api/admin/course-run-assessment-links?courseRunId=<uuid>
 * Returns the assessment-related links from the parent course for the given
 * course_run UUID. Used by the Class Details → Assessment tab.
 */
export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') {
    return res.status(405).json({ success: false, error: 'Method not allowed' });
  }

  const courseRunId = (req.query.courseRunId as string | undefined)?.trim();
  if (!courseRunId) {
    return res.status(400).json({ success: false, error: 'courseRunId is required' });
  }

  try {
    const result = await pool.query<{
      course_id: string;
      course_title: string | null;
      course_code: string | null;
      assessment_plan_url: string | null;
      assessment_record_link: string | null;
      assessment_summary_record_url: string | null;
    }>(
      `SELECT
         c.id AS course_id,
         c.title AS course_title,
         c.course_code,
         c.assessment_plan_url,
         c.assessment_record_link,
         c.assessment_summary_record_url
       FROM course_run cr
       JOIN course c ON c.id = cr.course_id
       WHERE cr.id = $1
       LIMIT 1`,
      [courseRunId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ success: false, error: 'Course run not found' });
    }

    const row = result.rows[0];
    return res.status(200).json({
      success: true,
      data: {
        courseId: row.course_id,
        courseTitle: row.course_title,
        courseCode: row.course_code,
        assessmentFolderUrl: row.assessment_plan_url,
        assessmentRecordFolderUrl: row.assessment_record_link,
        assessmentSummaryRecordUrl: row.assessment_summary_record_url,
      },
    });
  } catch (err) {
    console.error('[course-run-assessment-links] error:', err);
    return res.status(500).json({
      success: false,
      error: err instanceof Error ? err.message : 'Internal server error',
    });
  }
}
