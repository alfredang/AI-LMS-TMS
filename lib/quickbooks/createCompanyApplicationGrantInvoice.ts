/**
 * Build + POST a supplemental "Grant" invoice in QuickBooks for a single
 * Company Application learner, alongside the consolidated main tax invoice.
 *
 * Same shape as the DA grant invoice (see createDirectApplicationGrantInvoice)
 * EXCEPT that CA's main tax invoice is one-per-(employer, course-run) while
 * grant invoices are one-per-LEARNER. Each learner with positive ssg_grants
 * gets their own grant invoice that cross-references the shared main tax
 * invoice via PO#.
 *
 * Numbering and shape (mirrors DA):
 *   - DocNumber   = Baseline grant_id (e.g. "GRN-2605-089621"); falls back to
 *                   first non-Baseline grant_id if no Baseline row.
 *   - PO#         = the group's main tax invoice DocNumber (cross-reference).
 *   - Customer    = "Singapore Workforce Development Agency (WSG)" (fixed).
 *   - Terms       = none.
 *   - Lines       = Baseline + first non-Baseline ssg_grants row, POSITIVE
 *                   amounts, OOS tax. Reuses loadSplitGrantDeductionsFromDb
 *                   so the line wording stays identical to the DA pattern.
 *
 * Idempotent: if a QB invoice already exists with the Baseline grant_id as
 * DocNumber, it is reused rather than re-created.
 */

import { refreshGrantsForEnrolments } from '../services/billingSync';
import {
  loadSplitGrantDeductionsFromDb,
} from '../services/daInvoiceGrantLines';
import { buildInvoiceLineText } from './invoiceLineText';
import {
  qboCreateInvoice,
  qboFindCustomerByName,
  qboFindInvoiceByDocNumber,
  qboFindItemByName,
  qboFindTermByName,
  qboResolveOosTaxCodeRef,
  qboSparseUpdateInvoice,
} from '../services/qboInvoiceService';
import { buildPurchaseOrderInvoiceFields } from './directApplicationInvoiceFields';

const SUPPLEMENTAL_INVOICE_CUSTOMER_NAME = (
  process.env.QBO_CA_SUPPLEMENTAL_CUSTOMER_NAME ||
  process.env.QBO_DA_SUPPLEMENTAL_CUSTOMER_NAME ||
  'Singapore Workforce Development Agency (WSG)'
).trim();

const CA_GRANT_TERM_NAME = '35 Days Term';
const CA_GRANT_DUE_DAYS = 35;

let cachedSupplementalCustomerId: string | null = null;

async function resolveSupplementalCustomerRef(): Promise<string> {
  if (cachedSupplementalCustomerId) return cachedSupplementalCustomerId;
  const found = await qboFindCustomerByName(undefined, SUPPLEMENTAL_INVOICE_CUSTOMER_NAME);
  if (!found?.id) {
    throw new Error(
      `QuickBooks Customer "${SUPPLEMENTAL_INVOICE_CUSTOMER_NAME}" not found. Create it in QBO (Sales → Customers → New customer) or override via QBO_CA_SUPPLEMENTAL_CUSTOMER_NAME env var.`
    );
  }
  cachedSupplementalCustomerId = found.id;
  return cachedSupplementalCustomerId;
}

async function resolveGrantItem(itemName: string) {
  const name = String(itemName || '').trim();
  if (!name) return null;
  try {
    const item = await qboFindItemByName(undefined, name);
    if (item?.id) return item;
    console.warn(`[QBO CA grant invoice] No Item found for name "${name}" — grant line cannot be created without a Product/Service.`);
  } catch (err) {
    console.warn(`[QBO CA grant invoice] Item lookup failed for "${name}":`, err);
  }
  return null;
}

export interface CaGrantInvoiceInput {
  enrolmentId: string;
  mainInvoiceDocNumber: string | null;
  /**
   * The course type this group is billed as ('WSQ' | 'CASL'), resolved by the
   * main invoice from the QuickBooks product. Passed through so this invoice
   * uses the SAME funding products and wording — the two documents are meant to
   * be read side by side, and would otherwise disagree for a CASL course.
   */
  courseTypeLabel?: string | null;
}

export interface CreatedCaGrantInvoice {
  invoiceId: string;
  docNumber: string;
  lineCount: number;
  totalAmount: number;
  reusedExisting: boolean;
}

