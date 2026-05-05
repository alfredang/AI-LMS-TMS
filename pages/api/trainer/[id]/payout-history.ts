import { NextApiRequest, NextApiResponse } from 'next';
import pool from '@lib/db';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') {
    return res.status(405).json({ success: false, message: 'Method not allowed' });
  }

  const { id } = req.query;
  if (!id || typeof id !== 'string') {
    return res.status(400).json({ success: false, error: 'trainer id required' });
  }

  try {
    const r = await pool.query(
      `SELECT
         tp.id,
         tp.course_run_id,
         cr.course_run_id AS course_run_code,
         c.title          AS course_title,
         c.course_code    AS course_code,
         tp.num_learners,
         tp.actual_payout,
         tp.payment_date::text AS payment_date,
         tp.remark,
         cr.start_date::text AS start_date,
         cr.end_date::text   AS end_date
       FROM trainer_payout tp
       JOIN course_run cr ON cr.id = tp.course_run_id
       LEFT JOIN course c ON c.id = cr.course_id
       WHERE tp.trainer_id = $1
         AND tp.status = 'completed'
       ORDER BY tp.payment_date DESC NULLS LAST, tp.updated_at DESC`,
      [id]
    );
    return res.status(200).json({ success: true, data: r.rows });
  } catch (err: any) {
    console.error('trainer payout-history failed', err);
    return res.status(500).json({ success: false, error: err?.message || 'Internal error' });
  }
}
