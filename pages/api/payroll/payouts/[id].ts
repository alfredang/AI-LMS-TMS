import { NextApiRequest, NextApiResponse } from 'next';
import pool from '@lib/db';
import { requireRole } from '@lib/auth/requireRole';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'PUT' && req.method !== 'PATCH') {
    return res.status(405).json({ success: false, message: 'Method not allowed' });
  }

  const authed = await requireRole(req, res, ['payroll', 'admin']);
  if (!authed) return;

  const { id } = req.query;
  if (!id || typeof id !== 'string') {
    return res.status(400).json({ success: false, error: 'id required' });
  }

  try {
    const { num_learners, course_fee, tier_percent, actual_payout, status, payment_date, remark } = req.body || {};
    const updated_by = authed.id;

    if (status && !['pending', 'completed', 'cancelled'].includes(status)) {
      return res.status(400).json({ success: false, error: 'invalid status' });
    }

    const numOrNull = (v: any) => (v === null || v === undefined || v === '' ? null : Number(v));

    const newLearners = num_learners === undefined ? undefined : numOrNull(num_learners);
    const newFee = course_fee === undefined ? undefined : numOrNull(course_fee);
    const newTier = tier_percent === undefined ? undefined : numOrNull(tier_percent);

    for (const [label, v] of [['num_learners', newLearners], ['course_fee', newFee], ['tier_percent', newTier]] as const) {
      if (v !== undefined && (v === null || Number.isNaN(v) || v < 0)) {
        return res.status(400).json({ success: false, error: `invalid ${label}` });
      }
    }
    if (newTier !== undefined && newTier !== null && newTier > 100) {
      return res.status(400).json({ success: false, error: 'tier_percent must be 0-100' });
    }

    const sets: string[] = [];
    const params: any[] = [];
    let i = 1;

    // If any of the three drivers changed, persist them and recompute estimated_payout
    // atomically in the same UPDATE. The estimate is derived from the *effective*
    // values — the new value where provided, else the row's current column — so there
    // is no separate read-modify-write (no lost-update race on concurrent edits).
    if (newLearners !== undefined || newFee !== undefined || newTier !== undefined) {
      if (newLearners !== undefined) {
        sets.push(`num_learners = $${i++}`);
        params.push(newLearners);
      }
      if (newFee !== undefined) {
        sets.push(`course_fee = $${i++}`);
        params.push(newFee);
      }
      if (newTier !== undefined) {
        sets.push(`tier_percent = $${i++}`);
        params.push(newTier);
      }
      // Placeholders for the estimate (null when a driver wasn't provided → COALESCE
      // falls back to the existing column). Postgres evaluates the RHS against the
      // pre-update row, so these effective values are correct.
      const lp = i++; params.push(newLearners ?? null);
      const fp = i++; params.push(newFee ?? null);
      const tp = i++; params.push(newTier ?? null);
      sets.push(
        `estimated_payout = CASE
            WHEN COALESCE($${lp}, num_learners) <= 0
              OR COALESCE($${fp}, course_fee) <= 0
              OR COALESCE($${tp}, tier_percent) <= 0 THEN 0
            ELSE round(
              COALESCE($${fp}, course_fee)
              * COALESCE($${lp}, num_learners)
              * COALESCE($${tp}, tier_percent)
            ) / 100
          END`
      );
    }

    if (actual_payout !== undefined) {
      const a = actual_payout === null || actual_payout === '' ? null : Number(actual_payout);
      if (a !== null && (Number.isNaN(a) || a < 0)) {
        return res.status(400).json({ success: false, error: 'actual_payout must be 0 or more' });
      }
      sets.push(`actual_payout = $${i++}`);
      params.push(a);
    }
    if (status !== undefined) {
      sets.push(`status = $${i++}`);
      params.push(status);
    }
    if (payment_date !== undefined) {
      sets.push(`payment_date = $${i++}`);
      params.push(payment_date || null);
    }
    if (remark !== undefined) {
      sets.push(`remark = $${i++}`);
      params.push(remark || null);
    }
    if (updated_by) {
      sets.push(`updated_by = $${i++}`);
      params.push(updated_by);
    }

    if (sets.length === 0) {
      return res.status(400).json({ success: false, error: 'no fields to update' });
    }

    sets.push(`updated_at = now()`);
    params.push(id);

    const sql = `
      UPDATE trainer_payout SET ${sets.join(', ')}
       WHERE id = $${i}
       RETURNING
         id, course_run_id, trainer_id, num_learners, course_fee,
         tier_percent, estimated_payout, actual_payout, status,
         payment_date::text AS payment_date, remark, updated_at, updated_by
    `;
    const r = await pool.query(sql, params);
    if (r.rowCount === 0) {
      return res.status(404).json({ success: false, error: 'payout not found' });
    }
    return res.status(200).json({ success: true, data: r.rows[0] });
  } catch (err: any) {
    console.error('payroll/payouts PUT failed', err);
    return res.status(500).json({ success: false, error: err?.message || 'Internal error' });
  }
}
