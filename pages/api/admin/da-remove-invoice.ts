import { withAuth } from '@lib/auth/withAuth';
import type { NextApiRequest, NextApiResponse } from 'next';
import pool from '../../../lib/db';
import { qboReadInvoice, qboDeleteInvoice } from '../../../lib/services/qboInvoiceService';
import { daInvoiceBelongsTo } from '../../../lib/quickbooks/invoiceOwnership';
import { realApplicationId } from '../../../lib/daApplicationId';

/**
 * POST /api/admin/da-remove-invoice
 *
 * Detach the main tax invoice from Direct Application rows so a correct one can
 * be raised, WITHOUT cancelling anything. The enrolment, the SSG grant, the
 * calendar entry and the application status are all left exactly as they are —
 * the existing cancel path (lib/services/daInvoiceCleanup.ts) forces the row to
 * "Cancelled", which is wrong when the only thing at fault is the invoice.
 *
 * Whether the QuickBooks document is deleted depends on who it belongs to, and
 * that distinction is the whole point of this route.
 *
 * Before the ownership fix (0581f9d2) the pipeline could adopt an invoice
 * belonging to a DIFFERENT learner, because it searched QuickBooks by the last
 * six digits of the enrolment reference and SSG reuses those across periods.
 * The rows left behind point at real, often already-paid invoices belonging to
 * real people. Deleting one of those would destroy somebody's settled financial
 * record to tidy up a wrong link, so this route never does it.
 *
 * The rules, in order:
 *   1. No invoice attached            -> nothing to do
 *   2. Not in QuickBooks any more     -> clear the dead link
 *   3. Belongs to a different learner -> UNLINK ONLY, never delete
 *   4. Ours but paid or part-paid     -> UNLINK ONLY, never delete
 *   5. Ours and unpaid                -> delete from QuickBooks, then unlink
 *
 * `invoice_jobs` is cleared too. It is keyed on enrolment_id, holds its own
 * copy of the QuickBooks id and document number, and keeps the FIRST invoice_no
 * it ever saw (see the COALESCE in autoEnrolDirectApplications.ts). Leaving it
 * behind would feed the wrong number straight back into the next generation.
 */

/**
 * Rows per call. Each row makes one or two QuickBooks calls and they run in
 * sequence, so an uncapped selection would hold the request open for minutes,
 * hit the proxy timeout, and hammer one QuickBooks realm. Fixing wrong invoices
 * is a handful-at-a-time job; anything larger is a sign something else is wrong.
 */
const MAX_ROWS_PER_CALL = 25;

/**
 * How long to wait for the per-enrolment invoice lock before giving up on a row.
 *
 * Short on purpose. The lock is held by createDirectApplicationInvoice while it
 * generates, and if that is happening right now the honest answer is "try again
 * in a moment", not a request that blocks for a minute and a half per row.
 */
const LOCK_WAIT_MS = 3_000;

type Outcome = 'none' | 'gone' | 'unlinked_foreign' | 'unlinked_paid' | 'deleted' | 'busy';

interface RowResult {
  id: string;
  applicationId: string | null;
  traineeName: string | null;
  docNumber: string | null;
  success: boolean;
  outcome: Outcome;
  message: string;
  /** True when a QuickBooks document was left untouched on purpose. */
  invoiceKept: boolean;
  /** A Drive copy of an invoice that turned out not to be ours. */
  orphanedDriveLink?: string | null;
}

/** Clear the invoice columns on the DA row. Status and enrolment are untouched. */
async function unlinkRow(rowId: string): Promise<void> {
  await pool.query(
    `UPDATE da_application
        SET invoice_id = NULL,
            invoice_doc_number = NULL,
            invoice_no = NULL,
            invoice_drive_file_id = NULL,
            invoice_drive_web_view_link = NULL,
            updated_at = NOW()
      WHERE id = $1::uuid`,
    [rowId]
  );
}

/**
 * Drop the cached invoice identity for this enrolment so the next run mints a
 * fresh number instead of resurrecting the old one. Best effort: the table may
 * legitimately hold no row, and a failure here must not undo the unlink.
 */
async function clearInvoiceJob(enrolmentId: string | null | undefined): Promise<void> {
  const ref = String(enrolmentId || '').trim();
  if (!ref) return;
  try {
    await pool.query(
      `UPDATE public.invoice_jobs
          SET status = 'failed',
              qbo_invoice_id = NULL,
              qbo_doc_number = NULL,
              invoice_no = NULL,
              drive_file_id = NULL,
              drive_web_view_link = NULL,
              last_error = 'Invoice detached by an admin; a new one will be minted.',
              updated_at = now()
        WHERE LOWER(TRIM(COALESCE(enrolment_id::text, ''))) = LOWER(TRIM($1::text))`,
      [ref]
    );
  } catch (err) {
    console.warn(
      `[da-remove-invoice] Could not clear invoice_jobs for ${ref}: ${err instanceof Error ? err.message : err}`
    );
  }
}

