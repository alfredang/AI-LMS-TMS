/**
 * Build + POST a supplemental "Grant" invoice in QuickBooks for a Direct
 * Application, alongside the main tax invoice.
 *
 * Numbering and shape:
 *   - DocNumber      = Baseline grant_id from ssg_grants (e.g. "GRN-2601-166607").
 *                      If no Baseline row exists, the first non-Baseline grant_id
 *                      is used instead.
 *   - PO#            = main tax invoice DocNumber (cross-reference)
 *   - Customer       = same QB customer as the main invoice (the learner)
 *   - Terms          = none (empty — grants are for staff, not a credit term)
 *   - Line items     = one per ssg_grants row (Baseline + Non-Baseline),
 *                      POSITIVE amounts, OOS tax. Descriptions reuse the
 *                      main-invoice "Less: WSQ funding (...)" wording so the
 *                      two invoices line up visually. Product/Service names
 *                      reuse the same QBO items used on the main invoice's
 *                      deduction lines.
 *
 * These invoices are staff/internal only — we never call qboSendInvoice on
 * them. The PDF is still fetched and uploaded to Drive for billing history.
 *
 * Idempotent: if a QB invoice already exists with the Baseline grant_id as
 * DocNumber, it is reused rather than re-created.
 */

import {
  qboCreateInvoice,
  qboFindCustomerByName,
  qboFindInvoiceByDocNumber,
  qboFindItemByName,
  qboResolveOosTaxCodeRef,
  qboSparseUpdateInvoice,
} from '../services/qboInvoiceService';
import { refreshGrantsForEnrolments } from '../services/billingSync';
import {
  buildFallbackSplitGrantLines,
  loadSplitGrantDeductionsFromDb,
} from '../services/daInvoiceGrantLines';
import { buildPurchaseOrderInvoiceFields } from './directApplicationInvoiceFields';

/**
 * Fixed QB customer for all Grant + SFC supplemental invoices — the grant is
 * billed from WSG, not the learner. Billing address on the invoice auto-
 * populates from this customer's QB record, which should already show as
 * "Singapore Workforce Development Agency (WSG)".
 */
const SUPPLEMENTAL_INVOICE_CUSTOMER_NAME = (
  process.env.QBO_DA_SUPPLEMENTAL_CUSTOMER_NAME || 'Singapore Workforce Development Agency (WSG)'
).trim();

let cachedSupplementalCustomerId: string | null = null;

async function resolveSupplementalCustomerRef(): Promise<string> {
  if (cachedSupplementalCustomerId) return cachedSupplementalCustomerId;
  const found = await qboFindCustomerByName(undefined, SUPPLEMENTAL_INVOICE_CUSTOMER_NAME);
  if (!found?.id) {
    throw new Error(
      `QuickBooks Customer "${SUPPLEMENTAL_INVOICE_CUSTOMER_NAME}" not found. Create it in QBO (Sales → Customers → New customer) or override via QBO_DA_SUPPLEMENTAL_CUSTOMER_NAME env var.`
    );
  }
  cachedSupplementalCustomerId = found.id;
  return cachedSupplementalCustomerId;
}

export interface GrantInvoiceInput {
  enrolmentId: string;
  mainInvoiceDocNumber: string | null;
  fallbackGrantId?: string | null;
  fallbackTotalAmount?: number | null;
  fallbackBlGrantId?: string | null;
  fallbackBlAmount?: number | null;
  fallbackOtherGrantId?: string | null;
  fallbackOtherSchemeCode?: string | null;
  fallbackOtherAmount?: number | null;
}

export interface CreatedGrantInvoice {
  invoiceId: string;
  docNumber: string;
  lineCount: number;
  totalAmount: number;
  reusedExisting: boolean;
}

async function resolveGrantItemRef(itemName: string): Promise<{ value: string; name?: string } | null> {
  const name = String(itemName || '').trim();
  if (!name) return null;
  try {
    const item = await qboFindItemByName(undefined, name);
    if (item?.id) return { value: item.id, name: item.name };
    console.warn(`[QBO grant invoice] No Item found for name "${name}" — grant line cannot be created without a Product/Service.`);
  } catch (err) {
    console.warn(`[QBO grant invoice] Item lookup failed for "${name}":`, err);
  }
  return null;
}

