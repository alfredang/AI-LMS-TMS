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

const ensureJunctionTable = async () => {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS course_run_trainer (
        id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
        course_run_id UUID NOT NULL REFERENCES course_run(id) ON DELETE CASCADE,
        trainer_id UUID,
        trainer_name VARCHAR(255) NOT NULL,
        trainer_email VARCHAR(255),
        assigned_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(course_run_id, trainer_id)
    );
  `);
};

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse
) {
  // Set CORS headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
  res.setHeader('Pragma', 'no-cache');
  res.setHeader('Expires', '0');

  if (req.method === 'OPTIONS') {
    res.status(200).end();
    return;
  }

  if (req.method !== 'GET') {
    return res.status(405).json({ success: false, message: 'Method not allowed' });
  }

  try {
    await ensureJunctionTable();

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
      whereConditions.push(`(
        EXISTS (
          SELECT 1 FROM course_run_trainer crt 
          WHERE crt.course_run_id = cr.id AND crt.trainer_name ILIKE $${paramCounter}
        ) OR cr.assigned_trainer_name ILIKE $${paramCounter}
      )`);
      queryParams.push(`%${trainer}%`);
      paramCounter++;
    }

    const parseDDMMYYYY = (d: string) => { const p = d.split(/[\/\-]/); return `${p[2]}-${p[1]}-${p[0]}`; };
    const isValidDate = (d: any) => {
      if (typeof d !== 'string' || !/^\d{2}[\/\-]\d{2}[\/\-]\d{4}$/.test(d)) return false;
      const iso = parseDDMMYYYY(d);
      const parsed = new Date(iso);
      return !isNaN(parsed.getTime()) && parsed.toISOString().startsWith(iso);
    };

    if (isValidDate(startDateFrom)) {
      whereConditions.push(`cr.start_date >= $${paramCounter}`);
      queryParams.push(parseDDMMYYYY(startDateFrom as string));
      paramCounter++;
    }

    if (isValidDate(endDateUntil)) {
      whereConditions.push(`cr.end_date <= $${paramCounter}`);
      queryParams.push(parseDDMMYYYY(endDateUntil as string));
      paramCounter++;
    }

    const whereClause = whereConditions.join(' AND ');

    // Statistics queries (filtered)
    const completedClassesResult = await pool.query(`
      SELECT COUNT(*) AS completed_classes_found
      FROM course_run cr
      LEFT JOIN course c ON cr.course_id = c.id
      LEFT JOIN app_user au ON cr.assigned_trainer_email = au.email
      WHERE ${whereClause}
    `, queryParams);
    const completedClassesFound = parseInt(completedClassesResult.rows[0].completed_classes_found);

    const graduatedLearnersResult = await pool.query(`
      SELECT COUNT(e.id) AS total_graduated_learners
      FROM enrollment e
      JOIN course_run cr ON e.course_run_id = cr.id
      LEFT JOIN course c ON cr.course_id = c.id
      LEFT JOIN app_user au ON cr.assigned_trainer_email = au.email
      WHERE ${whereClause}
    `, queryParams);
    const totalGraduatedLearners = parseInt(graduatedLearnersResult.rows[0].total_graduated_learners);

    const involvedTrainersResult = await pool.query(`
      SELECT COUNT(DISTINCT trainer_name) as involved_trainers
      FROM (
        SELECT crt.trainer_name
        FROM course_run cr
        JOIN course c ON cr.course_id = c.id
        LEFT JOIN app_user au ON cr.assigned_trainer_email = au.email
        JOIN course_run_trainer crt ON cr.id = crt.course_run_id
        WHERE ${whereClause}
        UNION
        SELECT cr.assigned_trainer_name as trainer_name
        FROM course_run cr
        JOIN course c ON cr.course_id = c.id
        LEFT JOIN app_user au ON cr.assigned_trainer_email = au.email
        WHERE ${whereClause}
          AND cr.assigned_trainer_name IS NOT NULL
      ) all_trainers
    `, queryParams);
    const involvedTrainers = parseInt(involvedTrainersResult.rows[0].involved_trainers);

    // Count total matching records
    const countQuery = `
      SELECT COUNT(*) as total_count
      FROM course_run cr
      LEFT JOIN course c ON cr.course_id = c.id
      LEFT JOIN app_user au ON cr.assigned_trainer_email = au.email
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
        COALESCE(
          NULLIF((SELECT STRING_AGG(trainer_name, ', ') FROM course_run_trainer WHERE course_run_id = cr.id), ''),
          cr.assigned_trainer_name,
          'Unassigned'
        ) as "trainerName",
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
      ORDER BY cr.course_run_id DESC
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