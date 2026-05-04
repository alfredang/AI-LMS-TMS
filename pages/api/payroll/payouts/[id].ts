import { NextApiRequest, NextApiResponse } from 'next';
import pool from '@lib/db';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'PUT' && req.method !== 'PATCH') {
    return res.status(405).json({ success: false, message: 'Method not allowed' });
  }

  const { id } = req.query;
  if (!id || typeof id !== 'string') {
    return res.status(400).json({ success: false, error: 'id required' });
  }

  try {
    const { actual_payout, status, payment_date, remark, updated_by } = req.body || {};

    if (status && !['pending', 'completed', 'cancelled'].includes(status)) {
      return res.status(400).json({ success: false, error: 'invalid status' });
    }

    const sets: string[] = [];
    const params: any[] = [];
    let i = 1;

    if (actual_payout !== undefined) {
      sets.push(`actual_payout = $${i++}`);
      params.push(actual_payout === null || actual_payout === '' ? null : Number(actual_payout));
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

    const sql = `UPDATE trainer_payout SET ${sets.join(', ')} WHERE id = $${i} RETURNING *`;
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
