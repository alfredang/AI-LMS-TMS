import { NextApiRequest, NextApiResponse } from 'next';
import pool from '../../../lib/db';

interface OngoingClass {
  courseRunId: string;
  courseTitle: string;
  courseCode: string;
  classStatus: string;
  digitalAttendanceId: string;
  startDate: string;
  endDate: string;
  trainerName: string;
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
    return res.status(405).json({ success: false, message: 'Method not allowed' });
  }

  try {

    const {
      page = '0',
      limit = '20',
      search = '',
      courseTitle = '',
      courseCode = '',
      courseRunId = '',
      trainer = '',
      startDateFrom = '',
      endDateUntil = ''
    } = req.query;

    const pageNum = parseInt(page as string);
    const limitNum = parseInt(limit as string);
    const offset = pageNum * limitNum;

    console.log('🔄 Fetching ongoing classes with params:', {
      page: pageNum,
      limit: limitNum,
      search,
      courseTitle,
      courseCode,
      courseRunId,
      trainer,
      startDateFrom,
      endDateUntil
    });

    // First, get the statistics for ongoing classes
    console.log('📊 Calculating ongoing classes statistics...');

    // 1. Ongoing Classes Found
    const ongoingClassesQuery = `
      SELECT COUNT(*) as ongoing_classes_found
      FROM course_run
      WHERE CURRENT_DATE BETWEEN start_date AND end_date
    `;
    const ongoingClassesResult = await pool.query(ongoingClassesQuery);
    const ongoingClassesFound = parseInt(ongoingClassesResult.rows[0].ongoing_classes_found);

    // 2. Learners In Session
    const learnersInSessionQuery = `
      SELECT COUNT(e.id) as learners_in_session
      FROM enrollment e
      JOIN course_run cr ON e.course_run_id = cr.id
      WHERE CURRENT_DATE BETWEEN cr.start_date AND cr.end_date
    `;
    const learnersInSessionResult = await pool.query(learnersInSessionQuery);
    const learnersInSession = parseInt(learnersInSessionResult.rows[0].learners_in_session);

    // 3. Active Trainers
    const activeTrainersQuery = `
      SELECT COUNT(DISTINCT cr.assigned_trainer_id) as active_trainers
      FROM course_run cr
      WHERE CURRENT_DATE BETWEEN cr.start_date AND cr.end_date
        AND cr.assigned_trainer_id IS NOT NULL
    `;
    const activeTrainersResult = await pool.query(activeTrainersQuery);
    const activeTrainers = parseInt(activeTrainersResult.rows[0].active_trainers);

    // Build the WHERE clause for filtering ongoing classes
    let whereConditions = ['CURRENT_DATE BETWEEN cr.start_date AND cr.end_date'];
    const queryParams: any[] = [];
    let paramCounter = 1;

    // Add search filters
    if (search) {
      whereConditions.push(`(
        c.title ILIKE $${paramCounter} OR 
        c.course_code ILIKE $${paramCounter} OR 
        cr.course_run_id ILIKE $${paramCounter}
      )`);
      queryParams.push(`%${search}%`);
      paramCounter++;
    }

    if (courseTitle) {
      whereConditions.push(`c.title ILIKE $${paramCounter}`);
      queryParams.push(`%${courseTitle}%`);
      paramCounter++;
    }

    if (courseCode) {
      whereConditions.push(`c.course_code ILIKE $${paramCounter}`);
      queryParams.push(`%${courseCode}%`);
      paramCounter++;
    }

    if (courseRunId) {
      whereConditions.push(`cr.course_run_id ILIKE $${paramCounter}`);
      queryParams.push(`%${courseRunId}%`);
      paramCounter++;
    }

    if (trainer) {
      whereConditions.push(`au.full_name ILIKE $${paramCounter}`);
      queryParams.push(`%${trainer}%`);
      paramCounter++;
    }

    if (startDateFrom) {
      whereConditions.push(`cr.start_date >= $${paramCounter}`);
      queryParams.push(startDateFrom);
      paramCounter++;
    }

    if (endDateUntil) {
      whereConditions.push(`cr.end_date <= $${paramCounter}`);
      queryParams.push(endDateUntil);
      paramCounter++;
    }

    const whereClause = whereConditions.join(' AND ');

    // Get total count for pagination
    const countQuery = `
      SELECT COUNT(*) as total
      FROM course_run cr
      JOIN course c ON cr.course_id = c.id
      LEFT JOIN app_user au ON cr.assigned_trainer_id = au.id
      WHERE ${whereClause}
    `;

    console.log('🔢 Count query:', countQuery);
    console.log('🔢 Count params:', queryParams);

    const countResult = await pool.query(countQuery, queryParams);
    const totalCount = parseInt(countResult.rows[0].total);
    const totalPages = Math.ceil(totalCount / limitNum);

    // Get the actual ongoing classes data
    const dataQuery = `
      SELECT 
        cr.course_run_id as "courseRunId",
        c.title as "courseTitle",
        c.course_code as "courseCode",
        cr.class_status as "classStatus",
        cr.digital_attendance_id as "digitalAttendanceId",
        cr.start_date as "startDate",
        cr.end_date as "endDate",
        COALESCE(au.full_name, 'Unassigned') as "trainerName",
        COALESCE(trainee_count.count, 0) as "numOfTrainee"
      FROM course_run cr
      JOIN course c ON cr.course_id = c.id
      LEFT JOIN app_user au ON cr.assigned_trainer_email = au.email
      LEFT JOIN (
        SELECT 
          course_run_id, 
          COUNT(*) as count
        FROM enrollment 
        GROUP BY course_run_id
      ) trainee_count ON cr.id = trainee_count.course_run_id
      WHERE ${whereClause}
      ORDER BY cr.start_date ASC
      LIMIT $${paramCounter} OFFSET $${paramCounter + 1}
    `;

    queryParams.push(limitNum, offset);

    console.log('📋 Data query:', dataQuery);
    console.log('📋 Data params:', queryParams);

    const dataResult = await pool.query(dataQuery, queryParams);

    const statistics = {
      ongoingClassesFound,
      learnersInSession,
      activeTrainers
    };

    const response = {
      success: true,
      data: {
        statistics,
        classes: dataResult.rows,
        totalCount,
        totalPages,
        currentPage: pageNum,
        itemsPerPage: limitNum
      }
    };

    console.log('✅ Ongoing classes response:', {
      statistics,
      classesCount: dataResult.rows.length,
      totalCount,
      totalPages,
      currentPage: pageNum
    });

    res.status(200).json(response);
  } catch (error) {
    console.error('❌ Error fetching ongoing classes:', error);
    res.status(500).json({ 
      success: false, 
      message: 'Failed to fetch ongoing classes',
      error: error instanceof Error ? error.message : 'Unknown error'
    });
  }
}