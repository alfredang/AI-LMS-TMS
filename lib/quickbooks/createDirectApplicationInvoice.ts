/**
 * Build + POST a QuickBooks invoice for a Direct Application (net fee after
 * SkillsFuture subsidy and credit).
 */

import { refreshGrantsForEnrolments } from '../services/billingSync';
import { resolveGrantDeductionLinesForInvoice } from '../services/daInvoiceGrantLines';
import {
  qboFindCustomerByName,
  qboFindInvoiceByDocNumber,
  qboFindInvoiceByDocNumberLike,
  qboFindItemByName,
  qboFindItemBySku,
  qboFindTermByName,
  qboGetDefaultInvoiceEmailFields,
  qboResolveInvoiceLineTaxCodeRef,
  qboResolveOosTaxCodeRef,
  qboSparseUpdateInvoice,
} from '../services/qboInvoiceService';

/**
 * Fixed QB customer used on every DA main tax invoice. Configurable via env
 * for non-standard realms; defaults to the WSQ Individual bucket. Must exist
 * in QuickBooks as an actual Customer record — we don't auto-create it.
 */
const MAIN_INVOICE_CUSTOMER_NAME = (
  process.env.QBO_DA_MAIN_CUSTOMER_NAME || 'WSQ Individual (Not for Company)'
).trim();

const MAIN_INVOICE_TERM_NAME = 'Due on receipt';

let cachedMainCustomerId: string | null = null;

async function resolveMainInvoiceCustomerRef(): Promise<string> {
  if (cachedMainCustomerId) return cachedMainCustomerId;
  const found = await qboFindCustomerByName(undefined, MAIN_INVOICE_CUSTOMER_NAME);
  if (!found?.id) {
    throw new Error(
      `QuickBooks Customer "${MAIN_INVOICE_CUSTOMER_NAME}" not found. Create it in QBO (Sales → Customers → New customer) or override via QBO_DA_MAIN_CUSTOMER_NAME env var.`
    );
  }
  cachedMainCustomerId = found.id;
  return cachedMainCustomerId;
}

export interface DaApplicationForInvoice {
  id: string;
  trainee_name: string | null;
  trainee_email: string | null;
  trainee_id: string | null;
  course_title: string | null;
  course_reference_number: string | null;
  course_start_date: string | null;
  course_end_date: string | null;
  course_run_id: string | null;
  full_course_fee: string | number | null;
  gst: string | number | null;
  skillsfuture_subsidy: string | number | null;
  skillsfuture_credit: string | number | null;
  grant_id: string | null;
  application_id: string | null;
  qb_customer_ref: string | null;
  // Per-grant breakdown
  bl_grant_id: string | null;
  bl_amount: string | number | null;
  other_grant_id: string | null;
  other_scheme_code: string | null;
  other_amount: string | number | null;
}

export interface CreatedInvoice {
  invoiceId: string;
  docNumber: string;
  customerRef: string;
  netAmount: number;
}

function toNumber(value: string | number | null | undefined): number {
  if (value == null) return 0;
  const n = typeof value === 'number' ? value : parseFloat(value);
  return Number.isFinite(n) ? n : 0;
}

function formatDate(d: string | Date | null | undefined): string {
  if (!d) return '-';
  return new Date(d).toLocaleDateString('en-SG', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  });
}

/**
 * Mask all but the last 4 characters of an NRIC/FIN for the invoice line
 * description. Example: "T0612345A" -> "XXXXX345A". IDs shorter than 5
 * characters are returned as-is. Falls back to '-' when missing.
 */
function maskNric(value: string | null | undefined): string {
  const raw = String(value || '').trim();
  if (!raw) return '-';
  if (raw.length <= 4) return raw;
  return 'X'.repeat(raw.length - 4) + raw.slice(-4);
}

