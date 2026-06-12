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
  await pool.query(`ALTER TABLE course_run ADD COLUMN IF NOT EXISTS tpg_sync_status TEXT`);
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

  // PUT — Update class status for an ongoing class row
  if (req.method === 'PUT') {
    try {
      const { id, class_status } = req.body;
      if (!id) {
        return res.status(400).json({ success: false, error: 'id is required' });
      }
      const validStatuses = ['Confirmed', 'Pending', 'Cancelled'];
      if (!class_status || !validStatuses.includes(class_status)) {
        return res.status(400).json({ success: false, error: `Invalid status. Must be one of: ${validStatuses.join(', ')}` });
      }
      await pool.query(
        `UPDATE course_run SET class_status = $1, updated_at = NOW() WHERE id = $2`,
        [class_status, id]
      );
      return res.status(200).json({ success: true });
    } catch (err) {
      console.error('Error updating ongoing class status:', err);
      return res.status(500).json({ success: false, error: 'Failed to update' });
    }
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
      learnerFilter = '',
      trainerAssignmentFilter = '',
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
      learnerFilter,
      trainerAssignmentFilter,
      startDateFrom,
      endDateUntil
    });

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
      whereConditions.push(`(
        EXISTS (
          SELECT 1 FROM course_run_trainer crt 
          WHERE crt.course_run_id = cr.id AND crt.trainer_name ILIKE $${paramCounter}
        ) OR cr.assigned_trainer_name ILIKE $${paramCounter}
      )`);
      queryParams.push(`%${trainer}%`);
      paramCounter++;
    }

    if (learnerFilter === 'withLearners') {
      whereConditions.push(`EXISTS (SELECT 1 FROM enrollment e WHERE e.course_run_id = cr.id)`);
    } else if (learnerFilter === 'noLearners') {
      whereConditions.push(`NOT EXISTS (SELECT 1 FROM enrollment e WHERE e.course_run_id = cr.id)`);
    }

    const trainerAssignedSql = `(
      EXISTS (SELECT 1 FROM course_run_trainer crt WHERE crt.course_run_id = cr.id)
      OR NULLIF(BTRIM(COALESCE(cr.assigned_trainer_name, '')), '') IS NOT NULL
      OR NULLIF(BTRIM(COALESCE(cr.assigned_trainer_email, '')), '') IS NOT NULL
      OR NULLIF(BTRIM(COALESCE(cr.tpg_assigned_trainer_name, '')), '') IS NOT NULL
      OR NULLIF(BTRIM(COALESCE(cr.tpg_assigned_trainer_email, '')), '') IS NOT NULL
    )`;

    if (trainerAssignmentFilter === 'withTrainers') {
      whereConditions.push(trainerAssignedSql);
    } else if (trainerAssignmentFilter === 'noTrainers') {
      whereConditions.push(`NOT ${trainerAssignedSql}`);
    }

    const classStatus = req.query.classStatus;
    if (classStatus === 'Confirmed' || classStatus === 'Pending' || classStatus === 'Cancelled') {
      whereConditions.push(`cr.class_status = $${paramCounter}`);
      queryParams.push(classStatus);
      paramCounter++;
    } else if (classStatus === 'ActiveOnly') {
      // Default Ongoing Classes view: hide cancelled runs. Pass
      // classStatus=all explicitly to include cancelled classes.
      whereConditions.push(`cr.class_status IN ('Confirmed', 'Pending')`);
    }

    const parseDDMMYYYY = (d: string) => {
      const p = d.split(/[/-]/);
      return `${p[2]}-${p[1]}-${p[0]}`;
    };

    const isValidDate = (d: any) => {
      if (typeof d !== 'string' || !/^\d{2}[/-]\d{2}[/-]\d{4}$/.test(d)) return false;
      const p = d.split(/[/-]/);
      const day = parseInt(p[0], 10);
      const month = parseInt(p[1], 10);
      const year = parseInt(p[2], 10);
      const date = new Date(year, month - 1, day);
      return date.getFullYear() === year && date.getMonth() === month - 1 && date.getDate() === day;
    };

    if (isValidDate(startDateFrom)) {
      whereConditions.push(`cr.start_date::date >= $${paramCounter}`);
      queryParams.push(parseDDMMYYYY(startDateFrom as string));
      paramCounter++;
    }

    if (isValidDate(endDateUntil)) {
      whereConditions.push(`cr.end_date::date <= $${paramCounter}`);
      queryParams.push(parseDDMMYYYY(endDateUntil as string));
      paramCounter++;
    }

    const classType = req.query.classType;
    if (classType === 'Physical' || classType === 'Virtual' || classType === 'Hybrid' || classType === 'External') {
      whereConditions.push(`COALESCE(cr.class_type, 'Physical') = $${paramCounter}`);
      queryParams.push(classType);
      paramCounter++;
    }

    const courseType = req.query.courseType;
    if (courseType === 'WSQ' || courseType === 'IBF' || courseType === 'Non-WSQ') {
      whereConditions.push(`c.course_type = $${paramCounter}`);
      queryParams.push(courseType);
      paramCounter++;
    }

    const whereClause = whereConditions.join(' AND ');

    // First, get the statistics for ongoing classes with filters applied
    console.log('📊 Calculating ongoing classes statistics...');

    // 1. Ongoing Classes Found
    const ongoingClassesQuery = `
      SELECT COUNT(*) as ongoing_classes_found
      FROM course_run cr
      JOIN course c ON cr.course_id = c.id
      WHERE ${whereClause}
    `;
    const ongoingClassesResult = await pool.query(ongoingClassesQuery, queryParams);
    const ongoingClassesFound = parseInt(ongoingClassesResult.rows[0].ongoing_classes_found);

    // 2. Learners In Session
    const learnersInSessionQuery = `
      SELECT COUNT(e.id) as learners_in_session
      FROM enrollment e
      JOIN course_run cr ON e.course_run_id = cr.id
      JOIN course c ON cr.course_id = c.id
      WHERE ${whereClause}
    `;
    const learnersInSessionResult = await pool.query(learnersInSessionQuery, queryParams);
    const learnersInSession = parseInt(learnersInSessionResult.rows[0].learners_in_session);

    // 3. Active Trainers
    const activeTrainersQuery = `
      SELECT COUNT(DISTINCT trainer_name) as active_trainers
      FROM (
        SELECT crt.trainer_name
        FROM course_run cr
        JOIN course c ON cr.course_id = c.id
        JOIN course_run_trainer crt ON cr.id = crt.course_run_id
        WHERE ${whereClause}
        UNION
        SELECT cr.assigned_trainer_name as trainer_name
        FROM course_run cr
        JOIN course c ON cr.course_id = c.id
        WHERE ${whereClause}
          AND cr.assigned_trainer_name IS NOT NULL
      ) all_trainers
    `;
    const activeTrainersResult = await pool.query(activeTrainersQuery, queryParams);
    const activeTrainers = parseInt(activeTrainersResult.rows[0].active_trainers);

    // Get total count for pagination
    const countQuery = `
      SELECT COUNT(*) as total
      FROM course_run cr
      JOIN course c ON cr.course_id = c.id
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
        cr.id as "id",
        cr.course_run_id as "courseRunId",
        c.title as "courseTitle",
        c.course_code as "courseCode",
        cr.class_status as "classStatus",
        COALESCE(cr.class_type, 'Physical') as "classType",
        cr.digital_attendance_id as "digitalAttendanceId",
        cr.start_date as "startDate",
        cr.end_date as "endDate",
        COALESCE(cr.assigned_trainer_name, 'Unassigned') as "trainerName",
        cr.tpg_assigned_trainer_name as "assignedTrainerTpg",
        cr.tpg_assigned_trainer_email as "assignedTrainerTpgEmail",
        cr.tpg_sync_status as "tpgSyncStatus",
        COALESCE(cr.assigned_trainer_name, '') as "assignedTrainerLocal",
        COALESCE(cr.assigned_trainer_email, '') as "assignedTrainerLocalEmail",
        COALESCE(trainee_count.count, 0) as "numOfTrainee"
      FROM course_run cr
      JOIN course c ON cr.course_id = c.id
      LEFT JOIN (
        SELECT
          course_run_id,
          COUNT(*) as count
        FROM enrollment
        GROUP BY course_run_id
      ) trainee_count ON cr.id = trainee_count.course_run_id
      WHERE ${whereClause}
      ORDER BY cr.start_date DESC NULLS LAST, cr.end_date DESC NULLS LAST
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
