import { NextApiRequest, NextApiResponse } from 'next';
import pool from '../../../lib/db';

interface UpcomingClass {
  id: string; // UUID of the course run
  courseRunId: string;
  courseTitle: string;
  courseCode: string;
  classStatus: string;
  digitalAttendanceId: string;
  startDate: string;
  endDate: string;
  trainerName: string;
  assignedTrainerName: string;
  assignedTrainerEmail: string;
  numOfTrainee: number;
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
    const { 
      search,
      courseTitle,
      courseCode,
      courseRunId,
      trainer,
      startDateFrom,
      endDateUntil,
      page = 0,
      limit = 20
    } = req.query;

    let upcomingClassesQuery = `
      SELECT 
          cr.id,
          cr.course_run_id,
          c.title AS course_title,
          c.course_code,
          cr.class_status,
          cr.digital_attendance_id,
          cr.start_date,
          cr.end_date,
          au.full_name AS trainer_name,
          cr.assigned_trainer_name,
          cr.assigned_trainer_email,
          COUNT(e.id) AS num_of_trainee
      FROM course_run cr
      JOIN course c 
          ON cr.course_id = c.id
      LEFT JOIN app_user au 
          ON cr.assigned_trainer_email = au.email
      LEFT JOIN enrollment e 
          ON e.course_run_id = cr.id
      WHERE cr.start_date > CURRENT_DATE
    `;

    const params: any[] = [];
    let paramIndex = 1;

    // Add search filters
    if (search && search !== '') {
      upcomingClassesQuery += ` AND (
        c.title ILIKE $${paramIndex} OR 
        c.course_code ILIKE $${paramIndex} OR 
        cr.course_run_id ILIKE $${paramIndex} OR
        au.full_name ILIKE $${paramIndex}
      )`;
      params.push(`%${search}%`);
      paramIndex++;
    }

    // Add advanced filters
    if (courseTitle && courseTitle !== '') {
      upcomingClassesQuery += ` AND c.title ILIKE $${paramIndex}`;
      params.push(`%${courseTitle}%`);
      paramIndex++;
    }

    if (courseCode && courseCode !== '') {
      upcomingClassesQuery += ` AND c.course_code ILIKE $${paramIndex}`;
      params.push(`%${courseCode}%`);
      paramIndex++;
    }

    if (courseRunId && courseRunId !== '') {
      upcomingClassesQuery += ` AND cr.course_run_id ILIKE $${paramIndex}`;
      params.push(`%${courseRunId}%`);
      paramIndex++;
    }

    if (trainer && trainer !== '') {
      upcomingClassesQuery += ` AND au.full_name ILIKE $${paramIndex}`;
      params.push(`%${trainer}%`);
      paramIndex++;
    }

    if (startDateFrom && startDateFrom !== '') {
      upcomingClassesQuery += ` AND cr.start_date >= $${paramIndex}`;
      params.push(startDateFrom);
      paramIndex++;
    }

    if (endDateUntil && endDateUntil !== '') {
      upcomingClassesQuery += ` AND cr.end_date <= $${paramIndex}`;
      params.push(endDateUntil);
      paramIndex++;
    }

    upcomingClassesQuery += `
      GROUP BY 
          cr.id,
          cr.course_run_id,
          c.title,
          c.course_code,
          cr.class_status,
          cr.digital_attendance_id,
          cr.start_date,
          cr.end_date,
          au.full_name,
          cr.assigned_trainer_name,
          cr.assigned_trainer_email
      ORDER BY cr.start_date ASC
    `;

    // Add pagination
    const pageNum = parseInt(page as string) || 0;
    const limitNum = parseInt(limit as string) || 20;
    const offset = pageNum * limitNum;

    upcomingClassesQuery += ` LIMIT $${paramIndex} OFFSET $${paramIndex + 1}`;
    params.push(limitNum, offset);

    const result = await pool.query(upcomingClassesQuery, params);

    // Get total count for pagination
    let countQuery = `
      SELECT COUNT(DISTINCT cr.course_run_id) AS total_count
      FROM course_run cr
      JOIN course c ON cr.course_id = c.id
      LEFT JOIN app_user au ON cr.assigned_trainer_email = au.email
      LEFT JOIN enrollment e ON e.course_run_id = cr.id
      WHERE cr.start_date > CURRENT_DATE
    `;

    const countParams: any[] = [];
    let countParamIndex = 1;

    // Apply same filters for count
    if (search && search !== '') {
      countQuery += ` AND (
        c.title ILIKE $${countParamIndex} OR 
        c.course_code ILIKE $${countParamIndex} OR 
        cr.course_run_id ILIKE $${countParamIndex} OR
        au.full_name ILIKE $${countParamIndex}
      )`;
      countParams.push(`%${search}%`);
      countParamIndex++;
    }

    if (courseTitle && courseTitle !== '') {
      countQuery += ` AND c.title ILIKE $${countParamIndex}`;
      countParams.push(`%${courseTitle}%`);
      countParamIndex++;
    }

    if (courseCode && courseCode !== '') {
      countQuery += ` AND c.course_code ILIKE $${countParamIndex}`;
      countParams.push(`%${courseCode}%`);
      countParamIndex++;
    }

    if (courseRunId && courseRunId !== '') {
      countQuery += ` AND cr.course_run_id ILIKE $${countParamIndex}`;
      countParams.push(`%${courseRunId}%`);
      countParamIndex++;
    }

    if (trainer && trainer !== '') {
      countQuery += ` AND au.full_name ILIKE $${countParamIndex}`;
      countParams.push(`%${trainer}%`);
      countParamIndex++;
    }

    if (startDateFrom && startDateFrom !== '') {
      countQuery += ` AND cr.start_date >= $${countParamIndex}`;
      countParams.push(startDateFrom);
      countParamIndex++;
    }

    if (endDateUntil && endDateUntil !== '') {
      countQuery += ` AND cr.end_date <= $${countParamIndex}`;
      countParams.push(endDateUntil);
      countParamIndex++;
    }

    const countResult = await pool.query(countQuery, countParams);
    const totalCount = parseInt(countResult.rows[0]?.total_count) || 0;

    const upcomingClasses: UpcomingClass[] = result.rows.map(row => ({
      id: row.id,
      courseRunId: row.course_run_id,
      courseTitle: row.course_title,
      courseCode: row.course_code,
      classStatus: row.class_status,
      digitalAttendanceId: row.digital_attendance_id,
      startDate: row.start_date,
      endDate: row.end_date,
      trainerName: row.trainer_name || 'No Trainer Assigned',
      assignedTrainerName: row.assigned_trainer_name || '',
      assignedTrainerEmail: row.assigned_trainer_email || '',
      numOfTrainee: parseInt(row.num_of_trainee) || 0,
    }));

    res.status(200).json({
      success: true,
      data: {
        classes: upcomingClasses,
        totalCount,
        currentPage: pageNum,
        totalPages: Math.ceil(totalCount / limitNum)
      }
    });

  } catch (error) {
    console.error('Error fetching upcoming classes:', error);
    res.status(500).json({ 
      success: false,
      message: 'Internal server error',
      error: error instanceof Error ? error.message : 'Unknown error'
    });
  }
}