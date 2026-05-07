import type { NextApiRequest, NextApiResponse } from 'next';
import pool from '../../../lib/db';

/** Ensure the course_run_trainer junction table exists */
async function ensureJunctionTable() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS course_run_trainer (
      id            UUID DEFAULT gen_random_uuid() PRIMARY KEY,
      course_run_id UUID NOT NULL REFERENCES course_run(id) ON DELETE CASCADE,
      trainer_id    UUID,
      trainer_name  TEXT NOT NULL,
      trainer_email TEXT,
      assigned_at   TIMESTAMPTZ DEFAULT NOW()
    )
  `);
  await pool.query(`
    CREATE UNIQUE INDEX IF NOT EXISTS uq_crt_run_trainer
      ON course_run_trainer(course_run_id, COALESCE(trainer_id, '00000000-0000-0000-0000-000000000000'))
  `);
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') {
    return res.status(405).json({ success: false, error: 'Method not allowed' });
  }

  try {
    const { search, upcoming, ongoing, status } = req.query;

    // Ensure the junction table exists before querying it
    await ensureJunctionTable();

    let query = `
      SELECT
        cr.id,
        cr.course_run_id,
        c.title AS course_title,
        c.course_code,
        cr.start_date,
        cr.end_date,
        cr.class_status,
        cr.assigned_trainer_id,
        cr.assigned_trainer_name,
        cr.assigned_trainer_email,
        COALESCE(ec.enrollment_count, 0) AS enrollment_count,
        COALESCE(trs.trainer_names, cr.assigned_trainer_name) AS all_trainer_names,
        COALESCE(trs.trainer_emails, cr.assigned_trainer_email) AS all_trainer_emails
      FROM course_run cr
      JOIN course c ON cr.course_id = c.id
      LEFT JOIN (
        SELECT course_run_id, COUNT(*) AS enrollment_count
        FROM enrollment
        WHERE LOWER(COALESCE(enrolment_status, '')) NOT IN ('admin removed', 'cancelled', 'withdrawn')
        GROUP BY course_run_id
      ) ec ON ec.course_run_id = cr.id
      LEFT JOIN (
        SELECT course_run_id,
               STRING_AGG(trainer_name, ', ' ORDER BY assigned_at) AS trainer_names,
               STRING_AGG(trainer_email, ', ' ORDER BY assigned_at) AS trainer_emails
        FROM course_run_trainer
        GROUP BY course_run_id
      ) trs ON trs.course_run_id = cr.id
    `;

    const conditions: string[] = [];
    const params: any[] = [];

    if (status === 'upcoming') {
      conditions.push(`cr.start_date > CURRENT_DATE`);
    } else if (status === 'ongoing') {
      conditions.push(`cr.start_date <= CURRENT_DATE AND (cr.end_date IS NULL OR cr.end_date >= CURRENT_DATE)`);
    } else if (status === 'completed') {
      conditions.push(`cr.end_date < CURRENT_DATE`);
    } else if (upcoming === 'true') {
      conditions.push(`cr.start_date >= CURRENT_DATE`);
    } else if (ongoing === 'true') {
      conditions.push(`(cr.end_date IS NULL OR cr.end_date >= CURRENT_DATE)`);
    }

    if (search && search !== '') {
      params.push(`%${search}%`);
      conditions.push(`(c.title ILIKE $${params.length} OR c.course_code ILIKE $${params.length} OR cr.course_run_id ILIKE $${params.length} OR (EXISTS (SELECT 1 FROM course_run_trainer crt WHERE crt.course_run_id = cr.id AND crt.trainer_name ILIKE $${params.length})) OR cr.assigned_trainer_name ILIKE $${params.length})`);
    }

    if (conditions.length > 0) {
      query += ` WHERE ` + conditions.join(' AND ');
    }

    // Ongoing/completed: latest first. Upcoming: soonest first.
    const sortOrder = (status === 'ongoing' || status === 'completed') ? 'DESC' : 'ASC';
    query += ` ORDER BY cr.start_date ${sortOrder} LIMIT 200`;

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
        classStatus: row.class_status,
        assignedTrainerId: row.assigned_trainer_id,
        assignedTrainerName: row.all_trainer_names,
        primaryAssignedTrainerName: row.all_trainer_names,
        assignedTrainerEmail: row.all_trainer_emails,
        enrollmentCount: parseInt(row.enrollment_count, 10),
      })),
    });
  } catch (error) {
    console.error('Error fetching course runs:', error);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
}