export async function createDirectApplicationGrantInvoice(
  input: GrantInvoiceInput
): Promise<CreatedGrantInvoice | null> {
  const enrolmentId = String(input.enrolmentId || '').trim();
  if (!enrolmentId) {
    throw new Error('createDirectApplicationGrantInvoice: enrolmentId is required');
  }

  let { lines: grantLines } = await loadSplitGrantDeductionsFromDb(enrolmentId);
  let positiveLines = grantLines.filter(l => Number(l.amount) > 0);

  // If ssg_grants has no rows for this enrolment, try to pull them from SSG
  // once before giving up. The caller's earlier refresh is non-blocking and
  // can silently fail; doing it here on the critical path means a transient
  // SSG glitch upstream doesn't permanently hide the grant invoice.
  if (positiveLines.length === 0) {
    console.log(`[QBO grant invoice] No ssg_grants rows for enrolment ${enrolmentId} — forcing refresh from SSG`);
    try {
      const refreshResults = await refreshGrantsForEnrolments([enrolmentId]);
      const r = refreshResults[0];
      if (r && !r.success) {
        throw new Error(
          `grant invoice requires ssg_grants data but SSG refresh failed for enrolment ${enrolmentId}: ${r.error || 'unknown error'}`
        );
      }
    } catch (err) {
      throw new Error(
        `grant invoice requires ssg_grants data but SSG refresh threw for enrolment ${enrolmentId}: ${err instanceof Error ? err.message : String(err)}`
      );
    }

    const retry = await loadSplitGrantDeductionsFromDb(enrolmentId);
    grantLines = retry.lines;
    positiveLines = grantLines.filter(l => Number(l.amount) > 0);
  }

  if (positiveLines.length === 0) {
    const fallbackLines = buildFallbackSplitGrantLines({
      blGrantId: input.fallbackBlGrantId,
      blAmount: input.fallbackBlAmount,
      otherGrantId: input.fallbackOtherGrantId,
      otherSchemeCode: input.fallbackOtherSchemeCode,
      otherAmount: input.fallbackOtherAmount,
      totalGrantAmount: input.fallbackTotalAmount,
      grantIdFallback: input.fallbackGrantId,
    }).filter(l => Number(l.amount) > 0);
    if (fallbackLines.length > 0) {
      positiveLines = fallbackLines;
    }
  }

  if (positiveLines.length === 0) {
    // Even after a forced refresh, SSG has no grants for this enrolment. Fail
    // loudly so the admin sees the DA row in `failed` state with a clear
    // reason instead of silently skipping grant-invoice generation.
    throw new Error(
      `Grant invoice not ready yet: SSG has not issued any grants for enrolment ${enrolmentId}. ` +
      `This usually takes minutes to hours after the learner is enrolled. ` +
      `The system will automatically retry on the next scheduled DA invoice sweep — no admin action needed. ` +
      `To retry now: click "Sync Grants" in the DA view, then re-run "Generate Invoice" on this row.`
    );
  }

  // loadSplitGrantDeductionsFromDb already returns Baseline first, then
  // the first non-Baseline row. Anchor the DocNumber on line 1.
  const docNumber = String(positiveLines[0].grantId || '').trim();
  if (!docNumber) {
    throw new Error('createDirectApplicationGrantInvoice: resolved grant line has no grant_id');
  }

  // Idempotency — if a grant invoice with this DocNumber is already in QB,
  // reuse it rather than duplicating. Backfill PONumber if the existing
  // invoice was created before PO linking was added and mainInvoiceDocNumber
  // is now available.
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
        console.warn(`[QBO grant invoice] Failed to backfill PONumber on invoice ${existing.id}:`, err);
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

  const lineBodies: any[] = [];
  for (const g of positiveLines) {
    const itemRef = await resolveGrantItemRef(g.itemName);
    if (!itemRef) {
      throw new Error(
        `Grant invoice requires QBO Product/Service "${g.itemName}" to exist. Create it in QuickBooks or adjust the mapping in daInvoiceGrantLines.ts.`
      );
    }
    lineBodies.push({
      DetailType: 'SalesItemLineDetail',
      Amount: g.amount,
      Description: g.description, // e.g. "Less: WSQ funding (Baseline)\nGrant Ref#: GRN-..."
      SalesItemLineDetail: {
        ItemRef: itemRef,
        Qty: 1,
        UnitPrice: g.amount,
        TaxCodeRef: { value: taxOos },
      },
    });
  }

  const txnDate = new Date().toISOString().slice(0, 10);

  const invoiceBody: Record<string, any> = {
    CustomerRef: { value: customerRef },
    BillAddr: { Line1: SUPPLEMENTAL_INVOICE_CUSTOMER_NAME },
    TxnDate: txnDate,
    DueDate: txnDate,
    GlobalTaxCalculation: 'TaxExcluded',
    DocNumber: docNumber,
    Line: lineBodies,
  };

  if (input.mainInvoiceDocNumber && input.mainInvoiceDocNumber.trim()) {
    // PO# cross-reference back to the main tax invoice.
    Object.assign(invoiceBody, await buildPurchaseOrderInvoiceFields(input.mainInvoiceDocNumber));
  }

  const created = await qboCreateInvoice(undefined, invoiceBody);
  if (!created.id) {
    throw new Error('QB grant invoice create returned no Id');
  }

  return {
    invoiceId: created.id,
    docNumber: created.docNumber || docNumber,
    lineCount: positiveLines.length,
    totalAmount: positiveLines.reduce((s, l) => s + l.amount, 0),
    reusedExisting: false,
  };
}

export function buildDaGrantInvoicePdfFileName(docNumber: string): string {
  const raw = String(docNumber || '').trim() || 'grant';
  return `DA_GRANT_QB_invoice_${raw}`;
}
