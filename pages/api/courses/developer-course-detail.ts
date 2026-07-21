import type { NextApiRequest, NextApiResponse } from 'next';
import pool from '../../../lib/db';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') {
    return res.status(405).json({ message: 'Method not allowed' });
  }

  try {
    const { courseId } = req.query;

    if (!courseId) {
      return res.status(400).json({ message: 'Course ID is required' });
    }

    // SQL query to get course detail for developers (without course run data)
    const courseDetailQuery = `
      SELECT 
          c.id                   AS course_id,
          c.title                AS course_title,
          c.course_code          AS course_code,
          c.tsc_title,
          c.tsc_code,
          c.training_hours,
          c.assessment_hours,
          c.lesson_plan_url      AS lesson_plan,
          c.learner_guide_url    AS learner_guide,
          c.facilitator_guide_url AS facilitator_guide,
          c.slides_url           AS learner_slides,
          c.trainer_slides_url   AS trainer_slides,
          c.activities_url       AS activities,
          c.assessment_plan_url  AS assessment_plan,
          c.courseware_link,
          c.assessment_record_link,
          c.assessment_summary_record_url,
          c.written_assessment_link,
          c.practical_performance_assessment_link,
          c.funding_validity,
          c.resource_links
      FROM course c
      WHERE c.id = $1
    `;

    const result = await pool.query(courseDetailQuery, [courseId]);

    if (result.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Course not found'
      });
    }

    const courseDetail = result.rows[0];

    // Safely fetch assessment_methods column
    // This column may not exist if the migration hasn't been run yet
    let assessmentMethodsValue: any = null;
    try {
      const amResult = await pool.query(
        'SELECT assessment_methods FROM course WHERE id = $1 LIMIT 1',
        [courseId]
      );
      if (amResult.rows.length > 0 && amResult.rows[0].assessment_methods) {
        const am = amResult.rows[0].assessment_methods;
        assessmentMethodsValue = typeof am === 'string' ? JSON.parse(am) : am;
      }
    } catch (e) {
      // Column doesn't exist yet, use default null
    }

    res.status(200).json({
      success: true,
      data: {
        courseId: courseDetail.course_id,
        title: courseDetail.course_title,
        tgsRef: courseDetail.course_code,
        tscTitle: courseDetail.tsc_title,
        tscCode: courseDetail.tsc_code,
        courseRunId: null, // No course run for developers
        courseRunUuid: null,
        digitalAttendanceId: null, // No DA for developers
        trainingHours: courseDetail.training_hours,
        assessmentHours: courseDetail.assessment_hours,
        lessonPlanUrl: courseDetail.lesson_plan,
        learnerGuideUrl: courseDetail.learner_guide,
        slidesUrl: courseDetail.learner_slides,
        facilitatorGuideUrl: courseDetail.facilitator_guide,
        trainerSlidesUrl: courseDetail.trainer_slides,
        activitiesUrl: courseDetail.activities,
        assessmentPlanUrl: courseDetail.assessment_plan,
        courseLink: courseDetail.courseware_link,
        assessmentRecordLink: courseDetail.assessment_record_link,
        assessmentSummaryRecordUrl: courseDetail.assessment_summary_record_url,
        writtenAssessmentLink: courseDetail.written_assessment_link,
        practicalPerformanceAssessmentLink: courseDetail.practical_performance_assessment_link,
        assessmentMethods: assessmentMethodsValue,
        fundingValidity: courseDetail.funding_validity || null,
        resourceLinks: courseDetail.resource_links ? (typeof courseDetail.resource_links === 'string' ? JSON.parse(courseDetail.resource_links) : courseDetail.resource_links) : [],
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