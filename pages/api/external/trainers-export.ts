import type { NextApiRequest, NextApiResponse } from 'next';
import pool from '../../../lib/db';

/**
 * External API — Trainers Export (for AI-MMS import)
 *
 * Returns every user who holds the 'Trainer' role, with their email, name,
 * account status, full role list, and key trainer-profile fields. AI-MMS pulls
 * this to create/sync operator accounts + roles in its tigerdragon admin so
 * trainers can be invited/confirmed for classes.
 *
 * GET /api/external/trainers-export
 * GET /api/external/trainers-export?status=Active   (filter by trainer_profile.status)
 *
 * Headers:
 *   x-api-key: <EXTERNAL_API_KEY_FOR_CLAWDBOT>
 *
 * Response: { success, count, data: [ { user_id, email, full_name,
 *   account_status, trainer_status, trainer_type, tel, nric, gender,
 *   linkedin_url, roles: string[] } ] }
 */
export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') {
    return res.status(405).json({ success: false, error: 'Method not allowed' });
  }

  const apiKey = req.headers['x-api-key'];
  const validKey = process.env.EXTERNAL_API_KEY_FOR_CLAWDBOT;
  if (!validKey) return res.status(500).json({ success: false, error: 'API key not configured on server' });
  if (!apiKey || apiKey !== validKey) return res.status(401).json({ success: false, error: 'Invalid or missing API key' });

  try {
    const { status } = req.query;
    const params: any[] = [];

    let query = `
      SELECT
        au.id            AS user_id,
        au.email,
        au.full_name,
        au.account_status,
        tp.status        AS trainer_status,
        tp.trainer_type,
        tp.tel,
        tp.nric,
        tp.gender,
        tp.linkedin_url,
        ARRAY(
          SELECT urm2.role::text
            FROM user_role_map urm2
           WHERE urm2.user_id = au.id
           ORDER BY urm2.role
        ) AS roles
      FROM app_user au
      LEFT JOIN trainer_profile tp ON tp.user_id = au.id
      WHERE EXISTS (
        SELECT 1 FROM user_role_map urm
         WHERE urm.user_id = au.id AND urm.role = 'Trainer'
      )
        AND au.email IS NOT NULL AND au.email <> ''
    `;

    if (status) {
      params.push(status);
      query += ` AND tp.status = $${params.length}`;
    }

    query += ` ORDER BY au.full_name`;

    const result = await pool.query(query, params);

    return res.status(200).json({
      success: true,
      count: result.rows.length,
      data: result.rows,
    });
  } catch (error) {
    console.error('trainers-export error:', error);
    return res.status(500).json({ success: false, error: 'Internal server error' });
  }
}
