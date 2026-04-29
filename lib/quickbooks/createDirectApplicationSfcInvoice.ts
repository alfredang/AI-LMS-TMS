/**
 * Build + POST a supplemental "SkillsFuture Credit" invoice in QuickBooks for
 * a Direct Application, alongside the main tax invoice.
 *
 * Numbering and shape:
 *   - DocNumber      = SFC-{application_id} from da_application
 *                      (e.g. "SFC-CA-2604-000492")
 *   - PO#            = main tax invoice DocNumber (cross-reference)
 *   - Customer       = fixed QB customer "Singapore Workforce Development Agency (WSG)"
 *   - BillAddr       = "Singapore Workforce Development Agency (WSG)"
 *   - Terms          = "25 Days SFC" (must exist as a Term in the QBO realm)
 *   - Line item      = single line, POSITIVE amount, OOS tax. Product/Service
 *                      reuses the same QBO item used on the main invoice's
 *                      SFC deduction line. Description mirrors the main-
 *                      invoice SFC line wording.
 *
 * Internal/staff only — we never call qboSendInvoice. PDF is fetched and
 * uploaded to Drive.
 *
 * Idempotent via qboFindInvoiceByDocNumber.
 */

import pool from '../db';
import {
  qboCreateInvoice,
  qboFindCustomerByName,
  qboFindInvoiceByDocNumber,
  qboFindItemByName,
  qboFindTermByName,
  qboResolveOosTaxCodeRef,
  qboSparseUpdateInvoice,
} from '../services/qboInvoiceService';

export interface SfcInvoiceInput {
  enrolmentId: string;
  mainInvoiceDocNumber: string | null;
  sfcClaimId: string;
  applicationId: string | null;
  /** DA row's stored skillsfuture_credit amount — used as a fallback when ssg_claims has no row yet. */
  fallbackAmount: number;
}

export interface CreatedSfcInvoice {
  invoiceId: string;
  docNumber: string;
  amount: number;
  reusedExisting: boolean;
}

const SFC_TERM_NAME = '25 Days SFC';
const SUPPLEMENTAL_INVOICE_CUSTOMER_NAME = (
  process.env.QBO_DA_SUPPLEMENTAL_CUSTOMER_NAME || 'Singapore Workforce Development Agency (WSG)'
).trim();

let cachedSupplementalCustomerId: string | null = null;

async function resolveSupplementalCustomerRef(): Promise<string> {
  if (cachedSupplementalCustomerId) return cachedSupplementalCustomerId;
  const found = await qboFindCustomerByName(undefined, SUPPLEMENTAL_INVOICE_CUSTOMER_NAME);
  if (!found?.id) {
    throw new Error(
      `QuickBooks Customer "${SUPPLEMENTAL_INVOICE_CUSTOMER_NAME}" not found. Create it in QBO (Sales -> Customers -> New customer) or override via QBO_DA_SUPPLEMENTAL_CUSTOMER_NAME env var.`
    );
  }
  cachedSupplementalCustomerId = found.id;
  return cachedSupplementalCustomerId;
}

function resolveSkillsFutureCreditItemName(): string {
  return (
    process.env.QBO_SFC_DA_ITEM_NAME ||
    process.env.QBO_SFC_ITEM_NAME ||
    'SkillsFuture Claim by Direct Application'
  ).trim();
}

function normalizeApplicationId(rawApplicationId: string | null | undefined): string {
  return String(rawApplicationId || '').trim().toUpperCase();
}

function buildSfcInvoiceDocNumber(
  applicationId: string | null | undefined,
  fallbackClaimId: string
): string {
  const normalizedApplicationId = normalizeApplicationId(applicationId);
  if (normalizedApplicationId) {
    return `SFC-${normalizedApplicationId}`;
  }
  return String(fallbackClaimId || '').trim().toUpperCase();
}

async function resolveClaimAmount(
  enrolmentId: string,
  sfcClaimId: string,
  fallback: number
): Promise<number> {
  try {
    const res = await pool.query(
      `SELECT claim_amount
         FROM ssg_claims
        WHERE (
                LOWER(TRIM(COALESCE(claim_id, ''))) = LOWER(TRIM($1::text))
             OR LOWER(TRIM(COALESCE(enrollment_id, ''))) = LOWER(TRIM($2::text))
              )
          AND COALESCE(claim_amount, 0) > 0
        ORDER BY COALESCE(approval_date, submission_date, created_date) DESC
        LIMIT 1`,
      [sfcClaimId, enrolmentId]
    );
    const amt = Number(res.rows[0]?.claim_amount);
    if (Number.isFinite(amt) && amt > 0) return Number(amt.toFixed(2));
  } catch (err) {
    console.warn('[QBO sfc invoice] claim_amount lookup failed (falling back to DA value):', err);
  }
  return Number.isFinite(fallback) && fallback > 0 ? Number(fallback.toFixed(2)) : 0;
}