/**
 * Run `fn` holding the same advisory lock createDirectApplicationInvoice takes
 * (`da-inv:{enrolment}`), so a removal cannot interleave with a generation for
 * the same learner. Without it, unlinking mid-generation would leave a real
 * invoice stranded in QuickBooks with nothing in the LMS pointing at it.
 *
 * Returns `null` when the lock could not be taken, which the caller reports as
 * "busy" rather than treating as a failure. Rows with no real enrolment
 * reference are not locked: generation refuses those outright, so nothing can
 * be racing, and a shared empty key would needlessly serialise them.
 */
async function withEnrolmentInvoiceLock<T>(
  enrolmentId: string | null | undefined,
  fn: () => Promise<T>
): Promise<T | null> {
  const ref = String(enrolmentId || '').trim().toLowerCase();
  if (!ref || !/^enr-/i.test(ref)) return fn();

  const lockKey = `da-inv:${ref}`;
  const client = await pool.connect();
  let held = false;
  try {
    const deadline = Date.now() + LOCK_WAIT_MS;
    while (Date.now() < deadline) {
      const res = await client.query(`SELECT pg_try_advisory_lock(hashtext($1)) AS locked`, [lockKey]);
      if (res.rows[0]?.locked) { held = true; break; }
      await new Promise(r => setTimeout(r, 500));
    }
    if (!held) return null;
    return await fn();
  } finally {
    if (held) {
      await client.query(`SELECT pg_advisory_unlock(hashtext($1))`, [lockKey]).catch(() => {});
    }
    client.release();
  }
}

