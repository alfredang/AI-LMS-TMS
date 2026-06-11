import type { NextApiRequest, NextApiResponse } from 'next';
import pool from '../../../lib/db';

/**
 * External API — Unassign Trainer from Course Run
 *
 * POST /api/external/unassign-trainer
 *
 * Headers:
 *   x-api-key: <EXTERNAL_API_KEY_FOR_CLAWDBOT>
 *
 * Body (JSON):
 *   { "course_run_id": "1303232" }
 */
export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ success: false, error: 'Method not allowed' });
  }

  const apiKey = req.headers['x-api-key'];
  const validKey = process.env.EXTERNAL_API_KEY_FOR_CLAWDBOT;
  if (!validKey) return res.status(500).json({ success: false, error: 'API key not configured on server' });
  if (!apiKey || apiKey !== validKey) return res.status(401).json({ success: false, error: 'Invalid or missing API key' });

  const { course_run_id } = req.body ?? {};
  if (!course_run_id) {
    return res.status(400).json({ success: false, error: 'Missing required field: course_run_id' });
  }

  try {
    const result = await pool.query(
      `UPDATE course_run
       SET assigned_trainer_id = NULL,
           assigned_trainer_name = NULL,
           assigned_trainer_email = NULL,
           updated_at = NOW()
       WHERE course_run_id = $1
       RETURNING id, course_run_id`,
      [String(course_run_id)]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ success: false, error: `Course run ${course_run_id} not found` });
    }

    // Also clear the junction table
    await pool.query(
      `DELETE FROM course_run_trainer WHERE course_run_id = $1`,
      [result.rows[0].id]
    );

    return res.status(200).json({
      success: true,
      message: `Trainer unassigned from course run ${course_run_id}`,
    });
  } catch (error) {
    console.error('unassign-trainer error:', error);
    return res.status(500).json({ success: false, error: 'Internal server error' });
  }
}
