import { withAuth } from '@lib/auth/withAuth';
import { NextApiRequest, NextApiResponse } from 'next';
import pool from '../../../lib/db';
import { cors } from '../../../lib/cors';
import { mergeTaggedTrainers } from '../../../lib/trainers/taggedTrainers';

interface ClassDetailsResponse {
  success: boolean;
  data?: {
    courseTitle: string;
    operationalSummary: {
      trainer: string;
      startDate: string;
      endDate: string;
      classType: string;
      mode: string;
      overallAssessment: string;
      tgsRef: string;
      courseRunId: string;
      courseRunUuid: string;
      overallGrantStatus: string;
      overallClaimStatus: string;
    };
    trainers: Array<{
      trainerId: string | null;
      trainerName: string;
      trainerEmail: string | null;
    }>;
    enrolledLearners: Array<{
      learnerName: string;
      learnerEmail: string;
      learnerTel: string;
      company: string;
      sponsorship: string;
      nationality: string;
      dob: string;
      paymentDetails: string;
      assessment: string;
      grantId: string;
      claimId: string;
    }>;
  };
  error?: string;
}

async function handler(req: NextApiRequest, res: NextApiResponse<ClassDetailsResponse>) {
  // Handle CORS
  if (cors(req, res)) {
    return;
  }

  if (req.method !== 'GET') {
    return res.status(405).json({ success: false, error: 'Method not allowed' });
  }

  try {
    const { courseRunId } = req.query;

    if (!courseRunId || typeof courseRunId !== 'string') {
      return res.status(400).json({
        success: false,
        error: 'Course run ID is required'
      });
    }

    console.log('🔍 Fetching class details for course run:', courseRunId);

    // 1. Get course title and operational summary basic data
    const basicDataQuery = `
      SELECT 
          c.title AS course_title,
          cr.assigned_trainer_name AS trainer,
          cr.start_date AS start_date,
          cr.end_date AS end_date,
          COALESCE(cr.class_type, 'Physical') AS class_type,
          COALESCE(cr.invitation_paused, false) AS invitation_paused,
          COALESCE(cr.invitation_replies_blocked, false) AS invitation_replies_blocked,
          cr.virtual_meeting_link,
          cr.virtual_meeting_host_link,
          cr.virtual_meeting_provider,
          cr.mode_of_learning AS mode,
          cr.tpg_assigned_trainer_name,
          cr.tpg_assigned_trainer_email,
          c.course_code AS tgs_ref,
          cr.class_status AS class_status,
          cr.course_run_id AS course_run_id,
          cr.id AS course_run_uuid
      FROM course_run cr
      LEFT JOIN course c 
          ON cr.course_id = c.id
      WHERE cr.course_run_id = $1
    `;

    const basicDataResult = await pool.query(basicDataQuery, [courseRunId]);

    if (basicDataResult.rows.length === 0) {
      return res.status(404).json({
        success: false,
        error: 'Course run not found'
      });
    }

    const basicData = basicDataResult.rows[0];
    console.log('📊 Basic data found:', {
      courseRunId: basicData.course_run_id,
      courseRunUuid: basicData.course_run_uuid,
      courseTitle: basicData.course_title
    });

    // 2. Get overall assessment - using your exact working SQL pattern
    console.log('🔍 Executing assessment query with UUID:', basicData.course_run_uuid);
    const assessmentQuery = `
      SELECT 
        CONCAT(
          COUNT(*) FILTER (WHERE assessment_status = 'Competent'),
          ' / ',
          COUNT(*)
        ) AS overall_assessment
      FROM enrollment
      WHERE course_run_id = $1
    `;

    const assessmentResult = await pool.query(assessmentQuery, [basicData.course_run_uuid]);
    const overallAssessment = assessmentResult.rows[0]?.overall_assessment || '0 / 0';
    console.log('✅ Assessment query completed:', overallAssessment);

    // 3. Get overall grant status - using your exact working SQL pattern
    console.log('🔍 Executing grant status query with string courseRunId:', basicData.course_run_id);
    const grantStatusQuery = `
      SELECT
        cr.course_run_id,
        CONCAT(
          COUNT(*) FILTER (WHERE LOWER(sg.status) = 'approved'),
          ' / ',
          COUNT(*)
        ) AS overall_grant_status
      FROM ssg_grants sg
      JOIN enrollment e
        ON sg.enrollment_id = e.enrolment_id
      JOIN course_run cr
        ON e.course_run_id = cr.id
      WHERE cr.course_run_id = $1
      GROUP BY cr.course_run_id
    `;

    const grantStatusResult = await pool.query(grantStatusQuery, [basicData.course_run_id]);
    const overallGrantStatus = grantStatusResult.rows[0]?.overall_grant_status || '0 / 0';
    console.log('✅ Grant status query completed:', overallGrantStatus);

    // 4. Get overall claim status - using your exact working SQL pattern
    console.log('🔍 Executing claim status query with string courseRunId:', basicData.course_run_id);
    const claimStatusQuery = `
      SELECT
        cr.course_run_id,
        CONCAT(
          COUNT(*) FILTER (WHERE LOWER(sc.claim_status) = 'approved'),
          ' / ',
          COUNT(*)
        ) AS overall_claim_status
      FROM ssg_claims sc
      JOIN enrollment e
        ON sc.enrollment_id = e.enrolment_id
      JOIN course_run cr
        ON e.course_run_id = cr.id
      WHERE cr.course_run_id = $1
      GROUP BY cr.course_run_id
    `;

    const claimStatusResult = await pool.query(claimStatusQuery, [basicData.course_run_id]);
    const overallClaimStatus = claimStatusResult.rows[0]?.overall_claim_status || '0 / 0';
    console.log('✅ Claim status query completed:', overallClaimStatus);

    // 5. Get enrolled learners data - using your exact working SQL pattern
    console.log('🔍 Executing learners query with UUID:', basicData.course_run_uuid);
    const learnersQuery = `
      SELECT
        au.full_name AS learner_name,
        au.email AS learner_email,
        lp.tel AS learner_tel,
        lp.company AS company,
        e.course_sponsorship AS sponsorship,
        lp.nationality AS nationality,
        lp.dob AS dob,
        e.payment_status AS payment_details,
        e.assessment_status AS assessment,
        COALESCE(
          (SELECT sg.grant_id FROM ssg_grants sg WHERE sg.enrollment_id = e.enrolment_id ORDER BY sg.created_date DESC LIMIT 1),
          e.grant_id
        ) AS grant_id,
        (SELECT sc.claim_id FROM ssg_claims sc WHERE sc.enrollment_id = e.enrolment_id ORDER BY sc.created_date DESC LIMIT 1) AS claim_id
      FROM enrollment e
      JOIN app_user au
        ON e.user_id = au.id
      LEFT JOIN learner_profile lp
        ON e.user_id = lp.user_id
      WHERE e.course_run_id = $1
        AND LOWER(COALESCE(e.enrolment_status, '')) NOT IN ('admin removed', 'cancelled', 'withdrawn')
      ORDER BY au.full_name
    `;

    const learnersResult = await pool.query(learnersQuery, [basicData.course_run_uuid]);
    console.log('✅ Learners query completed, found:', learnersResult.rows.length, 'learners');

    // 6. Get all assigned trainers from junction table
    let trainersRows: any[] = [];
    try {
      const trainersResult = await pool.query(
        `SELECT trainer_id, trainer_name, trainer_email
         FROM course_run_trainer
         WHERE course_run_id = $1
         ORDER BY assigned_at ASC`,
        [basicData.course_run_uuid]
      );
      trainersRows = trainersResult.rows;
    } catch {
      // Junction table may not exist yet — fall back to legacy column
    }

    // Trainers who have ACCEPTED their invitation (status === 'accepted').
    // The in-app calendar shows only these — not merely assigned trainers.
    let acceptedTrainersRows: any[] = [];
    try {
      const acceptedResult = await pool.query(
        `SELECT trainer_name, trainer_email
         FROM trainer_invitation
         WHERE course_run_id = $1 AND status = 'accepted'
         ORDER BY responded_at ASC NULLS LAST, created_at ASC`,
        [basicData.course_run_uuid]
      );
      acceptedTrainersRows = acceptedResult.rows;
    } catch {
      // trainer_invitation table may not exist yet — leave empty
    }

    // Build trainer display string
    let trainerDisplay = 'Not Assigned';
    if (trainersRows.length > 0) {
      trainerDisplay = trainersRows.map(t => t.trainer_name).join(', ');
    } else if (basicData.trainer) {
      trainerDisplay = basicData.trainer;
    }

    const response = {
      success: true,
      data: {
        courseTitle: basicData.course_title,
        classStatus: basicData.class_status || null,
        operationalSummary: {
          trainer: trainerDisplay,
          startDate: basicData.start_date,
          endDate: basicData.end_date,
          classType: basicData.class_type || 'Physical',
          invitationPaused: !!basicData.invitation_paused,
          invitationRepliesBlocked: !!basicData.invitation_replies_blocked,
          virtualMeetingLink: basicData.virtual_meeting_link || null,
          virtualMeetingHostLink: basicData.virtual_meeting_host_link || null,
          virtualMeetingJoinLink: basicData.virtual_meeting_link || null,
          virtualMeetingProvider: basicData.virtual_meeting_provider || null,
          mode: basicData.mode,
          overallAssessment,
          tgsRef: basicData.tgs_ref,
          courseRunId: basicData.course_run_id,
          courseRunUuid: basicData.course_run_uuid,
          overallGrantStatus,
          overallClaimStatus
        },
        trainers: trainersRows.length > 0
          ? trainersRows.map(t => ({
            trainerId: t.trainer_id,
            trainerName: t.trainer_name,
            trainerEmail: t.trainer_email,
          }))
          : basicData.trainer
            ? [{ trainerId: null, trainerName: basicData.trainer, trainerEmail: null }]
            : [],
        acceptedTrainers: acceptedTrainersRows.map(t => ({
          trainerName: t.trainer_name,
          trainerEmail: t.trainer_email || null,
        })),
        // Tagged trainer list (LMS + accepted-invite + TPG), merged by email — the calendar/reschedule model.
        taggedTrainers: mergeTaggedTrainers({
          lms: trainersRows.map(t => ({ name: t.trainer_name, email: t.trainer_email })),
          accepted: acceptedTrainersRows.map(t => ({ name: t.trainer_name, email: t.trainer_email })),
          tpg: (basicData.tpg_assigned_trainer_name || '').trim() ? [{ name: basicData.tpg_assigned_trainer_name, email: basicData.tpg_assigned_trainer_email }] : [],
        }),
        enrolledLearners: learnersResult.rows.map(row => ({
          learnerName: row.learner_name,
          learnerEmail: row.learner_email,
          learnerTel: row.learner_tel,
          company: row.company,
          sponsorship: row.sponsorship,
          nationality: row.nationality,
          dob: row.dob,
          paymentDetails: row.payment_details,
          assessment: row.assessment,
          grantId: row.grant_id || '',
          claimId: row.claim_id || ''
        }))
      }
    };

    console.log('✅ Class details fetched successfully');
    return res.status(200).json(response);

  } catch (error) {
    console.error('❌ Error fetching class details:', error);
    return res.status(500).json({
      success: false,
      error: 'Internal server error'
    });
  }
}

export default withAuth(handler, { roles: ['admin', 'trainingProvider', 'developer'] });