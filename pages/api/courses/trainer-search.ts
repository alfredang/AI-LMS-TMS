import type { NextApiRequest, NextApiResponse } from 'next';
import pool from '../../../lib/db';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') {
    return res.status(405).json({ message: 'Method not allowed' });
  }

  try {
    const {
      trainerId,
      search,
      courseType,
      modeOfLearning,
      upcoming
    } = req.query;

    if (!trainerId) {
      return res.status(400).json({ message: 'Trainer ID is required' });
    }

    // Base SQL query
    let sqlQuery = `
      SELECT
          c.id AS course_id,
          c.title AS course_title,
          c.course_code,
          c.course_type,
          c.tsc_title,
          c.tsc_code,
          c.image_url AS course_image,
          c.training_hours,
          c.assessment_hours,
          cr.id AS course_run_id,
          cr.course_run_id AS course_run_code,
          COALESCE(cr.assigned_trainer_name, au.full_name, '') AS assigned_trainer_name,
          cr.start_date,
          cr.end_date,
          cr.mode_of_learning
      FROM trainer_profile tp
      JOIN course_run cr ON tp.user_id = cr.assigned_trainer_id
      JOIN course c ON cr.course_id = c.id
      LEFT JOIN app_user au ON cr.assigned_trainer_id = au.id
      WHERE tp.user_id = $1
    `;

    const params: any[] = [trainerId];
    let paramIndex = 2;

    // Add search filter if provided
    if (search && search !== '') {
      sqlQuery += ` AND (
        c.title ILIKE $${paramIndex} OR 
        c.course_code ILIKE $${paramIndex} OR 
        c.tsc_title ILIKE $${paramIndex} OR 
        c.tsc_code ILIKE $${paramIndex}
      )`;
      params.push(`%${search}%`);
      paramIndex++;
    }

    // Add course type filter if provided
    if (courseType && courseType !== 'All') {
      sqlQuery += ` AND c.course_type = $${paramIndex}`;
      params.push(courseType);
      paramIndex++;
    }

    // Add mode of learning filter if provided
    if (modeOfLearning && modeOfLearning !== 'All') {
      sqlQuery += ` AND cr.mode_of_learning = $${paramIndex}`;
      params.push(modeOfLearning);
      paramIndex++;
    }

    // When fetching upcoming classes: not ended AND starts within today → today+7
    if (upcoming === 'true') {
      sqlQuery += `
        AND (cr.end_date IS NULL OR cr.end_date >= CURRENT_DATE)
        AND cr.start_date >= CURRENT_DATE
        AND cr.start_date <= CURRENT_DATE + INTERVAL '7 days'
      `;
    }

    sqlQuery += ` ORDER BY cr.start_date ASC`;

    const result = await pool.query(sqlQuery, params);

    // Transform the data to match the frontend Course interface
    const courses = result.rows.map((row: any) => ({
      id: row.course_id,
      title: row.course_title,
      courseCode: row.course_code,
      courseDuration: row.training_hours + row.assessment_hours, // Total duration
      courseType: row.course_type,
      tscTitle: row.tsc_title,
      tscCode: row.tsc_code,
      imageUrl: row.course_image,
      trainingHours: row.training_hours,
      assessmentHours: row.assessment_hours,
      courseRunId: row.course_run_id,
      courseRunCode: row.course_run_code,
      assignedTrainerName: row.assigned_trainer_name || '',
      tgsRef: row.course_code,
      startDate: row.start_date,
      endDate: row.end_date,
      modeOfLearning: Array.isArray(row.mode_of_learning) 
        ? row.mode_of_learning 
        : [row.mode_of_learning],
      trainer: 'Current Trainer',
      enrollmentStatus: 'not-enrolled',
      learners: []
    }));

    res.status(200).json(courses);
  } catch (error) {
    console.error('Error searching trainer courses:', error);
    res.status(500).json({ message: 'Internal server error' });
  }
}
