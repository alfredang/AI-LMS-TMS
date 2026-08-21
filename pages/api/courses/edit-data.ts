import { withAuth } from '@lib/auth/withAuth';
import { NextApiRequest, NextApiResponse } from 'next';
import pool from '../../../lib/db';
import { splitTrainerList } from '@/lib/trainerInvitations';

interface LearningUnitRow {
  learning_unit_id: string;
  learning_unit_title: string;
  learning_unit_position: number;
  subtopic_id: string | null;
  subtopic_title: string | null;
  subtopic_position: number | null;
}

interface AssessmentRow {
  id: string;
  title: string;
  category: string;
  file_url: string | null;
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

async function handler(
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
    const { courseId } = req.query;

    if (!courseId) {
      return res.status(400).json({ message: 'Course ID is required' });
    }

    console.log('🔍 Course Edit Data API - CourseId:', courseId);

    // 1. Get course basic data with file URLs and settings
    const courseQuery = `
      SELECT 
        c.id,
        c.title,
        c.course_code,
        -- The code issued at funding renewal. This endpoint feeds the course
        -- editor, which edits the original and the renewed code as two separate
        -- fields; omitting this left the "Course Code (Current)" box permanently
        -- empty even for courses that had been renewed.
        c.new_course_code,
        c.tsc_title,
        c.tsc_code,
        c.training_hours,
        c.assessment_hours,
        c.mode_of_learning,
        c.course_type,
        c.course_fee,
        c.tax_percent,
        c.schedule_id,
        c.course_fees_exclude_gst,
        c.course_fees_include_gst,
        c.after_normal_funding,
        c.after_mces_funding,
        c.is_utap_eligible,
        c.renewed_status,
        c.learning_outcomes,
        c.lesson_plan_url,
        c.learner_guide_url,
        c.facilitator_guide_url,
        c.assessment_plan_url,
        c.slides_url           AS learner_slides_url,
        c.trainer_slides_url,
        c.activities_url,
        c.written_assessment_link,
        c.practical_performance_assessment_link,
        c.courseware_link,
        c.brochure_link,
        c.skillsfuture_link,
        c.assessment_record_link,
        c.assessment_summary_record_url,
        c.is_gamified          AS is_leaderboard_enabled,
        c.image_url,
        c.funding_validity,
          (SELECT h.valid_from::text FROM course_code_history h
            WHERE h.course_id = c.id AND h.is_current LIMIT 1) AS funding_validity_start,
        c.num_of_trainers,
        c.trainers_list,
        c.trainers_email_list,
        c.resource_links
      FROM course c
      WHERE c.id = $1
    `;

    const courseResult = await pool.query(courseQuery, [courseId]);

    // Try to fetch assessment_methods (column may not exist yet)
    let assessmentMethodsData = null;
    try {
      const amResult = await pool.query('SELECT assessment_methods FROM course WHERE id = $1', [courseId]);
      if (amResult.rows.length > 0) {
        assessmentMethodsData = amResult.rows[0].assessment_methods;
      }
    } catch (e) {
      // Column doesn't exist yet - that's fine
    }

    if (courseResult.rows.length === 0) {
      return res.status(404).json({ message: 'Course not found' });
    }

    const courseData = courseResult.rows[0];

    // 2. Get learning units and subtopics for this course
    const learningUnitsQuery = `
      SELECT 
        lu.id       AS learning_unit_id,
        lu.title    AS learning_unit_title,
        lu.position AS learning_unit_position,
        st.id       AS subtopic_id,
        st.title    AS subtopic_title,
        st.position AS subtopic_position
      FROM learning_unit lu
      LEFT JOIN subtopic st 
             ON lu.id = st.learning_unit_id
      WHERE lu.course_id = $1
      ORDER BY lu.position, st.position
    `;

    const learningUnitsResult = await pool.query(learningUnitsQuery, [courseId]);

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

    // 3. Get assessments for this course
    const assessmentsQuery = `
      SELECT 
        a.id,
        a.title,
        a.category,
        a.file_url
      FROM assessment a
      WHERE a.course_id = $1
      ORDER BY a.created_at DESC
    `;

    const assessmentsResult = await pool.query(assessmentsQuery, [courseId]);
    const assessments = assessmentsResult.rows;

    // 4. Construct the complete course data for editing
    const completeCourseData = {
      id: courseData.id,
      title: courseData.title,
      // courseCode is the ORIGINAL registration code -- the editor writes it
      // straight back into course.course_code, so it must never carry the
      // renewed code or the next save would overwrite the original and break
      // the link to enrolments and SSG records created under it.
      courseCode: courseData.course_code,
      newCourseCode: courseData.new_course_code || '',
      currentCourseCode: courseData.new_course_code || courseData.course_code || '',
      tscTitle: courseData.tsc_title,
      tscCode: courseData.tsc_code,
      trainingHours: courseData.training_hours,
      assessmentHours: courseData.assessment_hours,
      modeOfLearning: courseData.mode_of_learning ? [courseData.mode_of_learning] : [],
      courseType: courseData.course_type,
      courseFee: courseData.course_fee ?? courseData.course_fees_exclude_gst ?? null,
      taxPercent: courseData.tax_percent,
      scheduleId: courseData.schedule_id || '',
      courseFeesExcludeGst: courseData.course_fees_exclude_gst ?? courseData.course_fee ?? null,
      courseFeesIncludeGst: courseData.course_fees_include_gst ?? null,
      afterNormalFunding: courseData.after_normal_funding ?? null,
      afterMcesFunding: courseData.after_mces_funding ?? null,
      isUtapEligible: !!courseData.is_utap_eligible,
      renewedStatus: courseData.renewed_status || '',
      learningOutcomes: courseData.learning_outcomes,
      lessonPlanUrl: courseData.lesson_plan_url,
      learnerGuideUrl: courseData.learner_guide_url,
      facilitatorGuideUrl: courseData.facilitator_guide_url,
      assessmentPlanUrl: courseData.assessment_plan_url,
      slidesUrl: courseData.learner_slides_url,
      trainerSlidesUrl: courseData.trainer_slides_url,
      activitiesUrl: courseData.activities_url,
      writtenAssessmentLink: courseData.written_assessment_link,
      practicalPerformanceAssessmentLink: courseData.practical_performance_assessment_link,
      courseLink: courseData.courseware_link,
      brochureLink: courseData.brochure_link,
      skillsfutureLink: courseData.skillsfuture_link,
      assessmentRecordLink: courseData.assessment_record_link,
      assessmentSummaryRecordUrl: courseData.assessment_summary_record_url,
      isLeaderboardEnabled: courseData.is_leaderboard_enabled,
      imageUrl: courseData.image_url,
      fundingValidity: courseData.funding_validity || null,
      fundingValidityStart: courseData.funding_validity_start || null,
      numOfTrainers: courseData.num_of_trainers ?? 0,
      trainersList: courseData.trainers_list || '',
      trainersEmailList: courseData.trainers_email_list || '',
      approvedTrainers: splitTrainerList(courseData.trainers_list),
      assessmentMethods: assessmentMethodsData ? (typeof assessmentMethodsData === 'string' ? JSON.parse(assessmentMethodsData) : assessmentMethodsData) : null,
      resourceLinks: courseData.resource_links ? (typeof courseData.resource_links === 'string' ? JSON.parse(courseData.resource_links) : courseData.resource_links) : [],
      // Convert learning units to topics format expected by the editor
      topics: learningUnits.map(unit => ({
        id: unit.id,
        title: unit.title,
        subtopics: unit.subtopics.map(subtopic => ({
          id: subtopic.id,
          title: subtopic.title,
          content: '' // This field exists in the type but isn't used in the editor
        }))
      })),
      // Include assessments
      assessments: assessments.map(assessment => ({
        id: assessment.id,
        title: assessment.title,
        category: assessment.category,
        fileUrl: assessment.file_url,
        status: 'Draft' // Default status for editing
      }))
    };

    console.log('📊 Course Edit Data - Course loaded:', completeCourseData.title);
    console.log('📊 Course Edit Data - Learning units:', learningUnits.length);
    console.log('📊 Course Edit Data - Assessments:', assessments.length);

    res.status(200).json({
      success: true,
      data: completeCourseData
    });

  } catch (error) {
    console.error('❌ Error fetching course edit data:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error',
      error: process.env.NODE_ENV === 'development' ? (error as Error).message : undefined
    });
  }
}

export default withAuth(handler);
