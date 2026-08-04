import { withAuth } from '@lib/auth/withAuth';
import type { NextApiRequest, NextApiResponse } from 'next';
import pool from '../../../../lib/db';
import { ensureZoomColumns } from '../../../../lib/zoom/client';

async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    await ensureZoomColumns();
    await pool.query(`
      UPDATE training_provider
      SET zoom_oauth_refresh_token = NULL,
          zoom_oauth_access_token = NULL,
          zoom_oauth_token_expires_at = NULL,
          zoom_account_id = NULL,
          zoom_user_id = NULL,
          zoom_user_email = NULL,
          zoom_connected_at = NULL,
          zoom_enabled = false
      WHERE id = (SELECT id FROM training_provider ORDER BY created_at DESC NULLS LAST LIMIT 1)
    `);

    return res.status(200).json({ success: true });
  } catch (error) {
    return res.status(500).json({ success: false, error: error instanceof Error ? error.message : 'Internal server error' });
  }
}

export default withAuth(handler, { roles: ['admin', 'trainingProvider'] });
