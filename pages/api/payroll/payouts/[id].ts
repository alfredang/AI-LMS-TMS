import { NextApiRequest, NextApiResponse } from 'next';
import pool from '@lib/db';
import { requireRole } from '@lib/auth/requireRole';
import { requirePayrollEnabled } from '@lib/payroll/requireEnabled';
import { acquireBillNoLock, ensureBillNoColumn, nextBillNo, normalizeBillNo } from '@lib/payroll/billNo';
import { onPayoutConfirmed, onPayoutUnconfirmed } from '@lib/payroll/trainerBill';
import { ensurePayoutColumns } from '@lib/payroll/ensurePayoutColumns';
import { payoutAmount } from '@lib/payroll/calculate';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'PUT' && req.method !== 'PATCH') {
    return res.status(405).json({ success: false, message: 'Method not allowed' });
  }

  const authed = await requireRole(req, res, ['payroll', 'admin']);
  if (!authed) return;
  if (!(await requirePayrollEnabled(res))) return;

  const { id } = req.query;
  if (!id || typeof id !== 'string') {
    return res.status(400).json({ success: false, error: 'id required' });
  }

  await ensureBillNoColumn();

  try {
    const { num_learners, course_fee, tier_percent, actual_payout, status, payment_date, remark, bill_no, end_date } =
      req.body || {};
    const updated_by = authed.id;

    if (status && !['pending', 'completed', 'cancelled'].includes(status)) {
      return res.status(400).json({ success: false, error: 'invalid status' });
    }
    if (end_date !== undefined && end_date !== null && end_date !== '' && !/^\d{4}-\d{2}-\d{2}$/.test(String(end_date))) {
      return res.status(400).json({ success: false, error: 'end_date must be YYYY-MM-DD' });
    }
    if (end_date !== undefined) await ensurePayoutColumns();

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

    // Persist whichever of the three drivers changed. estimated_payout is
    // recomputed from them inside the transaction below, once the row is locked
    // — see there for why it is no longer derived in SQL.
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
    // Payroll-local correction to the class end date — drives which month the
    // payout falls in and the bill number/date. Blank clears the override so
    // the class's own end date takes over again; course_run is never touched.
    if (end_date !== undefined) {
      sets.push(`end_date_override = $${i++}`);
      params.push(end_date || null);
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
    // Declared outside the transaction: the QuickBooks bill hooks below run after
    // the COMMIT and need both the updated row and its pre-update status.
    let payout: any;
    let prevStatus: string | null = null;

    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      // Current row — needed for the class date the ref is derived from, to know
      // whether a number was already issued, and for the PRE-update status that
      // decides whether this call is the pending→completed transition that raises
      // a trainer bill (or the reverse, which voids it). Read under FOR UPDATE, so
      // it is a consistent snapshot against a concurrent edit of the same payout.
      const cur = await client.query(
        `SELECT tp.bill_no, tp.status, tp.num_learners, tp.course_fee, tp.tier_percent,
                cr.start_date::text AS start_date
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
      prevStatus = row.status;

      // Recompute the estimate from the EFFECTIVE drivers — the new value where
      // one was supplied, else the row's current one. Computed here rather than
      // in SQL so payoutAmount() stays the single definition of the formula for
      // both payout tables; the row is held under FOR UPDATE, so reading it and
      // writing the result below is still free of a lost-update race.
      if (newLearners !== undefined || newFee !== undefined || newTier !== undefined) {
        const effLearners = newLearners ?? Number(row.num_learners);
        const effFee = newFee ?? Number(row.course_fee);
        const effTier = newTier ?? Number(row.tier_percent);
        sets.push(`estimated_payout = $${i++}`);
        params.push(payoutAmount(effLearners, effFee, effTier));
      }

      if (billNoOverride !== undefined) {
        // Explicit edit always wins over auto-issue.
        sets.push(`bill_no = $${i++}`);
        params.push(billNoOverride);
      } else if (!row.bill_no) {
        // Every payout carries a Bill No (rows are numbered at creation; the
        // backfill migration covered history). This is the catch-up path for any
        // straggler — e.g. a row materialized before its run had a start date.
        // Never reissued once set, so unmark → re-mark keeps the original ref.
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
           payment_date::text AS payment_date, remark, bill_no, updated_at, updated_by,
           end_date_override::text AS end_date_override,
           -- Effective end date, resolved the same way the list does, so the
           -- edited row re-renders with the corrected date immediately.
           (SELECT COALESCE(trainer_payout.end_date_override, cr2.end_date)::text
              FROM course_run cr2 WHERE cr2.id = trainer_payout.course_run_id) AS end_date
      `;
      const r = await client.query(sql, params);
      await client.query('COMMIT');
      payout = r.rows[0];
    } catch (e) {
      await client.query('ROLLBACK').catch(() => {});
      throw e;
    } finally {
      client.release();
    }

    // Billing invoice follows the payout's confirmation state. Deliberately AFTER
    // the COMMIT: these call out to QuickBooks, and an external round-trip must
    // not be holding a DB transaction (or the bill-number advisory lock) open.
    // Both helpers swallow their own errors — a QuickBooks problem must never
    // fail the payout update the user just made.
    // `bill` is returned so the UI can tell the user an invoice was raised and
    // name it. Only the reserve step has finished by now — the QuickBooks post
    // runs in the background — so the status here is normally 'pending', and
    // the Billing Invoices tab is where it resolves.
    let bill: Awaited<ReturnType<typeof onPayoutConfirmed>> = null;
    if (prevStatus !== 'completed' && payout.status === 'completed') {
      bill = await onPayoutConfirmed({ source: 'wsq', payoutId: id, userId: authed.id });
    } else if (prevStatus === 'completed' && payout.status !== 'completed') {
      await onPayoutUnconfirmed({ source: 'wsq', payoutId: id });
    }

    return res.status(200).json({
      success: true,
      data: payout,
      bill: bill ? { id: bill.id, bill_no: bill.bill_no, status: bill.status } : null,
    });
  } catch (err: any) {
    console.error('payroll/payouts PUT failed', err);
    // A duplicate bill number is a user-fixable conflict, not a server fault.
    if (err?.code === '23505' && String(err?.constraint || '').includes('bill_no')) {
      return res.status(409).json({ success: false, error: 'That Bill No is already used by another payout.' });
    }
    return res.status(500).json({ success: false, error: err?.message || 'Internal error' });
  }
}
