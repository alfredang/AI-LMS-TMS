import type { NextApiRequest, NextApiResponse } from 'next';
import pool from '../../../lib/db';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') {
    return res.status(405).json({ success: false, error: 'Method not allowed' });
  }

  try {
    const result = await pool.query(`
      SELECT
        au.id,
        au.email,
        au.full_name,
        au.account_status,
        au.created_at,
        au.is_protected,
        ap.tel,
        (
          SELECT array_agg(urm.role::text ORDER BY urm.role::text)
          FROM public.user_role_map urm
          WHERE urm.user_id = au.id
        ) AS roles
      FROM public.app_user au
      JOIN public.user_role_map urm2 ON urm2.user_id = au.id AND urm2.role = 'Admin'
      LEFT JOIN public.admin_profile ap ON ap.user_id = au.id
      ORDER BY au.full_name ASC
    `);

    return res.status(200).json({
      success: true,
      data: {
        admins: result.rows.map(row => ({
          id: row.id,
          email: row.email,
          fullName: row.full_name,
          accountStatus: row.account_status,
          createdAt: row.created_at,
          isProtected: row.is_protected,
          tel: row.tel,
          roles: row.roles,
        })),
        totalCount: result.rows.length,
      },
    });
  } catch (error) {
    console.error('Error fetching admin accounts:', error);
    return res.status(500).json({ success: false, error: 'Internal server error' });
  }
}
