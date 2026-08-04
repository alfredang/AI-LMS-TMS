import { withAuth } from '@lib/auth/withAuth';
import type { NextApiRequest, NextApiResponse } from 'next';
import pool from '../../../lib/db';

async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  const limit = Math.min(parseInt(String(req.query.limit || '500'), 10), 1000);

  try {
    const result = await pool.query(
      `SELECT id, run_id, created_at, course_run_id, course_run_uuid, course_code,
              course_ref_number, trainer_name, trainer_email,
              nric_present, nric_masked, ssg_status, ssg_response,
              status, error_message
       FROM sync_trainer_tpg_log
       ORDER BY created_at DESC
       LIMIT $1`,
      [limit]
    );
    return res.status(200).json({ success: true, data: result.rows });
  } catch (error: any) {
    console.error('Error fetching sync trainer TPG logs:', error);
    return res.status(500).json({ success: false, error: error.message });
  }
}

export default withAuth(handler, { roles: ['admin', 'trainingProvider', 'developer'] });
