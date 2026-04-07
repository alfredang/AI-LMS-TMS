import { NextApiRequest, NextApiResponse } from 'next';
import pool from '../../../lib/db';
import { normalizeTrainerName, splitTrainerList } from '@/lib/trainerInvitations';

interface UpcomingClass {
  id: string;
  courseRunId: string;
  courseTitle: string;
  courseCode: string;
  classStatus: string;
  digitalAttendanceId: string;
  startDate: string;
  endDate: string;
  assignedTrainerTpg: string;
  assignedTrainerTpgEmail: string;
  assignedTrainerLocal: string;
  assignedTrainerLocalEmail: string;
  nextAvailableTrainer: string;
  nextAvailableTrainerEmail: string;
  latestInvitationStatus: string;
  latestInvitationTrainer: string;
  numOfTrainee: number;
  trainersList?: string;
}

const parseDDMMYYYY = (d: string) => {
  const p = d.split(/[/-]/);
  return `${p[2]}-${p[1]}-${p[0]}`;
};

const isValidDate = (d: any) => {
  if (typeof d !== 'string' || !/^\d{2}[/-]\d{2}[/-]\d{4}$/.test(d)) return false;
  const iso = parseDDMMYYYY(d);
  const parsed = new Date(iso);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().startsWith(iso);
};

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
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
    let thresholdDays = 21;
    try {
      const thresholdResult = await pool.query(
        `SELECT upcoming_classes_threshold_days
         FROM training_provider
         LIMIT 1`
      );
      const rawThreshold = thresholdResult.rows[0]?.upcoming_classes_threshold_days;
      const parsedThreshold = parseInt(String(rawThreshold || '21'), 10);
      if (!Number.isNaN(parsedThreshold) && parsedThreshold > 0) {
        thresholdDays = parsedThreshold;
      }
    } catch (error) {
      // Column may not exist yet; keep the default.
    }

    const hasInvitationTable = (
      await pool.query(`SELECT 1 FROM information_schema.tables WHERE table_name = 'trainer_invitation' LIMIT 1`)
    ).rows.length > 0;
    // TPG column shows ONLY tpg_assigned_trainer_* (no fallback to assigned_trainer_*).
    // Rows without SSG-synced trainer data will render empty/N/A.
    const tpgNameExpr = `cr.tpg_assigned_trainer_name`;
    const tpgEmailExpr = `cr.tpg_assigned_trainer_email`;

    const {
      search,
      courseTitle,
      courseCode,
      courseRunId,
      trainer,
      classStatus,
      startDateFrom,
      endDateUntil,
      page = 0,
      limit = 20
    } = req.query;

    const pageNum = parseInt(page as string, 10) || 0;
    const limitNum = parseInt(limit as string, 10) || 20;
    const offset = pageNum * limitNum;

    const params: any[] = [];
    let paramIndex = 1;
    const filters: string[] = [
      'cr.start_date > CURRENT_DATE',
      `cr.class_status IN ('Confirmed', 'Pending')`,
      `cr.start_date <= CURRENT_DATE + ($${paramIndex} * INTERVAL '1 day')`
    ];
    params.push(thresholdDays);
    paramIndex++;

    if (search && search !== '') {
      filters.push(`(
        c.title ILIKE $${paramIndex} OR
        c.course_code ILIKE $${paramIndex} OR
        cr.course_run_id ILIKE $${paramIndex} OR
        COALESCE(${tpgNameExpr}, '') ILIKE $${paramIndex} OR
        c.trainers_list ILIKE $${paramIndex} OR
        EXISTS (
          SELECT 1
          FROM course_run_trainer crt
          WHERE crt.course_run_id = cr.id AND crt.trainer_name ILIKE $${paramIndex}
        )
      )`);
      params.push(`%${search}%`);
      paramIndex++;
    }

    if (courseTitle && courseTitle !== '') {
      filters.push(`c.title ILIKE $${paramIndex}`);
      params.push(`%${courseTitle}%`);
      paramIndex++;
    }

    if (courseCode && courseCode !== '') {
      filters.push(`c.course_code ILIKE $${paramIndex}`);
      params.push(`%${courseCode}%`);
      paramIndex++;
    }

    if (courseRunId && courseRunId !== '') {
      filters.push(`cr.course_run_id ILIKE $${paramIndex}`);
      params.push(`%${courseRunId}%`);
      paramIndex++;
    }

    if (trainer && trainer !== '') {
      filters.push(`(
        COALESCE(${tpgNameExpr}, '') ILIKE $${paramIndex} OR
        c.trainers_list ILIKE $${paramIndex} OR
        EXISTS (
          SELECT 1
          FROM course_run_trainer crt
          WHERE crt.course_run_id = cr.id AND crt.trainer_name ILIKE $${paramIndex}
        )
      )`);
      params.push(`%${trainer}%`);
      paramIndex++;
    }

    if (classStatus === 'Confirmed' || classStatus === 'Pending') {
      filters.push(`cr.class_status = $${paramIndex}`);
      params.push(classStatus);
      paramIndex++;
    }

    if (isValidDate(startDateFrom)) {
      filters.push(`cr.start_date >= $${paramIndex}`);
      params.push(parseDDMMYYYY(startDateFrom as string));
      paramIndex++;
    }

    if (isValidDate(endDateUntil)) {
      filters.push(`cr.end_date <= $${paramIndex}`);
      params.push(parseDDMMYYYY(endDateUntil as string));
      paramIndex++;
    }

    const whereClause = filters.length ? `WHERE ${filters.join(' AND ')}` : '';

    const baseQuery = `
      FROM course_run cr
      JOIN course c ON cr.course_id = c.id
      LEFT JOIN enrollment e ON e.course_run_id = cr.id
      ${whereClause}
    `;

    const mainResult = await pool.query(
      `
        SELECT
          cr.id,
          cr.course_run_id,
          c.title AS course_title,
          c.course_code,
          c.trainers_list,
          cr.class_status,
          cr.digital_attendance_id,
          cr.start_date,
          cr.end_date,
          ${tpgNameExpr} AS assigned_trainer_tpg,
          ${tpgEmailExpr} AS assigned_trainer_tpg_email,
          COUNT(e.id) AS num_of_trainee
        ${baseQuery}
        GROUP BY
          cr.id,
          cr.course_run_id,
          c.title,
          c.course_code,
          c.trainers_list,
          cr.class_status,
          cr.digital_attendance_id,
          cr.start_date,
          cr.end_date,
          ${tpgNameExpr},
          ${tpgEmailExpr}
        ORDER BY cr.start_date ASC NULLS LAST
        LIMIT $${paramIndex} OFFSET $${paramIndex + 1}
      `,
      [...params, limitNum, offset]
    );

    const countResult = await pool.query(
      `SELECT COUNT(DISTINCT cr.id) AS total_count
       FROM course_run cr
       JOIN course c ON cr.course_id = c.id
       ${whereClause}`,
      params
    );

    const statsResult = await pool.query(
      `
        SELECT
          COUNT(DISTINCT cr.id) AS total_classes,
          COUNT(DISTINCT cr.id) FILTER (
            WHERE EXISTS (SELECT 1 FROM course_run_trainer crt WHERE crt.course_run_id = cr.id)
          ) AS total_confirmed_classes,
          COUNT(DISTINCT cr.id) FILTER (
            WHERE NOT EXISTS (SELECT 1 FROM course_run_trainer crt WHERE crt.course_run_id = cr.id)
          ) AS total_pending_classes,
          COUNT(DISTINCT cr.id) FILTER (
            WHERE COALESCE(${tpgNameExpr}, '') <> ''
          ) AS total_assigned_tpg_classes,
          COUNT(DISTINCT cr.id) FILTER (
            WHERE EXISTS (SELECT 1 FROM course_run_trainer crt WHERE crt.course_run_id = cr.id)
          ) AS total_assigned_local_classes
        FROM course_run cr
        JOIN course c ON cr.course_id = c.id
        ${whereClause}
      `,
      params
    );

    const rows = mainResult.rows;
    const courseRunIds = rows.map((row) => row.id);

    const localTrainerMap = new Map<string, { names: string[]; emails: string[] }>();
    if (courseRunIds.length > 0) {
      const localTrainerResult = await pool.query(
        `
          SELECT course_run_id, trainer_name, trainer_email
          FROM course_run_trainer
          WHERE course_run_id = ANY($1::uuid[])
          ORDER BY assigned_at ASC
        `,
        [courseRunIds]
      );

      for (const row of localTrainerResult.rows) {
        const existing = localTrainerMap.get(row.course_run_id) || { names: [], emails: [] };
        existing.names.push(row.trainer_name || '');
        existing.emails.push(row.trainer_email || '');
        localTrainerMap.set(row.course_run_id, existing);
      }
    }

    const invitationMap = new Map<string, any[]>();
    if (hasInvitationTable && courseRunIds.length > 0) {
      const invitationResult = await pool.query(
        `
          SELECT course_run_id, trainer_name, trainer_email, status, created_at
          FROM trainer_invitation
          WHERE course_run_id = ANY($1::uuid[])
          ORDER BY created_at DESC
        `,
        [courseRunIds]
      );

      for (const row of invitationResult.rows) {
        const existing = invitationMap.get(row.course_run_id) || [];
        existing.push(row);
        invitationMap.set(row.course_run_id, existing);
      }
    }

    const upcomingClasses: UpcomingClass[] = rows.map((row) => {
      const trainerPool = splitTrainerList(row.trainers_list);
      const normalizedTrainerPool = trainerPool.map((trainerName) => normalizeTrainerName(trainerName));
      const localTrainerData = localTrainerMap.get(row.id) || { names: [], emails: [] };
      // LOCAL column shows ALL trainers from course_run_trainer (no dedup against TPG column).
      const allLocalPairs = localTrainerData.names
        .map((name, index) => ({ name, email: localTrainerData.emails[index] || '' }));
      const localAssigned = new Set(allLocalPairs.map((trainer) => normalizeTrainerName(trainer.name)));
      const invitations = invitationMap.get(row.id) || [];

      let nextAvailableTrainer = '';
      let nextAvailableTrainerEmail = '';
      let latestInvitationStatus = invitations[0]?.status || '';
      let latestInvitationTrainer = invitations[0]?.trainer_name || '';
      const localAssignedIndexes = allLocalPairs
        .map((trainer) => normalizedTrainerPool.lastIndexOf(normalizeTrainerName(trainer.name)))
        .filter((index) => index >= 0);
      const startIndex = localAssignedIndexes.length > 0
        ? Math.max(...localAssignedIndexes) + 1
        : 0;

      for (let index = startIndex; index < trainerPool.length; index++) {
        const trainerName = trainerPool[index];
        const normalized = normalizedTrainerPool[index];
        if (!normalized || localAssigned.has(normalized)) continue;
        const invitation = invitations.find((entry) => normalizeTrainerName(entry.trainer_name) === normalized);
        if (invitation?.status === 'declined') continue;
        nextAvailableTrainer = trainerName;
        nextAvailableTrainerEmail = invitation?.trainer_email || '';
        if (invitation?.status) {
          latestInvitationStatus = invitation.status;
          latestInvitationTrainer = invitation.trainer_name || trainerName;
        }
        break;
      }

      return {
        id: row.id,
        courseRunId: row.course_run_id,
        courseTitle: row.course_title,
        courseCode: row.course_code,
        classStatus: row.class_status,
        digitalAttendanceId: row.digital_attendance_id || '',
        startDate: row.start_date,
        endDate: row.end_date,
        assignedTrainerTpg: row.assigned_trainer_tpg || '',
        assignedTrainerTpgEmail: row.assigned_trainer_tpg_email || '',
        assignedTrainerLocal: allLocalPairs[0]?.name || '',
        assignedTrainerLocalEmail: allLocalPairs[0]?.email || '',
        nextAvailableTrainer,
        nextAvailableTrainerEmail,
        latestInvitationStatus,
        latestInvitationTrainer,
        numOfTrainee: parseInt(row.num_of_trainee || '0', 10),
        trainersList: row.trainers_list || '',
      };
    });

    const stats = statsResult.rows[0] || {};
    const totalCount = parseInt(countResult.rows[0]?.total_count || '0', 10);

    res.status(200).json({
      success: true,
      data: {
        classes: upcomingClasses,
        totalCount,
        currentPage: pageNum,
        totalPages: Math.ceil(totalCount / limitNum),
        stats: {
          totalClasses: parseInt(stats.total_classes || '0', 10),
          totalConfirmedClasses: parseInt(stats.total_confirmed_classes || '0', 10),
          totalPendingClasses: parseInt(stats.total_pending_classes || '0', 10),
          totalAssignedTpgClasses: parseInt(stats.total_assigned_tpg_classes || '0', 10),
          totalAssignedLocalClasses: parseInt(stats.total_assigned_local_classes || '0', 10),
        }
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
