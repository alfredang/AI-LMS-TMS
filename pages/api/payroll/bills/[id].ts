import { NextApiRequest, NextApiResponse } from 'next';
import pool from '@lib/db';
import { requireRole } from '@lib/auth/requireRole';
import { ensureTrainerBillTable } from '@lib/payroll/ensureTrainerBillTable';
import { BILL_COLS, enqueueBillPush } from '@lib/payroll/trainerBill';
import { deleteTrainerBill } from '@lib/quickbooks/createTrainerBill';
import { trashDriveFile } from '@lib/services/invoiceDriveUpload';

/**
 * POST /api/payroll/bills/[id]  { action: 'retry' }
 *
 * Re-push a bill that failed to reach QuickBooks (or was reserved while QBO was
 * unreachable). The bill number is already allocated, so a retry reuses it —
 * createTrainerBill also looks the number up in QBO first, so a bill that
 * actually did land last time is adopted rather than duplicated.
 *
 * Doubles as "generate the PDF again": a bill that is already posted skips the
 * QuickBooks call and just re-files its Drive PDF if that is missing or the
 * file has been deleted. That is what the Payroll "Generate PDF" button hits.
 *
 * This waits for the push (unlike the auto-push on confirm) because the user is
 * sitting in front of the button and wants the outcome.
 */
export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST' && req.method !== 'DELETE') {
    res.setHeader('Allow', 'POST, DELETE');
    return res.status(405).json({ success: false, message: 'Method not allowed' });
  }

  const authed = await requireRole(req, res, ['payroll', 'admin']);
  if (!authed) return;

  const { id } = req.query;
  if (!id || typeof id !== 'string') {
    return res.status(400).json({ success: false, error: 'id required' });
  }

  /**
   * DELETE /api/payroll/bills/[id]
   *
   * Remove the billing invoice: delete the Bill in QuickBooks, bin its Drive
   * PDF, drop the row. The CLASS and its payout are deliberately untouched —
   * the payout stays marked as paid, it simply no longer has a bill.
   *
   * Nothing re-raises it automatically (bills are only raised on a
   * pending→completed transition), so to get a fresh one, un-confirm the payout
   * and confirm it again.
   */
  if (req.method === 'DELETE') {
    try {
      await ensureTrainerBillTable();
      const r = await pool.query(`SELECT ${BILL_COLS} FROM trainer_bill WHERE id = $1`, [id]);
      const bill = r.rows[0];
      if (!bill) return res.status(404).json({ success: false, error: 'bill not found' });

      // Remove it from QuickBooks first. If that fails the payable is still
      // live, so keep the row — dropping it would leave the bill in QBO with
      // nothing in the LMS pointing at it.
      if (bill.qb_bill_id) {
        const result = await deleteTrainerBill(bill.qb_bill_id);
        if (!result.ok) {
          await pool.query(`UPDATE trainer_bill SET status = 'failed', error = $2 WHERE id = $1`, [
            id,
            `Could not be removed from QuickBooks: ${result.message}`,
          ]);
          return res.status(409).json({
            success: false,
            error: `${bill.bill_no} could not be deleted in QuickBooks (${result.message}). Delete it there first, then try again.`,
          });
        }
      }

      await trashDriveFile(bill.drive_file_id);
      await pool.query(`DELETE FROM trainer_bill WHERE id = $1`, [id]);
      console.log(`[payroll] Bill ${bill.bill_no} deleted by request — payout left as-is.`);
      return res.status(200).json({ success: true, data: { id, bill_no: bill.bill_no } });
    } catch (err: any) {
      console.error('payroll/bills DELETE failed', err);
      return res.status(500).json({ success: false, error: err?.message || 'Internal error' });
    }
  }

  const action = String(req.body?.action || 'retry');
  if (action !== 'retry') {
    return res.status(400).json({ success: false, error: `unknown action "${action}"` });
  }

  try {
    await ensureTrainerBillTable();
    const existing = await pool.query(`SELECT status FROM trainer_bill WHERE id = $1`, [id]);
    if (existing.rowCount === 0) {
      return res.status(404).json({ success: false, error: 'bill not found' });
    }
    if (existing.rows[0].status === 'voided') {
      return res.status(400).json({ success: false, error: 'this bill was voided and cannot be re-sent' });
    }

    const updated = await enqueueBillPush(id);
    if (!updated) {
      // Another request is mid-push; return the row as it stands rather than
      // posting the same bill twice.
      const current = await pool.query(`SELECT ${BILL_COLS} FROM trainer_bill WHERE id = $1`, [id]);
      return res.status(200).json({ success: true, data: current.rows[0] });
    }

    if (updated.status === 'failed') {
      return res.status(502).json({ success: false, error: updated.error || 'QuickBooks rejected the bill', data: updated });
    }
    return res.status(200).json({ success: true, data: updated });
  } catch (err: any) {
    console.error('payroll/bills retry failed', err);
    return res.status(500).json({ success: false, error: err?.message || 'Internal error' });
  }
}
