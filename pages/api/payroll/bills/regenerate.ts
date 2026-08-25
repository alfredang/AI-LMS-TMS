import { NextApiRequest, NextApiResponse } from 'next';
import pool from '@lib/db';
import { requireRole } from '@lib/auth/requireRole';
import { requirePayrollEnabled } from '@lib/payroll/requireEnabled';
import { ensureTrainerBillTable } from '@lib/payroll/ensureTrainerBillTable';
import { BILL_COLS, onPayoutConfirmed } from '@lib/payroll/trainerBill';
import { deleteTrainerBill } from '@lib/quickbooks/createTrainerBill';

/**
 * POST /api/payroll/bills/regenerate
 *   { source: 'wsq' | 'manual', payoutId, rebuild?: boolean }
 *
 * Raise the billing invoice for a payout that is ALREADY confirmed.
 *
 * With `rebuild: true` an existing live bill is DELETED first (in QuickBooks as
 * well) and raised again from the payout's current figures. That is the answer
 * to "the payout amount changed after it was billed": QuickBooks bills are never
 * edited in place by this system, so the bill is replaced rather than amended.
 * The number is unaffected — it lives on the payout and is reused verbatim.
 *
 * The normal path only raises a bill on the pending→completed transition, so a
 * bill deleted from the Billing Invoices tab could otherwise only be recovered
 * by un-marking the payout and marking it paid again — two saves that also
 * rewrite its payment date. This is that recovery, done in one call.
 *
 * Safe to press twice: reserveBill returns the payout's existing live bill
 * rather than inserting a second one, and the number comes off the payout, so a
 * regenerated bill carries the same TX ref as the one it replaces.
 */
export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ success: false, message: 'Method not allowed' });
  }

  const authed = await requireRole(req, res, ['payroll', 'admin']);
  if (!authed) return;
  if (!(await requirePayrollEnabled(res))) return;

  const source = String(req.body?.source || 'wsq');
  const payoutId = String(req.body?.payoutId || '').trim();
  if (source !== 'wsq' && source !== 'manual') {
    return res.status(400).json({ success: false, error: 'source must be "wsq" or "manual"' });
  }
  if (!payoutId) {
    return res.status(400).json({ success: false, error: 'payoutId required' });
  }

  try {
    await ensureTrainerBillTable();

    // Only a confirmed payout has a bill. Raising one for a pending payout would
    // put a payable in QuickBooks for money that has not been agreed as paid,
    // and nothing in the LMS would then be tracking it back.
    const table = source === 'wsq' ? 'trainer_payout' : 'payroll_manual_class';
    const cur = await pool.query(`SELECT status FROM ${table} WHERE id = $1`, [payoutId]);
    if (cur.rowCount === 0) {
      return res.status(404).json({ success: false, error: 'payout not found' });
    }
    if (cur.rows[0].status !== 'completed') {
      return res.status(400).json({
        success: false,
        error: 'Only a payout marked as paid can have an invoice raised. Mark it as paid first.',
      });
    }

    // Was one already live? Decides the wording the UI shows, and tells us
    // whether this call actually raised anything.
    const idCol = source === 'wsq' ? 'payout_id' : 'manual_class_id';
    const before = await pool.query(
      `SELECT id FROM trainer_bill WHERE ${idCol} = $1 AND status <> 'voided' LIMIT 1`,
      [payoutId]
    );

    // Replace an existing bill when the caller asked for a rebuild. Delete in
    // QuickBooks FIRST: if that fails the payable is still live there, so the
    // row must stay and the caller must be told, rather than silently ending up
    // with two bills for one class (or none).
    const rebuild = req.body?.rebuild === true;
    if (rebuild && (before.rowCount ?? 0) > 0) {
      // Check the replacement is actually raisable BEFORE destroying the
      // original — onPayoutConfirmed declines a payout with no trainer or a
      // zero amount, and by then the old bill would already be gone.
      const raisable = await pool.query(
        source === 'wsq'
          ? `SELECT COALESCE(tp.actual_payout, tp.estimated_payout) AS amount,
                    COALESCE(NULLIF(crt.trainer_name,''), au.full_name) AS trainer_name
               FROM trainer_payout tp
               LEFT JOIN course_run_trainer crt
                      ON crt.course_run_id = tp.course_run_id AND crt.trainer_id = tp.trainer_id
               LEFT JOIN app_user au ON au.id = tp.trainer_id
              WHERE tp.id = $1`
          : `SELECT COALESCE(actual_payout, estimated_payout) AS amount, trainer_name
               FROM payroll_manual_class WHERE id = $1`,
        [payoutId]
      );
      const next = raisable.rows[0] || {};
      if (!String(next.trainer_name || '').trim() || !(Number(next.amount) > 0)) {
        return res.status(400).json({
          success: false,
          error:
            'The replacement invoice cannot be raised (the payout needs a trainer and an amount above zero), so the existing one was left alone.',
        });
      }

      const existing = await pool.query(
        `SELECT ${BILL_COLS} FROM trainer_bill WHERE ${idCol} = $1 AND status <> 'voided' LIMIT 1`,
        [payoutId]
      );
      const old = existing.rows[0];
      if (old?.qb_bill_id) {
        const del = await deleteTrainerBill(old.qb_bill_id);
        if (!del.ok) {
          await pool.query(`UPDATE trainer_bill SET status = 'failed', error = $2 WHERE id = $1`, [
            old.id,
            `Could not be replaced: ${del.message}`,
          ]);
          return res.status(409).json({
            success: false,
            error: `${old.bill_no} could not be removed from QuickBooks (${del.message}). It may already have a payment against it — sort that out in QuickBooks, then try again.`,
          });
        }
      }
      await pool.query(`DELETE FROM trainer_bill WHERE id = $1`, [old.id]);
    }

    const bill = await onPayoutConfirmed({ source, payoutId, userId: authed.id });
    if (!bill) {
      return res.status(422).json({
        success: false,
        error:
          'No invoice could be raised — check the payout has a trainer and an amount above zero.',
      });
    }

    return res.status(200).json({
      success: true,
      data: { id: bill.id, bill_no: bill.bill_no, status: bill.status, amount: bill.amount },
      // Only meaningful when NOT rebuilding: a rebuild always replaces.
      alreadyExisted: !rebuild && (before.rowCount ?? 0) > 0,
      rebuilt: rebuild,
    });
  } catch (err: any) {
    console.error('payroll/bills regenerate failed', err);
    return res.status(500).json({ success: false, error: err?.message || 'Internal error' });
  }
}
