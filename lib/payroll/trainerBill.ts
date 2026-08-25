/**
 * Trainer billing invoices — the bridge between a confirmed payout and the
 * QuickBooks supplier Bill it raises.
 *
 * Flow when Payroll flips a payout pending → completed:
 *   1. reserve  — write a `trainer_bill` row (status 'pending') carrying the
 *                 number the payout ALREADY has. DB only, fast, so confirming
 *                 stays snappy even when marking a whole trainer as paid.
 *   2. push     — post the Bill to QuickBooks in the background; the row moves
 *                 to 'posted' (with the QBO bill id) or 'failed' (with the
 *                 reason, retryable from the Billing Invoices tab).
 *
 * QuickBooks is the only home for the document. Confirming a payout used to also
 * render a PDF and file it in Drive; that was dropped — Payroll reads the bill in
 * QuickBooks itself, so a second copy was one more thing to keep in step with it.
 * The `drive_*` columns are kept for rows filed before the change, and those files
 * are still binned when their bill is withdrawn.
 *
 * Bill numbers are NOT allocated here. `lib/payroll/billNo.ts` is the single
 * allocator: it stamps every payout with a TX ref at creation, numbering both
 * payout tables off one per-day sequence. This module reuses that ref verbatim,
 * so the "Bill No" in the Payout List and the DocNumber on the QuickBooks bill
 * are the same string — which is the whole point of the TX format (it exists to
 * reconcile 1:1 with the legacy payroll spreadsheet). A second, independent
 * sequence here would quietly hand the same class two different references.
 *
 * The only numbers issued from this file are catch-ups: a payout that somehow
 * has no ref yet, or one whose ref turns out to be on somebody else's bill in
 * QuickBooks. Both go through billNo.ts and are written BACK to the payout row,
 * so the two never drift.
 *
 * Un-confirming (completed → pending/cancelled) deletes the QBO bill and marks
 * the row 'voided'. The number stays with the payout and is reused if the
 * payout is confirmed again — the ref identifies the class, not the attempt.
 */

import pool from '../db';
import type { PoolClient } from 'pg';
import { getLocalYMD } from '../dateHelpers';
import { ensureTrainerBillTable } from './ensureTrainerBillTable';
import { ensurePayoutColumns } from './ensurePayoutColumns';
import { acquireBillNoLock, billNoDayPrefix, nextBillNo } from './billNo';
import { trashDriveFile } from '../services/invoiceDriveUpload';
import {
  BillNumberTakenError,
  createTrainerBill,
  deleteTrainerBill,
  qboMaxBillSequenceForPrefix,
} from '../quickbooks/createTrainerBill';

export type BillSource = 'wsq' | 'manual';

export interface TrainerBillRow {
  id: string;
  source: BillSource;
  payout_id: string | null;
  manual_class_id: string | null;
  bill_no: string;
  bill_date: string;
  trainer_id: string | null;
  trainer_name: string;
  course_title: string;
  course_code: string | null;
  amount: string;
  vendor_ref: string | null;
  vendor_name: string | null;
  qb_bill_id: string | null;
  /** Generated PDF in Google Drive; null until it has been filed. */
  drive_file_id: string | null;
  drive_view_link: string | null;
  status: 'pending' | 'posted' | 'failed' | 'voided';
  error: string | null;
  created_at: string;
  updated_at: string;
}

export const BILL_COLS = `
  id, source, payout_id, manual_class_id, bill_no,
  bill_date::text AS bill_date,
  trainer_id, trainer_name, course_title, course_code, amount,
  vendor_ref, vendor_name, qb_bill_id,
  drive_file_id, drive_view_link,
  status, error,
  created_at, updated_at
`;

interface PayoutDetail {
  trainer_id: string | null;
  trainer_name: string | null;
  course_title: string | null;
  course_code: string | null;
  end_date: string | null;
  /** The ref already stamped on the payout — what the bill is raised under. */
  bill_no: string | null;
  /** Class start date: what billNo.ts derives the TX date part from. */
  start_date: string | null;
  amount: number;
}

