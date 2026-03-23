import type { NextApiRequest, NextApiResponse } from 'next';
import pool from '../../../lib/db';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') {
    return res.status(405).json({ success: false, error: 'Method not allowed' });
  }

  try {
    const { search, upcoming } = req.query;

    let query = `
      SELECT
        cr.id,
        cr.course_run_id,
        c.title AS course_title,
        c.course_code,
        cr.start_date,
        cr.end_date,
        cr.assigned_trainer_id,
        cr.assigned_trainer_name,
        cr.assigned_trainer_email,
        COALESCE(ec.enrollment_count, 0) AS enrollment_count
      FROM course_run cr
      JOIN course c ON cr.course_id = c.id
      LEFT JOIN (
        SELECT course_run_id, COUNT(*) AS enrollment_count
        FROM enrollment
        GROUP BY course_run_id
      ) ec ON ec.course_run_id = cr.id
    `;

    const conditions: string[] = [];
    const params: any[] = [];

    if (upcoming === 'true') {
      conditions.push(`cr.start_date >= CURRENT_DATE`);
    }

    if (search && search !== '') {
      params.push(`%${search}%`);
      conditions.push(`(c.title ILIKE $${params.length} OR c.course_code ILIKE $${params.length} OR cr.course_run_id ILIKE $${params.length})`);
    }

    if (conditions.length > 0) {
      query += ` WHERE ` + conditions.join(' AND ');
    }

    query += ` ORDER BY cr.start_date ASC LIMIT 200`;

    const result = await pool.query(query, params);

    res.status(200).json({
      success: true,
      data: result.rows.map(row => ({
        id: row.id,
        courseRunId: row.course_run_id,
        courseTitle: row.course_title,
        courseCode: row.course_code,
        startDate: row.start_date,
        endDate: row.end_date,
        assignedTrainerId: row.assigned_trainer_id,
        assignedTrainerName: row.assigned_trainer_name,
        assignedTrainerEmail: row.assigned_trainer_email,
        enrollmentCount: parseInt(row.enrollment_count, 10),
      })),
    });
  } catch (error) {
    console.error('Error fetching course runs:', error);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
}
