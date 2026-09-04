/**
 * Ending the life of a Company Application invoice (main tax invoice or grant
 * invoice), via the same QBO proxy the rest of the CA flow uses.
 *
 * Two ways out, and they are NOT interchangeable:
 *
 *   voidQboInvoice   — the default. Keeps the invoice number in QuickBooks and
 *                      zeroes it out, so the audit trail survives. Used when a
 *                      learner is deleted and no one else shares their invoice.
 *   deleteQboInvoice — removes it outright. Only for the late joiner
 *                      replacement, where the invoice never left the office and
 *                      is about to be reissued covering more people. See the
 *                      note on that function for why voiding breaks there.
 *
 * Both are two-step, because QBO needs the current SyncToken to modify anything:
 *   1. read the invoice  → get its SyncToken (and detect already-void / gone)
 *   2. POST ?operation=void|delete with { Id, SyncToken }
 *
 * NEITHER throws — both return a status the caller can log/surface. Callers must
 * only act on an invoice no other (still-present) learner shares.
 */

import { callQbProxy } from './qbProxyClient';

export interface VoidInvoiceResult {
  ok: boolean;
  status: 'voided' | 'deleted' | 'already_void' | 'not_found' | 'error';
  message: string;
}

// QBO "Object Not Found" (error code 610) — the invoice was already deleted in
// QBO, so there's nothing to void. Treat as a successful no-op.
function isNotFound(message: string): boolean {
  return /object not found|610|not found|does not exist/i.test(message || '');
}

/**
 * What QuickBooks currently thinks about an invoice, for deciding whether it is
 * still ours to take back.
 *
 * `emailSent` and `hasPayment` are the two things that make an invoice
 * untouchable: the customer is holding it, or money has moved against it. Both
 * are read from QBO rather than our own columns because either can happen
 * outside the LMS — Finance emails a copy from QuickBooks, or records a payment
 * by hand.
 */
export interface QboInvoiceLifecycle {
  found: boolean;
  docNumber: string;
  emailSent: boolean;
  hasPayment: boolean;
  totalAmt: number;
  balance: number;
}

export async function readQboInvoiceLifecycle(invoiceId: string): Promise<QboInvoiceLifecycle> {
  const missing: QboInvoiceLifecycle = {
    found: false, docNumber: '', emailSent: false, hasPayment: false, totalAmt: 0, balance: 0,
  };
  const id = String(invoiceId || '').trim();
  if (!id) return missing;

  let readData: any;
  try {
    readData = await callQbProxy({ action: 'read', entity: 'invoice', id });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (isNotFound(msg)) return missing;
    throw e;
  }

  const invoice = readData?.data?.Invoice;
  if (!invoice) return missing;

  const linked = invoice.LinkedTxn;
  const linkedTxns = Array.isArray(linked) ? linked : linked ? [linked] : [];

  return {
    found: true,
    docNumber: String(invoice.DocNumber || ''),
    emailSent: String(invoice.EmailStatus || '').toLowerCase() === 'emailsent',
    hasPayment: linkedTxns.some((t: any) => String(t?.TxnType || '') === 'Payment'),
    totalAmt: Number(invoice.TotalAmt) || 0,
    balance: Number(invoice.Balance) || 0,
  };
}

/**
 * Hard-delete a QuickBooks invoice.
 *
 * Deliberately different from voidQboInvoice, and only ever used on the late
 * joiner replacement path, where the invoice never left the office. Voiding
 * would be wrong there for a specific reason: a voided invoice KEEPS its
 * DocNumber in QuickBooks, and createCompanyApplicationInvoice's orphan-recovery
 * search looks the DocNumber up before creating. It would find the corpse
 * moments later, treat it as "already created", and hand the zero-value invoice
 * straight back to every learner in the group. A deleted invoice is not
 * queryable, so the search correctly finds nothing.
 *
 * QuickBooks refuses to delete an invoice with a payment applied, which is a
 * useful second line of defence behind readQboInvoiceLifecycle.
 *
 * NEVER throws — returns a status the caller can log/surface.
 */
export async function deleteQboInvoice(invoiceId: string): Promise<VoidInvoiceResult> {
  const id = String(invoiceId || '').trim();
  if (!id) return { ok: true, status: 'not_found', message: 'No invoice id' };

  try {
    let readData: any;
    try {
      readData = await callQbProxy({ action: 'read', entity: 'invoice', id });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      if (isNotFound(msg)) return { ok: true, status: 'not_found', message: 'Invoice already gone in QBO' };
      throw e;
    }

    const invoice = readData?.data?.Invoice;
    if (!invoice) return { ok: true, status: 'not_found', message: 'Invoice not found in QBO' };

    const syncToken = String(invoice.SyncToken ?? '0');
    await callQbProxy({ action: 'delete', entity: 'invoice', body: { Id: id, SyncToken: syncToken } });
    return { ok: true, status: 'deleted', message: `Deleted invoice ${id}` };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (isNotFound(msg)) return { ok: true, status: 'not_found', message: 'Invoice already gone in QBO' };
    return { ok: false, status: 'error', message: msg };
  }
}

export async function voidQboInvoice(invoiceId: string): Promise<VoidInvoiceResult> {
  const id = String(invoiceId || '').trim();
  if (!id) return { ok: true, status: 'not_found', message: 'No invoice id' };

  try {
    let readData: any;
    try {
      readData = await callQbProxy({ action: 'read', entity: 'invoice', id });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      if (isNotFound(msg)) return { ok: true, status: 'not_found', message: 'Invoice already gone in QBO' };
      throw e;
    }

    const invoice = readData?.data?.Invoice;
    if (!invoice) return { ok: true, status: 'not_found', message: 'Invoice not found in QBO' };

    // A voided invoice in QBO carries "Voided" in its PrivateNote and zero
    // totals — skip re-voiding.
    const privateNote = String(invoice.PrivateNote || '');
    if (/voided/i.test(privateNote) && Number(invoice.TotalAmt) === 0) {
      return { ok: true, status: 'already_void', message: 'Invoice already voided' };
    }

    const syncToken = String(invoice.SyncToken ?? '0');
    await callQbProxy({ action: 'void', entity: 'invoice', body: { Id: id, SyncToken: syncToken } });
    return { ok: true, status: 'voided', message: `Voided invoice ${id}` };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (isNotFound(msg)) return { ok: true, status: 'not_found', message: 'Invoice already gone in QBO' };
    return { ok: false, status: 'error', message: msg };
  }
}
