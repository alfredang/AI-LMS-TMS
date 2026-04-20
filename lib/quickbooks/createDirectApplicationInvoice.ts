/**
 * Build + POST a QuickBooks invoice for a Direct Application (net fee after
 * SkillsFuture subsidy and credit).
 */

import { refreshGrantsForEnrolments } from '../services/billingSync';
import { resolveGrantDeductionLinesForInvoice } from '../services/daInvoiceGrantLines';
import { qboResolveInvoiceLineTaxCodeRef, qboResolveOosTaxCodeRef } from '../services/qboInvoiceService';
import { resolveCustomerRef } from './resolveCustomerRef';

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

function addDays(isoDate: string, days: number): string {
  const d = new Date(isoDate);
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}



function formatDate(d: string | Date | null | undefined): string {
  if (!d) return '—';
  return new Date(d).toLocaleDateString('en-SG', {
    day: '2-digit', month: 'short', year: 'numeric'
  });
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

async function findItemBySku(sku: string): Promise<string | null> {
  if (!sku) return null;
  try {
    const data = await callQbProxy({
      action: 'query',
      entity: 'item',
      query: `SELECT * FROM Item WHERE Sku = '${sku}'`,
    });
    const items = data?.data?.QueryResponse?.Item;
    if (Array.isArray(items) && items.length > 0) {
      console.log(`[QBO] Found item for SKU ${sku}: Id=${items[0].Id}`);
      return String(items[0].Id);
    }
    console.warn(`[QBO] No item found for SKU: ${sku}`);
    return null;
  } catch (e) {
    console.warn(`[QBO] Item lookup failed for SKU ${sku}:`, e);
    return null;
  }
}

export async function createDirectApplicationInvoice(
  app: DaApplicationForInvoice & { enrolment_id?: string }
): Promise<CreatedInvoice> {
  // 1. Compute amounts
  // full_course_fee is the base fee EXCLUDING gst
  // gst is stored separately
  // subsidy and credit are deducted from the base fee
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

  // Net payable = (fee - subsidy - credit) + gst
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

  // 2. Look up QBO item by course reference number (TGS SKU)
  const itemId =
    (await findItemBySku(app.course_reference_number || '')) ??
    process.env.QBO_DEFAULT_ITEM_REF ??
    null;

  if (!itemId) {
    throw new Error(
      `QBO item not found for SKU: ${app.course_reference_number}. Please create the item in QuickBooks or set QBO_DEFAULT_ITEM_REF.`
    );
  }

  // 3. Resolve or create customer
  const customerRef =
    app.qb_customer_ref ||
    (await resolveCustomerRef(app.trainee_name || app.trainee_email, app.trainee_email));

  // 4. Build invoice body
  const txnDate = new Date().toISOString().slice(0, 10);
  const dueDate = txnDate; // Due date is the same as invoice date

  // Generate invoice number: TC{YY}-{MM}{DD}-{last 6 digits of enrolment_id}
  const last6 = enrolmentId.slice(-6).padStart(6, '0');
  const now = new Date();
  const yy = String(now.getFullYear()).slice(-2);
  const mm = String(now.getMonth() + 1).padStart(2, '0');
  const dd = String(now.getDate()).padStart(2, '0');
  const docNumber = `TC${yy}-${mm}${dd}-${last6}`;

  const taxGst = await qboResolveInvoiceLineTaxCodeRef(undefined);
  const taxOos = await qboResolveOosTaxCodeRef(undefined);

  const lines: any[] = [];

  // Line 1: Full course fee — GST 9% SR (QBO calculates GST automatically)
  lines.push({
    DetailType: 'SalesItemLineDetail',
    Amount: fullFee,
    Description: [
      `Course Name: ${app.course_title ?? app.course_reference_number}`,
      `(${app.course_reference_number ?? ''})`,
      `Participant Name: ${app.trainee_name ?? '—'}`,
      `NRIC: ${app.trainee_id ?? '—'}`,
      (() => {
        const start = formatDate(app.course_start_date);
        const end = formatDate(app.course_end_date);
        if (start === end || !app.course_end_date) {
          return `Course Date: ${start}`;
        } else {
          return `Course Date: ${start} - ${end}`;
        }
      })(),
      `Course Run: ${app.course_run_id ?? '—'}`,
    ].join('\n'),
    SalesItemLineDetail: {
      ItemRef: { value: itemId },
      Qty: 1,
      UnitPrice: fullFee,
      TaxCodeRef: { value: taxGst },
    },
  });

  // Lines 2+: WSQ funding — Baseline and Non-Baseline separately when in ssg_grants
  for (const g of grantDeductionLines) {
    lines.push({
      DetailType: 'SalesItemLineDetail',
      Amount: -g.amount,
      Description: g.description,
      SalesItemLineDetail: {
        ItemRef: { value: itemId },
        Qty: 1,
        UnitPrice: -g.amount,
        TaxCodeRef: { value: taxOos },
      },
    });
  }

  // SkillsFuture Credit — Out of Scope (always show even if 0)
  lines.push({
    DetailType: 'SalesItemLineDetail',
    Amount: -credit,
    Description: `SkillsFuture Credit Usage/Claim:\nApplication ID: ${app.application_id ?? '—'}`,
    SalesItemLineDetail: {
      ItemRef: { value: itemId },
      Qty: 1,
      UnitPrice: -credit,
      TaxCodeRef: { value: taxOos },
    },
  });

  const invoiceBody = {
    CustomerRef: { value: customerRef },
    BillEmail: { Address: app.trainee_email },
    TxnDate: txnDate,
    DueDate: dueDate,
    GlobalTaxCalculation: 'TaxExcluded',
    Line: lines,
    DocNumber: docNumber,
  };

  // 5. Log invoice body for debugging
  console.log('[QBO invoice body]', JSON.stringify(invoiceBody, null, 2));

  // 6. POST via proxy
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
    docNumber: String(invoice.DocNumber || ''),
    customerRef,
    netAmount,
  };
}