async function loadPayoutDetail(source: BillSource, id: string): Promise<PayoutDetail | null> {
  const sql =
    source === 'wsq'
      ? `SELECT tp.trainer_id,
                COALESCE(NULLIF(crt.trainer_name,''), au.full_name) AS trainer_name,
                COALESCE(c.title, cr.course_run_id)                 AS course_title,
                c.course_code,
                -- Payroll's corrected end date wins — it is what the bill DATE
                -- is built from. The bill NUMBER comes from tp.bill_no.
                COALESCE(tp.end_date_override, cr.end_date)::text    AS end_date,
                tp.bill_no,
                cr.start_date::text                                 AS start_date,
                COALESCE(tp.actual_payout, tp.estimated_payout)     AS amount
           FROM trainer_payout tp
           JOIN course_run cr ON cr.id = tp.course_run_id
           LEFT JOIN course c ON c.id = cr.course_id
           LEFT JOIN course_run_trainer crt
                  ON crt.course_run_id = tp.course_run_id AND crt.trainer_id = tp.trainer_id
           LEFT JOIN app_user au ON au.id = tp.trainer_id
          WHERE tp.id = $1`
      : `SELECT trainer_id,
                trainer_name,
                class_title AS course_title,
                course_code,
                end_date::text AS end_date,
                bill_no,
                start_date::text AS start_date,
                COALESCE(actual_payout, estimated_payout) AS amount
           FROM payroll_manual_class
          WHERE id = $1`;

  const r = await pool.query(sql, [id]);
  if (r.rowCount === 0) return null;
  const row = r.rows[0];
  return {
    trainer_id: row.trainer_id ?? null,
    trainer_name: row.trainer_name ?? null,
    course_title: row.course_title ?? null,
    course_code: row.course_code ?? null,
    end_date: row.end_date ?? null,
    bill_no: (row.bill_no || '').trim() || null,
    start_date: row.start_date ?? null,
    amount: Number(row.amount) || 0,
  };
}

/**
 * Catch-up issuance for a payout that has no ref yet, delegated to the single
 * allocator in billNo.ts and written BACK to the payout row — so the Payout
 * List and the QuickBooks bill show the same number rather than diverging.
 *
 * `floor` is passed through for the QuickBooks-clash path (see
 * reallocateBillNo). Must be called inside the caller's transaction.
 */
async function issueBillNoForPayout(
  client: PoolClient,
  source: BillSource,
  payoutId: string,
  classDate: string | null,
  floor = 0
): Promise<string | null> {
  await acquireBillNoLock(client, classDate);
  const issued = await nextBillNo(client, classDate, floor);
  if (!issued) return null;
  // Table chosen from a fixed pair, never from caller input.
  const table = source === 'wsq' ? 'trainer_payout' : 'payroll_manual_class';
  await client.query(`UPDATE ${table} SET bill_no = $2 WHERE id = $1`, [payoutId, issued]);
  return issued;
}

/**
 * Insert the bill row for a payout, under the ref that payout already carries.
 *
 * No sequence logic lives here: billNo.ts numbered the payout at creation and
 * that number IS the bill number. The only allocation is the catch-up for a
 * payout that has none yet (e.g. one materialized before its run had a start
 * date), and that goes through billNo.ts too.
 *
 * Returns the existing row unchanged if this payout already has a live bill,
 * which makes confirming an already-confirmed payout a no-op.
 */
