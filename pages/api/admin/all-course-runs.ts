import type { NextApiRequest, NextApiResponse } from 'next';
import pool from '../../../lib/db';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') {
    return res.status(405).json({ success: false, error: 'Method not allowed' });
  }

  try {
    const { search } = req.query;

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
        cr.assigned_trainer_email
      FROM course_run cr
      JOIN course c ON cr.course_id = c.id
    `;

    const params: any[] = [];

    if (search && search !== '') {
      query += ` WHERE (c.title ILIKE $1 OR c.course_code ILIKE $1 OR cr.course_run_id ILIKE $1)`;
      params.push(`%${search}%`);
    }

    query += ` ORDER BY cr.start_date DESC LIMIT 100`;

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
      })),
    });
  } catch (error) {
    console.error('Error fetching course runs:', error);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
}
