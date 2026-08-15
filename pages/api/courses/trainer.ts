import { withAuth } from '@lib/auth/withAuth';
import type { NextApiRequest, NextApiResponse } from 'next';
import pool from '../../../lib/db';

async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') {
    return res.status(405).json({ message: 'Method not allowed' });
  }

  try {
    const { trainerId } = req.query;

    if (!trainerId) {
      return res.status(400).json({ message: 'Trainer ID is required' });
    }

    // SQL query to get all courses assigned to a trainer
    const sqlQuery = `
      SELECT
          c.id AS course_id,
          c.title AS course_title,
          -- current code in force (renewal issues a new code for the same course)
          COALESCE(NULLIF(c.new_course_code, ''), c.course_code) AS course_code,
          c.course_code AS original_course_code,
          c.new_course_code,
          c.course_type,
          c.tsc_title,
          c.tsc_code,
          c.image_url AS course_image,
          c.training_hours,
          c.assessment_hours,
          cr.id AS course_run_id,
          cr.course_run_id AS course_run_code,
          cr.digital_attendance_id,
          COALESCE(cr.assigned_trainer_name, au.full_name, '') AS assigned_trainer_name,
          cr.start_date,
          cr.end_date,
          cr.mode_of_learning,
          COALESCE(cr.class_type, 'Physical') AS class_type,
          CASE
            WHEN cr.virtual_meeting_provider = 'zoom'
              THEN COALESCE(cr.virtual_meeting_host_link, cr.virtual_meeting_link)
            ELSE cr.virtual_meeting_link
          END AS virtual_meeting_link,
          cr.virtual_meeting_host_link,
          cr.virtual_meeting_link AS virtual_meeting_join_link,
          cr.virtual_meeting_provider
      FROM course_run cr
      JOIN course c ON cr.course_id = c.id
      LEFT JOIN app_user au ON cr.assigned_trainer_id = au.id
      WHERE (
        cr.assigned_trainer_id = $1
        OR EXISTS (
          SELECT 1 FROM course_run_trainer crt
          WHERE crt.course_run_id = cr.id AND crt.trainer_id = $1
        )
      )
      ORDER BY
        CASE WHEN cr.end_date >= CURRENT_DATE THEN 0 ELSE 1 END,
        cr.start_date DESC
    `;

    const result = await pool.query(sqlQuery, [trainerId]);

    // Transform the data to match the frontend Course interface
    const courses = result.rows.map((row: any) => ({
      id: row.course_id,
      title: row.course_title,
      courseCode: row.course_code || '',
      originalCourseCode: row.original_course_code || '',
      newCourseCode: row.new_course_code || '',
      currentCourseCode: row.course_code || '',
      courseDuration: row.training_hours + row.assessment_hours, // Total duration
      courseType: row.course_type,
      tscTitle: row.tsc_title,
      tscCode: row.tsc_code,
      imageUrl: row.course_image,
      trainingHours: row.training_hours,
      assessmentHours: row.assessment_hours,
      courseRunId: row.course_run_id,
      courseRunCode: row.course_run_code,
      digitalAttendanceId: row.digital_attendance_id || '',
      assignedTrainerName: row.assigned_trainer_name || '',
      startDate: row.start_date,
      endDate: row.end_date,
      classType: row.class_type || 'Physical',
      virtualMeetingLink: row.virtual_meeting_link || null,
      virtualMeetingHostLink: row.virtual_meeting_host_link || null,
      virtualMeetingJoinLink: row.virtual_meeting_join_link || null,
      virtualMeetingProvider: row.virtual_meeting_provider || null,
      modeOfLearning: Array.isArray(row.mode_of_learning) 
        ? row.mode_of_learning 
        : [row.mode_of_learning], // Ensure it's always an array
      trainer: 'Current Trainer', // This will be updated with actual trainer info
      enrollmentStatus: 'not-enrolled', // Default for trainer view
      learners: [] // Empty for trainer view
    }));

    res.status(200).json(courses);
  } catch (error) {
    console.error('Error fetching trainer courses:', error);
    res.status(500).json({ message: 'Internal server error' });
  }
}

export default withAuth(handler);
