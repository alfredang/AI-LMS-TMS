import type { NextApiRequest, NextApiResponse } from 'next';
import pool from '../../../lib/db';

/**
 * GET /api/admin/sibling-course-runs?courseRunUuid=<uuid>
 *
 * Lists the OTHER course runs that belong to the SAME course (same course_id)
 * as the given run — used to populate the "move to another run" dropdown on the
 * Rescheduling tab. Excludes the current run. Includes an active-enrolment count.
 */
export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') {
    return res.status(405).json({ success: false, error: 'Method not allowed' });
  }
  const courseRunUuid = String(req.query.courseRunUuid || '');
  if (!courseRunUuid) {
    return res.status(400).json({ success: false, error: 'courseRunUuid is required' });
  }

  try {
    const result = await pool.query(
      `SELECT cr.id, cr.course_run_id, cr.start_date, cr.end_date, cr.class_status,
              cr.assigned_trainer_name,
              (SELECT COUNT(*) FROM enrollment e
                 WHERE e.course_run_id = cr.id
                   AND LOWER(COALESCE(e.enrolment_status, '')) NOT IN ('admin removed', 'cancelled', 'withdrawn')
              ) AS enrolled_count
         FROM course_run cr
        WHERE cr.course_id = (SELECT course_id FROM course_run WHERE id = $1)
          AND cr.id <> $1
        ORDER BY cr.start_date ASC`,
      [courseRunUuid]
    );

    const data = result.rows.map((r) => ({
      id: r.id,
      courseRunId: r.course_run_id,
      startDate: r.start_date,
      endDate: r.end_date,
      classStatus: r.class_status,
      assignedTrainerName: r.assigned_trainer_name,
      enrolledCount: parseInt(r.enrolled_count, 10) || 0,
    }));

    return res.status(200).json({ success: true, data });
  } catch (err: any) {
    console.error('❌ [sibling-course-runs]', err?.message || err);
    return res.status(500).json({ success: false, error: err?.message || 'Internal server error' });
  }
}
