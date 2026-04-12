/**
 * Build + POST a QuickBooks invoice for a Direct Application (net fee after
 * SkillsFuture subsidy and credit).
 *
 * Pattern mirrors the n8n workflow "LZ - Update Quickbooks Invoice Upon Payment
 * Received V1" (authored by Liu Zhen, 21 Jan) — see
 * docs/reference/n8n-qb-invoice-payment-flow.json — specifically the JSON body
 * structure used by the Update Payment nodes (CustomerRef.value, Line[] with
 * SalesItemLineDetail, TxnDate).
 *
 * All calls go through /api/quickbooks/proxy so OAuth refresh stays centralized.
 */

import { resolveCustomerRef } from './resolveCustomerRef';

export interface DaApplicationForInvoice {
  id: string;
  trainee_name: string | null;
  trainee_email: string | null;
  course_title: string | null;
  course_reference_number: string | null;
  course_start_date: string | null;
  full_course_fee: string | number | null;
  skillsfuture_subsidy: string | number | null;
  skillsfuture_credit: string | number | null;
  qb_customer_ref: string | null;
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

async function callQbProxy(body: Record<string, any>): Promise<any> {
  const baseUrl = process.env.QBO_PROXY_BASE_URL || process.env.NEXT_PUBLIC_BASE_URL || 'http://localhost:3000';
  const resp = await fetch(`${baseUrl}/api/quickbooks/proxy`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const data = await resp.json().catch(() => null);
  if (!resp.ok || !data?.success) {
    throw new Error(data?.error || `QB proxy returned ${resp.status}`);
  }
  return data;
}

export async function createDirectApplicationInvoice(
  app: DaApplicationForInvoice
): Promise<CreatedInvoice> {
  // 1. Compute net payable amount
  const fullFee = toNumber(app.full_course_fee);
  const subsidy = toNumber(app.skillsfuture_subsidy);
  const credit = toNumber(app.skillsfuture_credit);
  const netAmount = Number((fullFee - subsidy - credit).toFixed(2));

  if (!Number.isFinite(netAmount) || netAmount <= 0) {
    throw new Error(
      `computed net amount ${netAmount} is not payable (fee=${fullFee}, subsidy=${subsidy}, credit=${credit})`
    );
  }

  if (!app.trainee_email) {
    throw new Error('trainee_email is required to create invoice');
  }

  // 2. Resolve or create customer (cached on the row via qb_customer_ref)
  const customerRef =
    app.qb_customer_ref ||
    (await resolveCustomerRef(app.trainee_name || app.trainee_email, app.trainee_email));

  // 3. Build invoice body
  const txnDate = new Date().toISOString().slice(0, 10);
  const dueDate = app.course_start_date
    ? addDays(app.course_start_date, 7)
    : addDays(txnDate, 14);

  const description =
    `${app.course_reference_number || 'Course'} - ${app.course_title || 'Training Fee'} ` +
    `(Net Fee after SkillsFuture Subsidy & Credit)`;

  const invoiceBody = {
    CustomerRef: { value: customerRef },
    TxnDate: txnDate,
    DueDate: dueDate,
    Line: [
      {
        DetailType: 'SalesItemLineDetail',
        Amount: netAmount,
        Description: description,
        SalesItemLineDetail: {
          // QBO will use the default income account if ItemRef is omitted only
          // when a default item exists. Most orgs require ItemRef; set to 1
          // (typical "Services" default) — override via QBO_DEFAULT_ITEM_REF.
          ItemRef: { value: process.env.QBO_DEFAULT_ITEM_REF || '1' },
        },
      },
    ],
  };

  // 4. POST via proxy
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
