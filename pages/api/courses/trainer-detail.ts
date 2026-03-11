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

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
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
        c.assessment_plan_url,
        c.courseware_link,
        c.assessment_record_link,
        c.id AS course_id,
        c.course_code,
        cr.course_run_id AS external_course_run_id
      FROM trainer_profile tp
      JOIN course_run cr ON tp.user_id = cr.assigned_trainer_id
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
          assessmentPlanUrl: courseDetail.assessment_plan_url,
          courseLink: courseDetail.courseware_link,
          assessmentRecordLink: courseDetail.assessment_record_link,
          courseId: courseDetail.course_id,
          courseCode: courseDetail.course_code
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
