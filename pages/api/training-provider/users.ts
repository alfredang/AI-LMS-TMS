import { NextApiRequest, NextApiResponse } from 'next';
import pool from '../../../lib/db';
import { cors } from '../../../lib/cors';

async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (cors(req, res)) return;

  if (req.method !== 'GET') {
    return res.status(405).json({ success: false, error: 'Method not allowed' });
  }

  try {
    const query = `
      SELECT
        u.id,
        u.email,
        u.secondary_email,
        u.full_name,
        u.account_status,
        COALESCE(
          json_agg(urm.role ORDER BY
            CASE urm.role
              WHEN 'Admin' THEN 1
              WHEN 'Training Provider' THEN 2
              WHEN 'Developer' THEN 3
              WHEN 'Trainer' THEN 4
              WHEN 'Learner' THEN 5
              ELSE 6
            END
          ) FILTER (WHERE urm.role IS NOT NULL),
          '[]'::json
        ) AS roles
      FROM public.app_user u
      LEFT JOIN public.user_role_map urm ON u.id = urm.user_id
      GROUP BY u.id, u.email, u.secondary_email, u.full_name, u.account_status
      ORDER BY u.full_name ASC
    `;

    const result = await pool.query(query);

    return res.status(200).json({
      success: true,
      data: result.rows,
    });
  } catch (error) {
    console.error('Error fetching users:', error);
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    return res.status(500).json({
      success: false,
      error: `Failed to fetch users: ${errorMessage}`,
    });
  }
}

export default handler;
