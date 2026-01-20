import { NextApiRequest, NextApiResponse } from 'next';
import pool from '../../../lib/db';

interface CompletedClass {
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

    // Statistics Queries

    // 1. Completed Classes Found
    const completedClassesQuery = `
      SELECT 
        COUNT(*) AS completed_classes_found
      FROM course_run
      WHERE end_date < CURRENT_DATE;
    `;
    
    const completedClassesResult = await pool.query(completedClassesQuery);
    const completedClassesFound = parseInt(completedClassesResult.rows[0].completed_classes_found);

    // 2. Total Graduated Learners
    const graduatedLearnersQuery = `
      SELECT 
        COUNT(e.id) AS total_graduated_learners
      FROM enrollment e
      JOIN course_run cr 
        ON e.course_run_id = cr.id
      WHERE cr.end_date < CURRENT_DATE;
    `;
    
    const graduatedLearnersResult = await pool.query(graduatedLearnersQuery);
    const totalGraduatedLearners = parseInt(graduatedLearnersResult.rows[0].total_graduated_learners);

    // 3. Involved Trainers
    const involvedTrainersQuery = `
      SELECT 
        COUNT(DISTINCT cr.assigned_trainer_id) AS involved_trainers
      FROM course_run cr
      WHERE cr.end_date < CURRENT_DATE
        AND cr.assigned_trainer_id IS NOT NULL;
    `;
    
    const involvedTrainersResult = await pool.query(involvedTrainersQuery);
    const involvedTrainers = parseInt(involvedTrainersResult.rows[0].involved_trainers);

    // Build WHERE conditions for filtering completed classes
    let whereConditions = ['cr.end_date < CURRENT_DATE'];
    let paramCounter = 1;
    const queryParams: any[] = [];

    if (search) {
      whereConditions.push(`(
        LOWER(c.title) LIKE LOWER($${paramCounter}) OR 
        LOWER(c.course_code) LIKE LOWER($${paramCounter}) OR 
        LOWER(cr.course_run_id) LIKE LOWER($${paramCounter}) OR
        LOWER(au.full_name) LIKE LOWER($${paramCounter})
      )`);
      queryParams.push(`%${search}%`);
      paramCounter++;
    }

    if (courseTitle) {
      whereConditions.push(`LOWER(c.title) LIKE LOWER($${paramCounter})`);
      queryParams.push(`%${courseTitle}%`);
      paramCounter++;
    }

    if (courseCode) {
      whereConditions.push(`LOWER(c.course_code) LIKE LOWER($${paramCounter})`);
      queryParams.push(`%${courseCode}%`);
      paramCounter++;
    }

    if (courseRunId) {
      whereConditions.push(`LOWER(cr.course_run_id) LIKE LOWER($${paramCounter})`);
      queryParams.push(`%${courseRunId}%`);
      paramCounter++;
    }

    if (trainer) {
      whereConditions.push(`LOWER(au.full_name) LIKE LOWER($${paramCounter})`);
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

    // Count total matching records
    const countQuery = `
      SELECT COUNT(*) as total_count
      FROM course_run cr
      LEFT JOIN course c ON cr.course_id = c.id
      LEFT JOIN app_user au ON cr.assigned_trainer_id = au.id
      WHERE ${whereClause}
    `;

    console.log('📊 Count query:', countQuery);
    console.log('📊 Count params:', queryParams);

    const countResult = await pool.query(countQuery, queryParams);
    const totalCount = parseInt(countResult.rows[0].total_count);
    const totalPages = Math.ceil(totalCount / limitNum);

    // Get paginated data
    const dataQuery = `
      SELECT 
        cr.course_run_id as "courseRunId",
        c.title as "courseTitle", 
        c.course_code as "courseCode",
        cr.class_status as "classStatus",
        cr.digital_attendance_id as "digitalAttendanceId",
        cr.start_date::text as "startDate",
        cr.end_date::text as "endDate",
        COALESCE(au.full_name, 'Unassigned') as "trainerName",
        (
          SELECT COUNT(*)
          FROM enrollment e 
          WHERE e.course_run_id = cr.id
        ) as "numOfTrainee"
      FROM course_run cr
      LEFT JOIN course c ON cr.course_id = c.id
      LEFT JOIN app_user au ON cr.assigned_trainer_email = au.email
      LEFT JOIN (
        SELECT 
          course_run_id, 
          COUNT(*) as count
        FROM enrollment 
        GROUP BY course_run_id
      ) trainee_count ON cr.id = trainee_count.course_run_id
      WHERE ${whereClause}
      ORDER BY cr.end_date DESC
      LIMIT $${paramCounter} OFFSET $${paramCounter + 1}
    `;

    queryParams.push(limitNum, offset);

    console.log('📋 Data query:', dataQuery);
    console.log('📋 Data params:', queryParams);

    const dataResult = await pool.query(dataQuery, queryParams);

    const statistics = {
      completedClassesFound,
      totalGraduatedLearners,
      involvedTrainers
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

    console.log('✅ Completed classes response:', {
      statistics,
      classesCount: dataResult.rows.length,
      totalCount,
      totalPages,
      currentPage: pageNum
    });

    res.status(200).json(response);
  } catch (error) {
    console.error('❌ Error fetching completed classes:', error);
    res.status(500).json({ 
      success: false, 
      message: 'Failed to fetch completed classes',
      error: error instanceof Error ? error.message : 'Unknown error'
    });
  }
}