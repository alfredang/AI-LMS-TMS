import { NextApiRequest, NextApiResponse } from 'next';
import pool from '../../../lib/db';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') {
    return res.status(405).json({ success: false, message: 'Method not allowed' });
  }

  const limit  = Math.min(Number(req.query.limit)  || 500, 1000);
  const offset = Number(req.query.offset) || 0;

  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS assign_trainer_log (
        id             SERIAL PRIMARY KEY,
        created_at     TIMESTAMPTZ DEFAULT NOW(),
        course_run_id  TEXT,
        course_code    TEXT,
        course_title   TEXT,
        start_date     TEXT,
        end_date       TEXT,
        ra_code        TEXT,
        trainer_name   TEXT,
        trainer_email  TEXT,
        action         TEXT,
        status         TEXT NOT NULL DEFAULT 'success',
        error_message  TEXT
      )
    `);

    const result = await pool.query(
      `SELECT * FROM assign_trainer_log
       ORDER BY created_at DESC
       LIMIT $1 OFFSET $2`,
      [limit, offset],
    );

    const countResult = await pool.query(`SELECT COUNT(*) AS total FROM assign_trainer_log`);

    return res.status(200).json({
      success: true,
      data: result.rows,
      total: Number(countResult.rows[0]?.total ?? 0),
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    console.error('❌ assign-trainer-logs error:', err);
    return res.status(500).json({ success: false, message });
  }
}
