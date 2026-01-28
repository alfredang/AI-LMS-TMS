import { NextApiRequest, NextApiResponse } from 'next';
import pool from '../../../lib/db';

interface CourseDetailRow {
  title: string;
  course_code: string;
  tsc_title: string;
  tsc_code: string;
  course_run_id: string;
  course_run_uuid: string;
  digital_attendance_id: string;
  training_hours: number;
  assessment_hours: number;
  lesson_plan_url: string;
  learner_guide_url: string;
  slides_url: string;
  certificate: string;
}

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

  if (req.method !== 'GET') {
    return res.status(405).json({ message: 'Method not allowed' });
  }

  try {
    const { userId, courseId, courseRunId } = req.query;

    if (!userId || !courseId) {
      return res.status(400).json({ message: 'User ID and Course ID are required' });
    }

    // SQL query to get course detail for a specific user and course
    // If courseRunId is provided, use it to get the specific course run
    let courseDetailQuery, queryParams;
    
    if (courseRunId) {
      // Get specific course run details
      // Use app_user instead of learner_profile since enrollments are linked to app_user
      // This allows users with multiple roles (e.g., Developer + Learner) to view course details
      courseDetailQuery = `
        SELECT
          c.title,
          c.course_code,
          c.tsc_title,
          c.tsc_code,
          cr.course_run_id,
          cr.id AS course_run_uuid,
          cr.digital_attendance_id,
          c.training_hours,
          c.assessment_hours,
          c.lesson_plan_url,
          c.learner_guide_url,
          c.slides_url,
          e.certificate
        FROM enrollment e
        JOIN course_run cr
          ON e.course_run_id = cr.id
        JOIN course c
          ON cr.course_id = c.id
        WHERE e.user_id = $1 AND c.id = $2 AND cr.id = $3
      `;
      queryParams = [userId, courseId, courseRunId];
    } else {
      // Fallback to first enrollment found (original behavior)
      // Use app_user instead of learner_profile since enrollments are linked to app_user
      courseDetailQuery = `
        SELECT
          c.title,
          c.course_code,
          c.tsc_title,
          c.tsc_code,
          cr.course_run_id,
          cr.id AS course_run_uuid,
          cr.digital_attendance_id,
          c.training_hours,
          c.assessment_hours,
          c.lesson_plan_url,
          c.learner_guide_url,
          c.slides_url,
          e.certificate
        FROM enrollment e
        JOIN course_run cr
          ON e.course_run_id = cr.id
        JOIN course c
          ON cr.course_id = c.id
        WHERE e.user_id = $1 AND c.id = $2
      `;
      queryParams = [userId, courseId];
    }

    const result = await pool.query(courseDetailQuery, queryParams);

    if (result.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Course not found or user not enrolled'
      });
    }

    const courseDetail = result.rows[0] as CourseDetailRow;
    
    console.log(`🔍 Course detail API: Retrieved course run for user ${userId}:`, {
      courseId,
      requestedCourseRunId: courseRunId,
      returnedCourseRunId: courseDetail.course_run_id,
      returnedCourseRunUuid: courseDetail.course_run_uuid
    });

    res.status(200).json({
      success: true,
      data: {
        title: courseDetail.title,
        tgsRef: courseDetail.course_code,
        tscTitle: courseDetail.tsc_title,
        tscCode: courseDetail.tsc_code,
        courseRunId: courseDetail.course_run_id,
        courseRunUuid: courseDetail.course_run_uuid,
        digitalAttendanceId: courseDetail.digital_attendance_id,
        trainingHours: courseDetail.training_hours,
        assessmentHours: courseDetail.assessment_hours,
        lessonPlanUrl: courseDetail.lesson_plan_url,
        learnerGuideUrl: courseDetail.learner_guide_url,
        slidesUrl: courseDetail.slides_url,
        certificate: courseDetail.certificate
      }
    });

  } catch (error) {
    console.error('Error fetching course detail:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error',
      error: process.env.NODE_ENV === 'development' ? (error as Error).message : undefined
    });
  }
}