async function removeOne(row: {
  id: string;
  application_id: string | null;
  trainee_name: string | null;
  trainee_id: string | null;
  course_run_id: string | null;
  enrolment_id: string | null;
  invoice_id: string | null;
  invoice_doc_number: string | null;
  invoice_drive_web_view_link: string | null;
}): Promise<RowResult> {
  const base = {
    id: row.id,
    applicationId: row.application_id,
    traineeName: row.trainee_name,
    docNumber: row.invoice_doc_number,
  };

  const invoiceId = String(row.invoice_id || '').trim();
  if (!invoiceId) {
    return { ...base, success: true, outcome: 'none', message: 'No invoice attached.', invoiceKept: false };
  }

  // "MANUAL" is not a QuickBooks id; it records that this learner was billed
  // outside the system. Clearing it would erase a deliberate note rather than
  // undo a mistake, so it is left alone.
  if (invoiceId.toUpperCase() === 'MANUAL') {
    return {
      ...base,
      success: true,
      outcome: 'none',
      message: 'Marked as billed manually, so there is no QuickBooks invoice to remove.',
      invoiceKept: true,
    };
  }

  let invoice: Awaited<ReturnType<typeof qboReadInvoice>> | null = null;
  try {
    invoice = await qboReadInvoice(undefined, invoiceId);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    const lower = msg.toLowerCase();
    const missing = msg.includes('610') || lower.includes('not found');
    if (!missing) {
      return {
        ...base,
        success: false,
        outcome: 'none',
        message: `Could not read invoice ${invoiceId} from QuickBooks: ${msg}`,
        invoiceKept: true,
      };
    }
    await unlinkRow(row.id);
    await clearInvoiceJob(row.enrolment_id);
    return {
      ...base,
      success: true,
      outcome: 'gone',
      message: 'Invoice no longer exists in QuickBooks. The dead link was cleared.',
      invoiceKept: false,
    };
  }

  const raw = invoice?.raw as Record<string, unknown> | undefined;
  const docNumber = String(raw?.DocNumber ?? row.invoice_doc_number ?? '') || null;

  const ours = daInvoiceBelongsTo(raw, {
    applicationId: realApplicationId(row.application_id),
    enrolmentId: row.enrolment_id,
    traineeName: row.trainee_name,
    courseRunId: row.course_run_id,
  });

  if (!ours) {
    // Somebody else's document. Never delete it, whatever its balance.
    await unlinkRow(row.id);
    await clearInvoiceJob(row.enrolment_id);
    const billedTo =
      String((raw?.CustomerRef as { name?: unknown } | undefined)?.name ?? '').trim() ||
      String((raw?.BillEmail as { Address?: unknown } | undefined)?.Address ?? '').trim();
    return {
      ...base,
      docNumber,
      success: true,
      outcome: 'unlinked_foreign',
      message:
        `Invoice ${docNumber || invoiceId} belongs to a different learner` +
        (billedTo ? ` (${billedTo})` : '') +
        '. It was left untouched in QuickBooks and only unlinked here.',
      invoiceKept: true,
      orphanedDriveLink: row.invoice_drive_web_view_link || null,
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
    await unlinkRow(row.id);
    await clearInvoiceJob(row.enrolment_id);
    return {
      ...base,
      docNumber,
      success: true,
      outcome: 'unlinked_paid',
      message:
        `Invoice ${docNumber || invoiceId} has a payment against it, so it was kept in QuickBooks ` +
        'and only unlinked here. Void or delete it there if it really must go.',
      invoiceKept: true,
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
    };
  }

  await unlinkRow(row.id);
  await clearInvoiceJob(row.enrolment_id);
  return {
    ...base,
    docNumber,
    success: true,
    outcome: 'deleted',
    message: `Invoice ${docNumber || invoiceId} was deleted from QuickBooks and unlinked.`,
    invoiceKept: false,
  };
}

async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ success: false, error: 'Method Not Allowed' });
  }

  const { applicationIds } = req.body || {};
  if (!Array.isArray(applicationIds) || applicationIds.length === 0) {
    return res.status(400).json({ success: false, error: 'applicationIds array is required' });
  }
  if (applicationIds.length > MAX_ROWS_PER_CALL) {
    return res.status(400).json({
      success: false,
      error:
        `Too many rows in one go (${applicationIds.length}). ` +
        `Each row talks to QuickBooks, so remove at most ${MAX_ROWS_PER_CALL} at a time.`,
    });
  }
  // Reject anything that is not a uuid before it reaches the database, so a
  // malformed id returns a clear 400 instead of a cast error surfacing as a 500.
  const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  const ids = applicationIds.map((v: unknown) => String(v ?? '').trim());
  if (!ids.every(v => UUID.test(v))) {
    return res.status(400).json({ success: false, error: 'applicationIds must all be application row ids' });
  }

  try {
    // No status filter. A row whose invoice is wrong needs fixing whatever
    // state it is in, and this route changes no status of its own.
    const rowsRes = await pool.query(
      `SELECT id, application_id, trainee_name, trainee_id, course_run_id, enrolment_id,
              invoice_id, invoice_doc_number, invoice_drive_web_view_link
         FROM da_application
        WHERE id = ANY($1::uuid[])`,
      [ids]
    );

    const results: RowResult[] = [];
    // Sequential on purpose: each row makes QuickBooks calls, and a burst of
    // parallel reads and deletes against one realm invites throttling.
    for (const row of rowsRes.rows) {
      try {
        const done = await withEnrolmentInvoiceLock(row.enrolment_id, () => removeOne(row));
        results.push(
          done ?? {
            id: row.id,
            applicationId: row.application_id,
            traineeName: row.trainee_name,
            docNumber: row.invoice_doc_number,
            success: true,
            outcome: 'busy',
            message:
              'An invoice is being generated for this learner right now, so nothing was changed. Try again in a moment.',
            invoiceKept: true,
          }
        );
      } catch (err) {
        results.push({
          id: row.id,
          applicationId: row.application_id,
          traineeName: row.trainee_name,
          docNumber: row.invoice_doc_number,
          success: false,
          outcome: 'none',
          message: err instanceof Error ? err.message : String(err),
          invoiceKept: true,
        });
      }
    }

    const summary = {
      deleted: results.filter(r => r.outcome === 'deleted').length,
      keptForeign: results.filter(r => r.outcome === 'unlinked_foreign').length,
      keptPaid: results.filter(r => r.outcome === 'unlinked_paid').length,
      alreadyGone: results.filter(r => r.outcome === 'gone').length,
      nothingToDo: results.filter(r => r.outcome === 'none' && r.success).length,
      busy: results.filter(r => r.outcome === 'busy').length,
      failed: results.filter(r => !r.success).length,
    };

    return res.status(200).json({ success: true, summary, results });
  } catch (err) {
    console.error('[da-remove-invoice]', err);
    return res
      .status(500)
      .json({ success: false, error: err instanceof Error ? err.message : 'Internal server error' });
  }
}

export default withAuth(handler, { roles: ['admin', 'trainingProvider', 'developer', 'finance'] });