async function reserveBill(
  client: PoolClient,
  args: {
    source: BillSource;
    payoutId: string;
    billDate: string;
    detail: PayoutDetail;
    userId?: string | null;
  }
): Promise<TrainerBillRow> {
  const { source, payoutId, billDate, detail } = args;
  const idCol = source === 'wsq' ? 'payout_id' : 'manual_class_id';

  const existing = await client.query(
    `SELECT ${BILL_COLS} FROM trainer_bill WHERE ${idCol} = $1 AND status <> 'voided' LIMIT 1`,
    [payoutId]
  );
  if (existing.rowCount && existing.rowCount > 0) return existing.rows[0];

  // The payout's own ref, or a catch-up one derived from the same class start
  // date billNo.ts uses (falling back to the bill date only if the class has no
  // start date at all, so an undated non-WSQ class still gets billed).
  const billNo =
    detail.bill_no || (await issueBillNoForPayout(client, source, payoutId, detail.start_date || billDate));
  if (!billNo) {
    throw new Error(`Cannot raise a bill for payout ${payoutId}: no bill number could be determined.`);
  }

  const inserted = await client.query(
    `INSERT INTO trainer_bill
        (source, ${idCol}, bill_no, bill_date, trainer_id, trainer_name,
         course_title, course_code, amount, created_by)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
     RETURNING ${BILL_COLS}`,
    [
      source,
      payoutId,
      billNo,
      billDate,
      detail.trainer_id,
      detail.trainer_name,
      detail.course_title,
      detail.course_code,
      detail.amount,
      args.userId || null,
    ]
  );
  return inserted.rows[0];
}

/**
 * Renumber a reserved bill whose ref turned out to be on somebody else's
 * QuickBooks bill — Finance raises these by hand, and those numbers never
 * reached our tables.
 *
 * The replacement comes from billNo.ts, floored by what QuickBooks actually has
 * for that date, and is written back to BOTH the trainer_bill row and the
 * payout itself. Renumbering only the bill would leave the Payout List showing
 * a ref that no longer matches the document in QuickBooks.
 */
async function reallocateBillNo(bill: TrainerBillRow): Promise<TrainerBillRow> {
  const payoutId = bill.source === 'wsq' ? bill.payout_id : bill.manual_class_id;
  if (!payoutId) throw new Error(`Bill ${bill.id} has no payout to renumber against`);

  // Renumber on the same day the current ref sits on, so the class keeps its
  // date prefix and only the sequence moves.
  const detail = await loadPayoutDetail(bill.source, payoutId);
  const classDate = detail?.start_date || bill.bill_date;

  // Read QuickBooks OUTSIDE the transaction — an HTTP round trip must never
  // hold the bill-number advisory lock open.
  const prefix = billNoDayPrefix(classDate);
  const floor = prefix ? await qboMaxBillSequenceForPrefix(prefix) : 0;

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const next = await issueBillNoForPayout(client, bill.source, payoutId, classDate, floor);
    if (!next) throw new Error(`Could not allocate a replacement bill number for ${bill.bill_no}`);
    const updated = await client.query(
      `UPDATE trainer_bill SET bill_no = $2 WHERE id = $1 RETURNING ${BILL_COLS}`,
      [bill.id, next]
    );
    await client.query('COMMIT');
    return updated.rows[0];
  } catch (e) {
    await client.query('ROLLBACK').catch(() => {});
    throw e;
  } finally {
    client.release();
  }
}

// Bill ids currently mid-push, so a retry click (or a second confirm) can't
// post the same bill twice while the first request is still in flight.
const pushing = new Set<string>();

/**
 * All QuickBooks pushes run one at a time, in order.
 *
 * "Mark all as paid" on a trainer fires one confirmation per class, and each
 * one reserves a bill then pushes it. Run in parallel, several pushes would
 * look up the SAME trainer's supplier at once, all miss, and all create it —
 * leaving duplicate suppliers in QBO. Serialising also keeps us well clear of
 * Intuit's rate limits. (Per process; the bill-number sequence is protected at
 * the database level instead, so multiple app replicas stay safe there.)
 */
let pushQueue: Promise<unknown> = Promise.resolve();

export function enqueueBillPush(billId: string): Promise<TrainerBillRow | null> {
  const next = pushQueue.then(() => pushBillToQuickBooks(billId));
  pushQueue = next.catch(() => undefined);
  return next;
}

