import { withAuth } from '@lib/auth/withAuth';
import type { NextApiRequest, NextApiResponse } from 'next';
import pool from '../../../lib/db';

async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') {
    return res.status(405).json({ message: 'Method not allowed' });
  }

  try {
    const { courseRunId } = req.query;

    if (!courseRunId) {
      return res.status(400).json({ message: 'Course Run ID is required' });
    }

    // SQL query to get course detail for developers (no enrollment check needed)
    const courseDetailQuery = `
      SELECT 
          c.title                AS course_title,
          -- The code currently in force, not the superseded one. A funding renewal
          -- issues a new code and parks it in new_course_code, leaving the original
          -- in course_code; reading the bare column shows a retired code.
          COALESCE(NULLIF(c.new_course_code, ''), c.course_code) AS course_code,
          c.tsc_title,
          c.tsc_code,
          cr.course_run_id,
          cr.digital_attendance_id,
          c.training_hours,
          c.assessment_hours,
          c.lesson_plan_url      AS lesson_plan,
          c.learner_guide_url    AS learner_guide,
          c.facilitator_guide_url AS facilitator_guide,
          c.slides_url           AS learner_slides,
          c.trainer_slides_url   AS trainer_slides,
          c.activities_url       AS activities,
          c.assessment_plan_url  AS assessment_plan
      FROM course c
      JOIN course_run cr 
        ON c.id = cr.course_id
      WHERE cr.id = $1
    `;

    const result = await pool.query(courseDetailQuery, [courseRunId]);

    if (result.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Course run not found'
      });
    }

    const courseDetail = result.rows[0];

    res.status(200).json({
      success: true,
      data: {
        title: courseDetail.course_title,
        tgsRef: courseDetail.course_code,
        tscTitle: courseDetail.tsc_title,
        tscCode: courseDetail.tsc_code,
        courseRunId: courseDetail.course_run_id,
        courseRunUuid: courseRunId, // Use the same course run ID
        digitalAttendanceId: courseDetail.digital_attendance_id,
        trainingHours: courseDetail.training_hours,
        assessmentHours: courseDetail.assessment_hours,
        lessonPlanUrl: courseDetail.lesson_plan,
        learnerGuideUrl: courseDetail.learner_guide,
        slidesUrl: courseDetail.learner_slides,
        facilitatorGuideUrl: courseDetail.facilitator_guide,
        trainerSlidesUrl: courseDetail.trainer_slides,
        activitiesUrl: courseDetail.activities,
        assessmentPlanUrl: courseDetail.assessment_plan,
        certificate: ''
      }
    });

  } catch (error) {
    console.error('❌ Developer course detail API error:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error',
      error: process.env.NODE_ENV === 'development' ? (error as Error).message : undefined
    });
  }
}

export default withAuth(handler);
