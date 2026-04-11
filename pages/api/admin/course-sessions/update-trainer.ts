import type { NextApiRequest, NextApiResponse } from 'next';
import pool from '../../../../lib/db';

/**
 * POST /api/admin/course-sessions/update-trainer
 *
 * Body:
 *   {
 *     sessionId: string;            // course_session.id (uuid)
 *     trainerId?: string | null;    // NULL/omit to clear override + inherit
 *     trainerName?: string | null;
 *     trainerEmail?: string | null;
 *   }
 *
 * Behaviour:
 *   - If trainerId is null/empty, clears the per-session override so the
 *     session inherits the run-level default trainer again.
 *   - Otherwise writes trainer_id/name/email to the course_session row.
 *
 * The override is stored inline on course_session; no junction table.
 */
export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ success: false, error: 'Method not allowed' });
  }

  const { sessionId, trainerId, trainerName, trainerEmail } = req.body || {};

  if (typeof sessionId !== 'string' || !sessionId) {
    return res.status(400).json({ success: false, error: 'sessionId is required' });
  }

  const clearing = !trainerId;

  try {
    if (clearing) {
      // Clear the override — session falls back to inheriting run-level default
      const result = await pool.query(
        `UPDATE course_session
         SET trainer_id = NULL, trainer_name = NULL, trainer_email = NULL, updated_at = NOW()
         WHERE id = $1
         RETURNING id`,
        [sessionId]
      );
      if (result.rows.length === 0) {
        return res.status(404).json({ success: false, error: 'Session not found' });
      }
      console.log(`🗑️ Cleared per-session trainer override for session ${sessionId}`);
      return res.status(200).json({ success: true, cleared: true });
    }

    // Set the override. Name/email are denormalised cache fields written in
    // lock-step with trainer_id. If the caller didn't send them, leave them
    // as whatever they currently are — we only require trainer_id to be valid.
    const result = await pool.query(
      `UPDATE course_session
       SET trainer_id = $1,
           trainer_name = COALESCE($2, trainer_name),
           trainer_email = COALESCE($3, trainer_email),
           updated_at = NOW()
       WHERE id = $4
       RETURNING id`,
      [trainerId, trainerName || null, trainerEmail || null, sessionId]
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ success: false, error: 'Session not found' });
    }
    console.log(`👨‍🏫 Set per-session trainer override for session ${sessionId} → ${trainerName || trainerId}`);
    return res.status(200).json({ success: true, cleared: false });
  } catch (err) {
    console.error('❌ update-trainer error:', err);
    return res.status(500).json({
      success: false,
      error: err instanceof Error ? err.message : 'Internal server error',
    });
  }
}
