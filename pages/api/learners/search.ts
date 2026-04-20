import { NextApiRequest, NextApiResponse } from 'next';
import pool from '../../../lib/db';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') {
    return res.status(405).json({ message: 'Method not allowed' });
  }

  try {
    const { query: searchQuery } = req.query;

    if (!searchQuery || typeof searchQuery !== 'string') {
      return res.status(400).json({ message: 'Search query is required' });
    }

    const term = `%${searchQuery}%`;

    // Search app_user by full_name, email, or contact number, restricted to Learner role
    // Phone: learner_profile.tel first, fall back to da_application.trainee_phone
    // Invoice: most recent completed invoice_no from invoice_jobs
    const result = await pool.query(
      `SELECT
         u.id,
         u.full_name AS name,
         u.email,
         COALESCE(
           NULLIF(TRIM(lp.tel), ''),
           (
             SELECT TRIM(da.trainee_phone)
             FROM da_application da
             WHERE LOWER(da.trainee_email) = LOWER(u.email)
               AND da.trainee_phone IS NOT NULL
               AND TRIM(da.trainee_phone) <> ''
             ORDER BY da.created_at DESC NULLS LAST
             LIMIT 1
           )
         ) AS contact_no,
         (
           SELECT ij.invoice_no
           FROM public.invoice_jobs ij
           WHERE ij.user_id = u.id
             AND ij.status = 'done'
             AND ij.invoice_no IS NOT NULL
             AND ij.invoice_no <> ''
           ORDER BY ij.updated_at DESC NULLS LAST
           LIMIT 1
         ) AS invoice_no
       FROM app_user u
       JOIN user_role_map r ON r.user_id = u.id AND r.role = 'Learner'
       LEFT JOIN learner_profile lp ON lp.user_id = u.id
       WHERE
         LOWER(u.full_name) LIKE LOWER($1)
         OR LOWER(u.email)  LIKE LOWER($1)
         OR TRIM(lp.tel)    LIKE $1
       ORDER BY u.full_name
       LIMIT 20`,
      [term]
    );

    res.status(200).json({
      success: true,
      data: result.rows,
    });
  } catch (error) {
    console.error('Error searching learners:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error',
    });
  }
}