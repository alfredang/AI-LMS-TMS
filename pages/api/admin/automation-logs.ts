import { NextApiRequest, NextApiResponse } from 'next';
import pool from '../../../lib/db';

/**
 * GET /api/admin/automation-logs
 *
 * Returns auto_create_learner_log rows, newest first.
 * Query params:
 *   limit  – max rows to return (default 100)
 *   offset – for pagination (default 0)
 *   runId  – filter by a specific run batch
 */
export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') {
    return res.status(405).json({ success: false, message: 'Method not allowed' });
  }

  const limit = Math.min(Number(req.query.limit) || 100, 500);
  const offset = Number(req.query.offset) || 0;
  const runId = req.query.runId as string | undefined;

  try {
    // Ensure table exists (first-run safety)
    await pool.query(`
      CREATE TABLE IF NOT EXISTS auto_create_learner_log (
        id             SERIAL PRIMARY KEY,
        run_id         TEXT NOT NULL,
        created_at     TIMESTAMPTZ DEFAULT NOW(),
        course_run_id  TEXT,
        course_title   TEXT,
        course_code    TEXT,
        status         TEXT NOT NULL DEFAULT 'pending',
        total_enrolled INT  DEFAULT 0,
        created_count  INT  DEFAULT 0,
        existing_count INT  DEFAULT 0,
        error_count    INT  DEFAULT 0,
        details        JSONB,
        error_message  TEXT
      )
    `);
    await pool.query(`ALTER TABLE auto_create_learner_log ADD COLUMN IF NOT EXISTS course_code TEXT`);
    await pool.query(`ALTER TABLE auto_create_learner_log ADD COLUMN IF NOT EXISTS start_date DATE`);
    await pool.query(`ALTER TABLE auto_create_learner_log ADD COLUMN IF NOT EXISTS end_date DATE`);

    const params: any[] = [limit, offset];
    let where = '';
    if (runId) {
      params.push(runId);
      where = `WHERE run_id = $${params.length}`;
    }

    const result = await pool.query(
      `SELECT id, run_id, created_at, course_run_id, course_title, course_code,
              start_date, end_date,
              status, total_enrolled, created_count, existing_count,
              error_count, details, error_message
       FROM auto_create_learner_log
       ${where}
       ORDER BY created_at DESC
       LIMIT $1 OFFSET $2`,
      params,
    );

    const countResult = await pool.query(
      `SELECT COUNT(*) AS total FROM auto_create_learner_log ${where}`,
      runId ? [runId] : [],
    );

    return res.status(200).json({
      success: true,
      data: result.rows,
      total: Number(countResult.rows[0]?.total ?? 0),
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    console.error('❌ automation-logs error:', err);
    return res.status(500).json({ success: false, message });
  }
}
