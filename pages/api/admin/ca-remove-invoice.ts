import { withAuth } from '@lib/auth/withAuth';
import type { NextApiRequest, NextApiResponse } from 'next';
import pool from '../../../lib/db';
import { ensureCompanyApplicationsTable } from '../../../lib/companyApplicationsTable';
import { qboReadInvoice, qboDeleteInvoice } from '../../../lib/services/qboInvoiceService';
import { caInvoiceBelongsTo } from '../../../lib/quickbooks/invoiceOwnership';

/**
 * POST /api/admin/ca-remove-invoice
 *
 * Body: { applicationIds: string[] }
 *
 * Detach the main tax invoice from Company Application rows so a correct one can
 * be raised, WITHOUT cancelling anything. The SSG enrolment, the grant, the
 * calendar entry and the row itself are all left exactly as they are. The
 * existing `ca-delete` path cancels the enrolment and deletes the learner, which
 * is far too much when the only thing at fault is the invoice.
 *
 * The Direct Application twin (da-remove-invoice) wrote these rules; this is the
 * same idea with one structural difference that changes everything about it.
 *
 * A COMPANY INVOICE IS SHARED. One document covers every learner from that
 * employer on that course run, so "remove this learner's invoice" is not a
 * question about a learner — it is a question about a document that other
 * people are also pointing at. Deleting one because a single learner was
 * selected would strand the rest with a dead reference. So the selection is
 * grouped by invoice, and the document is only ever deleted when every learner
 * on it was selected. Anything less unlinks the chosen rows and leaves the
 * document alone. Same instinct as ca-delete, which voids a consolidated
 * invoice only when no surviving learner shares it.
 *
 * The rules, in order, per invoice:
 *   1. No invoice attached             -> nothing to do
 *   2. Not in QuickBooks any more      -> clear the dead link
 *   3. Belongs to a different group    -> UNLINK ONLY, never delete
 *   4. Ours but paid or part-paid      -> UNLINK ONLY, never delete
 *   5. Ours, unpaid, partial selection -> UNLINK ONLY, others still need it
 *   6. Ours, unpaid, whole invoice     -> delete from QuickBooks, then unlink
 *
 * Rule 3 exists because of the ownership bug fixed in 0581f9d2: invoice recovery
 * matched on the last six characters of the enrolment reference, which SSG
 * reuses across periods, so rows can point at a real invoice raised for somebody
 * else — often already paid. Deleting one of those to tidy a wrong link would
 * destroy a real financial record, so this route never does it.
 *
 * `invoice_sent_at` is cleared alongside the rest. It is the flag that stops an
 * invoice being emailed twice, and leaving it set would silently prevent the
 * replacement from ever reaching the employer.
 *
 * The per-learner grant invoice is deliberately untouched. It bills WSG rather
 * than the employer and is a separate document; it only cites the main invoice
 * number as a reference, and a stale reference is worth far less than the risk
 * of deleting a grant claim nobody asked us to withdraw.
 */

/**
 * Rows per call. Each invoice costs one or two QuickBooks calls and they run in
 * sequence, so an uncapped selection would hold the request open for minutes and
 * hammer one QuickBooks realm. Fixing wrong invoices is a handful-at-a-time job.
 */
const MAX_ROWS_PER_CALL = 50;

/** How long to wait for the group's invoice lock before reporting "busy". */
const LOCK_WAIT_MS = 3_000;

/**
 * Wall-clock budget for the whole request.
 *
 * The row cap bounds how MANY invoices are touched, not how long that takes:
 * fifty learners can be fifty separate documents, each costing up to a
 * three-second lock wait plus two QuickBooks calls. A request that runs for
 * minutes holds a connection the rest of the app is queueing behind — that is
 * how an unrelated page starts returning 500s while an admin waits.
 *
 * Whatever is not reached this time is reached on the next click; every outcome
 * here is already idempotent.
 */
const TIME_BUDGET_MS = 40_000;

type Outcome =
  | 'none'
  | 'gone'
  | 'unlinked_foreign'
  | 'unlinked_paid'
  | 'unlinked_shared'
  | 'deleted'
  | 'busy';

interface InvoiceResult {
  invoiceId: string;
  docNumber: string | null;
  employer: string | null;
  learnerNames: string[];
  success: boolean;
  outcome: Outcome;
  message: string;
  /** True when a QuickBooks document was left in place on purpose. */
  invoiceKept: boolean;
  /** How many learner rows were detached. */
  rowsUnlinked: number;
}

/**
 * Clear the main-invoice columns. The row, its enrolment, its grant and its
 * grant invoice are untouched — this is a detach, not a cancellation.
 */
