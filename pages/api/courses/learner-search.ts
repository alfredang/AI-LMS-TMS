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
  tsc_title: string;
  tsc_code: string;
  class_type: string;
  virtual_meeting_link: string;
  virtual_meeting_provider: string;
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
    const { userId, search, courseType, modeOfLearning } = req.query;

    if (!userId) {
      return res.status(400).json({ message: 'User ID is required' });
    }

    // Base SQL query to get enrolled courses for a learner with search capabilities
    let searchQuery = `
      SELECT 
        c.id AS course_id,
        c.title AS course_title,
        c.course_code AS course_code,
        c.tsc_title,
        c.tsc_code,
        c.course_code AS tgs_ref,
        cr.id AS course_run_id,
        cr.course_run_id AS course_run_code,
        (c.training_hours + c.assessment_hours) AS course_duration,
        c.training_hours,
        c.assessment_hours,
        COALESCE(assessment_count.total_assessments, 0) AS total_assessments,
        c.course_type,
        c.image_url AS course_image,
        cr.mode_of_learning,
        e.progress_percent,
        e.payment_status,
        e.assessment_status,
        e.enrolment_date,
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
    `;

    const params: any[] = [userId];
    let paramIndex = 2;

    // Add search filter if provided
    if (search && search !== '') {
      searchQuery += ` AND (
        c.title ILIKE $${paramIndex} OR 
        c.course_code ILIKE $${paramIndex} OR 
        c.tsc_title ILIKE $${paramIndex} OR 
        c.tsc_code ILIKE $${paramIndex} OR
        c.course_code ILIKE $${paramIndex}
      )`;
      params.push(`%${search}%`);
      paramIndex++;
    }

    // Add course type filter if provided
    if (courseType && courseType !== 'All') {
      searchQuery += ` AND c.course_type = $${paramIndex}`;
      params.push(courseType);
      paramIndex++;
    }

    // Add mode of learning filter if provided
    if (modeOfLearning && modeOfLearning !== 'All') {
      searchQuery += ` AND cr.mode_of_learning = $${paramIndex}`;
      params.push(modeOfLearning);
      paramIndex++;
    }

    searchQuery += ` ORDER BY cr.start_date DESC`;

    const result = await pool.query(searchQuery, params);

    // Transform the data to match frontend expectations
    const courses = result.rows.map((row: CourseRow) => ({
      id: row.course_id,
      title: row.course_title,
      courseCode: row.course_code || '', // Now course_code is tgs_ref
      tscTitle: row.tsc_title,
      tscCode: row.tsc_code,
      courseRunId: row.course_run_id,
      courseDuration: parseInt(row.course_duration.toString()),
      trainingHours: row.training_hours,
      assessmentHours: row.assessment_hours,
      totalAssessments: parseInt(row.total_assessments.toString()),
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
      enrollmentStatus: 'enrolled' // Hardcoded as all these are enrolled courses
    }));

    res.status(200).json({
      success: true,
      data: courses,
      total: courses.length
    });

  } catch (error) {
    console.error('Error searching learner courses:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error',
      error: process.env.NODE_ENV === 'development' ? (error as Error).message : undefined
    });
  }
}

export default withAuth(handler);