async function callQbProxy(body: Record<string, any>): Promise<any> {
  const baseUrl = process.env.QBO_PROXY_BASE_URL || process.env.NEXT_PUBLIC_BASE_URL || 'http://localhost:3000';
  const resp = await fetch(`${baseUrl}/api/quickbooks/proxy`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const data = await resp.json().catch(() => null);
  if (!resp.ok || !data?.success) {
    console.error('[QBO proxy error details]', JSON.stringify(data, null, 2));
    throw new Error(data?.error || `QB proxy returned ${resp.status}`);
  }
  return data;
}

async function resolveLineItemRef(opts: {
  courseItemRef: { value: string; name?: string };
  itemName: string;
}): Promise<{ value: string; name?: string }> {
  const targetName = String(opts.itemName || '').trim();
  if (!targetName) return opts.courseItemRef;

  try {
    const item = await qboFindItemByName(undefined, targetName);
    if (item?.id) {
      return { value: item.id, name: item.name };
    }
    console.warn(`[QBO] No item found for name: ${targetName}. Falling back to course item.`);
  } catch (e) {
    console.warn(`[QBO] Item lookup failed for name ${targetName}:`, e);
  }

  return opts.courseItemRef;
}

function resolveSkillsFutureCreditItemName(): string {
  return (
    process.env.QBO_SFC_DA_ITEM_NAME ||
    process.env.QBO_SFC_ITEM_NAME ||
    'SkillsFuture Claim by Direct Application'
  ).trim();
}

export async function createDirectApplicationInvoice(
  app: DaApplicationForInvoice & { enrolment_id?: string }
): Promise<CreatedInvoice> {
  const fullFee = toNumber(app.full_course_fee);
  const gst = toNumber(app.gst);
  const combinedSubsidy = toNumber(app.skillsfuture_subsidy);
  const credit = toNumber(app.skillsfuture_credit);

  const enrolmentId = (app.enrolment_id || '').trim();
  if (enrolmentId) {
    try {
      await refreshGrantsForEnrolments([enrolmentId]);
    } catch (e) {
      console.warn('[createDirectApplicationInvoice] Grant refresh (non-blocking):', e);
    }
  }

  const { lines: grantDeductionLines, totalSubsidy: subsidy } = await resolveGrantDeductionLinesForInvoice({
    enrolmentId: enrolmentId || null,
    combinedSubsidy,
    grantIdFallback: app.grant_id,
  });

  const netAmount = Number((fullFee - subsidy - credit + gst).toFixed(2));

  if (!fullFee || fullFee <= 0) {
    throw new Error(
      `full_course_fee is not set (fee=${fullFee}). Cannot generate invoice for this application.`
    );
  }

  if (!Number.isFinite(netAmount) || netAmount < 0) {
    throw new Error(
      `computed net amount ${netAmount} is not payable (fee=${fullFee}, gst=${gst}, subsidy=${subsidy}, credit=${credit})`
    );
  }

  if (!app.trainee_email) {
    throw new Error('trainee_email is required to create invoice');
  }

  const courseItem = await qboFindItemBySku(undefined, app.course_reference_number || '');
  const itemId = courseItem?.id ?? process.env.QBO_DEFAULT_ITEM_REF ?? null;

  if (!itemId) {
    throw new Error(
      `QBO item not found for SKU: ${app.course_reference_number}. Please create the item in QuickBooks or set QBO_DEFAULT_ITEM_REF.`
    );
  }

  const courseItemRef = { value: itemId, name: courseItem?.name };

  // Customer is always the fixed "WSQ Individual (Not for Company)" bucket
  // — the learner's identity lives in the line-item Description (Participant
  // Name / NRIC / Course Run) rather than on the QB customer card.
  // BillEmail is still set to the learner's address below so QB can email
  // them when sending is enabled.
  const customerRef = await resolveMainInvoiceCustomerRef();

  const txnDate = new Date().toISOString().slice(0, 10);
  const dueDate = txnDate;

  const last6 = enrolmentId.slice(-6).padStart(6, '0');
  const now = new Date();
  const yy = String(now.getFullYear()).slice(-2);
  const mm = String(now.getMonth() + 1).padStart(2, '0');
  const dd = String(now.getDate()).padStart(2, '0');
  const docNumber = `TC${yy}-${mm}${dd}-${last6}`;

  // Idempotency — recover an orphan main invoice that a previous attempt
  // posted to QBO but failed to persist locally (network blip between POST and
  // DB update). Try today's DocNumber first, then a LIKE search on the stable
  // `-${last6}` suffix so a retry on a later day still matches.

  const mainTerm = await qboFindTermByName(undefined, MAIN_INVOICE_TERM_NAME);
  if (!mainTerm?.id) {
    throw new Error(
      `QuickBooks Term "${MAIN_INVOICE_TERM_NAME}" not found. Create it in QBO (Lists -> All Lists -> Terms).`
    );
  }
  const defaultEmailFields = await qboGetDefaultInvoiceEmailFields(undefined);

  const existingByToday = await qboFindInvoiceByDocNumber(undefined, docNumber);
  const existingByLast6 =
    !existingByToday?.id && last6
      ? await qboFindInvoiceByDocNumberLike(undefined, `TC%-${last6}`)
      : null;
  const orphan = existingByToday ?? existingByLast6;
  if (orphan?.id) {
    const reusedDoc = orphan.raw?.DocNumber ? String(orphan.raw.DocNumber) : docNumber;
    const currentTermId = orphan.raw?.SalesTermRef?.value ? String(orphan.raw.SalesTermRef.value) : '';
    const fieldsToUpdate = {
      ...(currentTermId !== mainTerm.id ? { SalesTermRef: { value: mainTerm.id } } : {}),
      ...defaultEmailFields,
    };
    if (orphan.syncToken && Object.keys(fieldsToUpdate).length > 0) {
      await qboSparseUpdateInvoice(undefined, orphan.id, orphan.syncToken, fieldsToUpdate);
    }
    console.log(`[QBO main invoice] Reusing orphan invoice ${orphan.id} (DocNumber ${reusedDoc}) for enrolment ${enrolmentId}`);
    return {
      invoiceId: String(orphan.id),
      docNumber: reusedDoc,
      customerRef: orphan.customerRef || customerRef,
      netAmount,
    };
  }

  const taxGst = await qboResolveInvoiceLineTaxCodeRef(undefined);
  const taxOos = await qboResolveOosTaxCodeRef(undefined);

  const lines: any[] = [];

  lines.push({
    DetailType: 'SalesItemLineDetail',
    Amount: fullFee,
    Description: [
      `Course Name: ${app.course_title ?? app.course_reference_number}`,
      `(${app.course_reference_number ?? ''})`,
      `Participant Name: ${app.trainee_name ?? '-'}`,
      `NRIC: ${maskNric(app.trainee_id)}`,
      (() => {
        const start = formatDate(app.course_start_date);
        const end = formatDate(app.course_end_date);
        if (start === end || !app.course_end_date) {
          return `Course Date: ${start}`;
        }
        return `Course Date: ${start} - ${end}`;
      })(),
      `Course Run: ${app.course_run_id ?? '-'}`,
    ].join('\n'),
    SalesItemLineDetail: {
      ItemRef: courseItemRef,
      Qty: 1,
      UnitPrice: fullFee,
      TaxCodeRef: { value: taxGst },
    },
  });

  for (const g of grantDeductionLines) {
    const grantItemRef = await resolveLineItemRef({
      courseItemRef,
      itemName: g.itemName,
    });
    lines.push({
      DetailType: 'SalesItemLineDetail',
      Amount: -g.amount,
      Description: g.description,
      SalesItemLineDetail: {
        ItemRef: grantItemRef,
        Qty: 1,
        UnitPrice: -g.amount,
        TaxCodeRef: { value: taxOos },
      },
    });
  }

  lines.push({
    DetailType: 'SalesItemLineDetail',
    Amount: -credit,
    Description: `SkillsFuture Credit Usage/Claim:\nApplication ID: ${app.application_id ?? '-'}`,
    SalesItemLineDetail: {
      ItemRef: await resolveLineItemRef({
        courseItemRef,
        itemName: resolveSkillsFutureCreditItemName(),
      }),
      Qty: 1,
      UnitPrice: -credit,
      TaxCodeRef: { value: taxOos },
    },
  });

  // BillAddr is set to the learner's name on every invoice — the QB Customer
  // is the fixed "WSQ Individual (Not for Company)" bucket, but the printed
  // billing address should identify the actual trainee. Line2–5 are blanked
  // so QBO doesn't merge in stale lines from the customer record.
  //
  // ShipAddr is intentionally blanked — DA invoices have no shipping concept,
  // and QBO will otherwise inherit the customer's default ShipAddr and render
  // a "Shipping to" box on the PDF.
  const billingAddressLine = String(app.trainee_name || '').trim() || MAIN_INVOICE_CUSTOMER_NAME;
  const invoiceBody = {
    CustomerRef: { value: customerRef },
    BillAddr: {
      Line1: billingAddressLine,
      Line2: '',
      Line3: '',
      Line4: '',
      Line5: '',
    },
    ShipAddr: {
      Line1: '',
      Line2: '',
      Line3: '',
      Line4: '',
      Line5: '',
    },
    BillEmail: { Address: app.trainee_email },
    ...defaultEmailFields,
    TxnDate: txnDate,
    DueDate: dueDate,
    SalesTermRef: { value: mainTerm.id },
    GlobalTaxCalculation: 'TaxExcluded',
    Line: lines,
    DocNumber: docNumber,
  };

  console.log('[QBO invoice body]', JSON.stringify(invoiceBody, null, 2));

  const createResp = await callQbProxy({
    action: 'create',
    entity: 'invoice',
    body: invoiceBody,
  });

  const invoice = createResp.data?.Invoice;
  if (!invoice?.Id) {
    throw new Error('QB invoice create returned no Id');
  }

  return {
    invoiceId: String(invoice.Id),
    docNumber: String(invoice.DocNumber || docNumber),
    customerRef,
    netAmount,
  };
}
