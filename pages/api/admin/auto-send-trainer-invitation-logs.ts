import { withAuth } from '@lib/auth/withAuth';
import type { NextApiRequest, NextApiResponse } from 'next';
import pool from '../../../lib/db';

/**
 * GET /api/admin/auto-send-trainer-invitation-logs?limit=500
 *
 * Reads per-row logs produced by the auto-send-trainer-invitations sweep.
 * Used by the AutoSendTrainerInvitationLogView in the Logging section.
 */
async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  const limit = Math.min(parseInt(String(req.query.limit || '500'), 10), 1000);

  try {
    // Create the table on-demand so the UI never 500s on a fresh DB where
    // the sweep has never actually fired. Mirrors the pattern used by the
    // other log endpoints.
    await pool.query(`
      CREATE TABLE IF NOT EXISTS auto_send_trainer_invitation_log (
        id               SERIAL PRIMARY KEY,
        run_id           TEXT NOT NULL,
        created_at       TIMESTAMPTZ DEFAULT NOW(),
        course_run_uuid  UUID,
        course_run_id    TEXT,
        course_title     TEXT,
        trainer_name     TEXT,
        trainer_email    TEXT,
        status           TEXT NOT NULL,
        message          TEXT
      )
    `);
    await pool.query(
      `CREATE INDEX IF NOT EXISTS idx_auto_send_trainer_invitation_log_run_id
       ON auto_send_trainer_invitation_log(run_id, created_at DESC)`
    );

    const result = await pool.query(
      `SELECT id, run_id, created_at, course_run_uuid, course_run_id,
              course_title, trainer_name, trainer_email, status, message
       FROM auto_send_trainer_invitation_log
       ORDER BY created_at DESC
       LIMIT $1`,
      [limit]
    );
    return res.status(200).json({ success: true, data: result.rows });
  } catch (error: any) {
    console.error('Error fetching auto send trainer invitation logs:', error);
    return res.status(500).json({ success: false, error: error.message });
  }
}

export default withAuth(handler, { roles: ['admin', 'trainingProvider', 'developer'] });
