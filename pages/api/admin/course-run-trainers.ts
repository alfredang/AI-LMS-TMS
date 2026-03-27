import { NextApiRequest, NextApiResponse } from 'next';
import pool from '../../../lib/db';

/**
 * GET /api/admin/course-run-trainers?courseRunUuid=<uuid>
 *   Returns all trainers assigned to a course run from the junction table.
 *
 * The table is auto-created on first access.
 */

async function ensureTable() {
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
  // Unique: one trainer per course run (uses coalesce for nullable trainer_id)
  await pool.query(`
    CREATE UNIQUE INDEX IF NOT EXISTS uq_crt_run_trainer
      ON course_run_trainer(course_run_id, COALESCE(trainer_id, '00000000-0000-0000-0000-000000000000'))
  `);
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') {
    return res.status(405).json({ success: false, error: 'Method not allowed' });
  }

  const { courseRunUuid } = req.query;
  if (!courseRunUuid || typeof courseRunUuid !== 'string') {
    return res.status(400).json({ success: false, error: 'courseRunUuid query param is required' });
  }

  try {
    await ensureTable();

    const result = await pool.query(
      `SELECT id, course_run_id, trainer_id, trainer_name, trainer_email, assigned_at
       FROM course_run_trainer
       WHERE course_run_id = $1
       ORDER BY assigned_at ASC`,
      [courseRunUuid]
    );

    // If junction table is empty for this run, backfill from legacy columns
    if (result.rows.length === 0) {
      const legacy = await pool.query(
        `SELECT assigned_trainer_id, assigned_trainer_name, assigned_trainer_email
         FROM course_run WHERE id = $1`,
        [courseRunUuid]
      );
      if (legacy.rows.length > 0 && legacy.rows[0].assigned_trainer_name) {
        const lt = legacy.rows[0];
        await pool.query(
          `INSERT INTO course_run_trainer (course_run_id, trainer_id, trainer_name, trainer_email)
           VALUES ($1, $2, $3, $4)
           ON CONFLICT (course_run_id, COALESCE(trainer_id, '00000000-0000-0000-0000-000000000000'))
           DO NOTHING`,
          [courseRunUuid, lt.assigned_trainer_id || null, lt.assigned_trainer_name, lt.assigned_trainer_email || null]
        );
        // Re-query to return the backfilled data
        const backfilled = await pool.query(
          `SELECT id, course_run_id, trainer_id, trainer_name, trainer_email, assigned_at
           FROM course_run_trainer
           WHERE course_run_id = $1
           ORDER BY assigned_at ASC`,
          [courseRunUuid]
        );
        return res.status(200).json({ success: true, data: backfilled.rows });
      }
    }

    return res.status(200).json({
      success: true,
      data: result.rows,
    });
  } catch (error) {
    console.error('❌ Error fetching course run trainers:', error);
    return res.status(500).json({
      success: false,
      error: 'Internal server error: ' + (error instanceof Error ? error.message : 'Unknown'),
    });
  }
}
