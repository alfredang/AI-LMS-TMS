import { NextApiRequest, NextApiResponse } from 'next';
import pool from '@lib/db';
import { payoutAmount } from '@lib/payroll/calculate';
import { requireRole } from '@lib/auth/requireRole';

const numOrNull = (v: any) => (v === null || v === undefined || v === '' ? null : Number(v));

const SELECT_COLS = `
  id, class_title, course_code, trainer_id, trainer_name,
  start_date::text  AS start_date,
  end_date::text    AS end_date,
  num_learners, course_fee, tier_percent, estimated_payout, actual_payout,
  status,
  payment_date::text AS payment_date,
  remark, created_at, updated_at
`;

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const authed = await requireRole(req, res, ['payroll', 'admin']);
  if (!authed) return;

  const { id } = req.query;
  if (!id || typeof id !== 'string') {
    return res.status(400).json({ success: false, error: 'id required' });
  }

  if (req.method === 'DELETE') {
    try {
      const r = await pool.query(`DELETE FROM payroll_manual_class WHERE id = $1 RETURNING id`, [id]);
      if (r.rowCount === 0) {
        return res.status(404).json({ success: false, error: 'class not found' });
      }
      return res.status(200).json({ success: true, data: { id } });
    } catch (err: any) {
      console.error('payroll/manual-classes DELETE failed', err);
      return res.status(500).json({ success: false, error: err?.message || 'Internal error' });
    }
  }

  if (req.method !== 'PUT' && req.method !== 'PATCH') {
    res.setHeader('Allow', 'PUT, PATCH, DELETE');
    return res.status(405).json({ success: false, message: 'Method not allowed' });
  }

  const {
    class_title,
    course_code,
    trainer_id,
    trainer_name,
    start_date,
    end_date,
    num_learners,
    course_fee,
    tier_percent,
    actual_payout,
    status,
    payment_date,
    remark,
  } = req.body || {};

  if (class_title !== undefined && !String(class_title).trim()) {
    return res.status(400).json({ success: false, error: 'class_title cannot be empty' });
  }
  if (trainer_name !== undefined && !String(trainer_name).trim()) {
    return res.status(400).json({ success: false, error: 'trainer_name cannot be empty' });
  }
  if (status !== undefined && !['pending', 'completed', 'cancelled'].includes(status)) {
    return res.status(400).json({ success: false, error: 'invalid status' });
  }

  const newLearners = num_learners === undefined ? undefined : Number(numOrNull(num_learners) ?? 0);
  const newFee = course_fee === undefined ? undefined : Number(numOrNull(course_fee) ?? 0);
  const newPercent = tier_percent === undefined ? undefined : numOrNull(tier_percent);

  for (const [label, v] of [['num_learners', newLearners], ['course_fee', newFee]] as const) {
    if (v !== undefined && (Number.isNaN(v) || (v as number) < 0)) {
      return res.status(400).json({ success: false, error: `invalid ${label}` });
    }
  }
  if (newPercent !== undefined && newPercent !== null && (Number.isNaN(newPercent) || newPercent < 0 || newPercent > 100)) {
    return res.status(400).json({ success: false, error: 'tier_percent must be 0-100' });
  }
  const newActual = actual_payout === undefined ? undefined : numOrNull(actual_payout);
  if (newActual !== undefined && newActual !== null && (Number.isNaN(newActual) || newActual < 0)) {
    return res.status(400).json({ success: false, error: 'actual_payout must be 0 or more' });
  }
  // Validate ordering when both dates are supplied (the dialog always sends both).
  if (start_date && end_date && String(end_date) < String(start_date)) {
    return res.status(400).json({ success: false, error: 'end_date must be on or after start_date' });
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    // Lock the row so the recompute reads a consistent (learners, fee, percent)
    // even under a concurrent edit — no lost-update on estimated_payout.
    const cur = await client.query(
      `SELECT num_learners, course_fee, tier_percent FROM payroll_manual_class WHERE id = $1 FOR UPDATE`,
      [id]
    );
    if (cur.rowCount === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ success: false, error: 'class not found' });
    }

    const sets: string[] = [];
    const params: any[] = [];
    let i = 1;
    const set = (col: string, val: any) => {
      sets.push(`${col} = $${i++}`);
      params.push(val);
    };

    if (class_title !== undefined) set('class_title', String(class_title).trim());
    if (course_code !== undefined) set('course_code', course_code ? String(course_code).trim() : null);
    if (trainer_id !== undefined) set('trainer_id', trainer_id || null);
    if (trainer_name !== undefined) set('trainer_name', String(trainer_name).trim());
    if (start_date !== undefined) set('start_date', start_date || null);
    if (end_date !== undefined) set('end_date', end_date || null);
    if (newLearners !== undefined) set('num_learners', newLearners);
    if (newFee !== undefined) set('course_fee', newFee);
    if (newPercent !== undefined) set('tier_percent', newPercent);
    if (actual_payout !== undefined) set('actual_payout', newActual);
    if (status !== undefined) set('status', status);
    if (payment_date !== undefined) set('payment_date', payment_date || null);
    if (remark !== undefined) set('remark', remark ? String(remark) : null);

    // Recompute estimated_payout when any driver changed, using the effective
    // value (new where provided, else the current row). tier_percent is NOT
    // auto-derived here — like the WSQ payouts, it's an explicit field the
    // Payroll user edits (the dialog offers a "use suggested %" helper).
    if (newLearners !== undefined || newFee !== undefined || newPercent !== undefined) {
      const effLearners = newLearners ?? Number(cur.rows[0].num_learners);
      const effFee = newFee ?? Number(cur.rows[0].course_fee);
      const effPercent = newPercent ?? Number(cur.rows[0].tier_percent);
      set('estimated_payout', payoutAmount(effLearners, effFee, effPercent));
    }

    set('updated_by', authed.id);

    if (sets.length === 0) {
      await client.query('ROLLBACK');
      return res.status(400).json({ success: false, error: 'no fields to update' });
    }

    params.push(id);
    const r = await client.query(
      `UPDATE payroll_manual_class SET ${sets.join(', ')} WHERE id = $${i} RETURNING ${SELECT_COLS}`,
      params
    );
    await client.query('COMMIT');
    return res.status(200).json({ success: true, data: r.rows[0] });
  } catch (err: any) {
    await client.query('ROLLBACK').catch(() => {});
    console.error('payroll/manual-classes PUT failed', err);
    return res.status(500).json({ success: false, error: err?.message || 'Internal error' });
  } finally {
    client.release();
  }
}
