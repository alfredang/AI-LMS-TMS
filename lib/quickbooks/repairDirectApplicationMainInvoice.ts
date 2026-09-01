/**
 * DA-only: make sure a Direct Application's main (Customer/TC) invoice carries the
 * "SkillsFuture Claim by Direct Application" deduction line — the automated invoice
 * builder (createDirectApplicationInvoice.ts) always includes it, but an invoice a
 * staff member raises by hand (e.g. when auto-invoicing fails with QuickBooks'
 * "Account Period Closed" error) can easily be missing it, or carry a stale/wrong
 * version of it. This never touches the separate SFC-CA supplemental invoice or
 * receives any payment — it only edits the main invoice's own line items so it
 * accurately reflects what the learner owes.
 */
import { buildInvoiceLineText } from './invoiceLineText';
import { realApplicationId } from '../daApplicationId';
import {
  qboReadInvoice,
  qboSparseUpdateInvoice,
  qboFindItemByName,
  qboResolveOosTaxCodeRef,
  qboReadPayment,
  qboDeletePayment,
} from '../services/qboInvoiceService';

function resolveSkillsFutureCreditItemName(): string {
  return (
    process.env.QBO_SFC_DA_ITEM_NAME ||
    process.env.QBO_SFC_ITEM_NAME ||
    'SkillsFuture Claim by Direct Application'
  ).trim();
}

function toLineArray(x: unknown): any[] {
  return Array.isArray(x) ? x : x ? [x] : [];
}

/** Any line that looks like a SkillsFuture credit/claim deduction — correct, stale, or wrong. */
function isSkillsFutureLine(line: any): boolean {
  return /skillsfuture/i.test(String(line?.Description || ''));
}

export type RepairResult = {
  repaired: boolean;
  app: string;
  reason: string;
  deletedPaymentId?: string;
};

export async function repairDirectApplicationMainInvoiceSfcLine(input: {
  /** Apps to try reading the invoice from, in order (mirrors the caller's own app preference). */
  apps: string[];
  mainInvoiceId: string;
  /** Real (non-placeholder) DA application id, e.g. "CA-2606-001619". */
  applicationId: string;
  /** The SFC claim amount to deduct — positive; the invoice line itself is negative. */
  claimAmount: number;
}): Promise<RepairResult> {
  const appId = realApplicationId(input.applicationId);
  if (!appId) {
    throw new Error(`repairDirectApplicationMainInvoiceSfcLine: "${input.applicationId}" is not a real DA application id`);
  }
  if (!(input.claimAmount > 0)) {
    throw new Error(`repairDirectApplicationMainInvoiceSfcLine: claimAmount must be > 0 (got ${input.claimAmount})`);
  }

  let resolvedApp: string | null = null;
  let invoice: Awaited<ReturnType<typeof qboReadInvoice>> | null = null;
  for (const app of input.apps) {
    try {
      const inv = await qboReadInvoice(app, input.mainInvoiceId);
      if (inv?.id) {
        resolvedApp = app;
        invoice = inv;
        break;
      }
    } catch {
      // try next app
    }
  }
  if (!resolvedApp || !invoice || !invoice.syncToken) {
    throw new Error(`Could not read main invoice ${input.mainInvoiceId} from QuickBooks (tried ${input.apps.join(', ')})`);
  }

  const item = await qboFindItemByName(resolvedApp, resolveSkillsFutureCreditItemName());
  if (!item?.id) {
    throw new Error(
      `QuickBooks item "${resolveSkillsFutureCreditItemName()}" not found — create it in QuickBooks or set QBO_SFC_DA_ITEM_NAME`
    );
  }
  const built = buildInvoiceLineText({
    productDescription: item.description,
    fields: [{ key: 'claim', label: 'Application ID', value: appId }],
    fallbackHeading: 'SkillsFuture Credit Usage/Claim',
  });
  const desiredAmount = Number((-input.claimAmount).toFixed(2));

  const existingLines = toLineArray(invoice.raw?.Line);
  const sfcLines = existingLines.filter(isSkillsFutureLine);
  const alreadyCorrect =
    sfcLines.length === 1 &&
    String(sfcLines[0]?.Description || '') === built.text &&
    Math.abs(Number(sfcLines[0]?.Amount) - desiredAmount) < 0.005;

  if (alreadyCorrect) {
    return { repaired: false, app: resolvedApp, reason: 'SkillsFuture Claim line already correct — nothing to do' };
  }

  // Only now — something is actually going to change — check for and delete a payment on this
  // invoice whose amount matches the SFC claim. Deleting is scoped this tightly deliberately: a
  // payment for a DIFFERENT amount (e.g. the learner's own course-fee payment) must survive.
  let deletedPaymentId: string | undefined;
  const linkedPaymentTxns = toLineArray(invoice.raw?.LinkedTxn).filter((t: any) => String(t?.TxnType || '') === 'Payment');
  for (const txn of linkedPaymentTxns) {
    const paymentId = String(txn?.TxnId || '').trim();
    if (!paymentId) continue;
    const payment = await qboReadPayment(resolvedApp, paymentId).catch(() => null);
    const paymentAmount = Number(payment?.raw?.TotalAmt);
    if (payment?.raw && Number.isFinite(paymentAmount) && Math.abs(paymentAmount - input.claimAmount) < 0.005) {
      if (!payment.syncToken) {
        throw new Error(`Payment ${paymentId} on invoice ${input.mainInvoiceId} has no SyncToken — refusing to delete blind`);
      }
      await qboDeletePayment(resolvedApp, paymentId, payment.syncToken);
      deletedPaymentId = paymentId;
      // Deleting the payment changes the invoice's own SyncToken — re-read before editing lines.
      const fresh = await qboReadInvoice(resolvedApp, input.mainInvoiceId);
      if (!fresh?.syncToken) {
        throw new Error(`Could not re-read invoice ${input.mainInvoiceId} after deleting payment ${paymentId}`);
      }
      invoice = fresh;
      break; // amount match is exact — there is at most one such payment to remove
    }
  }

  const desiredLine = {
    DetailType: 'SalesItemLineDetail',
    Amount: desiredAmount,
    Description: built.text,
    SalesItemLineDetail: {
      ItemRef: { value: item.id, name: item.name },
      Qty: 1,
      UnitPrice: desiredAmount,
      TaxCodeRef: { value: await qboResolveOosTaxCodeRef(resolvedApp) },
    },
  };
  const linesWithoutSfc = toLineArray(invoice.raw?.Line).filter((l: any) => !isSkillsFutureLine(l));
  await qboSparseUpdateInvoice(resolvedApp, input.mainInvoiceId, invoice.syncToken!, {
    Line: [...linesWithoutSfc, desiredLine],
  });

  return {
    repaired: true,
    app: resolvedApp,
    reason: sfcLines.length > 0 ? 'Replaced incorrect SkillsFuture Claim line' : 'Added missing SkillsFuture Claim line',
    deletedPaymentId,
  };
}
