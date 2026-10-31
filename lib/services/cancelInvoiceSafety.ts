import { qboReadInvoice, qboDeleteInvoice, qboFindInvoiceByDocNumber } from './qboInvoiceService';

/**
 * Safe QuickBooks invoice delete used when an enrolment / Direct Application is cancelled.
 *
 * Refuses (returns a warning, deletes nothing) when the invoice:
 *  - has a payment / credit applied (deleting it would leave the money as unapplied credit),
 *  - is not the invoice we expect (DocNumber, course run, WSG customer),
 *  - bills more than one participant (company group TC — cancelling one learner must not delete it).
 *
 * Both QB apps point at the same company (one realm), so an app whose token is broken is just
 * skipped — only an app that actually answers decides "found" / "already gone".
 */

const APPS: Array<'app1' | 'app2'> = ['app1', 'app2'];
const A = (x: any) => (Array.isArray(x) ? x : x ? [x] : []);

export interface InvoiceExpectation {
  /** Invoice DocNumber must equal this (case-insensitive). */
  docNumber?: string | null;
  /** Invoice text must cite this course run id ("Course Run: 1433997"). */
  courseRunId?: string | null;
  /** Customer must be Singapore Workforce Development Agency (GRN / SFC-CA invoices). */
  wsgCustomer?: boolean;
}

/** deleted = removed now; gone = was not in QuickBooks; skipped = refused by a safety check; failed = QB error. */
export type SafeDeleteStatus = 'deleted' | 'gone' | 'skipped' | 'failed';
export interface SafeDeleteResult { status: SafeDeleteStatus; message?: string }

function isQbNotFound(msg: string): boolean {
  const lower = msg.toLowerCase();
  return msg.includes('610') || lower.includes('not found') || lower.includes('object not found');
}

function invoiceText(raw: any): string {
  return [
    raw?.DocNumber, raw?.PrivateNote, raw?.CustomerMemo?.value,
    ...A(raw?.CustomField).map((f: any) => f?.StringValue),
    ...A(raw?.Line).map((l: any) => l?.Description),
  ].filter(Boolean).join(' ').replace(/\s+/g, ' ');
}

/** Reason the invoice must not be deleted, or null when it is safe. */
export function deleteBlocker(raw: any, expect: InvoiceExpectation = {}): string | null {
  const doc = String(raw?.DocNumber || raw?.Id || '');
  const links = A(raw?.LinkedTxn).filter((t: any) => t?.TxnType && t.TxnType !== 'Estimate');
  if (links.length || Number(raw?.Balance) < Number(raw?.TotalAmt) - 0.005) {
    const kinds = [...new Set(links.map((t: any) => t.TxnType))].join('/') || 'payment';
    return `${doc} has ${kinds} applied — not deleted (would leave unapplied credit); needs finance review`;
  }
  if (expect.docNumber && String(raw?.DocNumber || '').trim().toUpperCase() !== String(expect.docNumber).trim().toUpperCase()) {
    return `${doc} is not the expected invoice ${expect.docNumber} — not deleted`;
  }
  const text = invoiceText(raw);
  if (expect.courseRunId && !new RegExp(`\\b${String(expect.courseRunId).trim().replace(/\D/g, '')}\\b`).test(text)) {
    return `${doc} does not cite course run ${expect.courseRunId} — not deleted`;
  }
  if (/Participant Name:\s*1\./i.test(text)) {
    return `${doc} is a group invoice for several participants — not deleted; needs finance review`;
  }
  if (expect.wsgCustomer && !/workforce/i.test(String(raw?.CustomerRef?.name || ''))) {
    return `${doc} is not billed to SSG/WSG (${raw?.CustomerRef?.name || 'no customer'}) — not deleted`;
  }
  return null;
}

async function locate(find: (app: 'app1' | 'app2') => Promise<{ id: string; syncToken?: string; raw: any } | null>) {
  const errors: string[] = [];
  for (const app of APPS) {
    try {
      const inv = await find(app);
      return { app, inv: inv?.id ? inv : null };
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      if (isQbNotFound(msg)) return { app, inv: null };
      errors.push(`[${app}] ${msg}`);
    }
  }
  throw new Error(errors.join('; '));
}

async function deleteLocated(
  label: string,
  find: (app: 'app1' | 'app2') => Promise<{ id: string; syncToken?: string; raw: any } | null>,
  expect: InvoiceExpectation,
): Promise<SafeDeleteResult> {
  try {
    const { app, inv } = await locate(find);
    if (!inv) return { status: 'gone' };
    const blocked = deleteBlocker(inv.raw, expect);
    if (blocked) return { status: 'skipped', message: `${label}: ${blocked}` };
    if (!inv.syncToken) return { status: 'failed', message: `${label}: QuickBooks returned no SyncToken for invoice ${inv.id}` };
    await qboDeleteInvoice(app, inv.id, inv.syncToken);
    return { status: 'deleted' };
  } catch (e) {
    return { status: 'failed', message: `${label}: ${e instanceof Error ? e.message : String(e)}` };
  }
}

export function safeDeleteInvoiceById(invoiceId: string, label: string, expect: InvoiceExpectation = {}) {
  return deleteLocated(label, (app) => qboReadInvoice(app, invoiceId), expect);
}

export function safeDeleteInvoiceByDocNumber(docNumber: string, label: string, expect: InvoiceExpectation = {}) {
  return deleteLocated(label, async (app) => {
    const hit = await qboFindInvoiceByDocNumber(app, docNumber);
    return hit?.id ? qboReadInvoice(app, hit.id) : null;
  }, { docNumber, ...expect });
}
