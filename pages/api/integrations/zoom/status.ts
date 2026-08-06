import { withAuth } from '@lib/auth/withAuth';
import type { NextApiRequest, NextApiResponse } from 'next';
import pool from '../../../../lib/db';
import { ensureZoomColumns } from '../../../../lib/zoom/client';

async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    await ensureZoomColumns();
    const result = await pool.query(`
      SELECT
        zoom_oauth_client_id,
        zoom_oauth_client_secret,
        zoom_oauth_refresh_token,
        zoom_oauth_token_expires_at,
        zoom_user_email,
        zoom_user_id,
        zoom_connected_at,
        zoom_enabled
      FROM training_provider
      ORDER BY created_at DESC NULLS LAST
      LIMIT 1
    `);
    const row = result.rows[0] || {};

    return res.status(200).json({
      success: true,
      data: {
        configured: !!(row.zoom_oauth_client_id && row.zoom_oauth_client_secret),
        connected: !!row.zoom_oauth_refresh_token,
        enabled: !!row.zoom_enabled,
        userEmail: row.zoom_user_email || null,
        userId: row.zoom_user_id || null,
        connectedAt: row.zoom_connected_at || null,
        tokenExpiresAt: row.zoom_oauth_token_expires_at || null,
      },
    });
  } catch (error) {
    return res.status(500).json({ success: false, error: error instanceof Error ? error.message : 'Internal server error' });
  }
}

export default withAuth(handler, { roles: ['admin', 'trainingProvider'] });