async function unlinkRows(rowIds: string[]): Promise<number> {
  if (rowIds.length === 0) return 0;
  const res = await pool.query(
    `UPDATE public.company_application
        SET invoice_id                  = NULL,
            invoice_doc_number          = NULL,
            invoice_drive_file_id       = NULL,
            invoice_drive_web_view_link = NULL,
            invoice_sent_at             = NULL,
            invoice_sent_to             = NULL,
            replace_group_invoice       = false,
            updated_at                  = now()
      WHERE id = ANY($1::uuid[])`,
    [rowIds]
  );
  return res.rowCount ?? 0;
}

/**
 * Run `fn` holding the same advisory lock the invoice generator takes for this
 * (employer, course run), so a removal cannot interleave with a generation for
 * the same group. Without it, unlinking mid-generation would leave a real
 * invoice stranded in QuickBooks with nothing in the LMS pointing at it.
 *
 * Returns null when the lock could not be taken, which the caller reports as
 * "busy" rather than as a failure.
 */
async function withGroupInvoiceLock<T>(
  employerUen: string,
  courseRunId: string,
  fn: () => Promise<T>
): Promise<T | null> {
  const lockKey = `ca-inv:${String(employerUen || '').trim()}|${String(courseRunId || '').trim()}`;
  const client = await pool.connect();
  let held = false;
  try {
    const deadline = Date.now() + LOCK_WAIT_MS;
    while (Date.now() < deadline) {
      const res = await client.query(`SELECT pg_try_advisory_lock(hashtext($1)) AS locked`, [lockKey]);
      if (res.rows[0]?.locked) { held = true; break; }
      await new Promise(r => setTimeout(r, 250));
    }
    if (!held) return null;
    return await fn();
  } finally {
    if (held) {
      await client.query(`SELECT pg_advisory_unlock(hashtext($1))`, [lockKey]).catch(() => { /* connection release drops it */ });
    }
    client.release();
  }
}

