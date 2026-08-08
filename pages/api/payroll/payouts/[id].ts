import { NextApiRequest, NextApiResponse } from 'next';
import pool from '@lib/db';
import { requireRole } from '@lib/auth/requireRole';
import { acquireBillNoLock, ensureBillNoColumn, nextBillNo, normalizeBillNo } from '@lib/payroll/billNo';

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

  await ensureBillNoColumn();

  try {
    const { num_learners, course_fee, tier_percent, actual_payout, status, payment_date, remark, bill_no } =
      req.body || {};
    const updated_by = authed.id;

    if (status && !['pending', 'completed', 'cancelled'].includes(status)) {
      return res.status(400).json({ success: false, error: 'invalid status' });
    }

    // Explicit bill_no from the edit dialog (may be '' → clear it).
    let billNoOverride: string | null | undefined;
    if (bill_no !== undefined) {
      const n = normalizeBillNo(bill_no);
      if (!n.ok) return res.status(400).json({ success: false, error: n.error });
      billNoOverride = n.value;
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

    if (sets.length === 0 && billNoOverride === undefined) {
      return res.status(400).json({ success: false, error: 'no fields to update' });
    }

    // Bill-number issuance runs inside a transaction: the allocator reads the
    // day's current max suffix and this UPDATE writes max+1, so the pair must be
    // serialized against a concurrent "mark as paid" on another class the same day.
    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      // Current row — needed for the class date the ref is derived from and to
      // know whether a number was already issued.
      const cur = await client.query(
        `SELECT tp.bill_no, tp.status, cr.start_date::text AS start_date
           FROM trainer_payout tp
           JOIN course_run cr ON cr.id = tp.course_run_id
          WHERE tp.id = $1
          FOR UPDATE OF tp`,
        [id]
      );
      if (cur.rowCount === 0) {
        await client.query('ROLLBACK');
        return res.status(404).json({ success: false, error: 'payout not found' });
      }
      const row = cur.rows[0];

      if (billNoOverride !== undefined) {
        // Explicit edit always wins over auto-issue.
        sets.push(`bill_no = $${i++}`);
        params.push(billNoOverride);
      } else if (status === 'completed' && !row.bill_no) {
        // Auto-issue on mark-as-paid, only if this row doesn't already have one
        // (so unmark → re-mark keeps the original number rather than burning a new one).
        await acquireBillNoLock(client, row.start_date);
        const issued = await nextBillNo(client, row.start_date);
        if (issued) {
          sets.push(`bill_no = $${i++}`);
          params.push(issued);
        }
      }

      sets.push(`updated_at = now()`);
      params.push(id);

      const sql = `
        UPDATE trainer_payout SET ${sets.join(', ')}
         WHERE id = $${i}
         RETURNING
           id, course_run_id, trainer_id, num_learners, course_fee,
           tier_percent, estimated_payout, actual_payout, status,
           payment_date::text AS payment_date, remark, bill_no, updated_at, updated_by
      `;
      const r = await client.query(sql, params);
      await client.query('COMMIT');
      return res.status(200).json({ success: true, data: r.rows[0] });
    } catch (e) {
      await client.query('ROLLBACK').catch(() => {});
      throw e;
    } finally {
      client.release();
    }
  } catch (err: any) {
    console.error('payroll/payouts PUT failed', err);
    // A duplicate bill number is a user-fixable conflict, not a server fault.
    if (err?.code === '23505' && String(err?.constraint || '').includes('bill_no')) {
      return res.status(409).json({ success: false, error: 'That Bill No is already used by another payout.' });
    }
    return res.status(500).json({ success: false, error: err?.message || 'Internal error' });
  }
}
