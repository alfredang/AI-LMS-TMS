import type { NextApiRequest, NextApiResponse } from 'next';
import pool from '../../../../lib/db';
import { getLocalYMD } from '../../../../lib/dateHelpers';

/**
 * GET /api/admin/course-runs/local-by-run-id?courseRunId=XXXXXXX
 *
 * Read-only lookup of the local `course_run` row (joined with `course`) by its
 * external SSG run id (e.g. `1325270`). Returns `data: null` if no local row
 * exists — the admin ViewCourseRun page uses this to surface local snapshot
 * columns (class_status, local/TPG trainer, digital_attendance_id) that SSG
 * doesn't expose.
 *
 * IMPORTANT: This endpoint performs NO writes / upserts. Contrast with
 * `/api/course-runs/view.ts` which silently upserts on every call.
 */

interface LocalCourseRunDTO {
  courseRunUuid: string;
  courseRunId: string;
  classStatus: string | null;
  assignedTrainerName: string | null;
  assignedTrainerEmail: string | null;
  assignedTrainerId: string | null;
  tpgAssignedTrainerName: string | null;
  tpgAssignedTrainerEmail: string | null;
  digitalAttendanceId: string | null;
  startDate: string | null;
  endDate: string | null;
  modeOfLearning: string | null;
  updatedAt: string | null;
  courseId: string;
  courseCode: string | null;
  courseTitle: string | null;
}

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse<{ success: boolean; data?: LocalCourseRunDTO | null; error?: string }>
) {
  if (req.method !== 'GET') {
    return res.status(405).json({ success: false, error: 'Method not allowed' });
  }

  const { courseRunId } = req.query;
  if (!courseRunId || typeof courseRunId !== 'string' || !courseRunId.trim()) {
    return res.status(400).json({ success: false, error: 'courseRunId query parameter is required' });
  }

  try {
    const result = await pool.query(
      `
      SELECT
        cr.id                          AS course_run_uuid,
        cr.course_run_id               AS course_run_id,
        cr.class_status                AS class_status,
        cr.assigned_trainer_name       AS assigned_trainer_name,
        cr.assigned_trainer_email      AS assigned_trainer_email,
        cr.assigned_trainer_id         AS assigned_trainer_id,
        cr.tpg_assigned_trainer_name   AS tpg_assigned_trainer_name,
        cr.tpg_assigned_trainer_email  AS tpg_assigned_trainer_email,
        cr.digital_attendance_id       AS digital_attendance_id,
        cr.start_date                  AS start_date,
        cr.end_date                    AS end_date,
        cr.mode_of_learning            AS mode_of_learning,
        cr.updated_at                  AS updated_at,
        c.id                           AS course_id,
        c.course_code                  AS course_code,
        c.title                        AS course_title
      FROM course_run cr
      JOIN course c ON cr.course_id = c.id
      WHERE cr.course_run_id = $1
      LIMIT 1
      `,
      [courseRunId.trim()]
    );

    if (result.rows.length === 0) {
      return res.status(200).json({ success: true, data: null });
    }

    const row = result.rows[0];
    const dto: LocalCourseRunDTO = {
      courseRunUuid: row.course_run_uuid,
      courseRunId: row.course_run_id,
      classStatus: row.class_status,
      assignedTrainerName: row.assigned_trainer_name,
      assignedTrainerEmail: row.assigned_trainer_email,
      assignedTrainerId: row.assigned_trainer_id,
      tpgAssignedTrainerName: row.tpg_assigned_trainer_name,
      tpgAssignedTrainerEmail: row.tpg_assigned_trainer_email,
      digitalAttendanceId: row.digital_attendance_id,
      startDate: row.start_date ? getLocalYMD(row.start_date) : null,
      endDate: row.end_date ? getLocalYMD(row.end_date) : null,
      modeOfLearning: row.mode_of_learning,
      updatedAt: row.updated_at ? new Date(row.updated_at).toISOString() : null,
      courseId: row.course_id,
      courseCode: row.course_code,
      courseTitle: row.course_title,
    };

    return res.status(200).json({ success: true, data: dto });
  } catch (error) {
    console.error('[local-by-run-id] DB error:', error);
    return res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Internal server error',
    });
  }
}