export async function createDirectApplicationSfcInvoice(
  input: SfcInvoiceInput
): Promise<CreatedSfcInvoice | null> {
  const rawClaimId = String(input.sfcClaimId || '').trim();
  const docNumber = buildSfcInvoiceDocNumber(input.applicationId, rawClaimId);
  if (!docNumber) {
    throw new Error('createDirectApplicationSfcInvoice: applicationId or sfcClaimId is required');
  }

  const amount = await resolveClaimAmount(input.enrolmentId, rawClaimId, input.fallbackAmount);
  if (!(amount > 0)) {
    // Fail loudly — caller only invokes us when effectiveSfcClaimId is set,
    // so reaching here means we have a claim reference but no amount to bill.
    // Silent return would leave the DA row looking "invoiced" with no SFC
    // invoice to show for it.
    throw new Error(
      `SFC invoice cannot be generated for claim ${rawClaimId || '(unknown)'}: no claim_amount in ssg_claims and DA skillsfuture_credit is ${input.fallbackAmount}. Sync SSG claims before retrying.`
    );
  }

  // Idempotency first. Also reuse older invoices keyed by the raw claim id.
  const existing = await qboFindInvoiceByDocNumber(undefined, docNumber);
  const legacyExisting =
    !existing?.id && rawClaimId && rawClaimId !== docNumber
      ? await qboFindInvoiceByDocNumber(undefined, rawClaimId)
      : null;
  const existingInvoice = existing?.id ? existing : legacyExisting;
  if (existingInvoice?.id) {
    // Backfill PONumber if the existing invoice was created before PO linking
    // was added and mainInvoiceDocNumber is now available.
    const desiredPo = input.mainInvoiceDocNumber ? input.mainInvoiceDocNumber.trim() : '';
    const currentPo = existingInvoice.raw?.PONumber ? String(existingInvoice.raw.PONumber).trim() : '';
    if (desiredPo && currentPo !== desiredPo && existingInvoice.syncToken) {
      try {
        await qboSparseUpdateInvoice(undefined, existingInvoice.id, existingInvoice.syncToken, {
          PONumber: desiredPo,
        });
      } catch (err) {
        console.warn(`[QBO sfc invoice] Failed to backfill PONumber on invoice ${existingInvoice.id}:`, err);
      }
    }
    return {
      invoiceId: existingInvoice.id,
      docNumber,
      amount,
      reusedExisting: true,
    };
  }

  const itemName = resolveSkillsFutureCreditItemName();
  const item = await qboFindItemByName(undefined, itemName);
  if (!item?.id) {
    throw new Error(
      `SFC invoice requires QBO Product/Service "${itemName}" to exist. Create it in QuickBooks or set QBO_SFC_DA_ITEM_NAME / QBO_SFC_ITEM_NAME.`
    );
  }

  const term = await qboFindTermByName(undefined, SFC_TERM_NAME);
  if (!term?.id) {
    throw new Error(
      `SFC invoice requires QBO Term "${SFC_TERM_NAME}" to exist. Create it in QuickBooks (Lists → All Lists → Terms).`
    );
  }

  const customerRef = await resolveSupplementalCustomerRef();
  const taxOos = await qboResolveOosTaxCodeRef(undefined);
  const txnDate = new Date().toISOString().slice(0, 10);

  const invoiceBody: Record<string, any> = {
    CustomerRef: { value: customerRef },
    BillAddr: { Line1: SUPPLEMENTAL_INVOICE_CUSTOMER_NAME },
    TxnDate: txnDate,
    GlobalTaxCalculation: 'TaxExcluded',
    DocNumber: docNumber,
    SalesTermRef: { value: term.id },
    Line: [
      {
        DetailType: 'SalesItemLineDetail',
        Amount: amount,
        Description: `SkillsFuture Credit Usage/Claim:\nApplication ID: ${input.applicationId ?? '-'}`,
        SalesItemLineDetail: {
          ItemRef: { value: item.id, name: item.name },
          Qty: 1,
          UnitPrice: amount,
          TaxCodeRef: { value: taxOos },
        },
      },
    ],
  };

  if (input.mainInvoiceDocNumber && input.mainInvoiceDocNumber.trim()) {
    invoiceBody.PONumber = input.mainInvoiceDocNumber.trim();
  }

  const created = await qboCreateInvoice(undefined, invoiceBody);
  if (!created.id) {
    throw new Error('QB SFC invoice create returned no Id');
  }

  return {
    invoiceId: created.id,
    docNumber: created.docNumber || docNumber,
    amount,
    reusedExisting: false,
  };
}

export function buildDaSfcInvoicePdfFileName(docNumber: string): string {
  const raw = String(docNumber || '').trim().toUpperCase() || 'sfc';
  return `DA_SFC_QB_invoice_${raw}`;
}
