/**
 * Build + POST a supplemental "SkillsFuture Credit" invoice in QuickBooks for
 * a Direct Application, alongside the main tax invoice.
 *
 * Numbering and shape:
 *   - DocNumber      = SFC-{application_id} from da_application
 *                      (e.g. "SFC-CA-2604-000492"). Rows carrying only the
 *                      synthetic `MANUAL-…` placeholder instead of a real
 *                      MySkillsFuture id fall back to the SSG claim id.
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
import { buildSfcCreditLineDescription, realApplicationId } from '../daApplicationId';
import {
  qboCreateInvoice,
  qboFindCustomerByName,
  qboFindInvoiceByDocNumber,
  qboFindItemByName,
  qboCreateInvoiceRetryingDuplicateDocNumber,
  qboFindTermByName,
  qboResolveOosTaxCodeRef,
  qboSparseUpdateInvoice,
} from '../services/qboInvoiceService';
import { buildPurchaseOrderInvoiceFields } from './directApplicationInvoiceFields';
import { buildInvoiceLineText } from './invoiceLineText';

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

/**
 * The credit line, worded by the QuickBooks product - the same
 * `SkillsFuture Claim by Direct Application` product the main invoice uses, so
 * the two documents match. WSQ and CASL share it; there is no CASL variant and
 * none is needed.
 *
 * The value is the genuine MySkillsFuture application id, or the SSG enrolment
 * reference when the row only carries our internal `MANUAL-` placeholder. The
 * placeholder itself never reaches an invoice.
 */
function buildSfcCreditLineText(
  applicationId: string | null,
  enrolmentId: string,
  productDescription: string | null | undefined
): string {
  const real = realApplicationId(applicationId);
  const value = real || String(enrolmentId || '').trim();
  if (!value) return buildSfcCreditLineDescription(applicationId, enrolmentId);

  return buildInvoiceLineText({
    productDescription,
    fields: [
      { key: 'claim', label: real ? 'Application ID' : 'Enrolment ID', value },
    ],
    fallbackHeading: 'SkillsFuture Credit Usage/Claim',
  }).text;
}

function resolveSkillsFutureCreditItemName(): string {
  return (
    process.env.QBO_SFC_DA_ITEM_NAME ||
    process.env.QBO_SFC_ITEM_NAME ||
    'SkillsFuture Claim by Direct Application'
  ).trim();
}

