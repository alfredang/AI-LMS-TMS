import { NextApiRequest, NextApiResponse } from 'next';
import pool from '@lib/db';
import { getAuthedUser } from '@lib/auth/requireRole';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') {
    return res.status(405).json({ success: false, message: 'Method not allowed' });
  }

  const { id } = req.query;
  if (!id || typeof id !== 'string') {
    return res.status(400).json({ success: false, error: 'trainer id required' });
  }

  const authed = await getAuthedUser(req);
  if (!authed) {
    return res.status(401).json({ success: false, error: 'Not authenticated' });
  }
  const isSelf = authed.id === id;
  const isPrivileged = authed.roles.has('admin') || authed.roles.has('payroll');
  if (!isSelf && !isPrivileged) {
    return res.status(403).json({ success: false, error: 'Forbidden' });
  }

  try {
    // Both payout tables. This used to read trainer_payout alone, so a trainer's
    // own payout history silently omitted every non-WSQ class they were paid for
    // — and the total on the card was short by that amount. The Payroll list has
    // merged the two since it was built; this endpoint never caught up.
    const r = await pool.query(
      `SELECT * FROM (
         SELECT
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
           cr.end_date::text   AS end_date,
           tp.updated_at,
           'wsq'::text AS source
         FROM trainer_payout tp
         JOIN course_run cr ON cr.id = tp.course_run_id
         LEFT JOIN course c ON c.id = cr.course_id
         WHERE tp.trainer_id = $1
           AND tp.status = 'completed'
         UNION ALL
         SELECT
           mc.id,
           -- Non-WSQ classes have no course run; the row's own id stands in so
           -- the key stays unique across the merged list.
           mc.id            AS course_run_id,
           NULL             AS course_run_code,
           mc.class_title   AS course_title,
           mc.course_code,
           mc.num_learners,
           mc.actual_payout,
           mc.payment_date::text AS payment_date,
           mc.remark,
           mc.start_date::text AS start_date,
           mc.end_date::text   AS end_date,
           mc.updated_at,
           'manual'::text AS source
         FROM payroll_manual_class mc
         WHERE mc.trainer_id = $1
           AND mc.status = 'completed'
       ) rows
       ORDER BY payment_date DESC NULLS LAST, updated_at DESC`,
      [id]
    );
    return res.status(200).json({ success: true, data: r.rows });
  } catch (err: any) {
    console.error('trainer payout-history failed', err);
    return res.status(500).json({ success: false, error: err?.message || 'Internal error' });
  }
}