async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ success: false, error: 'Method not allowed' });
  }

  const { applicationIds } = req.body || {};
  if (!Array.isArray(applicationIds) || applicationIds.length === 0) {
    return res.status(400).json({ success: false, error: 'applicationIds array is required' });
  }
  if (applicationIds.length > MAX_ROWS_PER_CALL) {
    return res.status(400).json({
      success: false,
      error: `Select no more than ${MAX_ROWS_PER_CALL} learners at a time.`,
    });
  }

  try {
    await ensureCompanyApplicationsTable();

    const selected = await pool.query(
      `SELECT id, trainee_full_name, employer_org_name, employer_uen, course_run_id,
              enrolment_id, invoice_id, invoice_doc_number, invoice_drive_web_view_link
         FROM public.company_application
        WHERE id = ANY($1::uuid[])`,
      [applicationIds]
    );

    const withInvoice = selected.rows.filter((r: any) => String(r.invoice_id || '').trim());
    if (withInvoice.length === 0) {
      return res.status(200).json({
        success: true,
        results: [],
        summary: { deleted: 0, unlinked: 0, kept: 0, failed: 0 },
        message: 'None of the selected learners has an invoice attached.',
      });
    }

    // One document at a time — the invoice is the unit of work, not the learner.
    const byInvoice = new Map<string, any[]>();
    for (const row of withInvoice) {
      const id = String(row.invoice_id).trim();
      if (!byInvoice.has(id)) byInvoice.set(id, []);
      byInvoice.get(id)!.push(row);
    }

    const results: InvoiceResult[] = [];
    const deadline = Date.now() + TIME_BUDGET_MS;
    let stoppedEarly = false;

    for (const [invoiceId, rows] of byInvoice) {
      if (Date.now() > deadline) { stoppedEarly = true; break; }
      const head = rows[0];
      const base = {
        invoiceId,
        docNumber: head.invoice_doc_number ? String(head.invoice_doc_number) : null,
        employer: head.employer_org_name ? String(head.employer_org_name) : null,
        learnerNames: rows.map((r: any) => String(r.trainee_full_name || 'Unnamed')),
      };
      const rowIds = rows.map((r: any) => String(r.id));

      // Who else is on this document but was not selected. Their presence is
      // what decides whether the document may be deleted at all.
      const othersRes = await pool.query(
        `SELECT COUNT(*)::int AS n
           FROM public.company_application
          WHERE invoice_id = $1
            AND NOT (id = ANY($2::uuid[]))`,
        [invoiceId, rowIds]
      );
      const othersOnInvoice = Number(othersRes.rows[0]?.n) || 0;

      const outcome = await withGroupInvoiceLock(head.employer_uen, head.course_run_id, async (): Promise<InvoiceResult> => {
        let invoice: Awaited<ReturnType<typeof qboReadInvoice>> | null = null;
        try {
          invoice = await qboReadInvoice(undefined, invoiceId);
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          const missing = msg.includes('610') || msg.toLowerCase().includes('not found');
          if (!missing) {
            return {
              ...base,
              success: false,
              outcome: 'none',
              message: `Could not read invoice ${base.docNumber || invoiceId} from QuickBooks: ${msg}`,
              invoiceKept: true,
              rowsUnlinked: 0,
            };
          }
          const n = await unlinkRows(rowIds);
          return {
            ...base,
            success: true,
            outcome: 'gone',
            message: 'Invoice no longer exists in QuickBooks. The dead link was cleared.',
            invoiceKept: false,
            rowsUnlinked: n,
          };
        }

        const raw = invoice?.raw as Record<string, unknown> | undefined;
        const docNumber = String(raw?.DocNumber ?? base.docNumber ?? '') || null;

        const ours = caInvoiceBelongsTo(raw, {
          courseRunId: head.course_run_id,
          learnerNames: rows.map((r: any) => String(r.trainee_full_name || '')),
        });

        if (!ours) {
          const n = await unlinkRows(rowIds);
          const billedTo =
            String((raw?.CustomerRef as { name?: unknown } | undefined)?.name ?? '').trim() ||
            String((raw?.BillEmail as { Address?: unknown } | undefined)?.Address ?? '').trim();
          return {
            ...base,
            docNumber,
            success: true,
            outcome: 'unlinked_foreign',
            message:
              `Invoice ${docNumber || invoiceId} belongs to a different group` +
              (billedTo ? ` (${billedTo})` : '') +
              '. It was left untouched in QuickBooks and only unlinked here.',
            invoiceKept: true,
            rowsUnlinked: n,
          };
        }

        const linked = raw?.LinkedTxn;
        const linkedTxns = Array.isArray(linked) ? linked : linked ? [linked] : [];
        const hasPayment = linkedTxns.some(
          (t) => String((t as { TxnType?: unknown } | null)?.TxnType ?? '') === 'Payment'
        );
        const total = Number(raw?.TotalAmt) || 0;
        const balance = Number(raw?.Balance) || 0;
        const settled = hasPayment || (total > 0 && balance < total);

        if (settled) {
          const n = await unlinkRows(rowIds);
          return {
            ...base,
            docNumber,
            success: true,
            outcome: 'unlinked_paid',
            message:
              `Invoice ${docNumber || invoiceId} has a payment against it, so it was kept in QuickBooks ` +
              'and only unlinked here. Void or credit it there if it really must go.',
            invoiceKept: true,
            rowsUnlinked: n,
          };
        }

        if (othersOnInvoice > 0) {
          const n = await unlinkRows(rowIds);
          return {
            ...base,
            docNumber,
            success: true,
            outcome: 'unlinked_shared',
            message:
              `Invoice ${docNumber || invoiceId} still covers ${othersOnInvoice} other learner${othersOnInvoice === 1 ? '' : 's'}, ` +
              'so it was kept in QuickBooks and only unlinked from the learners you selected. ' +
              'Select everyone on it if the document itself should go.',
            invoiceKept: true,
            rowsUnlinked: n,
          };
        }

        if (!invoice?.syncToken) {
          return {
            ...base,
            docNumber,
            success: false,
            outcome: 'none',
            message: `QuickBooks did not return a sync token for invoice ${docNumber || invoiceId}; nothing was changed.`,
            invoiceKept: true,
            rowsUnlinked: 0,
          };
        }

        try {
          await qboDeleteInvoice(undefined, invoiceId, invoice.syncToken);
        } catch (err) {
          return {
            ...base,
            docNumber,
            success: false,
            outcome: 'none',
            message: `Could not delete invoice ${docNumber || invoiceId}: ${err instanceof Error ? err.message : String(err)}`,
            invoiceKept: true,
            rowsUnlinked: 0,
          };
        }

        const n = await unlinkRows(rowIds);
        return {
          ...base,
          docNumber,
          success: true,
          outcome: 'deleted',
          message: `Invoice ${docNumber || invoiceId} was deleted in QuickBooks and unlinked here. Generate Invoice will raise a fresh one.`,
          invoiceKept: false,
          rowsUnlinked: n,
        };
      });

      results.push(
        outcome ?? {
          ...base,
          success: false,
          outcome: 'busy',
          message: 'This group is being invoiced right now. Try again in a moment.',
          invoiceKept: true,
          rowsUnlinked: 0,
        }
      );
    }

    const summary = {
      deleted: results.filter(r => r.outcome === 'deleted').length,
      unlinked: results.filter(r => r.success && r.outcome !== 'deleted' && r.outcome !== 'none').length,
      kept: results.filter(r => r.invoiceKept && r.success).length,
      failed: results.filter(r => !r.success).length,
    };

    return res.status(200).json({
      success: true,
      results,
      summary,
      stoppedEarly,
      ...(stoppedEarly
        ? { message: 'Stopped early to keep the request short — select the rest and run again.' }
        : {}),
    });
  } catch (err) {
    console.error('[ca-remove-invoice] error:', err);
    return res.status(500).json({
      success: false,
      error: err instanceof Error ? err.message : 'Internal server error',
    });
  }
}

export default withAuth(handler, { roles: ['admin', 'trainingProvider', 'developer'] });
