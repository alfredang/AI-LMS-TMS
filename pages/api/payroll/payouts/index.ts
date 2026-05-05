import { NextApiRequest, NextApiResponse } from 'next';
import pool from '@lib/db';
import { estimatedPayout, DEFAULT_PAYOUT_TIERS, PayoutTier } from '@lib/payroll/calculate';

async function loadTiers(): Promise<PayoutTier[]> {
  try {
    const r = await pool.query(`SELECT payroll_tiers FROM training_provider ORDER BY id LIMIT 1`);
    const v = r.rows[0]?.payroll_tiers;
    if (Array.isArray(v) && v.length > 0) return v as PayoutTier[];
  } catch (e) {
    console.warn('payroll: failed to load tiers, using defaults', e);
  }
  return DEFAULT_PAYOUT_TIERS;
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') {
    return res.status(405).json({ success: false, message: 'Method not allowed' });
  }

  try {
    const months = Math.max(1, Math.min(24, parseInt((req.query.months as string) || '2')));
    const tiers = await loadTiers();

    // Find every (course_run, trainer) pair for runs whose end_date is within the last N months
    // and not cancelled. Trainer rows come from course_run_trainer junction (canonical).
    const candidatesQuery = `
      SELECT
        cr.id              AS course_run_id,
        cr.course_run_id   AS course_run_code,
        c.title            AS course_title,
        c.course_code      AS course_code,
        c.course_fee       AS course_fee,
        cr.end_date::text  AS end_date,
        crt.trainer_id     AS trainer_id,
        crt.trainer_name   AS trainer_name,
        (SELECT COUNT(*) FROM enrollment e
            WHERE e.course_run_id = cr.id
              AND COALESCE(e.enrolment_status,'') NOT IN ('Withdrawn','Cancelled','Admin Removed')
        )::int             AS num_learners
      FROM course_run cr
      LEFT JOIN course c ON c.id = cr.course_id
      INNER JOIN course_run_trainer crt ON crt.course_run_id = cr.id
      WHERE cr.end_date IS NOT NULL
        AND cr.end_date <= CURRENT_DATE
        AND cr.end_date >= (CURRENT_DATE - ($1 || ' months')::interval)
        AND (cr.class_status IS NULL OR cr.class_status::text <> 'Cancelled')
        AND crt.trainer_id IS NOT NULL
    `;
    const candidates = await pool.query(candidatesQuery, [String(months)]);

    // Materialize on read: insert any (course_run, trainer) pair that doesn't yet have a payout row
    for (const row of candidates.rows) {
      const numLearners = Number(row.num_learners) || 0;
      const courseFee = Number(row.course_fee) || 0;
      const { tier, amount } = estimatedPayout(numLearners, courseFee, tiers);
      const tierPercent = tier?.percent ?? 0;
      await pool.query(
        `INSERT INTO trainer_payout
            (course_run_id, trainer_id, num_learners, course_fee, tier_percent, estimated_payout)
         VALUES ($1, $2, $3, $4, $5, $6)
         ON CONFLICT (course_run_id, trainer_id) DO NOTHING`,
        [row.course_run_id, row.trainer_id, numLearners, courseFee, tierPercent, amount]
      );
    }

    // Return all payout rows (joined) for runs in the window
    const listQuery = `
      SELECT
        tp.id,
        tp.course_run_id,
        cr.course_run_id      AS course_run_code,
        c.title               AS course_title,
        c.course_code         AS course_code,
        cr.end_date::text     AS end_date,
        tp.trainer_id,
        COALESCE(crt.trainer_name, au.full_name, '') AS trainer_name,
        tp.num_learners,
        tp.course_fee,
        tp.tier_percent,
        tp.estimated_payout,
        tp.actual_payout,
        tp.status,
        tp.payment_date::text AS payment_date,
        tp.remark,
        tp.updated_at
      FROM trainer_payout tp
      JOIN course_run cr ON cr.id = tp.course_run_id
      LEFT JOIN course c ON c.id = cr.course_id
      LEFT JOIN course_run_trainer crt
             ON crt.course_run_id = tp.course_run_id AND crt.trainer_id = tp.trainer_id
      LEFT JOIN app_user au ON au.id = tp.trainer_id
      WHERE cr.end_date >= (CURRENT_DATE - ($1 || ' months')::interval)
        AND cr.end_date <= CURRENT_DATE
      ORDER BY cr.end_date DESC, c.course_code ASC
    `;
    const list = await pool.query(listQuery, [String(months)]);

    return res.status(200).json({ success: true, data: { payouts: list.rows, tiers } });
  } catch (err: any) {
    console.error('payroll/payouts GET failed', err);
    return res.status(500).json({ success: false, error: err?.message || 'Internal error' });
  }
}