export async function createCompanyApplicationGrantInvoice(
  input: CaGrantInvoiceInput
): Promise<CreatedCaGrantInvoice | null> {
  const enrolmentId = String(input.enrolmentId || '').trim();
  if (!enrolmentId) {
    throw new Error('createCompanyApplicationGrantInvoice: enrolmentId is required');
  }
  if (!/^ENR-/i.test(enrolmentId)) {
    throw new Error(
      `createCompanyApplicationGrantInvoice: enrolmentId "${enrolmentId}" is not a real SSG reference`
    );
  }

  let { lines: grantLines } = await loadSplitGrantDeductionsFromDb(enrolmentId, input.courseTypeLabel);
  let positiveLines = grantLines.filter(l => Number(l.amount) > 0);

  // Force a single SSG refresh if the DB has nothing — the upstream pipeline's
  // refresh is non-blocking and may have lost a transient SSG glitch.
  if (positiveLines.length === 0) {
    console.log(`[QBO CA grant invoice] No ssg_grants rows for enrolment ${enrolmentId} — forcing refresh from SSG`);
    try {
      const refreshResults = await refreshGrantsForEnrolments([enrolmentId]);
      const r = refreshResults[0];
      if (r && !r.success) {
        throw new Error(
          `CA grant invoice requires ssg_grants data but SSG refresh failed for enrolment ${enrolmentId}: ${r.error || 'unknown error'}`
        );
      }
    } catch (err) {
      throw new Error(
        `CA grant invoice requires ssg_grants data but SSG refresh threw for enrolment ${enrolmentId}: ${err instanceof Error ? err.message : String(err)}`
      );
    }
    const retry = await loadSplitGrantDeductionsFromDb(enrolmentId, input.courseTypeLabel);
    grantLines = retry.lines;
    positiveLines = grantLines.filter(l => Number(l.amount) > 0);
  }

  // No grants for this learner — that's fine, just nothing to invoice.
  if (positiveLines.length === 0) {
    return null;
  }

  const docNumber = String(positiveLines[0].grantId || '').trim();
  if (!docNumber) {
    throw new Error('createCompanyApplicationGrantInvoice: resolved grant line has no grant_id');
  }

  // Idempotency: reuse an existing invoice with this DocNumber. Backfill the
  // PONumber if the existing invoice was created before the main invoice's
  // DocNumber became known.
  const existing = await qboFindInvoiceByDocNumber(undefined, docNumber);
  if (existing?.id) {
    const desiredPo = input.mainInvoiceDocNumber ? input.mainInvoiceDocNumber.trim() : '';
    if (desiredPo && existing.syncToken) {
      try {
        await qboSparseUpdateInvoice(
          undefined,
          existing.id,
          existing.syncToken,
          await buildPurchaseOrderInvoiceFields(desiredPo, existing.raw)
        );
      } catch (err) {
        console.warn(`[QBO CA grant invoice] Failed to backfill PONumber on invoice ${existing.id}:`, err);
      }
    }
    return {
      invoiceId: existing.id,
      docNumber,
      lineCount: positiveLines.length,
      totalAmount: positiveLines.reduce((s, l) => s + l.amount, 0),
      reusedExisting: true,
    };
  }

  const customerRef = await resolveSupplementalCustomerRef();
  const taxOos = await qboResolveOosTaxCodeRef(undefined);
  const term = await qboFindTermByName(undefined, CA_GRANT_TERM_NAME);
  if (!term?.id) {
    throw new Error(
      `QuickBooks Term "${CA_GRANT_TERM_NAME}" not found. Create it in QBO (Lists → All Lists → Terms).`
    );
  }

  const lineBodies: any[] = [];
  for (const g of positiveLines) {
    const item = await resolveGrantItem(g.itemName);
    const itemRef = item?.id ? { value: item.id, name: item.name } : null;
    if (!itemRef) {
      throw new Error(
        `CA grant invoice requires QBO Product/Service "${g.itemName}" to exist. Create it in QuickBooks.`
      );
    }
    lineBodies.push({
      DetailType: 'SalesItemLineDetail',
      Amount: g.amount,
      // Same wording as the main invoice: from the funding product's own
      // Description box, with the grant refs appended.
      Description: buildInvoiceLineText({
        productDescription: item?.description,
        fields: [{ key: 'grantRef', label: 'Grant Ref #', value: `1. ${g.grantId}`, block: true }],
        fallbackHeading: g.description.split('\n')[0],
      }).text,
      SalesItemLineDetail: {
        ItemRef: itemRef,
        Qty: 1,
        UnitPrice: g.amount,
        TaxCodeRef: { value: taxOos },
      },
    });
  }

  const txnDate = new Date().toISOString().slice(0, 10);
  const dueDate = (() => {
    const d = new Date();
    d.setDate(d.getDate() + CA_GRANT_DUE_DAYS);
    return d.toISOString().slice(0, 10);
  })();

  const invoiceBody: Record<string, any> = {
    CustomerRef: { value: customerRef },
    BillAddr: { Line1: SUPPLEMENTAL_INVOICE_CUSTOMER_NAME },
    TxnDate: txnDate,
    DueDate: dueDate,
    SalesTermRef: { value: term.id },
    GlobalTaxCalculation: 'TaxExcluded',
    DocNumber: docNumber,
    Line: lineBodies,
  };

  if (input.mainInvoiceDocNumber && input.mainInvoiceDocNumber.trim()) {
    Object.assign(invoiceBody, await buildPurchaseOrderInvoiceFields(input.mainInvoiceDocNumber));
  }

  const created = await qboCreateInvoice(undefined, invoiceBody);
  if (!created.id) {
    throw new Error('QB CA grant invoice create returned no Id');
  }

  return {
    invoiceId: created.id,
    docNumber: created.docNumber || docNumber,
    lineCount: positiveLines.length,
    totalAmount: positiveLines.reduce((s, l) => s + l.amount, 0),
    reusedExisting: false,
  };
}

export function buildCaGrantInvoicePdfFileName(docNumber: string): string {
  const raw = String(docNumber || '').trim() || 'grant';
  return `CA_GRANT_QB_invoice_${raw}`;
}