function normalizeApplicationId(rawApplicationId: string | null | undefined): string {
  // Only a genuine MySkillsFuture id may number an invoice. Our `MANUAL-…`
  // placeholder would produce `SFC-MANUAL-ENR-…`, which finance's `SFC-CA-…`
  // convention does not match — fall through to the SSG claim id instead.
  return (realApplicationId(rawApplicationId) || '').toUpperCase();
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

/**
 * Re-read `da_application.application_id` at generation time rather than trusting
 * whatever value the caller was handed — a `sfc_import_rows` batch row can be stale
 * if the real MySkillsFuture id was adopted (placeholder -> CA-...) after the batch
 * was last previewed, and pressing "Generate SFC Invoice" should always use the
 * current truth.
 */
async function fetchFreshApplicationId(
  enrolmentId: string,
  fallback: string | null
): Promise<string | null> {
  try {
    const res = await pool.query(
      `SELECT application_id FROM public.da_application
        WHERE LOWER(TRIM(COALESCE(enrolment_id,''))) = LOWER(TRIM($1::text))
        LIMIT 1`,
      [enrolmentId]
    );
    if (res.rows.length === 0) return fallback;
    const fresh = res.rows[0]?.application_id;
    const trimmed = String(fresh ?? '').trim();
    return trimmed || fallback;
  } catch (err) {
    console.warn('[QBO sfc invoice] fresh application_id lookup failed (using passed-in value):', err);
    return fallback;
  }
}

const SFC_TC_LINE_PATTERN = /^\s*(SkillsFuture Credit Usage\/Claim|To\s*Less\s*Skillsfuture\s*Credit)/i;

/**
 * Ensure the main/TC invoice carries a correct negative SkillsFuture Credit
 * deduction line matching the SFC-CA invoice just created/reused — replacing a
 * stale or wrongly-worded line (including the legacy "To Less Skillsfuture
 * Credit" text some invoices were cut with) or adding one if it's missing
 * entirely. A no-op if the line is already correct. Best-effort: failures here
 * must not undo the SFC-CA invoice that was already created.
 */
async function syncSfcDeductionLineOnMainInvoice(params: {
  mainInvoiceDocNumber: string;
  applicationId: string | null;
  enrolmentId: string;
  amount: number;
  item: { id: string; name: string; description?: string | null };
  taxOosRef: string;
}): Promise<void> {
  const { mainInvoiceDocNumber, applicationId, enrolmentId, amount, item, taxOosRef } = params;
  const mainInvoice = await qboFindInvoiceByDocNumber(undefined, mainInvoiceDocNumber, { ignoreVoided: true });
  if (!mainInvoice?.id || !mainInvoice.syncToken) return;

  const existingLines: any[] = Array.isArray(mainInvoice.raw?.Line) ? mainInvoice.raw.Line : [];
  const desiredDescription = buildSfcCreditLineText(applicationId, enrolmentId, item.description);
  const desiredAmount = -Math.abs(amount);

  const isCorrect = (line: any) =>
    line?.SalesItemLineDetail?.ItemRef?.value === item.id &&
    String(line?.Description ?? '') === desiredDescription &&
    Number(line?.Amount) === desiredAmount &&
    line?.SalesItemLineDetail?.TaxCodeRef?.value === taxOosRef;

  const buildLine = (existing?: any) => ({
    ...(existing?.Id ? { Id: existing.Id } : {}),
    DetailType: 'SalesItemLineDetail',
    Amount: desiredAmount,
    Description: desiredDescription,
    SalesItemLineDetail: {
      ItemRef: { value: item.id, name: item.name },
      Qty: 1,
      UnitPrice: desiredAmount,
      TaxCodeRef: { value: taxOosRef },
    },
  });

  const idx = existingLines.findIndex((l) => SFC_TC_LINE_PATTERN.test(String(l?.Description ?? '')));
  let nextLines: any[];
  if (idx === -1) {
    nextLines = [...existingLines, buildLine()];
  } else if (!isCorrect(existingLines[idx])) {
    nextLines = existingLines.map((l, i) => (i === idx ? buildLine(l) : l));
  } else {
    return; // already correct
  }

  await qboSparseUpdateInvoice(undefined, mainInvoice.id, mainInvoice.syncToken, { Line: nextLines });
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
  const applicationId = await fetchFreshApplicationId(input.enrolmentId, input.applicationId ?? null);
  const docNumber = buildSfcInvoiceDocNumber(applicationId, rawClaimId);
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

  const itemName = resolveSkillsFutureCreditItemName();
  const item = await qboFindItemByName(undefined, itemName);
  if (!item?.id) {
    throw new Error(
      `SFC invoice requires QBO Product/Service "${itemName}" to exist. Create it in QuickBooks or set QBO_SFC_DA_ITEM_NAME / QBO_SFC_ITEM_NAME.`
    );
  }

  const taxOos = await qboResolveOosTaxCodeRef(undefined);

  const mainInvoiceDocNumber = input.mainInvoiceDocNumber ? input.mainInvoiceDocNumber.trim() : '';
  const syncMainInvoice = async () => {
    if (!mainInvoiceDocNumber) return;
    // Only touch the TC invoice when there's a real CA number to cite. A `MANUAL-…`
    // placeholder means we don't actually know whether this is a genuine DA case
    // awaiting adoption or a genuinely non-DA enrolment (e.g. the real application
    // was cancelled) — for the latter, the TC invoice correctly has no SFC line at
    // all (it's settled by a payment, not a deduction line), and overwriting that
    // is a real mistake, confirmed live on ENR-2608-120388.
    if (!realApplicationId(applicationId)) return;
    try {
      await syncSfcDeductionLineOnMainInvoice({
        mainInvoiceDocNumber,
        applicationId,
        enrolmentId: input.enrolmentId,
        amount,
        item,
        taxOosRef: taxOos,
      });
    } catch (err) {
      console.warn(
        `[QBO sfc invoice] Failed to sync SFC deduction line on main invoice ${mainInvoiceDocNumber}:`,
        err
      );
    }
  };

  // Idempotency first. Also reuse older invoices keyed by the raw claim id.
  // A void is not a reusable invoice; skipping it allows a reissue.
  const existing = await qboFindInvoiceByDocNumber(undefined, docNumber, { ignoreVoided: true });
  const legacyExisting =
    !existing?.id && rawClaimId && rawClaimId !== docNumber
      ? await qboFindInvoiceByDocNumber(undefined, rawClaimId, { ignoreVoided: true })
      : null;
  const existingInvoice = existing?.id ? existing : legacyExisting;
  if (existingInvoice?.id) {
    // Backfill PONumber if the existing invoice was created before PO linking
    // was added and mainInvoiceDocNumber is now available.
    if (mainInvoiceDocNumber && existingInvoice.syncToken) {
      try {
        await qboSparseUpdateInvoice(
          undefined,
          existingInvoice.id,
          existingInvoice.syncToken,
          await buildPurchaseOrderInvoiceFields(mainInvoiceDocNumber, existingInvoice.raw)
        );
      } catch (err) {
        console.warn(`[QBO sfc invoice] Failed to backfill PONumber on invoice ${existingInvoice.id}:`, err);
      }
    }
    await syncMainInvoice();
    return {
      invoiceId: existingInvoice.id,
      docNumber,
      amount,
      reusedExisting: true,
    };
  }

  const term = await qboFindTermByName(undefined, SFC_TERM_NAME);
  if (!term?.id) {
    throw new Error(
      `SFC invoice requires QBO Term "${SFC_TERM_NAME}" to exist. Create it in QuickBooks (Lists → All Lists → Terms).`
    );
  }

  const customerRef = await resolveSupplementalCustomerRef();
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
        Description: buildSfcCreditLineText(applicationId, input.enrolmentId, item.description),
        SalesItemLineDetail: {
          ItemRef: { value: item.id, name: item.name },
          Qty: 1,
          UnitPrice: amount,
          TaxCodeRef: { value: taxOos },
        },
      },
    ],
  };

  if (mainInvoiceDocNumber) {
    Object.assign(invoiceBody, await buildPurchaseOrderInvoiceFields(mainInvoiceDocNumber));
  }

  // As with the grant invoice: the claim reference is the number, so a reissue
  // after a hand-void lands on -R2 rather than failing.
  const created = await qboCreateInvoiceRetryingDuplicateDocNumber(
    body => qboCreateInvoice(undefined, body),
    invoiceBody
  );
  if (!created.id) {
    throw new Error('QB SFC invoice create returned no Id');
  }

  await syncMainInvoice();

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