/**
 * Post a reserved bill to QuickBooks and record the outcome. Never throws —
 * a failure is written to the row's `error` for the Billing Invoices tab to
 * surface and retry.
 */
export async function pushBillToQuickBooks(billId: string): Promise<TrainerBillRow | null> {
  if (pushing.has(billId)) return null;
  pushing.add(billId);
  try {
    const r = await pool.query(`SELECT ${BILL_COLS} FROM trainer_bill WHERE id = $1`, [billId]);
    let bill: TrainerBillRow | undefined = r.rows[0];
    if (!bill) return null;
    if (bill.status === 'voided') return bill;
    // Already in QuickBooks — nothing to post. A retry on a posted bill is a
    // no-op rather than an error, so the Re-send button is safe to press twice.
    if (bill.status === 'posted') return bill;

    try {
      let posted: Awaited<ReturnType<typeof createTrainerBill>> | null = null;
      // Re-allocate and retry if the number turns out to be on somebody else's
      // bill — Finance can type one in by hand between our reserve and our
      // push. Bounded, so a persistent clash surfaces as a failure instead of
      // looping.
      for (let attempt = 0; attempt < 3 && !posted; attempt++) {
        try {
          posted = await createTrainerBill({
            billNo: bill.bill_no,
            billDate: bill.bill_date,
            trainerName: bill.trainer_name,
            description: bill.course_title,
            amount: Number(bill.amount),
          });
        } catch (e) {
          if (!(e instanceof BillNumberTakenError) || attempt === 2) throw e;
          const taken = bill.bill_no;
          bill = await reallocateBillNo(bill);
          console.warn(`[payroll] Bill number ${taken} was already taken in QuickBooks; reissued as ${bill.bill_no}`);
        }
      }
      if (!posted) throw new Error('Could not allocate a free bill number');
      const updated = await pool.query(
        `UPDATE trainer_bill
            SET status = 'posted', qb_bill_id = $2, vendor_ref = $3, vendor_name = $4, error = NULL
          WHERE id = $1
          RETURNING ${BILL_COLS}`,
        [billId, posted.qbBillId, posted.vendorRef, posted.vendorName]
      );
      console.log(`[payroll] Bill ${bill.bill_no} posted to QuickBooks (${posted.qbBillId})`);
      return updated.rows[0];
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      console.error(`[payroll] Bill ${bill.bill_no} failed to post:`, message);
      const updated = await pool.query(
        `UPDATE trainer_bill SET status = 'failed', error = $2 WHERE id = $1 RETURNING ${BILL_COLS}`,
        [billId, message.slice(0, 2000)]
      );
      return updated.rows[0];
    }
  } finally {
    pushing.delete(billId);
  }
}

/**
 * Entry point for "payout confirmed": reserve the bill number, then push to
 * QuickBooks in the background so the caller's response isn't held up by a
 * round trip to Intuit (marking a trainer's whole month as paid fires one of
 * these per class).
 *
 * Never throws — billing must not be able to fail the payout update itself.
 */
export async function onPayoutConfirmed(args: {
  source: BillSource;
  payoutId: string;
  userId?: string | null;
}): Promise<TrainerBillRow | null> {
  try {
    await ensureTrainerBillTable();
    if (args.source === 'wsq') await ensurePayoutColumns();
    const detail = await loadPayoutDetail(args.source, args.payoutId);
    if (!detail) return null;

    if (!detail.trainer_name?.trim()) {
      console.warn(`[payroll] No bill raised for payout ${args.payoutId}: the payout has no trainer name.`);
      return null;
    }
    if (!(detail.amount > 0)) {
      console.warn(`[payroll] No bill raised for payout ${args.payoutId}: payout amount is ${detail.amount}.`);
      return null;
    }

    // Bill DATE is still the (corrected) class end date — that is what Finance
    // books it under. Only the NUMBER comes from the payout's existing ref.
    // Undated non-WSQ classes fall back to today so they can still be billed.
    const billDate = detail.end_date || getLocalYMD(new Date());

    const client = await pool.connect();
    let bill: TrainerBillRow;
    try {
      await client.query('BEGIN');
      bill = await reserveBill(client, {
        source: args.source,
        payoutId: args.payoutId,
        billDate,
        detail,
        userId: args.userId,
      });
      await client.query('COMMIT');
    } catch (e) {
      await client.query('ROLLBACK').catch(() => {});
      throw e;
    } finally {
      client.release();
    }

    if (bill.status === 'pending' || bill.status === 'failed') {
      void enqueueBillPush(bill.id);
    }
    return bill;
  } catch (e) {
    console.error('[payroll] onPayoutConfirmed failed:', e instanceof Error ? e.message : e);
    return null;
  }
}

