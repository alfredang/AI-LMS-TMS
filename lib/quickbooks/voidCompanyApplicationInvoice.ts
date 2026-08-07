/**
 * Void a QuickBooks invoice (main tax invoice or grant invoice) via the same
 * QBO proxy the rest of the CA flow uses. Voiding keeps the invoice number in
 * QBO but zeroes it out (audit-friendly) — we do NOT hard-delete.
 *
 * Two-step, because QBO's void operation needs the current SyncToken:
 *   1. read the invoice  → get its SyncToken (and detect already-void / gone)
 *   2. POST ?operation=void with { Id, SyncToken }
 *
 * NEVER throws — returns a status the caller can log/surface. Callers must only
 * void an invoice that no other (still-present) learner shares.
 */

import { callQbProxy } from './qbProxyClient';

export interface VoidInvoiceResult {
  ok: boolean;
  status: 'voided' | 'already_void' | 'not_found' | 'error';
  message: string;
}

// QBO "Object Not Found" (error code 610) — the invoice was already deleted in
// QBO, so there's nothing to void. Treat as a successful no-op.
function isNotFound(message: string): boolean {
  return /object not found|610|not found|does not exist/i.test(message || '');
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
