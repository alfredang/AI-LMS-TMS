import { withAuth } from '@lib/auth/withAuth';
import type { NextApiRequest, NextApiResponse } from 'next';
import pool from '../../../lib/db';

// GET /api/admin/past-classes
// Returns all course runs whose end_date is in the past (no trainer filter).
// Used by the admin Past Attendance view.
async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') {
    return res.status(405).json({ message: 'Method Not Allowed' });
  }

  try {
    const result = await pool.query(`
      SELECT
        c.id            AS course_id,
        c.title         AS course_title,
        c.course_code,
        cr.id           AS run_id,
        cr.course_run_id AS run_code,
        cr.start_date,
        cr.end_date,
        cr.class_status,
        cr.assigned_trainer_name
      FROM course_run cr
      JOIN course c ON cr.course_id = c.id
      WHERE cr.end_date IS NOT NULL AND cr.end_date < CURRENT_DATE
      ORDER BY cr.end_date DESC
    `);
    return res.status(200).json(result.rows);
  } catch (error: any) {
    console.error('Error fetching admin past classes:', error);
    return res.status(500).json({ message: 'Internal server error', error: error.message });
  }
}

export default withAuth(handler, { roles: ['admin', 'trainingProvider', 'developer', 'trainer'] });