/**
 * Entry point for "payout un-confirmed" (back to pending, or cancelled).
 * Deletes the QBO bill if one was posted and retires the row. Never throws.
 *
 * Returns `{ cleared }`: false when a bill could NOT be withdrawn — the
 * QuickBooks delete failed, so a live payable is still out there. Callers that
 * are about to destroy the class (see the DELETE handlers) must check this and
 * stop, or the only reference to that payable goes with it. `blocked` names the
 * bills still standing, for the message shown to the user.
 */
export async function onPayoutUnconfirmed(
  args: { source: BillSource; payoutId: string }
): Promise<{ cleared: boolean; blocked: string[] }> {
  const blocked: string[] = [];
  try {
    await ensureTrainerBillTable();
    const idCol = args.source === 'wsq' ? 'payout_id' : 'manual_class_id';
    const r = await pool.query(
      `SELECT ${BILL_COLS} FROM trainer_bill WHERE ${idCol} = $1 AND status <> 'voided'`,
      [args.payoutId]
    );
    for (const bill of r.rows as TrainerBillRow[]) {
      let note: string | null = null;
      if (bill.qb_bill_id) {
        const result = await deleteTrainerBill(bill.qb_bill_id);
        if (!result.ok) {
          // Keep the row live so the mismatch stays visible instead of silently
          // leaving a bill in QBO for a payout that is no longer confirmed.
          await pool.query(`UPDATE trainer_bill SET status = 'failed', error = $2 WHERE id = $1`, [
            bill.id,
            `Payout was un-confirmed but the QuickBooks bill could not be removed: ${result.message}`,
          ]);
          blocked.push(bill.bill_no);
          continue;
        }
        note = result.message;
      }
      // Bin any PDF filed before bills stopped being rendered to Drive: leaving
      // one there would keep a document available for a payout that is no longer
      // confirmed. No-op for bills raised since. Best-effort — the row is
      // withdrawn either way and the link is cleared.
      await trashDriveFile(bill.drive_file_id);

      // A bill that never reached QuickBooks leaves NOTHING behind — no
      // document, no number in anyone else's ledger. Voiding it would just
      // accumulate rows in the Billing Invoices list for things that never
      // existed, so it is deleted outright. Only bills that actually posted
      // are kept as 'voided', because QuickBooks holds a deleted-bill record
      // that ours is the counterpart to.
      if (!bill.qb_bill_id) {
        await pool.query(`DELETE FROM trainer_bill WHERE id = $1`, [bill.id]);
        console.log(`[payroll] Bill ${bill.bill_no} discarded — it never reached QuickBooks.`);
        continue;
      }

      await pool.query(
        `UPDATE trainer_bill
            SET status = 'voided', error = $2, drive_file_id = NULL, drive_view_link = NULL
          WHERE id = $1`,
        [bill.id, note]
      );
      console.log(
        `[payroll] Bill ${bill.bill_no} voided — payout no longer confirmed. The ref stays on the payout.`
      );
    }
    return { cleared: blocked.length === 0, blocked };
  } catch (e) {
    console.error('[payroll] onPayoutUnconfirmed failed:', e instanceof Error ? e.message : e);
    // Unknown state — report NOT cleared so a caller about to delete the class
    // stops rather than destroying the reference on a guess.
    return { cleared: false, blocked };
  }
}
