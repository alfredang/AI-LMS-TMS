import { withAuth } from '@lib/auth/withAuth';
import { NextApiRequest, NextApiResponse } from 'next';
import pool from '../../../lib/db';

// Types for the response data
interface LearningUnitRow {
  learning_unit_id: string;
  learning_unit_title: string;
  learning_unit_position: number;
  subtopic_id: string | null;
  subtopic_title: string | null;
  subtopic_position: number | null;
}

interface BookmarkRow {
  subtopic_id: string;
}

interface Subtopic {
  id: string;
  title: string;
  position: number;
}

interface LearningUnit {
  id: string;
  title: string;
  position: number;
  subtopics: Subtopic[];
}

async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') {
    return res.status(405).json({ success: false, error: 'Method not allowed' });
  }

  const { trainerUserId, courseRunId } = req.query;

  if (!trainerUserId || !courseRunId) {
    return res.status(400).json({ 
      success: false, 
      error: 'Missing required parameters: trainerUserId and courseRunId' 
    });
  }

  try {
    // Both learner and trainer roles now provide courseRunId as UUID
    const actualCourseRunId = Array.isArray(courseRunId) ? courseRunId[0] : courseRunId;

    // SQL query based on your requirements
    const courseDetailQuery = `
      SELECT 
        c.title AS course_title,
        c.course_code,
        c.tsc_title,
        c.tsc_code,
        cr.id AS course_run_id,
        cr.digital_attendance_id,
        c.training_hours,
        c.assessment_hours,
        c.lesson_plan_url,
        c.learner_guide_url,
        c.facilitator_guide_url,
        c.trainer_slides_url,
        c.activities_url,
        c.assessment_plan_url,
        c.courseware_link,
        c.assessment_record_link,
        c.assessment_summary_record_url,
        c.slides_url,
        c.written_assessment_link,
        c.practical_performance_assessment_link,
        cr.written_assessment_published,
        cr.practical_assessment_published,
        c.id AS course_id,
        c.course_code,
        cr.course_run_id AS external_course_run_id,
        cr.start_date,
        cr.end_date,
        c.resource_links,
        c.funding_validity,
        c.skillsfuture_link,
        COALESCE(cr.class_type, 'Physical') AS class_type,
        CASE
          WHEN cr.virtual_meeting_provider = 'zoom'
            THEN COALESCE(cr.virtual_meeting_host_link, cr.virtual_meeting_link)
          ELSE cr.virtual_meeting_link
        END AS virtual_meeting_link,
        cr.virtual_meeting_host_link,
        cr.virtual_meeting_link AS virtual_meeting_join_link,
        cr.virtual_meeting_provider
      FROM trainer_profile tp
      JOIN course_run cr ON (
        tp.user_id = cr.assigned_trainer_id
        OR EXISTS (
          SELECT 1 FROM course_run_trainer crt
          WHERE crt.course_run_id = cr.id AND crt.trainer_id = tp.user_id
        )
      )
      JOIN course c ON cr.course_id = c.id
      WHERE tp.user_id = $1 AND cr.id = $2
    `;

    const courseDetailResult = await pool.query(courseDetailQuery, [trainerUserId, actualCourseRunId]);

    if (courseDetailResult.rows.length === 0) {
      return res.status(404).json({
        success: false,
        error: 'Course not found or trainer not assigned to this course run'
      });
    }

    const courseDetail = courseDetailResult.rows[0];

    // Safely fetch assessment_methods and published_assessment_methods columns
    // These columns may not exist if the migration hasn't been run yet
    let assessmentMethodsValue: any = null;
    let publishedAssessmentMethodsValue: any = {};
    try {
      const amResult = await pool.query(
        'SELECT assessment_methods FROM course WHERE id = $1 LIMIT 1',
        [courseDetail.course_id]
      );
      if (amResult.rows.length > 0 && amResult.rows[0].assessment_methods) {
        const am = amResult.rows[0].assessment_methods;
        assessmentMethodsValue = typeof am === 'string' ? JSON.parse(am) : am;
      }
    } catch (e) {
      // Column doesn't exist yet, use default null
    }
    try {
      const pamResult = await pool.query(
        'SELECT published_assessment_methods FROM course_run WHERE id = $1 LIMIT 1',
        [courseDetail.course_run_id]
      );
      if (pamResult.rows.length > 0 && pamResult.rows[0].published_assessment_methods) {
        const pam = pamResult.rows[0].published_assessment_methods;
        publishedAssessmentMethodsValue = typeof pam === 'string' ? JSON.parse(pam) : pam;
      }
    } catch (e) {
      // Column doesn't exist yet, use default empty object
    }

    // Get learning units and subtopics for this course
    const learningUnitsQuery = `
      SELECT 
        lu.id as learning_unit_id,
        lu.title as learning_unit_title,
        lu.position as learning_unit_position,
        st.id as subtopic_id,
        st.title as subtopic_title,
        st.position as subtopic_position
      FROM learning_unit lu
      LEFT JOIN subtopic st ON lu.id = st.learning_unit_id
      WHERE lu.course_id = $1
      ORDER BY lu.position, st.position
    `;

    const learningUnitsResult = await pool.query(learningUnitsQuery, [courseDetail.course_id]);

    // Structure the learning units with their subtopics
    const learningUnitsMap = new Map<string, LearningUnit>();
    
    learningUnitsResult.rows.forEach((row: LearningUnitRow) => {
      const unitId = row.learning_unit_id;
      
      if (!learningUnitsMap.has(unitId)) {
        learningUnitsMap.set(unitId, {
          id: unitId,
          title: row.learning_unit_title,
          position: row.learning_unit_position,
          subtopics: []
        });
      }
      
      if (row.subtopic_id && row.subtopic_title && row.subtopic_position !== null) {
        learningUnitsMap.get(unitId)!.subtopics.push({
          id: row.subtopic_id,
          title: row.subtopic_title,
          position: row.subtopic_position
        });
      }
    });

    const learningUnits = Array.from(learningUnitsMap.values())
      .sort((a, b) => a.position - b.position)
      .map(unit => ({
        ...unit,
        subtopics: unit.subtopics.sort((a: Subtopic, b: Subtopic) => a.position - b.position)
      }));

    // Get trainer's bookmarked subtopics for this specific course run
    const bookmarksQuery = `
      SELECT subtopic_id
      FROM user_subtopic_bookmark
      WHERE user_id = $1 AND course_run_id = $2
    `;

    const bookmarksResult = await pool.query(bookmarksQuery, [trainerUserId, courseDetail.course_run_id]);
    const bookmarkedSubtopics = bookmarksResult.rows.map((row: BookmarkRow) => row.subtopic_id);

    console.log(`🔖 Trainer API: Found ${bookmarkedSubtopics.length} bookmarks for course run ${courseDetail.course_run_id}`);
    if (bookmarkedSubtopics.length > 0) {
      console.log(`🔖 Bookmarked subtopic IDs:`, bookmarkedSubtopics);
    }

    res.status(200).json({
      success: true,
      data: {
        courseDetail: {
          courseTitle: courseDetail.course_title,
          tgsRef: courseDetail.course_code,
          tscTitle: courseDetail.tsc_title,
          tscCode: courseDetail.tsc_code,
          courseRunId: courseDetail.external_course_run_id,
          courseRunUuid: courseDetail.course_run_id, // This is the UUID we need for grading APIs
          digitalAttendanceId: courseDetail.digital_attendance_id,
          trainingHours: courseDetail.training_hours,
          assessmentHours: courseDetail.assessment_hours,
          lessonPlanUrl: courseDetail.lesson_plan_url,
          learnerGuideUrl: courseDetail.learner_guide_url,
          facilitatorGuideUrl: courseDetail.facilitator_guide_url,
          trainerSlidesUrl: courseDetail.trainer_slides_url,
          activitiesUrl: courseDetail.activities_url,
          assessmentPlanUrl: courseDetail.assessment_plan_url,
          courseLink: courseDetail.courseware_link,
          assessmentRecordLink: courseDetail.assessment_record_link,
          assessmentSummaryRecordUrl: courseDetail.assessment_summary_record_url,
          slidesUrl: courseDetail.slides_url,
          writtenAssessmentLink: courseDetail.written_assessment_link,
          practicalPerformanceAssessmentLink: courseDetail.practical_performance_assessment_link,
          writtenAssessmentPublished: courseDetail.written_assessment_published ?? false,
          practicalAssessmentPublished: courseDetail.practical_assessment_published ?? false,
          assessmentMethods: assessmentMethodsValue,
          publishedAssessmentMethods: publishedAssessmentMethodsValue,
          startDate: courseDetail.start_date || null,
          endDate: courseDetail.end_date || null,
          courseId: courseDetail.course_id,
          courseCode: courseDetail.course_code,
          resourceLinks: courseDetail.resource_links ? (typeof courseDetail.resource_links === 'string' ? JSON.parse(courseDetail.resource_links) : courseDetail.resource_links) : [],
          fundingValidity: courseDetail.funding_validity || null,
          skillsfutureLink: courseDetail.skillsfuture_link || null,
          classType: courseDetail.class_type || 'Physical',
          virtualMeetingLink: courseDetail.virtual_meeting_link || null,
          virtualMeetingHostLink: courseDetail.virtual_meeting_host_link || null,
          virtualMeetingJoinLink: courseDetail.virtual_meeting_join_link || null,
          virtualMeetingProvider: courseDetail.virtual_meeting_provider || null
        },
        learningUnits,
        bookmarkedSubtopics
      }
    });

  } catch (error) {
    console.error('Error fetching trainer course detail:', error);
    res.status(500).json({
      success: false,
      error: 'Internal server error'
    });
  }
}

export default withAuth(handler);
