import { withAuth } from '@lib/auth/withAuth';
import { NextApiRequest, NextApiResponse } from 'next';
import pool from '../../../lib/db';

interface CourseRow {
  course_id: string;
  course_title: string;
  course_code: string;
  course_run_id: string;
  course_run_code: string;
  course_duration: number;
  training_hours: number;
  assessment_hours: number;
  total_assessments: number;
  course_type: string;
  course_image: string;
  mode_of_learning: string;
  progress_percent: number;
  payment_status: string;
  assessment_status: string;
  enrolment_date: string;
  start_date: string;
  end_date: string;
  class_status: string;
  class_type: string;
  virtual_meeting_link: string;
  virtual_meeting_provider: string;
  enrolment_id: string;
  enrolment_status: string;
  nric: string;
  email: string;
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
    const { userId } = req.query;

    if (!userId) {
      return res.status(400).json({ message: 'User ID is required' });
    }

    // SQL query to get enrolled courses for a learner
    const enrolledCoursesQuery = `
      SELECT 
        c.id AS course_id,
        c.title AS course_title,
        public.course_code_at(c.id, COALESCE(e.created_at, cr.created_at, now())) AS course_code,
        cr.id AS course_run_id,
        cr.course_run_id AS course_run_code,
        (COALESCE(c.training_hours, 0) + COALESCE(c.assessment_hours, 0)) AS course_duration,
        COALESCE(c.training_hours, 0) AS training_hours,
        COALESCE(c.assessment_hours, 0) AS assessment_hours,
        COALESCE(assessment_count.total_assessments, 0) AS total_assessments,
        c.course_type,
        c.image_url AS course_image,
        cr.mode_of_learning,
        e.progress_percent,
        e.payment_status,
        e.assessment_status,
        e.enrolment_date,
        e.enrolment_id,
        e.enrolment_status,
        e.nric,
        e.email,
        e.certificate,
        cr.start_date,
        cr.end_date,
        cr.class_status,
        COALESCE(cr.class_type, 'Physical') AS class_type,
        cr.virtual_meeting_link,
        cr.virtual_meeting_provider
      FROM app_user u
      JOIN enrollment e ON u.id = e.user_id
      JOIN course c ON e.course_id = c.id
      JOIN course_run cr ON e.course_run_id = cr.id
      LEFT JOIN (
        SELECT 
          course_id,
          COUNT(a.id) AS total_assessments
        FROM assessment a
        GROUP BY course_id
      ) assessment_count ON c.id = assessment_count.course_id
      WHERE u.id = $1
        AND LOWER(COALESCE(e.enrolment_status, '')) NOT IN ('admin removed', 'cancelled', 'withdrawn')
      ORDER BY cr.start_date DESC
    `;

    const result = await pool.query(enrolledCoursesQuery, [userId]);

    // Transform the data to match frontend expectations
    const courses = result.rows.map((row: CourseRow) => ({
      id: row.course_id,
      title: row.course_title,
      courseCode: row.course_code,
      courseRunId: row.course_run_id,
      courseRunCode: row.course_run_code,
      courseDuration: parseInt(row.course_duration?.toString() ?? '0') || 0,
      trainingHours: row.training_hours ?? 0,
      assessmentHours: row.assessment_hours ?? 0,
      totalAssessments: parseInt(row.total_assessments?.toString() ?? '0') || 0,
      courseType: row.course_type,
      imageUrl: row.course_image,
      modeOfLearning: [row.mode_of_learning], // Convert to array as expected by frontend
      progressPercent: parseFloat(row.progress_percent.toString()) || 0,
      paymentStatus: row.payment_status,
      assessmentStatus: row.assessment_status,
      enrollmentDate: row.enrolment_date,
      startDate: row.start_date,
      endDate: row.end_date,
      classStatus: row.class_status,
      classType: row.class_type || 'Physical',
      virtualMeetingLink: row.virtual_meeting_link || null,
      virtualMeetingProvider: row.virtual_meeting_provider || null,
      enrolmentId: row.enrolment_id || null,
      enrolmentStatus: row.enrolment_status || null,
      nric: row.nric || null,
      email: row.email || null,
      certificate: (row as any).certificate || null,
      enrollmentStatus: 'enrolled' // Hardcoded as all these are enrolled courses
    }));

    res.status(200).json({
      success: true,
      data: courses,
      total: courses.length
    });

  } catch (error) {
    console.error('Error fetching enrolled courses:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error',
      error: process.env.NODE_ENV === 'development' ? (error as Error).message : undefined
    });
  }
}

export default withAuth(handler);
